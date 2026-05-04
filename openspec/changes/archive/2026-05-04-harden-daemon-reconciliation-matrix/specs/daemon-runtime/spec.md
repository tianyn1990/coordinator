## MODIFIED Requirements

### Requirement: daemon 必须执行 watchdog 和 reconciliation
系统 SHALL 对 active agent session、workflow run、workspace、human request 和 lock 状态执行 watchdog 与 reconciliation，并在外部状态与数据库不一致时通过 Core recovery decision 采取受控修复或降级，而不是静默推进完成。daemon 不得直接拥有恢复策略；daemon 必须把 observation 交给 Core，并执行 Core 返回的有限 recovery action。

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

### Requirement: daemon 必须遵守 retry budget
系统 SHALL 对可重试失败使用受限 retry budget，并在预算耗尽时转为 operator attention、failed 或人工介入，而不是无限重试。retry/handoff/human 的选择必须由 Core recovery decision 产出，daemon 不得自行判断业务 handoff。

#### Scenario: retry 耗尽
- **WHEN** 同类失败超过 retry budget
- **THEN** daemon 不再自动重试
- **AND** Core recovery decision 记录恢复受限原因
- **AND** 系统触发 operator attention、failed 或 human request 等受控结果

#### Scenario: 同一 stateVersion 无进展不重复启动
- **WHEN** 同一 task stateVersion 已有同 wake reason 的 terminal agent session operation 且没有新观察事实
- **THEN** daemon 不再次启动 provider session
- **AND** 系统记录 no-progress 或 retry blocked 事件

### Requirement: daemon 事件必须可观测
系统 SHALL 记录 daemon tick、task claim、reconcile、retry、wake-up、failure 和 recovery decision 事件，以便 UI 和审计追踪。recovery decision event payload 必须保持窄摘要，不得作为 Coordinator Agent 主输入。

#### Scenario: 记录 tick 事件
- **WHEN** daemon 执行一次 tick
- **THEN** 系统写入可观测事件
- **AND** 事件包含 tick 级别摘要和受影响资源引用

#### Scenario: 记录 recovery decision 事件
- **WHEN** Core 产出 recovery decision
- **THEN** daemon 或 Core 写入 append-only recovery event
- **AND** event 包含 resource kind/id、operation id、decision、reason code、observed summary、next action 和 artifact refs
- **AND** event 不包含 provider raw output、secret、lock token 或完整内部对象
