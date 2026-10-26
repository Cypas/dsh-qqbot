/**
 * ext-ui.ts — 扩展 UI 卡片（2026-10-26 主人定）
 *
 * 背景：面板（设置页 + 悬浮台）全塞在 `client/qqbot-settings.js` 一个 535KB 手写 bundle 里，
 *   扩展想加自己的界面只能「按字符串锚点往文件里塞代码」—— 社区作者 wuwo1979 就是这么干的
 *   （见 dsh-qqbot-muu 的 add-ext-ui.mjs / add-memory-panel.mjs）。
 *   版本一换锚点就失效，而且只对写补丁的那台机器有效。
 *
 * ── ★ 两个源，各管一种 slot，不许混（2026-10-26 主人纠正）──────────────
 *
 *   slot: settings  = DSH 设置页里那页 → **profile 级**（全 profile 一份）
 *       {PROFILE_ROOT}/.qqbot-extensions/ui/<extId>/
 *       理由：设置页是全局界面，不属于任何工作区。放数据根会「几个工作区就有几份」。
 *
 *   slot: dock      = 悬浮球/悬浮台 → **数据根**（每个机器人实例一份）
 *       {dataRoot}/.qqbot-extensions/ui/<extId>/
 *       理由：悬浮球本来就是「按工作区判断」的，一个实例一个。
 *
 *   扩展包内 ui/ 跟着包走：包在数据根下 → 视为实例级（只收 dock）。
 *
 * ⚠️ `ui/` **不是第七个扩展点**：另外六个 kind 都是 `.mjs` 模块、扫完要 `import()`；
 *    `ui/` 是静态资源，只登记路径，绝不 import（否则会试图 import 一个 .html 直接报错）。
 *
 * 元信息写在 card.html 顶部注释里（前 2KB 内）：
 *
 *   <!-- qqbot-ui: { "slot": "settings", "title": "本地代答", "order": 10 } -->
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { EXT_PACKS_SUBDIR } from './ext-packs.js';
/** 允许的挂载点 */
export const EXT_UI_SLOTS = ['settings', 'dock'];
/** 允许被面板读取的文件名（写死，不接受任意路径） */
export const EXT_UI_FILES = ['card.html', 'card.css', 'card.js'];
/** 扩展 id 白名单（防路径穿越） */
const EXT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** 解析 card.html 顶部的 `<!-- qqbot-ui: {...} -->` */
function parseMeta(html) {
    try {
        const head = html.slice(0, 2048); // 只看前 2KB
        const m = head.match(/<!--\s*qqbot-ui:\s*(\{[\s\S]*?\})\s*-->/);
        if (!m)
            return {};
        const j = JSON.parse(m[1] ?? '{}');
        return j && typeof j === 'object' ? j : {};
    }
    catch {
        return {};
    }
}
/**
 * 扫一个 `ui/` 目录。
 *
 * @param allowSlots 只收这些 slot —— profile 源只收 settings，数据根源只收 dock，防止两边重复
 */
function scanOneUiRoot(uiRoot, from, pack, allowSlots, out) {
    let names = [];
    try {
        if (!existsSync(uiRoot))
            return;
        names = readdirSync(uiRoot);
    }
    catch {
        return;
    }
    for (const extId of names) {
        if (!EXT_ID_RE.test(extId))
            continue; // 名字不合法 → 跳过（防穿越）
        const dir = join(uiRoot, extId);
        try {
            if (!statSync(dir).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        const htmlPath = join(dir, 'card.html');
        if (!existsSync(htmlPath))
            continue; // 必须有 card.html
        let html = '';
        try {
            html = readFileSync(htmlPath, 'utf8');
        }
        catch {
            continue;
        }
        const meta = parseMeta(html);
        const slotRaw = String(meta.slot ?? 'settings').trim();
        const slot = EXT_UI_SLOTS.includes(slotRaw)
            ? slotRaw
            : 'settings';
        if (!allowSlots.includes(slot))
            continue; // 放错源 → 静默跳过（不报错，免得用户困惑）
        const orderNum = Number(meta.order);
        const files = EXT_UI_FILES.filter((f) => existsSync(join(dir, f)));
        out.push({
            extId,
            dir,
            from,
            ...(pack ? { pack } : {}),
            slot,
            title: String(meta.title ?? '').trim() || extId,
            order: Number.isFinite(orderNum) ? orderNum : 100,
            files,
        });
    }
}
/**
 * 列出所有扩展 UI 卡片。任何异常都安全跳过，绝不抛。
 *
 * @param dataRoot     插件数据根（每个机器人实例一份）→ 只收 slot=dock
 * @param profileRoot  DSH profile 根（全 profile 一份）→ 只收 slot=settings
 */
export function listExtUi(dataRoot, profileRoot) {
    const out = [];
    const seen = new Set();
    const push = (info) => {
        if (seen.has(info.extId))
            return; // 同名先到先得
        seen.add(info.extId);
        out.push(info);
    };
    // ① profile 级：只收 slot=settings
    if (profileRoot) {
        const found = [];
        scanOneUiRoot(join(profileRoot, '.qqbot-extensions', 'ui'), 'profile', undefined, ['settings'], found);
        found.forEach(push);
    }
    // ② 数据根：只收 slot=dock
    {
        const found = [];
        scanOneUiRoot(join(dataRoot, '.qqbot-extensions', 'ui'), 'data', undefined, ['dock'], found);
        found.forEach(push);
    }
    // ③ 扩展包内：跟着包走，包在数据根下 ⇒ 实例级 ⇒ 只收 dock
    const packsRoot = join(dataRoot, EXT_PACKS_SUBDIR);
    let packs = [];
    try {
        if (existsSync(packsRoot))
            packs = readdirSync(packsRoot);
    }
    catch {
        packs = [];
    }
    for (const pack of packs) {
        const uiRoot = join(packsRoot, pack, 'ui');
        if (!existsSync(uiRoot))
            continue;
        const found = [];
        scanOneUiRoot(uiRoot, 'pack', pack, ['dock'], found);
        found.forEach(push);
    }
    out.sort((a, b) => a.order - b.order || a.extId.localeCompare(b.extId));
    return out;
}
/**
 * 读一个扩展 UI 文件。
 *
 * 三重防护：
 *   ① extId 白名单正则 + 必须是 listExtUi 里真实存在的
 *   ② fileName 只允许 card.html / card.css / card.js
 *   ③ 拼完 resolve 再校验仍在所属目录内（防 `..` 穿越）
 */
export function readExtUiFile(dataRoot, profileRoot, extId, fileName) {
    if (!EXT_ID_RE.test(String(extId ?? '')))
        return { ok: false, reason: 'extId 不合法' };
    if (!EXT_UI_FILES.includes(fileName)) {
        return { ok: false, reason: '只允许 card.html / card.css / card.js' };
    }
    const hit = listExtUi(dataRoot, profileRoot).find((x) => x.extId === extId);
    if (!hit)
        return { ok: false, reason: '没有这个扩展 UI（没扫到 card.html，或 slot 放错了源）' };
    const target = resolve(hit.dir, fileName);
    if (!target.startsWith(resolve(hit.dir) + sep))
        return { ok: false, reason: '路径越界' };
    try {
        if (!existsSync(target))
            return { ok: false, reason: '文件不存在' };
        return { ok: true, path: target, text: readFileSync(target, 'utf8') };
    }
    catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
}
//# sourceMappingURL=ext-ui.js.map