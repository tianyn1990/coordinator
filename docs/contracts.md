# coordinator 契约基线

> 状态：初始契约基线  
> 适用范围：Coordinator Surface、工具可见性、状态迁移、幂等副作用、HumanRequest、workflow handoff、merge approval、artifact 路径与安全边界。

## 1. 文档定位

本文档只记录稳定、可测试、不可越界的契约。

它不重复解释背景，也不替代各专题文档。

如果本文件与设计说明冲突，优先检查设计说明是否偏离本契约。

## 2. 总体硬边界

### 2.1 coordinator 与 workflow

- `coordinator` 是外层任务控制面。
- `workflow` 是内层单个代码工作单元执行协议。
- `coordinator` 不读写 `.workflow` private state。
- `coordinator` 不映射 workflow 私有 stage/substate 来判断业务完成。
- `coordinator` 只通过 `workflow protocol` 消费 workflow 声明的 handoff、status、artifact、events。
- workflow `allowedActions`、`deniedActions` 和 `actionInputs` 不是 Coordinator 的自动执行计划，也不是 Web needs-me 的充分条件。
- Coordinator 只能把明确 operator-facing 的 gate 收敛成 Web Action Card；`materialize-change <change-id>`、对齐检查、实现推进、inspect/resume 等 agent/internal action 默认只进入 debug/display。
- Coordinator 可以派生 operator-only workflow runtime observation 来解释 owner/mode；该摘要不得成为 task/PR/merge 完成判断，也不得扩大 Coordinator Agent Surface。
- 当前版本不要求修改 `workflow protocol`；`operatorActions`、`agentActions`、`blocker.owner`、`agent.state` 等只作为未来可选协议增强。

### 2.2 Coordinator Agent

- Coordinator Agent 只能基于 Coordinator Surface 行动。
- Coordinator Agent 只能调用当前 surface 暴露的 agent tools。
- Coordinator Agent 不能直接改 SQLite。
- Coordinator Agent 不能调用 Web/operator-only tools。
- Coordinator Agent 不能绕过 HumanRequest 或 merge approval。

### 2.3 Daemon

- daemon 是可靠运行时，不是智能体。
- daemon 不做业务语义判断。
- daemon 不选择 workflow profile。
- daemon 不判断 review 结论。
- daemon 只做调度、探活、reconciliation、retry、恢复、并发控制和事件记录。
- daemon 可以观察 agent/provider/workflow 生命周期，但不得在 inner coding agent 仍在运行时因为 `allowedActions` 出现而打断开发者或自动执行 workflow action。

### 2.4 Agent Provider

- AgentProvider 是执行适配层，不是 Core 状态机。
- Codex / Claude Code 的长期主路径应使用官方 SDK adapter；CLI 直接拼参数只能作为 compatibility fallback。
- SDK raw event、provider session 文件、provider 私有 cwd 编码、权限细节和完整 JSONL transcript 不是真相源。
- Core 只保存统一的 provider session id、cwd/sessionRoot、provider version、权限 profile 摘要、raw transcript artifact ref、normalized event summary 和极少数 lifecycle signal。
- outer Coordinator Agent 默认是 decision-only：cwd 固定为 sessionRoot，权限最小，不直接修改 repo/workspace。
- inner coding agent 的 repo 修改能力必须位于 workflow/inner runtime 边界内，不能绕过 workflow protocol 或 workspace/fencing 约束。

## 3. Coordinator Surface Contract

### 3.1 Surface 双形态

每次唤醒 Coordinator Agent 必须生成：

- machine JSON surface。
- agent-facing Markdown surface。

JSON 用于测试、审计和 UI。

Markdown 是 Coordinator Agent 的主要输入。

两者必须来自同一个 snapshot，不允许出现双真相。

### 3.2 Required Fields

每个 surface 至少包含：

```text
surface_id
surface_kind
task
project
attempt
current_state
execution_plan
workspace
workflow_runs
agent_sessions
pull_request
human_requests
autonomy_guidance
available_tools
denied_actions
recommended_next_step
recovery
artifact_root
created_at
```

