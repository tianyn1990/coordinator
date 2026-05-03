# Roadmap

> 状态：初始方案基线  
> 适用范围：`coordinator` 第一版实现顺序、完成标准、后续扩展边界。

## 1. 文档定位

本文档回答：

- 第一版如何实现。
- 哪些能力必须第一版完成。
- 哪些能力只预留接口。
- 如何避免因为追求快而破坏长期扩展边界。

## 2. 第一版目标

第一版目标不是做一个极简 demo。

第一版目标是做出长期骨架，但先跑通一条真实闭环：

- Node + TypeScript。
- Web + CLI。
- SQLite。
- operation/idempotency/CAS/必要 lock 可靠性底座。
- Project Registry。
- Coordinator Surface。
- Coordinator Agent tools。
- daemon。
- LocalWorker。
- git worktree workspace。
- 一个真实 AgentProvider 路径。
- 另一个 AgentProvider contract stub / fake adapter。
- workflow protocol adapter。
- 一个真实 PR/MR provider 路径。
- 另一个 PR/MR provider contract stub / fake adapter。
- human request。
- merge approval。
- 最小 observability。

### 2.1 P0 / P1 / P2

#### P0 first E2E

P0 目标是跑通：

```text
register project
create task
plan
create attempt/workspace
start workflow
workflow handoff pr_ready
create PR/MR
human review
approve merge
merge
done
```

P0 只要求一个真实 AgentProvider、一个真实 PR/MR provider，另一个 provider / platform 以 contract stub 或 fake adapter 存在并通过 contract tests。

#### P1 V1 complete

P1 补齐：

- GitHub 和 GitLab 两个平台都可用。
- CodexProvider 和 ClaudeCodeProvider 都可用。
- 更完整的 daemon/reconciliation/retry。
- 更完整的 UI 和 observability。
- 更完整的 lock / lease / fencing。

#### P2 planned

P2 只预留接口和规划，不进入 V1 完成标准：

- Meego adapter。
- remote worker。
- 定时任务。
- multi-agent DAG / decomposition engine。
- plugin marketplace。

## 3. 第一版非目标

第一版不做：

- Meego adapter。
- remote worker 完整执行。
- 定时任务。
- 多租户权限。
- 复杂 DAG engine。
- plugin marketplace。

但必须保留：

- `TaskSource` port。
- `WorkerRuntime` port。
- provider registry。
- source registry。
- PR/MR provider abstraction。

说明：

- GitHub/GitLab、Codex/Claude Code 都是第一版长期目标，但可按 milestone 分阶段验收。第一条 E2E 可先完成一个真实 provider/平台，另一个以 contract stub 起步，随后补齐。
- P2 能力必须写清规划和验收标准，可以在第一版后段继续完成，但不得阻塞 P0 可靠性底座。

## 4. 迭代推进固定动作

后续每一轮实现都必须按固定动作推进。固定动作的目标不是增加流程负担，而是让长期设计心智持续进入实现过程，避免代码在不知不觉中偏离已确认边界。

### 4.1 每轮开始

1. 根据本文档的开发进度记录，确认当前要执行的下一阶段或下一项迭代任务。
2. 根据本轮任务影响范围，先读取根目录 `AGENTS.md`、`docs/AGENTS.md`，再读取相关专题设计文档。
3. 明确本轮任务是否涉及边界、协议、状态机、数据模型、agent 可见性、工具参数、外部副作用或持久化语义。
4. 如果本轮可能改变既有设计文档、设计边界或核心方案，必须先向用户说明冲突点和取舍，获得确认后再继续。
5. 创建对应 OpenSpec change，写清 proposal、spec、design 和 tasks。

### 4.2 每轮实现中

1. 按 OpenSpec tasks 实现本阶段开发任务。
2. 写必要注释，优先解释关键设计原因，而不是逐行解释代码。
3. 为本轮能力补充合适单测、fixture 或 contract test。
4. 在遇到以下决策点时，必须重新阅读相关 `docs/` 文档，并确认实现仍符合总体设计心智：
   - 新增或修改核心对象、状态、状态迁移。
   - 新增或修改 agent surface、agent tools、operator tools。
   - 新增或修改 workflow protocol、provider、workspace、daemon、operation、lock、event、artifact。
   - 引入新依赖或新模块边界。
   - 处理 review 意见时可能扩大范围。
