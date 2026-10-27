/**
 * ext-reload.ts — 扩展命令的「热重载注册表」（2026-10-12 主人定）
 *
 * 起因：扩展命令表在 `middleware-setup` 里是**启动时加载一次**、塞进闭包里的 `cmdMap`，
 *   于是改完 `.qqbot-extensions/commands/*.js` 必须**重启插件**才生效；
 *   而扩展工具（`tools/`）早就能热刷 —— 同一套扩展机制、两套待遇，不对。
 *
 * 做法：`middleware-setup` 把"重建命令表"的函数注册到这里；
 *   任何热刷入口（斜杠 `/tools-reload`、工具 `tools_reload`、dock 面板热刷…）都会经过
 *   `SessionManager.reloadAllChannelTools()` —— 在那里顺带调用本模块，
 *   **命令与工具就一起热重载**，无需再新增入口，也不会漏掉某个入口。
 *
 * 为什么用注册表而不是直接 import：
 *   命令表活在 `middleware-setup` 的闭包里（每个 bot 实例一份），
 *   `SessionManager` 拿不到它，也不该反向依赖 gateway 层 —— 注册表是最轻的解耦方式。
 *
 * ⚠️ 与扩展工具一致的纪律：cache-bust 用文件 mtime（见 extension-store 的 fileVersion），
 *   改过的文件才会重新 import；没改的复用缓存，不会因反复热刷吃内存。
 */
export interface ExtCommandReloadResult {
  /** 本次加载到的扩展命令名（去重后，便于回执里展示） */
  names: string[];
}

/**
 * 由 middleware-setup 注册：重扫扩展目录并重建命令表（含基础命令）
 *
 * ★★ 2026-10-27 修（主人实测：3 号机敲 /tools-reload，日志却记在 2 号机名下）：
 *   原来是**模块级单例** `let reloader`，两个实例各 apply 一次 → 后 apply 的覆盖前一个
 *   ⇒ 任何实例执行热刷，实际重载的都是"最后注册的那个实例"的命令表。
 *   这是维护手册 §11.24「跨模块实例可见的状态绝不能存模块级变量」的同一个坑。
 *   改成按 dataRoot 分开存，各刷各的。
 */
const reloaders = new Map<string, () => Promise<ExtCommandReloadResult>>();