### 3.3 Surface Kind

第一版支持：

```text
bootstrap
planning
execution
human_waiting
human_answered
review
merge_waiting
completed
failure
resume
```

每种 kind 必须有 fixture。

### 3.4 Surface 不变量

- `available_tools` 只包含当前允许 agent 调用的工具。
- `denied_actions` 必须包含当前高风险禁止事项。
- `recommended_next_step` 必须唯一。
- `recovery` 必须说明失败后恢复方式。
- `artifact_root` 必须指向当前 surface 可用的 coordinator artifact root；pre-workspace 阶段指向 task-local root，workspace ready 后指向当前 attempt 的 workspace coordinator artifact root。
- 任何进入 agent 世界的 event/log/artifact 必须经 surface 摘要或显式引用。

### 3.5 Completed Surface

任务完成后：

- 不再暴露执行类工具。
- 只允许 inspect / export / view 类操作。
- 明确说明 task 已 completed/handoff/canceled/failed。

### 3.6 Human Waiting Surface

等待 human request 时：

- 不暴露副作用工具。
- 可暴露 inspect 类工具。
- 推荐下一步必须是等待或查看 human request。

### 3.7 Merge Waiting Surface

等待 merge approval 时：

- `merge_after_approval` 只有在 approval snapshot 有效时才可见。
- 未审批时只暴露 `request_merge_approval` 或 inspect。

## 4. Tool Visibility Contract

### 4.1 工具类别

工具分为：

- agent tools。
- operator tools。
- internal daemon actions。

只有 agent tools 可以出现在 Coordinator Surface。

operator tools 只能由 Web/CLI 触发。

internal daemon actions 只能由 daemon loop 触发。

### 4.2 Agent Tool 最小集合

第一版 agent tools：

```text
write_execution_plan
revise_execution_plan
create_attempt
create_workspace
start_workflow_run
resume_workflow_run
inspect_workflow_run
ask_human
create_pr
update_pr
inspect_review
start_rework
request_merge_approval
merge_after_approval
mark_done
handoff_to_human
```

说明：

- 以上是 agent-visible 的最小集合，不代表每个 state 都可见。
- `complete_workflow_handoff`、`record_human_answer`、`cancel_task`、`approve_merge`、`reject_merge` 不属于 agent tools，不能出现在 Coordinator Surface。

### 4.3 Operator-only Tools

第一版 operator-only tools：

```text
record_human_answer
approve_merge
reject_merge
pause_task
resume_task
cancel_task
retry_task
register_project
update_project
```

这些不得进入 agent surface。

### 4.4 Tool Visibility Matrix

`contracts.md` 是唯一真源。`agent-tools.md` 中的工具章节不应再维护另一份矩阵。

| State | Visible agent tools |
| --- | --- |
| no plan | `write_execution_plan`, `ask_human` |
| plan ready, no attempt | `create_attempt`, `revise_execution_plan`, `ask_human` |
| attempt created, no workspace | `create_workspace`, `revise_execution_plan`, `ask_human` |
| workspace ready | `start_workflow_run`, `revise_execution_plan`, `ask_human` |
| workflow running | `inspect_workflow_run`, `resume_workflow_run`, `ask_human` |
| workflow handoff `pr_ready` | `create_pr`, `revise_execution_plan`, `ask_human` |
| workflow handoff `human_review_required` | `ask_human`, `revise_execution_plan` |
| workflow handoff `manual_handoff` | `handoff_to_human`, `ask_human`, `revise_execution_plan` |
| workflow handoff `blocked` | `ask_human`, `handoff_to_human`, `revise_execution_plan` |
| workflow handoff `completed_no_pr` | `mark_done` only if no-PR policy and evidence artifact are valid; otherwise `ask_human` |
| PR/MR open | `inspect_review`, `update_pr`, `ask_human` |
| review feedback | `start_rework`, `revise_execution_plan`, `ask_human` |
| merge approval missing | `request_merge_approval`, `inspect_review`, `ask_human` |
| merge approval valid | `merge_after_approval`, `inspect_review` |
| completed/handoff/canceled/failed | inspect only |

