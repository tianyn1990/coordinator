## MODIFIED Requirements

### Requirement: 启动 workflow run 必须 operation-first

系统 SHALL 在调用 `workflow protocol start` 前创建基于 attempt 与 requested selection 的 operation，并获取 attempt workflow lock。系统 SHALL 支持 omitted/default/auto 作为 runtime auto selection，由 workflow runtime 返回 actual profile；系统 SHALL 支持 human explicit selection 作为 operator/task 输入透传给 workflow runtime。系统 MUST 在 workflow start 成功后保存 workflow run record、requested selection、actual profile，并 append `workflow.started` event。

#### Scenario: runtime auto selection 启动 workflow run

- **WHEN** attempt 有 ready workspace
- **AND** task 没有人类显式 workflow selection
- **THEN** 系统先创建 `workflow:start:<attempt-id>:auto` operation 与 lock
- **AND** 执行 workflow protocol start 的 auto/default/omitted 形式
- **AND** 保存 workflow run record 与 workflow runtime 返回的 actual profile
- **AND** append `workflow.started` event

#### Scenario: human explicit selection 启动 workflow run

- **WHEN** attempt 有 ready workspace
- **AND** task 带有人类显式 workflow selection
- **THEN** 系统先创建包含该 selection 的 workflow start operation 与 lock
- **AND** 将该 selection 作为 human explicit intent 传给 workflow runtime
- **AND** 保存 requested selection 与 workflow runtime 返回的 actual profile

#### Scenario: human explicit profile 未实现

- **WHEN** human explicit profile 不在 capabilities implemented profiles 中
- **THEN** 系统拒绝启动或进入受控 operator attention
- **AND** 不调用 `workflow protocol start`

### Requirement: 系统必须通过 workflow protocol 查询 capabilities

系统 SHALL 调用 project registry 中配置的 workflow launcher，并执行 `protocol capabilities`，解析兼容的 protocol version、implemented profiles、commands 和 handoff kinds。capabilities SHALL 仅用于 operator/debug 展示、human explicit selection 校验和 protocol consistency 诊断；capabilities MUST NOT 成为外层 Coordinator Agent 的 profile 决策源。

#### Scenario: 查询 capabilities

- **WHEN** operator 请求查询某 project 的 workflow capabilities
- **THEN** 系统执行 `workflow protocol capabilities`
- **AND** 返回 implemented profiles 与 supported commands

#### Scenario: protocol version 不兼容

- **WHEN** workflow capabilities 返回不兼容的 protocol version
- **THEN** 系统拒绝继续启动 workflow run，并返回受控错误

#### Scenario: capabilities 不进入 Agent profile 决策

- **WHEN** 系统生成 Coordinator Agent Surface
- **THEN** implemented profiles 不得作为要求 outer Agent 选择 profile 的工具参数进入 agent-facing guidance

### Requirement: workflow status 只能按 protocol handoff 推进外层 workflow run

系统 SHALL 只用 lifecycle/handoff/artifacts/recovery/summary 更新外层 workflow run 粗粒度状态；stage/substate/gate/allowedActions/deniedActions/actionInputs 只能用于 operator debug/display event payload。系统 SHALL 将 status 返回的 actual profile 与已持久化 actual profile 做一致性检查；不一致时进入 protocol consistency violation，不得由 daemon 或 outer Agent 猜测修复。

#### Scenario: active workflow 有 allowed action 但无 handoff

- **WHEN** workflow protocol status 返回 lifecycle active
- **AND** handoff unavailable
- **AND** allowedActions 或 actionInputs 非空
- **THEN** workflow run 仍保持 running
- **AND** coordinator 不把这些 debug hint 转换为 agent-facing tool
- **AND** daemon 不自动执行 workflow action

#### Scenario: actual profile mismatch

- **WHEN** workflow protocol status 返回的 profile 与 workflow run 已持久化 actual profile 不一致
- **THEN** 系统记录 protocol consistency violation
- **AND** 不用 requested selection、stage、gate 或 capabilities 猜测修复
