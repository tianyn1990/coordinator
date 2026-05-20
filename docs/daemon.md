# Daemon 与可靠运行时

> 状态：初始方案基线  
> 适用范围：`coordinator` 的长运行 daemon、调度、探活、reconciliation、retry、中断恢复、人类介入唤醒。

## 1. 文档定位

`coordinator` 的目标是向无人值守自动运行演进。

因此第一版就必须有 daemon。

daemon 不是智能体，不负责业务语义判断。它是可靠运行时，负责：

- 发现可推进任务。
- 唤醒 Coordinator Agent。
- 监控 agent session。
- 监控 workflow run。
- 处理 stalled / failed。
- 等待和恢复 human request。
- 进程重启后恢复。
- 控制并发。
- 记录事件。

这一点吸收 Symphony 的核心经验：长运行服务必须有单一 orchestrator state、reconciliation、retry、bounded concurrency 和 workspace isolation。

daemon 的所有关键动作必须满足 [operations.md](./operations.md) 与 [contracts.md](./contracts.md) 的事务、幂等、CAS、lock 和唯一性约束。

### 1.1 当前已落地的 P0 子集

Iteration 9 已落地最小 `runDaemonTick`：

- 以 SQLite 为真相源执行单次 tick。
- 扫描 active workflow run，并通过 workflow protocol `status` 做 reconciliation。
- 扫描 answered human request，唤醒 task 并继续交给 Coordinator Agent。
- 基于当前 Coordinator Surface 启动 outer Coordinator Agent session。
- 从 agent final response 中解析最多一个窄格式 `coordinator-tool` 请求，并仍通过 agent tools executor 校验当前 surface 可见性。
- 从 agent final response 中解析 `coordinator-artifact` block，由 Core 受控写入当前 surface `artifact_root`，解决 read-only outer provider 无法直接写 artifact 的问题。
- 对 active outer agent session 做最小 stalled watcher，超时后记录 stalled event 并安排 retry。
- 对 `resuming` task 使用 `daemon.retry_scheduled` 的 dueAt 做最小 retry_due gate。
- 提供 CLI/API operator-only `daemon tick` 入口；这些入口不进入 Coordinator Surface。

当前 P0 子集仍保持 daemon 不是 agent：daemon 不判断需求、方案、review 结论或 workflow profile 语义，也不把 `default/auto` 解释成具体 profile；它只负责唤醒、reconcile、retry、事件记录和调用已存在 Core service。

#### 1.1.1 Running workflow inspect-only 边界

当 workflow run 仍处于 running / active 且尚未产生 handoff 时，daemon 的职责是持续通过 `workflow protocol status` 做只读 inspect/reconcile，并记录 workflow status、handoff、recovery 等观察结果。

即使 workflow status 中包含 `allowedActions`、`actionInputHints`、stage、substate 或 gate，daemon 也不得据此主动调用 `workflow protocol action`。这些字段只服务 operator/debug 展示和审计排查；是否执行 workflow 内部 action 仍属于 workflow runtime/operator debug 边界，不是 daemon 自动推进职责。

这一约束的上层语义是：

```text
daemon 是巡检与恢复运行时，不是 workflow 内部执行者。
running workflow 的下一步由 workflow protocol 和 handoff 表达，coordinator 不越过 handoff 猜测内部进度。
```

### 1.2 当前已落地的 recovery hardening 子集

Iteration 12.2 已补齐 daemon/Core recovery matrix 的第一层实现：

- daemon 只收集 observation，并通过 Core recovery service 获取 `RecoveryDecision`。
- operation replay 已覆盖 `running`、`failed`、`unknown` operation 的主要恢复分支。
- active workflow run reconciliation 只通过 workflow protocol `status`，`runId/profile mismatch` 进入 protocol consistency violation，不读取 `.workflow` private state。
- active outer agent session stalled/no-progress 会先 inspect，再按 retry budget、task gate 和 stateVersion 约束决定是否重试或停止 session。
- paused/canceled/waiting task 只允许 safe inspect 和 recovery event，不启动 Coordinator Agent 或外部 mutation。
- recovery decision 以窄 payload 写入 append-only event，供 operator timeline 和审计排查使用。

