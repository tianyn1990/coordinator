## ADDED Requirements

### Requirement: AgentProvider runtime 必须支持 inner coding agent session

系统 SHALL 提供 Core runtime 启动 `role=inner` coding agent session。inner session MUST 绑定 task、attempt 和 workspace repo，并把 prompt、上下文 snapshot、transcript、final response artifact、provider session evidence 和 normalized activity 记录到 Coordinator 管控的 session artifact root。

#### Scenario: inner session 在 workspace repo 中运行

- **WHEN** Core 启动 inner coding agent session
- **AND** attempt 存在 ready workspace
- **THEN** provider cwd 为 workspace 的 `repo/` path
- **AND** agent session record 的 `role` 为 `inner`
- **AND** agent session record 绑定同一 task 和 attempt
- **AND** final response artifact 可被后续 workflow gate evidence 引用

#### Scenario: outer session cwd 保持 decision-only

- **WHEN** Core 启动 outer Coordinator Agent session
- **THEN** provider cwd 仍指向 `coordinator/sessions/<session-id>/`
- **AND** outer session 不获得 workspace repo 写权限

### Requirement: inner provider 权限必须受 workspace 边界约束

系统 SHALL 根据 agent role 选择 provider permission profile。inner Codex session MUST 使用 workspace-write 等价 profile 且不得使用 danger-full-access；inner Claude Code session MUST 使用可编辑 workspace 的 profile，但不得使用 bypassPermissions。所有 inner provider session MUST 在 workspace repo cwd 内运行。

#### Scenario: Codex inner 使用 workspace-write

- **WHEN** CodexProvider 运行 metadata role 为 `inner` 的 session
- **THEN** SDK bridge 使用 `sandboxMode = workspace-write`
- **AND** `approvalPolicy = never`
- **AND** permission profile 摘要记录为 inner workspace-write profile

#### Scenario: Claude inner 不使用 bypass permissions

- **WHEN** ClaudeCodeProvider 运行 metadata role 为 `inner` 的 session
- **THEN** SDK bridge 不设置 `bypassPermissions`
- **AND** permission profile 摘要记录为 inner edit-capable profile

### Requirement: inner prompt 必须生成 operator gate evidence

系统 SHALL 为 inner coding agent 生成 workflow-aware prompt，要求其在 workflow/operator gate、失败或 handoff 时停止并输出 human-visible final response。该 prompt MUST 明确禁止直接读写 `.workflow` private state、自动确认 human gate、自动 merge 或把 workflow internal action 交给 Web operator 手填。

#### Scenario: inner prompt 包含 workflow run 上下文

- **WHEN** Core 生成 inner coding agent prompt
- **THEN** prompt 包含 task 摘要、workspace repo、branch、workflow launcher、workflow run id、external run id 和 profile
- **AND** prompt 要求 coding agent 用 workflow protocol/status 或 workflow skill 推进当前 run
- **AND** prompt 不暴露 outer Coordinator Agent tools 作为可调用工具菜单

#### Scenario: inner final response 是可见证据

- **WHEN** inner provider 成功完成 session
- **THEN** Core 保存 final response artifact
- **AND** session completed event payload 只记录 preview、artifact refs、provider evidence 和 normalized activity
- **AND** raw provider events 不进入 event payload 或 Coordinator Surface
