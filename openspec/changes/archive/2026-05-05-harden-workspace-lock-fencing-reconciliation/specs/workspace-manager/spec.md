## ADDED Requirements

### Requirement: Workspace Manager 必须提供 recovery inspect
系统 SHALL 提供只读 workspace recovery inspect，用于 daemon/Core 恢复矩阵观察 workspace path、repo、artifact root、branch、dirty、manifest 和 checkpoint 状态。

#### Scenario: inspect active workspace
- **WHEN** daemon 请求 inspect active workspace
- **THEN** Workspace Manager 返回窄 observation
- **AND** inspect 不创建目录、不执行清理、不写 workflow private state

#### Scenario: inspect 不读取 workflow private state
- **WHEN** workspace repo 中存在 `.workflow` private state
- **THEN** recovery inspect 不读取该目录
- **AND** 不使用 workflow stage/substate/gate 推导 workspace 是否可继续

### Requirement: Resume preflight 必须保持 fail-fast path 语义
系统 SHALL 在 workspace/repo/coordinator/artifact path 检查失败后立即停止后续 git、manifest 和 checkpoint 检查。

#### Scenario: artifact root escape
- **WHEN** artifact root realpath 逃逸 coordinator 目录
- **THEN** preflight 返回 blocked
- **AND** 不继续读取 manifest 或运行 git 命令

### Requirement: Workspace Manager 必须支持 stale token fencing 测试
系统 SHALL 通过 lock token 校验拒绝 stale owner 对 workspace machine truth 的更新。

#### Scenario: stale token 更新 workspace
- **WHEN** caller 使用过期或不匹配的 workspace lock token 更新 workspace
- **THEN** 系统返回受控 conflict
- **AND** workspace 状态和 state version 不变
