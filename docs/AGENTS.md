# coordinator 设计文档索引与 Agent 约束

> 状态：初始方案基线  
> 目的：记录 `coordinator` 的长期设计、第一版范围、与 `workflow` 的协议边界，以及后续实现时必须遵守的工程约束。

## 0. 使用约束

本文件是 `docs/` 目录的入口，也是本项目实现前必须对齐的设计心智索引。

所有 agent 在实现、review、调研、写 OpenSpec change 或调整架构前，必须：

- 先阅读根目录 `AGENTS.md`。
- 再阅读本文件。
- 按任务影响范围继续阅读下方专题文档。
- 把专题文档里的边界和契约视为实现约束，而不是背景资料。

如果代码实现、OpenSpec change 或外部调研建议与这些文档冲突，应先指出冲突点和可选取舍。凡是涉及修改设计文档、改变既有设计边界或调整核心方案的，必须先与用户确认；确认后再修改设计文档或代码。若不需要改设计，应明确说明实现如何在既有设计内完成。

每次使用 subagent 做 review，都必须要求它检查：

- 是否符合本文件和 `docs/` 下的总体设计心智。
- 是否过度设计。
- 是否违背 `Coordinator Core`、`Daemon`、`Execution Adapters`、`workflow protocol`、`AgentProvider`、`GitProvider` 等边界。
- 是否让 agent surface/tools 暴露了过多内部字段或复杂 JSON。
- 是否引入了未被文档允许的隐式状态机、hidden memory、通用 DAG、persona role system 或高信任自动 merge。

## 1. 项目定位

`coordinator` 是外层智能协调系统。

它负责：

- 接收任务。
- 注册和管理工程。
- 创建隔离 workspace。
- 启动外层 `Coordinator Agent`。
- 调用 Codex / Claude Code 等 agent provider。
- 串联一次或多次 `workflow` run。
- 创建 PR / MR。
- 等待 human review。
- 根据 review 进入 rework。
- 在显式人工审批后 merge。
- 将任务收口为 done / handoff / canceled / failed。
- 记录完整事件、产物、日志和决策依据。

`workflow` 项目继续负责单个代码工作单元内部的阶段化执行协议，包括：

- workflow profile。
- requirements / implementation / review。
- stage / substate / gate。
- agent-facing surface。
- OpenSpec 使用时机。
- inner coding agent 的实现流程约束。

一句话：

```text
coordinator 管任务如何被完成。
workflow 管一次代码变更内部如何规范执行。
```

## 2. 设计来源

本方案吸收并结合了以下来源：

- 本项目多轮方案讨论中已确认的取舍。
- `/Users/hetao/Documents/github/workflow` 的现有设计原则：
  - runtime 单控制面。
  - coding agent 可见性优先。
  - 少量 workflow profile + 受控 graph。
  - 避免复杂 JSON 作为 agent 主交互协议。
  - 过程性复杂信息优先写入 artifact，而不是作为工具参数传递。
- OpenAI Symphony：
  - GitHub: https://github.com/openai/symphony
  - Spec: https://github.com/openai/symphony/blob/main/SPEC.md
  - Article: https://openai.com/index/open-source-codex-orchestration-symphony/

Symphony 的核心经验会被吸收为：

- 长运行 daemon。
- 单一 authoritative orchestrator state。
- tracker/source 与 runner 解耦。
- per-issue / per-task workspace isolation。
- bounded concurrency。
- reconciliation。
- retry / continuation。
- structured observability。
- repo-owned workflow contract。

但 `coordinator` 不直接复刻 Symphony 的 Linear-first 形态，而是做成 task-source-agnostic、agent-provider-agnostic、workflow-runtime-aware 的外层协调系统。

## 3. 文档结构

- [architecture.md](./architecture.md)
  - 总体架构、分层、长期边界、第一版范围。
- [coordinator-surface.md](./coordinator-surface.md)
  - 外层 `Coordinator Agent` 的可见面设计。
