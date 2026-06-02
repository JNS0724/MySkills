# sdd-review-ledger

vibe coding 时，**自动化辅助评审** SDD 文档↔文档、代码↔文档之间的偏差。

与上一代 `sdd-drift-check` 的根本区别：本项目**不让工具去"算偏差"**（偏差是语义判断，没有确定性算法能算出来），而是把工具重新定位为「**评审编排器 + 评审记录（即 ledger）**」——每次变更后，可靠地把材料端到整个回路里唯一够格的语义裁判（也就是 agent 本身）面前，请它评审，再用内容哈希记住这次的评审结论。偏差判断永远由 LLM 来做。

## 状态

**MVP 已实现（Claude Code + OpenCode 双入口）。** M1 核心纯函数 + M2 管线 + M3 Claude Code 适配器 + M4 OpenCode native adapter 已完成，234 个测试通过。发布件：

- `sdd-review-ledger-hook.js`：Claude Code command hook
- `sdd-review-ledger-opencode.js`：OpenCode native plugin

- 安装与使用：[`docs/getting-started.md`](./docs/getting-started.md)
- 架构方案（讲清各项决策与"为什么"）：[`docs/sdd-review-ledger-architecture.zh.md`](./docs/sdd-review-ledger-architecture.zh.md)（v0.3）
- 详细设计（指导开发的"怎么做"）：[`docs/sdd-review-ledger-detailed-design.zh.md`](./docs/sdd-review-ledger-detailed-design.zh.md)（v0.3）
- **修订 R1 — 去掉对 git 状态的依赖**（候选发现改用工作树扫描；触发逻辑恢复为以 `(工作树,账本)` 为输入的真·纯函数；修复 commit 边界处误判成"已评审"（false-clean）的盲区）：[`docs/sdd-review-ledger-git-independence.zh.md`](./docs/sdd-review-ledger-git-independence.zh.md)
- **修订 R2 — 从 GateGuard 总结出可借鉴的边界**（DENY×FORCE 真正起作用的部分与"永不阻断"互斥，这一点诚实写进 §10；FactGate 那条折中的中间路违反 §2 故拒绝；采纳逃生阀总开关 / session-key 回退 / Windows rename 重试 / 批次边界 / 路径消毒 / 把 §9.2 推送模板改成强制先取证再下结论（fact-forcing）的写法）：[`docs/sdd-review-ledger-gateguard-lessons.zh.md`](./docs/sdd-review-ledger-gateguard-lessons.zh.md)
- DeepSeek 真实模型 7 步交叉流程实测报告：[`docs/sdd-review-ledger-real-model-report-2026-05-31.zh.md`](./docs/sdd-review-ledger-real-model-report-2026-05-31.zh.md)
- 真实使用体验报告（提醒偏密与降噪建议）：[`docs/sdd-review-ledger-ux-report-2026-06-01.zh.md`](./docs/sdd-review-ledger-ux-report-2026-06-01.zh.md)
- 多场景真实模型验证报告（P01-P18，DeepSeek/MiniMax × single/split）：[`docs/sdd-review-ledger-multi-scenario-verification-report-2026-06-02.zh.md`](./docs/sdd-review-ledger-multi-scenario-verification-report-2026-06-02.zh.md)
- MVP 首发范围（先做什么 / 砍什么 / 验收闸门）：详细设计 [§十六 MVP 切割](./docs/sdd-review-ledger-detailed-design.zh.md)

## 一分钟理解

- **工具保证**（机械部分）：用内容哈希追踪变更；编辑时在工具结果里端出"该评审的材料"；同时落到人能直接看到的 `.sdd-review-todo.md` 做保底；跨会话有效、对子代理透明、永不阻断。
- **工具委托**（语义部分）：是否真的偏差了 / 文档要不要改 / 这次变更归到哪个 change-dir → 全部交给 agent。
- **工具诚实标注做不到的事**：它不保证"代码真的符合 design"——评审质量 = LLM 质量。它只保证"评审被可靠地端到裁判面前，并留下痕迹"。

设计由来，以及那些被推翻的旧方案，见架构文档 §11。

## 开发

```bash
npm install        # 装 esbuild（仅打包用）
npm test           # 跑全部单测 + 集成测（node --test）
npm run build      # 打包出两个发布件：hook.js + opencode.js
npm run build:check  # 校验发布件与源码同步（字节级）
```

源码在 `src/`（CommonJS，无运行时依赖）：`src/core/` 纯逻辑可单测，`src/pipeline.js` 单次运行主干，`src/handlers/` + `src/dispatch.js` + `src/adapters/{claude-code,opencode}/` 平台适配。构建顺序与里程碑见详细设计 §15/§16。

> **评审理由质量**（度量诊断 / 离线打分台 `test/eval/score-rationale.js` / 可选的 min-length 理由门）与全部环境变量开关，见 [`docs/getting-started.md`](./docs/getting-started.md) 的「评审理由质量」「常用开关」两节。`npm test` 需 Node ≥ 21。
