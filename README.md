# @zaofan/dsh-qqbot

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) ![Platform](https://img.shields.io/badge/platform-QQ%20Bot%20(dsh)-blue)

基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 QQ Bot IM 插件**增强 fork**：将 QQ 消息平台作为 dsh agent 的前端协议驱动，并加入表情包图库、富媒体收发、定时任务、多实例人格、好感度系统、可视化设置面板等能力。

📦 仓库: [zaofan-make/dsh-qqbot](https://github.com/zaofan-make/dsh-qqbot)（fork 自 [tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot)；改动都在这一侧，升级/重装上游会被冲掉）

> ⭐ **用得顺手的话，麻烦点一下右上角的 Star** —— 它是这个项目"有人在用"的唯一可见信号，也是继续更新的动力。

中文 | [English](./README_EN.md) ｜ 📖 **[用户手册](./docs/USER-GUIDE.md)**（配置项 / 内置命令 / 自定义扩展 / 群管理 / 智能回复 / 架构…）
## 🐋 她能帮你……

**一句话**：把 dsh 的 QQ 机器人养成"活鱼"——会存表情包、会挑图回你、到点自己开口、记得住谁跟它亲疏远近，一台电脑还能同时养好几条性格不同的鲸鱼。

**🤳 群里发的图，她偷偷全存进小图库**
自动去重、分「待整理/收藏/回收站」；你说一句"发个开心点的图"，她自己搜库、自己挑、自己发，还会挑场合出手（冷场不发、刷屏限量、同图不连发）。

**⏰ 到点她自己会开口**
"每天早 9 点去群里说早安""30 秒后提醒我喝水"——她说到做到，准点冒泡。

**🧑‍🤝‍🧑 一个电脑，N 条鲸鱼同时在线**
每条号独立 AppID、独立人格、独立图库/定时/闸门，互不串号；Web 页「扫码绑定」手机一扫就上岗。

**💗 她记得住谁亲谁疏**（v1.5.1）
两个维度分开算：**熟识度**（她把你记得多牢——来过几天、说过多少、被点名、接话，慢变量）与**好感度**（她对你什么态度——随每次互动可升可降）。面板里一行一个人，还能**一键导出 Excel** 拿去分享。
- 判定用一个跑在本机的小模型读她的「思考（内心）」与「正文（说出口的话）」：**心里不肯但话仍照顾 = 让步**、**心里亲近而嘴上冷淡 = 不算数**（扣不扣看内心，不看表面）
- 好感度只影响"她愿不愿意自己开口"的松紧：**负好感也只是少主动，绝不冷落、阴阳、攻击**
- 群消息聚合时按「价值 × 好感」**加权平均**综合判断，不会被一句话钓走

**💬 悬浮球 dock：她的随身控制台**
设置面板右下角的小球，点开就是一整个操作台：**💬 聊天**（像 QQ 一样回放群/私聊记录，气泡+头像，图能放大、本地视频能播、SILK 语音转 mp3 直接听、文件出下载卡，还能在聊天框里直接发文字/插图/发文件——长文本自动拆条连发不被吞）；**📥 入群审批**、**🔨 锤子**（下面分 **🔇 禁言** 和 **👢 踢人** 两页；踢人用你自己的 QQ 号管群，扫码一次之后长期免扫，登录态与 AI 共享）；**⚙️ 出站**（适配主动：刚收到真人消息时前几条带引用回你、连发自动转独立消息，定时/后台推送不打扰）。

**🛡️ 群主/群管好帮手**
入群审批 + 禁言 + 查成员，全走官方接口，出错给"人话"（不是管理员/不能禁群主……都告诉你为什么）。

**👢 踢人（v1.6.3）**
QQ 官方**没有开放踢人接口**，所以这一块走"你自己的 QQ 号 + 群官网"：面板 **🔨 锤子 → 👢 踢人** 里刷新二维码、手机扫一次就登（之后长期免扫）；登录态和 AI 共用 —— 你也可以直接在 QQ 里跟她说"把群里那个 X 踢了"。

**🗂️ 归档了也会自己回家**
不小心把她的会话点了「归档」藏进侧边栏深处？不用满世界找——那个会话**下次在 QQ 里被消息触发时**，会自己从归档里摘出来回到侧边栏（你主动归档的其它会话不受影响）。

**🔝 QQ 一有动静，她的会话自己爬到最上面**（v1.6.8）
侧边栏里正在跟你聊的那个会话，不该被别的压着 —— QQ 里一有消息、她**真的回了话**，对应会话就会自动插到「**还热着**」的那批之后（10 分钟内聊过的算热，**置顶的永不动**），冷掉的会话自然被它越过。全程事件驱动、不轮询；宿主没起来、或聊天页没开着时天然不排序。

![侧边栏会话自动重排：刚聊过的那个会话跃到工作区最前，越过了 12 小时 / 1 天前的那批](docs/screenshots/session-reorder.png)

**🖥️ 不碰配置文件，设置面板点点点**
怎么回、能发什么图、什么时候开口、什么人格——面板上改完保存即生效（只有增删账号才要重启）。还有 ✏️ 预设人格编辑器，直接在网页里改她的"性格文件"。

**📦 干净又利落**
发图/撤消息用纯文本就能驱动（回复里写 `[MEDIA:image|路径]` / `[RECALL]`）；仓库不含任何机器人凭据与隐私。

**📱 不用开电脑 —— 手机也能 7×24 挂着**
配合社区的 [dsh-mobile-apk](https://github.com/kelai141/dsh-mobile-apk)（**dsh 安卓壳 APK**：WebView UI + 内嵌 Termux 运行时快照，解压即跑），把 dsh 和这只鲸鱼一起装进手机，就是一台**随身在线**的 QQ 机器人 —— 不用为了挂机常开一台电脑。（安卓上通常没有 ONNX 运行时，记得在设置里勾上「**程序兜底（不依赖小模型）**」，见下方说明。）

### 📸 效果展示

图①：dsh 运行后台——思考过程、工具调用、Token 用量一目了然（配合「回复闸门 reply_gate」可让机器人自主判断该开口还是静默吃瓜）；
图②：QQ 群里的抓鬼游戏互动——该回就回、该藏就藏，角色扮演全自动；
图③：斗图实战——机器人用自己收藏的表情包接招回击，图、文分开两条连发。

![后台运行日志（思考过程与工具调用可见）](docs/showcase-1-log.png)

![QQ 群聊互动效果（角色扮演/自主静默）](docs/showcase-2-chat.png)

![斗图实战（发表情包接招回击）](docs/showcase-3-doutu.png)

图④：群管理·入群审批全流程——【群管·入群申请】事件注入 + 【审批轮询】双链路触发，AI 核对 openid 台账后自动放行；
图⑤：QQ 群内放行成功效果——小号申请入群被自动审批通过。

![群管理·入群审批全流程（事件注入+轮询+自动放行）](docs/screenshots/group-admin-approval-log.png)

![群管理·审批放行成功效果](docs/screenshots/group-admin-approval-chat.png)

---


---

## 🔌 用户扩展：想自己加功能，不用改插件源码

> **这是给"想自己加东西"的用户准备的接口** —— 往 `{数据根}/.qqbot-extensions/` 里丢一个 `.mjs` 就是一个扩展。
> 插件自带的能力、示例、文档**全都白送**，你只管写业务逻辑。
>
> **先把边界说清楚**：她现有的功能 —— **表情包图库、到点开口、好感度系统、群管理（禁言/踢人）、
> 悬浮球面板、智能回复闸门……这些是插件内置的**（写在插件源码里，随插件升级一起更新）。
> **扩展**是另一回事：你的 `.mjs` 放在自己的数据目录里，**不改插件源码、升级插件也不会被覆盖**。
>
> 两者的关系是：**能力一样，位置不同** —— 扩展拿到的那套能力包（发消息 / 发图 / 进她上下文 /
> 调官方 API / 持久化 / 身份…）就是插件内部模块在用的同一套封装，所以你写的东西不是"外挂"，
> 只是**长在同一条链上的另一个模块**。

**🧩 五套扩展点，挑一个放进去就行**

| 你想做的事 | 放哪个目录 | 什么时候跑 |
|---|---|---|
| 让 AI 主动调用某个工具 | `tools/` | LLM 调它的时候 |
| 加一条 `/我的命令` | `commands/` | 用户敲这条命令 |
| 卡片按钮点了要做事 | `botplay/` | 有人点按钮 |
| 启动时恢复任务 / 起定时器 / 预取 | `hooks/` | 插件启动时跑一次 |
| **管每一条消息的命运** | `inbound/` | **每条消息都过一遍** |

**🧰 一套能力包，五套通用**（不用为每套各记一套 API）

```js
await env.text('hi') / env.markdown('# 标题') / env.markdownCard(md, keyboard)
await env.image(src) / voice / video / file            // src 可传 URL 或本地路径
env.at(openid)                                        // 群里 @ 人
await env.api('/v2/users/@me')                        // ★ 官方 API：自带 token 与缓存，不用管 appId/secret
env.store.load() / env.store.save(obj)                // ★ 持久化：升级插件不丢
await env.appendSilent('...')  // ★ 进她上下文、不唤醒
await env.appendWake('...')    // ★ 进上下文并唤醒一轮
env.user / env.owners / env.peer · env.log() · env.kernel（全权限遥控器）· await env.restart()
```

**🚦 入站扩展独有：一条消息的"处置权"**

```
消灭 annihilate（不进群历史/不进上下文/不占冷却）
改写 rewrite（早挂点连群历史一起改）
强制入站 forceWake（跳过 @门控/价值评分/群冷却）
覆盖 @判定 decide · 静默进上下文 silentInto · 用户维禁言 muteUser 系列
只读视图 message.{text,sender,scope,groupId,isOwner,mentions,quoted,platform}
```

**🛡️ 四条保命件 —— 你的脚本出问题，也搞不坏群**

主人白名单最高优先（不可被静默/封） · 强唤醒优先于静默 · 熔断（扩展失控自动停手） ·
审计 + 可撤销（每次动作一行，带轮转） · **单个扩展抛错只告警并放行，永远不会吞掉消息**

**🎬 还有**

- **示例自动铺**：插件启动时把自带示例**只补不覆盖**地铺进你的扩展目录 —— 装上就有一份能跑的样板
- **改完即生效**：`/tools-reload` 一下就行（扩展命令需重启）
- 📘 **写扩展前先读**：[`docs/extension-contract.md`](./docs/extension-contract.md) —— 五套扩展点、能力包全表、
  入站操控、安全红线、常见坑，一份写全

### 🎁 白送的扩展示例：装上就有能跑、能抄的样板

插件启动时会把这些示例**只补不覆盖**地铺进你的扩展目录 —— 不用自己从零写。

**让她多会几样本事（AI 能自己调用的工具）**

- **会自己联网搜**：一句话就能搜索并把结果整理回来，不用你接搜索接口
- **会替你给别人发消息**：指个群名或人名她就发；**认不准只回候选、绝不瞎发**
- **会在群里发起投票**：选项、票数、到点结束结算，一张卡搞定
- **会跨会话遥控**：列出你所有工作区与会话、给某个会话递话、临时开一个新会话（能指定工作区与人设、派初始任务）、
  盯住子会话**把结果回灌过来并转进 QQ**

**让她在卡片上"有状态"**

- **签到统计**：谁签过、签了几次、只有主人能看、结束自动公布名单 —— 按钮点下去真的记账

**让她开机就干活（不用任何人触发）**

- **启动就跑一次**：打日志、计数落盘（跨重启累加）；
- **注册监听并自己收尾**：演示怎么挂监听、怎么在卸载时清理干净

**让她管"每条消息的命运"**

- **引用子会话不叫醒她**：群里引用一条"子会话转发"的消息，不会被当成在叫她；
- **一个"辅导员"全套样板**：删广告、刷屏禁言、把手机号之类的敏感内容改掉、有人喊救命时**优先叫醒她**
  —— **默认只观察不动手**，先看日志确认规则合不合意，再放开

> 示例是给人**看和抄**的：会真动手的那个（辅导员）**不会自动铺**，要自己拷过去 ——
> 示例不该在你没读过它之前就自己跑起来。

---

## 🆚 官方 Bot 方案 vs onbot / NapCat 等第三方协议端

本插件走的是**腾讯官方 QQ 机器人开放平台**（AppID + AppSecret + 官方 SDK），
**不是**"模拟 QQ 客户端协议"那条路。两者差别不小，先把话说清楚：

| | **本插件（官方 Bot API）** | 第三方协议端（onbot / NapCat / Lagrange…） |
|---|---|---|
| **登录方式** | 填 **AppID / AppSecret** 即可，**不扫码、不登录你的真人 QQ 号** | 扫码登录**你的个人 QQ 号**，常掉线、要保活 |
| **账号安全** | ✅ **完全不碰你的个人号**，无封号风险 | ⚠️ **有封号风险**：协议模拟违反 QQ 用户协议，腾讯明确禁止 |
| **稳定性** | ✅ 官方接口，腾讯自己在维护；变更会提前公告 | ⚠️ 协议一变就挂，得等签名服务（qsign 之类）跟进 |
| **资源占用** | ✅ **极低**：纯 HTTP + WebSocket，无浏览器、无协议端常驻 | ⚠️ 高：要挂 QQ 客户端 / 协议端，内存几百 MB 起 |
| **低配 / 手机部署** | ✅ **能跑**：安卓 Termux、树莓派、1 核 1G 的小机器都行（见下方「📱 装到手机上」） | ⚠️ 难：协议端对架构/内存有要求，安卓上尤其折腾 |
| **隐私** | ✅ 只与腾讯官方通信，没有中间人 | ⚠️ 要经过第三方协议实现 |
| **功能范围** | ⚠️ **受官方开放范围限制**（例：**踢人接口官方没开放**） | ✅ 全功能 |

**关于"功能受限"，本插件的态度**：官方没开放的，能补就补、不能补就明说 ——
例如**踢人**：官方接口至今未开放，插件用 **🔨 锤子** 面板让你**用自己的号**走群官网接口把这块补上
（扫码一次、之后长期免扫，登录态还会和 AI 共享，详见下文）。

> **一句话**：想要**安全、省心、还能塞进手机或小机器**，就选官方 Bot 方案；
> 只有当你非要第三方协议端的"全家桶"、并且愿意承担封号风险时，才另说。

---

## 安装

> ## ⚠️ 必须装到 `web` profile
>
> 本插件的**前端设置面板**（dock 球 + 「设置 → QQ 机器人」整页）只在 **`web` profile** 里生效。
> 装到别的 profile 会得到一个 **没有设置面板的裸环境** —— dock 球和设置页都不会出现，
> 表现为"插件装了但看不到任何界面"。
>
> **正常使用 `dsh web` 的用户不用关心**（`dsh web` 默认就是 `web` profile，插件页/插件市场装机也落在它上面）。
> 只有手动指定过 `--profile <其它名字>` 的场景才需要注意。
> 也不要 `add @tencent-connect/dsh-qqbot`——那会装上游官方版（无本 fork 增强功能）。
>
> ✅ **单包自含，装一个就全有**：QQ 机器人 + Web 可视化设置面板（host 桥 + 设置页 UI）都打包在
> 这一个包内——装完它，dsh Web「设置」里就会出现「QQ 机器人 (im-qqbot)」面板（多账号时每个实例各一页），
> **无需再单独安装 dsh-qqbot-settings**。

### 方式一（发布到 npm 后）：一条命令

```powershell
npx @deepseek-ai/dsh plugin --profile web add @zaofan/dsh-qqbot
```

> 尚未发布到 npm 前，请用下面的方式二。

> ⚠️ **从 GitHub 直装（`github:zaofan-make/dsh-qqbot`）需要编译产物 `dist/`，而仓库不提交 `dist`。**
> 包已声明 `prepare` 脚本，pnpm 安装时会自动编译；
> 若你的包管理器没自动跑（或报 `failed to import` / 找不到 `dist/index.js`），
> 手动在插件目录执行一次 `npm run build` 即可。**最省事的做法是用 npm 上的发布版**（`@zaofan/dsh-qqbot`）。

### 方式二：源码分发（当前推荐）

**Windows（一键脚本）**：

```powershell
git clone https://github.com/zaofan-make/dsh-qqbot.git
cd dsh-qqbot
.\install.ps1          # 自动 install/build → pack → add tarball → 输出重启指引
```

> 若系统禁止运行脚本，改用：`powershell -ExecutionPolicy Bypass -File .\install.ps1`

**macOS / Linux（手动）**：

```bash
git clone https://github.com/zaofan-make/dsh-qqbot.git
cd dsh-qqbot
npm install && npm run build
pnpm pack --pack-destination /tmp
npx @deepseek-ai/dsh plugin --profile web add /tmp/zaofan-dsh-qqbot-0.4.0.tgz
```

> 💡 为什么打 tarball、而不是 `add` 源码目录？实测教训：
> ① 目录路径含空格时 Windows 会把参数在空格处拆碎（pnpm 报 `- isn't supported`）；
> ② `add` 目录 = pnpm link(junction)，插件无法按"代码位置"反推 profile → 扫码凭据落不了盘，只能走环境变量。

### 构建与部署（源码）

```bash
npm install                 # 安装依赖（peer 依赖由 dsh 宿主解析）
npm run build               # 或: node node_modules/typescript/lib/tsc.js -p tsconfig.json
npm run check:package       # 发布前自检(单包四项家当齐全)
pnpm pack                   # 打 tarball(供 dsh plugin add 安装)
```

仓库根的 `install.ps1` 提供 Windows 一键安装（自动 pack 到无空格目录 → add → 重启提示）。

### 排障: npm 安装报 ERESOLVE(2026-09-06 移植上游 PR #42)

首次 `npm install` 可能报 `ERESOLVE could not resolve`——原因: `@deepseek-ai/dsh-tools`/`dsh-agent` 等 peer 依赖仍在 prerelease(-rc) 版本线,npm 7+ 严格解析拒绝不相交组合。**这是上游版本线问题,不是插件 bug**,两条绕过路:

```bash
npm install --legacy-peer-deps     # 仅安装期解析策略, 不改运行行为
# 或: 装完依赖后手动 build + pack(peer 由 dsh 宿主解析, 不受影响)
```

> 跟踪中: 上游 #37 根治后此段可删(版本线收敛后 npm 不再报错)。

### 📱 装到手机上（安卓）—— 随身挂机方案

[dsh-mobile-apk](https://github.com/kelai141/dsh-mobile-apk) 是社区做的 **dsh 安卓壳 APK**
（WebView UI + 内嵌 Termux 运行时快照，解压即跑，为 dsh 本地运行设计）。
把 dsh 装进去之后，再按本文档把本插件装进那个 dsh —— 你就得到一台**不用电脑托管的、7×24 在线的 QQ 机器人**。

```
下载 APK:  https://github.com/kelai141/dsh-mobile-apk/releases
（按手机 CPU 选 arm64 / x86_64）
```

装好之后，插件安装方式与电脑上一致（插件页填包名或 GitHub 地址，见上）。

> ⚠️ **安卓上务必打开这两个开关**（否则机器人半天不理人）：
>
> 1. **设置 → 智能回复 → 勾选「程序兜底（不依赖小模型）」**
>    手机环境通常拿不到 ONNX 运行时，真实小模型会加载失败；勾上程序兜底后改用
>    **字符 n-gram 字面相似**（零依赖、零 token），智能回复照常工作。
> 2. **系统设置 → 电池 → 允许后台运行 / 加入省电白名单**
>    否则系统会在息屏后杀掉 Termux 进程，机器人就离线了。

### 首次启动与绑定

启动 `dsh web` 后，若未配置凭据会自动进入**扫码引导**：终端输出二维码 → 手机 QQ 扫码绑定 → 凭据自动保存，重启不丢（设置面板里也可随时「扫码绑定」/改账号）。

![二维码扫码示意图](./docs/assets/qrcode.png)

> **提示**：建议使用 `0.4.0` 以上版本扫码，支持点击链接在浏览器打开，避免部分终端二维码渲染错位的问题。

### 还没有 QQ 机器人？先注册一个（拿 AppID / AppSecret）

1. 打开 [QQ 开放平台](https://q.qq.com)，用 QQ 号登录；
2. 进入「机器人」→「创建机器人」，填好名称、头像、简介；
3. 创建完成后在机器人详情页拿到 **AppID** 与 **AppSecret**；
4. 在 dsh Web → 设置 →「QQ 机器人」→「账号与预设」里填入并保存
   （或设为环境变量 `QQBOT_APPID` / `QQBOT_SECRET`）；
5. 按需在平台开通**单聊/群聊**消息权限（群聊一般需要提交用途审核）。

> 💡 更省事：机器人建好即可，首次启动直接**扫码绑定**，不用手抄凭据。

## 常见问题

### 升级 dsh 0.1.6 后，恢复会话报 `workflow-worker-thread ... cannot be resolved`？

dsh **0.1.6** 把工作流执行器插件**改了名，且不保留别名**：

```
@deepseek-ai/dsh-workflow-worker-thread   →   @deepseek-ai/dsh-workflow-ptc
```

- **用官方预设的人不受影响** —— 官方预设文件随 dsh 升级一起更新（0.1.6 里已是 `workflow-ptc`）。
- **从旧版官方预设「复制」出来的自定义预设会挂** —— 副本不会跟着升级走，仍写着旧名，于是报：

```
preset "xxx" failed to mount: row "workflow-worker-thread"
names a plugin that cannot be resolved: @deepseek-ai/dsh-workflow-worker-thread
```

**修复**：把预设目录 `~/.dsh/.agent-presets/<预设名>/agent.cordis.yml` 里的旧名改成新名（`id` 与 `name` 各一处），或直接跑仓库里的一键脚本：

```powershell
# 先检查（不改任何文件）
pwsh -File scripts/fix-dsh-016-presets.ps1

# 确认后修复（自动备份为 *.bak-dsh016-<时间戳>）
pwsh -File scripts/fix-dsh-016-presets.ps1 -Apply
```

改完重启 dsh 让预设重新挂载。

> 同一批变更里还有几个已改名/移除的包，脚本会一并检测：
>
> | 旧名 | 处理 |
> |---|---|
> | `@deepseek-ai/dsh-code-runtime` | 改名为 `@deepseek-ai/dsh-ptc-runtime` |
> | `dsh-code-runtime-worker-thread` | 已移除，需删行 |
> | `dsh-tool-subagent-report` | 已移除，需删行 |
> | `dsh-agent-spine-demo` | 已移除，需删行 |
>
> ⚠️ 注意：**注释里**提到旧名字不会导致挂载失败（脚本也只检查非注释行）。

### 默认模型是哪个？

dsh 0.1.6 起默认模型为 `deepseek-official/deepseek-flash`（旧的 `deepseek-v4-flash` 已移出默认模型列表）。插件在「什么都没配」时的兜底也已同步为该值；你在设置里显式指定的 provider/model 优先级更高。

### 升级 dsh 0.1.7 后，恢复会话报「预设缺失」/ 机器人不理人？

dsh **0.1.7** 把 Agent 预设从「目录里的 yml 文件」换成了「**profile 配置里的声明行**」：
由 `@deepseek-ai/dsh-agent-preset-registry` + 每个预设一行 `@deepseek-ai/dsh-agent-preset` 组成。
官方明确：**注册表不扫描目录、不接受 preset 路径、没有任何接口接受 YAML 写回** —— 所以旧目录预设**必须迁移**，否则会话日志里记着的 preset ID 找不到定义，**恢复会话会被拒绝**。

**一键迁移**（仓库里 `scripts/migrate-presets-017.ps1`）：

```powershell
# ① 先看看会迁移哪些预设（不写任何文件）
pwsh -File scripts/migrate-presets-017.ps1

# ② 生成「原 patch + 迁移片段」的合并版，核对一眼
pwsh -File scripts/migrate-presets-017.ps1 -Merge -Out "$env:TEMP\cordis.patch.yml.0.1.7-ready"

# ③ 升级 dsh 到 ≥0.1.7 之后启用（⚠️ 顺序不可反！0.1.6 读不了新声明会加载失败）
cd ~/.dsh/profiles/web
Copy-Item cordis.patch.yml cordis.patch.yml.bak-0.1.6
Move-Item "$env:TEMP\cordis.patch.yml.0.1.7-ready" cordis.patch.yml -Force
# 然后重启 dsh
```

> ⚠️ 两个坑（脚本已自动处理）：patch 顶层若是空数组 `[]` 要**先删掉**再粘；新增条目必须用 `- insert:`（写成 `- id:` 会报 `entry not found`）。
> ⚠️ 0.1.7 会把**会话日志升级为 V4（不可回退）**、`settings.yaml` 也只导入一次 —— 升级前记得备份整个 `~/.dsh`。

### 升级 dsh 0.1.7 后，某些插件被「禁用 / 跳过」？

0.1.7 新增了**插件版本兼容检查**（比对各插件的 `peerDependencies`）。钉死在旧次版本的包会被跳过，或整行被禁用：

```
dsh: disabling profile plugin row "mcp-chrome": Plugin ... is incompatible with dsh 0.1.7-rc.1
```

常见两例：

- `@deepseek-ai/dsh-mcp-client@0.0.1-rc.1` → 让所有 `mcp-*` 行失效。**注意官方这个包的 `latest` 标签还停在旧版，`next` 才是新版** → 要显式装 `@deepseek-ai/dsh-mcp-client@0.1.7-rc.1`
- `@dhicoc/dsh-reverse-skill@1.0.5` → 跳过（作者尚未适配 0.1.7）

想强行运行，可用官方提供的**确切版本例外**（`dsh plugin allow-version`，或插件管理页里授予），但官方警告"可能崩溃或数据丢失"，自行权衡。

## 🤖 自定义事件 + 「让 AI 写」（v1.6.7）

普通的互动卡片只能「点按钮 → 回一句固定文本」，能力被编辑器框死。
这一版让卡片**变成一个真的 JS 模块**（可以叫 AI 帮你写），于是它能做到编辑器做不到的事：

- **自己维护状态**：谁点过、点了几次、本轮名单 —— 落盘、升级不丢
- **自己判权限**：QQ 的按钮权限是"整张卡片一个"，但模块里能用 `ctx.user.isOwner` 做到"这个按钮只有主人能点"
- **自己发消息**：文本 / markdown / 图片，还能 @ 某人
- **调 AI**：`ctx.appendSilent()` 静默记进上下文；或 `ctx.appendWake()` **把 AI 叫起来**
- **调官方 API**：模块拿到 `ctx.appId` / `ctx.appSecret`，自己换 token 就能 fetch 任意官方接口

### 📸 长什么样

**① 面板：事件列表 + 「让 AI 写」+ 自定义事件信息区**

![自定义事件面板](docs/screenshots/botplay-custom-event-panel.png)

**② 效果：签到统计 + 结束后唤醒 AI（AI 自己开口总结）**

![唤醒 AI 演示](docs/screenshots/botplay-wake-ai-demo.png)

**③ 那 AI 到底收到了什么？（这就是 `ctx.appendWake` 的内容）**

![AI 收到的唤醒内容](docs/screenshots/botplay-wake-payload.png)

> 事件模块自己决定"什么时候叫醒 AI、告诉它什么"，并顺手把"你只要补一句人话、别复述名单"
> 这种约束一起发过去 —— 所以 AI 的回复才既贴群气氛、又不啰嗦。
> **这一段不是插件写死的，是卡片模块（AI 写的那个 .mjs）自己组织的。**

> 上面第二张就是"第三方框架做不到的事"：**卡片点完后 AI 也知道了结果**，
> 而且它会顺着群里的气氛自己说人话 —— 那段「带头营业（尾巴摇摇）」不是模板文案，是 AI 现场说的。

### 怎么用

1. 面板 → 📤 群发 → **互动事件** → 底部「🤖 让 AI 写自定义事件」输入框
2. 用大白话写你要什么，例如：
   > 我想写一个签到人数统计，有两个按钮，按钮1是签到，所有人都能点且每个人只能点一次；
   > 按钮2是结束，只能我点。我点结束后，bot 发送消息到 QQ 上，统计签到人数和所有签到者的名称
3. 点 **🤖 让 AI 写** —— 面板会把「你的需求 + 官方文档链接 + 契约 + 环境信息」发进当前会话；
   AI 按契约写一个 `.mjs` 放进 `{dataRoot}/.qqbot-extensions/botplay/`，并登记到 `botplay-events.json`
4. 改完模块后，面板点 **🔄 重载模块** 即生效（**不用重启**）
5. 想让它回到普通编辑器：把事件 JSON 里的 `file` 字段删掉即可

### 契约在哪

`docs/botplay-contract.md` —— **纯文本、可直接改**（改完重启宿主生效）。
它定义了模块导出哪些钩子、`ctx` 有哪些能力（含上面那几条），也是「让 AI 写」时发给 AI 的那份说明。

---

## 🧩 扩展工具：自己写 QQ 工具，还能"跨通道"（v1.8.0+）

把 `.mjs` 放进 `{dataRoot}/.qqbot-extensions/tools/`，AI 就能调用它（写完发 `/tools-reload` 即生效，无需重启）。
**默认**：扩展工具**只在 QQ 会话里存在**——别处的会话完全看不到它，所以也不占一点 token。

**加一行 `expose: 'all'`**，它就对**所有会话可见**（web 对话、终端…），并在那边**直接操作 QQ**：

```js
export default {
  name: 'qq_send',
  expose: 'all',
  description: '查 QQ 聊天对象 / 向群或私聊发消息',
  inputSchema: { action: { type: 'string' }, target: { type: 'string' }, text: { type: 'string' } },
  run: async (args, env) => {
    const qq = env.qq;   // 账号包：appId / 群与私聊清单 / sender / sendText / apiCall…
    return { ok: true, msg: (await qq.sendText('group', args.target, args.text)) ? '已发送 ✓' : '发送失败' };
  },
};
```

- 注册名会带上**人设 id**（如 `qq_send__whale-girl`），归属一眼可见；
  ⚠️ **工具名只能用 `[a-zA-Z0-9_-]`** —— 用 `@` 之类的字符会被 LLM API **整轮拒绝**（会让机器人全面瘫痪）。插件现在会**直接拒绝注册**这类名字，不会再把整条链路带崩。
- 发送**被动优先、失败转主动**：先拿目标会话最近的 `msgId` 走被动回复（不吃主动配额、也不被 QQ 吞），失败再去掉 `msgId` 重发。冷群没有被动窗口，会直接走主动。
- **新用户不用自己搬示例**：插件启动时会把自带的 `examples/ext-tools`、`examples/botplay`、`examples/ext-hooks` **只补不覆盖**地铺进你的扩展目录 —— 装上就有能跑的工具（如 `qq_send`）、卡片示例和启动钩子示例。

细节见 **[用户手册](./docs/USER-GUIDE.md)** 的「自定义 QQ 工具」一节。

## 🪝 启动钩子：没人调用也自己跑（v1.8.9+）

前面的扩展都要「有人触发」才动：`commands/` 等用户敲命令、`tools/` 等 LLM 调用、`botplay/` 等人点卡片。
但有些事**没人触发也得跑** —— 恢复上次没跑完的长期任务、注册监听、起定时器、预取数据。
把 `.mjs` 放进 `{dataRoot}/.qqbot-extensions/hooks/`，它就会在**插件启动（apply）时自动执行一次**：

```js
// {dataRoot}/.qqbot-extensions/hooks/my-hook.mjs
export async function run(env) {
  env.logger.info(`插件 v${env.pluginVersion} 起来了；数据根 = ${env.dataRoot}`);
  const timer = setInterval(() => { /* 周期任务 */ }, 60_000);
  timer.unref?.();
  env.registerDispose(() => clearInterval(timer));   // 卸载时收尾
}

export async function dispose(env) {                 // 可选：卸载 / 宿主退出时调用
  env.logger.info('收尾完成');
}
```

三种写法都认：`export function run(env)`、`export default { name, run, dispose }`、`export default async (env) => {}`。

| `env` 字段 | 说明 |
|---|---|
| `ctx` | 插件 cordis Context（`ctx.on()` / `ctx.get()` / `ctx.webServer.register()`…） |
| `logger` / `dataRoot` / `config` | 日志 / 数据根 / 当前实例配置（只读用途） |
| `registerDispose(fn)` | 注册清理函数（与导出的 `dispose()` 一样在卸载时调用，**逆序**执行） |
| `pluginVersion` | 插件版本号（如 `1.8.9`），可按版本分支 |
| `caps` / `store` | 与 tools / commands **同一套能力包**；`store.load()/save()` 落 `hooks/data/<文件名>.json` |

**和 tools / commands 的区别**：钩子**不需要任何人调用**，也不出现在工具列表里（不占 AI 的 token）。
`hooks/` 根下的 `*.mjs` 逐个执行；**子目录不扫描**（与 `tools/` 的既有约定一致，可安全放私有模块）。

**插件侧的硬保证**：

- 单个钩子抛错**绝不影响插件启动、也不影响其它钩子**（逐个独立 try/catch，失败只记警告）；
- 单钩子超时 **30s**，超时只告警并放行 —— 异步钩子拖不死启动（注意：超时不会真的杀掉代码，
  长任务请用定时器/后台异步跑，别直接写在 `run()` 里）；
- `hooks/` 目录**不存在或为空完全安静**（不报错、不刷日志）；每个钩子的名字与结果
  （成功 / 失败 / 超时）都会写进日志。

示例见 [`examples/ext-hooks/`](./examples/ext-hooks/README.md)（`hello-hook.mjs` 最小可跑；
`session-watch-hook.mjs` 演示"注册监听 + dispose 清理"）；插件启动时会自动铺一份到你的扩展目录。
⚠️ 钩子**只在启动时跑一次**（没有热重载），改完要重启插件/宿主才生效。

## 🚦 入站中间件：让扩展管"每条消息的命运"（v1.9.0）

前面四套扩展都要**有人触发**才跑（敲命令 / LLM 调用 / 点卡片 / 启动）。但有些规则得管**每一条**消息：
这条广告别进群、这句敏感话换掉、这条必须叫醒她、这条引用的是子会话转发**不算 @ 她**。

把 `.mjs` 放进 `{dataRoot}/.qqbot-extensions/inbound/` 就生效：

```js
// {dataRoot}/.qqbot-extensions/inbound/my-rule.mjs
export async function onInbound(ctx, next) {   // 早：记群历史之前
  if (isAd(ctx.text)) {
    ctx.silentInto();                          // 内容仍静默进她上下文
    ctx.annihilate({ reason: '广告' });        // 消灭：不进历史/不进上下文/不占冷却
    return;                                    // ★ 不调 next()
  }
  return next();
}
export default async function (ctx, next) {    // 晚：@门控之后
  if (isChildForwardQuote(ctx.state?.quote?.text)) {
    ctx.decide({ mention: 'ignore', reason: '引用子会话转发' });
  }
  return next();
}
```

- **两个挂点**：早（引用解析后、**记群历史之前**）／晚（@门控之后，语义与旧契约一致）；
- **四个动作**：`annihilate` 消灭 · `rewrite` 改写（早挂点连历史一起改）· `forceWake` 跳过 @门控/评分/冷却 ·
  `decide` 覆盖 @ 判定；另有 `silentInto` 静默进上下文、`muteUser` 系列用户维禁言、`kv` 自己的持久化；
- **能力面对面齐平**：入站扩展和另外四套**共用同一套能力包**（`store` / `api()` / `markdown` /
  `appendSilent` / `user` / `kernel` …），入站专属的那组走 `ctx.caps.inbound`；
- **四条保命件**：主人白名单最高优先（不可被消灭/禁言）、强唤醒优先于静默、熔断（扩展失控自动停手）、
  审计 + 可撤销（每次动作一行，带轮转）；
- 目录**不存在或为空完全安静**；单个扩展抛错只告警并放行 —— 你的脚本坏了**永远不会吞掉消息**。

示例见 [`examples/ext-inbound/`](./examples/ext-inbound/README.md)。⚠️ 自动铺到你目录的**只有**
`no-wake-on-child-quote.mjs`（它只改 @ 判定，不动手）；`class-advisor.mjs`（辅导员：删广告/封人/改写/
求助优先）**不会自动铺**，要自己拷 —— 示例是给人**看和抄**的，不该在你没读过它之前就自己跑起来。

> 📘 **写扩展前先读**：[`docs/extension-contract.md`](./docs/extension-contract.md) —— 五套扩展点、
> 统一能力包、入站操控、安全红线和常见坑，一份写全。

## 🔨 锤子面板：禁言 / 踢人（v1.6.3）

dock 面板里的 **🔨 锤子**（原来叫「🔇 禁言」），下面分两页：

| 子页 | 走哪条路 | 说明 |
|---|---|---|
| **🔇 禁言** | 官方 Bot 接口 | 机器人为群管理员即可用，无需任何登录 |
| **👢 踢人** | **你自己的 QQ 号**（群官网接口） | 官方没开放踢人接口，所以这里要登一次 |

### 怎么用（踢人）

1. 面板 → **🔨 锤子** → **👢 踢人** → 点 **📱 刷新二维码**
2. 页面里**直接显示二维码** —— 拿手机 QQ「扫一扫」，**摄像头对着电脑屏幕**扫
   > 腾讯只认摄像头：用相册选图 / 长按识别会提示「本次请求不支持图片识别或长按扫描二维码授权」
3. 扫完自动切到已登录界面：**选群 + 搜成员（uin 精确 / 昵称模糊）+ 点一下 👢 踢**

![🔨 锤子 · 踢人面板：搜「鱼」的结果，每人一个 👢 踢按钮](docs/screenshots/hammer-kick-panel.png)

### 免扫码是怎么做到的

登录成功后凭据存在 `{dataRoot}/qun-cookie.json`。之后每次需要登录时：

```
静默起一个「无头」浏览器 → 把已存的凭据注入进去（CDP Network.setCookie）
→ 页面直接就是已登录状态 → 读出凭据 → 关掉浏览器
```

**全程不弹窗口、不用扫码**。只有第一次（或凭据彻底过期）才要扫一次；`skey` 约 1 天后过期，重登走的也是上面这套静默流程。

> 💡 实测彩蛋：**本机开着 QQ 客户端**时，登录页会直接显示你的头像，点一下就登 —— 连第一次都不用扫。

### 登录态与 AI 共享

面板和 AI 读写的是**同一个** `qun-cookie.json`，所以两边天然同步：

- 你在面板扫码登录 → 直接跟 AI 说「把群里那个 X 踢了」就能用
- AI 先登过 → 你打开面板就是已登录

AI 侧的工具叫 **`qq_group_admin`**：

| action | 作用 |
|---|---|
| `status` | 看登录状态 / 继续等扫码 |
| `login` | 登录（静默优先，需要才给二维码路径） |
| `groups` | 列出你创建/管理的群 |
| `members` | 查成员（uin 精确 / 昵称模糊 / 全量） |
| `kick` | 踢人 —— **必须带 `confirmed=true`**，否则只回一句「请先跟主人核对群和人」 |

### 隐私与进程

- 浏览器用**独立 profile**（在插件数据目录里），**看不到你日常浏览器的任何东西**
- **不常驻**：拿到凭据立刻关；等扫码最多留 5 分钟；宿主退出时会一起带走（不留孤儿进程）
- 凭据只存在你自己的机器上，仓库里不含任何凭据

## 🚫 无上下文模式（按会话省 token）

让某个 QQ 会话**每轮只记得最近几条对话**，更早的历史自动折叠 —— 群聊省 token 利器。

**怎么开**：dock 面板（右下角 🛡）→「⚙ 单会话设置」→ 子标签「🚫 无上下文」→ 勾选 + 填「带 @ 前 N 条」→ 保存。

**几点先说清**（细节见手册）：
- **web 记录不删** —— 只多一行「上下文已压缩」折叠标记
- **N 计的是 dsh 侧的消息条数**，1 条可能含多条 QQ 消息（入站时会聚合）
- **零额外模型调用**（替身文本写死）
- **从下一轮起生效**（压缩发生在回合开始）

📖 完整说明（含易误解点、全局开关、存储位置）→ **[用户手册](docs/USER-GUIDE.md#无上下文模式按会话省-token)**

## ✅ QQ 审批卡片：谁可以点

发起审批的卡片**发到发起者所在的会话**（群里就发到群里），但**只有下列人能点按钮**：
**① 发起者本人　② 主人白名单**（`groupAdmin.owners`）。

> ⚠️ **群聊场景一定要填白名单**：设置 → QQ 机器人 →「允许操作的主人 openid（逗号分隔，可留空=不校验）」。
> 否则别人发起的审批，主人点了没反应。

📖 细节 → **[用户手册](docs/USER-GUIDE.md#qq-审批卡片谁可以点)**

---

## 支持这个项目

如果这个插件帮你省了 token、或者让你家的鲸鱼更活蹦乱跳 —— **给个 ⭐ Star** 就是最实在的支持；有 bug / 想要的功能，欢迎开 [Issue](https://github.com/zaofan-make/dsh-qqbot/issues)。

## License

[MIT](./LICENSE)
