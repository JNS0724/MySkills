# sdd-doc-sync

**轻量级 demo 插件**：vibe coding 时让**代码不要悄悄领先文档**。

## 解决的一个场景

用 SDD（spec-driven）开发，前期写了 `design.md` / `tasks.md`，进入编码后却滑进 vibe coding，不再回头同步文档 → **代码领先于文档**，越拖越对不上。

本插件只做一件事，机械地：

1. 每次改**代码文件**，把它登记到仓库根的 `.sdd-doc-sync.md`（待评审清单）；
2. 收尾（Stop）时，如果还有未评审的改动，用一段**强硬的结构化提示词**拦一下，逼模型**自己去读这些代码 + 对应 `design.md`/`tasks.md`**，逐项取证对照；
3. 代码领先文档 → 敦促模型**直接改文档同步**；一致/无关 → 在清单里把 `[ ]` 勾成 `[x]` 并附依据。勾选行就是**评审记录**。

> 偏差判断、是否要改文档，全由模型决定（工具不做语义判断）。工具只保证"该评审的材料被可靠地端到模型面前，并留下痕迹"。

## 它**不做**什么（刻意保持轻量）

- ❌ 不注入 git diff（让模型自己读文件）
- ❌ 不做内容哈希 / ledger（清除靠你/模型勾选复选框，不靠哈希）
- ❌ 无第三方依赖、无构建步骤；Claude Code / OpenCode 各一个入口，核心逻辑复用同一个 `sdd-doc-sync.js`

需要哈希追踪、跨版本防误清、change-note 线索、多平台等更强能力，见隔壁 [`sdd-review-ledger`](../sdd-review-ledger)。本插件是验证"用户是否关注这个场景"的最小试水。

## 安装（Claude Code）

把 `sdd-doc-sync.js` 放到你项目能访问的位置（例如拷进项目的 `.claude/hooks/sdd-doc-sync/`），然后在项目的 `.claude/settings.json` 注册三个 hook（都指向同一个文件）：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node .claude/hooks/sdd-doc-sync/sdd-doc-sync.js" } ] }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [ { "type": "command", "command": "node .claude/hooks/sdd-doc-sync/sdd-doc-sync.js" } ]
      }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node .claude/hooks/sdd-doc-sync/sdd-doc-sync.js" } ] }
    ]
  }
}
```

- `UserPromptSubmit`：记一份本轮提示词，给登记项打"在做哪个任务"的标签（可选，但更有线索）。
- `PostToolUse`（`Edit|Write|MultiEdit`）：把受改代码登记进清单（**不打断你**）。
- `Stop`：收尾前，有待评审就拦一次让模型评审同步。

只在**含 `sdd/changes/<change>/`（或 `.sdd/changes/`）且有 `design.md`/`tasks.md`/`proposal.md` 的项目**里生效；其它项目全程静默。

## 安装（OpenCode）

OpenCode 入口是 `sdd-doc-sync-opencode.js`，它会复用 `sdd-doc-sync.js` 里的核心逻辑。

项目级安装示例：

```powershell
New-Item -ItemType Directory -Force .opencode\plugins
Copy-Item E:\coding\sdd\SDD-plugins\plugins\sdd-doc-sync\sdd-doc-sync-opencode.js .opencode\plugins\sdd-doc-sync-opencode.js -Force
$env:SDD_DOC_SYNC_CORE = "E:\coding\sdd\SDD-plugins\plugins\sdd-doc-sync\sdd-doc-sync.js"
opencode
```

`SDD_DOC_SYNC_CORE` 用来指向原来的 Claude/core 文件，这样 `.opencode/plugins/` 里只需要放 OpenCode 入口文件。源码目录内开发或测试时，如果两个文件同目录，也可以不设这个变量，入口会默认 `require("./sdd-doc-sync")`。

OpenCode 映射关系：

- `chat.message`：记录本轮用户提示词，后续登记项会带上这个任务标签。
- `tool.execute.after`：捕获 `edit` / `write` / `multiedit` / `patch` / `apply_patch`，登记受改代码文件。
- `session.idle` / `session.status: idle`：发现 `.sdd-doc-sync.md` 仍有 `[ ]` 时，通过 `session.promptAsync` 自动向同一会话发送收尾评审提示，不依赖用户再手动触发下一轮。

## 生成的文件（建议加进 `.gitignore`）

- `.sdd-doc-sync.md` — 待评审/已评审清单（人可读、模型可编辑）。`- [ ]` = 待评审，`- [x] … — 理由` = 已评审记录。
- `.sdd-doc-sync-state.json` — `{ "lastPrompt": "…" }`，仅作打标签用。

```gitignore
.sdd-doc-sync.md
.sdd-doc-sync-state.json
```

## 动态增加评审要求（小 trick，可选）

在仓库根放一个 **`.sdd-doc-sync-rules.md`**，里面写本项目的额外评审要求（一行一条），它会被**原样注入**到 Stop 评审提示词的「本项目附加评审要求」段——插在待评审清单之后、通用评审纪律之前（靠前更易被遵循）。**改文件即生效**，下次 Stop 就用新内容，无需重启。

可以先复制本插件附带的极简示例：`plugins/sdd-doc-sync/.sdd-doc-sync-rules.example.md` → 仓库根 `.sdd-doc-sync-rules.md`，再按项目约定微调。

```markdown
- 公共 API 改动必须更新 design.md 的接口表
- 任何新增配置项要写进 tasks.md 的配置清单
- 涉及鉴权的改动，design 里要有对应的威胁模型说明
```

- 也可以用环境变量指定别的路径：`SDD_DOC_SYNC_RULES_FILE=docs/review-rules.md`（相对路径按仓库根解析；env 优先于约定的默认文件）。
- 这份规则文件是**项目资产**，通常要 **git 提交**（团队共享），不要加进 `.gitignore`。
- 上限约 4 KiB，超长会在提示词里显式标注「已截断」（不静默丢）。内容仅供参考，**是否偏差仍由模型判断**（不改变勾选清除逻辑）。

## 工作流（你会看到什么）

1. 你让模型改代码，模型一通 vibe coding，文档没动。
2. 模型想结束这一回合 → 被 Stop 拦下，收到结构化评审清单：逐个文件「读代码 → 读 design/tasks → 是否一致 → 结论」。
3. 模型发现代码领先 → 直接编辑 `design.md`/`tasks.md` 同步；或判定无关 → 在 `.sdd-doc-sync.md` 勾掉并写明依据。
4. 清单清空后，回合正常结束。再改代码，循环重来。

## 约束 / 已知简化

- **每条 stop 链至多拦一次**（`stop_hook_active` 守卫，不会卡死循环）。
- **不靠哈希**：已评审文件再次被改 → 清单里那行从 `[x]` 翻回 `[ ]` 触发重评（in-place，不留旧记录的历史；要历史请用 `sdd-review-ledger`）。
- **永不阻断报错**：stdin/读写/解析任何异常都静默 `exit 0`，不会把错误抛给你。
- 路径/理由渲染前都做消毒（剥离换行、控制符、bidi-override），避免内容把提示词结构带歪。

## 开发

```bash
npm test   # node --test：纯函数单测 + handleEvent 集成测（临时目录），无依赖
```
