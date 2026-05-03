## Why

当前系统已经落地了 surface、outer agent runtime、agent tools、workspace manager 和 workflow adapter，但还缺少长运行 daemon 来把这些能力稳定串联起来。没有 daemon，系统只能靠人工逐个触发，无法满足后续无人值守、恢复、重试和人类介入唤醒的目标。

## What Changes

- 新增 P0 最小 daemon runtime，用于调度、探活、reconciliation、retry 和 human request 唤醒。
- daemon 只负责运行时推进与恢复，不做业务语义判断，不替代 Coordinator Agent 的决策。
- daemon 复用现有 Coordinator Surface、agent provider runtime、agent tools executor、workflow protocol adapter 和 workspace manager。
- daemon 建立最小可观测事件，记录 tick、选中任务、恢复动作、失败与重试原因。
- daemon 支持从 SQLite 恢复运行状态，并在进程重启后继续推进 active tasks、agent sessions、workflow runs 和 human requests。
- 本轮只落 P0 最小闭环，不实现 PR/MR provider、merge、review 后自动合并或远程 worker。

## Capabilities

### New Capabilities
- `daemon-runtime`: 长运行 daemon、scheduler、watchdog、reconciliation、retry 和 human request wake-up 的最小能力。

### Modified Capabilities

## Impact

- 影响 `packages/core` 中的调度、恢复和监控入口。
- 影响 `packages/db` 中的 event、operation、state 查询与更新路径。
- 影响 CLI/API 的 operator 调试入口和后续 daemon 启动入口。
- 影响 `docs/daemon.md`、`docs/operations.md`、`docs/observability.md`、`docs/contracts.md` 的已落地事实记录，但不改变既有设计边界。
