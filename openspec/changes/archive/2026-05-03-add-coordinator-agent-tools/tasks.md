# Tasks

- [x] 阅读并对齐 `docs/AGENTS.md`、`docs/agent-tools.md`、`docs/coordinator-surface.md`、`docs/contracts.md`、`docs/operations.md`、`docs/execution-workspace.md`、`docs/workflow-protocol.md`、`docs/observability.md`。
- [x] 新增 `coordinator-agent-tools` OpenSpec delta。
- [x] 补 DB repository 中 execution plan 与 human request 所需最小方法。
- [x] 实现 Core `CoordinatorAgentToolExecutor`。
- [x] 实现 artifact path 校验与窄参数解析。
- [x] 接入 `createAttemptWorkspace`、`startWorkflowRun`、`inspectWorkflowRun` 等已有 service。
- [x] 提供 CLI/API operator 调试入口。
- [x] 补充单测/contract tests，覆盖可见性 gate、artifact path、工具事件、失败语义和不读写 `.workflow`。
- [x] 运行 `openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- [x] 交给独立 `gpt-5.5 high` subagent review，并修复必须问题直到通过。
- [x] 归档 OpenSpec change，更新 roadmap 与必要设计文档，提交改动。
