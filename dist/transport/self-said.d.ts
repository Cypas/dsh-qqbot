/** 每个会话最多留多少条（越新越靠后） */
export declare const SELF_SAID_MAX = 300;
export interface SelfSaidItem {
    /** QQ 的 msg_id（引用/撤回都用它） */
    id: string;
    /** 发出去的文本（原样存，匹配用归一化后的副本） */
    t: string;
    /** 发送时间（epoch ms） */
    at: number;
}
export declare function selfSaidFile(dataRoot: string, scope: string, peerId: string): string;
/** 记住一条自己发出的消息（发送成功后调用；没 id 或没文本就跳过）。 */
export declare function rememberSelfSaid(dataRoot: string, scope: string, peerId: string, msgId: string, text: string): void;
export interface SelfSaidHit {
    id: string;
    t: string;
    at: number;
    /** 打分路线的覆盖率（精确命中固定 1） */
    cover: number;
    /** exact | score */
    mode: 'exact' | 'score';
}
/**
 * 按文字找"自己说过的那条"：精确优先 → 覆盖率打分（相关 × 新鲜）→ 都不达标返回 undefined。
 */
export declare function findSelfSaid(dataRoot: string, scope: string, peerId: string, query: string, now?: number): SelfSaidHit | undefined;
//# sourceMappingURL=self-said.d.ts.map