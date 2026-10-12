/**
 * debounce × forceWake 的回归（2026-10-12）—— 入站扩展「强制入站」的**第三环**
 *
 * 背景：`ctx.forceWake()` 写的是 `ctx.state.qqInboundForceWake`，而群消息在链上会被
 * **debounce（延迟聚合）**吞进窗口，flush 时**新建一个 state** 交给 `handleInbound` ——
 * 上游挂在 ctx.state 上的东西不显式带下去就丢了。丢了会怎样：
 *   · 群冷却（freeIntervalSec）那一关照旧把这条压在窗口里等着 → "强制入站"变成"等 90 秒再说"；
 *   · `inbound.ts` 的价值评分读到的是 undefined → 低分照样被拦（forceWake 白写）。
 *
 * 本文件锁两件事（真跑 debounceLayer，只把 handleInbound 换成探针）：
 *  ① forceWake 的条目 ⇒ **群冷却中照样派发**，且 `state.qqInboundForceWake === true` 传到了下游；
 *  ② 对照：没有 forceWake ⇒ 冷却中**不派发**（窗口保留、等冷却结束）—— 零回归。
 */
import { describe, expect, it, vi } from 'vitest';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';

/** 探针：记录 handleInbound 收到的 state（vi.mock 工厂里只能引用 vi.hoisted 的东西） */
const h = vi.hoisted(() => ({ calls: [] as Array<{ state: Record<string, unknown> }> }));

vi.mock('../transport/inbound.js', () => ({
  handleInbound: async (
    _msg: unknown, _manager: unknown, _config: unknown, _logger: unknown, state?: Record<string, unknown>,
  ) => {
    h.calls.push({ state: state ?? {} });
  },
}));

const { debounceLayer } = await import('./debounce.js');

/** 最小 config（只放 debounce 真正读到的字段） */
function makeConfig(): Record<string, unknown> {
  return {
    appId: 'APPID',
    historyLimit: 20,
    cwd: process.cwd(),
    behavior: {
      freeIntervalSec: 60,                     // 群冷却 60 秒
      debounce: { enabled: true, silenceSec: 0.05, maxMsgs: 10, mentionDelayed: true },
    },
  };
}

/** 最小 manager：不忙、没有会话 */
function makeManager(): Record<string, unknown> {
  return { findByPeer: () => undefined };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function makeCtx(
  message: Record<string, unknown>,
  state: Record<string, unknown> = {},
): MiddlewareContext {
  const ac = new AbortController();
  let stopped = false;
  return {
    bot: { appId: 'APPID' } as unknown,
    message,
    replyTarget: {},
    state,
    log: logger,
    stop() { stopped = true; },
    get stopped() { return stopped; },
    get stopReason() { return undefined; },
    signal: ac.signal,
    abort() { stopped = true; ac.abort(); },
    get aborted() { return ac.signal.aborted; },
    receivedAt: Date.now(),
  } as unknown as MiddlewareContext;
}

function groupMsg(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'group',
    groupOpenid: 'g1',
    senderId: 'u1',
    senderName: '群友',
    messageId: 'm1',
    content: '救命',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('debounce × forceWake（强制入站必须真的能进站）', () => {
  it('forceWake ⇒ 群冷却中照样派发，且把标记带进 handleInbound 的 state', async () => {
    h.calls.length = 0;
    const cooldownAt = new Map<string, number>();
    cooldownAt.set('g1', Date.now());            // ← 刚刚派发过一次，正处在 60s 群冷却里
    const layer = debounceLayer(makeConfig() as never, makeManager() as never, logger, cooldownAt);
    let nextCalled = 0;
    const ctx = makeCtx(groupMsg(), { qqInboundForceWake: true, qqInboundForceWakeReason: '求助关键词' });

    await layer(ctx, async () => { nextCalled += 1; });
    expect(nextCalled).toBe(0);                  // 消息被窗口吞了（延迟聚合，正常）
    await sleep(150);                            // 等静默窗口过去 → flush

    expect(h.calls.length).toBe(1);              // ★ 冷却中照样派发了
    expect(h.calls[0]!.state.qqInboundForceWake).toBe(true);   // ★ 标记传到了下游
  });

  it('对照：没有 forceWake ⇒ 冷却中**不派发**（窗口保留，等冷却结束）', async () => {
    h.calls.length = 0;
    const cooldownAt = new Map<string, number>();
    cooldownAt.set('g1', Date.now());
    const layer = debounceLayer(makeConfig() as never, makeManager() as never, logger, cooldownAt);
    const ctx = makeCtx(groupMsg({ messageId: 'm2' }), {});

    await layer(ctx, async () => { /* 窗口吞掉 */ });
    await sleep(150);

    expect(h.calls.length).toBe(0);              // 冷却中不派发（与改动前一致）
  });

  it('没有冷却时（forceWake 与否都该派发）：标记照旧传下去', async () => {
    h.calls.length = 0;
    const layer = debounceLayer(makeConfig() as never, makeManager() as never, logger, new Map<string, number>());
    const ctx = makeCtx(groupMsg({ messageId: 'm3' }), { qqInboundForceWake: true });

    await layer(ctx, async () => { /* 窗口吞掉 */ });
    await sleep(150);

    expect(h.calls.length).toBe(1);
    expect(h.calls[0]!.state.qqInboundForceWake).toBe(true);
  });
});
