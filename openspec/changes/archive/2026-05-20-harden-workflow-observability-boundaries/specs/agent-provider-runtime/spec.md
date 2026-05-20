## MODIFIED Requirements

### Requirement: Coordinator Agent session 必须基于 Coordinator Surface 运行

系统 SHALL 在启动 provider 前生成 Coordinator Surface，并把同源 JSON/Markdown surface snapshot 写入 session artifact。系统 SHALL 在 Coordinator Agent prompt 中说明 agent 只能基于当前 Surface 行动，并且最终回复最多请求一个 coordinator-tool。复杂内容必须通过 artifact-first 方式传递，工具参数保持一层 key/value。

#### Scenario: 非 artifact 工具不鼓励输出 artifact block

- **WHEN** 当前可见工具是 create_attempt、create_workspace、start_workflow_run 或 inspect_workflow_run
- **THEN** prompt 明确这些普通推进或观察工具默认不需要 coordinator-artifact
- **AND** agent 只有在工具明确需要 artifact 或计划/报告确实修订时才输出 coordinator-artifact
- **AND** prompt 继续保留 artifact-based tool 的写入规则
