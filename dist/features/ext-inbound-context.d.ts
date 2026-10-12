/**
 * ext-inbound-context.ts — 挂到中间件 `ctx` 上的「动作 API」（2026-10-12）
 *
 * 用户看到的全部能力就是这些（`examples/ext-inbound/README.md` 里的表与此一一对应）：
 *
 * ```js
 * // ── 消息维（早挂点 onInbound 用）──
 * ctx.annihilate({ reason })      // 消灭这条：不进历史 / 不进上下文 / 不占冷却（内部=不 next）
 * ctx.rewrite({ text, reason })   // 替换文本（必须在记群历史之前生效 ⇒ 早挂点）
 * ctx.forceWake({ reason })       // 强制入站：跳过价值评分 / @门控 / 冷却等"值不值得回"的判断
 * // ── 消息维（晚挂点 onDecide 用）──
 * ctx.decide({ mention: 'ignore' | 'force', reason })
 * // ── 用户维（两个挂点都能用）──
 * ctx.muteUser({ id?, minutes, reason })   // id 缺省 = 当前发送者；写进持久名单
 * ctx.unmuteUser({ id? })
 * ctx.isMuted(id?) / ctx.mutedUsers()      // 读名单（带剩余时间）
 * // ── 通用 ──
 * ctx.text / ctx.scope / ctx.sender / ctx.senderName / ctx.isOwner / ctx.groupId / ctx.mentions
 * ctx.quoted({ text, fromSelf }) / ctx.platform({ mentioned })
 * ctx.logger / ctx.dataRoot
 * ctx.kv.get(key) / ctx.kv.set(key, value)
 * ```
 *
 * ── 四条保命纪律（主人点名）───────────────────────────────────────────────
 *  ① **白名单最高优先**：主人/owner（`config.groupAdmin.owners`）**永不可被静默或消灭** ——
 *     扩展对 owner 调 `annihilate` 会被**拒绝执行**并记一条 warn（消息照常放行）；`muteUser(owner)` 同理。
 *  ② **强唤醒优先于静默**：本模块只保证 `forceWake` **不被别的动作抵消**（`annihilate` 除外——
 *     那是"整条不进站"，两者本就互斥，谁先发生谁生效）；**顺序由扩展自己排**，
 *     文档里写明"求助关键词判断要写在黑名单判断之前"。
 *  ③ **熔断**：破坏性动作（消灭/静默）密度异常 ⇒ 停用该扩展的破坏性动作（消息照常放行）+ 告警。
 *     统计与阈值在 `ext-inbound-state.ts`；这里只负责"问一句、记账、拒绝"。
 *  ④ **审计 + 可撤销**：每个动作落一行 `audit.jsonl`（**文本摘要要截断**）；`muteUser` 能用
 *     `unmuteUser` 解掉。
 *
 * ── 铁律：**任何动作都绝不抛到链上** ────────────────────────────────────────
 * 每个动作整体包在 try/catch 里，出错只 `warn` 并返回 false；ctx 上的属性一律
 * `Object.defineProperty(..., { enumerable: false })` —— 不参与 `{...ctx}` 展开、
 * 不会被 JSON.stringify 抓走（内部命令层就是靠展开 ctx 组 handler 参数的，别去污染它）。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { Logger } from '../types.js';
/** 运行环境（由挂载点/运行器传进来） */
export interface ExtRunEnv {
    /** 数据根：状态文件、审计都落它下面 */
    dataRoot: string;
    /** 主人 openid 白名单（`config.groupAdmin.owners`） */
    owners: string[];
    /** 插件 logger（动作告警用） */
    logger: Logger;
    /** 当前 bot 的 appId（`ctx.platform.mentioned` 的内容兜底扫描要用，与 SDK mentionGate 同款判据） */
    appId?: string;
}
/** 一条消息、一个中间件 ctx 对应的一份扩展会话（早/晚两个挂点共享同一份） */
export interface ExtCtxSession {
    env: ExtRunEnv;
    /** 当前在跑哪个挂点：早 `inbound` / 晚 `decide` */
    phase: 'inbound' | 'decide';
    /** 当前正在执行的扩展（动作归属、审计署名、熔断统计都认它） */
    current?: {
        file: string;
        name: string;
    };
    /** 已请求消灭（读它的地方是运行器的 next 包装：置位后再调 next() 也不会往下走） */
    annihilate?: {
        reason?: string;
    };
    /**
     * 请求过消灭但**被拒**（白名单 / 熔断 / 挂点不允许）。
     *
     * 为什么必须记下来：扩展最常见的写法是
     * ```js
     * if (该消灭) { ctx.annihilate({ reason }); return; }   // 只调动作，不调 next
     * ```
     * 一旦 annihilate 被拒，`return` 仍然会让链停在这一层 —— 等于"插件拒绝了，消息还是被吞了"。
     * 所以运行器看到这个标记时会**替扩展放行**（白名单最高优先 / 熔断后只放行）。
     */
    annihilateRefused?: {
        reason: string;
    };
    /** 已请求强制入站 */
    forceWake?: {
        reason?: string;
    };
    /** 已覆盖 @ 判定 */
    decide?: {
        mention: 'ignore' | 'force';
        reason?: string;
    };
    /** 本消息里 rewrite 过几次（诊断） */
    rewriteCount: number;
    /** 本消息里破坏性动作成功过几次（熔断统计看增量） */
    destructiveCount: number;
    /** 参与记账去重：同一个扩展在同一条消息上（早+晚）只记一次参与 */
    noted: Set<string>;
    /** 已告警过的提示（一次性，防刷屏） */
    warned: Set<string>;
}
/** 取（必要时建）某个 ctx 的扩展会话，并把动作 API 挂上去（幂等） */
export declare function ensureExtSession(ctx: MiddlewareContext, env: ExtRunEnv): ExtCtxSession;
/** 只读会话（没挂过则 undefined） */
export declare function sessionOf(ctx: MiddlewareContext): ExtCtxSession | undefined;
/**
 * 进入某个扩展的执行：设置归属 + 挂点，返回会话。
 * 调用方（运行器）负责在用完之后吞掉异常 —— 本模块的动作自己不会抛。
 */
export declare function enterExtension(ctx: MiddlewareContext, env: ExtRunEnv, ext: {
    file: string;
    name: string;
}, phase: 'inbound' | 'decide'): ExtCtxSession;
//# sourceMappingURL=ext-inbound-context.d.ts.map