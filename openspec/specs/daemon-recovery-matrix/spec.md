# daemon-recovery-matrix Specification

## Purpose
TBD - created by archiving change harden-daemon-reconciliation-matrix. Update Purpose after archive.
## Requirements
### Requirement: Core 必须拥有 recovery decision
系统 SHALL 将 daemon 收集到的恢复观察转换为 Core-owned `RecoveryDecision`，daemon 只能执行 Core 允许的下一步动作并记录事件，不得在 daemon 内部判断业务完成、review 结论、workflow profile 或 merge readiness。

#### Scenario: daemon 通过 Core 获取恢复决策
- **WHEN** daemon 观察到 active operation、workflow run 或 agent session 需要恢复
- **THEN** daemon 将 observation 传给 Core recovery service
- **AND** Core 返回有限 `RecoveryDecision`
- **AND** daemon 只执行该 decision 声明的 daemon action

#### Scenario: daemon 不做业务语义判断
- **WHEN** workflow run、PR/MR 或 review 处于不确定状态
- **THEN** daemon 不直接判断业务完成或 review 通过
- **AND** Core 只能基于已确认协议和 gate 产出 retry、unknown、operator attention 或 wake agent 等受控决策

### Requirement: 系统必须提供 operation replay matrix
系统 SHALL 基于 operation status、resource expected state 和 observed external state 处理 `running`、`failed`、`unknown` operation 的恢复，不得仅凭数据库中的 non-terminal operation 重放高风险副作用。

#### Scenario: running operation 外部状态匹配 intent
- **WHEN** operation 状态为 `running` 且 observed external state 与 intent 匹配
- **THEN** Core recovery decision 将 operation 标记为 `reconciled` 或 `succeeded`
- **AND** 系统记录 recovery decision event

#### Scenario: running operation 外部状态缺失
- **WHEN** operation 状态为 `running` 且 observed external state 为 `absent`
- **THEN** Core 根据 retry budget 和 operation kind 决定 retry 或 operator attention
- **AND** 系统不得无预算地重复执行副作用

#### Scenario: running operation 外部状态冲突
- **WHEN** operation 状态为 `running` 且 observed external state 与 intent 冲突
- **THEN** Core 将恢复决策设置为 `unknown` 或 `operator_attention`
- **AND** 系统不得自动覆盖外部状态

#### Scenario: unknown operation 先 inspect
- **WHEN** operation 状态为 `unknown`
- **THEN** daemon 必须先执行对应 resource 的 read-only inspect
- **AND** Core 基于 inspect observation 决定下一步

#### Scenario: workflow action unknown operation 通过 protocol inspect 封口
- **WHEN** `workflow:action` operation 状态为 `running`、`failed` 或 `unknown`
- **AND** workflow protocol `status --run` 返回的 runId/profile 与 DB workflow run 匹配
- **THEN** Core recovery decision 将旧 action operation 标记为 `reconciled`
- **AND** 系统记录 recovery decision event
- **AND** 后续 action retry 必须基于最新 workflow run stateVersion 形成新的 idempotency key

#### Scenario: workflow action inspect 不可用
- **WHEN** `workflow:action` operation 需要恢复
- **AND** workflow protocol `status --run` 不可用或返回 consistency violation
- **THEN** Core recovery decision 进入 `unknown` 或 `operator_attention`
- **AND** 系统保持 action operation 为 `unknown`
- **AND** 系统不得把 workflow run 静默推进为 completed、handoff 或 pr_ready

#### Scenario: workflow action recovery 不读取 private state
- **WHEN** daemon 恢复 `workflow:action` operation
- **THEN** 系统只通过 workflow protocol read-only inspect 获取 observation
- **AND** 系统不得读取或修改 `.workflow` private state

### Requirement: workflow run reconciliation 必须保持 protocol-only
系统 SHALL 只通过 workflow protocol `status` 观察 workflow run，并且只用 `lifecycle`、`handoff`、`artifacts`、`recovery`、`summary` 推动外层恢复决策。

#### Scenario: workflow protocol unavailable
- **WHEN** workflow run 为 active 但 protocol status 不可用
- **THEN** Core recovery decision 进入 retry inspect、unknown 或 operator attention
- **AND** 系统不把 workflow run 视为 completed 或 pr_ready

#### Scenario: workflow run id mismatch
- **WHEN** workflow protocol status 返回的 `runId` 与当前 workflow run external id 不一致
- **THEN** Core 将其视为 protocol consistency violation
- **AND** 系统不得自动重启另一个 workflow run
- **AND** 系统不得读取 `.workflow` private state 来确认

#### Scenario: workflow profile mismatch
- **WHEN** workflow protocol status 返回的 profile 与当前 workflow run profile 不一致
- **THEN** Core 将其视为 protocol consistency violation
- **AND** 系统进入 unknown 或 operator attention

#### Scenario: stage 不驱动外层状态
- **WHEN** workflow protocol status 中 stage/substate/gate 看似完成但 handoff unavailable
- **THEN** workflow run 不得被外层视为 pr_ready 或 completed
- **AND** stage/substate/gate 只能进入 debug 或 event payload

