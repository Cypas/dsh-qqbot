import { type MdMediaTarget } from './md-media.js';
/** bootstrap 里注册：返回一个带 token 的 API 句柄（任一本即可） */
export declare function setMaterialTargetFactory(fn: (() => MdMediaTarget | undefined) | undefined): void;
/**
 * 扫描文本里的 markdown 图片；本地路径的替换成 qqbot-media 引用。
 * 失败时保留原样（宁可在 QQ 里显示成路径文字，也不要吞掉正文）。
 */
export declare function rewriteLocalMarkdownImages(text: string): Promise<string>;
//# sourceMappingURL=md-media-rewrite.d.ts.map