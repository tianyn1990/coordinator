# Coordinator Agent Tools

> 状态：初始方案基线  
> 适用范围：外层 `Coordinator Agent` 可调用工具、工具参数风格、副作用边界、artifact 使用约定。

## 1. 文档定位

Coordinator Agent 需要智能，但不能无限自由。

它必须通过受控工具行动。

工具设计目标：

- 少量。
- 高层。
- 窄参数。
- 副作用明确。
- 状态可恢复。
- 失败可观察。

这与 `workflow` 项目的命令设计原则一致：不要让 agent 手写复杂 JSON 载荷来表达本应由当前 surface 已经明确的流程事实。

## 2. 工具设计原则

### 2.1 工具是行动边界，不是数据搬运接口

工具不应用来传递大块业务上下文。

如果信息复杂，应写 artifact，然后工具接收 artifact path。

canonical artifact root 固定为：

```text
<workspace>/coordinator/artifacts/
```

工具参数只接受相对此 root 的相对路径。

### 2.2 工具参数必须窄

优先使用：

- id。
- enum。
- short string。
- artifact path。
- boolean。

避免：

- 深层 JSON。
- 大段 Markdown。
- 混合多语义字段。
- 让 agent 重复提交数据库中已经存在的事实。

### 2.3 工具不替代 Coordinator Surface

工具只执行动作。

当前是否允许工具出现，由 Coordinator Surface 决定。

### 2.4 每个工具必须记录事件

所有工具调用都必须写入 event：

- tool name。
- args summary。
- actor。
- started_at。
- completed_at。
- status。
- failure code。
- artifact refs。

### 2.5 副作用工具必须 operation 化

所有会创建或修改外部状态的工具必须遵守 [operations.md](./operations.md)：

- 先持久化 operation intent。
- 使用稳定 `idempotency_key`。
- inspect-before-create。
- 记录 `external_id`。
- 状态变更和关键 event 同 SQLite transaction。
- 失败后由 reconciliation 判断是否可恢复。

### 2.6 Agent tools 和 operator tools 分离

agent tools 只能出现在 Coordinator Surface。

operator tools 只能由 Web/CLI/operator 调用，不得进入 Coordinator Agent surface。

## 3. 工具分类

### 3.1 Planning Tools

#### write_execution_plan

用途：

- 记录或更新外层 execution plan。

参数：

```text
--artifact <path>
```

要求：

- artifact 必须是 Markdown。
- 程序解析最小元数据即可，完整计划正文保持 artifact。

#### revise_execution_plan

用途：

- 基于新事实更新计划。

参数：

```text
--artifact <path>
--reason <short-reason>
```

`reason` 应是短枚举或短文本，例如：

- `workflow-blocked`
- `review-feedback`
- `scope-change`
- `validation-failed`

### 3.2 Attempt / Workspace Tools

#### create_attempt

用途：

- 为 task 创建新的 attempt。

参数：

```text
--reason <reason>
```

常见 reason：

- `initial`
- `rework`
- `retry-from-clean-branch`
- `conflict-resolution`

#### create_workspace

用途：

- 为 attempt 创建 workspace 和 git worktree。

参数：

```text
--attempt <attempt-id>
```

不让 agent 传 repo path、branch name 等复杂信息。程序从 project registry 和 attempt state 推导。

副作用：

- 创建 workspace。
- 创建 git worktree。
- 创建 branch。
- 必须 inspect-before-create。

### 3.3 Workflow Tools

说明：

- workflow handoff 由 daemon / workflow adapter 根据 workflow protocol 记录。
- Coordinator Agent 不能调用 `complete_workflow_handoff` 或伪造 handoff。

#### start_workflow_run

用途：

- 在当前 workspace 中启动一个 `workflow` run。

参数：

```text
--profile <profile-id>
--provider <agent-provider-id>
```

说明：

- `profile-id` 来自 current surface 暴露的可用 profile，且必须来自 `workflow protocol capabilities` 声明的 implemented profiles。
- `provider` 可省略，由 project/task 默认值决定。
- provider 选择应基于 capability/tag，而不是品牌业务语义。

#### resume_workflow_run

用途：

- 继续已有 workflow run。

参数：

```text
--run <workflow-run-id>
```

#### inspect_workflow_run

用途：

- 查询 workflow run 状态。

参数：