5. 如果出现不确定是否偏离设计的地方，先暂停并与用户确认，再修改设计文档或代码。

### 4.3 每轮验证与 review

1. 运行本轮对应测试、类型检查、构建或 OpenSpec validate。
2. 修复发现的问题并再次验证。
3. 交给独立 `gpt-5.5 high` subagent review。
4. subagent review 请求必须显式要求检查：
   - 是否符合 `docs/` 下总体设计心智和边界约束。
   - 是否在实现过程中持续对齐必要设计文档，而不是只在开始时读过。
   - 是否过度设计。
   - 是否偏离已有协议。
   - 是否污染分层边界。
   - 是否让 agent surface/tools 暴露过多内部字段或复杂 JSON。
5. 主 agent 评估 review 结论。确认合理的问题必须修复，修复后回到 review 步骤，直到没有必须修复的问题。

### 4.4 每轮收尾

1. 归档当前 OpenSpec change。
2. 更新本文档的开发进度和重点事项记录。
3. 更新相关架构、设计或契约文档中必要的已落地事实；凡涉及改变设计边界或核心方案，仍必须先获得用户确认。
4. 提交本轮相关代码和文档改动。提交前必须检查 `git status`，避免裹入无关历史改动。
5. 进入下一轮前，确认本轮没有未归档 change、未记录事项或未提交的相关改动。

## 5. 开发进度与重点事项记录

本节用于持续记录每轮开发进度、当前重点、遗留风险和下一步。每轮结束时必须更新。

### 当前进度

- 当前阶段：`Iteration 1: 项目骨架` 已完成。
- 当前 OpenSpec change：`add-project-skeleton` 已归档为 `openspec/changes/archive/2026-05-03-add-project-skeleton`。
- 当前正式规格：`openspec/specs/project-skeleton/spec.md`。
- 下一阶段：`Iteration 2: 数据模型与 Event Store`。
- 下一阶段重点：在不破坏 `Coordinator Core` 状态所有权的前提下，建立 P0 必需核心表、append-only events、repository 基础、operation/idempotency、state_version/CAS、必要 lock 和 active 唯一性约束。

### 重点关注事项

