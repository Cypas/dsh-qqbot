# 扩展契约（写 dsh-qqbot 扩展前，先读这一份）

> 适用版本：**v1.9.2+**（本文写的就是当前真实实现，不是设想）
> 面向：给 QQ 机器人写扩展的用户 / 让 AI 帮你写扩展的人
> 配套：用户手册 `README.md` §用户扩展、`docs/USER-GUIDE.md` §统一能力包、入站中间件详解 `examples/ext-inbound/README.md`

---

## 0. 一句话

**五套扩展点，一套能力包。** 你在哪一套里写代码，拿到的能力面都一样 ——
不用记五套 API，也不用"自己接生"发消息/存数据/调官方接口这些事。

```
                    ┌─────────────── 统一能力包（makeExtCaps）───────────────┐
  tools/      env ──┤ text markdown markdownCard media image voice video file│
  commands/   ctx ──┤ at api() appId/appSecret store registerInteractionCard  │
  botplay/    env ──┤ appendSilent appendWake canAppendSilent                 │
  hooks/      env ──┤ user owners peer log kernel restart                     │
  inbound/    ctx ──┤ + inbound: { annihilate rewrite forceWake decide       │
                    │              silentInto mute* message kv }  ← 只有它   │
                    └───────────────────────────────────────────────────────┘
```

`inbound` 那一组为什么只有它有值：**只有它跑在"一条消息正在进站"的时刻**，
"消灭/改写/覆盖 @ 判定"这些动作在别处没有对象。别的四套拿到的 `caps.inbound` 是
`undefined` —— **这是语义，不是缺失**。

---

## 1. 五套扩展点：目录、时机、拿到什么

全部位于 **`{数据根}/.qqbot-extensions/`** 下（数据根 = 工作目录里的 `dshqqbot/`）：

| 目录 | 什么时候跑 | 你的导出 | 你拿到 |
|---|---|---|---|
| `tools/*.mjs` | LLM 调这个工具时 | `export default { name, description, inputSchema, run(args, env) }` | `env`（能力包平铺） |
| `commands/*.mjs` | 用户敲 `/你的命令` 时 | `{ name, handler(ctx) }` | handler 的 `ctx`（能力包平铺） |
| `botplay/*.mjs` | 卡片按钮被点时 | `{ name, events: {...} }` | `env` |
| `hooks/*.mjs` | **插件启动时跑一次** | `export default async (env) => {}` | `env`（含 `env.caps`） |
| `inbound/*.mjs` | **每一条入站消息** | `export async function onInbound(ctx,next)` / `onDecide(ctx,next)`（或 `export default`） | 挂点的 `ctx` |

扫描规则（五套一致）：**只看目录下的直接子文件**，`.js` / `.mjs` / `.cjs`，按文件名排序；
子目录不扫描（可放私有模块）。改完文件调 `tools_reload`（或 `/tools-reload`）**即时生效**；
扩展命令需要重启宿主。

---

## 2. 统一能力包（五套都有）

成员**平铺**在你的 `env` / `ctx` 上，**同时**在命名空间 `env.caps` / `ctx.caps` 里也有一份。

