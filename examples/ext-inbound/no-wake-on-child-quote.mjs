/**
 * no-wake-on-child-quote.mjs — 示例入站中间件：引用「子会话转发」的消息时不按 @ 处理
 * （2026-10-12 升级：**同时演示早/晚两个挂点**；晚挂点那段逻辑一个字没改）
 *
 * 放在 `{数据根}/.qqbot-extensions/inbound/no-wake-on-child-quote.mjs`
 * （插件启动时会自动铺一份，只补不覆盖）。
 *
 * ── 它解决什么 ──────────────────────────────────────────────────────────────
 * 群里有人把别的会话（子会话）的转发消息**引用**过来，再顺带 @ 一下她 ——
 * 平台信号上这确实是「被 @ 了」，于是：
 *   · 门控放行；· debounce 认为"窗口里有 @" → **绕过群冷却、静默 3 秒后强制唤醒**；
 *   · 上下文里那条还会被标成 `(@you)`、结构化标记 `mentioned:true`。
 * 但那条被引用的原文其实只是「另一个会话的转发内容」，不该因此强行叫醒她 ——
 * 她照常看到这条消息（进历史、进上下文），只是**不按"被点名"处理**（该不该开口交给她自己按守则判断）。
 *
 * ── 两个挂点各干什么（本文件同时演示）──────────────────────────────────────
 *
 * ```
 * … → quoteRef → ★onInbound（早，本文件的 export function onInbound）★
 *   → 引用图预取 → 群历史缓冲 → … → mentionGate（@ 门控）
 *   → ★默认导出 / onDecide（晚，本文件的 export default）★ → contentSanitizer → debounce → …
 * ```
 *
 * | | 早（`onInbound`） | 晚（`export default` / `onDecide`） |
 * |---|---|---|
 * | 能读 | `ctx.message` / `ctx.state.quote` / `ctx.platform.mentioned` | 以上全部 **+ `ctx.state.mention`**（门控判定） |
 * | 能做 | 消灭 · 改写 · 强制入站 · 查/写禁言名单 | 覆盖 @ 判定 · 改写 · 强制入站 · 查/写禁言名单 |
 * | 不能做 | `ctx.decide`（mention 还没写出来） | `ctx.annihilate`（群历史已经记过了，会被拒绝） |
 *
 * 晚挂点怎么做到"降级 @ 判定"：链上位置在 mentionGate **之后**，所以这里：
 *   ① 读得到 `ctx.state.mention`（门控刚写下的判定）；
 *   ② **改得动**它 —— `ctx.decide({ mention: 'ignore' })`（等价于直接写 `wasMentioned = false`，
 *      但会落审计、也会把"早挂点误调"这种用法明确拒绝掉）；
 *   ③ 还能直接不调 `next()` 把这条**整条拦掉**（本示例不用，它只是"降级"不是"拦截"）。
 * 被引原文的来源是现成的 `ctx.state.quote.text`（quoteRef 中间件在链前部赋的值，
 * media-history 与 debounce 都在读它）——**别自己写引用解析**。
 *
 * 早挂点在本文件里做什么：**只读观测 + 两个默认关闭的可选动作**。
 *   它是链上唯一"还没记群历史"的位置 —— 所以消灭（`ctx.annihilate`）、改写（`ctx.rewrite`）、
 *   强制入站（`ctx.forceWake`）都只在这里才是"真动作"。本示例默认**不做**破坏性动作
 *   （它是插件自动铺给每个用户的示例，不能悄悄吞消息），把写法留在下面两个开关里：
 *   想用就把开关改成 true，改完 `/tools-reload` 立即生效。
 *
 * ── 用法/契约速查 ──────────────────────────────────────────────────────────
 *   · 早挂点：`export async function onInbound(ctx, next)`（也可以是 `export const onInbound = …`）；
 *   · 晚挂点：`export default async (ctx, next)`，**语义等同 `export async function onDecide(ctx, next)`**；
 *     一个文件可以同时导出两个，互不影响；只导出其一也完全可以；
 *   · 可选导出 `dispose()`，插件卸载时调用（本示例没有需要收尾的东西，故不导出）；
 *   · `{数据根}/.qqbot-extensions/inbound/` 目录不存在或为空 = 完全安静（不打任何日志）；
 *   · 单个扩展抛错只告警并继续 `next()` —— 用户脚本坏了**绝不会**把入站消息吞掉；
 *   · 任何动作（annihilate/rewrite/forceWake/decide/muteUser…）内部都有 try/catch，**不会抛到链上**；
 *   · 改完文件后：`/tools-reload`（或工具 `tools_reload`）即可热重载；重启插件当然也生效。
 */

