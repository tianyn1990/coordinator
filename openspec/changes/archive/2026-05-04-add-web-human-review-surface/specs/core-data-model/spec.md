## ADDED Requirements

### Requirement: 系统必须提供 Web 所需 task 查询能力

系统 SHALL 提供 repository/Core 查询能力，用于 Web 获取 task list 与 task detail operator summary；该 summary 只能反映已持久化机器事实，不得创建新的状态迁移规则。

#### Scenario: 查询 task list

- **WHEN** Web/API 查询 task list
- **THEN** 系统返回 task、project 名称、状态、autonomy 和 source kind
- **AND** 查询不会修改任何核心实体状态

#### Scenario: 查询 task detail summary

- **WHEN** Web/API 查询 task detail
- **THEN** 系统返回 task、project、latest attempt、active workspace、active workflow run、latest PR/MR、open human requests、recent agent sessions 和 recent events 的 operator summary
- **AND** summary 中的 agent-facing guidance 仍来自 Core Surface builder

### Requirement: 系统必须支持 operator 记录 human answer

系统 SHALL 提供 Core service 将 operator answer 写为 artifact，并以 CAS 校验更新 HumanRequest 状态为 `answered`。

#### Scenario: 记录 human answer

- **WHEN** operator 提交 human request id、expected state version、answer 正文和 answered by
- **THEN** 系统写入 human answer artifact
- **AND** 系统更新 HumanRequest 为 `answered`
- **AND** 系统写入 `human.answer_received` event

#### Scenario: human request 不存在

- **WHEN** operator 提交不存在的 human request id
- **THEN** 系统返回受控 not found 错误
- **AND** 不创建 answer artifact

#### Scenario: human request 已不是 waiting

- **WHEN** operator 对非 waiting/pending human request 提交 answer
- **THEN** 系统拒绝更新
- **AND** 不改变 task lifecycle

### Requirement: Web operator 查询不得改变 append-only event 语义

系统 SHALL 复用既有 append-only event store 支撑 Web timeline，不得为展示目的更新或删除历史 event。

#### Scenario: Web 查询 timeline

- **WHEN** Web/API 查询 task timeline
- **THEN** 系统按 event store 追加顺序返回事件
- **AND** 不修改事件内容
