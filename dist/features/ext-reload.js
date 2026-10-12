/** 由 middleware-setup 注册：重扫扩展目录并重建命令表（含基础命令） */
let reloader;
/** 注册/注销重建器（注销传 undefined；插件重载时调用方会覆盖为新的） */
export function registerExtCommandReloader(fn) {
    reloader = fn;
}
/**
 * 热重载扩展命令。
 * 返回 `{ error }` 表示"没装成"（比如插件还没启动完），由调用方决定怎么提示 —— 不抛错，
 * 因为热刷的主职是刷工具，命令刷不动也不该把整次热刷弄失败。
 */
export async function reloadExtCommands() {
    if (!reloader)
        return { error: '扩展命令表尚未注册(插件还没完成启动?)' };
    try {
        return await reloader();
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
//# sourceMappingURL=ext-reload.js.map