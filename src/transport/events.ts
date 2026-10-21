/**
 * 出站事件解析 — 将 dsh session/event 归一化为强类型
 *
 * 原始事件（ctx.on('session/event') 回调参数）是弱类型：
 *   { type: string, data: Record<string, unknown> }
 * 这里把可识别的事件解析为 discriminated union，未知类型或字段缺失返回 undefined。
 */

/** 原始 dsh 事件（弱类型，来自 ctx.on('session/event')） */
export interface RawSessionEvent {
  type: string;
  data: Record<string, unknown>;
}

/** turn/end 事件的 reason 结构（兼容 error/failure/顶层 message 三种形态） */
export interface TurnEndReason {
  kind?: string;
  error?: { message?: string; code?: string };
  failure?: { message?: string; code?: string };
  message?: string;
  code?: string;
}

/** assistant/chunk 事件（仅保留 text-delta） */
export interface ChunkEvent {
  type: 'assistant/chunk';
  text: string;
}

/** assistant/message 事件 */
export interface MessageEvent {
  type: 'assistant/message';
  content: Array<{ type: string; text?: string }>;
  /**
   * 本条的思考(reasoning 块拼接; 无思考或空壳块时 undefined)。
   *
   * 2026-09-13 加: 观察期**只作留档**, 不参与任何判定, 也绝不出站(详见 features/thinking-log.ts)。
   */
  reasoning?: string;
  /** dsh 回合号(思考与正文配对用: 同一 turn+step 才是"同一时刻格") */
  turn?: number;
  /** 回合内步号 */
  step?: number;
  /** 模型上报的思考 token 数(usage.reasoningTokens) */
  reasoningTokens?: number;
}

/** tool/call 事件 */
export interface ToolCallEvent {
  type: 'tool/call';
  callId: string;
  name: string;
  arguments: string;
}

/** tool/result 事件 */
export interface ToolResultEvent {
  type: 'tool/result';
  callId: string;
  error?: { name: string; code: string };
  /** 原始 data 透传给 presenter 做结构化展示 */
  raw: Record<string, unknown>;
}

/** turn/end 事件 */
export interface TurnEndEvent {
  type: 'turn/end';
  reason: TurnEndReason;
}

/** 出站事件联合类型 */
export type OutboundEvent =
  | ChunkEvent
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnEndEvent;

/**
 * 解析原始事件为强类型
 *
 * 未知类型或缺失关键字段时返回 undefined，由调用方直接跳过。
 */
export function parseEvent(raw: RawSessionEvent): OutboundEvent | undefined {
  switch (raw.type) {
    case 'assistant/chunk': {
      const chunk = (raw.data as { chunk?: { type?: string; text?: string } }).chunk;
      if (chunk === undefined || chunk.type !== 'text-delta' || !chunk.text) return undefined;
      return { type: 'assistant/chunk', text: chunk.text };
    }

    case 'assistant/message': {
      const data = raw.data as {
        turn?: unknown;
        step?: unknown;
        message?: { content?: Array<{ type: string; text?: string }> };
        usage?: { reasoningTokens?: unknown };
      };
      const message = data.message;
      if (message === undefined || !Array.isArray(message.content)) return undefined;
      // 思考(2026-09-13): content 里的 reasoning 块; 空壳块(只有 thinkingSignature)无 text → 判空跳过。
      const reasoning = message.content
        .filter((b) => b?.type === 'reasoning' && typeof b.text === 'string' && b.text.trim() !== '')
        .map((b) => b.text as string)
        .join('\n');
      return {
        type: 'assistant/message',
        content: message.content,
        reasoning: reasoning === '' ? undefined : reasoning,
        turn: typeof data.turn === 'number' ? data.turn : undefined,
        step: typeof data.step === 'number' ? data.step : undefined,
        reasoningTokens: typeof data.usage?.reasoningTokens === 'number' ? data.usage.reasoningTokens : undefined,
      };
    }

    case 'tool/call': {
      const data = raw.data as { callId?: string; name?: string; arguments?: string };
      if (!data.callId || !data.name) return undefined;
      return { type: 'tool/call', callId: data.callId, name: data.name, arguments: data.arguments ?? '' };
    }

    case 'tool/result': {
      const data = raw.data as { message?: { source?: { callId?: string } }; error?: { name: string; code: string } };
      const callId = data.message?.source?.callId;
      if (!callId) return undefined;
      return { type: 'tool/result', callId, error: data.error, raw: raw.data };
    }

    case 'turn/end': {
      const reason = (raw.data as { reason?: TurnEndReason }).reason ?? {};
      return { type: 'turn/end', reason };
    }

    default:
      return undefined;
  }
}

/**
 * 从 turn/end reason 提取错误信息
 *
 * 兼容三种形态：error（新格式）、failure（旧格式）、顶层 message/code（最旧格式）。
 */
export function extractTurnError(reason: TurnEndReason): { code: string; message: string } | undefined {
  if (reason.kind !== 'error') return undefined;

  const detail = reason.error ?? reason.failure;
  return {
    code: detail?.code ?? reason.code ?? 'UNKNOWN',
    message: detail?.message ?? reason.message ?? 'unknown error',
  };
}

// ── agent/assistant-stream 瞬态流式帧（宿主 v2+；2026-10-20 对齐上游 c8b9158） ──
//   ⚠️ 背景：老的 durable `assistant/chunk` 在宿主 agent-loop 重构后**不再产生**，
//   只监听它 ⇒ 流式永远收不到帧，回复只能整块发。
export type StreamDelta =
  | { kind: 'attempt-start'; attemptId: string }
  | { kind: 'text-delta'; attemptId: string; text: string }
  | { kind: 'reasoning-delta'; attemptId: string; text: string };

/**
 * 解析宿主 `agent/assistant-stream` 的 payload（{ agent: { id }, frame }）。
 * 只认 start / chunk(text-delta)，其余帧（reasoning/tool-call/finish/end）一律忽略。
 */
export function parseStreamFrame(raw: unknown): { agentId: string; delta: StreamDelta } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as { agent?: { id?: unknown }; frame?: unknown };
  const agentId = typeof o.agent?.id === 'string' ? o.agent.id : '';
  if (!agentId) return undefined;
  const f = o.frame as { type?: unknown; attemptId?: unknown; chunk?: unknown } | null;
  if (!f || typeof f !== 'object') return undefined;
  const attemptId = typeof f.attemptId === 'string' ? f.attemptId : '';
  if (!attemptId) return undefined;
  if (f.type === 'start') return { agentId, delta: { kind: 'attempt-start', attemptId } };
  if (f.type === 'chunk') {
    const ch = f.chunk as { type?: unknown; text?: unknown } | null;
    if (ch && ch.type === 'text-delta' && typeof ch.text === 'string' && ch.text !== '') {
      return { agentId, delta: { kind: 'text-delta', attemptId, text: ch.text } };
    }
    if (ch && ch.type === 'reasoning-delta' && typeof ch.text === 'string' && ch.text !== '') {
      return { agentId, delta: { kind: 'reasoning-delta', attemptId, text: ch.text } };
    }
  }
  return undefined;
}
