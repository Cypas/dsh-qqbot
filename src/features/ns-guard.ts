/**
 * settingsNs 冲突防护（2026-10-11）
 *
 * 起因（主人实测报告）："web 和 desktop 的凭据会互相覆盖"。
 *
 * 背景：`settingsNs` 是**全局唯一**的设置槽名 —— 设置文件落在
 *   `{DSH_HOME}/qqbot-settings/<ns>.json`，这个路径里**没有 profile 维度**。
 * 于是两个 profile（web / desktop）各挂一个实例、却填了同一个 ns 时：
 *   · 两边共用同一份文件 → 谁最后保存谁生效，凭据(appId/appSecret)/preset/cwd 一起被换掉；
 *   · 更狠的是 cwd / dataRoot 被换 → 数据根、群守则、表情包、会话台账全跟着变；
 *   · 两个 profile 同时跑且 appId 相同时，QQ 只保留一条活跃连接 → 后连的顶掉先连的（"收不到消息"）。
 *
 * 本模块只做**只读探测**（绝不改任何 profile 文件），给出两件可独立测试的工具：
 *   ① scanNsOwners()      扫 `profiles/<name>/cordis.patch.yml`，列出"还挂载着这个 ns"的 profile
 *   ② describeNsConflict() 生成给人看 / 给日志用的告警文案
 *
 * 配套：settings-host.js 的 `writeOwnSettings()` 会写 `<ns>.writer.json` 指纹，
 * 发现同一槽被**另一个 profile** 写过时拒绝静默覆盖（见那边的 NS_CONFLICT）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 本插件包名（patch 里用它认出"这是本插件的实例行"） */
const PLUGIN_PKG = '@zaofan/dsh-qqbot';
/** 没写 settingsNs 时的默认槽名（必须与 index.ts / session-manager 的取值一致） */
export const DEFAULT_NS = 'im-qqbot';

/**
 * 把 patch 文本切成"顶层列表项"块。
 * 不追求完整 YAML 解析 —— 这里只需要"同一块内 `disabled: true` 能盖住同块的实例行"，够用即可。
 */
function splitPatchBlocks(txt: string): string[] {
  return String(txt ?? '').split(/\r?\n(?=\s*-\s+(?:id|insert|name|config|disabled)\s*:)/);
}

/** 从一份 patch 文本里取「启用中的本插件实例」所用的 settingsNs（去重）。 */
export function settingsNsOfPatch(txt: string): string[] {
  const out: string[] = [];
  for (const block of splitPatchBlocks(txt)) {
    if (!block.includes(PLUGIN_PKG)) continue;
    if (/^\s*disabled\s*:\s*true\s*$/m.test(block)) continue; // 该行已停用 → 不占用设置槽
    const instCount = block.split(PLUGIN_PKG).length - 1;      // 该块里有几个本插件实例
    const hits: string[] = [];
    const re = /settingsNs\s*:\s*['"]?([A-Za-z0-9_-]+)['"]?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) hits.push(String(m[1]));
    // 写了 settingsNs 的按写的算，没写的实例落默认槽
    out.push(...hits);
    for (let i = hits.length; i < instCount; i++) out.push(DEFAULT_NS);
  }
  return Array.from(new Set(out));
}

/**
 * 扫 `{DSH_HOME}/profiles/<name>/cordis.patch.yml`，列出挂载了 targetNs 的 profile 名（已排序）。
 * 只读；任何一步失败都当作"没扫到" —— 自检绝不能反过来把启动搞挂。
 */
export function scanNsOwners(dshHome: string, targetNs: string): string[] {
  const dir = join(dshHome, 'profiles');
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const f = join(dir, name, 'cordis.patch.yml');
    try {
      if (!existsSync(f)) continue;
      if (settingsNsOfPatch(readFileSync(f, 'utf8')).includes(targetNs)) out.push(name);
    } catch { /* 读不到 / 解析不了 → 跳过 */ }
  }
  return out.sort();
}

/** 生成告警文案（日志与设置页共用；含判据与修法，别只说"有冲突"）。 */
export function describeNsConflict(opts: {
  ns: string;
  owners: string[];
  myProfile?: string;
  settingsFile?: string;
}): string {
  const { ns, owners, myProfile = '', settingsFile = '' } = opts;
  const others = owners.filter((p) => p !== myProfile);
  return [
    `⚠️ settingsNs 冲突：设置槽 "${ns}" 同时被这些 profile 挂载 → ${owners.map((p) => `"${p}"`).join('、')}。`,
    `本实例在 profile "${myProfile || 'unknown'}"，与 ${others.map((p) => `"${p}"`).join('、')} 共用同一份设置文件`,
    `${settingsFile ? `（${settingsFile}）` : ''}：谁最后保存谁生效，凭据(appId/appSecret)/preset/cwd 会被一起换掉`,
    `（cwd/dataRoot 一变，数据根、群守则、表情包、会话台账全跟着变）；两个 profile 同时跑且 appId 相同时，`,
    `QQ 只保留一条活跃连接 —— 后连的会顶掉先连的，表现就是"突然收不到消息"。`,
    `修法：给其中一个 profile 换 settingsNs（如 "${ns}-desktop"），或只在一个 profile 里启用该实例（另一处写 disabled: true）。`,
  ].join('');
}