具体实现可以进一步收窄，但不能放宽到全量工具可见。

`start_workflow_run` 可见时，outer Agent 只请求启动 workflow，不选择具体 profile。human explicit selection 只能来自外部入口或任务来源；没有 human explicit selection 时，Core 必须用 omitted/default/auto 语义委托 workflow runtime 自主选择 actual profile。

## 5. State Transition Ownership

### 5.1 状态所有权矩阵

| Entity | State owner | Notes |
| --- | --- | --- |
| Project | Web/CLI operator | Agent 不直接创建/修改 project |
| Task | Core + operator | Agent 只能请求 handoff/done，Core 校验 |
| Attempt | Core via tool | Agent 调 `create_attempt`，Core 执行 |
| ExecutionPlan | Coordinator Agent via artifact | Core 只保存和校验 |
| Workspace | Core via workspace tool | Agent 不传复杂 path |
| AgentSession | Execution Adapters / daemon | Agent 不直接改 session state |
| WorkflowRun | Workflow adapter / daemon | 以 workflow protocol 为准 |
| PullRequest | PR provider / Core | Agent 可请求创建/更新 |
| HumanRequest | Core + operator | Agent 只能创建请求；operator 回答并由 Core 唤醒 agent |
| MergeApproval | Operator | Agent 不可自批 |
| Event | Core | 关键事件与状态同事务 |

### 5.2 CAS

所有核心实体必须有：

```text
state_version
updated_at
```

状态更新必须基于 expected `state_version`。

CAS 失败必须重新读取状态，生成新的 surface 或返回受控 failure。

## 6. Active Uniqueness Contract

第一版必须用数据库约束或等价事务保证：

- 一个 task 同时最多一个 active Coordinator Agent decision loop。
- 一个 attempt 同时最多一个 active workspace。
- 一个 attempt 同时最多一个 active workflow run。
- 一个 blocked gate 同时最多一个 pending human request。
- 一个 PR snapshot 同时最多一个 active merge approval。
- 一个 PR merge 同时最多一个 active merge operation。
- 一个 operation idempotency key 同时最多一个 non-terminal operation。

## 7. Operation / Idempotency Contract

所有有外部副作用的动作必须创建 operation record。

### 7.1 Operation Fields

```text
operation_id
idempotency_key
kind
status
project_id
task_id
attempt_id
external_id
started_at
completed_at
failure_code
last_observed_state
```

### 7.2 Operation Status

```text
planned
running
succeeded
failed
unknown
reconciled
canceled
```

### 7.3 Exactly-once 声明

外部系统不存在强 exactly-once。

`coordinator` 只能保证：

```text
intent persisted + idempotent execution + inspect-before-create + reconcile
```

### 7.4 Inspect-before-create

以下动作必须 inspect-before-create：

- workspace。
- branch。
- workflow run。
- PR/MR。
- merge approval。
- merge。

### 7.5 Replay / Recovery Rules

外部副作用一旦 crash 中断，必须根据 operation 状态和外部观察结果决定恢复方式。

| Operation status | Observed external state | Recovery |
| --- | --- | --- |
| planned | no external side effect | start operation |
| running | external absent | retry if within budget |
| running | external exists and matches intent | mark succeeded or reconciled |
| running | external exists but conflicts with intent | mark unknown and handoff |
| failed | no external side effect | retry if retryable |
| failed | external exists | reconcile before retry |
| unknown | external unclear | inspect again, then handoff or retry |
| reconciled | external matches DB | no-op |

## 8. HumanRequest Contract

### 8.1 Lifecycle

```text
created -> waiting -> answered -> consumed -> resolved
                           |-> superseded
                           |-> canceled
                           |-> expired
```

### 8.2 Rules