```text
--run <workflow-run-id>
```

### 3.4 Human Interaction Tools

#### ask_human

用途：

- 创建 human request。

参数：

```text
--kind <kind>
--artifact <path>
```

kind 示例：

- `requirements-clarification`
- `scope-change`
- `technical-decision`
- `review-decision`
- `merge-approval`
- `blocked-access`

详细问题写入 artifact，例如：

```text
human-question.md
```

#### record_human_answer

用途：

- 记录人类回答并唤醒 daemon。

参数：

```text
--request <human-request-id>
--answer-artifact <path>
```

说明：

- 该工具是 operator-only，不能出现在 Coordinator Agent surface。

### 3.5 PR / MR Tools

#### create_pr

用途：

- 基于当前 workspace branch 创建 PR/MR。

参数：

```text
--title <short-title>
--body-artifact <path>
```

如果 title 为空，程序用模板兜底。

body 推荐由 agent 写：

```text
pr-body.md
```

#### update_pr

用途：

- 更新 PR/MR body 或 metadata。

参数：

```text
--pr <pr-id>
--body-artifact <path>
```

#### inspect_review

用途：

- 查询当前 review 状态。

参数：

```text
--pr <pr-id>
```

第一版如果未接平台 review，可返回 Web review 状态。

#### start_rework

用途：

- 根据 review feedback 进入 rework。

参数：

```text
--reason <reason>
--artifact <path>
```

feedback summary 写 artifact。

### 3.6 Merge Tools

#### request_merge_approval

用途：

- 请求人类批准 merge。

参数：

```text
--pr <pr-id>
--artifact <path>
```

artifact 应包含：

- summary。
- validation。
- risk。
- merge strategy。

#### merge_after_approval

用途：

- 在已有显式审批后执行 merge。

参数：

```text
--pr <pr-id>
```

约束：

- 没有 approval，不允许执行。
- approval 必须绑定 `pr_id + head_sha + base_sha + validation_run_id + merge_strategy`。
- PR/MR head/base/checks 或 validation 变化后 approval 失效。
- 默认 squash merge。
- merge 前必须同步默认分支并重新验证。
- 冲突时不能强行 merge，应进入 conflict-resolution。

### 3.7 Completion Tools

#### mark_done

用途：

- 标记 task 完成。

参数：

```text
--reason <reason>
```

常见 reason：

- `merged`
- `human-marked-done`
- `external-handoff-completed`

约束：

- 需要 PR/MR 的任务不能由 agent 单方面 `mark_done`。
- `merged` 必须来自 merge reconciliation。
- `human-marked-done` 必须来自 operator-only action。
- no-code task 必须有明确 policy 和 artifact evidence。

#### handoff_to_human

用途：

- 标记任务转人工接手。

参数：

```text
--artifact <path>
```

handoff detail 写入：

```text
handoff.md
```

#### cancel_task

用途：

- 取消任务。

参数：

```text
--reason <reason>
```

说明：

- 该工具是 operator-only，不能出现在 Coordinator Agent surface。

## 4. 工具可见性规则

完整矩阵见 [contracts.md](./contracts.md)。

`agent-tools.md` 只定义工具本身，不再维护另一份可见性矩阵。

## 5. Artifact 约定

建议路径：

```text
execution-plan.md
plan-revision.md
pr-body.md
review-summary.md
merge-approval.md
human-question.md
handoff.md
decisions.md
verification.md
remaining-work.md
validation-report.md
```

工具实现必须检查：

- path 是相对当前 workspace coordinator artifact root 的路径。
- 文件存在。
- 文件大小在合理范围内。
- 不允许引用源码目录或 workflow artifact 里的任意文件作为工具 payload。

## 6. Tool Call Event

每次工具调用记录：

```text
event.type = agent_tool_call
operation_id
tool.name
tool.args_summary
task_id
attempt_id
workspace_id
agent_session_id
status
failure_code
artifact_refs
started_at
completed_at
```

## 7. 失败语义

工具失败必须返回可恢复错误：

- `not_allowed_in_current_state`
- `missing_artifact`
- `invalid_artifact_path`
- `provider_unavailable`
- `workflow_protocol_failed`
- `human_approval_required`
- `merge_conflict`
- `workspace_missing`
- `agent_session_stalled`

失败后 Coordinator Surface 必须说明恢复路径。
