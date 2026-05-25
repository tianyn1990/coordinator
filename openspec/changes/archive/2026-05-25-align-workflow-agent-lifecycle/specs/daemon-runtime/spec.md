## MODIFIED Requirements

### Requirement: daemon 必须执行 watchdog 和 reconciliation

系统 SHALL 对 active agent session、workflow run、workspace、human request、lock 状态和需要恢复的 workflow action operation 执行 watchdog 与 reconciliation，并在外部状态与数据库不一致时通过 Core recovery decision 采取受控修复或降级，而不是静默推进完成。daemon 不得直接拥有恢复策略；daemon 必须把 observation 交给 Core，并执行 Core 返回的有限 recovery action。

#### Scenario: running workflow 只能 inspect

- **WHEN** workflow run 数据库状态为 running
- **AND** workflow protocol status 返回 lifecycle active 且 handoff unavailable
- **THEN** daemon 只记录 status/recovery observation
- **AND** workflow run 保持 running
- **AND** daemon 不调用 `workflow protocol action`
- **AND** daemon 不根据 allowedActions、actionInputHints、stage 或 gate 推进 workflow action

#### Scenario: agent/internal action 不制造 operator blocker

- **WHEN** workflow run 数据库状态为 running
- **AND** workflow protocol status 返回 lifecycle active 且 handoff unavailable
- **AND** allowedActions 只包含 `materialize-change`、`run-alignment-checks`、repair/current-change、inspect/resume、实现推进类或 unknown action
- **THEN** daemon 不创建 human request、operator attention 或 needs-me event
- **AND** daemon 只记录 sanitized workflow status observation
- **AND** daemon 不调用 operator workflow action helper
