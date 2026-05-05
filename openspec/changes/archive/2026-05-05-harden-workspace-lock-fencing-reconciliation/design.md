## Context

当前系统已有 `Workspace Manager`、SQLite lock/lease/fencing 基础、`resumeWorkspacePreflight`、最小 daemon tick，以及 `Iteration 12.2` 落地的 Core-owned `RecoveryDecision`。但 workspace 与 lock 的恢复语义仍主要分散在 workspace preflight 和底层 lock acquire 中：过期 lock 可被底层 `acquireLock` 接管，daemon 还没有一个明确的 workspace/lock/fencing 恢复矩阵。

本轮必须对齐既有设计心智：

- `Coordinator Core` 是唯一状态机和恢复策略校验者。
- daemon 只是 runtime driver，只能收集 observation 并执行 Core 允许的 action。
- `workflow` private state 不可读写。
- Coordinator Agent 不直接看 lock token、leaseVersion、manifest 原文、完整 git output 或复杂 recovery JSON。
- 复杂诊断信息给 operator 或 artifact，agent-facing surface 只保留窄摘要。

## Goals / Non-Goals

**Goals:**

- 建立 workspace/lock/fencing 的有限 `Observation -> Core RecoveryDecision -> Daemon Action` 路径。
- 将 workspace path、repo、branch、dirty、artifact root、ownership manifest 风险分类为 `ok`、`missing`、`mismatch`、`dirty_unknown`、`path_escape`、`manifest_mismatch` 等窄 observation。
- 对 expired lock 实现 inspect-before-release：先确认 resource/owner 状态，再由 Core 决定 `release_expired_lock`、`renew_lock`、`operator_review` 或 `block`。
- 所有 stale token 副作用继续由 DB `assertLockHeld` 和 Core runtime 的 lock 参数拒绝。
- 写入窄 payload 的 `daemon.recovery_decision`，用于 operator timeline；不扩大 Coordinator Agent surface。

**Non-Goals:**

- 不实现 remote worker fleet 状态机。
- 不引入分布式 consensus 或通用 lock manager。
- 不改变现有底层 `acquireLock` 的基本 lease 能力；本轮是在 daemon/Core 恢复路径中避免静默接管。
- 不新增 Coordinator Agent tools。
- 不读取 `.workflow` private state。
- 不实现 workspace cleanup/delete 或自动重建 workspace。

## Decisions

1. **Core 新增 workspace/lock recovery decision，而不是把策略写进 daemon。**

   daemon 可以调用只读 inspect，得到 workspace/lock observation。Core 根据 observation 返回有限 decision。这样延续 `Iteration 12.2` 的恢复心智，避免 daemon 直接成为第二个状态机。

2. **workspace inspect 返回窄分类，不返回完整 git output 或 manifest。**

   preflight 可以继续生成 markdown 和 checks；新增 recovery inspect 使用更机器化但仍收窄的 observation。branch mismatch、dirty unknown、manifest mismatch、path escape 都只暴露摘要、reason code 和 artifact refs。

3. **expired lock 不在 daemon 中直接 `releaseLock`，必须先通过 Core decision。**

   底层 DB 仍保留 expired lock 可被 acquire 的能力，用于显式 Core runtime 持锁路径。但 daemon recovery 不做静默接管：它先观察 lock 是否 expired、resource 是否安全、owner 是否仍活跃，再按 decision release 或 operator review。

4. **fencing 继续以 lock token + leaseVersion + CAS 为核心。**

   带副作用 runtime 已通过 `assertLockHeld` 验证 token。本轮补充 stale token 回归测试和 recovery 决策事件，不把 token 暴露给 agent 或 event payload。

5. **operator-only 可观测性增强，但 agent-facing surface 不扩张。**

   `daemon.recovery_decision` event 能被 Web/operator timeline 看到，但 Coordinator Surface 仍只展示 current blocker、recovery 摘要和 allowed/denied tools；不新增 `release_lock`、`recover_workspace` 之类 agent tool。

## Risks / Trade-offs

- **Risk: 恢复矩阵过宽导致过度设计。** → 本轮只覆盖本地 workspace 与 SQLite lock，不引入 remote worker 或通用 resource DSL。
- **Risk: 自动释放 expired lock 误伤仍在运行的 owner。** → release 前必须 inspect owner/resource；只在 owner 无 active session/workflow/operation 且 resource observation 安全时释放，否则 operator review。
- **Risk: 诊断信息泄漏到 agent surface。** → recovery event payload 做窄化；测试断言不含 lock token、完整 manifest、完整 git output 或 operation 大对象。
- **Risk: workspace dirty 可能是预期变更。** → dirty unknown 不自动清理或覆盖，进入 operator attention；未来可通过 workflow/attempt evidence artifact 精细化。

## Migration Plan

- 无数据库 migration 预期；复用现有 locks、workspaces、operations、events。
- 新增 Core recovery 类型、workspace inspect 函数、daemon tick 调用路径和测试。
- 归档 OpenSpec change 后同步正式 specs 与 docs 已落地事实。

## Open Questions

当前没有需要用户确认的设计冲突。本轮所有实现都在既有 `docs/` 边界内完成。
