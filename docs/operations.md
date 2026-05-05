# Operations 与可靠运行时契约

> 状态：初始运行契约  
> 适用范围：operation ledger、幂等、事务、锁、reconciliation、retry、watchdog、checkpoint、resume。

## 1. 文档定位

本文档记录实现可靠无人值守运行所需的机制。

它不是分布式系统设计文档。

第一版仍坚持：

```text
单进程优先
SQLite 为持久化真相源
有限有序 plan
有限 workflow run 串联
```

这里的 operation、lock、fencing、reconcile 只服务于：

- 进程重启后恢复。
- 避免重复副作用。
- 避免并发重复推进。
- 保证事件可审计。

## 2. 事务边界

以下必须在同一 SQLite transaction 内完成：

- 状态变更。
- state_version 更新。
- event append。
- operation intent 写入。
- lock acquire/release。

外部副作用不能包含在 SQLite transaction 内。

因此执行顺序是：

```text
persist intent -> execute external side effect -> persist observed result -> reconcile if needed
```

## 3. Claim / CAS

daemon 选择任务时必须通过 CAS claim。

基本流程：

```text
read candidate
begin transaction
check state_version and active uniqueness
write lock/claim
append event
commit
start work
```

CAS 失败：

- 不重试同一快照。
- 重新读取状态。
- 生成新 surface 或跳过本 tick。

## 4. Operation Ledger

每个副作用动作都必须有 operation record。

副作用包括：

- create workspace。
- create git worktree。
- create branch。
- start workflow run。
- start agent session。
- create PR/MR。
- update PR/MR。
- request merge approval。
- merge。

### 4.1 Replay Semantics

每类 operation 都必须能根据外部状态决定重放方式。

| Operation status | Observed external state | Recovery |
| --- | --- | --- |
| planned | no external side effect | start operation |
| running | external absent | retry if within budget |
| running | external exists and matches intent | mark succeeded or reconciled |
| running | external exists but conflicts with intent | mark unknown and handoff |
| failed | no external side effect | retry if retryable |
| failed | external exists | reconcile before retry |
| unknown | external unclear | inspect again, then handoff or retry |
| reconciled | external matches DB | no-op |

### 4.2 当前已落地的 Replay 子集

Iteration 12.2 已在 Core recovery service 中落地 daemon operation replay 的有限矩阵：

- daemon 只处理 `daemon:*` operation replay；其他 provider/workflow/PR/MR operation 的更深恢复留给对应后续切片。
- 候选 operation 在 DB 层先过滤 `daemon:*` 和未持久化 recovery decision，再按时间顺序 `LIMIT`，避免已处理 operation 或其他 kind operation 阻塞未处理 recovery。
- `matches-intent` 会把 operation 标记为 `reconciled`。
- `absent` 会按 retry budget 安排 retry；预算不足时进入 operator attention。
- `conflicts-with-intent` 进入 `unknown` / operator attention，不自动覆盖外部状态。
- `unknown` operation 会先做 read-only inspect，再根据 observation 决定下一步。

Recovery decision event 与相关 operation 状态变化必须同 transaction 提交；外部 inspect/action 仍不在 SQLite transaction 内执行。

## 5. Idempotency Key

idempotency key 必须稳定。

示例：

```text
workspace:create:<attempt-id>
branch:create:<attempt-id>
workflow:start:<attempt-id>:<step-id>:<profile>
pr:create:<attempt-id>:<branch>
merge:<pr-id>:<head-sha>:<base-sha>:<validation-run-id>
```

同一 key 的 non-terminal operation 不允许重复创建。

## 6. Inspect-before-create

执行副作用前必须检查外部状态。

示例：

- branch 已存在：验证是否属于当前 attempt。
- PR 已存在：复用并记录 external id。
- workflow run 已存在：通过 protocol inspect。
- workspace 已存在：做 containment 和 git worktree 校验。

## 7. Lock / Lease / Fencing

第一版至少支持：

- task lock。
- attempt lock。
- workspace lock。
- project branch lock。
- PR merge lock。

字段：

```text
lock_id
owner
lock_token
lease_version
expires_at
heartbeat_at
```

任何带副作用操作必须携带当前 lock token。

过期 lock 可由 daemon reconcile 后释放。

merge 本身是单飞操作。即使 approval 已存在，也必须先 claim PR merge lock，再执行 merge，再 reconcile。两个并发 tick 不能同时通过同一 approval 进入 merge。

### 7.1 当前已落地的 Workspace Lock / Fencing 子集

Iteration 12.3 已落地本地 workspace lock 的 recovery hardening：

- expired workspace lock 只能通过 daemon/Core recovery path 释放，且必须先 inspect owner/resource。
- Core 只在 owner inactive 且 workspace observation 安全时返回 `release_expired_lock`。
- release 使用 `lockToken + leaseVersion`，并与 recovery event 同 transaction 提交。
- leaseVersion 已变化、owner active、resource unsafe、非 workspace lock 或缺少 workspace observation 时，不释放 lock，进入 operator attention 或 no-op。
- stale token 执行 workspace 更新会被 DB fencing 拒绝。
- recovery event payload 保持窄字段，不包含 lock token、完整 operation 对象、ownership manifest 原文或完整 git output。