Iteration 12.3 已继续补齐 workspace/lock/fencing recovery 子集：

- daemon 扫描 active workspace 时只做 read-only inspect，并将 workspace observation 交给 Core recovery service。
- workspace path、repo path、coordinator path、artifact root 风险继续 fail-fast；path 风险后不继续 git、ownership manifest 或 checkpoint 检查。
- branch mismatch、dirty unknown、manifest mismatch、path escape、workspace missing 等风险由 Core 判定为 operator attention，daemon 只负责写 recovery event 和执行 Core 允许的 workspace status 更新。
- malformed ownership manifest 收敛为 `manifest_mismatch`，不能中断整个 daemon tick。
- expired lock 释放必须先 inspect owner/resource，再由 Core 决定是否 `release_expired_lock`；daemon 不静默接管 lock。
- workspace lock release 必须同时校验 lock token 和 leaseVersion，避免 stale owner 在 lease 已变化后继续写入或误报 recovery 成功。
- owner active 判断至少包含 active outer agent session、active workflow run 和 active workspace operation；任一仍活跃时进入 operator attention。
- workspace recovery 进入 operator attention 后会把 workspace 标记为 `blocked`，并阻止同一 tick 继续唤醒 Coordinator Agent 或执行后续副作用。

当前实现仍是 P1 hardening 子集，不代表 PR/MR merge、remote worker 的完整恢复矩阵已经完成。

Iteration 12.4 已继续补齐 PR/MR 与 merge recovery 子集：

- PR/MR provider 只返回有限 external fact，Core 负责解释 external state、approval invalidation、merge readiness 和 recovery decision。
- create PR 继续 inspect-before-create；匹配当前 intent 的外部 PR/MR 可 reconcile，冲突 intent 不继续 create。
- inspect review、merge 前 inspect 和 recovery inspect 会刷新 PR/MR snapshot，并在 head/base/validation/review/strategy 不匹配时失效旧 pending/approved approval。
- provider failure 被分类为 timeout、rate_limited、auth_missing、conflict、malformed_output 或 unknown；auth_missing/conflict 等高风险失败进入 operator attention，不自动重试。
- merge race 可通过 read-only inspect 观察到 already merged 后 reconcile；merge conflict 不自动绕过，进入 operator attention 或 future conflict-resolution path。
- failed/unknown merge operation 写入 recovery decision 摘要，避免 daemon 在后续 tick 中无边界反复重放。
- expired `pr-merge` lock 也通过 Core-owned lock recovery decision 处理，并使用 `lockToken + leaseVersion` 在同一 transaction 中释放和写 recovery event。
- PR/MR recovery 不新增 Coordinator Agent recovery tool，不把 provider raw output、完整 operation、完整 approval object、lock token 或复杂 JSON 暴露到 agent-facing surface。

## 2. Daemon 职责

daemon 负责：

- scheduler loop。
- watchdog loop。
- reconciliation loop。
- retry loop。
- human request loop。
- agent session monitor。
- workflow run monitor。
- PR/MR status monitor。
- merge monitor。
- event flush。

daemon 不负责：

- 需求理解。
- 技术方案判断。
- review 结论判断。
- workflow profile 语义选择。
- 把 human explicit selection 之外的 profile 写入 workflow start 请求。
- 根据 workflow allowedActions / actionInputHints 主动执行 workflow action。
- 直接修改代码。
- 绕过 Coordinator Agent 执行高层策略。

## 3. Runtime State

第一版使用 SQLite 作为持久化状态源。

daemon 内存状态只能是缓存，不是唯一真相。

进程重启后，daemon 必须能从 SQLite 恢复：

- active tasks。
- active attempts。
- running agent sessions。
- running workflow runs。
- pending human requests。
- pending retries。
- pending PR/MR review。
- pending merge approvals。

## 4. Loop 类型

### 4.1 Scheduler Loop

职责：

- 找到 `queued` / `ready_to_continue` / `human_answered` / `retry_due` 的任务。
- 检查 concurrency limit。
- 构建 Coordinator Surface。
- 启动或继续 Coordinator Agent。

