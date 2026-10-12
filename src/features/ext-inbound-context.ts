/**
 * ext-inbound-context.ts — 挂到中间件 `ctx` 上的「动作 API」（2026-10-12）
 *
 * 用户看到的全部能力就是这些（`examples/ext-inbound/README.md` 里的表与此一一对应）：
 *
 * ```js
 * // ── 消息维（早挂点 onInbound 用）──
 * ctx.annihilate({ reason })      // 消灭这条：不进历史 / 不进上下文 / 不占冷却（内部=不 next）
 * ctx.rewrite({ text, reason })   // 替换文本（必须在记群历史之前生效 ⇒ 早挂点）
 * ctx.forceWake({ reason })       // 强制入站：跳过价值评分 / @门控 / 冷却等"值不值得回"的判断
 * // ── 消息维（晚挂点 onDecide 用）──
 * ctx.decide({ mention: 'ignore' | 'force', reason })
 * // ── 用户维（两个挂点都能用）──
 * ctx.muteUser({ id?, minutes, reason })   // id 缺省 = 当前发送者；写进持久名单
 * ctx.unmuteUser({ id? })
 * ctx.isMuted(id?) / ctx.mutedUsers()      // 读名单（带剩余时间）
 * // ── 通用 ──
 * ctx.text / ctx.scope / ctx.sender / ctx.senderName / ctx.isOwner / ctx.groupId / ctx.mentions
 * ctx.quoted({ text, fromSelf }) / ctx.platform({ mentioned })
 * ctx.logger / ctx.dataRoot
 * ctx.kv.get(key) / ctx.kv.set(key, value)
 * ```
 *
 * ── 四条保命纪律（主人点名）───────────────────────────────────────────────
 *  ① **白名单最高优先**：主人/owner（`config.groupAdmin.owners`）**永不可被静默或消灭** ——
 *     扩展对 owner 调 `annihilate` 会被**拒绝执行**并记一条 warn（消息照常放行）；`muteUser(owner)` 同理。
 *  ② **强唤醒优先于静默**：本模块只保证 `forceWake` **不被别的动作抵消**（`annihilate` 除外——
 *     那是"整条不进站"，两者本就互斥，谁先发生谁生效）；**顺序由扩展自己排**，
 *     文档里写明"求助关键词判断要写在黑名单判断之前"。
 *  ③ **熔断**：破坏性动作（消灭/静默）密度异常 ⇒ 停用该扩展的破坏性动作（消息照常放行）+ 告警。
 *     统计与阈值在 `ext-inbound-state.ts`；这里只负责"问一句、记账、拒绝"。
 *  ④ **审计 + 可撤销**：每个动作落一行 `audit.jsonl`（**文本摘要要截断**）；`muteUser` 能用
 *     `unmuteUser` 解掉。
 *
 * ── 铁律：**任何动作都绝不抛到链上** ────────────────────────────────────────
 * 每个动作整体包在 try/catch 里，出错只 `warn` 并返回 false；ctx 上的属性一律
 * `Object.defineProperty(..., { enumerable: false })` —— 不参与 `{...ctx}` 展开、
 * 不会被 JSON.stringify 抓走（内部命令层就是靠展开 ctx 组 handler 参数的，别去污染它）。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { Logger } from '../types.js';
import { lastBotReplyOf } from './bot-reply-memo.js';
import {
  appendAudit,
  checkDestructiveAllowed,
  isMuted as stateIsMuted,
  mutedUsers as stateMutedUsers,
  muteUser as stateMuteUser,
  noteDestructive,
  readExtState,
  unmuteUser as stateUnmuteUser,
  writeExtState,
  type ExtMute,
  type ExtMuteView,
} from './ext-inbound-state.js';

/** 运行环境（由挂载点/运行器传进来） */
export interface ExtRunEnv {
  /** 数据根：状态文件、审计都落它下面 */
  dataRoot: string;
  /** 主人 openid 白名单（`config.groupAdmin.owners`） */
  owners: string[];
  /** 插件 logger（动作告警用） */
  logger: Logger;
  /** 当前 bot 的 appId（`ctx.platform.mentioned` 的内容兜底扫描要用，与 SDK mentionGate 同款判据） */
  appId?: string;
}

