## ADDED Requirements

### Requirement: Core 必须拥有 PR/MR recovery decision

系统 SHALL 将 PR/MR 与 merge 的外部观察转换为 Core-owned `RecoveryDecision`，provider adapter 只能返回外部事实，daemon 只能执行 Core 允许的 read-only inspect、event、retry、reconcile 或 operator attention 动作。

#### Scenario: provider 只返回外部事实

- **WHEN** provider inspect PR/MR 或 merge result
- **THEN** provider 返回有限外部事实，例如 state、head/base、review、validation、mergeable 和 url
- **AND** provider 不决定 approval 是否失效、不决定是否 merge、不推进 task completed

#### Scenario: daemon 通过 Core 获取 PR/MR 恢复决策

- **WHEN** daemon 观察到 PR/MR、approval 或 merge operation 需要恢复
- **THEN** daemon 将外部事实和 DB 期望状态交给 Core recovery service
- **AND** daemon 只执行 Core decision 声明的动作

### Requirement: 系统必须覆盖 PR/MR 外部状态对账

系统 SHALL 对 PR/MR 的外部状态执行 inspect-before-create 与 recovery reconciliation，覆盖 absent、open same intent、open conflicts intent、closed unmerged、merged 和 unclear。

#### Scenario: PR already exists matches intent

- **WHEN** create PR/MR operation 正在执行或准备执行
- **AND** provider inspect 到同 head/base 的 open PR/MR
- **THEN** 系统复用外部 PR/MR 并持久化 machine truth
- **AND** operation 标记为 `reconciled`

#### Scenario: external PR conflicts intent

- **WHEN** provider inspect 到外部 PR/MR 与当前 head/base intent 冲突
- **THEN** Core recovery decision 进入 `operator_attention` 或 `unknown`
- **AND** 系统不得继续创建重复 PR/MR

#### Scenario: PR closed unmerged

- **WHEN** DB 期望 PR/MR 为 active
- **AND** provider inspect 到外部 PR/MR 已关闭且未 merge
- **THEN** 系统记录 recovery decision event
- **AND** task 不得自动 completed，必须等待 operator 或 Coordinator Agent 后续判断

#### Scenario: PR already merged

- **WHEN** DB 期望 PR/MR 为 active 或 merge operation 为 running/unknown
- **AND** provider inspect 到外部 PR/MR 已 merged
- **THEN** Core 可以将 PR/MR 和相关 merge operation reconcile 为 merged
- **AND** 系统记录可审计 event 后推进 task completed

### Requirement: 系统必须在 snapshot 变化时失效 merge approval

系统 SHALL 在任何刷新 PR/MR snapshot 的路径中检查 pending 或 approved merge approval，若 head/base/validation/review/strategy 不再匹配，必须先失效旧 approval，再允许请求新 approval 或阻止 merge。

#### Scenario: head/base/validation 变化

- **WHEN** inspect review、daemon recovery inspect 或 merge 前 inspect 发现 head SHA、base SHA 或 validation run 变化
- **THEN** 系统更新 PR/MR snapshot
- **AND** 系统将不匹配的 pending 或 approved approval 标记为 invalid/rejected
- **AND** `merge_after_approval` 不得继续可用

#### Scenario: review 变为 blocking

- **WHEN** 最新 PR/MR review 状态变为 blocking 或不满足 merge readiness
- **THEN** 系统使当前 approval 失效
- **AND** merge 必须重新经过 review inspect 与 explicit approval

### Requirement: 系统必须分类处理 merge race 与 merge conflict

系统 SHALL 在 merge 前重新 inspect 当前 PR/MR snapshot，并在 merge 执行后或失败后对结果进行 reconciliation；merge race 可以 reconcile，merge conflict 必须 blocked/operator attention，不得绕过。

#### Scenario: merge race observed merged

- **WHEN** merge operation running 或 unknown
- **AND** provider inspect 到 PR/MR 已经 merged
- **THEN** Core 可以将 operation 标记为 `reconciled`
- **AND** PR/MR 状态更新为 merged，task 进入 completed

#### Scenario: merge conflict

- **WHEN** provider merge 或 inspect 明确返回 conflict
- **THEN** Core recovery decision 进入 `operator_attention` 或 blocked conflict path
- **AND** 系统不得强行 merge 或自动 completed

#### Scenario: merge snapshot changed before provider merge

- **WHEN** merge 前 inspect 发现当前 snapshot 与 approval snapshot 不一致
- **THEN** 系统拒绝 merge
- **AND** operation 进入受控 unknown/failed 状态并释放 PR merge lock

### Requirement: 系统必须分类 provider failure

系统 SHALL 将 provider failure 分类为 retryable transient、rate_limited、auth_missing、conflict、malformed_output 或 unknown，并据此决定 retry、unknown 或 operator attention。

#### Scenario: timeout 或 rate limit

- **WHEN** provider inspect/create/update/merge 返回 timeout 或 rate limit
- **THEN** 系统按 retry budget 安排 retry 或进入 operator attention
- **AND** 不得假设外部副作用不存在或成功

#### Scenario: auth missing

- **WHEN** provider 返回 auth missing 或 permission denied
- **THEN** 系统进入 operator attention
- **AND** 不自动重试高风险副作用

#### Scenario: malformed output

- **WHEN** provider 输出无法解析为有限外部事实
- **THEN** 系统将观察结果视为 unclear 或 unknown
- **AND** 不把 malformed output 当作 absent、clean 或 merged
