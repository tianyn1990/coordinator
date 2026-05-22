## ADDED Requirements

### Requirement: Web 必须提供 Project Admin 视图

系统 SHALL 提供 Web Project Admin 视图，用于查看 project registry、注册新 project，并展示工程级配置状态。

#### Scenario: 查看 project registry

- **WHEN** operator 打开 Project Admin
- **THEN** Web 调用既有 `/projects` API
- **AND** 页面展示每个 project 的 name、default branch、registration status、repo/workspace/provider/workflow/agent 配置摘要
- **AND** Web 不直接读取 SQLite

#### Scenario: 注册 project

- **WHEN** operator 在 Project Admin 中提交 repo path、confirmed default branch、provider override、workflow launcher、agent defaults 或 workspace root
- **THEN** Web 调用既有 `/projects/register` API
- **AND** Core project registry runtime 负责 provider detection、default branch confirmation 和持久化
- **AND** 注册失败时 Web 展示 Core/API 返回的错误

### Requirement: Project Admin 必须展示 workspace hook 预留边界

系统 SHALL 在 Project Admin 中展示 workspace init/cleanup hook 与 retention policy 的预留区域，但不得执行任意脚本副作用。

#### Scenario: 查看 hook 预留

- **WHEN** operator 查看 Project Admin workspace policy 区域
- **THEN** Web 展示 init script hook、cleanup script hook 和 retention policy 为 planned/disabled 状态
- **AND** 页面说明当前不会执行这些脚本
- **AND** 系统不因为填写或查看这些字段而触发 workspace 副作用
