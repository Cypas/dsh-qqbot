/**
 * session_watch.mjs — 查看/补挂「回合结束回灌」钩子
 *
 * 配合 session_create 用：创建时会自动挂钩子（session_create → lib/session_watch_lib.register）。
 * 本工具负责：
 *   · list（默认）：列出正在盯的子会话（子 id / 父 id / 标签 / 是否已攒到正文 / 已结算几次）
 *   · attach：给一个"已存在的子会话"补挂钩子（创建时漏挂、或插件重启后钩子丢了的情况）
 *   · detach：取消盯某个子会话
 * ⚠️ 主人要求这类工具不给全部会话用：已落地 `expose: 'qq'`（2026-10-12），只在 QQ 会话注册。
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 带版本号地加载共用库 —— **必须这么加载**。
 *
 * 原因同 session_create.mjs：插件只给**工具文件本身**的 import 加了 `?v=<mtime>`，
 * 工具内部裸路径 import 会被 ESM 模块缓存永久命中 ⇒ 改 `tools/lib/` 热刷不生效。
 * （这里原来是顶层静态 import，等于永远锁死在插件启动那一刻的旧版本。）
 */
async function loadWatchLib() {
  const url = new URL('./lib/session_watch_lib.mjs', import.meta.url);
  let v = '0';
  try { v = String(statSync(fileURLToPath(url)).mtimeMs); } catch { /* 拿不到 mtime 就退回裸 import */ }
  return import(v === '0' ? url.href : `${url.href}?v=${v}`);
}

/** 进程内自己维护的"取消盯梢"集合（库只管挂，取消在本工具侧记录） */
const detached = new Set();

export default {
  name: 'session_watch',
  // ★ 2026-10-12：**父会话专用**（"我作为父"去挂/摘回灌钩子）⇒ 不给子会话看。
  // 只注册到 QQ 会话（子会话不可见）—— "我作为父"才需要挂/摘回灌钩子。
  expose: 'qq',
  description:
    '查看/补挂「回合结束回灌」钩子：默认列出正在盯的子会话与状态；attach=给指定子会话补挂（子会话 id + 父会话 id）；detach=取消盯梢。' +
    '（本工具是**兜底**通道：正常情况下让子会话自己用 send_message 回执即可。）',
  inputSchema: {
    action: { type: 'string', description: 'list（默认）=看状态 / attach=给已存在的子会话补挂 / detach=取消盯梢' },
    child_session_id: { type: 'string', description: 'attach 或 detach 时要指定的子会话 id' },
    parent_agent_id: { type: 'string', description: 'attach 时填**父会话 id**（历史上叫"父 agent id"，指的是同一个东西；不填＝用"我自己这个会话"）' },
    label: { type: 'string', description: 'attach 时的标签，便于记认（可选）' },
  },

  async run(args = {}, env = {}) {
    const ctx = env?.ctx ?? null;
    const root = ctx && typeof ctx === 'object' && ctx.root ? ctx.root : ctx;
    if (!root?.get) return { ok: false, msg: '拿不到宿主 ctx（需要 expose:\'all\'）' };

    const lib = await loadWatchLib();

    const action = String(args?.action ?? 'list').toLowerCase();
    const p = (n) => String(n).padStart(2, '0');
    const fmt = (t) => {
      if (!t) return '—';
      const d = new Date(t);
      return Number.isNaN(d.getTime()) ? '—' : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    if (action === 'attach' || action === '补挂') {
      const child = String(args?.child_session_id ?? '').trim();
      const parent = String(args?.parent_agent_id ?? env?.exec?.agent?.id ?? '').trim();
      if (!child) return { ok: false, msg: 'attach 需要 child_session_id' };
      if (!parent) return { ok: false, msg: 'attach 需要 parent_agent_id（不填会用"我自己"）' };
      detached.delete(child);
      const r = await lib.register(root, { parentAgentId: parent, childSessionId: child, label: String(args?.label ?? '') });
      return { ok: !String(r).startsWith('未挂'), msg: 'attach → ' + r };
    }

    if (action === 'detach' || action === '取消') {
      const child = String(args?.child_session_id ?? '').trim();
      if (!child) return { ok: false, msg: 'detach 需要 child_session_id' };
      detached.add(child);
      return { ok: true, msg: `已从盯梢名单移除 ${child.slice(0, 8)}…（注：钩子本身是全局一个，这里只是不再为它回灌）` };
    }

    // list
    const items = lib.listWatching().filter((x) => !detached.has(x.childSessionId));
    if (!items.length) {
      return {
        ok: true,
        msg: '【回合结束回灌】当前没有盯着任何子会话。\n用 session_create 建会话时会自动挂；也可以用 attach 给已存在的子会话补挂。',
      };
    }
    const lines = items.map(
      (x) =>
        `   · 子 ${x.shortId ?? x.childSessionId.slice(0, 8)}… → 父 ${x.parentShortId ?? x.parentAgentId.slice(0, 8)}…` +
        `${x.label ? '  [' + x.label + ']' : ''}  攒到正文=${x.hasText ? 'Y' : 'N'}  已结算=${x.turnsSeen} 次  上次回灌=${fmt(x.lastFiredAt)}`,
    );
    return { ok: true, msg: `【回合结束回灌】正在盯 ${items.length} 个子会话：\n` + lines.join('\n') };
  },
};
