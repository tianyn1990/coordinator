## Why

`Iteration 12.2` 已把 daemon 恢复路径收敛为 `Observation -> Core RecoveryDecision -> Daemon Action`。下一步需要把同样的恢复心智落到 workspace、branch、artifact root、ownership manifest 与 lock/lease/fencing 上，避免进程重启、lock 过期、workspace 损坏或路径风险时被静默接管并继续产生副作用。

## What Changes

- 补齐 workspace/lock/fencing 的 Core-owned reconciliation 能力：daemon 只收集观察和执行 Core 允许的动作，不在 daemon 内直接决定释放 lock、接管 workspace 或继续副作用。
- 对 workspace path missing、repo missing、branch mismatch、dirty unknown、manifest mismatch、artifact root escape、symlink/realpath 风险形成有限恢复矩阵。
- 对 expired lock 增加 inspect-before-release 规则：先观察 owner/resource 状态，再由 Core 基于 CAS、leaseVersion、lock token fencing 决定 release、renew、block 或 operator attention。
- 拒绝 stale lock token 执行副作用，避免旧 owner 在 lock 已续租或被接管后继续写入。
- 记录窄 payload 的 recovery decision event，给 operator timeline 和 Web 调试视图使用；不把 lock token、完整 manifest、完整 git output 或 operation 大对象暴露给 Coordinator Agent。

## Capabilities

### New Capabilities

- `workspace-lock-fencing-reconciliation`: 定义 workspace、branch、artifact root、ownership manifest 和 lock/lease/fencing 的恢复矩阵。

### Modified Capabilities

- `workspace-manager`: 增加 workspace 恢复前只读 inspect、manifest/branch/dirty/path 风险分类、stale lock token fencing 的要求。
- `daemon-recovery-matrix`: 增加 workspace/lock observation 到 Core recovery decision 的恢复路径要求。
- `daemon-runtime`: 增加 daemon 对 workspace/lock/fencing 观察和执行 Core action 的要求。
- `core-data-model`: 增加 lock lease/fencing 与 workspace recovery decision 事件的持久化要求。
- `coordinator-surface`: 明确 workspace/lock/fencing recovery 不新增 agent tool，不泄漏 lock/lease 内部字段。

## Impact

- 主要影响 `packages/core` 的 workspace manager、daemon runtime、recovery decision 和相关测试。
- 可能影响 `packages/db` 的 repository 查询/更新能力，但不引入新的外部依赖。
- CLI/API/Web 的 operator-only 调试面可显示恢复摘要；Coordinator Surface 的 agent-facing 面不新增工具、不暴露内部 lock/lease 字段。
- OpenSpec 正式规格将在归档时同步到相关 specs。
