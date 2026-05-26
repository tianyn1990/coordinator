# workflow-gate-evidence Specification

## Purpose
TBD - created by archiving change add-sdk-backed-gate-evidence. Update Purpose after archive.
## Requirements
### Requirement: 系统必须提供 SDK-backed workflow gate evidence

系统 SHALL 提供 operator-only workflow gate evidence 派生能力，用于在确认 operator-facing workflow action 前展示人类可读依据。gate evidence 的主要内容 MUST 来自 SDK-observed coding agent 可见输出，例如 inner agent final response、assistant message summary 或 provider-approved visible message；workflow protocol projection 只能作为 stage/substate/action/handoff 等结构化事实补充。

#### Scenario: inner agent final response 形成 ready evidence

- **WHEN** active workflow run 存在 operator-facing allowed action
- **AND** 同一 task/attempt 存在 completed 或 stopped inner agent session，且有 final response artifact
- **THEN** gate evidence 状态为 `ready`
- **AND** evidence 包含 primary message、agent session id、final response artifact ref 和 workflow protocol facts
- **AND** `canSubmit` 为 true

#### Scenario: 没有 inner agent 输出时缺少 evidence

- **WHEN** active workflow run 存在 operator-facing allowed action
- **AND** 同一 task/attempt 没有可用 inner agent visible output
- **THEN** gate evidence 状态为 `missing`
- **AND** `canSubmit` 为 false
- **AND** evidence warnings 说明不能盲确认 workflow gate

#### Scenario: workflow protocol 只作为状态事实

- **WHEN** workflow projection 包含 stage、substate、progress、allowedActions、actionInputHints 或 stageArtifacts
- **THEN** gate evidence 可以把这些字段作为 protocol facts 或 artifact refs 展示
- **AND** 系统不得把这些字段当作 coding agent 输出内容
- **AND** 系统不得读取 `.workflow` private state 或依赖 artifact 文件正文

#### Scenario: 旧 gate 的 final response 不得确认新 gate

- **WHEN** 同一 workflow run 已记录过 `workflow.action`
- **AND** inner agent final response 早于最近一次 `workflow.action`
- **AND** latest workflow status 出现新的 operator-facing action
- **THEN** gate evidence 不得把旧 final response 作为 ready evidence
- **AND** `canSubmit` 为 false，直到最近 action 之后出现新的 inner agent visible output

### Requirement: Operator workflow action 必须校验 gate evidence

系统 SHALL 在 operator-only workflow action helper 执行 operator-facing workflow action 前重新校验 gate evidence。只有 action 仍被 latest workflow status 允许、action classification 为 operator-facing 且 evidence `canSubmit = true` 时，helper 才能调用 `workflow protocol action`。

#### Scenario: evidence ready 后允许提交

- **WHEN** operator 提交 `freeze-requirements`
- **AND** latest workflow status 仍允许该 action
- **AND** gate evidence 为 `ready` 且 `canSubmit = true`
- **THEN** Core 可以调用 workflow protocol action
- **AND** 系统记录 workflow action 审计 event

#### Scenario: evidence missing 时拒绝提交

- **WHEN** operator 提交 `freeze-requirements`
- **AND** latest workflow status 允许该 action
- **AND** gate evidence 为 `missing`
- **THEN** Core 拒绝提交
- **AND** 系统不得调用 workflow protocol action
- **AND** 返回错误说明缺少 coding agent 可见确认依据

### Requirement: Web 必须展示 gate evidence 并阻止盲确认

系统 SHALL 在 Workflow Action Panel 中展示 Core/API 返回的 gate evidence。Web MUST NOT 只因为 workflow observation 为 waiting operator gate 就启用确认按钮；Web MUST 在 evidence 缺失时展示 warning，并禁用对应 operator workflow action。

#### Scenario: ready evidence 展示确认内容

- **WHEN** Web focus 的 task 存在 workflow operator gate
- **AND** gate evidence 为 `ready`
- **THEN** Workflow Action Panel 展示 primary message、protocol facts 和 supporting artifact refs
- **AND** 确认按钮可用

