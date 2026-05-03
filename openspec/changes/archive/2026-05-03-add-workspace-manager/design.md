# Design: add-workspace-manager

## 设计对齐

本 change 对齐：

- `docs/AGENTS.md`：实现必须主动对齐 docs，总体设计心智优先。
- `docs/execution-workspace.md`：每个 attempt 使用隔离 workspace，默认 git worktree，必须做 realpath containment、ownership manifest 和 resume preflight。
- `docs/operations.md`：所有外部副作用采用 operation-first、inspect-before-create、lock / lease / fencing。
- `docs/contracts.md`：Workspace 由 Core via tool 管理，agent 不传复杂 path；artifact path 必须限制在 workspace artifact root 下。
- `docs/project-registry.md`：base branch 来自 project registry 中已显式确认的 default branch，不能静默 fallback。
- `docs/observability.md`：workspace 创建、checkpoint、preflight 结果必须产生 event 或 artifact，便于 UI 和排查。

## 模块边界

### DB

`packages/db` 只提供最小 repository：

- 创建 attempt。
- 查询 attempt。
- 创建/更新 workspace。
- 查询 attempt 的 active workspace。
- 创建 artifact record。
- 更新 operation 状态与 observed state。
- 校验 lock token 仍有效。

DB 层不调用 git、不计算 branch、不做 workspace 业务判断。

### Core

`packages/core` 新增 Workspace Manager：

- 输入 project/task/attempt id 与最小 `LocalWorker`。
- 读取 project registry 与 attempt。
- 生成 workspace layout。
- 通过 operation 与 lock 保护副作用。
- inspect-before-create 检查已有 worktree/branch。
- 调用 GitRunner 执行 git。
- 写 ownership manifest 与 checkpoint artifact。
- 持久化 workspace 事实与 events。
- 提供 resume preflight。

Core 不启动 workflow，不启动 agent，不创建 PR/MR。

### CLI/API

CLI/API 是 operator surface：

- `workspace create` 创建 attempt workspace。
- `workspace preflight` 检查 workspace 可恢复性。

这些入口便于手动调试和后续 Web 使用，不是 agent tools，也不进入 Coordinator Surface。

## Workspace Layout

默认：

```text
<workspaceRoot>/<project-id>/<task-id>/<attempt-id>/
  repo/
  coordinator/
    artifacts/
    logs/
    sessions/
    ownership.json
```

如果 project registry 配置了 `workspaceRoot`，以该 root 为准；否则使用 `~/.coordinator/workspaces`。

## Branch 策略

默认 branch：

```text
coordinator/<task-id>/<attempt-id>
```

规则：

- task id 与 attempt id 必须 sanitize。
- branch 只允许安全字符片段。
- 分支名确定性生成。
- branch 已存在时必须 inspect-before-create；若不是当前 workspace/attempt 的已有记录，拒绝继续。

## Path Safety

所有本地路径必须做 canonical containment：

- workspace path 必须在 project workspace root 内。
- repo path 必须在 workspace path 内。
- artifact root 必须在 workspace coordinator 目录内。
- artifact 相对路径不得为绝对路径，不得包含 `..`。
- symlink escape 必须拒绝。

对于创建前尚不存在的 leaf path，先 canonical 已存在 parent，再验证目标 normalize 后仍在 root 内。

## Operation / Lock

创建 workspace 的关键步骤：

1. 创建或复用 `workspace:create:<attempt-id>` operation，并推进到 `running`。
2. 获取 `attempt:<attempt-id>` lock、`project-branch:<project-id>:<branch>` lock 和 `workspace:<workspace-id>` lock。
3. inspect-before-create：
   - 查询 active workspace。
   - 检查 workspace path 是否已存在。
   - 检查 branch 是否已存在。
   - 如果已有 `creating` workspace 且外部 worktree/branch 与当前 attempt 记录匹配，可以收敛为 ready。
4. 执行 `git worktree add <repoPath> -b <branch> <baseBranch>`，或在匹配的中断恢复场景中跳过重复创建。
5. 写 ownership manifest、checkpoint artifact。
6. 在同一 transaction 内更新 workspace 为 `ready`、登记 checkpoint artifact、append `workspace.ready` event、推进 operation 为 `succeeded`。

如果 operation 已经存在且 workspace 已 ready，返回已有 workspace，不重复执行 git。

如果创建失败，operation 进入 `failed` 并记录 `lastObservedState`；后续 daemon/reconcile 可基于 operation 和外部状态决定 retry/handoff。本轮不实现完整 daemon，但不留下无状态的副作用。

## LocalWorker

Iteration 5 只实现最小本地 worker 形态：

```text
id
kind = local
host
workspaceRoot
capabilities
```

它用于标识 workspace owner 和 ownership manifest，不引入 remote worker、worker registry、调度器或鉴权系统。

## Resume Preflight

`resumeWorkspacePreflight` 返回 machine result 与简短 Markdown summary，用于后续 surface/daemon 消费。

检查项：

- workspace record 存在且 path 在 root 内。
- workspace path、repo path、artifact root 存在并通过 realpath containment。
- repo 是 git worktree。
- 当前 branch 与 DB 记录一致。
- `git status --porcelain` 是否 dirty。
- ownership manifest 是否存在并匹配 project/task/attempt/workspace/branch/base branch。
- checkpoint artifact 是否存在。

preflight 是只读检查：

- path containment checks 必须逐项 fail-fast。
- path 检查失败后，不继续执行 git 命令，不读取 manifest/checkpoint。
- preflight 不创建缺失目录，不修复 workspace，不改变外部文件系统。

结果：

- `ok`：可继续。
- `blocked`：存在高风险偏差，应进入 operator review/handoff。
- `retryable`：安全可重试，例如创建中断且外部副作用不存在。

Iteration 5 只返回结果并记录 event，不自动驱动 retry/handoff 状态机。

## 测试策略

- branch sanitize 和确定性生成。
- workspace path 在 root 内，`../` 与 symlink escape 被拒绝。
- duplicate active workspace 被拒绝或复用已有 ready workspace。
- base branch 来自 project registry，缺失时阻塞。
- branch 已存在但不属于当前 attempt 时拒绝。
- stale lock 可被过期接管。
- 创建 workspace 会写 operation、workspace record、ownership manifest、checkpoint artifact 和 event。
- preflight 覆盖 ok、branch mismatch、dirty status、manifest mismatch、missing path。
