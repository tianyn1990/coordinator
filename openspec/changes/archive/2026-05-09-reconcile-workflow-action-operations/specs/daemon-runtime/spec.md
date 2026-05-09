## MODIFIED Requirements

### Requirement: daemon 必须执行 watchdog 和 reconciliation
系统 SHALL 对 active agent session、workflow run、workspace、human request、lock 状态和需要恢复的 workflow action operation 执行 watchdog 与 reconciliation，并在外部状态与数据库不一致时通过 Core recovery decision 采取受控修复或降级，而不是静默推进完成。daemon 不得直接拥有恢复策略；daemon 必须把 observation 交给 Core，并执行 Core 返回的有限 recovery action。

#### Scenario: workflow 运行状态丢失
- **WHEN** workflow run 数据库状态为 running 但外部状态不可用
- **THEN** daemon 将 observation 传给 Core recovery service
- **AND** Core 将该 run 标记为需要再检查、unknown 或 operator attention
- **AND** 系统不把它直接视为 completed
- **AND** 系统记录恢复事件

#### Scenario: workflow protocol consistency violation
- **WHEN** workflow protocol status 返回 runId 或 profile 与当前 workflow run 不匹配
- **THEN** daemon 不自动重启 workflow run
- **AND** Core recovery decision 进入 unknown 或 operator attention
- **AND** 系统不读取 `.workflow` private state

#### Scenario: workflow action operation 通过 daemon 恢复
- **WHEN** 存在 `workflow:action` operation 状态为 `running`、`failed` 或 `unknown`
- **THEN** daemon 通过 workflow protocol `status --run` 执行 read-only inspect
- **AND** daemon 将 observation 交给 Core recovery service
- **AND** daemon 只执行 Core 返回的 mark reconciled、mark unknown 或 operator attention 动作

#### Scenario: workflow action operation inspect 失败
- **WHEN** `workflow:action` operation 的 read-only inspect 失败
- **THEN** daemon 记录 recovery decision 和 operator attention 摘要
- **AND** action operation 保持 `unknown`
- **AND** workflow run 不得被推进到 completed 或 handoff
