## Why

Web V2 已经替换为 Run Matrix + Focus Drawer，但 Gate Inbox 与 `Run until blocked` 的语义还需要从旧 Workbench/Task Cockpit 心智中收敛出来。当前下一步应确保 Web 只把真正 operator gate 放入 `Needs me`，并用 workflow runtime observation 解释 internal action / running inner agent，而不是把 workflow `allowedActions` 误当成开发者待办。

## What Changes

- 将 Web V2 的 Gate Inbox 明确收敛为 `Needs-Me Gate Inbox`：只展示 pending human request、pending merge approval、PR/MR review required/conflict、operator-facing workflow gate、Core recovery attention、failed/unknown high-risk state 与 project/provider blocker。
- 让 Run Matrix row、Focus Drawer 和 banner 使用同一套 owner/mode/stop reason 派生：`observing-runtime`、`waiting-operator-gate`、`handoff-ready`、`recovery-attention`、`terminal`、`no-candidate`、`max-ticks`。
- 调整 `Run until blocked` 展示：task-scoped 结果只绑定当前 task；global run 结果只显示全局 queue 摘要，不污染当前 Focus Drawer 的 task 状态。
- 确认 agent/internal workflow action，例如 `materialize-change <change-id>`、`run-alignment-checks`、inspect/resume 和 unknown/debug action，只进入 Workflow Lens / Debug Detail，不进入 `Needs me`，也不要求 operator 填内部参数。
- 保持 operator-facing workflow gate 继续通过既有 API/Core runtime 提交，由 Core 校验 stateVersion、classification、allowed/denied/actionInputs 与 operation/idempotency。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `web-human-review-surface`: Web V2 Gate Inbox、Run Matrix、Focus Drawer 和 workflow gate 展示语义从旧 Action Inbox/Task Cockpit 进一步收敛到 Needs-Me + observation。
- `operator-task-controls`: Web `Run until blocked` 的 stop reason、task/global scope 展示和 observing/operator-gate 区分进一步明确为 operator-only explanation。

## Impact

- Affected code:
  - `apps/web/src/main.tsx`
  - `apps/web/src/workbench-v2-model.ts`
  - `apps/web/src/workbench-v2-model.test.ts`
  - 可能调整现有 Web workflow action helper tests。
- Affected docs/specs:
  - `openspec/specs/web-human-review-surface/spec.md`
  - `openspec/specs/operator-task-controls/spec.md`
  - 完成后更新 `docs/roadmap.md`。
- Systems:
  - Web 仍只调用现有 API/Core runtime。
  - 不修改 workflow protocol。
  - 不新增 daemon 自动 workflow action。
  - 不改变 Coordinator Agent Surface。
