#!/usr/bin/env node
// fix-preset-cwd.mjs
//
// DSH 0.2.1-rc.2 起变量插值改为严格模式：只注册 provider / model，{{cwd}} 不再注册
// （工作目录改由工作目录服务作为运行时上下文注入）。用户从旧模板复制出来的预设明文里
// 只要还留着 {{cwd}}，组装阶段就会抛 unknown prompt variable，模型请求根本发不出去。
//
// 本脚本负责「自删 {{cwd}}」：
//   1. 只动用户复制出来的预设明文 —— profile 的 cordis.patch.yml 里 preset-<name> 块的
//      persona prefix / suffix 文本与块内模板注释；
//   2. 不动 node_modules 里的内置模板，不动 patch 的其它节点；
//   3. 默认只处理挂载了 QQ 工具的预设（块内出现 im-qqbot，或名字出现在 im-qqbot 的 preset 配置里），--all 可放开；
//   4. 幂等；--dry-run 只报告不写盘；写盘前自动备份。
//
// 用法：
//   node scripts/fix-preset-cwd.mjs                 # 修 $DSH_HOME/profiles/web/cordis.patch.yml
//   node scripts/fix-preset-cwd.mjs --dry-run       # 只看会改什么
//   node scripts/fix-preset-cwd.mjs --file <path>   # 指定文件
//   node scripts/fix-preset-cwd.mjs --scan          # 扫描 profiles 下所有 cordis.patch.yml
//   node scripts/fix-preset-cwd.mjs --all           # 不限 QQ 预设
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = { dry: false, all: false, scan: false, file: null, debug: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run' || a === '-n') opt.dry = true;
  else if (a === '--all') opt.all = true;
  else if (a === '--scan') opt.scan = true;
  else if (a === '--debug') opt.debug = true;
  else if (a === '--file') opt.file = argv[++i];
  else if (a === '-h' || a === '--help') { console.log(readme()); process.exit(0); }
}

function readme() {
  return [
    'fix-preset-cwd.mjs — 从用户预设明文里删掉 {{cwd}}（DSH 0.2.1-rc.2 起不再注册该变量）',
    '',
    '  --dry-run, -n   只报告，不写盘',
    '  --file <path>   指定要处理的 cordis.patch.yml',
    '  --scan          扫描 $DSH_HOME/profiles/*/cordis.patch.yml',
    '  --all           不限"挂载了 QQ 工具"的预设（默认只看 QQ 用的那几个）',
    '  --debug         打印每个预设块的识别结果',
  ].join('\n');
}

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');

// ── 替换规则（先长后短，避免半截残留） ─────────────────────────────────
const RULES = [
  // ① 中文整句：`由 {{model}} 驱动……当前工作目录 {{cwd}}`
  { re: /[，,、;；]?\s*当前工作目录\s*\{\{\s*cwd\s*\}\}/gu, to: '' },
  // ② 英文整句：`Your working directory is {{cwd}}.`
  { re: /\s*Your\s+working\s+directory\s+is\s*\{\{\s*cwd\s*\}\}\s*\.?/giu, to: '' },
  // ③ 注释/说明里的并列：`{{model}} 和 {{cwd}} 都能解析`
  { re: /\s*(?:和|与|及|and|&)\s*\{\{\s*cwd\s*\}\}/gu, to: '' },
  // ④ 兜底：剩下的裸变量
  { re: /\{\{\s*cwd\s*\}\}/gu, to: '' },
];

function cleanText(s) {
  let out = s;
  for (const r of RULES) out = out.replace(r.re, r.to);
  // 删掉变量后可能留下句末游离标点/双空格
  out = out.replace(/[，,]\s*。/gu, '。').replace(/…{2,}\s*。/gu, '……').replace(/[ \t]{2,}/gu, ' ');
  return out;
}

