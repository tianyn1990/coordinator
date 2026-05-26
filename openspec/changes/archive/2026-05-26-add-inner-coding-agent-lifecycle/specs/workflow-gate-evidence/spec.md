## ADDED Requirements

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
