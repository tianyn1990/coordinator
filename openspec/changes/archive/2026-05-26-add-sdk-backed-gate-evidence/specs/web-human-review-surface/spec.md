## ADDED Requirements

### Requirement: Workflow Action Panel 必须使用 Core gate evidence

系统 SHALL 让 Web Workflow Action Panel 从 Core/API 获取 workflow gate evidence，并将 evidence 与 operator-facing workflow action 同屏展示。Panel MUST 在 evidence `canSubmit` 为 false 时禁用确认按钮；Web 不得自行读取 agent transcript、final response artifact 或 `.workflow` artifact 正文来拼接确认内容。

#### Scenario: ready evidence 允许操作

- **WHEN** Focus Drawer 展示 `freeze-requirements` workflow gate
- **AND** Core gate evidence 返回 `ready` 与 `canSubmit = true`
- **THEN** Panel 展示 primary message 和 protocol facts
- **AND** `Approve requirements and continue` 按钮可提交到 operator-only workflow action API

#### Scenario: missing evidence 禁止操作

- **WHEN** Focus Drawer 展示 `freeze-requirements` workflow gate
- **AND** Core gate evidence 返回 `missing` 或 `canSubmit = false`
- **THEN** Panel 展示缺少 coding agent 可见确认依据
- **AND** `Approve requirements and continue` 按钮禁用
- **AND** Web 不调用 workflow action API

#### Scenario: evidence 查询失败不回退为盲确认

- **WHEN** gate evidence API 查询失败或返回不可用
- **THEN** Panel 显示受控错误或 loading/missing 状态
- **AND** Web 不启用 workflow action 确认按钮