基本规则：

- 同一 task 同一时间只能有一个 active Coordinator Agent decision loop。
- 同一 attempt 同一时间只能有一个 active inner workflow execution，除非未来明确支持并行子任务。

### 4.2 Watchdog Loop

职责：

- 检查 agent session 是否 stalled。
- 检查 workflow run 是否长时间无状态变化。
- 检查 workspace 是否丢失。
- 检查 provider process 是否退出。
- 检查 process group 是否仍存活。
- 检查 lock token 是否仍有效。

stalled 不等于立刻失败。

处理顺序：

1. inspect。
2. resume / continue。
3. retry。
4. ask human。
5. handoff / failed。

stall 后先 graceful stop，超时后 kill process group，再做 reconcile。

`idle`、`waiting_human`、`waiting_review`、`waiting_merge_approval` 不应被误判为 `stalled`。`stalled` 必须同时参考 session heartbeat、process liveness、tool timeout 与外部状态变化。

### 4.3 Reconciliation Loop

职责：

- 对数据库状态与外部实际状态做对账。

对账对象：

- git workspace。
- git branch。
- workflow protocol status。
- agent provider session status。
- PR/MR provider status。
- human request status。

如果外部状态不可用：

- 不直接猜测完成。
- 标记 `needs_reconcile`。
- 生成可见 failure/recovery surface。
- 必要时把实体状态降级为 `unknown`，但不允许凭空推进到 completed。

### 4.4 Retry Loop

职责：

- 执行 due retry。
- 应用 retry policy。
- 记录 attempt retry event。

retry 应区分：

- continuation retry。
- transient provider failure。
- workflow blocked。
- workspace failure。
- human timeout。

retry 必须有预算。
连续同类错误达到预算后，不再自动重试，转 handoff 或 human request。

默认退避策略：

```text
10s, 30s, 60s, 120s, 300s cap
```

具体值可配置。

daemon 不负责无上限重试。

### 4.5 Human Request Loop

职责：

- 发现已回答 human request。
- 生成新的 Coordinator Surface。
- 唤醒 Coordinator Agent。

等待人类时：

- task 不算 failed。
- attempt 不算 stalled。
- agent session 可以停止。
- daemon 保持可恢复状态。

HumanRequest 生命周期见 [contracts.md](./contracts.md)。

### 4.6 PR/MR Monitor

职责：

- 检查 PR/MR 是否 ready。
- 检查 review 是否有新反馈。
- 检查 merge approval 是否已给出。
- 检查 merge 是否成功。

第一版 review 可先来自 Web/CLI。GitHub/GitLab review 接入后复用同一状态。

merge approval 必须绑定 `pr_id + head_sha + base_sha + validation_run_id + merge_strategy` snapshot；PR head/base/checks 变化后审批失效。

## 5. 状态机

### 5.1 Task Status

建议状态：

```text
queued
planning
running
waiting_human
waiting_review
waiting_merge_approval
merging
completed
handoff
canceled
failed
```

### 5.2 Attempt Status

```text
created
workspace_ready
running
waiting_human
waiting_review
waiting_merge
completed
failed
canceled
```

### 5.3 Agent Session Status

```text
starting
running
idle
stalled
completed
failed
stopped
```

### 5.4 Workflow Run Status

来自 workflow protocol，但 coordinator 可维护外层归一化：

```text
starting
running
blocked
handoff_available
completed
failed
unknown
```

具体 handoff 语义必须读取 workflow protocol 的 `handoff.kind`，daemon 不把 workflow 私有 stage/substate 映射成外层状态。

## 6. Concurrency

第一版至少支持：

- 全局最大 active tasks。
- 每 project 最大 active tasks。
- 每 worker 最大 active sessions。
- 每 provider 最大 sessions。

默认保守：

```text
global max active tasks: 2
per project max active tasks: 1
```

避免多个任务同时修改同一工程造成冲突。

## 7. Retry Policy

### 7.1 可重试

可重试情况：

- agent provider transient failure。
- process crashed。
- workflow protocol read timeout。
- network transient。
- PR/MR provider temporary unavailable。
- daemon restart 后 session 状态 unknown。

