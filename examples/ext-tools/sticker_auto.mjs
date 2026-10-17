/**
 * sticker_auto.mjs — 【扩展工具】开关「自动配表情包」（2026-10-16 主人定）
 *
 * 配套：出站扩展 `outbound/sticker-semantic.mjs`（它读这里的开关决定要不要自动配图）。
 * 安装：两个文件分别放到
 *   `{数据根}/.qqbot-extensions/tools/sticker_auto.mjs`
 *   `{数据根}/.qqbot-extensions/outbound/sticker-semantic.mjs`
 * 然后 `tools_reload`（工具立即生效；出站扩展也一起热刷，见 /tools-reload 回执里的"出站扩展: N 个"）。
 *
 * 用法（AI 侧）：
 *   sticker_auto {action:'status'}   // 看现在开没开
 *   sticker_auto {action:'on'}       // 开：之后她回复时会自动挑一张表情包
 *   sticker_auto {action:'off'}      // 关
 *   sticker_auto {action:'toggle'}   // 反转
 *
 * 状态文件（两个扩展共用的那份）：
 *   `{数据根}/.qqbot-extensions/data/auto-sticker.json` → `{ "enabled": true|false, "updatedAt": 毫秒 }`
 *   —— 文件不存在 = 按示范扩展里的 `CONFIG.DEFAULT_ENABLED`（默认开）。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TOOL = 'sticker_auto';

/** 与 outbound/sticker-semantic.mjs 约定的状态文件 */
function stateFile(dataRoot) {
  return join(String(dataRoot || ''), '.qqbot-extensions', 'data', 'auto-sticker.json');
}

function readState(dataRoot) {
  try {
    const f = stateFile(dataRoot);
    if (!existsSync(f)) return { exists: false, enabled: undefined };
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return { exists: true, enabled: typeof j?.enabled === 'boolean' ? j.enabled : undefined, raw: j };
  } catch {
    return { exists: false, enabled: undefined };
  }
}

function writeState(dataRoot, enabled) {
  const f = stateFile(dataRoot);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ enabled: !!enabled, updatedAt: Date.now() }, null, 2), 'utf8');
  return f;
}

export default {
  name: TOOL,
  description:
    '开关「自动配表情包」：on=开启（她回复时会按正文语义自动挑一张表情包发出，先被动后主动通道）/ ' +
    'off=关闭 / toggle=反转 / status=查看当前状态。开关是全局的（所有群生效），状态存在数据根下两个扩展共用。',
  inputSchema: {
    action: { type: 'string', required: true, description: "on=开启；off=关闭；toggle=反转；status=查看" },
  },

  async run(args, env) {
    const action = String(args?.action ?? 'status').trim().toLowerCase();
    const dataRoot = String(env?.dataRoot ?? '');
    if (!dataRoot) {
      return { ok: false, msg: '拿不到数据根（env.dataRoot 为空），无法读写开关文件' };
    }

    const cur = readState(dataRoot);
    const enabled = cur.exists ? !!cur.enabled : true; // 文件不存在 ⇒ 与示范扩展的默认值保持一致（默认开）

    if (action === 'status') {
      return {
        ok: true,
        msg:
          `自动配表情包：**${enabled ? '已开启' : '已关闭'}**` +
          (cur.exists ? '' : '（还没有状态文件，用的是默认值「开」）') +
          `\n状态文件：${stateFile(dataRoot)}`,
      };
    }

    let next;
    if (action === 'on') next = true;
    else if (action === 'off') next = false;
    else if (action === 'toggle') next = !enabled;
    else return { ok: false, msg: `不认识的 action：${action}（用 on / off / toggle / status）` };

    try {
      writeState(dataRoot, next);
    } catch (err) {
      return { ok: false, msg: `写开关失败：${err instanceof Error ? err.message : String(err)}` };
    }
    return {
      ok: true,
      msg: `自动配表情包已**${next ? '开启' : '关闭'}**` + (next ? '（下一条回复起生效）' : '（她不再自动配图）'),
    };
  },
};
