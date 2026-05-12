## Why

本地真实工程 smoke 已跑通 coordinator -> GitLab repo -> workspace -> workflow protocol 的基础链路，但暴露出三个会影响后续实测和 operator 排查的问题：

- root pnpm scripts 会把 `--` 原样传给 CLI，导致 `pnpm migrate --db ...` 和 `pnpm cli ...` 入口不可用。
- 并发执行 workflow operator debug 查询时，`workflow status/events` 会因为同一 SQLite DB 的短暂写冲突报 `database is locked`。
- workflow raw protocol 已返回顶层 `actionInputs`，但 coordinator projected status 未投影该信息，operator 只能看到 action 名，不知道 action 参数要求。

这些问题不改变 coordinator 的核心职责，但需要收敛为 P0 本地实测可用的 operator/debug hardening。

## What Changes

- 修正 root `cli` / `migrate` scripts 的参数转发，使正式 pnpm 入口可直接使用。
- 在 SQLite 打开连接时设置 `busy_timeout`，缓解短暂 writer contention，同时保留 WAL。
- 明确 workflow operator debug 入口会记录审计 event/status snapshot，不是纯读高频 polling API。
- 在 workflow protocol adapter 中解析并返回 sanitized action input hints，只保留 action id、required args 和 usage 等窄字段。
- 保持 `actionInputs` 仅用于 operator/debug status 和审计摘要，不进入 Coordinator Agent Surface，不驱动外层状态机。
- 新增 workflow 工程交接文档，说明 workflow 侧需要把 `actionInputs` 正式纳入稳定 protocol schema/docs。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-skeleton`: root pnpm scripts 必须能执行 CLI migration 和调试入口。
- `core-data-model`: SQLite 连接应具备短暂写冲突等待能力，并保留状态变化与 event 同事务提交语义。
- `workflow-protocol-adapter`: operator-only workflow status 需要展示 sanitized action input hints；这些 hint 不得扩大 Coordinator Agent Surface。

## Impact

- 影响 `package.json` 的 root scripts。
- 影响 `packages/db/src/index.ts` 的 SQLite 连接初始化。
- 影响 `packages/core/src/workflow-protocol-adapter.ts` 的 status 类型、解析和 event payload。
- 影响 workflow protocol adapter 相关 tests 和 CLI script smoke 验证。
- 新增 `docs/workflow-action-inputs-handoff.md`，交接给 `/Users/hetao/Documents/github/workflow` 工程。
- 不新增 npm dependency，不新增 SQLite migration，不改变 Coordinator Core 状态机，不新增 agent-facing tool。
