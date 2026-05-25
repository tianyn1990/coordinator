## Why

当前真实 Web E2E 已能从 Web 创建 task 并启动 workflow run，但 workflow 停在 `requirements` 阶段后只能展示 `allowedActions`，缺少由 operator 确认后继续推进的闭环。现在需要把 workflow 的 operator-facing action hint 转成 Task Cockpit 中可执行的人工确认卡片，同时保持 Core 是唯一策略校验与副作用执行入口。

## What Changes

- 在 Task Cockpit 中新增 Workflow Action Panel，将 active workflow projection 中的 `allowedActions`、`actionInputs`、`progress` 与 `stageArtifacts` 转成 operator action card。
- 新增或收敛 Core operator-facing workflow action helper：调用前重新校验 workflow run、expected state version、allowed/denied action 与最多一个 string arg。
- 在 API 中提供 `POST /workflow-runs/:workflowRunId/actions` operator-only endpoint，Web 只提交 operator intent，不直接调用 workflow CLI。
- 支持第一版 action 输入：无参 action 与 `actionInputs.requiredArgs` 中 1 个 string arg；复杂输入继续留给 workflow artifact/surface，而不是进入 Coordinator 参数。
- action 成功后刷新当前 task，并可由 Web 继续触发 task-scoped `Run until blocked`；daemon/outer Agent 仍不得自动执行 workflow action。
- 为 Workbench task card 和 Open 按钮增加稳定 selector 与可访问 label，方便真实 Web E2E。
- 改善 Web `Run until blocked` banner 的 task-scoped/global 展示，避免历史任务失败掩盖当前 task 的推进结果。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `workflow-protocol-adapter`: 增加 operator-confirmed workflow action helper 的校验契约，明确 action 只能由 operator intent 经 Core 执行，不进入 daemon 或 Coordinator Agent Surface。
- `web-human-review-surface`: 增加 Task Cockpit Workflow Action Panel 与 Web action endpoint 调用契约，明确 Web 展示/提交 intent 但不成为 truth source。
- `operator-task-controls`: 调整 Web `Run until blocked` 展示契约，区分 task-scoped 与 global 结果，并保持不自动执行 workflow action。

## Impact

- `packages/core`: 新增 operator-facing helper、校验与单测，复用既有 `invokeWorkflowAction` 与 operation/idempotency/lock/fencing。
- `apps/api`: 新增复数 `/workflow-runs/:workflowRunId/actions` endpoint，并保留或兼容现有 operator-only action API。
- `apps/web`: Task Cockpit 新增 Workflow Action Panel、action submit/refresh/run 逻辑，task card 增加稳定 selector，RunUntilBlocked banner 改善 scope 展示。
- `openspec/specs`: 更新 workflow protocol adapter、Web operator surface、operator task controls 的需求。
- 不新增外部依赖，不修改 workflow private state，不改变 PR/MR/merge human approval gate。
