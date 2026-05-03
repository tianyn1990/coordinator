## Why

当前 `coordinator` 已经能通过 daemon、Coordinator Agent tools、workspace manager 和 workflow protocol 推进到 `workflow handoff pr_ready`，但还缺少真实 PR/MR 创建、review 观察和 merge approval gate 的外层闭环。Iteration 10 需要补上 PR/MR Provider，才能让 P0 E2E 从代码工作进入 human review 和显式审批后的 merge。

## What Changes

- 新增 PR/MR provider 抽象，保持 GitHub/GitLab 可替换，第一轮落地一个真实 CLI provider 路径和一个 fake/stub provider contract。
- 新增 Core service：创建 PR/MR、更新 PR/MR、检查 review 状态、请求 merge approval、显式审批后 merge。
- 新增或补齐 DB repository 对 `pull_requests`、merge approval human request、PR/MR operation 的读写能力。
- 更新 Coordinator Surface 和 Coordinator Agent Tools executor，让 `workflow handoff pr_ready` 后可见 `create_pr`，PR/MR open 后可见 `inspect_review` / `update_pr` / `request_merge_approval`，有效审批后才可见 `merge_after_approval`。
- 新增 CLI/API operator-only 调试入口，用于 PR/MR create/inspect/review/approval/merge；operator approval 仍不进入 agent surface。
- 保持 `daemon` 不做 review 语义判断，不做 unsafe auto-merge；merge 必须绑定有效 approval snapshot，默认 `squash`。

## Capabilities

### New Capabilities
- `pr-mr-provider`: 定义 PR/MR provider、PR/MR Core service、review/approval/merge gate、agent tools 可见性和 operator-only 入口。

### Modified Capabilities
- `coordinator-agent-tools`: 补齐 `create_pr`、`update_pr`、`inspect_review`、`request_merge_approval`、`merge_after_approval` 的 agent tool 执行契约。
- `coordinator-surface`: 允许在 PR/MR 生命周期对应状态中暴露 PR/MR tools，但仍通过 current surface gate 收窄。
- `core-data-model`: 补齐 pull request、review snapshot 和 merge approval 相关持久化读写语义。

## Impact

- Affected code:
  - `packages/db/src/index.ts`
  - `packages/db/migrations/*.sql`
  - `packages/core/src/pr-mr-provider.ts`
  - `packages/core/src/coordinator-agent-tools.ts`
  - `packages/core/src/surface.ts`
  - `packages/cli/src/commands.ts`
  - `apps/api/src/server.ts`
- Affected specs:
  - `openspec/specs/pr-mr-provider/spec.md`
  - delta specs for Coordinator Surface、Coordinator Agent Tools、Core Data Model。
- External systems:
  - GitHub/GitLab CLI provider path uses `gh` 或 `glab` through a narrow runner.
  - Fake provider remains available for contract tests and local P0 verification without external network/auth.