| 能力 | 用法 | 说明 |
|---|---|---|
| 发纯文本 | `await env.text('hi')` | |
| 发 markdown | `await env.markdown('# 标题')` | 富文本卡片通道，**自带纯文本降级** |
| 发 markdown+按钮 | `await env.markdownCard(md, keyboard)` | 自己拼 keyboard（≤5 行） |
| 发富媒体 | `await env.image(src)` / `voice` / `video` / `file` | `src` 可传 URL 字符串或 `{url}` / `{localPath}` |
| 任意媒体 | `await env.media('file', src)` | kind = image / voice / video / file |
| @人 | `env.at(openid)` | 返回 `<@openid>` 片段，拼进文本 |
| 官方 API | `await env.api('/v2/users/@me')` | **自带 token 与 2h 缓存**；返回 `{ok,data}` 或 `{ok:false,err:{code,human}}` |
| 钥匙 | `env.appId` / `env.appSecret` | 想自己换 token 调任意接口时用 |
| 持久化 | `env.store.load()` / `env.store.save(obj)` | 落 `…/data/<你的文件名>.json`，**升级插件不丢** |
| **进上下文（静默）** | `await env.appendSilent('...')` | **只落上下文、不唤醒**（详见 §4 安全红线） |
| 进上下文（唤醒） | `await env.appendWake('...')` | 走正常回合唤醒一轮 AI（耗 token） |
| **身份** | `env.user.openid` / `env.user.name` / `env.user.isOwner` | 当前发言者。`isOwner` 已按主人白名单**算好布尔值**，直接 `if (!env.user.isOwner) return` 即可，不必自己比数组 |
| **主人判定（便捷）** | `env.isOwner` | 等价于 `env.user.isOwner` 的顶层布尔，最省事的写法 |
| **主人白名单** | `env.owners`（`string[]`） | 原始 openid 数组，`[]` = 未配置主人 |
| **发送者 openid（平铺）** | `env.actorOpenid` | 与 `env.user.openid` 同值。v1.10.42 起才真正暴露（此前只在内部算 `isOwner` 时用到） |
| **会话标识** | `env.peer.scope` / `env.peer.peerId` | `scope` = `'group'` / `'c2c'`；`peerId` = 群 openid 或用户 openid |
| **宿主配置** | `env.config.appId` / `env.config.appSecret` / `env.config.owners` | 给「想自己换 token 调接口」或「自己判主人」的扩展用。⚠️ 命令侧 `ctx.config` **同时**还包含该扩展自己的设置项（面板里填的值），两者合并 |
| **本会话 id** | `env.peerSessionId` | 本 QQ 会话对应的 **DSH 会话 id**（= `session/event` 里那个 `session.id`）。⚠️ **不是 `agent.id`** —— 跨会话回灌/引用回流判"父会话"用的正是它。v1.10.0 起提供；命令与按钮回调侧都能拿到（回调侧字面同值，直接读即可） |
| 日志 | `env.log(...)` | 落插件 logger |
| 内核句柄 | `env.kernel`（工具侧也叫 `env.ctx`） | **全权限"遥控器"**：`ctx.get('服务名')` / `ctx.on(...)` / `ctx.webServer.register(...)`。⚠️ 形状跟随 dsh 版本；`register` 返回的 disposer 要自己收尾 |
| 宿主自重启 | `await env.restart()` | 复用内置 `/bot-restart`（自动识别启动命令、强补 `--no-open`）。默认**仅主人**可触发；要放开写 `env.restart({ requireOwner: false })` |
| 回调按钮卡 | `env.registerInteractionCard({cardId, buttonIds, expireAt})` | 发**带回调按钮**的卡片必须先登记，否则点了没人认 |

---

## 3. 入站操控：`caps.inbound`（只有入站扩展有）

入站扩展的两个挂点，**链上位置决定你能做什么** —— 这是最重要的一张表：

| | 早（`onInbound`） | 晚（`onDecide` / `export default`） |
|---|---|---|
| 链上位置 | 引用解析**之后**、**记群历史之前** | @门控**之后** |
| 读得到 | `ctx.message` / `ctx.state.quote` / `ctx.platform.mentioned` | 以上全部 **+ `ctx.state.mention`**（门控判定结果） |
| `annihilate` 消灭 | ✅ 真消灭（不进历史/不进上下文/不占冷却） | ❌ 会被拒绝 + 告警（历史已记） |
| `rewrite` 改写 | ✅ **连群历史一起改** | ⚠️ 只改后续上下文，历史已是原文 |
| `forceWake` 强制入站 | ✅ | ✅ |
| `decide` 覆盖 @ 判定 | ❌（判定还没写出来） | ✅ |
| `silentInto` 静默进上下文 | ✅ | ✅ |
| 禁言 / kv | ✅ | ✅ |

动作清单：

```
ctx.caps.inbound.annihilate({reason})      // 不调 next()：这条不进群历史、不进上下文、不占冷却
ctx.caps.inbound.rewrite({text,reason})    // 换掉正文（早挂点连历史一起换）
ctx.caps.inbound.forceWake({reason})       // 跳过 @门控 / 价值评分 / 群冷却
                                           //   ⚠️ 只是"必进"，不代表她一定会说话
ctx.caps.inbound.decide({mention:'ignore'|'force', reason})   // 覆盖 @ 判定
ctx.caps.inbound.silentInto(text?)         // 内容进 AI 上下文、不唤醒（走宿主 agent.inject）
ctx.caps.inbound.muteUser/unmuteUser/isMuted/mutedUsers       // 用户维禁言（带期限、持久化）
ctx.caps.inbound.message.{text,sender,senderName,scope,groupId,isOwner,mentions,quoted,platform}
ctx.caps.inbound.kv.get/set                // 该扩展自己的持久化
```

同一套动作在 `ctx` 上**也平铺了一份**（`ctx.annihilate` / `ctx.silentInto` / `ctx.muteUser` …），
两者是同一套内核的两个入口，随便用哪个。

