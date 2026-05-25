## ADDED Requirements

### Requirement: daemon 必须把 workflow runtime observation 作为只读观察

系统 SHALL 允许 daemon 在 running workflow inspect/reconcile 后记录 sanitized workflow runtime observation，但 daemon MUST NOT 因 observation、allowedActions 或 actionInputHints 自动执行 workflow action、创建 human request、创建 needs-me event 或标记 operator attention，除非 Core recovery decision 基于真实失败/不一致明确要求 operator attention。

#### Scenario: internal workflow action only records observation

- **WHEN** daemon inspect running workflow run
- **AND** latest status 为 active、handoff unavailable
- **AND** workflow runtime observation 为 observing runtime
- **THEN** daemon 只记录 status/recovery observation
- **AND** daemon 不调用 operator workflow action helper
- **AND** daemon 不创建 human request 或 operator attention

#### Scenario: operator gate remains human confirmed

- **WHEN** daemon inspect running workflow run
- **AND** workflow runtime observation 为 waiting operator gate
- **THEN** daemon 不自动确认该 gate
- **AND** 后续确认只能来自 Web/API/CLI operator-only action 并通过 Core helper 校验

#### Scenario: recovery attention requires real failure or inconsistency

- **WHEN** workflow protocol inspect 失败、profile mismatch、provider failure 或 retry budget 耗尽
- **THEN** daemon 将窄 observation 交给 Core recovery decision
- **AND** recovery decision event 不包含完整 workflow status JSON、actionInputs raw payload、provider raw event 或 lock token

