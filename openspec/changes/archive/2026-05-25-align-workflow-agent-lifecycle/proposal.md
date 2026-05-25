## Why

当前 Web workflow action 闭环已经证明 Web -> Core -> workflow protocol action 的受控调用链路可用，但它把所有 workflow `allowedActions` 过早等同为 Web Action Card，导致 `materialize-change <change-id>` 这类 workflow / inner coding agent 内部推进动作被推给开发者手动填写参数。

本轮要把 Coordinator 收敛回“多个 workflow run / agent session 的管理者、观察者、恢复者和人工 gate 收件箱”：Web 只展示真正 operator-facing gate；agent/internal action 只作为 Workflow Lens debug/detail 展示。本期不修改 `/Users/hetao/Documents/github/workflow`，也不要求 workflow protocol 新增字段。

## What Changes

- 在 Coordinator Core 中定义保守 workflow action classification：
  - operator-facing：`freeze-requirements`、`approve-planning-dossier`、`approve-review` 和明确 approval/merge 类 gate。
  - agent/internal：`materialize-change`、`run-alignment-checks`、repair/current-change、inspect/resume 和实现推进类 action。
  - unknown：默认 debug-only，不进入 needs-me。
- Core operator workflow action helper 在执行前除了校验 latest status、expected state version、allowed/denied action 和 action input hint，还必须校验 action 是 operator-facing。
- API `POST /workflow-runs/:id/actions` 继续作为 operator-only 入口，但不得接受 agent/internal 或 unknown action。
- Web Task Cockpit Workflow Action Panel 只展示 operator-facing action；`materialize-change <change-id>` 不进入 Action Inbox / needs-me，只在 Workflow Lens debug/detail 中展示 action input hint。
- Web `Run until blocked` 停止原因和 banner 文案区分 observing / waiting operator gate / handoff ready / operator attention，不再因为任意 `allowedActions` 存在就要求开发者决策。
- 保持 daemon / outer Agent 只 inspect/reconcile，不自动执行 workflow action，也不把 `actionInputs` 放入 Coordinator Agent Surface。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `workflow-protocol-adapter`: operator workflow action helper 必须区分 operator-facing 与 agent/internal action，非 operator-facing action 不得由 Web/Core operator endpoint 执行。
- `web-human-review-surface`: Workflow Action Panel、Action Inbox 和 Run Until Blocked 只把 operator-facing gate 展示为 needs-me；agent/internal workflow action 只能作为 debug/detail 信息展示。
- `operator-task-controls`: Run Until Blocked 的解释语义不得把任意 `allowedActions` 当作 operator blocker，也不得自动执行 workflow action。
- `daemon-runtime`: daemon 对 running workflow 的 inspect/reconcile 不得因为 agent/internal action 或 `actionInputHints` 制造 Web needs-me 或自动调用 workflow action。

## Impact

- Affected code:
  - `packages/core/src/workflow-protocol-adapter.ts`
  - `packages/core/src/workflow-protocol-adapter.test.ts`
  - `apps/api/src/**`
  - `apps/web/src/**`
- Affected docs/specs:
  - `openspec/specs/workflow-protocol-adapter/spec.md`
  - `openspec/specs/web-human-review-surface/spec.md`
  - `openspec/specs/operator-task-controls/spec.md`
  - `openspec/specs/daemon-runtime/spec.md`
  - `docs/roadmap.md` 完成后更新进度。
- Systems:
  - 不修改 workflow 工程或 workflow protocol。
  - 不读取 `.workflow` private state。
  - 不扩大 Coordinator Agent Surface。
  - 不改变 PR/MR/review/merge human approval gate。
