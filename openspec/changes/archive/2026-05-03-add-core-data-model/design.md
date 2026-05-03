## Context

Iteration 2 是 `coordinator` 从可运行骨架进入可靠状态存储的第一步。本轮需要把 `docs/contracts.md`、`docs/operations.md`、`docs/observability.md` 中已经确认的硬契约落到 SQLite schema 和最小 repository 测试中。

本轮持续对齐：

- `docs/AGENTS.md`：实现必须主动对齐总体设计心智。
- `docs/roadmap.md`：Iteration 2 范围是数据模型与 Event Store。
- `docs/contracts.md`：状态所有权、CAS、active uniqueness、operation/idempotency。
- `docs/operations.md`：事务边界、operation ledger、lock/lease/fencing、inspect-before-create 的后续基础。
- `docs/observability.md`：append-only events、timeline、payload 不作为 agent 主输入。
- `docs/architecture.md`：Coordinator Core 是唯一状态机和策略校验者，Execution Adapters 不直接推进状态。

## Goals / Non-Goals

**Goals:**

- 建立 P0 必需核心表和约束。
- 建立最小 repository 基础，证明 transaction、CAS、event append、operation idempotency、lock 语义可用。
- 提供 CLI/API 的最小 task timeline 查询。
- 用测试覆盖关键契约：migration、CAS conflict、事件同事务、operation 防重复、active 唯一性、lock acquire/release/过期接管。

**Non-Goals:**

- 不实现 Project Registry 的 git 检测和注册流程。
- 不实现 Coordinator Surface 或 agent tools。
- 不实现 daemon、scheduler、watchdog、reconciliation loop。
- 不实现 workspace manager、workflow adapter、AgentProvider、PR/MR provider。
- 不实现完整 Web timeline UI。
- 不做业务状态机编排，只提供 repository 能力和数据库约束。

## Decisions

### 核心表一次建齐，业务能力分阶段填充

本轮 migration 会建齐 roadmap 中列出的 P0 表，但 repository 只实现 project/task/events/operations/locks 的最小路径。

原因：

- 后续 iteration 需要表之间的外键和 active uniqueness 约束稳定存在。
- 一次建齐 schema 可以尽早暴露约束冲突。
- repository 先小范围实现，避免把后续 Project Registry、daemon、agent tools 提前塞进本轮。

替代方案：

- 每轮只建当前用到的表更轻，但会推迟外键和唯一性问题，容易让后续实现绕过数据边界。

### 使用 SQLite partial unique index 表达 active uniqueness

对 active workspace、workflow run、human request、merge approval、merge operation、non-terminal operation 使用 partial unique index。

原因：

- 这是最直接的数据库级约束，符合 docs 中“active 唯一性必须由数据库约束或等价事务保证”的要求。
- 比只在 repository 里查后插入更不容易被并发绕过。

替代方案：

- 应用层检查更简单，但无法作为可靠底座。

### Repository 使用明确 transaction wrapper

`packages/db` 提供 `withTransaction`，repository 方法在 transaction 内完成状态变化和 event append。

原因：

- docs/operations.md 要求状态变更、state_version 更新、event append、operation intent、lock acquire/release 同事务。
- 先建立 transaction 基础，后续工具和 daemon 可以复用。

### Event payload 保持 JSON，但 agent 不直接消费

`events.payload_json` 和 `artifact_refs_json` 存 JSON 文本。repository 返回结构化对象给 CLI/API；未来 Coordinator Surface 再负责翻译为 agent-facing Markdown。

原因：

- 数据库需要保留审计信息。
- 符合“payload 可以是 JSON，但不作为 agent 主输入”的约束。

## Risks / Trade-offs

- [Risk] 一次建齐表可能让 schema 看起来比当前功能多。→ Mitigation：repository 和 API/CLI 只实现本轮验收路径，roadmap 明确后续能力仍未实现。
- [Risk] SQLite partial unique index 需要精确定义 active 状态。→ Mitigation：只覆盖 docs 已明确的 P0 active uniqueness，状态枚举保持窄。
- [Risk] `node:sqlite` 仍有 ExperimentalWarning。→ Mitigation：继续隔离在 `packages/db`，运行时已由 engines 约束；本轮不扩大 driver 依赖面。
- [Risk] CLI/API timeline 可能被误认为完整 observability UI。→ Mitigation：只提供最小 task event list，用于 Iteration 2 验收和调试。

## Migration Plan

1. 新增核心 schema migration。
2. 实现 transaction、基础 repositories 和错误类型。
3. 增加 CLI/API timeline 查询。
4. 补充单测和 contract 测试。
5. 执行 OpenSpec validate、typecheck、test、build。

回滚策略：本轮属于早期 schema 初始化；若未部署真实数据，可回滚代码和 migration。若已有数据，后续必须通过单独 migration 回滚或迁移，不得手动改库。

## Open Questions

- 无需要用户确认的设计变更。本轮实现位于既有 Iteration 2 范围内。