/** 只用于日志展示（不写就用文件名） */
export const name = 'no-wake-on-child-quote';

/**
 * 子会话转发前缀的宽松匹配。
 *
 * 宽松是刻意的：**不抠 id、不要求右括号** —— 被引原文可能被平台按 60 字截断，
 * 于是 `【子会话 abc1`（无 `】`）与光秃秃的 `【子会话`（正好截在前缀处）都要命中。
 * 普通文本里出现"子会话"三个字但**没有 `【`** 一律不命中（避免误伤正常聊天）。
 */
const CHILD_SESSION_QUOTE_RE = /【子会话(?:\s|\u3000|$)/;

/**
 * 纯函数（可单测、也可被别的扩展/debug 复用）：
 * 这段"被引用的原文"是不是一条子会话转发消息？
 *
 * @param {string|null|undefined} quotedText 被引原文（= `ctx.state.quote?.text`）
 * @returns {boolean} true = 命中子会话转发前缀
 */
export function isChildSessionForwardQuote(quotedText) {
  const t = String(quotedText ?? '');
  if (!t) return false;
  return CHILD_SESSION_QUOTE_RE.test(t);
}

// ══════════════════════════════════════════════════════════════
// 开关：早挂点里两个**默认关闭**的动作示范
// ══════════════════════════════════════════════════════════════

/**
 * true = 把"纯转发壳"消息**消灭**掉（不进群历史、不进上下文、不占群冷却）。
 *
 * 什么算纯转发壳：正文去掉 @ 之后**什么都不剩**，且**没有附件**。
 * 这种消息对她没有任何信息量，却会占到一次群历史与一枚群冷却。
 * ⚠️ 默认 **false**：本文件是插件自动铺给每个用户的示例，不能悄悄吞消息 ——
 *    想用请自己改成 true，并确认你知道"消灭 = 这条连历史都不进"。
 */
const ANNIHILATE_EMPTY_CHILD_FORWARD = false;

/**
 * true = 把正文开头的转发头 `【子会话 xxx】` **改写**掉（群历史里存的就是改后文本）。
 * ⚠️ 默认 **false**：转发头有时是用户自己想要的线索，先看清楚再开。
 */
const REWRITE_STRIP_CHILD_PREFIX = false;

/** 转发头（比"引用判定"严格：要求带 id 与右括号）—— 只给上面两个开关用 */
const CHILD_SESSION_PREFIX_RE = /^【子会话\s*[0-9a-fA-F]{1,32}】\s*/;

/** 只留"真正的内容"：去掉 @ 标记与空白，用来判断"这条是不是空壳" */
function contentWithoutMentions(ctx) {
  return String(ctx?.text ?? '')
    .replace(/<@!?[^>]+>/g, '')   // QQ 的 @ 标记：<@openid> / <@!openid>
    .replace(/@bot/g, '')          // 进上下文前后插件会把 @她 换成 @bot（这里只是保险）
    .replace(/\s+/g, '');
}

/**
 * ★ 早挂点 `onInbound`（2026-10-12 新增）★
 *
 * 位置：**quoteRef 之后、记群历史之前**。这一层能读、能做的东西与晚挂点不同：
 *   · 读得到 `ctx.message` / `ctx.state.quote`（被引原文）/ `ctx.platform.mentioned`（平台 @ 信号）；
 *   · **读不到** `ctx.state.mention`（那是后面 mentionGate 才写的，这里永远是 undefined —— 别读）；
 *   · 只有在这里：`ctx.rewrite()` 能改到**群历史**里存的文本；`ctx.annihilate()` 能真的"消灭"
 *     （不调 next() ⇒ 后面的群历史缓冲、门控、评分、冷却全都不会跑）。
 *
 * ⚠️ 要把 `next()` 交出去（`return next()`）：除非你**确实**想消灭这条消息。
 */