- 已建立 `apps/api`、`apps/web`、`packages/cli`、`packages/db`、`packages/shared` 的单仓分层骨架。
- 已实现 Fastify `/health`、Vite + React 最小 Web 入口、CLI `health` / `migrate`、SQLite migration runner 和 `0001_metadata.sql`。
- SQLite 当前使用 Node 内置 `node:sqlite`，并通过 `engines.node >=22.22.2` 明确运行时约束；测试仍会出现 Node 的 ExperimentalWarning。后续如部署环境或稳定性要求变化，应在独立 change 中评估替换 driver。
- Iteration 1 未实现完整数据模型、Event Store、operation ledger、daemon、provider、workflow adapter、Coordinator Agent tools 或 agent surface，后续不得把这些能力视为已存在。
- 本轮验证通过：`openspec validate add-project-skeleton --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- 本轮已经过独立 `gpt-5.5 high` subagent review，两轮 review 后无必须修复问题；review 明确检查了是否符合 `docs/` 总体设计心智、是否过度设计、是否污染分层边界。

## 6. 实现顺序

### Iteration 0: 文档基线

目标：

- 落地当前 docs。
- 明确长期边界和第一版范围。

完成标准：

- `docs/AGENTS.md`
- `docs/architecture.md`
- `docs/coordinator-surface.md`
- `docs/agent-tools.md`
- `docs/daemon.md`
- `docs/workflow-protocol.md`
- `docs/execution-workspace.md`
- `docs/project-registry.md`
- `docs/observability.md`
- `docs/contracts.md`
- `docs/operations.md`
- `docs/research.md`
- `docs/roadmap.md`

### Iteration 0.1: 契约与运行机制收敛

目标：

- 新增硬契约文档。
- 新增运行机制文档。
- 新增调研记录。
- 将 review 结论收口到可测试 contract。

完成标准：

- `docs/contracts.md` 覆盖 surface schema、tool visibility、state ownership、operation/idempotency、HumanRequest、handoff、merge approval、artifact path。
- `docs/operations.md` 覆盖 operation ledger、CAS、lock、reconcile、retry、watchdog、resume preflight。
- `docs/research.md` 记录所有已调研来源、可吸收/不吸收点。
- 现有文档引用这些 contract，而不是重复发散。

### Iteration 1: 项目骨架

目标：

- Node + TypeScript。
- Fastify。
- Vite + React。
- SQLite。
- 基础 CLI。

完成标准：

- 可启动 API。
- 可启动 Web。
- 可运行测试。
- SQLite migration 可执行。

### Iteration 2: 数据模型与 Event Store

目标：

- 建核心表。
- 建 append-only events。
- 建基础 repository 层。
- 建 operation ledger。
- 建 state_version / CAS。
- 建 lock / lease / lock_token。
- 建 partial unique index，保证 active 唯一性。

表：

- projects。
- tasks。
- attempts。
- execution_plans。
- plan_steps。
- workspaces。
- agent_sessions。
- workflow_runs。
- pull_requests。
- human_requests。
- events。
- artifacts。
- operations。
- locks。

完成标准：

- 可创建 project/task。
- 所有状态变化和关键 event 同 SQLite transaction。
- CAS conflict 能被测试覆盖。
- operation idempotency key 能防重复副作用。
- active 唯一性约束生效。
- CLI/Web 能查看最小 event timeline。

说明：

- 这一阶段先把 P0 必需表建起来。
- 其他表字段可以 nullable / stubbed / reserved，但必须有 migration 规划。

### Iteration 3: Project Registry

目标：

- 注册工程。
- 检测 git repo。
- 检测 GitHub/GitLab。
- 检测 remote HEAD 并显式确认 default branch。
- 配置 workflow launcher。

完成标准：

- Web/CLI 可注册工程。
- 自动检测 provider。
- 不确定时要求用户选择。
- default branch 检测失败时阻塞注册，直到用户确认。
- 项目 surface 可生成。
- 如果 provider / PR platform 只有 stub，也允许保存项目，但 surface 必须明确暴露缺失能力和补齐路径。

### Iteration 4: Coordinator Surface

目标：

- 将数据库状态翻译成 agent-facing Markdown surface。
- 支持 autonomy guidance。
- 支持 tool visibility。
- 支持 denied actions。
- 支持 memory trust boundary。
- 支持 resume surface。
- 支持 validation contract surface。

完成标准：

- bootstrap surface。
- planning surface。
- execution surface。
- human request surface。
- review surface。
- merge surface。
- fixtures / tests 覆盖工具可见性。
- artifact root 和相对路径规则进入 fixture。

### Iteration 5: Workspace Manager

目标：

- LocalWorker。
- git worktree workspace。
- branch 创建。
- workspace lock。
- workspace reconciliation。
- path realpath containment。
- checkpoint artifact。
- resume preflight。

完成标准：

- task attempt 可创建 workspace。
- workspace path 在 root 内。
- branch 规则稳定。
- 默认 base branch 为 project default branch。
- stale lock / symlink escape / branch exists 场景有测试。

### Iteration 6: Workflow Protocol Adapter

目标：

- 调用 `workflow protocol capabilities/status/start/action/artifacts/events`。
- 如果 workflow 尚未实现完整 protocol，可先用 compatibility adapter 包装现有 CLI，但必须标记为临时。

完成标准：

- 可启动 workflow run。
- 可查询 status。
- 可读取 handoff。
- 不直接读写 `.workflow` 内部 state。
- 不映射 workflow 私有 stage/substate 作为外层状态迁移依据。

说明：

- `stage/substate/gate/allowedActions` 只能作为 debug/display 信息。
- 外层判断只能依赖 `lifecycle + handoff + artifacts + recovery + summary`。

### Iteration 7: Agent Provider

目标：

- CodexProvider。
- ClaudeCodeProvider。
- agent session state。
- transcript / prompt / surface snapshot artifact。

完成标准：

- outer Coordinator Agent 可通过 provider 运行。
- inner workflow coding agent 可通过 provider 运行。
- 两者 provider 可配置。
- P0 至少一条真实路径可用，另一条可作为 stub / fake。

### Iteration 8: Coordinator Agent Tools

目标：

- 实现核心 tools。
- 工具参数保持窄。
- 工具调用写 event。
- artifact path 校验。
- 副作用工具 operation 化。
- Web-only tools 与 agent tools 分离。

优先工具：

- `write_execution_plan`
- `create_attempt`
- `create_workspace`
- `start_workflow_run`
- `inspect_workflow_run`
- `ask_human`
- `create_pr`
- `request_merge_approval`
- `merge_after_approval`
- `mark_done`
- `handoff_to_human`

完成标准：

- agent 只能调用当前 surface 暴露工具。
- 不允许复杂 JSON 主交互。
- 工具失败有 recovery surface。
- inspect-before-create 覆盖 workspace/workflow/pr/merge。
- P0 最小工具闭环先可跑通，非闭环工具可留到 P1。

### Iteration 9: Daemon

目标：

- scheduler loop。
- watchdog loop。
- reconciliation loop。
- retry loop。
- human request loop。
- reconciliation invariant matrix。
- watchdog timeout / process stop / process group kill。
- retry budget / handoff。

完成标准：

- daemon 重启后恢复 active task。
- stalled session 可检测。
- human answer 可唤醒。
- retry 可执行。
- concurrency 可配置。
- claim/CAS/lock/idempotency 的最小故障注入测试通过。

### Iteration 10: Web UI

目标：

- 手动 task 创建。
- task list。
- task detail。
- event timeline。
- execution plan。
- human request answer。
- PR/MR approval。
- pause/resume/cancel/retry。

完成标准：

- 不依赖外部任务源即可完成手动任务闭环。
- 能看清当前 blocker。
- 能显式批准 merge。
- approval snapshot 在 UI 可见。
- HumanRequest 生命周期可追踪。

### Iteration 11: GitHub/GitLab PR/MR Provider

目标：

- 创建 PR/MR。
- 更新 PR/MR。
- inspect review。
- merge after approval。
- conflict detection。
- approval snapshot 校验。
- merge result reconciliation。

完成标准：

- P0 至少一个平台可创建并 merge。
- P1 GitHub 和 GitLab 都可创建并 merge。
- 默认 squash merge。
- merge 前重新验证。
- head/base/checks 变化后 approval 失效。

### Iteration 12: P1 / P2 Hardening

目标：

- 补齐 P1 的第二套真实 provider / platform。
- 补齐 P2 的接口与规划文档，但不强行实现。
- 扩大故障注入与恢复测试。
- 验证长期边界没有被 stub 污染。

完成标准：

- 文档与实现一致。
- P0 闭环稳定。
- P1 补齐能力可用。
- P2 只停留在预留接口和规划记录。

## 5. 后续扩展

### 5.1 Meego Adapter

在第一版稳定后接入。

复用：

- TaskSource。
- HumanInteraction。
- external status mapping。
- report publishing。

验收建议：

- polling 或 webhook 至少实现一种。
- Meego 状态映射不进入 core。
- Meego report 由 adapter 发布，核心只写 TaskEvent。

### 5.2 Remote Worker

复用：

- WorkerRuntime。
- WorkspaceStrategy。
- AgentProvider。
- daemon heartbeat。

规划细节：

- RemoteWorker 遵守同一 WorkerRuntime interface。
- workspace root 在远程解释。
- agent provider auth 不由 core 硬编码。
- heartbeat 丢失后进入 reconciliation。
- 不允许本地 worker 静默接管已经在远程产生副作用的 attempt。

验收建议：

- 远程 worker register/heartbeat。
- 远程 workspace create/inspect。
- provider command 可执行。
- 断连后状态可恢复或 handoff。

### 5.3 Task Source 扩展

包括：

- GitHub Issues。
- GitLab Issues。
- Linear。

规划细节：

- 所有 source adapter 只产出 normalized task。
- source status mapping 可配置。
- source comment/report 不成为 core state。
- webhook/polling 统一转 TaskEvent。

### 5.4 conflict-resolution workflow

依赖 `workflow` 新增 profile。

Coordinator 只负责在 merge conflict 时启动对应 workflow run。

规划细节：

- merge conflict 产生 workflow handoff 或 coordinator blocked state。
- Coordinator Agent 可启动 `conflict-resolution` profile。
- 冲突解决完成后必须重新验证并刷新 merge approval snapshot。

验收建议：

- 人工制造冲突。
- 进入 conflict-resolution。
- 解决后 approval 失效并重新请求。

### 5.5 decomposition workflow

依赖 `workflow` 新增 profile。

Coordinator 可用它做多子任务规划。

规划细节：

- decomposition 输出 plan artifact。
- coordinator 不把 plan artifact 自动变成 DAG。
- 子任务必须显式创建 Task/Attempt。
- parent/child 关系只作为 trace，不作为自由编排 engine。

验收建议：

- decomposition 生成子任务建议。
- 人或 Coordinator Agent 显式创建子任务。
- 子任务各自有独立 attempt/workspace。

### 5.6 完整 circuit breaker / dead-letter UI

规划细节：

- 基于 retry budget 和 error kind。
- 进入 terminal handoff 或 failed 后在 UI 中展示。
- 不做分布式队列式复杂 dead-letter 系统。

验收建议：

- 连续 provider failure 后进入 handoff。
- UI 可查看失败链路和恢复建议。

### 5.7 Provider routing policy

规划细节：

- 用 capability/tag 表达能力，不用品牌表达业务语义。
- project/task 可配置偏好。
- Coordinator Surface 暴露能力和当前映射。

验收建议：

- 同一任务可切换 provider。
- 切换理由写入 event。
- agent 不直接依赖厂商品牌做业务判断。

## 6. 架构防污染规则

必须避免：

- core import GitHub/GitLab 具体实现。
- scheduler import manual source。
- Coordinator Agent 直接访问 SQLite。
- PR provider 直接推进 task completed。
- workflow adapter 读取 `.workflow` private state。
- Web UI 绕过 core 直接改 attempt 状态。
- 工具接收复杂 JSON payload。
- daemon 做业务语义判断。
- handoff 镜像 workflow 内部 stage/substate。
- hidden cross-project memory。
- execution plan 演化成 DAG engine。

## 7. 测试策略

第一版至少需要：

- unit tests。
- repository tests。
- surface fixture tests。
- tool visibility tests。
- daemon simulation tests。
- workspace path safety tests。
- workflow adapter contract tests。
- provider stub tests。
- PR/MR provider smoke tests。
- operation idempotency tests。
- CAS conflict tests。
- duplicate scheduler tick tests。
- stale lock takeover tests。
- approval invalidation tests。
- workflow handoff contract tests。
- crash-after-side-effect / crash-before-event tests。

## 8. Definition of Done

### 8.1 P0 DoD

- 文档与实现一致。
- Web 可完成手动任务闭环。
- SQLite 可恢复状态。
- daemon 可恢复 active task。
- 一个真实 AgentProvider 可用。
- 一个真实 PR/MR provider 可用。
- workflow protocol adapter 可运行。
- merge 必须审批。
- 事件完整可查。
- 关键扩展点有接口。
- operation/idempotency/CAS/必要 lock 可靠性底座可验证。
- workflow handoff 取代 ready-only readiness。

### 8.2 P1 DoD

- 第二个 AgentProvider 可用。
- 第二个 PR/MR provider 可用。
- 更完整的 recovery / retry / reconciliation 可用。
- full observability 视图可用。

### 8.3 P2 Acceptance

- P2 能力仍然只在文档和接口里预留，按需进入后续实现。
