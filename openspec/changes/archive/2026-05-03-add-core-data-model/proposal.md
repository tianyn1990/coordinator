## Why

`coordinator` 已完成项目骨架，但还没有持久化核心对象、事件、operation、CAS 和 lock 的能力。Iteration 2 需要先建立 SQLite 机器真相源和最小 repository 层，为后续 Project Registry、Coordinator Surface、agent tools、daemon 和 Web observability 提供可靠基础。

## What Changes

- 新增核心 SQLite migration，建立 P0 必需表：projects、tasks、attempts、execution_plans、plan_steps、workspaces、agent_sessions、workflow_runs、pull_requests、human_requests、events、artifacts、operations、locks。
- 为核心实体加入 `state_version`、`created_at`、`updated_at` 等基础字段，为 CAS 和恢复留出稳定契约。
- 建立 append-only `events` 表和最小 event repository，保证关键状态变化与 event 可以在同一 SQLite transaction 内提交。
- 建立 project/task 的最小 repository，支持创建 project、创建 task，并在同一事务写入事件。
- 建立 operation repository，使用稳定 `idempotency_key` 防止重复 non-terminal operation。
- 建立 lock repository，支持 acquire/release、lease version、lock token 和过期接管。
- 建立 active 唯一性约束，覆盖 attempt/workspace/workflow run/human request/merge approval/merge operation 的 P0 关键场景。
- 新增 CLI/API 的最小 event timeline 查看能力，先服务调试和验收，不实现完整 Web timeline UI。

## Capabilities

### New Capabilities

- `core-data-model`: 覆盖核心 SQLite 数据模型、append-only event store、repository transaction、CAS、operation idempotency、lock/lease 和最小 timeline 查询能力。

### Modified Capabilities

- 无。

## Impact

- 影响 `packages/db` 的 migration、repository、测试和导出接口。
- 影响 `packages/cli`，新增最小 timeline 查询命令。
- 影响 `apps/api`，新增最小 timeline 查询接口。
- 不实现 daemon、Coordinator Agent tools、Coordinator Surface、workflow adapter、workspace manager、PR/MR provider 或完整 Web UI。
