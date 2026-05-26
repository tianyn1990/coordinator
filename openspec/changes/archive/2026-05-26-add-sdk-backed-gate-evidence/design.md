## Context

当前实现已经具备三块基础能力：

- Workflow Protocol Adapter 能保存 workflow status/action 的 display projection，包括 lifecycle、stage、substate、allowedActions、actionInputHints、progress、stageArtifacts 和 handoff。
- AgentProvider Runtime 已接入 SDK-first adapter：Codex SDK 可通过 `runStreamed()` 获取结构化 `ThreadEvent`、`agent_message`、`finalResponse`；Claude Agent SDK 可通过 `query()` async generator 获取 assistant/result/partial message，并能保存 raw transcript 与 normalized agent activity。
- Web V2 已有 Workflow Action Panel，但目前只基于 operator-facing action classification 展示确认按钮，缺少确认前 evidence。

关键边界：

- 本期不修改 `/Users/hetao/Documents/github/workflow`，不要求 workflow protocol 新增字段。
- workflow protocol 继续只负责结构化状态，不负责提供 coding agent 对话内容。
- SDK raw events 不进入 Core 状态机；只有 user-visible / provider-approved message summary 和 final response artifact 可以进入 operator evidence。
- daemon/outer Agent 不能自动确认 human gate，也不能自动执行所有 workflow action。

## Goals / Non-Goals

**Goals:**

- 在 Coordinator Core 中提供 operator-only gate evidence 派生结果。
- Web 在 operator workflow gate 旁展示 coding agent 可见说明和 protocol facts。
- operator-facing workflow action 在 evidence 缺失时不能由 Web/API 盲确认。
- 复用现有 agent session、event、artifact、workflow projection，不引入新 workflow protocol。

**Non-Goals:**

- 不实现完整 inner coding agent lifecycle runner。
- 不修改 workflow project 或 workflow protocol schema。
- 不展示 hidden chain-of-thought、完整 raw JSONL、完整 transcript、permission internals 或 provider private state。
- 不让 daemon/outer Agent 自动执行 workflow action 或 human gate。
- 不把 artifact 文件存在性作为 workflow stage completion 或 PR readiness 真源。

## Decisions

### 1. SDK 输出是 evidence 主来源，workflow protocol 是状态事实来源

Core 的 gate evidence 由两类输入合成：

- Primary evidence: 与当前 task/attempt 相关的 `agent_sessions.role = inner` 的 visible final response / assistant message summary。
- Protocol facts: workflow run 的 latest status/action projection，如 stage、substate、progress、allowed operator action、handoff、stage artifact refs。

如果没有 inner agent visible output，evidence 状态为 `missing`，即使 workflow projection 包含 `freeze-requirements`，Web/API 也不能默认允许确认。

同一 workflow run 内可能经历多个 operator gate。为避免上一轮 gate 的 final response 误确认下一轮 gate，Core 以最近一次 `workflow.action` event 作为分界；只有分界之后产生或更新的 inner agent visible output 才能成为当前 gate 的 ready evidence。

备选方案“读取 workflow artifact 内容”被拒绝，因为 workflow prompt 不保证生成 `.workflow/runs/**/artifacts/*.md`，且 Coordinator 不应读取 `.workflow` private state 或把 artifact 存在性当作确认内容。

### 2. 本轮只做 evidence gate，不补完整 inner runner

当前代码已经有 `agent_sessions.role` 和 `attempt_id` 字段，足以表达“某个 inner coding agent session 的输出可作为当前 workflow run evidence”。本轮先基于这些已存在数据派生 evidence，不新增复杂 worker/state machine。

后续实现 inner runner 时，只需要确保它通过 SDK-first AgentProvider 写入 `role = inner`、`attempt_id`、final response artifact 和 normalized activity，gate evidence 就能自然消费。

### 3. Core action helper 强制校验 evidence

只在 operator-only helper `invokeWorkflowActionFromOperator` 上强制：

- action 必须仍是 operator-facing。
- latest workflow status 必须允许该 action。
- gate evidence 必须 `ready` 且 `canSubmit = true`。

低层 CLI/debug `invokeWorkflowAction` 继续保留为显式 operator/debug 入口，不进入 Web Action Panel、daemon 自动路径或 Coordinator Agent Surface。

### 4. Web 展示 evidence packet，而不是自行读取 artifact

API 新增 `GET /workflow-runs/:id/gate-evidence`，返回窄 projection：

- gate action、stage/substate/progress。
- evidenceStatus: `ready | partial | missing`。
- canSubmit。
- primaryMessage 和 recentMessages 的短文本。
- protocolFacts 与 supportingArtifactRefs。
- warnings。

Web 只渲染这个 packet；不直接读取 final-response artifact 文件或 raw transcript。

## Risks / Trade-offs

- [Risk] 当前尚未有 inner agent session，因此真实 smoke 到 `freeze-requirements` 后会显示 missing evidence，无法继续盲确认。  
  Mitigation: 这是有意收紧；后续切片补 inner SDK runner 后再允许 ready gate。

- [Risk] 使用 final response 作为 evidence 可能过长或包含 debug 噪音。  
  Mitigation: Core 截断并只展示短摘要；完整内容只作为 artifact ref/debug 入口。

- [Risk] 把 outer Coordinator Agent 输出误当 inner coding agent evidence。  
  Mitigation: 默认只把 `role = inner` 作为 ready evidence；outer 输出最多作为 debug/partial warning，不允许确认。

- [Risk] API/Web 双层校验不一致。  
  Mitigation: Web 只负责显示，提交仍由 Core `invokeWorkflowActionFromOperator` 重新校验 latest status 和 evidence。
