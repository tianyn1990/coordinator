## Why

真实 outer Codex Agent + daemon tick + 隔离 workspace + workflow start 的 smoke 已验证 coordinator 能通过 Surface 和受控 tools 推进到 running workflow。但复盘也暴露出几个影响长期无人值守稳定性和 operator 理解成本的问题：

- running workflow 已暴露 `allowedActions` / `actionInputHints` 等 debug 信息，但 daemon 和 Coordinator Agent 的边界需要更明确：这些信息只能用于观察和调试，不能驱动 daemon 自动执行 workflow action。
- Outer Agent 在不需要 artifact 的推进步骤中仍可能输出 `coordinator-artifact`，造成 `execution-plan.md` 被重复覆盖，削弱计划 artifact 的审计含义。
- running workflow surface 的上层语义还可以更清楚地表达“inspect 或等待 handoff”，避免 agent 把 workflow 内部 action 当作 Coordinator 下一步。
- timeline 中 artifact、agent session、workspace、workflow event 分散，operator 需要一个轻量执行链路摘要来快速理解任务进展和产物。

这些优化不改变 coordinator 的核心状态机，不扩大 agent-facing tools，而是把已确认边界和真实 smoke 中暴露的可观测性问题收敛为一个 P1/P2 hardening 切片。

## What Changes

- 在 docs/roadmap 中登记 `Slice 12.7: workflow running 观察边界与 smoke 可观测性优化`，说明目标、边界和验收建议。
- 强化 daemon/workflow protocol 文档和规格：running workflow 只通过 protocol status inspect/reconcile；`allowedActions`、`actionInputHints`、stage/gate 仍为 operator/debug 字段，不驱动自动 action。
- 优化 Coordinator Agent prompt，明确只有 artifact-based tool 或真实计划/报告修订才输出 `coordinator-artifact`。
- 优化 running workflow Coordinator Surface 文案，推荐 inspect/等待 handoff，不暗示可由外层推进 workflow action。
- 在 daemon artifact bridge 中记录“额外 artifact 写入”debug event，用窄 payload 标记 artifact 对当前 tool 是否必要。
- 新增 operator-only 轻量执行链路摘要能力，按 task / attempt / workspace / agent sessions / coordinator tools / workflow / artifacts 分组展示当前事实。
- 明确 workflow action executor 暂不进入 agent-facing surface，也不由 daemon 自动执行；未来如需要，只能通过独立设计优先作为 operator/debug 能力讨论。

## Capabilities

### New Capabilities

- `observability`: operator-only execution summary，用于真实 smoke 和排查时分组理解 task、workspace、agent、workflow、artifact。

### Modified Capabilities

- `daemon-runtime`: running workflow reconciliation 必须保持 inspect-only，不得因 workflow debug action hints 自动执行 action；额外 artifact 写入需要可观测。
- `workflow-protocol-adapter`: `allowedActions/actionInputHints` 继续只服务 operator/debug display，不驱动外层状态机。
- `coordinator-surface`: running workflow surface 文案必须表达 inspect/等待 handoff，并继续收窄 available tools。
- `agent-provider-runtime`: prompt 必须约束 artifact block 的使用时机，减少非必要 plan 覆盖。

## Impact

- 影响 `docs/roadmap.md`、`docs/daemon.md`、`docs/workflow-protocol.md`、`docs/observability.md`。
- 影响 `packages/core/src/agent-provider-runtime.ts`、`packages/core/src/surface.ts`、`packages/core/src/daemon-runtime.ts`。
- 可能新增 operator summary Core 模块与 CLI/API 入口。
- 影响对应单测和 OpenSpec specs。
- 不新增 npm dependency，不新增 SQLite migration，不新增 agent-facing workflow action tool，不改变 workflow private state 边界。
