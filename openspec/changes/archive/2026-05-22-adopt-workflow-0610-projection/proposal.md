## Why

`@hetao-ai/workflow@0.6.10` 已稳定在 `workflow protocol status` 与成功的 `workflow protocol action` post-action projection 中输出 `progress` 和 `stageArtifacts`。Coordinator Web Task Cockpit 已按设计准备展示这些字段，但当前 `Workflow Protocol Adapter` 只持久化 `stage/substate/gate/allowedActions/deniedActions/actionInputs`，会在 adapter 层丢失新 projection。

本轮要补齐 Coordinator 对 workflow 0.6.10 projection 的受控消费链路，让 Web 能看到 workflow 内部进度摘要和阶段 artifact 引用，同时保持这些字段只服务 operator/display，不进入外层状态机或 Agent Surface。

## What Changes

- 扩展 `WorkflowStatus` 类型与 parser，解析 `progress` 和 `stageArtifacts`。
- 将 `progress` 和 `stageArtifacts` 写入 workflow status/start/action event payload，供 Task Cockpit Workflow Lens 使用。
- 保持 `actionInputs` 继续收窄为 `actionInputHints`，不把 raw `actionInputs` 写入 event payload。
- 增加 contract tests，覆盖 status 与 action projection 中的新字段保留、展示边界和非状态机语义。
- 不新增 workflow action，不读取 `.workflow` private state，不让 daemon 根据 `progress/stageArtifacts/actionInputs` 自动推进。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `workflow-protocol-adapter`: 明确 workflow 0.6.10 projection 中的 `progress` 和 `stageArtifacts` 必须被 adapter 作为 operator projection 持久化。
- `observability`: 明确 Workflow Lens 可以展示 adapter 持久化的新 projection，但不得驱动外层状态或自动 action。

## Impact

- Affected code:
  - `packages/core/src/workflow-protocol-adapter.ts`
  - `packages/core/src/workflow-protocol-adapter.test.ts`
- Affected docs/specs:
  - `openspec/specs/workflow-protocol-adapter/spec.md`
  - `openspec/specs/observability/spec.md`
  - `docs/roadmap.md` 完成后更新进度。
- Systems:
  - Coordinator Core 仍只用 `lifecycle/handoff/artifacts/recovery/summary` 推进外层状态。
  - Web 仍只从 Core/API 持久化的 event projection 展示 workflow 内部进度。
