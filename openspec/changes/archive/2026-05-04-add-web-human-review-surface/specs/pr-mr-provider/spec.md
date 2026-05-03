## MODIFIED Requirements

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
