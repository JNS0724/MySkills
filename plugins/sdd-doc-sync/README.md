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
- ❌ 无第三方依赖、无构建步骤、无 OpenCode 适配——就一个 `.js`

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

## 生成的文件（建议加进 `.gitignore`）

- `.sdd-doc-sync.md` — 待评审/已评审清单（人可读、模型可编辑）。`- [ ]` = 待评审，`- [x] … — 理由` = 已评审记录。
- `.sdd-doc-sync-state.json` — `{ "lastPrompt": "…" }`，仅作打标签用。

```gitignore
.sdd-doc-sync.md
.sdd-doc-sync-state.json
```

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
