<div align="center">

<img src="icon.svg" width="88" height="88" alt="错题本图标">

# 错题本 · Wrong Answers

**理科错题本，一个 DSH（DeepSeek Harness）Web 插件。**

用 Markdown / LaTeX 记下每道错题，按科目与考点整理，到期复盘，
再用 AI 生成 2–3 道同考点、略难的变式题。

[![License](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DSH%20Web-4d6bfe)](#要求)
[![Module](https://img.shields.io/badge/module-ESM%20·%20no%20build-lightgrey)](package.json)

</div>

安装后出现在 DSH 左侧面板列表（书本图标），点击占满中间主区域。界面只使用宿主的主题 token，跟随 DSH 的亮 / 暗主题。

## 功能

### 1. 添加错题

六个字段：**科目、标签（考点）、题目名称、题目、答案、错因**。

题目 / 答案 / 错因都是 Markdown，支持 `$...$` 行内与 `$$...$$` 独立 LaTeX 公式；编辑时可在「编辑 / 预览」间切换，并提供加粗、斜体、公式等快捷按钮。其中一处细节是答案默认遮住、点击才展开——见下一节。

### 2. 错题复盘

- 目录里每道题直接显示**上次复习时间**，题目页顶部也显示。
- 进入题目页先看题目，**答案默认遮住**，点「点击显示答案」才展开；首次展开会自动记录一次复习，也可以手动「标记为已复习」。
- 题目页右侧显示科目、标签、添加时间、上次复习、复习次数与本题的推荐记录。

### 3. 错题整理

主区域左侧是「科目 → 标签」两级目录，右侧是对应题目列表。

- 支持关键词搜索（题目名称、题目、答案、错因）。
- 题目**不能拖动排序**，固定按添加时间倒序，避免目录结构被手动顺序破坏。
- 新增题目会即时反映到目录计数上。

### 4. 好题推荐（AI）

读取这道题的**题目 + 错因**，调用当前 DSH 默认模型，生成 2–3 道同考点、难度略高的变式题，每题附完整解答。

- 生成按钮上方明确标出本次请求的**模型、提供方与思考强度**，不会出现「不知道是谁答的」。
- 属于一次性动作：结果落在这道题下，**每道题只生成一次**；已生成后按钮变为查看入口。
- 点击推荐条目在弹窗里查看题目与答案，**不会离开当前题目页**。
- 失败不写入记录，可调低思考强度后重试。

## 要求

- DSH（DeepSeek Harness）桌面版 / Web，带 `locale`、`webServer`、`connection`、`llm` 服务的构建。
- 推荐功能需要一个可用的默认模型（`agentDefaultModel` 有值且 `llm` 能解析到它）。模型不可用时只有右侧推荐卡片降级，错题本本身照常可用。

## 安装

### 从本地目录安装（推荐）

```bash
git clone https://github.com/Mason233Hello/dsh-wrongbook.git
```

然后在 DSH 里打开 **插件管理 → 安装 Bundle**，选择刚克隆下来的目录（或填写 `file:/绝对路径/dsh-wrongbook`）。

安装后**重启一次 DSH**：宿主半的模块在一个进程里只加载一次，不重启会继续跑旧代码。

### 手动安装（非桌面版）

命令行版 DSH 可以直接把它挂进 profile：

```bash
cd "$DSH_HOME/profiles/web"
pnpm add file:/绝对路径/dsh-wrongbook
```

再把包名 `@local/dsh-wrongbook` 加入 `package.json` 的 `dsh.profile.bundles` 数组，重启。

> 桌面版的 `node_modules` 由 App 按 generation 管理，直接改会被覆盖，请走插件管理器。

### 更新

改动 `client.js` 后重新安装、刷新页面即可；改动 `index.js` 必须重启 DSH。

## 数据

所有错题保存在一个 JSON 文档里：

```
$DSH_HOME/wrongbook/questions.json      # 默认 ~/.dsh/wrongbook/questions.json
```

- 环境变量 `DSH_WRONGBOOK_FILE` 可以指向别处。
- 写入用「临时文件 + rename」，不会写坏原文件。
- 文件损坏时会改名备份为 `questions.json.corrupt-<时间戳>`，然后以空本启动。
- 备份 / 迁移只需要复制这一个文件。

界面记忆（当前看到哪道题、科目与标签筛选、搜索词）存在浏览器 localStorage 里，并绑定宿主实例：**DSH 重启后自动回到目录首页**。

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `DSH_WRONGBOOK_FILE` | 覆盖数据文件路径 |
| `DSH_WRONGBOOK_MAX_OUTPUT_TOKENS` | 给推荐请求设置 `max_tokens` 上限；默认不设，沿用普通会话同款的模型预算 |

## 实现

- **Host**（`index.js`）：JSON 存储、浏览器 RPC、模型调用。RPC 路由直接注册在 `ctx.webServer` 上（前缀 `/x-wrongbook`），鉴权调用 `ctx.connection.admit()`，也就是和 `/api` 同一套 Host/Origin 校验 + 浏览器会话；线格式是通用的 Connection RPC 信封，所以 Client 端仍然用 `connection.rpc.call()`。
- **`ctx.connection.rpc.handle()` 在本版不可用**：它在内部读取 `owner.webServer`，会被 Cordis 注入守卫拒绝（`cannot get property "webServer" without inject`）。需要自定义通道时按上面的方式自己注册路由。
- **加载与推荐解耦**：`hello` 只返回错题和一个不解析适配器的模型路由，书本秒开；模型能力（名称、推理等级）由独立的 `model` 调用在后台解析（10s 超时），失败只影响右侧推荐卡片。
- **模型调用**：模型来自 `ctx.agentDefaultModel`，推理等级来自 `ctx.llm.resolveModelInfo()`，生成为 `ctx.llm.stream()`，边流式返回边判定完整性——流里一出现完整 JSON（≥2 题）就提前关闭流，避免思考型模型把预算耗在思考上导致输出被截断。
- **渲染**：复用宿主 `MarkdownText` 基元（GFM + `$...$` / `$$...$$` + KaTeX）。注意它是 `React.memo` 组件，运行时是对象而不是函数，不能拿 `typeof === 'function'` 判断可用性。
- **Client**（`client.js`）：注册 `main` 面板（key `wrongbook`）与 `sidebar.panellist` 入口，语言包在 `locale/*.json`，样式带 `wqb-` 前缀，只用 `--dsw-alias-*` / `--dsw-radius-*` 主题 token。

## 已知限制

- 推荐结果按「每题一次」存在题目记录里，没有「重新生成」入口（这是刻意设计，避免刷题式重复调用）。
- 目录不支持自定义排序、标签不支持重命名（改名等于新建标签）。
- 这是个人向插件，没有 CI 与端到端测试；验证方式是宿主路由行为测试加上真实 DSH 里的手动回归。

## English

A science wrong-answer notebook for [DSH](https://github.com/deepseek-ai) (DeepSeek Harness), shipped as a plugin.

Record a problem with subject, tag, title, question, answer and error analysis — the last three rendered as Markdown with inline/block LaTeX. Review mode hides the answer until you ask for it and stamps the review time. A subject → tag directory organizes everything, and a one-shot AI action asks the current default model for 2–3 harder variants of the same topic, with full solutions, showing which model and reasoning effort answered.

Data lives in a single `questions.json` under `$DSH_HOME/wrongbook/`. See [安装](#安装) for installation and [实现](#实现) for the architecture notes.

## License

[MIT](LICENSE) © 2026 Goman