/** 一条消息、一个中间件 ctx 对应的一份扩展会话（早/晚两个挂点共享同一份） */
export interface ExtCtxSession {
  env: ExtRunEnv;
  /** 当前在跑哪个挂点：早 `inbound` / 晚 `decide` */
  phase: 'inbound' | 'decide';
  /** 当前正在执行的扩展（动作归属、审计署名、熔断统计都认它） */
  current?: { file: string; name: string };
  /** 已请求消灭（读它的地方是运行器的 next 包装：置位后再调 next() 也不会往下走） */
  annihilate?: { reason?: string };
  /**
   * 请求过消灭但**被拒**（白名单 / 熔断 / 挂点不允许）。
   *
   * 为什么必须记下来：扩展最常见的写法是
   * ```js
   * if (该消灭) { ctx.annihilate({ reason }); return; }   // 只调动作，不调 next
   * ```
   * 一旦 annihilate 被拒，`return` 仍然会让链停在这一层 —— 等于"插件拒绝了，消息还是被吞了"。
   * 所以运行器看到这个标记时会**替扩展放行**（白名单最高优先 / 熔断后只放行）。
   */
  annihilateRefused?: { reason: string };
  /** 已请求强制入站 */
  forceWake?: { reason?: string };
  /** 已覆盖 @ 判定 */
  decide?: { mention: 'ignore' | 'force'; reason?: string };
  /** 本消息里 rewrite 过几次（诊断） */
  rewriteCount: number;
  /** 本消息里破坏性动作成功过几次（熔断统计看增量） */
  destructiveCount: number;
  /** 参与记账去重：同一个扩展在同一条消息上（早+晚）只记一次参与 */
  noted: Set<string>;
  /** 已告警过的提示（一次性，防刷屏） */
  warned: Set<string>;
}

const SESSIONS = new WeakMap<object, ExtCtxSession>();

/** 取（必要时建）某个 ctx 的扩展会话，并把动作 API 挂上去（幂等） */
export function ensureExtSession(ctx: MiddlewareContext, env: ExtRunEnv): ExtCtxSession {
  const key = ctx as unknown as object;
  let s = SESSIONS.get(key);
  if (!s) {
    s = {
      env,
      phase: 'inbound',
      rewriteCount: 0,
      destructiveCount: 0,
      noted: new Set<string>(),
      warned: new Set<string>(),
    };
    SESSIONS.set(key, s);
    decorate(ctx, s);
  } else {
    // 同一个 ctx 可能先后经过两个挂点：只补缺的环境字段（appId 可能后到）
    if (!s.env.dataRoot && env.dataRoot) s.env.dataRoot = env.dataRoot;
    if (env.appId && !s.env.appId) s.env.appId = env.appId;
    if (!s.env.owners.length && env.owners.length) s.env.owners = env.owners;
  }
  return s;
}

/** 只读会话（没挂过则 undefined） */
export function sessionOf(ctx: MiddlewareContext): ExtCtxSession | undefined {
  return SESSIONS.get(ctx as unknown as object);
}

/**
 * 进入某个扩展的执行：设置归属 + 挂点，返回会话。
 * 调用方（运行器）负责在用完之后吞掉异常 —— 本模块的动作自己不会抛。
 */
export function enterExtension(
  ctx: MiddlewareContext,
  env: ExtRunEnv,
  ext: { file: string; name: string },
  phase: 'inbound' | 'decide',
): ExtCtxSession {
  const s = ensureExtSession(ctx, env);
  s.current = { file: ext.file, name: ext.name };
  s.phase = phase;
  return s;
}

// ══════════════════════════════════════════════════════════════
// 小工具：告警 / 审计 / 字段读取
// ══════════════════════════════════════════════════════════════

