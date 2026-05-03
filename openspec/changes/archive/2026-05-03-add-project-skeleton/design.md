## Context

当前仓库已经有完整设计文档和 OpenSpec 配置，但还没有可运行代码。Iteration 1 的职责是建立长期可扩展的单体工程骨架，并只实现最小运行能力，避免提前把后续 Iteration 的状态机、daemon、provider、workflow adapter 混入第一轮。

本轮必须持续对齐：

- `docs/AGENTS.md`：总体设计心智入口。
- `docs/architecture.md`：Web/CLI、Coordinator Core、Coordinator Agent、Execution Adapters、Task Source Adapters 的边界。
- `docs/contracts.md`：Coordinator Core 是唯一状态机和策略校验者；agent 不能直接访问 SQLite。
- `docs/operations.md`：SQLite 是第一版持久化真相源，后续副作用需要 operation/idempotency/CAS/lock。
- `docs/observability.md`：事件、artifact、surface snapshot 是后续核心能力。
- `docs/roadmap.md`：Iteration 1 只完成项目骨架。

## Goals / Non-Goals

**Goals:**

- 建立 Node + TypeScript 工程。
- 建立 Fastify API 入口和健康检查。
- 建立 Vite + React Web 入口。
- 建立基础 CLI。
- 建立 SQLite migration runner 和首个元信息 migration。
- 建立 Vitest 测试入口。
- 保留清晰目录，为后续 core、adapters、web、cli、shared、db 扩展。

**Non-Goals:**

- 不实现完整 projects/tasks/attempts/events 等 Iteration 2 数据模型。
- 不实现 Coordinator Agent、agent tools 或 surface 生成。
- 不实现 daemon、workspace、workflow adapter、PR/MR provider、AgentProvider。
- 不引入通用 DAG、hidden memory、persona role system 或高信任自动 merge。

## Decisions

### 使用 pnpm workspace + 单仓多包目录

选择 `apps/api`、`apps/web`、`packages/core`、`packages/db`、`packages/cli`、`packages/shared` 的结构。

原因：

- 保持第一版单进程/单仓优先，但给长期分层留出物理边界。
- Web/CLI/API 与核心逻辑分离，后续不会把 operator surface 写成状态机。
- `packages/db` 可以先承载 migration，后续承载 repository 和 SQLite transaction。

替代方案：

- 单一 `src/` 目录更快，但后续容易让 API、CLI、Core、DB 相互污染。
- 多 repo 或多服务过重，不符合第一版单体优先。

### SQLite migration 先只建立机制

首个 migration 只创建 `schema_migrations` 和 `app_metadata` 这类元信息表。

原因：

- Iteration 1 完成标准只要求 migration 可执行。
- 完整核心表属于 Iteration 2，应由单独 OpenSpec change 约束和测试。

替代方案：

- 直接建立全部核心表会提前进入 Iteration 2，容易缺少 CAS、operation、lock 等契约测试。

### API/Web/CLI 都通过 shared health 信息验证

`packages/shared` 提供最小服务元信息，API health、CLI health、Web 文案都引用同一处常量。

原因：

- 证明 package 间引用和构建路径可用。
- 避免本轮出现业务状态或 agent surface 的伪实现。

## Risks / Trade-offs

- [Risk] 包结构相对单文件脚手架更重。→ Mitigation：本轮只放必要入口和少量共享代码，不建立空洞抽象。
- [Risk] migration runner 如果设计太完整，会提前实现 Iteration 2。→ Mitigation：只实现读取 SQL、记录已应用 migration、幂等执行。
- [Risk] Web 占位界面被误认为正式 UI。→ Mitigation：界面只表达 operator surface 入口和当前阶段，不实现任务管理功能。
- [Risk] 依赖选择影响本地安装速度。→ Mitigation：选择常规轻量依赖，并通过脚本验证。

## Migration Plan

1. 新增 package 配置和源码目录。
2. 新增 SQLite migration runner 与首个 migration。
3. 新增 API/Web/CLI 最小入口。
4. 新增单测。
5. 执行类型检查、测试、构建、OpenSpec validate。

回滚策略：删除本 change 新增的工程配置、源码、migration 和 OpenSpec change 即可，不涉及用户数据迁移。

## Open Questions

- 无需要用户确认的设计变更。本轮实现位于既有设计边界内。