- [agent-tools.md](./agent-tools.md)
  - `Coordinator Agent` 可调用工具、参数风格、artifact 约定。
- [contracts.md](./contracts.md)
  - Surface、工具可见性、状态迁移、幂等、handoff、merge approval 等硬契约。
- [operations.md](./operations.md)
  - operation ledger、CAS、lock、reconciliation、retry、checkpoint 和恢复。
- [daemon.md](./daemon.md)
  - daemon、watchdog、reconciliation、retry、恢复机制。
- [workflow-protocol.md](./workflow-protocol.md)
  - `coordinator` 与 `workflow` 的正式协议边界。
- [workflow-project-handoff.md](./workflow-project-handoff.md)
  - 交接给 `/Users/hetao/Documents/github/workflow` 工程的 protocol bridge 实现说明。
- [workflow-action-inputs-handoff.md](./workflow-action-inputs-handoff.md)
  - 交接给 `/Users/hetao/Documents/github/workflow` 工程的 actionInputs protocol schema 正式化说明。
- [workflow-stage-substate-handoff.md](./workflow-stage-substate-handoff.md)
  - 交接给 `/Users/hetao/Documents/github/workflow` 工程的 stage/substate/progress protocol 展示增强说明。
- [workflow-agent-lifecycle-handoff.md](./workflow-agent-lifecycle-handoff.md)
  - Coordinator 观察 inner coding agent 生命周期、区分 workflow 内部 action 与真正 operator gate 的设计交接备忘。
- [execution-workspace.md](./execution-workspace.md)
  - workspace、git worktree、branch、worker runtime、agent provider。
- [project-registry.md](./project-registry.md)
  - 工程注册、GitHub/GitLab 检测、默认分支、provider 配置。
- [observability.md](./observability.md)
  - 事件、日志、artifact、UI 调试视图和审计。
- [web-developer-workbench.md](./web-developer-workbench.md)
  - Web V2 多工程、多任务开发者工作台的产品心智、Run Matrix / Focus Drawer / Unified Composer 信息架构、视觉方向和交互边界。
- [next-project-workflow-fleet-handoff.md](./next-project-workflow-fleet-handoff.md)
  - 面向新工程的 Workflow Fleet Manager 交接文档，沉淀当前 `coordinator` 的经验、偏重问题、每 task Supervisor Agent 心智、React Flow 动态画布方向和新工程启动提示词。
- [next-project-workflow-tool-protocol.md](./next-project-workflow-tool-protocol.md)
  - 面向新工程的 workflow 工具协议交接文档，明确 workflow 作为 Coding Agent skill 的 skill-first 接入、Host 只读 observation protocol、active run discovery、debug/compat start/action 边界和 UI projection。
- [research.md](./research.md)
  - 已调研社区方案与文章、可吸收点和拒绝吸收点。
- [roadmap.md](./roadmap.md)
  - 第一版实现顺序、完成标准和后续扩展。

## 4. 第一版原则

第一版不是一次性做完所有未来能力，但必须把长期扩展点留对。

核心原则：

```text
接口先稳定，能力后填充。
边界先隔离，实现先单体。
agent 有智能，但只能通过受控 surface 和 tools 行动。
复杂内容写 artifact，工具参数保持窄。
```

针对 workflow 与 agent 生命周期，第一版的长期心智是：

```text
Coordinator 管多个 workflow run 如何被观察、恢复、确认和收口。
workflow / inner coding agent 管单个代码工作单元内部如何执行。
```

Coordinator 可以持续只读 inspect、记录 agent/provider/workflow 事件、展示运行进度和恢复建议；但当 inner coding agent 仍在运行时，不应因为 workflow `allowedActions` 或 `actionInputs` 出现就打断开发者。只有在 workflow handoff、human request、merge approval、provider failure、operator attention 或明确 operator gate 出现时，Web 才应把事项放进 needs-me / Gate Inbox。

当前 `workflow protocol` 保持既有契约不变。`agent.state`、`blocker.owner`、`operatorActions`、`agentActions` 等字段只作为未来可选 protocol 增强方向；本期 Coordinator 侧必须用保守分类和现有状态信息避免把 `materialize-change <change-id>` 等内部动作错误升级为人工 gate。

