/**
 * md-media-rewrite.ts — 出站自动把「本地图片 markdown」换成 QQ 的 qqbot-media 引用（2026-10-21）
 *
 * 主人口径：
 *   正文里直接写 `![说明](D:/path/x.jpg)`（或带尺寸 `![说明](D:/path/x.jpg "width=320")`），
 *   **发到 QQ 时自动**：上传 → 解析宽高 → 改写成 `![说明 #W #H](qqbot-media://image/v1/...)`；
 *   配额满 100 张时**自动删最早的一张**再传。
 *
 * 只处理**本地路径**（`D:\` / `D:/` / `file://` / `/abs`）；http(s) 与已是 qqbot-media 的原样放过。
 */
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { uploadMarkdownImage, listMarkdownImages, deleteMarkdownImage } from './md-media.js';
/** 诊断：~/.dsh/md-media-diag.log（出站自动传图的排查用） */
function diag(msg) {
    try {
        appendFileSync(join(homedir(), '.dsh', 'md-media-diag.log'), new Date().toISOString() + ' ' + msg + String.fromCharCode(10));
    }
    catch { /* ignore */ }
}
let targetFactory;
/** bootstrap 里注册：返回一个带 token 的 API 句柄（任一本即可） */
export function setMaterialTargetFactory(fn) {
    targetFactory = fn;
}
const IMG_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const MAX_IMAGES = 100;
function isLocalImagePath(u) {
    if (!u)
        return false;
    if (/^(https?:|qqbot-media:|data:)/i.test(u))
        return false;
    if (/^file:\/\//i.test(u))
        return true;
    if (/^[A-Za-z]:[\\/]/.test(u))
        return true; // D:\ 或 D:/
    if (u.startsWith('/'))
        return true; // POSIX 绝对路径
    return false;
}
function fromFileUrl(u) {
    try {
        const p = decodeURIComponent(u.replace(/^file:\/\/\/?/i, ''));
        // /D:/x -> D:/x
        return /^\/[A-Za-z]:\//.test(p) ? p.slice(1) : p;
    }
    catch {
        return u.replace(/^file:\/\/\/?/i, '');
    }
}
/** 配额保护：超过 100 张就删最早的（按 created_at 升序） */
async function ensureQuota(target, need) {
    let deleted = 0;
    for (let guard = 0; guard < 20; guard++) {
        const r = await listMarkdownImages(target);
        if (!r.ok)
            return deleted;
        const d = (r.data ?? {});
        const list = Array.isArray(d.images) ? d.images : [];
        const total = Number(d.total ?? list.length);
        if (total + need <= MAX_IMAGES)
            return deleted;
        const oldest = list
            .filter((x) => typeof x.image_id === 'string' && x.image_id)
            .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0))[0];
        if (!oldest || !oldest.image_id)
            return deleted;
        const del = await deleteMarkdownImage(target, String(oldest.image_id));
        if (!del.ok)
            return deleted;
        deleted += 1;
    }
    return deleted;
}
/**
 * 扫描文本里的 markdown 图片；本地路径的替换成 qqbot-media 引用。
 * 失败时保留原样（宁可在 QQ 里显示成路径文字，也不要吞掉正文）。
 */
export async function rewriteLocalMarkdownImages(text) {
    if (!text || text.indexOf('![') < 0)
        return text;
    const target = targetFactory?.();
    if (!target) {
        diag('no target（没有注册 groupAdmin 句柄）');
        return text;
    }
    const matches = [];
    IMG_RE.lastIndex = 0;
    let m;
    while ((m = IMG_RE.exec(text)) !== null) {
        const alt = String(m[1] ?? '');
        const src = String(m[2] ?? '');
        if (isLocalImagePath(src))
            matches.push({ raw: m[0], alt, src });
    }
    if (matches.length === 0) {
        diag('![ found but no local path matched');
        return text;
    }
    diag('matched ' + matches.length + ' local image(s): ' + matches.map((x) => x.src).join(' | '));
    // 配额够不够（需要传几张）
    await ensureQuota(target, matches.length);
    let out = text;
    for (const item of matches) {
        const path = /^file:\/\//i.test(item.src) ? fromFileUrl(item.src) : item.src;
        try {
            const up = await uploadMarkdownImage(target, path);
            if (!up.ok || !up.url) {
                diag('upload fail: ' + path + ' -> ' + String(up.msg || ''));
                continue;
            }
            diag('uploaded: ' + path + ' -> ' + String(up.url).slice(0, 60));
            const dim = up.width && up.height ? ' #' + up.width + 'px #' + up.height + 'px' : '';
            const alt = item.alt || (path.split(/[\\/]/).pop() ?? 'image');
            const replaced = '![' + alt + dim + '](' + String(up.url) + ')';
            out = out.split(item.raw).join(replaced);
        }
        catch {
            /* 单张失败不影响其它 */
        }
    }
    return out;
}
//# sourceMappingURL=md-media-rewrite.js.map