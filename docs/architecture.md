# coordinator 总体架构

> 状态：初始方案基线  
> 适用范围：`coordinator` 的长期定位、分层、边界、第一版范围，以及与 `workflow` 的协作关系。

## 1. 背景

`workflow` 已经形成一套面向 coding agent 的内层工作流系统。它强调：

- runtime 是唯一控制面。
- coding agent 只能基于当前明确可见的 surface 行动。
- workflow profile 是少量受控路线，而不是任意编排。
- OpenSpec 是 service，不是第二控制面。
- 复杂信息优先通过 artifact 承载，而不是复杂 JSON 工具参数。

`coordinator` 的目标不是替代 `workflow`，也不是把 `workflow` 做成一个更厚的调度器。

`coordinator` 的目标是建立外层无人值守任务协调系统，让一个任务可以从创建、规划、实现、PR/MR、review、rework、merge 到 done 形成完整闭环。

补充定位：

```text
coordinator 不是 workflow 遥控器。
coordinator 是多个 workflow run 和 agent session 的管理者、观察者、恢复者和人工 gate 收件箱。
```

因此，当 inner coding agent 仍在运行时，Coordinator 可以观察 heartbeat、provider event、workflow status 和 artifact 引用，但不应因为 workflow 暴露 `allowedActions` 就中断流程让开发者逐项点击。开发者只应在真正 operator gate、handoff、PR/MR/review/merge、失败恢复或高风险 attention 出现时介入。

## 2. 核心定位

```text
coordinator 是外层任务执行控制面。
workflow 是内层代码变更执行协议。
```

`coordinator` 负责：

- 管理任务。
- 管理工程。
- 管理 attempt。
- 管理 execution plan。
- 管理 workspace。
- 管理 outer / inner agent session。
- 调用一次或多次 `workflow` run。
- 管理 PR/MR。
- 管理 human review。
- 管理 rework / merge / done。
- 记录完整可观测性。

`workflow` 负责：

- 单个代码工作单元内部的阶段化推进。
- requirements / implementation / review。
- profile graph。
- stage / substate / gate。
- allowed actions / denied actions。
- OpenSpec 使用时机。
- inner coding agent 的执行边界。

`allowed actions / denied actions` 是 workflow 内部控制面投影，不等同于 Coordinator Web 的 human todo。Coordinator 只能将明确 operator-facing 的 gate 收敛成 Web Action Card；agent/internal action 应保持在 Workflow Lens / debug detail 中作为观察信息。

## 3. 总体分层

```text
Web UI / CLI
  |
  v
Coordinator Core
  |
  +-- Coordinator Agent
  |
  v
Execution Adapters
  |
  +-- Workspace Manager
  +-- Agent Provider Adapter: Codex SDK / Claude Agent SDK / CLI fallback
  +-- Workflow Runtime Adapter: @hetao-ai/workflow
  +-- Git Provider
  +-- Pull Request Provider: GitHub / GitLab
  |
  v
workflow

Task Source Adapters
  |
  +-- Web / CLI manual source
  +-- future Meego
  +-- future GitHub Issues
  +-- future GitLab Issues
  +-- future Linear
```

第一版实现可以是单进程。分层是代码边界和协议边界，不要求第一版拆成多个服务。

## 4. 一级模块

### 4.1 Web / CLI

Web / CLI 是 operator surface。

职责：

- 注册工程。
- 创建手动任务。
- 查看任务列表。
- 查看任务详情。
- 查看 execution plan。
- 查看 attempt。
- 查看 workspace。
- 查看 workflow run。
- 查看 agent session。
- 查看 PR/MR。
- 回答 human request。
- 显式批准 merge。
- pause / resume / cancel / retry。

它不是：

- Coordinator Agent。
- 任务语义判断器。
- workflow stage 推进器。

### 4.2 Coordinator Core

Coordinator Core 是外层程序控制面。

职责：

- task lifecycle。
- project lifecycle。
- attempt lifecycle。
- execution plan 持久化。
- bounded concurrency。
- human request 状态。
- PR/MR lifecycle。
- merge policy。
- event append。

不负责：

- 直接写业务代码。
- 直接替 `workflow` 推进 stage。
- 自动推断复杂业务语义。
- 绕过 Coordinator Agent 的决策记录。

边界说明：

- Coordinator Core 是唯一状态机和策略校验层。
- Daemon 是 Core 的后台 driver，负责触发 scheduling / watchdog / reconciliation / retry，但不拥有业务状态迁移规则。
- Execution Adapters 只执行外部副作用，不直接推进 task completed。

