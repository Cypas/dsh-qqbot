/**
 * ext-reload 的回归（2026-10-12）。
 * 锁四件事：① 没注册时返回 error 而不抛错（热刷主职是刷工具，不能被命令拖垮）；
 * ② 注册后按注册的重建器执行并回传命令名；③ 0 个命令有专门文案；④ 重建器抛错被收敛成 error 文本。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { describeExtCommandReload, registerExtCommandReloader, reloadExtCommands } from './ext-reload.js';

describe('扩展命令热重载注册表', () => {
  beforeEach(() => { registerExtCommandReloader(undefined); });

  it('没注册时 → 返回 error，不抛错', async () => {
    const r = await reloadExtCommands();
    expect('error' in r).toBe(true);
    expect(describeExtCommandReload(r)).toContain('尚未注册');
  });

  it('注册后 → 走重建器并回传命令名', async () => {
    registerExtCommandReloader(async () => ({ names: ['hello', 'mclink'] }));
    const r = await reloadExtCommands();
    expect(r).toEqual({ names: ['hello', 'mclink'] });
    expect(describeExtCommandReload(r)).toBe('扩展命令: 2 个已重载 → /hello, /mclink');
  });

  it('0 个命令 → 文案点出目录里没有', async () => {
    registerExtCommandReloader(async () => ({ names: [] }));
    expect(describeExtCommandReload(await reloadExtCommands())).toContain('0 个');
  });

  it('重建器抛错 → 收敛成 error 文本，不冒泡', async () => {
    registerExtCommandReloader(async () => { throw new Error('boom'); });
    const r = await reloadExtCommands();
    expect('error' in r).toBe(true);
    expect('error' in r ? r.error : '').toContain('boom');
  });
});