Coordinator 可以派生 operator-only `workflow runtime observation` 解释当前 owner/mode；该摘要只服务 Web/operator/daemon 观察，不是新状态机，不得扩大 Coordinator Agent Surface，也不得作为修改 workflow protocol 的理由。

第一版可以是单进程、本机执行，但必须保留：

- `TaskSource` 扩展点。
- `AgentProvider` 扩展点。
- `WorkflowRuntime` 扩展点。
- `WorkspaceStrategy` 扩展点。
- `WorkerRuntime` 扩展点。
- `GitProvider` / `PullRequestProvider` 扩展点。
- `HumanInteraction` 扩展点。
- `EventSink` 扩展点。

## 5. 第一版分层目标

第一版需要区分三个层次，避免把长期平台能力全部压到第一条闭环里。

### 5.1 P0 first E2E

P0 目标是跑通一条真实闭环，同时把长期边界写进代码接口和测试。

P0 必须真实完成：

- Node.js + TypeScript。
- Fastify API。
- Vite + React Web UI。
- SQLite 持久化。
- Web / CLI 手动任务入口。
- 工程注册。
- 一个真实 PR/MR provider 路径，GitHub 或 GitLab 二选一。
- 另一个 PR/MR provider 以 contract stub / fake adapter 形式存在，并有 contract tests。
- 本地 git worktree workspace。
- 一个真实 AgentProvider 路径，Codex 或 Claude Code 二选一。
- 另一个 AgentProvider 以 contract stub / fake adapter 形式存在，并有 contract tests。
- LocalWorker。
- Coordinator Surface。
- P0 最小 Coordinator Agent tools。
- workflow protocol adapter。
- 最小 daemon / watchdog / reconciliation / retry。
- human request / approval。
- merge 前重新验证。
- 默认 squash merge。
- merge 冲突进入 future `workflow conflict-resolution` 工作流。
- P0 observability：event timeline、current blocker、surface snapshot、tool trace。
- P0 可靠性底座：operation/idempotency、state_version/CAS、active uniqueness、必要 lock、inspect-before-create。
- workflow handoff protocol。

### 5.2 P1 V1 complete

P1 在 P0 闭环基础上补齐第一版长期能力：

- GitHub 和 GitLab PR/MR provider 都可用。
- CodexProvider 和 ClaudeCodeProvider 都可用。
- daemon/reconciliation/retry 覆盖主要恢复场景。
- full observability 视图补齐。
- lock / lease / fencing 覆盖多 worker 前的关键并发风险。
- contract stub 被真实 adapter 或更完整 fake 覆盖。

### 5.3 P2 planned

P2 能力必须在文档和接口中留好位置，但不进入 P0 完成标准：

- Meego adapter。
- 远程 worker 完整实现。
- 定时任务。
- 多租户权限系统。
- 复杂 DAG engine。
- 完整 plugin marketplace。

## 6. 第一版暂不包含

P0 和 P1 都不应提前实现：

- 通用 DAG engine。
- persona role system。
- hidden memory。
- 高信任自动 merge。
- 跨 project 默认共享记忆。
- source-specific 状态机进入 core。

这些能力要在第一版的接口、文档和数据模型中预留，但不提前实现复杂逻辑。

## 7. 有意偏离 Symphony 的地方

Symphony 的 spec 更偏 scheduler/runner/tracker reader。本项目有意增加：

- Web / CLI operator surface。
- SQLite 持久化。
- Project Registry。
- GitHub / GitLab PR/MR provider。
- merge approval gate。
- Coordinator Surface。
- operation/idempotency ledger。

这些是本项目的产品目标，不是要把 Symphony 扩成通用平台。实现时仍必须保持：

- 单进程优先。
- 有限有序 plan。
- 不做通用 DAG。
- 不做 persona role system。
- 不做 hidden memory。
- 不做高信任自动 merge。
