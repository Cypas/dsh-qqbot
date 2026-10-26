/** 允许的挂载点 */
export declare const EXT_UI_SLOTS: readonly ["settings", "dock"];
export type ExtUiSlot = (typeof EXT_UI_SLOTS)[number];
/** 允许被面板读取的文件名（写死，不接受任意路径） */
export declare const EXT_UI_FILES: readonly ["card.html", "card.css", "card.js"];
export type ExtUiFile = (typeof EXT_UI_FILES)[number];
export interface ExtUiInfo {
    /** 扩展 id（= 目录名） */
    extId: string;
    /** 目录绝对路径 */
    dir: string;
    /** 来源：profile = profile 级；data = 数据根；pack = 扩展包内 */
    from: 'profile' | 'data' | 'pack';
    /** 扩展包目录名（from=pack 时有） */
    pack?: string;
    slot: ExtUiSlot;
    title: string;
    order: number;
    /** 实际存在哪些文件 */
    files: ExtUiFile[];
}
/**
 * 列出所有扩展 UI 卡片。任何异常都安全跳过，绝不抛。
 *
 * @param dataRoot     插件数据根（每个机器人实例一份）→ 只收 slot=dock
 * @param profileRoot  DSH profile 根（全 profile 一份）→ 只收 slot=settings
 */
export declare function listExtUi(dataRoot: string, profileRoot?: string): ExtUiInfo[];
export interface ExtUiFileResult {
    ok: boolean;
    path?: string;
    text?: string;
    reason?: string;
}
/**
 * 读一个扩展 UI 文件。
 *
 * 三重防护：
 *   ① extId 白名单正则 + 必须是 listExtUi 里真实存在的
 *   ② fileName 只允许 card.html / card.css / card.js
 *   ③ 拼完 resolve 再校验仍在所属目录内（防 `..` 穿越）
 */
export declare function readExtUiFile(dataRoot: string, profileRoot: string | undefined, extId: string, fileName: string): ExtUiFileResult;
//# sourceMappingURL=ext-ui.d.ts.map