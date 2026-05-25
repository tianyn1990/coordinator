## Why

Iteration 14 已经把 Web workflow action loop 从“所有 allowedActions 都是人工待办”修正为“只展示真正 operator-facing gate”。下一步需要把这个判断统一沉淀成 Coordinator 侧的 workflow runtime / inner agent lifecycle observation，避免 Web、daemon 和 operator summary 各自重复推导时再次把 `materialize-change <change-id>` 等内部推进动作误报为 needs-me。

## What Changes

- 增加 operator-only 的 workflow runtime observation 投影，用现有 workflow status、handoff、action classification、agent activity 和 Core facts 派生 next owner / mode / reason 摘要。
- Web Task Cockpit、Action Inbox 和 Run Until Blocked 使用该投影表达 observing、operator gate、handoff ready、recovery attention 等状态；agent/internal action 只进入 Workflow Lens debug/detail。
- daemon/watchdog 继续只读 inspect running workflow，并把 internal/debug allowedActions 视为 runtime observation；不得创建 human request、operator attention 或自动 workflow action。
- Coordinator Surface 保持收窄：workflow runtime observation 可以作为短摘要出现，但不得新增 workflow action executor、operator-only tool 或 SDK raw event。
- 整理未来 workflow 工程交接建议，说明后续可选 protocol 增强如 `agent.state`、`blocker.owner`、`operatorActions`、`agentActions`，但当前版本不依赖也不修改 workflow protocol。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `workflow-protocol-adapter`: 增加 Coordinator 侧对现有 protocol projection 的 owner/mode 解释规则，明确不修改 workflow protocol。
- `observability`: 增加 operator-only workflow runtime observation 摘要展示契约。
- `web-human-review-surface`: 要求 Task Cockpit / Action Inbox 使用 observation 投影，只把 operator gate 放入 needs-me。
- `operator-task-controls`: 收紧 Run Until Blocked 停止原因，区分 observing runtime 与真正 operator gate。
- `daemon-runtime`: 明确 running workflow + internal/debug action 只产生 observation，不创建人工 blocker。
- `coordinator-surface`: 明确 workflow runtime observation 不扩大 agent-facing tool visibility，也不泄漏 raw/provider/debug payload。

## Impact

- 影响 `packages/core` 中 workflow projection/action classification 的 operator summary 派生、daemon observation 和 surface 摘要。
- 影响 `apps/api` task detail 返回的 operator-only workflow observation summary。
- 影响 `apps/web` Task Cockpit、Workflow Lens、Action Inbox 和 Run Until Blocked banner 展示逻辑。
- 影响 `docs/` 中 workflow agent lifecycle、workflow protocol future handoff 和 roadmap 的统一表述。
- 不修改 `/Users/hetao/Documents/github/workflow`，不修改 workflow protocol，不新增 SDK 依赖，不让 daemon/outer Agent 自动执行 workflow action。
