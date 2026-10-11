/** 没写 settingsNs 时的默认槽名（必须与 index.ts / session-manager 的取值一致） */
export declare const DEFAULT_NS = "im-qqbot";
/** 从一份 patch 文本里取「启用中的本插件实例」所用的 settingsNs（去重）。 */
export declare function settingsNsOfPatch(txt: string): string[];
/**
 * 扫 `{DSH_HOME}/profiles/<name>/cordis.patch.yml`，列出挂载了 targetNs 的 profile 名（已排序）。
 * 只读；任何一步失败都当作"没扫到" —— 自检绝不能反过来把启动搞挂。
 */
export declare function scanNsOwners(dshHome: string, targetNs: string): string[];
/** 生成告警文案（日志与设置页共用；含判据与修法，别只说"有冲突"）。 */
export declare function describeNsConflict(opts: {
    ns: string;
    owners: string[];
    myProfile?: string;
    settingsFile?: string;
}): string;
//# sourceMappingURL=ns-guard.d.ts.map