### 4.3 Coordinator Agent

Coordinator Agent 是外层智能体。

职责：

- 读取 Coordinator Surface。
- 根据任务目标制定 execution plan。
- 理解任务已有的人类显式 workflow 选择和 runtime 返回的 actual profile，但不自行选择 workflow profile。
- 调用受控 tools。
- 根据 workflow run 结果调整下一步。
- 判断是否需要 human request。
- 汇总实现结果。
- 生成 PR/MR title/body。
- 处理 review 后的 rework 决策。

它必须受程序约束：

- 只能使用当前 surface 明确暴露的工具。
- 工具参数必须尽量窄。
- 复杂计划、PR body、review summary 等写入指定 artifact。
- 不能直接改数据库状态伪造完成。
- 不能绕过 merge approval。
- 不能绕过 `workflow` protocol。
- 不能把 workflow `allowedActions/actionInputs` 当作自己的 action queue。
- 不能在 inner coding agent 仍在运行时替开发者抢先确认 workflow 内部 action。
- 不能使用 hidden memory。

### 4.4 Execution Adapters

Execution Adapters 负责运行真实外部动作。

职责：

- 创建 workspace。
- 创建 git worktree。
- 创建 branch。
- 启动 outer / inner agent session。
- 调用 `workflow` protocol。
- 读取 workflow status。
- 收集 artifact。
- 运行 git / PR / merge 操作。

它们不负责：

- task lifecycle。
- merge policy。
- human review 判断。
- workflow profile 语义选择。

Agent Provider Adapter 的长期实现应采用 SDK-first：Codex 通过 `@openai/codex-sdk`，Claude Code / Claude Agent 通过 `@anthropic-ai/claude-agent-sdk`，CLI subprocess 仅作为 compatibility fallback。SDK 仍可能在内部管理本地子进程，但 Coordinator 不应长期手写易碎 CLI 参数组合；provider session、事件流、取消、resume、权限和 cwd 应由 adapter 统一封装。

### 4.5 Task Source Adapters

任务源 adapter 负责把外部系统转成内部 task。

第一版只做：

- Web manual source。
- CLI manual source。

后续扩展：

- Meego。
- GitHub Issues。
- GitLab Issues。
- Linear。

任务源 adapter 不能污染 core。Core 只认识 normalized task。

## 5. 核心对象

第一版应保留以下核心对象：

- `Project`
- `Task`
- `Attempt`
- `ExecutionPlan`
- `PlanStep`
- `Workspace`
- `AgentSession`
- `WorkflowRun`
- `PullRequest`
- `HumanRequest`
- `Artifact`
- `Event`

这些对象不是为了过度建模，而是为了支持：

- 中断恢复。
- Web UI。
- daemon reconciliation。
- 远程 worker 扩展。
- 多 agent provider。
- 多 workflow run 串联。
- 事后排查。

## 6. Task 和 Attempt

`Task` 表示用户或任务源提出的一件工作。

`Attempt` 表示对该任务的一次执行尝试。

一个 task 可以有多个 attempt：

```text
task A
  attempt 1
    workflow run: feature
    PR/MR
    review feedback
  attempt 2
    workflow run: bugfix / rework
    merge
```

continuation / retry 默认复用同一个 attempt 和 workspace。

重大 rework 可以创建新 attempt，具体由 Coordinator Agent 根据 surface 和 policy 决定，但需要记录事件。

## 7. Execution Plan

Execution Plan 是 Coordinator Agent 的外层计划，必须持久化。

它不是复杂 DAG engine。

第一版只需要支持有序 steps：

- pending。
- running。
- blocked。
- completed。
- skipped。
- failed。

每个 step 可以关联：

- workspace。
- agent session。
- workflow run。
- human request。
- PR/MR。
- artifact。

计划可以被 Coordinator Agent 修改，但每次修改必须记录事件。

计划不表达任意依赖图，不表达多 agent role 编排，也不替代 daemon 的状态机。

## 8. 多 workflow run

一个 task 可以串联多个 `workflow` run。

示例：

```text
task
  workflow run 1: decomposition
  workflow run 2: feature child A
  workflow run 3: micro-change child B
  workflow run 4: bugfix regression fix
```

第一版不做复杂 DAG engine。

外层 agent 可以用有限工具串联多个 run，Core 记录关系和事件。

## 9. Agent Provider

外层和内层都应支持 Codex / Claude Code。

组合示例：

