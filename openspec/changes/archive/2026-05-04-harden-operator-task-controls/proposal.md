## Why

Iteration 11 已经补齐 Web human review 操作面，但 `pause/resume/cancel/retry` 仍只是文档中的 operator 目标，没有形成 Core 统一校验、API/CLI/Web 入口和可观测事件。Iteration 12 的第一个 hardening 单元需要把这些人工介入动作收口到 Core，避免后续通过 Web 或 CLI 直接改状态造成边界污染。

## What Changes

- 新增 operator-only task controls：pause、resume、cancel、retry。
- 所有 task control 都必须由 Core service 校验当前状态、CAS version、terminal state 和事件记录。
- API/CLI/Web 只作为 operator surface 调用 Core，不直接拼接状态机。
- retry 只安排受控恢复，让 daemon 后续按现有 retry_due / surface / agent tools 继续推进，不直接跳过 Coordinator Agent 决策。
- cancel 只将 task 置为 `canceled` 并记录原因，不默认删除 workspace、不关闭外部 PR/MR、不清理历史 artifact。
- pause/resume/cancel/retry 不得进入 Coordinator Surface `available_tools`。

## Capabilities

### New Capabilities

- `operator-task-controls`: operator-only task pause/resume/cancel/retry 的 Core/API/CLI/Web 契约。

### Modified Capabilities

- `web-human-review-surface`: Web operator surface 需要展示并调用 pause/resume/cancel/retry。
- `daemon-runtime`: daemon 必须尊重 paused/canceled 状态，并只在 retry 到期后推进被安排恢复的 task。
- `core-data-model`: task control 状态变更和 event 需要同事务提交，并保持 CAS 语义。

## Impact

- Affected code:
  - `packages/core/src/operator-surface.ts`
  - `packages/core/src/daemon-runtime.ts`
  - `packages/core/src/index.ts`
  - `apps/api/src/server.ts`
  - `packages/cli/src/commands.ts`
  - `apps/web/src/main.tsx`
  - 相关 tests
- Affected specs:
  - 新增 `openspec/specs/operator-task-controls/spec.md`
  - 更新 Web / daemon / data model specs
- No new external dependency.
- No database migration expected unless implementation reveals an existing schema gap.
