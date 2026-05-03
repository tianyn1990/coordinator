# workspace-manager Specification

## Purpose

定义 `coordinator` 第一版本地 Workspace Manager 契约：系统必须能基于 project registry 和 attempt 创建隔离 git worktree workspace，持久化 workspace 机器事实，写 checkpoint artifact，并在恢复前执行只读 resume preflight。该规格不包含 daemon、workflow adapter、agent provider、PR/MR provider 或真实 agent tool 执行。
## Requirements
### Requirement: 系统必须为 attempt 创建本地 git worktree workspace

系统 SHALL 基于 project registry 的 repo path、workspace root 和 default branch，为指定 attempt 创建隔离 workspace 与 git worktree。

#### Scenario: 创建 attempt workspace

- **WHEN** 用户通过 Core 请求为 attempt 创建 workspace
- **THEN** 系统创建 workspace 目录结构
- **AND** 系统创建 `repo/` git worktree
- **AND** 系统保存 workspace record，状态为 `ready`

### Requirement: Branch 名必须确定性且安全

系统 SHALL 使用 `coordinator/<task-id>/<attempt-id>` 形式生成 branch，并对 task id 与 attempt id 做 sanitize。

#### Scenario: 生成 branch

- **WHEN** task id 或 attempt id 包含空格、斜杠或其他高风险字符
- **THEN** 系统生成只包含安全字符片段的确定性 branch

### Requirement: Base branch 必须来自 project registry

系统 SHALL 使用 project registry 中已保存的 default branch 作为 worktree base branch；缺失时不得静默 fallback。

#### Scenario: 缺少 default branch

- **WHEN** project 未保存 default branch
- **THEN** 系统拒绝创建 workspace，并返回受控错误

### Requirement: Workspace 创建必须 operation-first 并受 lock 保护

系统 SHALL 在执行 git worktree 副作用前创建 `workspace:create:<attempt-id>` operation，并获取 attempt / project branch 相关 lock。

#### Scenario: 重复创建 workspace

- **WHEN** 同一 attempt 已存在 ready workspace
- **THEN** 系统返回已有 workspace
- **AND** 系统不重复执行 git worktree add

#### Scenario: lock 未过期

- **WHEN** 另一个 owner 已持有 attempt workspace lock
- **THEN** 系统拒绝本次创建请求

### Requirement: Workspace 路径必须做 realpath containment check

系统 SHALL 校验 workspace path、repo path、artifact root 均位于允许 root 内，并拒绝 `../` 与 symlink escape。

#### Scenario: workspace root symlink escape

- **WHEN** workspace 目标路径通过 symlink 指向 root 外部
- **THEN** 系统拒绝创建或恢复 workspace

### Requirement: 系统必须写 ownership manifest 和 checkpoint artifact

系统 SHALL 在 workspace 的 `coordinator/` 目录写 `ownership.json`，并在 `coordinator/artifacts/` 下写最小 checkpoint artifact。

#### Scenario: workspace ready 后记录证据

- **WHEN** workspace 创建成功
- **THEN** `coordinator/ownership.json` 记录 project/task/attempt/workspace/branch/base branch/owner/lock token
- **AND** checkpoint artifact 被写入并登记到 artifact store

### Requirement: Resume preflight 必须检查 workspace 可恢复性

系统 SHALL 在恢复 attempt 前检查 workspace path、repo worktree、branch、git status、ownership manifest 和 checkpoint artifact。

#### Scenario: preflight 成功

- **WHEN** workspace path、repo worktree、branch、manifest 和 checkpoint 均匹配
- **THEN** preflight 返回 `ok`

#### Scenario: branch mismatch

- **WHEN** 当前 git branch 与 workspace record 不一致
- **THEN** preflight 返回 `blocked`

#### Scenario: dirty workspace

- **WHEN** git status 显示 dirty
- **THEN** preflight 返回 `blocked`，并说明需要 operator review 或 handoff

### Requirement: CLI/API workspace 入口必须是 operator-only

系统 SHALL 提供 CLI/API 的 workspace create/preflight 调试入口，但这些入口不得进入 Coordinator Surface 的 agent tools。

#### Scenario: CLI 创建 workspace

- **WHEN** operator 通过 CLI 指定 database path、attempt id 和 owner 创建 workspace
- **THEN** CLI 返回 workspace 创建结果

#### Scenario: API preflight workspace

- **WHEN** operator 调用 API 检查 workspace preflight
- **THEN** API 返回 preflight 结果