- human answer 不直接推进业务状态。
- human answer 只唤醒 Coordinator Agent。
- answer 必须绑定 request version。
- 同一 blocked gate 默认只能有一个 waiting request。
- agent 消化回答后必须产生 consumed/resolved event。
- 如果 agent 需要追问，应 supersede 旧 request 或创建 linked request。

### 8.3 Required Fields

```text
request_id
task_id
attempt_id
blocked_gate_id
kind
question_artifact
status
version
created_by
answer_artifact
answered_by
answered_at
consumed_by_surface_id
supersedes_request_id
expires_at
```

## 9. Workflow Handoff Contract

workflow protocol 不暴露单一 `readyForPr` 作为核心完成语义。

改用：

```text
handoff.kind
handoff.reason
handoff.artifacts
handoff.nextStep
handoff.deniedActions
handoff.recovery
```

### 9.1 Handoff Kind

```text
pr_ready
human_review_required
manual_handoff
blocked
completed_no_pr
```

### 9.2 Rules

- coordinator 只消费 workflow 显式 handoff。
- coordinator 不把 workflow stage/substate 映射成 handoff。
- handoff 是边界结果，不是 workflow 内部状态镜像。
- handoff artifacts 只读。
- `stage/substate/gate` 只能用于 debug/display，不得作为外层状态迁移依据。

## 10. Merge Approval Contract

merge approval 不是布尔值。

### 10.1 Snapshot

approval 必须绑定：

```text
pr_id
head_sha
base_sha
validation_run_id
validation_status
validation_completed_at
validation_artifact
validation_expires_at
merge_strategy
approved_by
approved_at
```

### 10.2 Invalidation

以下变化会使 approval 失效：

- PR/MR head SHA 变化。
- base SHA 变化。
- validation 结果变化或过期。
- merge strategy 变化。
- review status 变化为 blocking。
- validation_artifact 不可解析或与当前 PR 不匹配。

### 10.3 Merge 前检查

merge 前必须：

1. 读取当前 PR/MR head/base。
2. 校验 approval snapshot。
3. 校验 validation。
4. 检查冲突。
5. 执行默认 squash merge。
6. reconcile merge result。

### 10.4 P0 已落地约束

当前 P0 实现已经落地以下硬约束：

- `create_pr` 必须基于 workflow protocol handoff `pr_ready`，不得由 workflow stage/substate/gate 推导。
- PR/MR create 必须 inspect-before-create；inspect 失败或输出不可解析时不能当成外部 PR/MR 不存在。
- `request_merge_approval` 必须 operation 化，并绑定当前 PR/MR snapshot；不同 snapshot 的旧 pending/approved approval 必须先失效，再创建新 approval。
- Surface 只有在 PR/MR status 可 merge、review status 为 `clean`/`approved`，且 approval 的 `head_sha/base_sha/validation_run_id/merge_strategy` 全部存在并匹配时，才允许暴露 `merge_after_approval`。
- merge 前必须重新 inspect PR/MR 并刷新 snapshot；如 snapshot 与 approval 不匹配，必须拒绝 merge。

## 11. Artifact Path Contract

canonical artifact root：

pre-workspace：

```text
<workspace-root>/<project-id>/<task-id>/_task/coordinator/artifacts/
```

workspace ready 后：

```text
<workspace>/coordinator/artifacts/
```

agent tool 只接收相对当前 surface `artifact_root` 的路径。

禁止：

- 绝对路径。
- `../`。
- symlink escape。
- 引用源码目录文件作为工具 payload。

所有 path 必须 realpath containment check。

## 12. Memory Trust Boundary

记忆分层：

```text
attempt-local
project-local
cross-project
```

规则：

- attempt-local 可默认暴露给同 attempt。
- project-local 必须经 surface 明确暴露。
- cross-project 默认禁止。
- 不存在 hidden memory。
- memory 必须 artifact-first。

## 13. 测试要求

第一版必须有：

- surface fixture tests。
- tool visibility tests。
- CAS conflict tests。
- idempotency tests。
- duplicate scheduler tick tests。
- human request lifecycle tests。
- merge approval invalidation tests。
- artifact path containment tests。
- workflow handoff contract tests。
