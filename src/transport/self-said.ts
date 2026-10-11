/**
 * 自发言台账（2026-10-11，为 `[rfself:文字]` 服务）
 *
 * 干什么：记住**机器人自己发出去的每条消息**（msg_id + 文本 + 时间），
 * 让正文里的 `[rfself:某句话]` 能按文字把它找回来 → 拿它的 msg_id 作引用目标发出。
 * 于是 AI 就能"引用自己刚说过的话"（QQ 侧已实测允许：发送响应里会回 `ext_info.ref_idx`）。
 *
 * ⚠️ 匹配**只用词法**。主人 2026-10-11 明确：本地小模型不是通用的，只干它原本那件事，
 *    这里不许接它。三层从严到宽，宁缺毋滥：
 *      ① **精确**：query 够长、且逐字出现在某条里 → 直接命中（多条命中取最近一条）
 *      ② **打分**：query 切成片段（中文 2-gram + 整段、英文/数字整词），
 *         按「命中覆盖率 × 长度惩罚 × 新鲜度」排序，覆盖率不到阈值就不算
 *      ③ 仍然没有 → 返回 undefined；调用方按"无引用"处理并记一行日志，**绝不乱指一条**。
 *
 * 存储：`{dataRoot}/.qqbot/self-said/<scope>_<peerId>.json`（按会话分文件，上限 SELF_SAID_MAX 条）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 每个会话最多留多少条（越新越靠后） */
export const SELF_SAID_MAX = 300;
/** 单条文本最多存多少字（够匹配就行，省盘） */
const TEXT_KEEP = 400;
/** 精确匹配的最低查询长度（太短的短词不许走精确，避免误中） */
const EXACT_MIN = 4;
/** 打分路线的覆盖率门槛：低于它一律不算命中 */
const COVER_MIN = 0.6;
/** 新鲜度半衰期（小时） */
const HALF_LIFE_H = 6;

export interface SelfSaidItem {
  /** QQ 的 msg_id（引用/撤回都用它） */
  id: string;
  /** 发出去的文本（原样存，匹配用归一化后的副本） */
  t: string;
  /** 发送时间（epoch ms） */
  at: number;
}

interface SelfSaidFileShape {
  seq: number;
  items: SelfSaidItem[];
}

function safe(part: string): string {
  return String(part || '').replace(/[^A-Za-z0-9_-]/g, '_');
}

export function selfSaidFile(dataRoot: string, scope: string, peerId: string): string {
  return join(dataRoot, '.qqbot', 'self-said', `${safe(scope)}_${safe(peerId)}.json`);
}

function load(file: string): SelfSaidFileShape {
  try {
    if (!existsSync(file)) return { seq: 0, items: [] };
    const o = JSON.parse(readFileSync(file, 'utf8'));
    if (o && typeof o === 'object' && Array.isArray(o.items)) {
      return { seq: Number(o.seq) || 0, items: o.items as SelfSaidItem[] };
    }
  } catch { /* 坏了就当空的（不阻塞发送） */ }
  return { seq: 0, items: [] };
}

function save(file: string, data: SelfSaidFileShape): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(data), 'utf8');
    renameSync(tmp, file);
  } catch { /* 落盘失败不阻塞消息流 */ }
}

/** 记住一条自己发出的消息（发送成功后调用；没 id 或没文本就跳过）。 */
export function rememberSelfSaid(
  dataRoot: string,
  scope: string,
  peerId: string,
  msgId: string,
  text: string,
): void {
  const id = String(msgId || '').trim();
  const t = String(text || '').trim();
  if (!dataRoot || !id || !t) return;
  const file = selfSaidFile(dataRoot, scope, peerId);
  const data = load(file);
  if (data.items.some((x) => x.id === id)) return; // 同一条重复记（重试/降级重发）→ 跳过
  data.seq += 1;
  data.items.push({ id, t: t.length > TEXT_KEEP ? t.slice(0, TEXT_KEEP) : t, at: Date.now() });
  if (data.items.length > SELF_SAID_MAX) data.items = data.items.slice(-SELF_SAID_MAX);
  save(file, data);
}

/** 归一化：去空白与标点、英文小写（只做词法，不做任何语义扩展） */
function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 查询切片段：中文 2-gram + 整段；英文/数字整词 */
function gramsOf(q: string): string[] {
  const t = normalize(q);
  if (!t) return [];
  const out = new Set<string>();
  const isCjk = (ch: string): boolean => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
  // 先按"非字母数字"切开（借 normalize 之后只剩字母数字，这里按 CJK 与非 CJK 再切一次）
  const segs = t.split(/(?<=[\u3400-\u9fff\uf900-\ufaff])(?=[^a-z0-9])|(?<=[^a-z0-9])(?=[\u3400-\u9fff\uf900-\ufaff])/g);
  for (const segRaw of segs) {
    const seg = segRaw.trim();
    if (!seg) continue;
    if (isCjk(seg)) {
      const chars = Array.from(seg);
      if (chars.length <= 2) { out.add(seg); continue; }
      for (let i = 0; i + 2 <= chars.length; i++) out.add(chars.slice(i, i + 2).join(''));
      out.add(seg); // 整段也留一个（长查询时更准）
    } else {
      out.add(seg);
    }
  }
  return Array.from(out);
}

export interface SelfSaidHit {
  id: string;
  t: string;
  at: number;
  /** 打分路线的覆盖率（精确命中固定 1） */
  cover: number;
  /** exact | score */
  mode: 'exact' | 'score';
}

/**
 * 按文字找"自己说过的那条"：精确优先 → 覆盖率打分（相关 × 新鲜）→ 都不达标返回 undefined。
 */
export function findSelfSaid(
  dataRoot: string,
  scope: string,
  peerId: string,
  query: string,
  now = Date.now(),
): SelfSaidHit | undefined {
  const q = String(query || '').trim();
  if (!dataRoot || !q) return undefined;
  const items = load(selfSaidFile(dataRoot, scope, peerId)).items;
  if (!items.length) return undefined;

  // ① 精确：逐字包含（从最新往旧找）
  const nq = normalize(q);
  if (Array.from(nq).length >= EXACT_MIN) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (normalize(it.t).includes(nq)) {
        return { id: it.id, t: it.t, at: it.at, cover: 1, mode: 'exact' };
      }
    }
  }

  // ② 打分：覆盖率（相关）× 长度惩罚 × 新鲜度
  const grams = gramsOf(q);
  if (!grams.length) return undefined;
  let best: SelfSaidHit | undefined;
  let bestScore = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    const t = normalize(it.t);
    if (!t) continue;
    let hit = 0;
    for (const g of grams) if (t.includes(g)) hit++;
    const cover = hit / grams.length;
    if (cover < COVER_MIN) continue;
    const lenPenalty = Math.min(1, 60 / Math.max(20, Array.from(it.t).length));
    const ageH = Math.max(0, (now - it.at) / 3600000);
    const fresh = Math.pow(0.5, ageH / HALF_LIFE_H);
    const score = cover * 0.75 + lenPenalty * 0.1 + fresh * 0.15;
    if (score > bestScore) { bestScore = score; best = { id: it.id, t: it.t, at: it.at, cover, mode: 'score' }; }
  }
  return best;
}
