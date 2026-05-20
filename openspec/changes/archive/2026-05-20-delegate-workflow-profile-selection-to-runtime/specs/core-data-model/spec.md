## ADDED Requirements

### Requirement: 系统必须持久化 workflow selection 审计字段

系统 SHALL 持久化 workflow run 启动时的 requested selection source、requested profile 或 alias，以及 workflow runtime 返回的 actual profile。requested selection 用于审计和 operation idempotency，actual profile 用于显示和 protocol consistency 检查；系统不得把 `default` 或 `auto` 当作 actual profile。

#### Scenario: auto selection 持久化

- **WHEN** 系统以 runtime auto selection 启动 workflow run
- **THEN** workflow run 记录 requested selection source 为 runtime auto
- **AND** requested profile 为空或记录为 auto alias
- **AND** actual profile 来自 workflow protocol start 返回

#### Scenario: human explicit selection 持久化

- **WHEN** 系统以 human explicit selection 启动 workflow run
- **THEN** workflow run 记录 requested selection source 为 human explicit
- **AND** requested profile 为人类显式选择值
- **AND** actual profile 来自 workflow protocol start 返回

#### Scenario: default 不作为 actual profile

- **WHEN** workflow start 请求使用 default 或 auto alias
- **THEN** 系统不得把 default 或 auto 写为 actual profile
- **AND** actual profile 必须来自 workflow runtime 返回或保持 unknown/blocked
