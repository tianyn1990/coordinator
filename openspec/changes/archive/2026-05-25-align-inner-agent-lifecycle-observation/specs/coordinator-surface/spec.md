## ADDED Requirements

### Requirement: Coordinator Surface 必须收窄 workflow runtime observation

系统 SHALL 保持 workflow runtime observation 对 Coordinator Agent 的可见性收窄。Surface MAY 展示 workflow 正在 observing runtime、waiting handoff 或 waiting operator gate 的短摘要，但 MUST NOT 因 observation 暴露 workflow action executor、operator-only API、action input form、raw workflow status、SDK raw event 或 debug-only action queue。

#### Scenario: observing runtime does not expand tools

- **WHEN** 系统生成 workflow running surface
- **AND** workflow runtime observation 为 observing runtime
- **THEN** available_tools 仍只包含当前 contracts 允许的 agent tools，例如 inspect workflow 或 ask human
- **AND** available_tools 不包含 workflow action helper、Web action endpoint、daemon tick 或 operator task controls

#### Scenario: operator gate remains operator-only

- **WHEN** workflow runtime observation 为 waiting operator gate
- **THEN** Coordinator Agent Surface 不暴露 `freeze-requirements` 等 workflow action executor
- **AND** agent-facing Markdown 不要求 outer Agent 代替 operator 确认 gate

#### Scenario: surface does not leak debug payload

- **WHEN** surface 展示 workflow runtime observation 摘要
- **THEN** Markdown 和 JSON surface 不包含完整 `actionInputs` raw payload、`.workflow` private path、provider raw JSONL、permission object 或复杂 workflow status JSON

