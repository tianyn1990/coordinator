## Why

真实 Web smoke 已证明 Web -> Core -> workflow protocol action 的受控链路可用，但 `freeze-requirements` 这类人工 gate 目前只展示 action 和 workflow stage，缺少开发者确认所需的 coding agent 可见输出。继续允许盲点确认会把 Coordinator 变成 workflow 遥控器，也会增加多 workflow 管理时的人类负担。

## What Changes

- 增加 Coordinator 侧 workflow gate evidence 派生能力：以 SDK-observed coding agent 可见输出为主，以 workflow protocol status/projection 为结构化事实补充。
- 新增 operator-only API 查询 workflow run gate evidence；Web 在 Workflow Action Panel 中展示 evidence，并在 evidence 缺失时禁用确认按钮。
- Core operator workflow action helper 在执行 operator-facing workflow action 前校验 gate evidence，避免 Web/API 盲确认。
- 文档统一：SDK 是 agent 输出来源，workflow protocol 是 workflow 状态来源；本期不修改 workflow protocol，不读取 `.workflow` private state。
- 保持 daemon/outer Agent 不能自动执行 workflow action 或 human gate；raw SDK events 仍只作为 debug artifact/normalized summary。

## Capabilities

### New Capabilities

- `workflow-gate-evidence`: 定义 Coordinator 如何从 agent session 与 workflow protocol projection 合成 operator gate evidence，并控制 Web/API 确认边界。

### Modified Capabilities

- `agent-provider-runtime`: 补充 SDK 可见输出作为 gate evidence 来源的 provider runtime 契约。
- `web-human-review-surface`: 要求 Workflow Action Panel 展示 gate evidence，并在 evidence 缺失时阻止盲确认。
- `observability`: 补充 gate evidence 的 artifact/ref、normalized message 与 debug transcript 分层展示契约。
- `workflow-protocol-adapter`: operator-facing workflow action helper 必须校验 gate evidence；workflow protocol 仍只提供结构化状态。

## Impact

- Affected docs: `docs/workflow-agent-lifecycle-handoff.md`、`docs/web-developer-workbench.md`、`docs/observability.md`、`docs/execution-workspace.md`、`docs/workflow-protocol.md`、`docs/roadmap.md`。
- Affected Core/API/Web: workflow gate evidence runtime、API endpoint、Web V2 Focus Drawer Workflow Action Panel、operator workflow action helper tests。
- No workflow project changes. No workflow protocol schema changes.
- No new external dependencies; existing `@openai/codex-sdk@0.133.0` and `@anthropic-ai/claude-agent-sdk@0.3.150` capabilities are sufficient.
