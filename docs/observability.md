# Observability

> 状态：初始方案基线  
> 适用范围：事件记录、日志、artifact、UI 调试视图、审计、恢复与排查。

## 1. 文档定位

无人值守系统如果没有可观测性，会很快变成无法排查的黑盒。

`coordinator` 第一版必须把 observability 作为核心能力，而不是后补 dashboard。

## 2. 目标

Observability 需要回答：

- 当前任务卡在哪。
- 等谁。
- 上一次动作是什么。
- 哪个 agent 做了什么决定。
- 哪个 tool 被调用。
- workflow 到了哪个 stage/gate。
- PR/MR 状态是什么。
- 为什么重试。
- 为什么请求人类确认。
- 为什么 merge 被阻止。

第一版最小可观测性只要求：

- event timeline。
- current blocker。
- surface snapshot。
- tool trace。
- workspace / workflow / PR 关键状态。

## 3. 事件层级

### 3.1 Coordinator Event

记录外层状态变化：

- task created。
- attempt created。
- execution plan written。
- workspace created。
- tool called。
- human request created。
- human answer received。
- PR/MR created。
- review received。
- merge approved。
- merge attempted。
- task completed。

Coordinator Event 必须记录状态迁移、operation_id 和 transition_id。

### 3.2 Agent Event

记录 agent session：

- session started。
- session stopped。
- session stalled。
- provider error。
- prompt artifact。
- surface snapshot。
- tool request。
- final response。

Agent Event 必须记录 surface snapshot 引用、tool call 引用和 lock token（如有）。

### 3.3 Workflow Event

记录 inner workflow：

- workflow run started。
- workflow status inspected。
- stage changed。
- gate changed。
- workflow blocked。
- workflow handoff。
- workflow completed。

Workflow Event 可以来自 `workflow protocol events`，但 coordinator 只依赖 protocol 声明字段。

workflow protocol 返回的 handoff、allowedActions、deniedActions、recovery 必须被记录或引用，不应只保留模糊摘要。

### 3.4 Git / PR Event

记录：

- worktree created。
- branch pushed。
- PR/MR created。
- review status changed。
- checks failed。
- merge conflict。
- squash merged。

merge event 必须记录 approval snapshot 引用、head/base SHA 和 validation run id。

## 4. Event Store

第一版使用 SQLite。

`events` 应 append-only。

建议字段：

```text
id
tick_id
operation_id
transition_id
lock_token
external_request_id
project_id
task_id
attempt_id
workspace_id
agent_session_id
workflow_run_id
pr_id
human_request_id
type
summary
payload_json
artifact_refs
severity
created_at
```

payload 可以是 JSON，但不作为 agent 主输入。给 agent 看时应通过 Coordinator Surface 摘要。

关键状态变更的 before/after 不应默认塞完整快照进每条 event；更推荐 changed fields diff 或 snapshot artifact ref。

## 5. Artifact

artifact 用于保存非结构化或半结构化信息。

常见 artifact：

- Coordinator Surface snapshot。
- execution plan。
- plan revision。
- PR/MR body。
- review summary。
- merge readiness。
- validation contract。
- validation report。
- human question。
- human answer。
- handoff。
- decisions。
- verification。
- remaining work。
- agent prompt。
- agent final response。

artifact 应记录：

- path。
- kind。
- owner。
- created at。
- linked event。

## 6. Surface Snapshot

每次唤醒 Coordinator Agent，都应保存 surface snapshot。

原因：

- 事后能解释 agent 当时看到了什么。
- 能判断 agent 是否基于错误信息行动。
- 能复盘 surface 是否缺信息。

路径示例：

```text
coordinator/sessions/<session-id>/surface.json
coordinator/sessions/<session-id>/surface.md
```

建议同时保存：

- JSON machine snapshot。
- Markdown agent-facing surface。

当前 Agent Provider Runtime 已落地以下 session artifact：

```text
coordinator/sessions/<session-id>/prompt.md
coordinator/sessions/<session-id>/surface.json
coordinator/sessions/<session-id>/surface.md
coordinator/sessions/<session-id>/transcript.jsonl
coordinator/sessions/<session-id>/final-response.md
```

这些 artifact 是可观测性证据，不是 hidden memory。后续是否进入 agent 可见世界，仍必须由 Coordinator Surface 显式暴露。

## 7. Tool Trace