```text
outer: Codex, inner: Codex
outer: Codex, inner: Claude Code
outer: Claude Code, inner: Codex
outer: Claude Code, inner: Claude Code
```

第一版必须实现：

- `CodexProvider`
- `ClaudeCodeProvider`

成熟度可以不同，但 provider interface 不能假设只有 Codex。

Provider routing 应优先基于 capability/tag，例如：

```text
strong-planning
long-context
code-editing
review
fast-fix
```

不要把 Codex / Claude Code 品牌名写成业务语义。

## 10. PR / MR 和 merge

第一版支持 GitHub 和 GitLab。

推荐策略：

- PR/MR title/body 由 Coordinator Agent 生成。
- 程序模板提供兜底。
- 正文复杂内容写入 `<workspace>/coordinator/artifacts/pr-body.md`，agent tool 只传相对路径 `pr-body.md`。
- merge 前必须人工显式批准。
- merge approval 必须绑定 PR/MR head/base/validation snapshot。
- 默认 squash merge。
- merge 前同步默认分支并重新验证。
- 冲突时进入 future `workflow conflict-resolution`。
- merge 成功后标记 task done。

## 11. 工程注册

第一版需要 Project Registry。

原因：

- 同一 coordinator 可以管理多个工程。
- 每个工程有不同 repo path、repo URL、默认分支、Git provider、workflow launcher、workspace root、agent defaults。
- GitHub / GitLab 需要 provider 检测和配置。

默认分支必须在注册工程时检测并显式确认。可以选择 `master`、`main` 或其他分支，但不允许静默 fallback。

## 12. Daemon

第一版必须有 daemon。

daemon 不是智能体。它负责可靠性：

- 定期调度。
- 探活。
- reconciliation。
- retry。
- 恢复 active task。
- 唤醒 human request 已回答的任务。
- 检查 stalled session。
- 控制并发。

daemon 还必须遵守 operation/idempotency/CAS/lock contract。它发现问题，不替 agent 做业务语义判断。

## 13. Observability

第一版必须有完整事件记录。

至少三层事件：

- Coordinator Event。
- Agent Event。
- Workflow Event。

默认写 SQLite。必要时也可以导出 JSONL。

Web UI 必须能解释：

- 当前卡在哪。
- 等待谁。
- 上一次 tool 是什么。
- agent 为什么做这个决策。
- workflow 处于哪个 stage/gate。
- PR/MR 处于什么状态。

## 14. 第一版技术栈

- Node.js。
- TypeScript。
- Fastify。
- Vite + React。
- SQLite。
- Git worktree。
- GitHub / GitLab provider。
- Codex。
- Claude Code。

## 15. 第一版不做

- Meego adapter。
- 远程 worker 完整实现。
- 多租户权限。
- 定时任务。
- 复杂 DAG engine。
- plugin marketplace。

但必须预留接口。

## 16. 关键设计原则

### 16.1 接口先稳定，能力后填充

第一版要定义 ports：

- `TaskSource`
- `AgentProvider`
- `WorkflowRuntime`
- `WorkspaceStrategy`
- `WorkerRuntime`
- `GitProvider`
- `PullRequestProvider`
- `HumanInteraction`
- `EventSink`

但第一版实现可以少。

### 16.2 边界先隔离，实现先单体

第一版单进程即可，但代码不要把 source、agent provider、workflow adapter、git provider、UI 逻辑混在 core 中。

### 16.3 Surface 优先

Coordinator Agent 和 inner coding agent 一样，需要明确可见面。

它不能靠猜数据库字段、猜目录、猜工具名来决策。

### 16.4 工具参数保持窄

复杂 JSON 对 agent 不友好。

工具应优先使用：

- 无参数。
- 少量枚举参数。
- 文件路径。
- 已存在 object id。

复杂内容写 Markdown artifact。

### 16.5 人类确认是一等状态

等待人不是失败。

human request 必须可恢复、可展示、可回答、可重新唤醒任务。

### 16.6 Merge 必须显式审批

即使 autonomy 为 aggressive，merge 第一版也必须通过 Web/CLI 显式批准。

### 16.7 Operation-first 副作用

所有外部副作用都必须先有 operation intent，再执行，再 reconcile。

外部系统不存在强 exactly-once。本项目追求的是：

```text
intent persisted + idempotent execution + inspect-before-create + reconcile
```

### 16.8 Memory trust boundary

不存在 hidden memory。

记忆必须 artifact-first，并通过 Coordinator Surface 显式暴露。

跨 project memory 默认禁止。
