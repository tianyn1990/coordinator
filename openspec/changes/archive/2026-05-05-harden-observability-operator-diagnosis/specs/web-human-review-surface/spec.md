## MODIFIED Requirements

### Requirement: Web task detail 必须展示当前 blocker 与 Surface snapshot

系统 SHALL 在 task detail 中展示由 Core 生成的 current blocker、Coordinator Surface JSON/Markdown 摘要和当前可见 agent tools；Web 不得自行拼接 agent guidance。Web task detail SHALL 同时展示 Core 提供的 operator-only diagnosis summary，帮助 operator 理解恢复状态和排查下一步。

#### Scenario: 查看 task detail

- **WHEN** operator 打开某个 task detail
- **THEN** Web 展示当前 task/project/attempt/workspace/workflow/PR/human request 摘要
- **AND** Web 展示来自 Core 的 surface kind、recommended next step、denied actions 和 available tools
- **AND** Web 展示 diagnosis 中的 current blocker、operator attention、retry budget 和最近 recovery decision 摘要

#### Scenario: Surface 生成失败

- **WHEN** Core 无法为 task 生成 surface
- **THEN** Web 显示受控错误
- **AND** 不显示任何伪造的可执行下一步

### Requirement: Web 必须展示 event timeline 与 tool trace

系统 SHALL 在 task detail 中展示 append-only event timeline，并对 agent tool、daemon、workflow、human、PR/MR 和 merge 事件提供可读摘要。Web SHALL 额外展示 operation ledger、recovery decision timeline 与 provider/protocol inspect 摘要，但不得直接展示完整 event payload 或完整 operation JSON。

#### Scenario: 查看 event timeline

- **WHEN** task 存在事件
- **THEN** Web 按时间顺序展示事件类型、摘要、severity、operation id 和 artifact refs

#### Scenario: 查看 tool trace

- **WHEN** timeline 中存在 `agent_tool_call` 事件
- **THEN** Web 展示 tool name、status、failure code 或 result summary

#### Scenario: 查看 recovery diagnosis

- **WHEN** timeline 中存在 `daemon.recovery_decision`、retry、provider inspect 或 protocol inspect 事件
- **THEN** Web 展示 Core 生成的 diagnosis 摘要
- **AND** Web 不渲染 provider raw output、lock token、完整 operation JSON 或完整 recovery matrix
