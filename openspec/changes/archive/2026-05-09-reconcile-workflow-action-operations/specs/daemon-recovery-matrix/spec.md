## MODIFIED Requirements

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
