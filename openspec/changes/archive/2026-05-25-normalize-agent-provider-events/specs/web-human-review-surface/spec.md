## ADDED Requirements

### Requirement: Task Cockpit 必须展示 agent activity 摘要

系统 SHALL 在 Task Cockpit 或 operator task detail 中展示 recent agent sessions 的 activity 摘要，用于说明 outer Coordinator Agent 是否运行、何时有活动、最后的 normalized event 和 final response artifact。Web MUST NOT 默认展示完整 provider transcript 或 raw provider events。

#### Scenario: 展示 completed agent session activity

- **WHEN** task detail 包含 completed agent session 的 activity 摘要
- **THEN** Task Cockpit 展示 provider、session status、implementation mode、permission profile、last activity、latest normalized event 和 final response artifact
- **AND** Web 只把 provider events / transcript 作为 artifact ref 展示

#### Scenario: 展示 failed agent session activity

- **WHEN** task detail 包含 failed agent session 的 failure signal
- **THEN** Task Cockpit 展示 failure kind、last activity、latest normalized event 和 artifact refs
- **AND** Web 不展示 provider raw output、secret、permission internals 或完整 JSONL

#### Scenario: agent activity 不进入 Action Inbox

- **WHEN** latest normalized event 表示 tool、message、permission 或 turn activity
- **THEN** Web 不把该事件单独转换为 needs-me action card
- **AND** Action Inbox 仍只聚合 human request、merge approval、operator attention、PR/MR 等待和明确 operator-facing gate

