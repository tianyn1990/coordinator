## Why

P0 daemon 已经可以执行最小 tick、workflow status reconciliation、human wake-up、outer agent session 启动和 retry_due gate，但它还缺少明确的 Core-owned recovery matrix。随着 operator task controls、workflow adapter、agent provider、PR/MR provider 都已落地，如果不先收敛 `running/failed/unknown/stalled` 的恢复语义，后续补第二套真实 provider/platform 会放大重复副作用、状态漂移和错误恢复风险。

本 change 先补 Slice 12.2 的 daemon/Core recovery 底座，把恢复逻辑约束为有限的 `Observation -> Core RecoveryDecision -> Daemon Action`，继续保持 daemon 不是 agent、workflow protocol-only、agent surface/tools 不暴露内部复杂状态。

## What Changes

- 增加 Core-owned recovery decision service，用于把 daemon 收集到的 operation、workflow run、agent session、task gate observation 转换为受控恢复决策。
- 补齐 operation replay matrix，重点覆盖 `running`、`failed`、`unknown` operation 在外部状态 `absent`、`matches-intent`、`conflicts-with-intent`、`unclear` 下的 retry / reconciled / unknown / operator attention 决策。
- 补强 workflow run reconciliation：只通过 workflow protocol `status`；`runId/profile mismatch` 进入 protocol consistency violation；不得读取 `.workflow` private state，不得用 stage/substate/gate 推导外层业务完成或 PR readiness。
- 补强 outer agent session stalled/no-progress 恢复：先 inspect，再按 retry budget、dueAt 和 task stateVersion 决定是否重新唤醒，避免无进展重复启动 provider。
- 统一 paused / canceled / retry_due gate：paused/canceled 不启动 agent、不执行 agent tools、不执行 workflow/PR/MR 副作用；允许 read-only inspect 和 recovery event。
- 增加 recovery decision event，payload 保持窄字段和 artifact refs，避免把 provider raw output、lock token、operation 大对象暴露给 agent-facing surface。
- 增加 failure injection / contract tests 覆盖 operation replay、workflow unavailable/mismatch、agent stalled、paused/canceled guard、retry budget exhausted 和 same stateVersion no-progress。

不包含：

- 不新增 agent tools。
- 不引入通用 reconciliation DSL / DAG engine。
- 不实现 PR/MR merge 全矩阵。
- 不实现 workspace/lock/fencing 完整恢复矩阵。
- 不实现 remote worker offline/fleet 状态机。
- 不吸收 Multica skills / 能力包；coding 能力继续由 `workflow` 工程承接。

## Capabilities

### New Capabilities

- `daemon-recovery-matrix`: 定义 daemon/Core recovery matrix、operation replay、workflow protocol consistency、agent session stalled/no-progress、paused/canceled safe inspect gate 和 recovery decision observability。

### Modified Capabilities

- `daemon-runtime`: daemon runtime 的 reconciliation/watchdog/retry 要从最小 tick 扩展为 Core-owned recovery decision 驱动。
- `core-data-model`: event store 需要记录 recovery decision 的窄 payload，并继续保持 append-only、事务一致和 agent surface 不直接消费内部 JSON。
- `coordinator-surface`: surface 需要保持不泄漏 recovery matrix、lock token、provider raw output、operation replay 细节或新增内部 recovery tools。

## Impact

- Affected code:
  - `packages/core` daemon runtime、repository、event helpers、workflow reconciliation、agent session recovery 相关模块。
  - `packages/core` surface builder 的 recovery 摘要和泄漏防护 tests。
  - 相关 CLI/API daemon tick 调试入口如需展示 recovery decision 结果，只能作为 operator-only machine summary。
- Affected specs:
  - 新增 `daemon-recovery-matrix` spec。
  - 修改 `daemon-runtime`、`core-data-model`、`coordinator-surface` specs。
- Dependencies:
  - 不新增外部依赖。
- External systems:
  - 只通过既有 AgentProvider inspect、Workflow Protocol Adapter status 和 DB operation/event/lock 状态观察，不新增 provider/platform 能力。