#### Scenario: missing evidence 禁用确认按钮

- **WHEN** Web focus 的 task 存在 workflow operator gate
- **AND** gate evidence 为 `missing`
- **THEN** Workflow Action Panel 展示缺少确认依据的 warning
- **AND** 确认按钮禁用
- **AND** Web 不调用 workflow action endpoint

### Requirement: Gate evidence 不得扩大 Agent Surface 或 daemon 自动路径

系统 SHALL 保持 gate evidence 为 operator-only projection。gate evidence 不得进入 Coordinator Agent Surface available tools，不得让 daemon 自动执行 workflow action，不得把 raw provider events、完整 transcript 或 hidden reasoning 暴露给 outer Agent。

#### Scenario: Surface 不暴露 gate evidence endpoint

- **WHEN** 系统生成 Coordinator Surface
- **THEN** available tools 不包含 gate evidence API、workflow action endpoint 或 Web route
- **AND** surface 不内联 raw provider events 或完整 transcript

#### Scenario: daemon 不消费 gate evidence 自动确认

- **WHEN** daemon tick 观察到 workflow operator gate 且 evidence ready
- **THEN** daemon 仍不得自动调用 workflow action
- **AND** gate 仍进入 operator-only Web/API 确认路径

### Requirement: inner runtime 产出的 final response 必须成为 gate evidence 主来源

系统 SHALL 将本轮 inner coding agent runtime 产出的 completed/stopped `role=inner` session final response 作为 workflow gate evidence 的主消息来源。该 session MUST 通过 append-only lifecycle event 绑定当前 workflow run，且 provider 空 final response 占位文本 MUST NOT 形成 evidence。workflow protocol projection 仍只能作为 stage/substate/action/handoff 等结构化事实补充。

#### Scenario: daemon 运行 inner session 后 evidence ready

- **WHEN** workflow run 存在 operator-facing allowed action
- **AND** daemon 已成功运行同一 task/attempt 的 inner coding agent session
- **AND** inner session 写入非空 final response artifact
- **AND** inner session completed/stopped event 绑定同一 workflow run
- **THEN** gate evidence 状态为 `ready`
- **AND** `canSubmit` 为 true
- **AND** evidence 包含 inner agent session id 和 final response artifact ref

#### Scenario: 空 provider 输出不能提交

- **WHEN** inner provider 返回空 final response
- **AND** Core 只保存了空输出占位文本
- **THEN** gate evidence 状态为 `missing`
- **AND** `canSubmit` 为 false

#### Scenario: inner final response 不替代 protocol status

- **WHEN** inner final response 文本提到完成、PR ready 或可以 merge
- **THEN** Core 不仅凭该文本更新 workflow run coarse status、task completed、PR readiness 或 merge readiness
- **AND** 这些状态仍必须来自 workflow protocol handoff、PR/MR provider 或 human approval gate

### Requirement: gate evidence 必须按 workflow action boundary 失效

系统 SHALL 继续使用最近 `workflow.action` event 作为 evidence boundary。最近 action 之前的 inner final response MUST NOT 用来确认之后的新 gate。该 boundary MUST 使用 append-only event id 的严格顺序，而不是秒级 timestamp 比较。

#### Scenario: workflow action 后需要新 inner evidence

- **WHEN** workflow run 已执行一次 operator workflow action
- **AND** latest status 又出现新的 operator-facing gate
- **THEN** action 之前的 inner final response 不产生 ready evidence
- **AND** Web/API confirm 仍被 Core evidence gate 拒绝

#### Scenario: 其他 workflow run 的输出不污染当前 gate

- **WHEN** 同一 task/attempt 存在 inner agent final response
- **AND** 该 session lifecycle event 未绑定当前 workflow run
- **THEN** 该 final response 不产生 ready evidence
- **AND** Web/API confirm 仍被 Core evidence gate 拒绝