/** 归一化 dataRoot 作 key（Windows 大小写/斜杠不敏感） */
function rlKey(dataRoot: string | undefined): string {
  return String(dataRoot || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 注册/注销重建器（注销传 undefined；插件重载时调用方会覆盖为新的） */
export function registerExtCommandReloader(
  dataRoot: string | undefined,
  fn: (() => Promise<ExtCommandReloadResult>) | undefined,
): void {
  const k = rlKey(dataRoot);
  if (!k) return;
  if (fn) reloaders.set(k, fn);
  else reloaders.delete(k);
}

/**
 * 热重载扩展命令。
 * 返回 `{ error }` 表示"没装成"（比如插件还没启动完），由调用方决定怎么提示 —— 不抛错，
 * 因为热刷的主职是刷工具，命令刷不动也不该把整次热刷弄失败。
 */
export async function reloadExtCommands(dataRoot?: string): Promise<ExtCommandReloadResult | { error: string }> {
  const k = rlKey(dataRoot);
  // 不传 dataRoot 时退回"唯一那个"（单实例场景仍能工作）
  const fn = k ? reloaders.get(k) : (reloaders.size === 1 ? Array.from(reloaders.values())[0] : undefined);
  if (!fn) {
    return { error: `扩展命令表尚未注册(插件还没完成启动? dataRoot=${k || '(未传)'}, 已注册 ${reloaders.size} 个)` };
  }
  try {
    return await fn();
  } catch (err) {
    return { error: `扩展命令重载失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 给回执文本用：把重载结果拼成一句人话（工具热刷的 summary 会带上它） */
export function describeExtCommandReload(r: ExtCommandReloadResult | { error: string }): string {
  if ('error' in r) return `扩展命令: ${r.error}`;
  if (r.names.length === 0) return '扩展命令: 0 个(目录里没有 commands/*.js?)';
  return `扩展命令: ${r.names.length} 个已重载 → ${r.names.map((n) => '/' + n).join(', ')}`;
}

// ══════════════════════════════════════════════════════════════
// 入站中间件扩展（第五套扩展，2026-10-12）—— 同一套热重载入口，同一个理由
// ══════════════════════════════════════════════════════════════
//   `{dataRoot}/.qqbot-extensions/inbound/*.mjs` 挂在 SDK 中间件链上（见 gateway/middleware-setup.ts），
//   挂的是"现读可变列表"的代理 ⇒ 热重载只需**重扫目录 + 原地换列表**，不用重挂中间件。
//   注册表放这里而不是 ext-inbound.ts 自己调，是因为"热刷入口"只有一个：
//   `/tools-reload` / `tools_reload` → SessionManager.reloadAllChannelTools() → 本模块。
//   （卸载时由 ext-inbound 的 disposeInboundExtensions 把这里清空，避免指向已死实例。）

/** 一次入站扩展重载的结果（回执/日志用） */
export interface ExtInboundReloadResult {
  /** 本次装载到的扩展数 */
  count: number;
  /** 扩展展示名（去重前，便于回执里展示） */
  names: string[];
}

/** 由 middleware-setup 注册：重扫入站扩展目录并原地换掉生效列表 */
let inboundReloader: (() => Promise<ExtInboundReloadResult>) | undefined;

/** 注册/注销入站扩展重载器（注销传 undefined；插件重建时调用方会覆盖为新的） */
export function registerExtInboundReloader(fn: (() => Promise<ExtInboundReloadResult>) | undefined): void {
  inboundReloader = fn;
}

/**
 * 热重载入站扩展。
 * 返回 `{ error }` 表示"没装成"（比如插件还没启动完）—— 不抛错，理由同 {@link reloadExtCommands}。
 */
export async function reloadExtInbound(): Promise<ExtInboundReloadResult | { error: string }> {
  if (!inboundReloader) return { error: '入站扩展表尚未注册(插件还没完成启动?)' };
  try {
    return await inboundReloader();
  } catch (err) {
    return { error: `入站扩展重载失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 给回执文本用：把入站扩展重载结果拼成一句人话 */
export function describeExtInboundReload(r: ExtInboundReloadResult | { error: string }): string {
  if ('error' in r) return `入站扩展: ${r.error}`;
  if (r.count === 0) return '入站扩展: 0 个(目录里没有 inbound/*.mjs?)';
  return `入站扩展: ${r.count} 个已重载 → ${r.names.join(', ')}`;
}

/** 当前是否已注册入站扩展重载器（诊断用） */
export function hasExtInboundReloader(): boolean {
  return typeof inboundReloader === 'function';
}

// ══════════════════════════════════════════════════════════════
// 出站中间件扩展（第六套扩展，2026-10-16 主人定）—— 同一套热重载入口，同一个理由
// ══════════════════════════════════════════════════════════════
//   `{dataRoot}/.qqbot-extensions/outbound/*.mjs` 由 `transport/outbound-buffer.ts` 的
//   `sendRichOutbound` 在**发送前**调 `runOutboundChain` 生效，链本身读模块级 `loaded` 列表
//   ⇒ 热重载只需**重扫目录 + 原地换列表**，不用重挂任何东西。
//   注册表放这里（而不是让 ext-outbound 自己调），理由与入站完全一致：
//   热刷入口只有一个 —— `/tools-reload` / `tools_reload` → `SessionManager.reloadAllChannelTools()`。

/** 一次出站扩展重载的结果（回执/日志用） */
export interface ExtOutboundReloadResult {
  /** 本次装载到的扩展数 */
  count: number;
  /** 扩展展示名（便于回执里展示） */
  names: string[];
}

/** 由 middleware-setup 注册：重扫出站扩展目录并原地换掉生效列表 */
let outboundReloader: (() => Promise<ExtOutboundReloadResult>) | undefined;

/** 注册/注销出站扩展重载器（注销传 undefined；插件重建时调用方会覆盖为新的） */
export function registerExtOutboundReloader(fn: (() => Promise<ExtOutboundReloadResult>) | undefined): void {
  outboundReloader = fn;
}

/** 热重载出站扩展；返回 `{ error }` 表示"没装成"，理由同 {@link reloadExtCommands} —— 不抛错 */
export async function reloadExtOutbound(): Promise<ExtOutboundReloadResult | { error: string }> {
  if (outboundReloader) {
    try {
      return await outboundReloader();
    } catch (err) {
      return { error: `出站扩展重载失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  // ★ 2026-10-16：没注册也能用 —— ext-outbound 自己 `configureOutboundExtensions()` 过就直接装载。
  //   这样不必再往 `gateway/middleware-setup.ts`（一个很大的启动函数）里塞注册回调，
  //   出站扩展的装载点收敛在它自己模块内；注册表仍保留（谁想接管就注册）。
  try {
    const { reloadOutboundExtensions } = await import('./ext-outbound.js');
    const r = await reloadOutboundExtensions();
    return { count: r.total, names: r.extensions.map((e) => e.name) };
  } catch (err) {
    return { error: `出站扩展重载失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 给回执文本用：把出站扩展重载结果拼成一句人话 */
export function describeExtOutboundReload(r: ExtOutboundReloadResult | { error: string }): string {
  if ('error' in r) return `出站扩展: ${r.error}`;
  if (r.count === 0) return '出站扩展: 0 个(目录里没有 outbound/*.mjs?)';
  return `出站扩展: ${r.count} 个已重载 → ${r.names.join(', ')}`;
}

/** 当前是否已注册出站扩展重载器（诊断用） */
export function hasExtOutboundReloader(): boolean {
  return typeof outboundReloader === 'function';
}
