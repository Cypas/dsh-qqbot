/**
 * session_watch_lib.mjs — 「回合结束回灌」的共用实现（放在 tools/lib/ 下，不被当工具扫描）
 *
 * 口径**照抄 qqbot 的 passive 收尾**（src/transport/outbound.ts:80-211）：
 *   · 回合内累积 `assistant/message` 的正文（= 它的 noteGenerated(sessionKey, msgId, text)）
 *   · `turn/end` 时结算（它的注释原文：「assistant/message 用完即清，turn/end 兜底清」）
 *   · 取**最后一个正文块**的文本（它收尾时也是"把最后一块复制一份"）
 *
 * 本库只做两件事：挂监听、把末段正文回灌给创建者（父 agent）。
 *
 * ★ 2026-10-12 定案（主人）：回灌**模拟用户消息**（source.kind='user'）+ **唤醒**父会话。
 *   `followup` 就是 `inject` 的唤醒档（inject=next-step 不唤醒；followup=next-turn 唤醒），
 *   所以这里用 followup 即"注入 + 唤醒"。下面的历史分析仍保留，供追溯为什么不再走通知身份。
 *   原因（实测结论）：`inject` 落 `agent/inbox/spliced **target=next-step**` —— 排队到下次组包、
 *   **不产生回合**，因此既没有 turn 触发节点、**UI 上也什么都没有**。
 *   而 `followup` 落 `target=next-turn` ⇒ 产生回合 ⇒ 被渲染成 `TurnTriggerNodeView`：
 *   那个「白框」。回灌消息的 `source.kind='subagent-settled'` 决定白框标题
 *   （dsh-client-ui-chat 的 turnTriggerDetails：subagent-settled → 「子任务状态更新」）。
 *   代价：回灌会**唤醒父会话跑一轮**（烧 token），故正文里加了一行"无需回复"提示。
 *
 * ⚠️ 回灌消息的形状**必须**对齐宿主「子会话结算通知」（createSettlementMessage）：
 *   { id, role:'user', content:[摘要行, 结尾正文引导语, ...正文块],
 *     source:{ kind:'subagent-settled', form:'notice', summary, senderSessionId } }
 *
 * ⚠️ 注入前必须过 isInjectableMessage() 自检（fail-closed）。宿主的顺序是
 *   **先 append 落盘、后读 `msg.source.kind`**：形状不合法时坏记录已经写进
 *   `agent/inbox/spliced.data.inserted[]`，之后投影抛错 —— 会话文件从此无法加载。
 *   事故实例：会话 9643a885 的 seq 4222 曾被写成 `inserted: ["<字符串>"]`。
 *
 * 用法：
 *   import { register } from './lib/session_watch_lib.mjs';
 *   await register(root, { parentAgentId, childSessionId, label });
 */
/**
 * 版本标记：供调用方打印，用来确认**热刷后加载到的到底是哪一版**。
 * 改动本文件时顺手把这个号 +1（或换日期），排查"改了不生效"时一眼就能看出来。
 */
export const __LIB_VERSION__ = 'lib-v10-20261012-首行给源会话id';

/**
 * 盯梢名单。**放在 globalThis 上**，不是模块局部变量。
 *
 * 原因：`tools/lib/` 的 import 带了 `?v=<mtime>` 版本号（为让热刷生效），
 * 于是每改一次本文件就会产生一个**新的模块实例**。若名单是模块局部的，
 * 改一次 lib 就把已登记的盯梢对象全丢了。放 globalThis 上跨实例共享。
 */
const WATCHING_KEY = Symbol.for('dsh-qqbot.session-watch.watching');
const watching = (globalThis[WATCHING_KEY] ??= new Map()); // childSessionId -> { parentAgentId, label, lastText, seen, firedAt }

/** 回灌钩子总开关。false = 正常挂 `session/event` 监听。 */
const HOOK_DISABLED = false;

/** 监听只装一次（跨模块实例去重）；handler 指针让新实例能立刻接管旧监听。 */
const HOOK_KEY = Symbol.for('dsh-qqbot.session-watch.hook');
const HANDLER_KEY = Symbol.for('dsh-qqbot.session-watch.handler');
let hooked = false;

/**
 * turn/end 的 data.reason → 人话。
 * 口径来自 webui 的两条文案（dsh-client-ui-chat/lib/client.js）：
 *   "message.turnProcess.worked" = 已完成   ← 正常跑完
 *   "message.stopped"            = 已停止   ← 被停止/中断
 * 宿主在 index.js:912 把 event.data.reason 记进 inflight.endReason，webui 据此显示。
 */
