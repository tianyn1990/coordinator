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

### Requirement: daemon 事件必须可观测

系统 SHALL 记录 daemon tick、task claim、reconcile、retry、wake-up、failure 和 recovery decision 事件，以便 UI 和审计追踪。recovery decision event payload 必须保持窄摘要，不得作为 Coordinator Agent 主输入。

#### Scenario: 非 artifact tool 写入额外 artifact

- **WHEN** outer agent 请求的 coordinator tool 不需要 artifact
- **AND** final response 仍包含 coordinator-artifact block
- **THEN** daemon 可以在路径校验通过后受控写入 artifact
- **AND** daemon 记录 debug event 标记 extra artifact
- **AND** event payload 只包含 tickId、toolName、artifactCount、artifactRefs 等窄字段
- **AND** event 不包含 artifact 正文或复杂内部对象
