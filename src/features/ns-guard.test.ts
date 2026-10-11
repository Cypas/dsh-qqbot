/**
 * settingsNs 冲突探测的回归（2026-10-11，起因：web/desktop 凭据互相覆盖）。
 * 这里锁的行为：① 只认"启用中"的实例；② 没写 settingsNs 的实例算默认槽；③ insert 形态也要认。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_NS, describeNsConflict, scanNsOwners, settingsNsOfPatch } from './ns-guard.js';

const PATCH_WEB = `# web profile
- id: im-qqbot
  config:
    appId: '1111'
  disabled: true

- insert:
    - id: im-qqbot-2
      name: '@zaofan/dsh-qqbot'
      config:
        appId: '1905515836'
        settingsNs: 'im-qqbot-2'
        preset: 'whale-girl'
`;

const PATCH_DESKTOP = `- id: im-qqbot-2
  name: '@zaofan/dsh-qqbot'
  config:
    appId: '1905708994'
    settingsNs: 'im-qqbot-2'
    preset: 'standard'

- id: some-other-plugin
  name: '@someone/other'
  config:
    settingsNs: 'im-qqbot-2'
`;

const PATCH_DISABLED_SAME_NS = `- id: im-qqbot-2
  name: '@zaofan/dsh-qqbot'
  config:
    settingsNs: 'im-qqbot-2'
  disabled: true
`;

const PATCH_NO_NS = `- id: im-qqbot-2
  name: '@zaofan/dsh-qqbot'
  config:
    appId: '1905515836'
`;

describe('settingsNsOfPatch — 从 patch 文本里认启用中的实例槽名', () => {
  it('web 形态（insert 嵌套）→ 认出 im-qqbot-2，且不把别的插件的槽名算进来', () => {
    expect(settingsNsOfPatch(PATCH_WEB)).toEqual(['im-qqbot-2']);
  });

  it('desktop 形态（顶层行）→ 认出 im-qqbot-2；别的插件的同名槽不算', () => {
    expect(settingsNsOfPatch(PATCH_DESKTOP)).toEqual(['im-qqbot-2']);
  });

  it('整行 disabled → 不占用设置槽', () => {
    expect(settingsNsOfPatch(PATCH_DISABLED_SAME_NS)).toEqual([]);
  });

  it('没写 settingsNs → 落默认槽（默认槽撞车同样会互相覆盖）', () => {
    expect(settingsNsOfPatch(PATCH_NO_NS)).toEqual([DEFAULT_NS]);
  });
});

describe('scanNsOwners — 扫 profiles 目录找出同一个槽的挂载者', () => {
  it('两个 profile 挂同一个 ns → 两个都报出来', () => {
    const home = mkdtempSync(join(tmpdir(), 'ns-guard-'));
    for (const [name, text] of [['web', PATCH_WEB], ['desktop', PATCH_DESKTOP]] as const) {
      mkdirSync(join(home, 'profiles', name), { recursive: true });
      writeFileSync(join(home, 'profiles', name, 'cordis.patch.yml'), text, 'utf8');
    }
    expect(scanNsOwners(home, 'im-qqbot-2')).toEqual(['desktop', 'web']);
    expect(scanNsOwners(home, 'im-qqbot-9')).toEqual([]);
  });

  it('只有一处挂载（另一处 disabled）→ 只报一个（不误报）', () => {
    const home = mkdtempSync(join(tmpdir(), 'ns-guard-'));
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true });
    mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true });
    writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), PATCH_WEB, 'utf8');
    writeFileSync(join(home, 'profiles', 'desktop', 'cordis.patch.yml'), PATCH_DISABLED_SAME_NS, 'utf8');
    expect(scanNsOwners(home, 'im-qqbot-2')).toEqual(['web']);
  });

  it('目录不存在 / 文件读不了 → 返回空，绝不抛错（自检不能把启动搞挂）', () => {
    expect(scanNsOwners(join(tmpdir(), 'no-such-home-' + Date.now()), 'im-qqbot-2')).toEqual([]);
  });
});

describe('describeNsConflict — 告警要带判据与修法', () => {
  it('点出所有挂载者、本实例所在 profile、以及三种后果与修法', () => {
    const s = describeNsConflict({
      ns: 'im-qqbot-2',
      owners: ['desktop', 'web'],
      myProfile: 'web',
      settingsFile: 'C:\\Users\\x\\.dsh\\qqbot-settings\\im-qqbot-2.json',
    });
    expect(s).toContain('"desktop"');
    expect(s).toContain('"web"');
    expect(s).toContain('appId/appSecret');
    expect(s).toContain('后连的会顶掉先连的');
    expect(s).toContain('settingsNs');
    expect(s).toContain('im-qqbot-2-desktop');
  });
});
