## ADDED Requirements

### Requirement: Coordinator Surface 不得暴露 raw provider events

系统 SHALL 保持 agent-facing Coordinator Surface 对 provider observability 的可见性收窄。Surface MAY 展示 recent agent session 的 provider、status、artifact refs 和短 activity 摘要；MUST NOT 内联 raw provider events、完整 transcript、provider private session path、permission internals 或 SDK-specific event object。

#### Scenario: 生成包含 agent session 的 surface

- **WHEN** task 存在 agent session activity summary
- **THEN** JSON surface 和 Markdown surface 最多展示 session status、provider id、last activity、latest normalized summary 和 artifact refs
- **AND** surface 不包含 raw JSONL、完整 stdout/stderr、provider private session path 或 permission object

#### Scenario: normalized event 不扩大 tool visibility

- **WHEN** surface 生成时存在 latest normalized agent event
- **THEN** available tools 仍只由 Core 当前状态和 contracts tool visibility matrix 决定
- **AND** surface 不因为 provider event 出现新增 debug、recovery、workflow action 或 Web operator tool

