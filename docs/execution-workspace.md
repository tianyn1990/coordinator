# Execution 与 Workspace

> 状态：初始方案基线  
> 适用范围：workspace 管理、git worktree、branch 策略、worker runtime、agent provider、PR/MR 执行基础。

## 1. 文档定位

`coordinator` 要支持无人值守、多 attempt、review/rework、merge 和未来远程部署。

因此 workspace 必须一开始就建模清楚。

## 2. Workspace 目标

workspace 需要满足：

- 每个 attempt 隔离。
- inner 或会修改 repo 的 agent 命令只在 workspace repo 内执行；outer decision-only provider 在受控 sessionRoot 内执行。
- retry / continuation 可复用 workspace。
- rework 可选择复用或新建 workspace。
- PR/MR branch 可追踪。
- daemon 可恢复。
- 未来可迁移到 remote worker。

## 2.1 Workspace Ownership Manifest

每个 workspace 建议保存一个 ownership manifest：

```text
coordinator/ownership.json
```

至少记录：

- project id。
- task id。
- attempt id。
- workspace id。
- branch。
- base branch。
- owner worker id。
- owner agent session id。
- created at。
- last heartbeat。
- current lock token。

这个 manifest 不是新的真相源，只是恢复时的对照证据。

## 3. 默认目录

默认 workspace root：

```text
~/.coordinator/workspaces
```

默认结构：

```text
~/.coordinator/workspaces/<project-id>/<task-id>/<attempt-id>/
  repo/
  coordinator/
    artifacts/
    logs/
    sessions/
```

说明：

- `repo/` 是 git worktree。
- `coordinator/` 是外层产物。
- inner `workflow` 会在 `repo/.workflow/` 下维护自己的状态。

## 4. Git worktree

第一版默认使用 git worktree。

原因：

- 本地多任务并发更高效。
- 与已有 repo 共享对象库。
- 分支清晰。
- 比复制目录更容易管理。

创建方式概念：

```bash
git worktree add <workspace>/repo -b coordinator/<task-id>/<attempt-id> <base-branch>
```

具体命令由 `WorkspaceStrategy` 实现，不暴露给 Coordinator Agent。

`WorkspaceStrategy` 不应决定业务语义，只负责 path、branch、worktree 和 cleanup。

## 5. Branch 策略

默认 branch：

```text
coordinator/<task-id>/<attempt-id>
```

要求：

- task id 和 attempt id 必须 sanitize。
- branch 不应包含空格和高风险字符。
- branch 名应确定性生成。
- 如果 branch 已存在，必须 inspect-before-create，验证是否属于当前 attempt；不能静默创建 suffix 产生重复副作用。

base branch 来自 project registry 中已显式确认的 default branch。注册工程时必须检测 remote HEAD 并由用户确认；检测失败不得静默使用 `master`。

## 6. Attempt 与 Workspace

一个 attempt 对应一个主 workspace。

continuation / transient retry：

- 复用 workspace。

重大 rework：

- 可由 Coordinator Agent 决定新建 attempt。
- 新 attempt 创建新 workspace 和新 branch。

merge conflict：

- 可在当前 workspace 中处理。
- 或 future conflict-resolution workflow 使用当前 branch。

如果 workspace 已经 dirty，但变化是预期的，resume preflight 可以继续；如果 dirty 来源不明，应进入 handoff 或 operator review。

## 7. Workspace 状态

建议状态：

```text
planned
creating
ready
dirty
missing
failed
archived
removed
```

daemon reconciliation 会检查：

- workspace path 是否存在。
- repo 是否是 git worktree。
- branch 是否符合记录。
- base remote 是否可访问。
- workflow launcher 是否可用。
- path realpath 是否仍在 workspace root 内。
- artifact root 是否仍在 workspace coordinator 目录内。

## 8. Workspace Lock

同一 workspace 同时只能有一个 active executor。

需要 workspace lock：

- lock owner。
- lock token。
- lease version。
- lease expires at。
- heartbeat。

daemon 可释放过期 lock。

带副作用操作必须携带当前 lock token。lock token 不匹配时拒绝执行，避免 stale owner 写入。

