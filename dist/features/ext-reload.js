/**
 * 由 middleware-setup 注册：重扫扩展目录并重建命令表（含基础命令）
 *
 * ★★ 2026-10-27 修（主人实测：3 号机敲 /tools-reload，日志却记在 2 号机名下）：
 *   原来是**模块级单例** `let reloader`，两个实例各 apply 一次 → 后 apply 的覆盖前一个
 *   ⇒ 任何实例执行热刷，实际重载的都是"最后注册的那个实例"的命令表。
 *   这是维护手册 §11.24「跨模块实例可见的状态绝不能存模块级变量」的同一个坑。
 *   改成按 dataRoot 分开存，各刷各的。
 */
const reloaders = new Map();
/** 归一化 dataRoot 作 key（Windows 大小写/斜杠不敏感） */
function rlKey(dataRoot) {
    return String(dataRoot || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}
/** 注册/注销重建器（注销传 undefined；插件重载时调用方会覆盖为新的） */
export function registerExtCommandReloader(dataRoot, fn) {
    const k = rlKey(dataRoot);
    if (!k)
        return;
    if (fn)
        reloaders.set(k, fn);
    else
        reloaders.delete(k);
}
/**
 * 热重载扩展命令。
 * 返回 `{ error }` 表示"没装成"（比如插件还没启动完），由调用方决定怎么提示 —— 不抛错，
 * 因为热刷的主职是刷工具，命令刷不动也不该把整次热刷弄失败。
 */
export async function reloadExtCommands(dataRoot) {
    const k = rlKey(dataRoot);
    // 不传 dataRoot 时退回"唯一那个"（单实例场景仍能工作）
    const fn = k ? reloaders.get(k) : (reloaders.size === 1 ? Array.from(reloaders.values())[0] : undefined);
    if (!fn) {
        return { error: `扩展命令表尚未注册(插件还没完成启动? dataRoot=${k || '(未传)'}, 已注册 ${reloaders.size} 个)` };
    }
    try {
        return await fn();
    }
    catch (err) {
        return { error: `扩展命令重载失败: ${err instanceof Error ? err.message : String(err)}` };
    }
}
/** 给回执文本用：把重载结果拼成一句人话（工具热刷的 summary 会带上它） */
export function describeExtCommandReload(r) {
    if ('error' in r)
        return `扩展命令: ${r.error}`;
    if (r.names.length === 0)
        return '扩展命令: 0 个(目录里没有 commands/*.js?)';
    return `扩展命令: ${r.names.length} 个已重载 → ${r.names.map((n) => '/' + n).join(', ')}`;
}
/** 由 middleware-setup 注册：重扫入站扩展目录并原地换掉生效列表 */
let inboundReloader;
/** 注册/注销入站扩展重载器（注销传 undefined；插件重建时调用方会覆盖为新的） */
export function registerExtInboundReloader(fn) {
    inboundReloader = fn;
}
/**
 * 热重载入站扩展。
 * 返回 `{ error }` 表示"没装成"（比如插件还没启动完）—— 不抛错，理由同 {@link reloadExtCommands}。
 */
export async function reloadExtInbound() {
    if (!inboundReloader)
        return { error: '入站扩展表尚未注册(插件还没完成启动?)' };
    try {
        return await inboundReloader();
    }
    catch (err) {
        return { error: `入站扩展重载失败: ${err instanceof Error ? err.message : String(err)}` };
    }
}
/** 给回执文本用：把入站扩展重载结果拼成一句人话 */
export function describeExtInboundReload(r) {
    if ('error' in r)
        return `入站扩展: ${r.error}`;
    if (r.count === 0)
        return '入站扩展: 0 个(目录里没有 inbound/*.mjs?)';
    return `入站扩展: ${r.count} 个已重载 → ${r.names.join(', ')}`;
}
/** 当前是否已注册入站扩展重载器（诊断用） */
export function hasExtInboundReloader() {
    return typeof inboundReloader === 'function';
}
/** 由 middleware-setup 注册：重扫出站扩展目录并原地换掉生效列表 */
let outboundReloader;
/** 注册/注销出站扩展重载器（注销传 undefined；插件重建时调用方会覆盖为新的） */
export function registerExtOutboundReloader(fn) {
    outboundReloader = fn;
}
/** 热重载出站扩展；返回 `{ error }` 表示"没装成"，理由同 {@link reloadExtCommands} —— 不抛错 */
export async function reloadExtOutbound() {
    if (outboundReloader) {
        try {
            return await outboundReloader();
        }
        catch (err) {
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
    }
    catch (err) {
        return { error: `出站扩展重载失败: ${err instanceof Error ? err.message : String(err)}` };
    }
}
/** 给回执文本用：把出站扩展重载结果拼成一句人话 */
export function describeExtOutboundReload(r) {
    if ('error' in r)
        return `出站扩展: ${r.error}`;
    if (r.count === 0)
        return '出站扩展: 0 个(目录里没有 outbound/*.mjs?)';
    return `出站扩展: ${r.count} 个已重载 → ${r.names.join(', ')}`;
}
/** 当前是否已注册出站扩展重载器（诊断用） */
export function hasExtOutboundReloader() {
    return typeof outboundReloader === 'function';
}
//# sourceMappingURL=ext-reload.js.map