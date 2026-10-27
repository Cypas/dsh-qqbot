/**
 * deliverables.test.ts — `deliverables/presented` 事件解析（2026-10-27）
 *
 * 契约（对齐上游 c28cc4b / 宿主 dsh-tool-present）：
 *   · data = { turn: number, callId: string, files: [{ path, description? }] }
 *   · path 由宿主解析成**绝对路径**后写入；turn/callId 缺一不可
 *   · 任一条目瘦弱（path 空/非字符串）→ 整条事件作废（宁可不发，也别发错文件）
 */
import { describe, expect, it } from 'vitest';
import { parseEvent } from './events.js';
import { stripDeliveredFileMarkers } from './outbound.js';

function parseDeliverables(data: Record<string, unknown>) {
  return parseEvent({ type: 'deliverables/presented', data });
}

describe('parseEvent — deliverables/presented', () => {
  it('解析单文件（描述可省）', () => {
    const ev = parseDeliverables({
      turn: 7,
      callId: 'call_1',
      files: [{ path: 'C:\\Users\\x\\Desktop\\a.txt', description: '摘要' }],
    });
    expect(ev?.type).toBe('deliverables/presented');
    const d = ev as Extract<typeof ev, { type: 'deliverables/presented' }>;
    expect(d.turn).toBe(7);
    expect(d.callId).toBe('call_1');
    expect(d.files).toEqual([{ path: 'C:\\Users\\x\\Desktop\\a.txt', description: '摘要' }]);
  });

  it('多文件按顺序保留', () => {
    const d = parseDeliverables({
      turn: 1,
      callId: 'c',
      files: [{ path: '/a/1.png' }, { path: '/a/2.png', description: '第二张' }],
    }) as Extract<ReturnType<typeof parseDeliverables>, { type: 'deliverables/presented' }>;
    expect(d.files.map((f) => f.path)).toEqual(['/a/1.png', '/a/2.png']);
    expect(d.files[1].description).toBe('第二张');
  });

  it('缺 turn / callId → undefined', () => {
    expect(parseDeliverables({ callId: 'c', files: [{ path: '/a' }] })).toBeUndefined();
    expect(parseDeliverables({ turn: 1, files: [{ path: '/a' }] })).toBeUndefined();
  });

  it('files 为空或非数组 → undefined', () => {
    expect(parseDeliverables({ turn: 1, callId: 'c', files: [] })).toBeUndefined();
    expect(parseDeliverables({ turn: 1, callId: 'c', files: 'x' })).toBeUndefined();
  });

  it('任一条目 path 非法 → 整条作废', () => {
    expect(parseDeliverables({ turn: 1, callId: 'c', files: [{ path: '/a' }, { path: '' }] })).toBeUndefined();
    expect(parseDeliverables({ turn: 1, callId: 'c', files: [{ path: '/a' }, null] })).toBeUndefined();
  });
});

/**
 * present 直发 + 正文 [MEDIA:file] 双写 → 只发一次（2026-10-27）
 * 真实场景：模型先 present 声明，又在正文尾巴补一句 [MEDIA:file|同一路径]。
 */
describe('stripDeliveredFileMarkers — 交付物去重', () => {
  const key = 'd:/desk/a.txt';

  it('同路径标记被剔除，其余文字保留', () => {
    const out = stripDeliveredFileMarkers('给你啦 [MEDIA:file|D:\\desk\\a.txt]', new Set([key]), undefined);
    expect(out).toBe('给你啦');
  });

  it('斜杠方向/盘符大小写差异仍算同一文件', () => {
    const out = stripDeliveredFileMarkers('[MEDIA:file|d:/DESK/A.TXT] 收好', new Set([key]), undefined);
    expect(out).toBe('收好');
  });

  it('不同路径不动', () => {
    const text = '[MEDIA:file|D:\\desk\\b.txt]';
    expect(stripDeliveredFileMarkers(text, new Set([key]), undefined)).toBe(text);
  });

  it('本回合没 present 过 → 原样返回', () => {
    const text = '[MEDIA:file|D:\\desk\\a.txt]';
    expect(stripDeliveredFileMarkers(text, undefined, undefined)).toBe(text);
    expect(stripDeliveredFileMarkers(text, new Set(), undefined)).toBe(text);
  });

  it('非 file 类媒体标记不受影响', () => {
    const text = '[MEDIA:image|D:\\desk\\a.png]';
    expect(stripDeliveredFileMarkers(text, new Set([key]), undefined)).toBe(text);
  });
});
