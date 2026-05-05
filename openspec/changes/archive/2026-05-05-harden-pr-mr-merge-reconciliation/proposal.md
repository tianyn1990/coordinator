## Why

Iteration 12 已完成 daemon/Core recovery matrix 与 workspace/lock/fencing recovery，下一步需要把同样的恢复心智落到 PR/MR 与 merge 闭环上。当前 PR/MR runtime 已具备创建、更新、review inspect、approval 和 merge 的基础能力，但对外部 PR/MR 状态变化、merge race/conflict、provider failure 分类和 approval snapshot 失效的对账还不够完整。

## What Changes

- 补强 PR/MR read-only inspect 结果建模，让 provider adapter 只返回外部事实，不把恢复策略放进 adapter。
- 增加 Core-owned PR/MR recovery decision，覆盖 PR already exists、external conflicts intent、closed/unmerged、already merged、merge race、merge conflict、approval invalidated 和 provider failure 分类。
- 补强 `create_pr`、`update_pr`、`inspect_review`、`request_merge_approval`、`merge_after_approval` 的 operation/reconciliation 语义。
- 保持 merge 必须显式 human approval，且 merge 前重新 inspect、校验 snapshot、获取 PR merge lock。
- 保持 daemon 是 runtime driver，不判断 review 是否通过、不自行决定业务完成、不把 provider raw output 暴露给 Coordinator Agent。
- 不新增 agent-facing 复杂工具参数；复杂 PR body、approval 问题、review 摘要继续通过 artifact 和 surface 摘要传递。

## Capabilities

### New Capabilities

- `pr-mr-merge-reconciliation`: PR/MR 与 merge 的恢复矩阵，包括外部状态 inspect、operation replay、approval snapshot invalidation、merge race/conflict 和 provider failure 分类。

### Modified Capabilities

- `pr-mr-provider`: 补充 provider 外部事实、PR/MR 状态对账、merge 结果 reconciliation 和 provider failure 分类要求。
- `daemon-recovery-matrix`: 补充 PR/MR 与 merge 资源进入 Core-owned recovery decision 的要求。
- `coordinator-surface`: 明确 PR/MR recovery 不得扩大 agent surface，不暴露 provider raw output、内部 operation、approval 原始对象或复杂 JSON。

## Impact

- 影响 `packages/core/src/pr-mr-provider.ts`、`packages/core/src/recovery-decision.ts`、`packages/core/src/daemon-runtime.ts` 及相关 tests。
- 可能需要扩展 `PullRequestProvider` 返回的外部事实类型和 fake/CLI provider 解析，但不引入新依赖。
- 可能补充 DB operation/human request/pull request 更新路径；不改变 `Coordinator Core` 状态机所有权。
- 影响 OpenSpec 正式 specs：`pr-mr-provider`、`daemon-recovery-matrix`、`coordinator-surface`，并新增 `pr-mr-merge-reconciliation`。
