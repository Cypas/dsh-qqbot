/**
 * 唤醒.mjs —— /唤醒 扩展命令：手动词醒鲸鱼娘（2026-10-16 主人需求）
 *
 * 需求原文：
 *   「私聊不能@，给私聊环境加一个强制唤醒的方式？可以弄个扩展斜杠指令 /唤醒，
 *     作用就是发送一条『用户呼唤你』」
 *
 * 机理（走插件既有的合成消息通道，**不新增插件能力**）：
 *   扩展命令 handler 的返回值里带 `{ wake: { content, senderName? } }`，插件会在
 *   `dist/gateway/middleware-setup.js` 里把这条合成消息交给**聚合层**唤醒 AI：
 *
 *     const wk = result?.wake
 *     if ((k0 === 'group' || k0 === 'c2c') && pid) injectSynthetic(k0, pid, wText, { senderName: wk?.senderName }, manager)
 *
 *   ⇒ c2c(私聊) 与群聊都支持；合成消息与真人消息**同窗口聚合**（人多时合并成一回合，省 token）；
 *     它**不伪造 @**（正文里不写 (@you)，避免污染主人的交互记忆）。
 *
 * 用法：
 *   /唤醒                 → 用默认文案叫醒她（"用户在呼唤你"）
 *   /唤醒 在吗            → 把「在吗」当成用户在呼唤她
 *   /唤醒 帮我看看这个     → 同上，正文会带上呼唤者昵称与原文
 *
 * ⚠️ 命令文件改完/新增后需要 `tools_reload`（面板 /tools-reload）热刷；
 *    若热刷不生效，重启一次宿主即可（扩展命令有两条加载路径，见 会话列表.mjs 文件头注释）。
 */

/** 合成消息的前缀 —— 让 AI 一眼看出这是"用户在呼唤"而不是普通群聊 */
const WAKE_PREFIX = '[用户呼唤]';

/** 默认呼唤文案 */
const DEFAULT_SAY = '用户在呼唤你';

export default {
  name: ['唤醒', 'wake', 'huanxing'],
  description: '强制唤醒: /唤醒 [要说的话] —— 把这句话当作"用户在呼唤你"送进会话（私聊没有 @，用它代替）',
  usage: '/唤醒 [要说的话]',

  async handler(ctx) {
    // raw 可能是「/唤醒 在吗」也可能是「在吗」（不同加载路径给的形状不同）→ 两种都吃掉
    let say = String(ctx?.command?.raw ?? '').trim();
    say = say.replace(/^\/?\s*(唤醒|wake|huanxing)\s*/i, '').trim();
    if (!say) say = DEFAULT_SAY;

    const isGroup = String(ctx?.message?.kind ?? '') === 'group';
    const who = String(ctx?.message?.senderName ?? '').trim() || (isGroup ? '群友' : '主人');
    const where = isGroup ? '群里' : '私聊里';

    return {
      kind: 'text',
      // 给发送者看的回执（很短，避免刷屏）
      content: `🔔 叫醒她啦～「${say.slice(0, 40)}」`,
      // ★ 交给聚合层唤醒 AI 的合成消息
      wake: {
        content: `${WAKE_PREFIX} ${who} 在${where}呼唤你：${say}`,
        senderName: who,
      },
    };
  },
};
