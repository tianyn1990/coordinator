# pr-mr-provider Specification

## Purpose

定义 `coordinator` 第一版 PR/MR provider 契约：系统必须通过可替换 provider adapter 执行 GitHub/GitLab PR/MR 副作用，同时由 Coordinator Core 统一负责 workflow handoff gate、operation/idempotency、merge approval snapshot、merge policy 和状态迁移。

## Requirements

### Requirement: 系统必须提供 PR/MR provider 抽象

系统 SHALL 提供 PR/MR provider 抽象，允许通过 GitHub 或 GitLab provider 路径创建、更新、检查和合并 PR/MR。

#### Scenario: provider 可替换

- **WHEN** project registry 指定不同的 `prProviderKind`
- **THEN** 系统使用对应 provider 执行 PR/MR 副作用
- **AND** Core 仍保留状态机和幂等校验

### Requirement: 系统必须支持一个真实 CLI provider 路径和一个 fake provider contract

系统 SHALL 在第一版提供一个真实 CLI provider 路径，并提供一个 fake provider 作为 contract stub。

#### Scenario: 真实 provider 通过 CLI 执行

- **WHEN** provider kind 为 GitHub 或 GitLab 且配置了 CLI runner
- **THEN** 系统通过窄命令调用对应 CLI 执行 PR/MR 副作用

#### Scenario: fake provider 用于测试

- **WHEN** 系统在测试或无外部认证场景运行
- **THEN** 系统可以使用 fake provider 模拟 PR/MR 行为

### Requirement: 系统必须能创建 PR/MR

系统 SHALL 在 workflow handoff 为 `pr_ready` 且 workspace/branch/base 信息完整时创建 PR/MR，并保存 PR/MR machine truth。

#### Scenario: 创建 PR

- **WHEN** 当前 task 对应 workflow run handoff 为 `pr_ready`
- **AND** 当前 workspace ready
- **AND** project 已配置 PR provider
- **THEN** 系统创建 PR/MR record
- **AND** 记录 external id、url、head/base branch 和 status

#### Scenario: create 前 inspect 失败

- **WHEN** provider inspect existing PR/MR 失败或输出不可解析
- **THEN** 系统不得继续 create PR/MR
- **AND** operation 进入受控失败或未知状态

#### Scenario: running create operation 对账

- **WHEN** create operation 已处于 running
- **AND** provider inspect 到外部存在匹配 head/base branch 的 PR/MR
- **THEN** 系统持久化 PR/MR record
- **AND** operation 标记为 reconciled

### Requirement: 系统必须能更新 PR/MR

系统 SHALL 支持更新 PR/MR title 或 body，并记录相应 event 与 artifact 引用。

#### Scenario: 更新 PR body

- **WHEN** agent 调用 update PR 能力
- **THEN** 系统读取 body artifact
- **AND** 使用当前 PR/MR provider 更新远端内容
- **AND** 持久化更新后的摘要信息

### Requirement: 系统必须能检查 review 状态

系统 SHALL 提供 review inspection 能力，用于读取 PR/MR review 和 blocking 状态，并据此决定是否继续 request merge approval。

#### Scenario: 检查 review

- **WHEN** 系统检查某个 open PR/MR
- **THEN** 系统返回当前 review 概览
- **AND** 系统不把 review 结果直接当作 merge approval

### Requirement: 系统必须支持显式 merge approval

系统 SHALL 将 merge approval 作为独立 human request / approval 流程处理，且 Web operator surface 只能通过 Core provider runtime 发起 approve、reject 或 merge after approval；merge 仍只能在有效 approval snapshot 存在时执行。

#### Scenario: 请求 merge approval

- **WHEN** PR/MR 已 open 且 review 满足继续条件
- **THEN** 系统创建 waiting human request 或 approval request artifact
- **AND** merge 之前不能自动通过

#### Scenario: 审批有效

- **WHEN** operator 明确批准当前 snapshot
- **THEN** 系统记录 approval snapshot
- **AND** 允许后续 merge

#### Scenario: 旧 approval snapshot 失效

- **WHEN** 当前 PR/MR snapshot 与已有 pending 或 approved approval 不匹配
- **THEN** 系统不得复用旧 approval
- **AND** 旧 approval 必须失效后才能为新 snapshot 创建 approval request

#### Scenario: Web operator 触发拒绝

- **WHEN** operator 在 Web 中拒绝当前 approval request
- **THEN** 系统将 approval request 标记为 rejected
- **AND** 不把拒绝结果暴露为 agent tool

#### Scenario: Web operator 触发 merge

- **WHEN** operator 在 Web 中触发 merge after approval
- **THEN** 系统先重新 inspect snapshot
- **AND** snapshot 不一致时拒绝 merge

### Requirement: 系统必须在 merge 前重新校验 snapshot

系统 SHALL 在执行 merge 前重新检查 head/base/validation/strategy snapshot，若 snapshot 不一致则失效并阻止 merge。

#### Scenario: snapshot 变化

- **WHEN** PR head SHA、base SHA、validation 或 merge strategy 变化
- **THEN** 系统使 approval 失效
- **AND** 不允许 merge

### Requirement: 系统必须默认使用 squash merge

系统 SHALL 默认使用 squash merge，且 merge 冲突不能自动绕过。

#### Scenario: merge 成功

- **WHEN** approval 有效且远端状态一致
- **THEN** 系统执行 squash merge
- **AND** 记录 merge 结果

#### Scenario: merge conflict

- **WHEN** merge 检测到冲突
- **THEN** 系统不强行合并
- **AND** 进入 blocked 或 future conflict-resolution path