function reasonText(reason) {
  const r = String(reason ?? '').toLowerCase();
  if (!r) return '结束';
  if (/stop|abort|cancel|interrupt|halt/.test(r)) return '已停止';
  if (/complet|done|finish|success|ok/.test(r)) return '已完成';
  if (/error|fail/.test(r)) return '出错';
  return r; // 未知取值就原样带出来，便于以后补映射
}

/**
 * `notice` 摘要行的长度上限，与宿主 `dsh-llm` 的 CONTEXT_SUMMARY_MAX_CHARS 保持一致。
 * 宿主原文注释：producer 的一行说明会写进持久日志，所以要限长。
 */
const CONTEXT_SUMMARY_MAX_CHARS = 120;

/** 把摘要行压到上限内（超出用省略号），口径照抄宿主 dsh-llm 的 boundContextSummary()。 */
function boundContextSummary(summary) {
  const t = String(summary ?? '');
  return t.length <= CONTEXT_SUMMARY_MAX_CHARS ? t : `${t.slice(0, CONTEXT_SUMMARY_MAX_CHARS - 1)}…`;
}

/**
 * 取会话短 id 用于显示。
 * ⚠️ 子会话 id 形如 `session-f147236a-…`，直接 slice(0,8) 只会得到无意义的 `session-`。
 * 所以先剥掉 `session-` 前缀再截断。
 */
export function shortSessionId(id) {
  const s = String(id ?? '');
  return (s.startsWith('session-') ? s.slice(8) : s).slice(0, 8);
}

/**
 * 把 `turn/end` 的 reason 归一成字符串。
 *
 * ⚠️ 2026-10-12 实测：`event.data.reason` **不是字符串而是对象**，形如
 *   `{kind:'completed'}` 或 `{kind:'aborted', reason:{kind:'user'}}`。
 * 旧代码直接 `String(reason)` ⇒ 摘要行里出现 `回合[object object]（reason=[object Object]）`。
 * 本函数优先取最外层的 `kind`，没有就下钻内层 `reason`，都不是才退回 String()。
 */
export function reasonKind(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.kind === 'string' && value.kind) return value.kind;
    if (value.reason !== undefined && value.reason !== value) return reasonKind(value.reason);
    if (typeof value.status === 'string' && value.status) return value.status;
    if (typeof value.stopReason === 'string' && value.stopReason) return value.stopReason;
  }
  return String(value);
}

/**
 * 把各种可能的 content 形状压成纯文本。
 *
 * ★ 2026-10-12 修（主人实测）：**只取 `type === 'text'` 的正文块**。
 *   早先的过滤条件是 `x.type === 'text' || typeof x.text === 'string'` ——
 *   而 **reasoning（思考）块同样带 `.text` 字符串**，于是思考被一起并进来，
 *   回灌的"结尾正文"里冒出一整段英文思考（子会话 3bee83ac 那次实测）。
 *   reasoning / tool-call 等块一律丢弃。
 */
function asText(c) {
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) {
    return c
      .filter((x) => x && x.type === 'text' && typeof x.text === 'string')
      .map((x) => String(x.text))
      .join('\n')
      .trim();
  }
  if (c && typeof c === 'object') {
    if (c.type === 'reasoning') return '';          // 思考块不算正文
    if (typeof c.text === 'string') return String(c.text).trim();
    if (Array.isArray(c.blocks)) return asText(c.blocks);  // 有些版本正文藏在 blocks 里
  }
  return '';
}

/** 从事件里尽力抽正文（assistant/message 的形状随版本变，逐层试） */
function textOf(ev) {
  const cands = [
    ev?.data?.message?.content,
    ev?.data?.content,
    ev?.message?.content,
    ev?.data?.text,
    ev?.text,
    ev?.data?.message?.text,
  ];
  for (const c of cands) {
    const t = asText(c);
    if (t) return t;
  }
  return '';
}