export async function onInbound(ctx, next) {
  try {
    // 这里读不到 ctx.state.mention —— 想看"平台认为这条 @ 了她吗"，用 ctx.platform.mentioned
    // （判据与 SDK 的 mentionGate 完全一致：rawEventType / mentions[].is_you / 正文里的 <@appId>）
    const mentioned = ctx?.platform?.mentioned === true;
    const quoted = ctx?.quoted?.text ?? '';

    if (ctx?.scope === 'group' && isChildSessionForwardQuote(quoted)) {
      // 只读观测（debug 级，别刷屏）：这一步群历史**还没记** —— 对照晚挂点那条日志的时间序
      ctx?.logger?.debug?.(
        `[ext-inbound:${name}] 早挂点：引用的是子会话转发（平台@=${mentioned}，正文"${String(ctx.text).slice(0, 20)}"）` +
        ' → 群历史尚未记录，改写/消灭只能在这里做',
      );

      // ── 可选动作 ①：改写（把转发头从**要进群历史**的正文里去掉）──
      if (REWRITE_STRIP_CHILD_PREFIX && CHILD_SESSION_PREFIX_RE.test(String(ctx.text ?? ''))) {
        ctx.rewrite({
          text: String(ctx.text).replace(CHILD_SESSION_PREFIX_RE, ''),
          reason: '去掉子会话转发头（历史里不必留机器前缀）',
        });
      }

      // ── 可选动作 ②：消灭（纯转发空壳：没正文、没附件，只剩一个 @）──
      const atts = Array.isArray(ctx?.message?.attachments) ? ctx.message.attachments : [];
      if (ANNIHILATE_EMPTY_CHILD_FORWARD && atts.length === 0 && contentWithoutMentions(ctx) === '') {
        ctx.annihilate({ reason: '子会话转发空壳（无正文无附件）' });
        return;   // ★ 不调 next() = 这条不进历史、不进上下文、不占冷却
      }

      // ── 可选动作 ③：强制入站（确定要她看到这条时）──
      // ctx.forceWake({ reason: '引用里点名了她' });   // 跳过 @门控 / 价值评分 / 群冷却
    }
  } catch {
    /* 兜底：本扩展出任何问题都绝不影响主链 */
  }
  return next();
}

/**
 * ★ 晚挂点（默认导出 = `onDecide`）★ —— 只做编排，判定逻辑在上面的纯函数里。
 *
 * ⚠️ 只在**群聊**生效：私聊的 `wasMentioned=true` 是 SDK 的 passthrough 标记（`reason: 'passthrough'`），
 * 不是"被 @ 了"的判定；压它只会让上下文丢掉 `(@you)` 标签，而私聊本来每条都唤醒 ⇒
 * 既拦不住也不该动。
 *
 * ⚠️ 永远 `await next()`（这里直接 `return next()`）：本示例是"降级"不是"拦截"，
 * 绝不能把消息吞掉 —— 吞掉会让这条既不进上下文也不进历史。
 */
export default async function noWakeOnChildQuote(ctx, next) {
  try {
    if (ctx?.message?.kind === 'group') {
      const quoted = ctx?.state?.quote?.text;
      if (isChildSessionForwardQuote(quoted)) {
        const mention = ctx?.state?.mention;
        // 只压「确实是 @ 判定为 true」的那种；别的（本来就没@）不用动
        if (mention && mention.wasMentioned === true) {
          // 走动作 API（而不是直接改 ctx.state.mention）：会落一行审计，
          // 而且"在早挂点调 decide"这种用法会被明确拒绝 + 告警。
          ctx.decide({ mention: 'ignore', reason: '引用的是子会话转发消息' });
          // debug 级 —— 别刷屏（群消息多，这条规则会经常命中）
          ctx.log?.debug?.(
            `[ext-inbound:${name}] 引用的是子会话转发消息 → 不按 @ 处理: ${String(quoted).slice(0, 40)}`,
          );
        }
      }
    }
  } catch {
    /* 兜底：本扩展出任何问题都绝不影响主链 */
  }
  return next();
}
