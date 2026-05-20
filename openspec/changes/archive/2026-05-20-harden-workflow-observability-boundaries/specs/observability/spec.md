## ADDED Requirements

### Requirement: 系统必须提供 operator-only 诊断摘要

系统 SHALL 提供只读派生的 operator diagnosis 或 execution summary，帮助 operator 理解当前 task 的关键状态、最近动作、blocker、recovery 和 artifact refs。该摘要不得成为新的真相源，也不得自动进入 Coordinator Agent Surface。

#### Scenario: 查询 task execution summary

- **WHEN** operator 查询某 task 的 execution summary
- **THEN** 系统从已持久化状态、event、operation 和 artifact refs 派生摘要
- **AND** 摘要按 task、attempt、workspace、agent sessions、coordinator tools、workflow、artifacts 分组
- **AND** 查询不触发 workflow protocol、provider 或 git inspect
- **AND** 摘要不进入 Coordinator Agent Markdown surface

### Requirement: artifact 写入必须可审计

系统 SHALL 记录 coordinator artifact 的受控写入事件，并在 artifact 对当前 tool 非必需时提供 operator 可见的调试信号。

#### Scenario: 额外 artifact 写入可见

- **WHEN** daemon 写入 coordinator artifact
- **AND** 当前 requested tool 不需要 artifact
- **THEN** operator timeline 或 execution summary 可以看到该 artifact 被标记为 extra
- **AND** 系统不把该 extra marker 暴露为 agent-facing tool