/** 扩展展示名（日志/审计署名）：没有 current 时兜一个匿名 */
function who(s: ExtCtxSession): string {
  return s.current?.name || s.current?.file || '(匿名扩展)';
}

/** 告警（带扩展名；日志接口缺 warn 时静默） */
function warn(s: ExtCtxSession, msg: string): void {
  try { s.env.logger?.warn?.(`[ext-inbound:${who(s)}] ${msg}`); } catch { /* ignore */ }
}

/** 同一句提示只告警一次（群消息多，别刷屏；改文件热重载后自然重置） */
function warnOnce(s: ExtCtxSession, key: string, msg: string): void {
  if (s.warned.has(key)) return;
  s.warned.add(key);
  warn(s, msg);
}

/**
 * 数据根可用性检查。
 * ⚠️ dataRoot 为空时，**名单 / kv / 审计一律降级为空操作** —— 否则 `join('', '.qqbot-extensions', …)`
 *    会按相对路径在当前工作目录里造目录写文件（测试或嵌入方没传 dataRoot 时就会发生）。
 */
function rootOk(s: ExtCtxSession): boolean {
  if (s.env.dataRoot) return true;
  warnOnce(s, 'no-dataroot', '运行环境没给 dataRoot → 禁言名单 / kv / 审计本次全部降级为空操作（不写盘）');
  return false;
}

/** 写审计（署名当前扩展；**永不抛出**） */
function audit(s: ExtCtxSession, entry: Parameters<typeof appendAudit>[1]): void {
  try {
    if (!rootOk(s)) return;
    appendAudit(s.env.dataRoot, { file: s.current?.file, name: s.current?.name, ...entry });
  } catch { /* ignore */ }
}

/** 当前发送者 openid */
function senderOf(ctx: MiddlewareContext): string {
  try { return String((ctx.message as { senderId?: unknown } | undefined)?.senderId ?? ''); } catch { return ''; }
}

/** 当前消息文本 */
function textOf(ctx: MiddlewareContext): string {
  try { return String((ctx.message as { content?: unknown } | undefined)?.content ?? ''); } catch { return ''; }
}

/** 是否主人（白名单判定：与 botplay/ext-caps 同口径 —— config.groupAdmin.owners 里有没有这个 openid） */
function ownerOf(s: ExtCtxSession, id: string): boolean {
  return id !== '' && s.env.owners.includes(id);
}

/** 与 SDK mentionGate 同款三选一判据（本扩展点在门控之前，读不到 ctx.state.mention，只能自己判） */
function platformMentioned(ctx: MiddlewareContext, appId: string | undefined): boolean {
  try {
    const m = ctx.message as unknown as {
      rawEventType?: unknown;
      mentions?: Array<{ is_you?: boolean }> | undefined;
      content?: unknown;
    };
    if (String(m?.rawEventType ?? '') === 'GROUP_AT_MESSAGE_CREATE') return true;
    if (Array.isArray(m?.mentions) && m.mentions.some((x) => x?.is_you === true)) return true;
    return detectMentionInContent(String(m?.content ?? ''), appId);
  } catch {
    return false;
  }
}

/** 内容里是否含 `<@{appId}>` / `<@!{appId}>`（与 media-history / SDK mention-gate 同一份判据） */
function detectMentionInContent(content: string, appId: string | undefined): boolean {
  const id = String(appId ?? '');
  if (!content || !id) return false;
  const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.includes(`<@${safe}>`) || content.includes(`<@!${safe}>`);
}

/** 可调用 + 带属性的对象（契约里 `ctx.quoted({text,fromSelf})` 两种读法都支持） */
function callableWith<T extends object>(make: () => T): (() => T) & T {
  const f = ((): T => make()) as (() => T) & T;
  try { Object.assign(f, make()); } catch { /* ignore */ }
  return f;
}

