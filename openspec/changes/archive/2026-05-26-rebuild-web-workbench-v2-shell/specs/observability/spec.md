## ADDED Requirements

### Requirement: Web V2 默认视图必须将调试信息收敛到 Debug Detail

系统 SHALL 在 Web V2 默认主视图中只展示 operator 决策所需的摘要，并将 raw surface、完整 event payload、operation ledger、provider raw events、workflow debug payload 和复杂 JSON 收敛到 Debug Detail Drawer 或 artifact/ref 入口。

#### Scenario: 默认 Run Matrix 不展示 raw payload

- **WHEN** operator 浏览 Run Matrix
- **THEN** 页面只展示 task、workflow、agent、PR/MR、human request 和 observation 的摘要
- **AND** 页面不默认展示完整 raw surface、完整 transcript、provider raw event JSONL、lock token 或完整 operation JSON

#### Scenario: Focus Drawer 展示摘要而非完整调试对象

- **WHEN** operator focus 某个 task
- **THEN** Focus Drawer 展示 current blocker、workflow summary、agent activity summary、recent evidence 和 gate 摘要
- **AND** 完整 timeline、operation ledger、provider/protocol detail 只通过 Debug Detail 或 artifact refs 按需查看

#### Scenario: Debug Detail 不成为真相源

- **WHEN** operator 打开 Debug Detail
- **THEN** Web 只展示从 Core/API 持久化事实派生的 operator-only 诊断信息
- **AND** Debug Detail 不写回 workflow private state，不改变 Core task 状态，也不扩大 Coordinator Agent Surface
