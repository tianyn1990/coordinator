# project-registry Specification

## Purpose
定义 `coordinator` 第一版的工程注册与工程级机器真相，包括 repo path、provider 识别、默认分支确认、workflow launcher 和默认 provider 配置。该规格只覆盖 Iteration 3，不包含 Coordinator Surface、daemon、workspace manager 或 workflow adapter。
## Requirements
### Requirement: 系统必须支持工程注册

系统 SHALL 允许用户注册一个工程，并保存该工程的机器真相。

#### Scenario: 注册本地工程

- **WHEN** 用户提供一个本地 repo path 并确认注册
- **THEN** 系统保存 project 记录和注册结果

### Requirement: 系统必须识别 GitHub/GitLab

系统 SHALL 基于 repo remote URL 识别 GitHub 或 GitLab；无法自动判断时必须要求用户显式选择。

#### Scenario: 自动识别 GitHub

- **WHEN** repo remote URL 包含 `github.com`
- **THEN** 系统将 git provider kind 识别为 GitHub

#### Scenario: 自动识别 GitLab

- **WHEN** repo remote URL 包含 `gitlab.com` 或配置的 GitLab host
- **THEN** 系统将 git provider kind 识别为 GitLab

#### Scenario: 无法识别 provider

- **WHEN** repo remote URL 无法自动识别
- **THEN** 系统要求用户显式选择 provider kind

### Requirement: 默认分支必须显式确认

系统 SHALL 检测 remote HEAD 并要求用户对默认分支显式确认；不得静默回退到预设分支。

#### Scenario: 检测到 remote HEAD

- **WHEN** 系统成功读取 remote HEAD
- **THEN** 系统向用户展示检测值并要求确认或改写

#### Scenario: 无法检测 remote HEAD

- **WHEN** 系统无法读取 remote HEAD
- **THEN** 系统阻塞注册，直到用户显式输入默认分支

### Requirement: 系统必须保存 workflow launcher

系统 SHALL 保存每个 project 的 workflow launcher 配置，并允许后续执行层按 project config 调用。

#### Scenario: 保存 launcher

- **WHEN** 用户为工程配置 workflow launcher
- **THEN** 系统将 launcher 记录为 project 机器真相

### Requirement: 系统必须保存默认 agent/provider 配置

系统 SHALL 保存 outer agent 和 inner agent 的默认 provider 配置，并允许任务级覆盖。

#### Scenario: 配置默认 provider

- **WHEN** 用户为工程设置默认 agent/provider
- **THEN** 系统将该配置保存到 project registry

### Requirement: 系统必须提供工程注册视图

系统 SHALL 提供 CLI/API 的最小 project registry 视图，用于查看工程注册状态、默认分支、provider、launcher 和缺失能力。

#### Scenario: 查看 project 状态

- **WHEN** 用户查看已注册 project
- **THEN** 系统显示工程是否已可用于后续 workflow、PR/MR 或 provider 动作

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