/** 被引用的原文（`ctx.state.quote` 是 SDK quoteRef 赋的，别自己解析引用） */
function quotedOf(ctx: MiddlewareContext): { text: string; fromSelf: boolean; id: string } {
  try {
    const q = (ctx.state as { quote?: { text?: unknown; entry?: { senderId?: unknown } } } | undefined)?.quote;
    const text = String(q?.text ?? '');
    // 被引那条消息的发送者 openid（SDK quoteRef 在 store 命中时给的 entry.senderId）。
    // 用途：辅导员类扩展"回复某人再下令 → 对**被回复的那个人**动手"。
    // ⚠️ 拿不到（引用的是没见过的消息 / 走 msg_elements 解析）时是空串，自己判空。
    const id = String(q?.entry?.senderId ?? '');
    if (!text) return { text: '', fromSelf: false, id };
    // fromSelf 是**尽力而为**的启发式：插件没记住 bot 自己的 openid，
    // 但 transport/outbound-buffer 会把"她刚说的那句"记进 bot-reply-memo（10 分钟内有效），
    // 两者文本对得上（含被平台截断的前缀情形）就认为"引的是她自己那条"。
    const key = ctx.message.kind === 'group'
      ? String((ctx.message as { groupOpenid?: unknown }).groupOpenid ?? '')
      : String((ctx.message as { senderId?: unknown }).senderId ?? '');
    const last = lastBotReplyOf(key);
    if (!last) return { text, fromSelf: false, id };
    const a = last.text.trim();
    const b = text.trim();
    const hit = a !== '' && b !== '' && (a === b || b.startsWith(a) || a.startsWith(b));
    return { text, fromSelf: hit, id };
  } catch {
    return { text: '', fromSelf: false, id: '' };
  }
}

// ══════════════════════════════════════════════════════════════
// 动作实现
// ══════════════════════════════════════════════════════════════