/** 兜底：直接从会话实例取"最后一条助手消息"的正文 */
function lastAssistantText(root, sid) {
  try {
    const sess = root.get('sessions')?.get?.(sid);
    const msgs = sess?.deriveMessages?.() ?? [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i];
      const role = String(m?.role ?? m?.type ?? '');
      if (role.includes('assistant')) {
        const t = asText(m?.content);
        if (t) return t;
      }
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * 注入前的形状自检（fail-closed）。
 *
 * 复刻宿主 v4 的准入条件（dsh-session-persistence-jsonl/lib/worker.cjs）：
 *   ① `agent/inbox/spliced` 的 `inserted[]` 每项必须 `isSessionFormatJsonObject`；
 *   ② 每项的 `source` 必须是对象、`kind` 为非空字符串、且 !== 'plugin'
 *      （源码原文：`format v4 message requires a producer-owned source kind`）。
 *
 * 为什么必须自检而不是交给 inject()：宿主是**先 append 落盘、后读 source.kind** 的顺序。
 * 传进非对象时，坏记录已经写进 `inserted[]`，之后投影抛错 —— 文件从此无法加载。
 * 事故实例：会话 9643a885 的 seq 4222 被写成 `inserted: ["<字符串>"]`，整个会话读不出来。
 */
export function isInjectableMessage(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (typeof m.role !== 'string' || !m.role) return false;
  if (!Array.isArray(m.content) || m.content.length === 0) return false;
  const src = m.source;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return false;
  if (typeof src.kind !== 'string' || !src.kind || src.kind === 'plugin') return false;
  return true;
}

/**
 * 构造一条「子会话结算通知」形状的回灌消息（纯函数，便于单测）。
 *
 * 形状**对齐宿主** dsh-subagent/lib/index.js 的 `createSettlementMessage()`：
 *   source : { kind:'subagent-settled', form:'notice', summary, senderSessionId }
 *   content: [ 摘要行, 结尾正文引导语, ...正文块 ]，role 由 createUserMessage 固定为 'user'
 *
 * 采用宿主形状的三个理由：
 *   ① kind 是宿主自有的 producer-owned 值，不再冒充真人 user 发言；
 *   ② senderSessionId 明确归属到具体子会话，UI 侧归进**子任务**那条通道而不是混进
 *      用户真实发言流里 —— 这与上一轮「回灌插错位置」是同一类隐患；
 *      ⚠️ 更正：dsh-client-ui-chat 的 turnTriggerDetails 里 `subagent-settled` 对应的是
 *      「**子任务状态更新**」（icon subagent）；「收到任务消息」是 `agent-message`。本条注释早先写错；
 *   ③ summary 与宿主同口径（dsh-llm CONTEXT_SUMMARY_MAX_CHARS = 120）。
 *
 * @param {{sessionId?: string, label?: string, rawReason?: string, text?: string}} input
 * @returns 可直接交给 agent.inject() 的完整消息对象
 */
export function buildSettlementNotice(input = {}) {
  const sid = String(input.sessionId ?? '');
  const label = String(input.label ?? '');
  const rawReason = String(input.rawReason ?? '');
  const stage = reasonText(rawReason);
  const summary = boundContextSummary(
    `子会话${label ? '「' + label + '」' : ''} ${shortSessionId(sid)}… 回合${stage}` +
    `${rawReason && rawReason !== stage ? '（reason=' + rawReason + '）' : ''}`,
  );
  return {
    id: (globalThis.crypto?.randomUUID?.() ?? ('inj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))),
    role: 'user',
    content: [
      // ★ 主人 2026-10-12 定：模拟用户消息的**首行直接给出源会话 id**（完整 id）。
      { type: 'text', text: '【来自会话 ' + sid + '】' },
      { type: 'text', text: summary },
      { type: 'text', text: '它的结尾正文：' },
      { type: 'text', text: String(input.text ?? '') },
      { type: 'text', text: '（这是子会话的自动回灌，父会话无需回复。）' },
    ],
    // ★ 2026-10-12 主人定案：回灌**一律模拟用户消息**（source.kind='user'），
    //   不再伪装成子会话结算通知 / 系统消息 / 开发者消息。
    //   理由：那些身份要么被宿主拒收（system/developer 需要 turn+step 且非 JSON 可序列化即被丢），
    //   要么在 UI 上归属混乱；统一成用户消息最简单、最可预期。
    source: { kind: 'user' },
  };
}

async function handler(root, session, event) {
  try {
    const sid = String(session?.id ?? session?.sessionId ?? '');
    const w = sid ? watching.get(sid) : null;
    if (!w) return;
    const type = String(event?.type ?? '');

    // 累积（对应 qqbot 的 noteGenerated）
    if (type === 'assistant/message') {
      const t = textOf(event);
      if (t) w.lastText = t;
      return;
    }
    if (type !== 'turn/end') return;

    // 结算：优先用累积到的那一段；没有再从会话实例兜底取
    let text = w.lastText;
    w.lastText = ''; // ★ 取走即清空：否则"只有工具调用、没有正文"的回合会重复回灌上一回合的正文
    if (!text) text = lastAssistantText(root, sid);
    w.seen = (w.seen ?? 0) + 1;
    w.lastReason = reasonKind(event?.data?.reason ?? event?.data?.status ?? event?.data?.stopReason);
    if (!text) return; // 空回合（只有工具调用/无正文）→ 不回灌
    // ★ 去重：兜底路径可能又取到"上一次已经灌过"的那段正文，内容相同就不再灌第二遍
    if (text === w.lastSent) return;
    w.lastSent = text;

    const agents = root.get('agents');
    const parent = agents?.get?.(w.parentAgentId) ?? null;
    if (!parent) return; // 父不在（不 live）→ 静默跳过，不制造错误

    const rawReason = reasonKind(event?.data?.reason ?? event?.data?.status ?? event?.data?.stopReason);
    const candidate = buildSettlementNotice({ sessionId: sid, label: w.label, rawReason, text });
    if (!isInjectableMessage(candidate)) return; // 自检不过 → 宁可这次不回灌
    try {
      // ★ 2026-10-12 定案（照抄 qqbot 插件的入站模式 —— dist/features/qq-user-questions.js:646）：
      //     「忙时插话、空闲唤醒」
      //       · 父会话**回合进行中(忙)** → `agent.inject`
      //         = 宿主 `send(msg,'next-step',wakeup:false)`：进当前回合的下一个轮次边界，
      //           她本轮就读到了；**不排进"下一回合"队列** ⇒ **不会挂到输入框**。
      //       · 父会话**空闲** → `agent.followup` 唤醒它接着处理。
      //   ⚠️ 之前无论忙闲都用 followup → 忙时落成 `target=next-turn` 排队消息，
      //      前端把它当"待发送输入"显示在输入框上方（主人实测）。这才是那个毛病的根因。
      const busy = (() => {
        try {
          const st = String(parent.status ?? parent.phase ?? '');
          return st !== '' && st !== 'idle';
        } catch { return false; }
      })();
      if (busy) await parent.inject(candidate);   // 插话（不唤醒、不排队、不进输入框）
      else await parent.followup(candidate);      // 空闲 → 唤醒
      w.firedAt = Date.now();
    } catch { /* 注入失败 → 静默；监听里绝不抛，免得影响宿主事件链 */ }
  } catch { /* 监听里绝不抛，免得影响宿主事件链 */ }
}

function installHook(root) {
  if (HOOK_DISABLED) return;

  // ① 把「当前实例的 handler」发布到 globalThis：已装好的那个监听会转发到最新实例，
  //    所以改完 lib 热刷后新代码立刻接管，不必重挂监听。
  globalThis[HANDLER_KEY] = (session, event) => { void handler(root, session, event); };

  // ② 监听全局只装一次。lib 带 mtime 版本号加载，改一次就换一个模块实例；
  //    若各实例各自 root.on 一遍，同一个 turn/end 会被回灌多次。
  if (globalThis[HOOK_KEY]) { hooked = true; return; }
  try {
    // 与 qqbot 的 mc_tell 同款：挂在插件根 ctx 上，事件回调 (session, event)。
    // 注意：回调里通过 globalThis 取 handler，永远调用最新那一版。
    root.on('session/event', (session, event) => {
      const h = globalThis[HANDLER_KEY];
      if (typeof h === 'function') h(session, event);
    });
    globalThis[HOOK_KEY] = true;
    hooked = true;
  } catch { hooked = false; }
}

/**
 * 登记一个"要盯着的子会话"。
 * @returns 人话描述（挂成功/失败原因），不抛错。
 */
export async function register(root, opts = {}) {
  const parentAgentId = String(opts.parentAgentId ?? '').trim();
  const childSessionId = String(opts.childSessionId ?? '').trim();
  const label = String(opts.label ?? '').trim();
  if (!parentAgentId || !childSessionId) return '未挂（缺 parentAgentId 或 childSessionId）';
  if (!root || typeof root.on !== 'function') return '未挂（root 不支持 .on）';
  installHook(root);
  if (HOOK_DISABLED) return '未挂（回灌钩子当前被 HOOK_DISABLED 主动关闭，属预期；恢复见 installHook 注释）';
  if (!hooked) return '未挂（root.on 抛错）';
  watching.set(childSessionId, { parentAgentId, label, lastText: '', seen: 0, firedAt: 0 });
  return `已挂（子=${shortSessionId(childSessionId)}… → 父=${shortSessionId(parentAgentId)}…；回合结束即回灌末段正文）`;
}

/** 给别的工具（如 session_watch 状态查询）读当前盯着的清单 */
export function listWatching() {
  return [...watching.entries()].map(([sid, w]) => ({
    childSessionId: sid,
    shortId: shortSessionId(sid),
    parentAgentId: w.parentAgentId,
    parentShortId: shortSessionId(w.parentAgentId),
    label: w.label,
    hasText: !!w.lastText,
    turnsSeen: w.seen ?? 0,
    lastFiredAt: w.firedAt ?? 0,
  }));
}
