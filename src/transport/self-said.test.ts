/**
 * 自发言台账的回归（2026-10-11，配合 `[rfself:文字]`）。
 * 锁三件事：① 精确优先且取最近；② 非逐字时按覆盖率打分；③ 覆盖率不够就**返回 undefined**（宁可不引用，也不乱指）。
 * ⚠️ 这里只用词法，绝不引入本地小模型（主人明确：小模型不是通用的）。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SELF_SAID_MAX, findSelfSaid, rememberSelfSaid, selfSaidFile } from './self-said.js';

const root = (): string => mkdtempSync(join(tmpdir(), 'self-said-'));

describe('自发言台账 — [rfself] 的词法匹配', () => {
  it('精确命中：够长的查询逐字包含 → mode=exact', () => {
    const d = root();
    rememberSelfSaid(d, 'group', 'g1', 'ID_A', '今天的晚饭是咖喱饭，记得热一下再吃');
    rememberSelfSaid(d, 'group', 'g1', 'ID_B', '明天要早点起床');
    const hit = findSelfSaid(d, 'group', 'g1', '晚饭是咖喱饭');
    expect(hit?.id).toBe('ID_A');
    expect(hit?.mode).toBe('exact');
  });

  it('同文本说过多次 → 取最近那条', () => {
    const d = root();
    rememberSelfSaid(d, 'group', 'g1', 'OLD', '这句话我说过一遍了');
    rememberSelfSaid(d, 'group', 'g1', 'NEW', '这句话我说过一遍了');
    expect(findSelfSaid(d, 'group', 'g1', '我说过一遍')?.id).toBe('NEW');
  });

  it('非逐字但片段覆盖率高 → 走打分（mode=score）', () => {
    const d = root();
    rememberSelfSaid(d, 'group', 'g1', 'ID_C', '（1）先重启 DSH；（2）再在设置页保存一次。');
    const hit = findSelfSaid(d, 'group', 'g1', '先重启再在设置页保存');
    expect(hit?.id).toBe('ID_C');
    expect(hit?.mode).toBe('score');
  });

  it('覆盖率不足 / 台账为空 → undefined（宁缺毋滥，绝不乱指一条）', () => {
    const d = root();
    expect(findSelfSaid(d, 'group', 'g1', '随便什么内容')).toBeUndefined();
    rememberSelfSaid(d, 'group', 'g1', 'ID_D', '完全无关的内容：今天天气不错');
    expect(findSelfSaid(d, 'group', 'g1', '量子力学里的薛定谔方程')).toBeUndefined();
  });

  it('同一 msg_id 不重复记', () => {
    const d = root();
    rememberSelfSaid(d, 'group', 'g1', 'SAME', '只算一条');
    rememberSelfSaid(d, 'group', 'g1', 'SAME', '只算一条');
    const raw = JSON.parse(readFileSync(selfSaidFile(d, 'group', 'g1'), 'utf8')) as { items: unknown[] };
    expect(raw.items.length).toBe(1);
  });

  it('超过上限只留最近 SELF_SAID_MAX 条（老的查不到、新的能查到）', () => {
    const d = root();
    for (let i = 0; i < SELF_SAID_MAX + 5; i++) {
      rememberSelfSaid(d, 'group', 'g1', `ID_${i}`, `第${i}条自言自语，编号${i}号`);
    }
    const raw = JSON.parse(readFileSync(selfSaidFile(d, 'group', 'g1'), 'utf8')) as { items: unknown[] };
    expect(raw.items.length).toBe(SELF_SAID_MAX);
    expect(findSelfSaid(d, 'group', 'g1', `编号${SELF_SAID_MAX + 4}号`)?.id).toBe(`ID_${SELF_SAID_MAX + 4}`);
    expect(findSelfSaid(d, 'group', 'g1', '编号0号')).toBeUndefined(); // 最老那条已被裁掉
  });

  it('空 msg_id / 空文本 / 空 dataRoot → 不记也不炸', () => {
    const d = root();
    rememberSelfSaid(d, 'group', 'g1', '', '没有 id');
    rememberSelfSaid(d, 'group', 'g1', 'ID_X', '   ');
    rememberSelfSaid('', 'group', 'g1', 'ID_Y', '没有 dataRoot');
    expect(findSelfSaid(d, 'group', 'g1', '没有 id')).toBeUndefined();
  });
});