/** 消灭：只置标记 —— 真正"不往下走"由运行器的 next 包装执行（置位后再调 next() 也无效） */
function annihilate(ctx: MiddlewareContext, s: ExtCtxSession, opts?: { reason?: string }): boolean {
  try {
    const reason = typeof opts?.reason === 'string' ? opts.reason : undefined;
    // ① 挂点检查：晚挂点已经记过群历史了，"消灭=不进历史"在那一步做不到
    if (s.phase !== 'inbound') {
      warn(s, 'annihilate 只在早挂点 onInbound 有效（晚挂点 already 记过群历史；想拦掉这条就直接不调 next()）');
      audit(s, { action: 'annihilate', reason, result: 'refused-late-hook' });
      s.annihilateRefused = { reason: 'annihilate 只在早挂点 onInbound 有效' };
      return false;
    }
    // ② 白名单最高优先：主人永不可被消灭
    const sender = senderOf(ctx);
    if (ownerOf(s, sender)) {
      warn(s, `拒绝消灭：发送者 ${sender} 在主人口令白名单里（白名单最高优先，本条照常放行）`);
      audit(s, { action: 'annihilate', target: sender, reason, result: 'refused-owner' });
      s.annihilateRefused = { reason: '发送者是主人（白名单最高优先）' };
      return false;
    }
    // ③ 熔断
    const gate = checkDestructiveAllowed(s.current?.file ?? '');
    if (!gate.ok) {
      warn(s, `熔断中，annihilate 被拒（${gate.reason}）—— 本条消息照常放行`);
      audit(s, { action: 'annihilate', target: sender, reason, result: 'refused-breaker' });
      s.annihilateRefused = { reason: `熔断：${gate.reason}` };
      return false;
    }
    s.annihilate = reason ? { reason } : {};
    s.destructiveCount += 1;
    noteDestructive(s.current?.file ?? '');
    audit(s, { action: 'annihilate', target: sender, reason, text: textOf(ctx), result: 'ok' });
    return true;
  } catch (err) {
    warn(s, `annihilate 异常(已忽略): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 改写文本：直接改 `ctx.message.content`（早挂点在记历史之前 ⇒ 群历史里也是改后的文本） */
function rewrite(ctx: MiddlewareContext, s: ExtCtxSession, opts?: { text?: string; reason?: string }): boolean {
  try {
    const raw = opts?.text;
    if (typeof raw !== 'string') {
      warn(s, 'rewrite 需要 { text: "改写后的文本" }（收到非字符串，已忽略）');
      audit(s, { action: 'rewrite', result: 'refused-invalid' });
      return false;
    }
    const before = textOf(ctx);
    (ctx.message as { content?: string }).content = raw;
    s.rewriteCount += 1;
    audit(s, {
      action: 'rewrite',
      target: senderOf(ctx),
      reason: typeof opts?.reason === 'string' ? opts.reason : undefined,
      text: `→ ${raw}`,
      result: s.phase === 'inbound' ? 'ok' : 'ok-late-hook(群历史里仍是原文)',
    });
    // 改写前后都记一笔（debug 级）：排查"到底改没改"最直接
    try {
      s.env.logger?.debug?.(`[ext-inbound:${who(s)}] rewrite: "${before.slice(0, 30)}" → "${raw.slice(0, 30)}"`);
    } catch { /* ignore */ }
    return true;
  } catch (err) {
    warn(s, `rewrite 异常(已忽略): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 强制入站：写 `ctx.state.qqInboundForceWake` —— 门控/评分/冷却三处都认这个标记 */
function forceWake(ctx: MiddlewareContext, s: ExtCtxSession, opts?: { reason?: string }): boolean {
  try {
    const reason = typeof opts?.reason === 'string' ? opts.reason : undefined;
    const st = ctx.state as Record<string, unknown>;
    st.qqInboundForceWake = true;
    if (reason) st.qqInboundForceWakeReason = reason;
    s.forceWake = reason ? { reason } : {};
    audit(s, {
      action: 'forceWake',
      target: senderOf(ctx),
      reason,
      text: textOf(ctx),
      result: s.phase === 'inbound' ? 'ok' : 'ok-late-hook(门控已过，只免评分/冷却)',
    });
    return true;
  } catch (err) {
    warn(s, `forceWake 异常(已忽略): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 覆盖 @ 判定（晚挂点专用：`ctx.state.mention` 是 mentionGate 刚写的） */
function decide(ctx: MiddlewareContext, s: ExtCtxSession, opts?: { mention?: string; reason?: string }): boolean {
  try {
    const mode = opts?.mention === 'force' ? 'force' : opts?.mention === 'ignore' ? 'ignore' : undefined;
    const reason = typeof opts?.reason === 'string' ? opts.reason : undefined;
    if (!mode) {
      warn(s, "decide 需要 { mention: 'ignore' | 'force' }（收到别的值，已忽略）");
      audit(s, { action: 'decide', reason, result: 'refused-invalid' });
      return false;
    }
    if (s.phase !== 'decide') {
      warn(s, 'decide 只在晚挂点 onDecide 有效（早挂点在 mentionGate 之前，ctx.state.mention 还没写出来）');
      audit(s, { action: 'decide', reason, result: 'refused-early-hook' });
      return false;
    }
    const st = ctx.state as { mention?: { wasMentioned?: boolean } | undefined };
    const want = mode === 'force';
    if (st.mention && typeof st.mention === 'object') st.mention.wasMentioned = want;
    else st.mention = { wasMentioned: want };
    s.decide = reason ? { mention: mode, reason } : { mention: mode };
    audit(s, {
      action: 'decide',
      target: senderOf(ctx),
      reason,
      text: `mention=${mode}`,
      result: 'ok',
    });
    return true;
  } catch (err) {
    warn(s, `decide 异常(已忽略): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 禁言：写持久名单（`minutes <= 0` = 永久）。白名单与熔断同样拦在前面 */
function muteUser(
  ctx: MiddlewareContext,
  s: ExtCtxSession,
  opts?: { id?: string; minutes?: number; reason?: string; by?: string },
): ExtMute | false {
  try {
    const id = String(opts?.id ?? senderOf(ctx) ?? '').trim();
    const reason = typeof opts?.reason === 'string' ? opts.reason : undefined;
    if (!id) {
      warn(s, 'muteUser 需要 { id }（缺省 = 当前发送者；这条两个都没拿到，已忽略）');
      audit(s, { action: 'muteUser', reason, result: 'refused-invalid' });
      return false;
    }
    if (ownerOf(s, id)) {
      warn(s, `拒绝禁言：${id} 在主人口令白名单里（白名单最高优先）`);
      audit(s, { action: 'muteUser', target: id, reason, result: 'refused-owner' });
      return false;
    }
    const gate = checkDestructiveAllowed(s.current?.file ?? '');
    if (!gate.ok) {
      warn(s, `熔断中，muteUser 被拒（${gate.reason}）`);
      audit(s, { action: 'muteUser', target: id, reason, result: 'refused-breaker' });
      return false;
    }
    if (!rootOk(s)) return false;
    const minutes = Number(opts?.minutes);
    const entry = stateMuteUser(s.env.dataRoot, s.current?.file ?? '(unknown)', {
      id,
      minutes: Number.isFinite(minutes) ? minutes : 0,
      ...(reason ? { reason } : {}),
      by: typeof opts?.by === 'string' && opts.by ? opts.by : who(s),
    });
    if (!entry) {
      warn(s, `muteUser 写名单失败（数据根不可写？）: ${id}`);
      audit(s, { action: 'muteUser', target: id, reason, result: 'failed-write' });
      return false;
    }
    s.destructiveCount += 1;
    noteDestructive(s.current?.file ?? '');
    audit(s, {
      action: 'muteUser',
      target: id,
      reason,
      text: entry.until === 0 ? '永久' : `至 ${new Date(entry.until).toISOString()}`,
      result: 'ok',
    });
    return entry;
  } catch (err) {
    warn(s, `muteUser 异常(已忽略): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 解禁（可撤销通道） */
function unmuteUser(ctx: MiddlewareContext, s: ExtCtxSession, opts?: { id?: string }): boolean {
  try {
    const id = String(opts?.id ?? senderOf(ctx) ?? '').trim();
    if (!id || !rootOk(s)) return false;
    const ok = stateUnmuteUser(s.env.dataRoot, s.current?.file ?? '(unknown)', id);
    audit(s, { action: 'unmuteUser', target: id, result: ok ? 'ok' : 'not-found' });
    return ok;
  } catch (err) {
    warn(s, `unmuteUser 异常(已忽略): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 查一条是否被禁言（只读，不写审计） */
function isMuted(ctx: MiddlewareContext, s: ExtCtxSession, id?: string): ExtMuteView | null {
  try {
    const key = String(id ?? senderOf(ctx) ?? '').trim();
    if (!key || !rootOk(s)) return null;
    return stateIsMuted(s.env.dataRoot, s.current?.file ?? '(unknown)', key);
  } catch {
    return null;
  }
}

/** 读整份名单（只读，不写审计） */
function mutedUsers(_ctx: MiddlewareContext, s: ExtCtxSession): ExtMuteView[] {
  try {
    if (!rootOk(s)) return [];
    return stateMutedUsers(s.env.dataRoot, s.current?.file ?? '(unknown)');
  } catch {
    return [];
  }
}

/** kv 读（只读，不写审计） */
function kvGet(_ctx: MiddlewareContext, s: ExtCtxSession, key: string): unknown {
  try {
    if (!rootOk(s)) return undefined;
    return readExtState(s.env.dataRoot, s.current?.file ?? '(unknown)').kv[String(key)];
  } catch {
    return undefined;
  }
}

/** kv 写；`value === undefined` 等价删除该键（JSON 里会消失） */
function kvSet(_ctx: MiddlewareContext, s: ExtCtxSession, key: string, value: unknown): boolean {
  try {
    if (!rootOk(s)) return false;
    const file = s.current?.file ?? '(unknown)';
    const st = readExtState(s.env.dataRoot, file);
    st.kv[String(key)] = value;
    return writeExtState(s.env.dataRoot, file, st);
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// 挂到 ctx 上
// ══════════════════════════════════════════════════════════════

/** 定义不可枚举属性（不参与展开/序列化）；失败静默（绝不影响消息链） */
function def(target: object, key: string, desc: PropertyDescriptor): void {
  try {
    Object.defineProperty(target, key, { enumerable: false, configurable: true, ...desc });
  } catch { /* ignore */ }
}

/**
 * 把动作 API 挂到 ctx 上（每个 ctx 只挂一次）。
 * ⚠️ 一律**不可枚举**：middleware-setup 的命令层会 `{...ctx}` 组 handler 参数，
 *    可枚举的话会把这些动作/取值器一起复制过去（还可能覆盖扩展命令自己的 caps）。
 */
function decorate(ctx: MiddlewareContext, s: ExtCtxSession): void {
  const c = ctx as unknown as Record<string, unknown>;

  // ── 动作（消息维）──
  def(c, 'annihilate', { value: (opts?: { reason?: string }) => annihilate(ctx, s, opts) });
  def(c, 'rewrite', { value: (opts?: { text?: string; reason?: string }) => rewrite(ctx, s, opts) });
  def(c, 'forceWake', { value: (opts?: { reason?: string }) => forceWake(ctx, s, opts) });
  def(c, 'decide', { value: (opts?: { mention?: string; reason?: string }) => decide(ctx, s, opts) });

  // ── 动作（用户维）──
  def(c, 'muteUser', { value: (opts?: { id?: string; minutes?: number; reason?: string; by?: string }) => muteUser(ctx, s, opts) });
  def(c, 'unmuteUser', { value: (opts?: { id?: string }) => unmuteUser(ctx, s, opts) });
  def(c, 'isMuted', { value: (id?: string) => isMuted(ctx, s, id) });
  def(c, 'mutedUsers', { value: () => mutedUsers(ctx, s) });

  // ── 通用取值（读的时候现算，不缓存快照）──
  // text：读 = 当前文本；写 = 直接改 ctx.message.content（等价于 unsafely 改写，审计请用 rewrite）
  def(c, 'text', {
    get: () => textOf(ctx),
    set: (v: unknown) => { (ctx.message as { content?: string }).content = String(v ?? ''); },
  });
  def(c, 'scope', { get: () => (ctx.message.kind === 'group' ? 'group' : 'c2c') });
  def(c, 'sender', { get: () => senderOf(ctx) });
  def(c, 'senderName', { get: () => String((ctx.message as { senderName?: unknown }).senderName ?? '') });
  def(c, 'isOwner', { get: () => ownerOf(s, senderOf(ctx)) });
  def(c, 'groupId', { get: () => String((ctx.message as { groupOpenid?: unknown }).groupOpenid ?? '') });
  def(c, 'mentions', { get: () => ((ctx.message as { mentions?: unknown }).mentions ?? []) });
  def(c, 'quoted', { get: () => callableWith(() => quotedOf(ctx)) });
  def(c, 'platform', {
    get: () => callableWith(() => ({ mentioned: platformMentioned(ctx, s.env.appId) })),
  });
  def(c, 'logger', { get: () => s.env.logger });
  def(c, 'dataRoot', { get: () => s.env.dataRoot });

  // ── 每个扩展自己的持久化（与禁言名单同一个文件）──
  def(c, 'kv', {
    get: () => ({
      get: (key: string) => kvGet(ctx, s, key),
      set: (key: string, value: unknown) => kvSet(ctx, s, key, value),
    }),
  });

  // ── 内部诊断（也给用户看：这些动作到底生效没有）──
  def(c, 'extState', {
    get: () => ({
      phase: s.phase,
      extension: s.current?.name ?? '',
      annihilated: s.annihilate !== undefined,
      forceWake: s.forceWake !== undefined,
      mentionOverride: s.decide?.mention,
      rewrites: s.rewriteCount,
      destructive: s.destructiveCount,
    }),
  });
}
