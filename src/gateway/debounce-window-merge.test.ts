/**
 * debounce-window-merge 的回归（2026-10-12）——★ 入站扩展点配套的真 bug
 *
 * 背景（不修的话"入站扩展把 @ 判定压成 false"就是**假动作**）：
 *   · `media-history` 是链上**第 4 步**（在 mentionGate **之前**），它按**平台原始信号**
 *     把这条记进 store，带 `mentioned: true`；
 *   · `debounce` 重建窗口时把 store 条目与窗口条目合并去重。原实现是
 *     `if (e.wasMentioned) hit.wasMentioned = true;` —— **只升不降** ⇒ 入站扩展压下去的 false
 *     被 store 的 mentioned:true 顶回来 ⇒ 静默 3 秒后**照样强制唤醒**，历史行还会带 mentioned
 *     被聚合成 `aggMentioned=true`。
 *   · 现在改成 `hit.wasMentioned = e.wasMentioned === true;` —— **以窗口条目（链上实时判定）为准**。
 *
 * 本文件锁四件事：
 *  ① ★ store mentioned:true + 窗口 wasMentioned:false ⇒ 最终 **false**（这条最重要）；
 *  ② store true + 窗口 true ⇒ 仍 true（真 @ 无回归）；store 无标记 + 窗口 true ⇒ true；
 *  ③ 窗口里没有的条目（不在窗口里，链上判定拿不到）⇒ 保留 store 值；
 *  ④ 原有语义别丢：按 messageId 去重（不重复成两条）、命中时补上窗口条目的原始 msg、
 *     合成消息（空 messageId）不参与去重、结果按服务器时间戳升序。
 */
import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@tencent-connect/qqbot-nodejs';
import { mergeWindowWithStore } from './debounce.js';

/** 造一条 store 历史（`mentioned` 是 media-history 交叉类型塞进去的字段） */
function storeEntry(over: Partial<HistoryEntry> & { mentioned?: boolean }): HistoryEntry {
  return {
    senderId: 'u1',
    content: 'hi',
    timestamp: 1000,
    messageId: 'm1',
    ...over,
  } as HistoryEntry;
}

/** 造一条窗口条目 */
function winEntry(
  over: { msg?: Record<string, unknown>; wasMentioned?: boolean; ts?: number },
): { msg: Record<string, unknown>; wasMentioned: boolean; ts: number } {
  return {
    msg: { messageId: 'm1', content: 'hi', senderId: 'u1' },
    wasMentioned: true,
    ts: 1000,
    ...over,
  };
}

const find = (list: ReturnType<typeof mergeWindowWithStore>, id: string) =>
  list.find((m) => m.messageId === id);

describe('debounce 合并：@ 判定以窗口条目为准（★真 bug 回归）', () => {
  it('store mentioned:true 但窗口 wasMentioned:false ⇒ 最终 false（入站扩展压掉的那种）', () => {
    const merged = mergeWindowWithStore(
      [storeEntry({ messageId: 'm1', mentioned: true })],
      [winEntry({ wasMentioned: false })],
    );
    expect(merged).toHaveLength(1);
    expect(find(merged, 'm1')!.wasMentioned).toBe(false);
  });

  it('真 @：store mentioned:true + 窗口 wasMentioned:true ⇒ 仍 true（无回归）', () => {
    const merged = mergeWindowWithStore(
      [storeEntry({ messageId: 'm1', mentioned: true })],
      [winEntry({ wasMentioned: true })],
    );
    expect(find(merged, 'm1')!.wasMentioned).toBe(true);
  });

  it('store 没标 mentioned，窗口 wasMentioned:true ⇒ true（窗口能把 @ 判定**升**上来）', () => {
    const merged = mergeWindowWithStore(
      [storeEntry({ messageId: 'm1' })],
      [winEntry({ wasMentioned: true })],
    );
    expect(find(merged, 'm1')!.wasMentioned).toBe(true);
  });

  it('窗口里没有这条（不在窗口里，拿不到链上判定）⇒ 保留 store 的值', () => {
    const merged = mergeWindowWithStore(
      [storeEntry({ messageId: 'm1', mentioned: true }), storeEntry({ messageId: 'm2', timestamp: 1001 })],
      [winEntry({ msg: { messageId: 'm9' }, wasMentioned: true, ts: 2000 })],
    );
    expect(find(merged, 'm1')!.wasMentioned).toBe(true);
    expect(find(merged, 'm2')!.wasMentioned).toBe(false);
  });

  it('窗口条目 wasMentioned 缺省/非 boolean ⇒ 一律按 false（不残留 store 的 true）', () => {
    const merged = mergeWindowWithStore(
      [storeEntry({ messageId: 'm1', mentioned: true })],
      [winEntry({ wasMentioned: undefined as unknown as boolean })],
    );
    expect(find(merged, 'm1')!.wasMentioned).toBe(false);
  });
});

describe('debounce 合并：原有语义不变', () => {
  it('同一 messageId 只留一条，且补上窗口条目的原始 msg（附件不重复计）', () => {
    const raw = { messageId: 'm1', content: '看图', attachments: [{ url: 'x' }] };
    const merged = mergeWindowWithStore(
      [storeEntry({ messageId: 'm1', content: '[图片: x]' })],
      [winEntry({ msg: raw, wasMentioned: false })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.msg).toBe(raw);            // 引用相等：窗口的原始 msg 被接了过来
    expect(merged[0]!.content).toBe('[图片: x]'); // store 的折叠文本仍在（历史行用）
  });

  it('空 messageId 的合成消息（如 /资源 求助）不参与去重，两条都在', () => {
    const merged = mergeWindowWithStore(
      [],
      [winEntry({ msg: { messageId: '', content: 'a' }, ts: 1000 }),
       winEntry({ msg: { messageId: '', content: 'b' }, ts: 1001 })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => String(m.msg!.content))).toEqual(['a', 'b']);
    // 合成消息 from 窗口：senderId/senderName 从 msg 提上来（历史行渲染用）
    expect(merged.every((m) => m.wasMentioned === true)).toBe(true);
  });

  it('结果按服务器时间戳升序', () => {
    const merged = mergeWindowWithStore(
      [storeEntry({ messageId: 'old', timestamp: 1000 }), storeEntry({ messageId: 'new', timestamp: 3000 })],
      [winEntry({ msg: { messageId: 'mid' }, ts: 2000, wasMentioned: false })],
    );
    expect(merged.map((m) => m.messageId)).toEqual(['old', 'mid', 'new']);
  });

  it('空窗口 + 空 store ⇒ 空数组（调用方按原逻辑处理）', () => {
    expect(mergeWindowWithStore([], [])).toEqual([]);
  });
});