### 7.2 不直接重试

不直接重试：

- human approval required。
- requirements unclear。
- scope change。
- merge approval required。
- destructive operation approval required。
- auth missing。
- workspace missing with data loss risk。

这些应生成 human request 或 handoff。

### 7.3 Retry Event

每次 retry 记录：

- retry reason。
- attempt。
- due time。
- previous error。
- selected recovery action。

## 8. Stalled Detection

stalled 规则应基于多信号：

- agent session 无事件超过阈值。
- workflow run 无 stage/gate 变化超过阈值。
- provider process exited。
- tool call 长时间未返回。
- workspace lock 长时间占用。

不同状态阈值不同：

- 正常 agent 执行：较长。
- tool call：较短。
- human waiting：不触发 stalled。
- review waiting：不触发 stalled。
- merge waiting：不触发 stalled。

## 9. Locks

需要 lock 防止重复推进。

建议 lock 粒度：

- task lock。
- attempt lock。
- workspace lock。
- project branch lock。

lock 必须有 lease / heartbeat。

daemon restart 后可通过 reconciliation 释放过期 lock。

### 9.1 Idle / Stalled Boundary

- `idle` 表示当前没有主动执行动作，但状态是预期的。
- `stalled` 表示本该有动作或心跳，但长时间没有进展。
- `waiting_human`、`waiting_review`、`waiting_merge_approval` 是预期阻塞态，不应仅因无活动而进入 stalled。

## 10. 启动恢复

daemon 启动时：

1. 打开 SQLite。
2. 加载 config。
3. 扫描 active tasks。
4. 对每个 active attempt 做 reconciliation。
5. 恢复 pending human request。
6. 恢复 due retry。
7. 对 running agent session 标记 unknown 并 inspect。
8. 对 workflow run 调 protocol status。
9. 根据结果重新进入 scheduler。

恢复分支：

- workspace 存在但 branch 不匹配：转 operator review 或 handoff。
- workspace 丢失但可安全重建：转 retry。
- workflow status unknown：重新 inspect，必要时转 handoff。
- provider 进程挂死：先 stop 再 reconcile，再决定 retry 或 handoff。
- human request 已回答：唤醒 Coordinator Agent。

## 11. Human Request 是一等状态

等待人类不是异常。

human request 应包含：

- kind。
- question artifact。
- status。
- answer artifact。
- created by。
- requested at。
- answered at。
- linked task / attempt / step。

人类回答后不直接改变业务状态。daemon 唤醒 Coordinator Agent，由 agent 消化回答并选择下一步。

## 12. Merge Approval 是强 gate

merge 必须有显式 approval。

即使 autonomy 为 aggressive：

- 也不能自动 merge。
- 只能自动准备 merge request。
- 只能请求 approval。

approval 后 merge 前仍必须：

- sync base branch。
- rerun required validation。
- inspect conflicts。

## 13. Remote Worker 预留

第一版实现 `LocalWorker`。

但数据模型和 daemon 不应写死本机。

预留字段：

- worker id。
- worker kind。
- host。
- workspace root。
- provider availability。
- last heartbeat。

remote worker 预留仅为未来扩展，不应把第一版实现提前扩成分布式系统。

未来 `RemoteWorker` 应遵守同样 daemon/reconciliation 语义。

## 14. Daemon 可观测性

daemon 必须记录：

- tick started / ended。
- task selected。
- lock acquired / released。
- lock token / lease version。
- agent session started / stopped。
- workflow status inspected。
- retry scheduled / executed。
- human request waiting / answered。
- PR/MR inspected。
- merge attempted / succeeded / failed。
- operation intent / result。

## 15. 第一版完成标准

- daemon 可启动。
- SQLite 中 active task 可恢复。
- agent session stalled 可被发现。
- human request answered 后可唤醒。
- workflow protocol status 可定期 reconcile。
- retry policy 可执行。
- merge approval gate 不可绕过。
- Web UI 可展示 daemon 当前判断。
- claim/CAS/lock/idempotency 的故障注入测试通过。
