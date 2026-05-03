## Why

`coordinator` 已具备 Project Registry、核心数据模型和 Coordinator Surface。下一步需要把 task/attempt 落到可执行的本地隔离 workspace 上，才能启动后续 workflow run、agent session 和 PR/MR 流程。

Iteration 5 需要先实现 Workspace Manager 的本地能力：基于 project registry 的 repo/default branch/workspace root 创建 git worktree、生成确定性 branch、持久化 workspace 机器事实、写 checkpoint artifact，并提供 resume preflight。这个 change 是后续 daemon、workflow adapter、agent tools 和 PR/MR provider 的执行基础，但不提前实现那些能力。

## What Changes

- 新增 workspace manager capability，覆盖本地 git worktree workspace 创建、复用检查、路径 containment、lock、checkpoint 和 resume preflight。
- 在 `packages/db` 增加 attempt/workspace/artifact 的最小 repository 能力，仍由 Core 负责业务规则。
- 在 `packages/core` 新增 Workspace Manager service，使用窄输入创建 attempt workspace。
- 使用 `operation` 记录 `workspace:create` intent，并使用 workspace/branch 相关 lock 避免重复副作用。
- 实现 branch 名确定性生成和 sanitize。
- 实现 workspace root、workspace path、repo path、artifact root 的 canonical realpath containment check，禁止 `../` 与 symlink escape。
- 生成 `coordinator/ownership.json` 和最小 checkpoint artifact。
- 提供 resume preflight，检查 workspace path、repo worktree、branch、artifact root 和 git status。
- 增加 CLI/API operator 调试入口，便于手动创建/检查 workspace；这些入口不是 Coordinator Agent tool。

## Non-goals

- 不实现 daemon loop、watchdog 或自动 reconcile tick。
- 不实现 WorkflowRuntime adapter。
- 不启动 Codex / Claude Code agent session。
- 不实现 PR/MR provider、push branch 或 merge。
- 不把 workspace 创建工具暴露给 Coordinator Agent 执行面。
- 不读取或写入 `.workflow` private state。
- 不实现 remote worker，只保留本地实现接口形态。

## Capabilities

### New Capabilities

- `workspace-manager`: 本地 Workspace Manager、git worktree、branch、lock、checkpoint、resume preflight 和 operator 调试入口。

### Modified Capabilities

- `core-data-model`: 增加 attempt/workspace/artifact repository 行为，不改变已确认表边界。

## Impact

- 影响 `packages/db`：新增最小 attempt/workspace/artifact repository。
- 影响 `packages/core`：新增 Workspace Manager service、Git runner abstraction、path containment 和 preflight。
- 影响 `packages/cli` 与 `apps/api`：新增 operator-only workspace create/preflight 入口。
- 影响 docs/roadmap：本轮收尾记录已落地事实。