// ── 解析 patch：找出每个 preset 块与它的 persona 文本区 ────────────────
function analyze(lines) {
  const presets = [];
  // ① 收集"被 QQ 通道使用的预设名"：im-qqbot 节点附近的 `preset: 'xxx'`
  const qqPresetNames = new Set();
  lines.forEach((line, i) => {
    const m = /^\s*preset:\s*['"]?([\w.-]+)['"]?\s*$/u.exec(line);
    if (!m) return;
    const win = lines.slice(Math.max(0, i - 60), i + 60).join('\n');
    if (/im-qqbot|@zaofan\/dsh-qqbot/u.test(win)) qqPresetNames.add(m[1]);
  });

  let cur = null;
  const pushEnd = (i) => {
    if (!cur) return;
    cur.end = i;
    cur.body = lines.slice(cur.start, i);
    cur.qq = qqPresetNames.has(cur.name) || cur.body.some((l) => /im-qqbot|@zaofan\/dsh-qqbot/u.test(l));
    presets.push(cur);
    cur = null;
  };

  lines.forEach((line, i) => {
    const m = /^(\s*)-\s+id:\s*preset-(\S+)\s*$/u.exec(line);
    if (m) {
      if (cur) pushEnd(i);
      cur = { name: m[2], start: i, end: lines.length, indent: m[1].length, qq: false, textRanges: [] };
      return;
    }
    if (cur) {
      // 同缩进或更浅的新条目 = 上一个块结束
      const n = /^(\s*)-\s+id:\s*\S+/u.exec(line);
      if (n && n[1].length <= cur.indent) { pushEnd(i); }
    }
  });
  pushEnd(lines.length);

  // 在块内定位 persona 的 prefix / suffix 文本区
  for (const p of presets) {
    const body = lines.slice(p.start, p.end);
    let inText = null;
    body.forEach((line, k) => {
      const abs = p.start + k;
      const key = /^\s*(prefix|suffix)\s*:\s*(\|-?|>|-?)?\s*$/u.exec(line);
      const inline = /^\s*(prefix|suffix)\s*:\s*(?!\|)(\S.*)$/u.exec(line);
      if (key) { inText = { from: abs, to: p.end }; return; }
      if (inline) { p.textRanges.push({ from: abs, to: abs }); return; }
      if (inText) {
        // 更浅缩进且像 key 的行 = 文本区结束
        if (/^\s{0,6}(?:[A-Za-z][\w-]*|- id:)/u.test(line) && !/^\s{8,}/u.test(line)) {
          inText.to = abs;
          p.textRanges.push(inText);
          inText = null;
        }
      }
    });
    if (inText) p.textRanges.push(inText);
    // 注释行也算（模板注释里常写 "{{model}} 和 {{cwd}} resolve ..."）
    for (let k = 0; k < body.length; k++) {
      if (/^\s*#/u.test(body[k])) p.textRanges.push({ from: p.start + k, to: p.start + k });
    }
  }
  return presets;
}

// ── 主流程 ─────────────────────────────────────────────────────────────
function processFile(file) {
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/u);
  const presets = analyze(lines);
  const targets = presets.filter((p) => (opt.all ? true : p.qq));
  const report = [];
  let changed = 0;

  if (opt.debug) {
    for (const p of presets) {
      console.log(`  [dbg] ${p.name} qq=${p.qq} start=${p.start + 1} end=${p.end} ranges=${p.textRanges.length}`);
    }
  }

  for (const p of targets) {
    const seen = new Set();
    const ranges = p.textRanges
      .filter((r) => { const key = `${r.from}-${r.to}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => a.from - b.from);

    for (const r of ranges) {
      for (let i = r.from; i <= Math.min(r.to, p.end - 1); i++) {
        const before = lines[i];
        if (!/\{\{\s*cwd\s*\}\}/u.test(before)) continue;
        let after = cleanText(before).replace(/\s+$/u, '');
        // prefix:/suffix: 删空后写成空字符串，避免 YAML 把它解析成 null
        if (/^\s*(prefix|suffix)\s*:$/u.test(after)) after = `${after} ''`;
        const isComment = /^\s*#/u.test(before);
        if (!isComment && after.trim() === '') {
          report.push({ preset: p.name, line: i + 1, before: before.trim(), after: '(整行删除)' });
          lines[i] = '\u0000DELETE\u0000';
          changed++;
          continue;
        }
        report.push({ preset: p.name, line: i + 1, before: before.trim(), after: after.trim() });
        lines[i] = after;
        changed++;
      }
    }
  }

  const outLines = lines.filter((l) => l !== '\u0000DELETE\u0000');
  const out = outLines.join('\n');

  console.log(`\n文件: ${file}`);
  console.log(`  预设块: ${presets.length}（挂载 QQ 工具的: ${presets.filter((p) => p.qq).length}）`);
  console.log(`  本次处理预设: ${targets.length}`);
  if (report.length === 0) {
    console.log('  ✅ 没有需要清理的 {{cwd}}（已是干净状态）');
    return 0;
  }
  for (const r of report) {
    console.log(`  - [${r.preset}] 第 ${r.line} 行`);
    console.log(`      前: ${r.before}`);
    console.log(`      后: ${r.after}`);
  }
  console.log(`  合计修改 ${changed} 行`);
  if (opt.dry) {
    console.log('  (--dry-run，未写盘)');
    return changed;
  }
  const stamp = new Date().toISOString().replace(/[-:T]/gu, '').slice(0, 14);
  const bak = `${file}.bak-cwdfix-${stamp}`;
  copyFileSync(file, bak);
  writeFileSync(file, out, 'utf8');
  console.log(`  💾 已写回，备份: ${basename(bak)}`);
  return changed;
}

function defaultFiles() {
  if (opt.file) return [opt.file];
  if (opt.scan) {
    const dir = join(DSH_HOME, 'profiles');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((n) => join(dir, n, 'cordis.patch.yml'))
      .filter((p) => existsSync(p) && statSync(p).isFile());
  }
  const p = join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml');
  return existsSync(p) ? [p] : [];
}

const files = defaultFiles();
if (files.length === 0) {
  console.error('找不到 cordis.patch.yml，用 --file 指定路径');
  process.exit(1);
}
let total = 0;
for (const f of files) total += processFile(f);
console.log(`\n总计: ${total} 处`);