当前已落地的 workspace/lock/fencing recovery 子集：

- daemon 释放过期 workspace lock 前必须先 inspect owner/resource 状态，不能只因为 `expires_at` 到期就静默释放。
- release 必须同时匹配 lock token 和 leaseVersion；leaseVersion 已变化时视为 fencing 生效，不能把本次 tick 误记为成功释放。
- owner 仍有 active outer agent session、active workflow run 或 active workspace operation 时，过期 lock 进入 operator review。
- workspace observation 不安全时，包括 path missing、branch mismatch、dirty unknown、manifest mismatch、path escape 等，不释放 lock，转 operator attention。
- lock token、leaseVersion、ownership manifest 原文和完整 git output 不进入 Coordinator Agent surface 或 agent tool result。

## 9. Agent Provider

第一版支持：

- CodexProvider。
- ClaudeCodeProvider。

长期主路径应采用 SDK-first adapter：

```text
CodexProvider -> @openai/codex-sdk
ClaudeCodeProvider -> @anthropic-ai/claude-agent-sdk
CLI subprocess -> compatibility fallback
```

SDK 仍可能在内部管理本地 CLI 子进程，但 Coordinator 不应直接长期拼接 Codex / Claude Code 的易变命令行参数。AgentProvider adapter 应统一承担 session id、cwd、permission profile、取消、resume、event stream 和版本兼容性。

统一抽象：

```text
startSession
continueSession
stopSession
inspectSession
streamEvents
```

但第一版实现可根据 provider 能力逐步补齐。

当前已落地的 outer Coordinator Agent runtime 是 decision-only：

- provider cwd 固定为 sessionRoot，不指向 project repo 或 workspace repo。
- prompt、surface JSON、surface Markdown、transcript 和 final response 都保存在 `coordinator/sessions/<session-id>/`。
- CodexProvider 使用 read-only sandbox；ClaudeCodeProvider 使用 bare / dontAsk / 空 tools。
- 外层 agent 本轮不能直接执行 repo 写入、不能绕过 Coordinator Surface，也不能替代后续 agent tools executor。

后续 SDK adapter 必须继续保持这些边界：

- outer provider 默认最小权限，cwd 固定 sessionRoot。
- inner provider 才允许在 workspace repo 中运行，并且必须由 workflow/runtime 或明确 Core gate 授权。
- provider raw JSONL、SDK private session 文件、权限内部细节和完整 stdout 不进入 Core 状态机。
- provider event 应分层保存：raw event 写 artifact，normalized event 写 timeline 摘要，Core 只使用极少数 lifecycle signal。
- provider SDK 和底层 CLI 版本需要记录或 pin；版本不兼容时进入 provider unavailable / operator attention，而不是静默降级为危险权限。

## 10. Outer 和 Inner Agent

外层：

- Coordinator Agent。
- 基于 Coordinator Surface 和 tools 决策。
- decision-only session 在 sessionRoot 内运行，复杂上下文通过 prompt/surface artifact 输入。

内层：

- coding agent。
- 在 repo workspace 中使用 `workflow`。
- 处理具体代码工作。
- 会修改 repo 的 inner agent 命令 cwd 必须位于 workspace repo 内。

两层可以使用不同 provider：

```text
outer Codex + inner Claude Code
outer Claude Code + inner Codex
```

## 11. Agent Session 目录

建议外层记录：

```text
coordinator/sessions/<session-id>/
  prompt.md
  surface.json
  transcript.jsonl
  tool-events.jsonl
```

如果 provider 自己有日志路径，也记录引用。

每次 agent session 停止、stalled、handoff 或 retry 前，建议写 checkpoint artifact：

```text
handoff.md
decisions.md
verification.md
remaining-work.md
```

这些 artifact 用于 resume preflight 和后续人工排查。

## 12. Worker Runtime

第一版实现：

- `LocalWorker`

预留：

- `RemoteWorker`

Worker 字段：

- worker id。
- kind。
- host。
- workspace root。
- status。
- capabilities。
- last heartbeat。

第一版即使只本机执行，也不要把 workspace path、agent auth、git auth 全部写死在 core 中。

## 13. Git Provider

`GitProvider` 负责：

