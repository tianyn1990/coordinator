## ADDED Requirements

### Requirement: Observability 必须展示 gate evidence 的窄摘要

系统 SHALL 允许 operator-only task detail 或 Web Focus Drawer 展示 workflow gate evidence 的窄摘要，包括 evidence status、primary message excerpt、agent session id、final response artifact ref、workflow protocol facts 和 warnings。该摘要不得成为新的 truth source，也不得自动进入 Coordinator Agent Surface。

#### Scenario: gate evidence 展示引用而非 raw transcript

- **WHEN** Core 返回 workflow gate evidence
- **THEN** evidence 可以包含 final response artifact ref、agent session id 和 primary message excerpt
- **AND** evidence 不包含完整 provider raw events、完整 transcript、secret、permission internals 或 lock token

#### Scenario: missing evidence 可观测

- **WHEN** workflow operator gate 缺少 inner agent visible output
- **THEN** Web/operator summary 展示 missing evidence warning
- **AND** 该 warning 不改变 workflow run coarse status、task completed、PR readiness 或 merge readiness