### 示例：引用"子会话转发消息"不算 @

```js
// {数据根}/.qqbot-extensions/inbound/no-wake-on-child-quote.mjs
export default async function (ctx, next) {
  if (ctx.message.kind === 'group') {
    const quoted = ctx.state?.quote?.text ?? '';
    if (/【子会话(?:\s|\u3000|$)/.test(quoted) && ctx.state?.mention?.wasMentioned === true) {
      ctx.decide({ mention: 'ignore', reason: '引用的是子会话转发消息' });
    }
  }
  return next();
}
```

### 示例：广告直接消灭 + 静默留档

```js
export async function onInbound(ctx, next) {
  if (isAd(ctx.text)) {
    ctx.silentInto();          // 内容仍进她上下文（下次跑就能看到）
    ctx.annihilate({ reason: '广告' });
    return;                    // ★ 不调 next() = 不进历史/不占冷却/不叫醒
  }
  return next();
}
```

---

## 4. 四条安全红线

1. **`appendSilent` 的人设红线**：dsh 要求"人设"是会话上下文的**第一个节点**。
   全新会话（还没跑过任何回合）里静默追加会**把整份会话日志写废**，用户会看到「历史加载失败」。
   所以此能力**内置守卫**：不安全时直接返回 `false`、**绝不写入**。想在这种会话里送内容，用 `appendWake`。
2. **主人白名单最高优先**：主人（`config.groupAdmin.owners`）的消息**不可被 `annihilate` 消灭、不可被禁言** ——
   扩展这么调会被拒 + 告警 + 落审计，消息照常放行。
   （`silentInto` 不受此限：内容仍进上下文，不存在"被吞"风险；但它照旧落审计、计入熔断。）
3. **熔断**：单个扩展的破坏性动作占比过高（>50%，样本 ≥50）或短时爆发（10 秒内 ≥20 次），
   插件会**自动停掉它的破坏性动作**并告警 —— 消息改回放行，不会因为你的 bug 静默吞群消息。
4. **优雅降级**：任何能力拿不到依赖都返回 `false` / 结构化错误，**绝不抛**；
   你写的扩展抛错时，插件**只告警 + 继续 `next()`** —— 用户脚本坏了永远不会把消息吞掉。

另外：所有动作都会落 **`{数据根}/.qqbot-extensions/inbound/.state/audit.jsonl`**（带轮转），
禁言名单与 kv 落同目录的 `<你的文件名>.json`，**随时可回看、可撤销**。

---

## 5. 三条容易踩的坑

1. **`text` 同名冲突（只有入站侧）**：入站 `ctx.text` = **当前这条消息的正文**（读）；
   其余四套 `env.text('...')` = **发一条纯文本**。入站侧要发文本请走 `ctx.caps.text('...')`。
2. **入站是热路径**：两个挂点**每条消息都跑一遍**。别在这儿发消息、打接口、做长任务 ——
   `markdown` 会真发群、`appendWake` 会唤醒一轮 AI、`api()` 走网络。
3. **能力包"只补不覆盖"**：插件往你的 `ctx` 上合并能力时，判据是"**值为 undefined 才补**"
   （中间件 ctx 上不少键存在但值是 undefined）。你自己已经定义的同名成员不会被抢走。

---

## 6. 我能写哪一套？怎么选

```
有人敲命令才做事            → commands/
LLM 该主动调用才做事        → tools/
要等人点卡片按钮            → botplay/
启动就得跑一次（恢复任务/起定时器/预取） → hooks/
要影响"每条消息进不进、长什么样、叫不叫醒她" → inbound/
```

写之前建议先读 `examples/` 下对应目录的示例（插件首次启动会**自动铺一份**到你的扩展目录；
`examples/ext-inbound/` 里只有 `no-wake-on-child-quote.mjs` 会自动铺，
`class-advisor.mjs` 那种**会真删消息/真封人**的示例要自己拷）。

---

## 7. 变更记录（契约相关）

- **v1.9.2**：入站扩展（第五套）**能力面对齐** —— 直接复用统一能力包（此前只有一套私有小 ctx，
  `store` / `api()` / `markdown` / `appendSilent` 等一项都没有）；**入站操控那一组也进了包**（`caps.inbound`）。
- **v1.9.0**：新增第五套扩展点 `inbound/`（早/晚双挂点 + 四个动作 + 四条保命件）。
- **v1.8.9**：新增第四套扩展点 `hooks/`（启动钩子）。
- **v1.7.0**：三套（命令/工具/卡片）能力面统一为「统一能力包」。