- 检测 repo。
- 检测 remote。
- 检测 default branch。
- 创建 worktree。
- fetch。
- sync base branch。
- push branch。
- 检测冲突。
- cleanup worktree。

Coordinator Agent 不直接调用 git 命令。

所有 GitProvider 副作用必须有 operation record 和 idempotency key。

## 14. PR/MR Provider

第一版支持：

- GitHub。
- GitLab。

可以通过 CLI 或 API 实现。

建议优先：

- GitHub: `gh` CLI。
- GitLab: `glab` CLI。

后续可切换 API adapter。

## 15. Merge 前验证

merge 前必须：

1. 确认 human approval snapshot 有效。
2. fetch default branch。
3. 将 default branch 合入或 rebase 到 task branch。
4. 重新运行必要验证。
5. 重新读取 PR/MR head/base/checks。
6. 校验 `pr_id + head_sha + base_sha + validation_run_id + merge_strategy`。
7. 检查冲突。
8. 执行 squash merge。
9. reconcile merge result。

如果冲突：

- 不强行 merge。
- 进入 conflict-resolution workflow。

## 16. Cleanup

cleanup 不应默认立即删除。

建议：

- completed 后标记 archived。
- 保留 workspace 一段时间。
- 可由配置清理。

避免短期排查缺失证据。

## 17. 安全边界

- inner coding agent 或任何会修改 workspace/repo 的 agent 命令 cwd 必须在 workspace repo 内。
- outer Coordinator Agent 的 decision-only provider cwd 必须在 `coordinator/sessions/<session-id>/` 这类 sessionRoot 内，不能获得 repo 写权限；它只能通过 prompt/surface artifact 读取当前可见事实。
- artifact path 必须在 coordinator artifact root 内。
- planning 阶段没有 workspace 时，agent tool 使用 task-local artifact root；workspace ready 后，surface 切换到 attempt workspace artifact root。
- workspace path 必须在 workspace root 内。
- 不允许通过 `../` 逃逸。
- 所有 path 必须做 canonical realpath containment check。
- 不允许 symlink escape。
- agent tool 不允许引用源码目录或 workflow artifact 作为 coordinator tool payload。
- 环境变量应采用 allowlist，避免无意泄露凭据。
- merge 操作必须检查 approval。

## 18. Resume Preflight

恢复 attempt 前必须执行：

1. 读取最近 surface snapshot。
2. 读取 handoff/checkpoint artifact。
3. 检查 workspace realpath。
4. 检查 git status。
5. 检查 branch 与 DB 记录。
6. 检查 workflow protocol status。
7. 如配置了 smoke-check，先运行 smoke-check。

preflight 失败时，不继续执行副作用操作，应进入 human request、retry 或 handoff。

恢复分支：

- workspace 存在但 branch 不匹配：进入 handoff 或 operator review。
- workspace 缺失且允许安全重建：转 retry。
- git status dirty 且非预期：进入 handoff。
- workflow status unknown：重新 inspect，必要时 retry。
- smoke-check 失败：进入 human request 或 handoff。

### 18.1 当前已落地的 Recovery Inspect 子集

`resumeWorkspacePreflight` 仍用于恢复前 operator/daemon 的只读 preflight；Iteration 12.3 另补了更窄的 `inspectWorkspaceRecovery`，专门服务 daemon/Core recovery matrix。

已落地规则：

- 检查 workspace path、repo path、coordinator path、artifact root 时都做 realpath containment。
- path 风险 fail-fast；一旦 workspace/repo/coordinator/artifact root 不安全，不继续执行 git、manifest 或 checkpoint 读取。
- git observation 只收敛为 branch 是否匹配、dirty 是否未知等窄分类，不把完整 git output 作为 agent-facing 内容。
- ownership manifest 只是恢复证据，不是真相源；缺失、字段不匹配或 malformed 都只能生成 observation，不能绕过 DB 状态。
- checkpoint artifact 只作为恢复参考和 artifact ref，不驱动外层业务状态迁移。
- recovery 发现高风险时将 workspace 转为 `blocked`，由 Core/daemon gate 阻止后续 workflow/PR/MR 副作用。
