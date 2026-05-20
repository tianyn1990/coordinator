# workflow-protocol-adapter Specification

## Purpose
定义 `coordinator` 第一版 Workflow Protocol Adapter 契约：系统必须通过稳定 `workflow protocol` 命令与内层 `workflow` 通信，支持 capabilities/status/start/action/artifacts/events，并把 protocol 结果持久化为外层 workflow run、event 与 artifact 引用。该规格不包含 daemon、agent provider、PR/MR provider 或真实 agent tool 执行。
## Requirements
### Requirement: 系统必须通过 workflow protocol 查询 capabilities

系统 SHALL 调用 project registry 中配置的 workflow launcher，并执行 `protocol capabilities`，解析兼容的 protocol version、implemented profiles、commands 和 handoff kinds。

#### Scenario: 查询 capabilities

- **WHEN** operator 请求查询某 project 的 workflow capabilities
- **THEN** 系统执行 `workflow protocol capabilities`
- **AND** 返回 implemented profiles 与 supported commands

#### Scenario: protocol version 不兼容

- **WHEN** workflow capabilities 返回不兼容的 protocol version
- **THEN** 系统拒绝继续启动 workflow run，并返回受控错误

### Requirement: 启动 workflow run 必须 operation-first

系统 SHALL 在调用 `workflow protocol start` 前创建 `workflow:start:<attempt-id>:<profile-id>` operation，并获取 attempt workflow lock。

#### Scenario: 启动 workflow run

- **WHEN** attempt 有 ready workspace 且 profile 在 capabilities 中 implemented
- **THEN** 系统先创建 operation 与 lock
- **AND** 执行 `workflow protocol start --workflow <profile-id>`
- **AND** 保存 workflow run record
- **AND** append `workflow.started` event

#### Scenario: profile 未实现

- **WHEN** profile 不在 capabilities implemented profiles 中
- **THEN** 系统拒绝启动
- **AND** 不调用 `workflow protocol start`

### Requirement: 系统不得读写 .workflow private state

系统 SHALL 只消费 workflow protocol stdout JSON，不读取或写入 `.workflow/current-run.json`、`.workflow/runs/**/state.json` 等 private state。

#### Scenario: workflow repo 内存在 private state

- **WHEN** adapter 执行 capabilities/start/status/action/artifacts/events
- **THEN** 系统不读取或写入 `.workflow` private state 文件

### Requirement: workflow status 只能按 protocol handoff 推进外层 workflow run

系统 SHALL 只用 lifecycle/handoff/artifacts/recovery/summary 更新外层 workflow run 粗粒度状态；stage/substate/gate/allowedActions/deniedActions/actionInputs 只能用于 operator debug/display event payload。

#### Scenario: active workflow 有 allowed action 但无 handoff

- **WHEN** workflow protocol status 返回 lifecycle active
- **AND** handoff unavailable
- **AND** allowedActions 或 actionInputs 非空
- **THEN** workflow run 仍保持 running
- **AND** coordinator 不把这些 debug hint 转换为 agent-facing tool
- **AND** daemon 不自动执行 workflow action

### Requirement: 系统必须支持 action/artifacts/events 查询

系统 SHALL 支持 `workflow protocol action --run <run-id> <action>`、`artifacts --run <run-id>`、`events --run <run-id>`，并记录外层 event。operator-only workflow inspect/action 入口 MAY 持久化状态 snapshot 或审计 event，因此它们不是纯读高频 polling API。

#### Scenario: operator-only workflow action 不进入 daemon 自动推进路径

- **WHEN** operator 使用 workflow action 调试入口
- **THEN** 系统可以执行 protocol action 并记录审计 event
- **AND** 该能力不得进入 Coordinator Agent Surface
- **AND** daemon 不得因为 running workflow 的 allowedActions 自动调用该入口

### Requirement: CLI/API workflow 入口必须是 operator-only

系统 SHALL 提供 CLI/API 的 workflow capabilities/start/status/action/artifacts/events 调试入口，但这些入口不得进入 Coordinator Surface 的 agent tools。

#### Scenario: CLI 查询 workflow status

- **WHEN** operator 通过 CLI 指定 database path 和 workflow run id 查询 status
- **THEN** CLI 返回 protocol status 的规范化结果

#### Scenario: API 启动 workflow run

- **WHEN** operator 调用 API 为 attempt 启动 workflow run
- **THEN** API 返回 workflow run 启动结果

