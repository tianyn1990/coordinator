## ADDED Requirements

### Requirement: Adapter 必须保留 workflow 0.6.10 display projection

系统 SHALL 从成功的 `workflow protocol status` 与成功的 `workflow protocol action` post-action projection 中解析 `progress` 和 `stageArtifacts`，并将其作为 operator/debug projection 写入 workflow event payload。系统 MUST NOT 将这些字段用于外层状态迁移、PR/MR readiness、merge 判断、daemon action 或 Coordinator Agent Surface tool visibility。

#### Scenario: status projection 保留 progress 和 stageArtifacts

- **WHEN** workflow protocol status 返回 `progress` 和 `stageArtifacts`
- **THEN** adapter 将这些字段写入 `workflow.status_inspected` event payload
- **AND** workflow run coarse status 仍只由 `lifecycle` 与 `handoff` 决定
- **AND** adapter 不读取 stage artifact 文件，也不要求文件已存在

#### Scenario: action post-action projection 保留 display 字段

- **WHEN** operator-only workflow action 成功返回 post-action projection
- **THEN** adapter 将 `progress` 和 `stageArtifacts` 写入对应 workflow action event payload
- **AND** raw `actionInputs` 不进入 event payload，仅保留 sanitized `actionInputHints`

#### Scenario: display projection 不进入 Agent Surface

- **WHEN** workflow projection 包含 `progress`、`stageArtifacts`、`allowedActions` 或 `actionInputs`
- **THEN** Coordinator Agent Surface available tools 不因此变化
- **AND** daemon 不根据这些字段自动调用 `workflow protocol action`