### Requirement: agent session stalled/no-progress 必须受控恢复
系统 SHALL 对 stalled 或 no-progress outer agent session 先 inspect，再基于 retry budget、dueAt 和 task stateVersion 决定是否唤醒 Coordinator Agent，避免同一 task stateVersion 无进展重复启动 provider。

#### Scenario: stalled agent session 先 inspect
- **WHEN** active outer agent session 超过 stalled 阈值
- **THEN** daemon 执行 provider/session inspect
- **AND** Core 基于 observed summary 决定 retry_due、unknown 或 operator attention

#### Scenario: 同一 task stateVersion 不重复启动 provider
- **WHEN** 同一 task stateVersion 已有无进展 terminal agent session operation
- **THEN** daemon 不再次启动相同 wake reason 的 provider session
- **AND** 系统记录 no-progress recovery event 或等待新的 stateVersion

### Requirement: paused 和 canceled 必须阻止新副作用但允许 safe inspect
系统 SHALL 在 paused 或 canceled task 上阻止启动 agent、执行 agent tools、workflow action、PR/MR mutation 和 merge；系统可以执行 read-only inspect 并记录 recovery event。

#### Scenario: paused task 只允许 read-only inspect
- **WHEN** task 状态为 `paused`
- **THEN** daemon 可以记录 recovery observation
- **AND** daemon 不启动 Coordinator Agent
- **AND** daemon 不执行 agent tools 或外部 mutation

#### Scenario: canceled task 不被 operation replay 重新唤醒
- **WHEN** task 状态为 `canceled` 且存在 non-terminal operation
- **THEN** daemon 不启动 Coordinator Agent
- **AND** Core recovery decision 不执行新的 workflow、agent 或 PR/MR 副作用

#### Scenario: paused task 的 answered human request 不被消费
- **WHEN** human request 已 answered 且 task 状态为 `paused`
- **THEN** daemon 不消费该 human answer 来唤醒 agent
- **AND** answer 保持可见，等待 operator resume 后处理

### Requirement: recovery decision event 必须可观测且 payload 保持窄
系统 SHALL 为关键 recovery decision 写入 append-only event，payload 只能包含审计所需的窄摘要和 artifact refs，不得包含 provider raw output、secret、lock token 或完整内部对象。

#### Scenario: 写入 recovery decision event
- **WHEN** Core 产出 recovery decision
- **THEN** 系统写入 event
- **AND** event payload 包含 resource kind/id、operation id、decision、reason code、observed summary、next action、retry dueAt 和 artifact refs

#### Scenario: recovery event 不泄漏内部 raw 数据
- **WHEN** recovery event 被写入
- **THEN** event payload 不包含 provider raw output、lock token、完整 operation JSON 或完整 workflow status JSON

### Requirement: recovery matrix 必须覆盖 workspace/lock observation
系统 SHALL 将 workspace/lock/fencing observation 纳入 Core recovery matrix，并保持 `Observation -> Core RecoveryDecision -> Daemon Action`。

#### Scenario: workspace observation 进入 Core decision
- **WHEN** daemon 观察到 active workspace 需要恢复
- **THEN** daemon 将 workspace observation 传给 Core
- **AND** Core 返回 workspace/lock recovery decision

#### Scenario: lock observation 进入 Core decision
- **WHEN** daemon 观察到 expired lock
- **THEN** daemon 先 inspect owner/resource 状态
- **AND** Core 基于 observation 决定是否释放、阻塞或 operator review

### Requirement: recovery matrix 必须覆盖 PR/MR 与 merge observation

系统 SHALL 将 PR/MR、merge approval 和 merge operation observation 纳入 Core recovery matrix，并保持 `Observation -> Core RecoveryDecision -> Daemon Action`。

#### Scenario: PR/MR observation 进入 Core decision

- **WHEN** daemon 或 runtime 观察到 active PR/MR 需要恢复
- **THEN** daemon/runtime 只执行 read-only inspect
- **AND** Core 基于 PR/MR observation 返回 recovery decision

#### Scenario: merge operation observation 进入 Core decision

- **WHEN** merge operation 状态为 running、failed 或 unknown
- **THEN** 系统先 inspect 当前 PR/MR 外部状态
- **AND** Core 决定 retry、reconciled、unknown 或 operator attention

#### Scenario: daemon 不判断 review 或 merge readiness

- **WHEN** PR/MR review、approval 或 merge 状态发生变化
- **THEN** daemon 不直接判断 review 通过、业务完成或是否 merge
- **AND** daemon 只能记录 observation、调用 Core decision 或触发 Core 已允许的动作

### Requirement: workspace/lock recovery 不得扩大 agent surface
系统 SHALL 保持 workspace/lock recovery 为 internal daemon action 或 operator-only observability，不得新增 Coordinator Agent recovery tool。

#### Scenario: 不新增 agent recovery tool
- **WHEN** workspace/lock recovery 能力启用
- **THEN** Coordinator Surface 不包含 `release_lock`、`recover_workspace`、`reconcile_workspace` 或 `takeover_lock`