每个 tool call 记录：

- tool name。
- args summary。
- started。
- completed。
- status。
- error。
- side effect。
- output artifact。

对于失败工具，保留短 preview。

对于成功工具，默认不保存大量 stdout/stderr，只保存摘要和 artifact ref。

## 8. Log 策略

默认：

- SQLite 保存事件。
- workspace 中保存必要 artifact。
- agent transcript 可保存为 JSONL。

不建议：

- 无限制复制 stdout/stderr。
- 把敏感 token 写入事件。
- 在 UI 默认展示长日志。

需要：

- output preview limit。
- secret redaction。
- artifact size limit。

## 9. UI 视图

Web UI 第一版至少有：

### 9.1 Task Timeline

按时间展示所有关键事件。

### 9.2 Current Blocker

明确显示：

- waiting agent。
- waiting workflow。
- waiting human。
- waiting review。
- waiting merge approval。
- failed。

### 9.3 Plan View

展示 execution plan 和 step 状态。

### 9.4 Workspace View

展示：

- workspace path。
- branch。
- base branch。
- dirty status。
- linked workflow runs。

### 9.5 Agent Session View

展示：

- provider。
- started at。
- last event。
- prompt artifact。
- surface snapshot。
- tool calls。
- handoff/checkpoint artifact。

### 9.6 Workflow View

展示：

- run id。
- profile。
- stage/substate/gate。
- handoff。
- artifact。

### 9.7 Human Request View

展示问题，允许回答。

### 9.8 PR/MR View

展示 PR/MR 状态、review、merge approval。

### 9.9 Thin Slice Views

P0 只要保证以下视图可用：

- task timeline。
- current blocker。
- surface snapshot。
- tool trace。

其他视图可以在 P1 逐步补齐，但不能阻塞第一条闭环。

当前已落地的 Web operator console 覆盖：

- task list 和 manual task 创建。
- task detail current blocker。
- Coordinator Surface snapshot 的 JSON/Markdown 摘要。
- available tools 和 denied actions 展示。
- execution plan、workspace、workflow run、agent session、PR/MR、human request 摘要。
- append-only event timeline。
- `agent_tool_call` tool trace，包括 tool name、status、failure code 和 result summary。
- human request answer 表单，回答由 Core 写入 artifact 并记录 `human.answer_received` event。
- merge approval / reject / merge 操作入口，approval snapshot 和 merge 结果仍以 Core/PR Provider Runtime 为准。
- daemon tick 调试按钮，用于本地没有长运行 daemon 时推进单次 tick。

这些视图是 operator 可观测面，不是 Coordinator Agent 的 hidden memory。是否让 agent 看到某个事实，仍必须通过 Coordinator Surface 显式暴露。

## 10. Reconciliation 可观测性

每次 reconciliation 应记录：

- inspected target。
- expected state。
- observed state。
- action taken。
- no-op reason。

这对无人值守系统非常重要。

## 11. Retry 可观测性

每次 retry 应记录：

- retry kind。
- attempt number。
- backoff。
- cause。
- selected recovery。
- next due time。

## 12. Human Request 可观测性

记录：

- 为什么问人。
- 问了什么。
- 等待多久。
- 人如何回答。
- agent 如何消化回答。

## 13. Merge 可观测性

merge 是高风险动作。

必须记录：

- approval id。
- approved by。
- approval snapshot。
- head/base SHA。
- validation run id。
- validation before merge。
- base branch sync。
- merge strategy。
- merge result。
- conflict if any。

## 14. 与 Symphony 的对应

吸收 Symphony 的 observability 思想：

- operator-visible structured logs。
- issue/session context fields。
- worker/session lifecycle。
- retry state。
- token/runtime telemetry，如果 provider 支持。

但本项目还需要额外记录：

- Coordinator Surface。
- execution plan。
- human request。
- workflow protocol state。
- PR/MR lifecycle。
- checkpoint / resume artifacts。

## 15. 第一版完成标准

- 所有核心状态变化写 event。
- Web 可展示 task timeline。
- Web 可展示当前 blocker。
- 每次 Coordinator Agent 唤醒保存 surface snapshot。
- 每次 tool call 有 trace。
- workflow protocol status 被记录。
- human request 有完整审计。
- merge approval 和 merge 结果可追溯。
- state diff / snapshot artifact 可回放。
