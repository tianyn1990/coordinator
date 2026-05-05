## MODIFIED Requirements

### Requirement: 系统必须提供 Web 所需 task 查询能力

系统 SHALL 提供 repository/Core 查询能力，用于 Web 获取 task list 与 task detail operator summary；该 summary 只能反映已持久化机器事实，不得创建新的状态迁移规则。task detail operator summary SHALL 包含 operator-only diagnosis summary，用于展示 current blocker、recovery decision timeline、retry budget、operation ledger 摘要和 provider/protocol inspect 摘要。

#### Scenario: 查询 task list

- **WHEN** Web/API 查询 task list
- **THEN** 系统返回 task、project 名称、状态、autonomy 和 source kind
- **AND** 查询不会修改任何核心实体状态

#### Scenario: 查询 task detail summary

- **WHEN** Web/API 查询 task detail
- **THEN** 系统返回 task、project、latest attempt、active workspace、active workflow run、latest PR/MR、open human requests、recent agent sessions 和 recent events 的 operator summary
- **AND** summary 中的 agent-facing guidance 仍来自 Core Surface builder
- **AND** operator-only diagnosis summary 只由已持久化 event、operation 和实体状态派生

#### Scenario: 查询 task diagnosis summary

- **WHEN** task 存在 recovery decision、retry、operation 或 provider/protocol inspect 事件
- **THEN** task detail diagnosis 展示对应窄摘要
- **AND** diagnosis 不修改 task、operation、event、workflow run、PR/MR 或 human request
- **AND** diagnosis 不包含 provider raw output、secret、lock token、完整 operation JSON 或完整 recovery matrix