## 8. Reconciliation Invariant Matrix

每类资源应有对账矩阵。

### 8.1 Workspace

| DB expected | Observed | Action |
| --- | --- | --- |
| ready | path missing | mark workspace missing, ask human unless safe recreate |
| ready | branch mismatch | block and request operator review |
| creating | path exists valid | mark ready |
| creating | path exists invalid | fail operation and block |

当前已落地子集：

- active workspace recovery inspect 覆盖 workspace path、repo path、coordinator path、artifact root、git worktree、branch、dirty、ownership manifest、checkpoint artifact。
- path/realpath/artifact root 风险 fail-fast，避免在不可信路径上继续执行 git 或读取 manifest/checkpoint。
- `safe` observation 保持 no-op；`missing`、`branch_mismatch`、`dirty_unknown`、`manifest_mismatch`、`path_escape` 等风险进入 operator attention。
- operator attention 会把 workspace 标记为 `blocked`，并通过 surface gate 阻止 workflow running/handoff、`create_pr`、`start_workflow_run` 等后续副作用窗口。
- malformed ownership manifest 只产生 `manifest_mismatch` observation，不应中断 tick。

### 8.2 Workflow Run

| DB expected | Observed | Action |
| --- | --- | --- |
| running | protocol running | keep |
| running | protocol handoff | persist handoff, wake agent |
| running | protocol failed | retry or handoff by error kind |
| running | protocol unavailable | mark unknown, retry inspect |

### 8.3 PR/MR

| DB expected | Observed | Action |
| --- | --- | --- |
| open | open same head | keep |
| open | head changed | invalidate merge approval |
| open | closed unmerged | ask human or mark handoff |
| merging | merged | mark merged and continue done |
| merging | conflict | block, start conflict path |

### 8.4 HumanRequest

| DB expected | Observed | Action |
| --- | --- | --- |
| waiting | unanswered | keep waiting |
| waiting | answered | mark answered, wake agent |
| answered | not consumed | wake agent |
| answered | superseded | do not wake old request |

### 8.5 Merge Approval

| DB expected | Observed | Action |
| --- | --- | --- |
| approved snapshot | PR snapshot unchanged | merge allowed |
| approved snapshot | head/base/checks changed | invalidate approval |
| merge running | merged | reconcile completed |
| merge running | failed | inspect reason and block/retry |

## 9. Retry Budget

Retry 必须有预算。

建议维度：

- error kind。
- operation kind。
- attempt。
- wall-clock。

默认：

- transient provider/network：可重试。
- auth missing：不可自动重试。
- approval required：不可自动重试。
- workspace data-loss risk：不可自动重试。
- merge conflict：不可自动重试，进入 conflict path。

预算耗尽：

- 进入 handoff 或 failed。
- 生成 human request 或 operator alert。

## 10. Watchdog

watchdog 监控：

- provider process。
- agent session。
- workflow status。
- tool command。
- git/PR command。

每类命令必须有 timeout。

stalled 处理：

```text
inspect -> graceful stop -> kill process group -> reconcile -> retry/handoff
```

## 11. Process 管理

对本地 provider：

- 记录 pid。
- 记录 process group。
- stop 先 graceful。
- 超时后 kill process group。
- daemon 启动时清理 orphan。

## 12. Resume Preflight

每次恢复 attempt 前必须执行 preflight：

1. 读取 last surface snapshot。
2. 读取 handoff / checkpoint artifact。
3. 检查 workspace realpath。
4. 检查 git status。
5. 检查 branch 与 DB 记录。
6. 检查 workflow protocol status。
7. 运行配置的 smoke-check，如果有。

preflight 失败时，不直接继续执行。

preflight 失败后，必须根据失败类型决定后续：

- workspace 存在但 branch 不匹配：进入 handoff 或 operator review。
- workspace 缺失且允许安全重建：转 retry。
- git status dirty 且非预期：进入 handoff。
- workflow status unknown：重新 inspect，必要时 retry。
- smoke-check 失败：进入 human request 或 handoff。

## 13. Checkpoint Artifacts

推荐 artifact：

```text
handoff.md
decisions.md
verification.md
remaining-work.md
validation-report.md
```

这些 artifact 不要求每次全量生成。

但在以下场景建议生成：

- session 停止。
- human request。
- review feedback。
- retry 前。
- handoff。
- merge 前。

## 14. Event 因果链

关键 event 应包含：

```text
tick_id
operation_id
transition_id
lock_token
external_request_id
severity
```

状态变更 event 应保存：

- changed fields diff。
- 或 state snapshot artifact ref。

避免把完整 state 大对象塞进每条 event。

## 15. Failure Injection Tests

第一版应逐步覆盖：

- crash after side effect before event。
- crash before side effect after intent。
- double scheduler tick。
- stale lock takeover。
- provider hang。
- PR already exists。
- approval invalidation。
- workspace symlink escape。
- merge race。
