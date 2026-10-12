/**
 * session-watch-hook.mjs — 演示「注册监听 + dispose 清理」的启动钩子示例
 *
 * 放在 `{数据根}/.qqbot-extensions/hooks/session-watch-hook.mjs`
 * （插件启动时会自动铺一份，只补不覆盖；你改过的版本永远不会被覆盖）。
 *
 * 它做三件"必须自己收尾"的事，正是不清理就会在重建网关时不断累积的典型：
 *   ① `env.ctx.on('session/event', …)` 订阅宿主事件 → 返回 disposer；
 *   ② 起一个 `setInterval` 定时器 → 自己 clearInterval；
 *   ③ 用 `env.store.save()` 落盘一个累计计数。
 *
 * 收尾入口**两个都写了**（都合法，任选其一即可；这里是为让示例把两条路都展示出来）：
 *   · `run()` 里 `env.registerDispose(fn)` —— 适合"清理函数是闭包、写在 run 内部"的情形；
 *   · 模块级 `export function dispose(env)` —— 适合"清理逻辑是模块级的"。
 * 执行顺序：同一钩子内 registerDispose 的**逆序**先跑，然后跑模块级 dispose()。
 *
 * ⚠️ 三条经验（踩出来的）：
 *   1. **必须真的收尾**：不 dispose 的话，每次"保存连接相关设置 → 重建网关"都会多一份监听；
 *   2. **run 与 dispose 之间有竞态**：极端情况下 dispose 可能先于 run 的末尾执行 ——
 *      所以用 `cancelled` 标志兜住（本示例的写法可以直接抄）；
 *   3. **别在启动路径上做重活**：钩子会拖慢插件启动（虽然有 30s 超时保护，但超时=白等 30s）。
 */

export const name = 'session-watch-hook';

const TICK_MS = 60_000;

/** 每次 run 的现场（重建网关会有新的一份；旧的由 dispose 清掉） */
let state = null;

export default {
  name,

  /** 事件计数与定时器句柄都挂在 state 上，避免模块级散落变量互相踩 */
  async run(env) {
    const startAt = Date.now();
    const prev = env.store.load() ?? {};
    state = {
      events: 0,
      starts: Number(prev.starts ?? 0) + 1,
      cancelled: false,
      disposers: [],
      startAt,
      timer: undefined,
    };

    env.logger.info(
      `[ext-hook:session-watch] 启动第 ${state.starts} 次（插件 v${env.pluginVersion}）——` +
      `开始订阅 session/event，并起一个 ${TICK_MS / 1000}s 的统计定时器`,
    );

    // ── ① 订阅宿主事件（有就订，没有就算了：ctx 形状跟随宿主版本，别因为拿不到就崩） ──
    try {
      const off = env.ctx?.on?.('session/event', () => {
        state.events += 1;
        if (state.events % 10 === 0) {
          env.logger.info(`[ext-hook:session-watch] 已观察到 ${state.events} 个 session/event`);
        }
      });
      if (typeof off === 'function') state.disposers.push(off);
      else env.logger.warn('[ext-hook:session-watch] ctx.on 没返回 disposer —— 跳过订阅（宿主版本差异？）');
    } catch (err) {
      // 钩子里的失败**不要往外抛**：抛了也只是被引擎记成"失败"，不如自己降级
      env.logger.warn(`[ext-hook:session-watch] 订阅 session/event 失败(已降级): ${err?.message ?? err}`);
    }

    // ── ② 定时器（记得 unref：不该因为一个统计定时器让宿主进程退不掉） ──
    state.timer = setInterval(() => {
      if (state.cancelled) return;
      env.logger.info(
        `[ext-hook:session-watch] 心跳：本次启动已观察 ${state.events} 个事件，` +
        `存活 ${Math.round((Date.now() - state.startAt) / 1000)}s`,
      );
    }, TICK_MS);
    state.timer.unref?.();

    // ── ③ 登记清理（同时用 registerDispose 展示这条通路） ──
    env.registerDispose(() => {
      // 这里只是再打一行日志；真正的清理由下面 cleanup() 统一做（避免两处清理重复）
      env.logger.info('[ext-hook:session-watch] registerDispose 回调执行');
    });

    // ── 竞态兜底：如果 run 还没跑完，dispose 就已经被调用了，那就**立刻**收尾 ──
    if (state.cancelled) {
      env.logger.warn('[ext-hook:session-watch] 启动与卸载撞上了，立即收尾');
      cleanup(env);
      return { cancelled: true };
    }

    return { starts: state.starts };
  },

  /** 模块级 dispose：引擎在插件卸载 / 宿主退出 / 重建网关时调用（逆序、逐个 try/catch） */
  async dispose(env) {
    if (state) state.cancelled = true;   // 先立标志：run 若还在后面跑，它会自己收尾
    cleanup(env);
  },
};

/** 幂等收尾：disposer 逐个吞错 + 定时器清掉 + 计数字段落盘 */
function cleanup(env) {
  const s = state;
  state = null;
  if (!s) return;
  s.cancelled = true;
  for (const off of s.disposers.splice(0).reverse()) {
    try { off(); } catch (err) {
      env.logger.warn(`[ext-hook:session-watch] 取消订阅失败(已忽略): ${err?.message ?? err}`);
    }
  }
  if (s.timer) { clearInterval(s.timer); s.timer = undefined; }
  env.store.save({
    starts: s.starts,
    lastEvents: s.events,
    lastRunMs: Date.now() - s.startAt,
    lastStopAt: new Date().toISOString(),
  });
  env.logger.info(`[ext-hook:session-watch] 已收尾（观察 ${s.events} 个事件，监听与定时器都已归还）`);
}
