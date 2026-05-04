## Context

当前 P0 daemon 已能执行最小 `runDaemonTick`：workflow status reconciliation、human request wake-up、candidate task advance、outer agent session 启动、agent tool request 解析执行、stalled watcher 和 retry_due gate。Iteration 12 的第一个 hardening 切片已经补齐 operator-only pause/resume/cancel/retry，并确保 paused/canceled task 不被继续推进。

接下来进入 Slice 12.2。这个切片会触碰 daemon、operation、workflow protocol、agent session、event/observability、task gate 和持久化语义，因此必须持续对齐：`Coordinator Core` 是唯一状态机和策略 gate；daemon 是 runtime driver，不是智能体；workflow handoff 只能来自 workflow protocol；agent surface/tools 不暴露内部 recovery 细节或复杂 JSON。

## Goals / Non-Goals

**Goals:**

- 建立有限的 `Observation -> Core RecoveryDecision -> Daemon Action` 结构，让 daemon 收集事实，Core 产出恢复决策，daemon 只执行受控动作。
- 补齐 operation replay matrix，覆盖 `running`、`failed`、`unknown` operation 的主要恢复场景。
- 补强 workflow run reconciliation，显式处理 protocol unavailable 和 `runId/profile mismatch`。
- 补强 outer agent session stalled/no-progress 恢复，避免同一 task stateVersion 无进展重复启动 provider。
- 统一 paused/canceled/retry_due gate，确保 operator 控制不会被 recovery 路径绕过。
- 增加窄 payload 的 recovery decision event，用于 operator 诊断和审计。
- 增加 failure injection / contract tests，验证恢复动作和 agent surface 不泄漏内部字段。

**Non-Goals:**

- 不新增 agent tools。
- 不引入通用 reconciliation DSL、DAG engine 或多角色 runtime。
- 不实现 workspace/lock/fencing 完整恢复矩阵；仅保留本切片必要的 safe inspect gate。
- 不实现 PR/MR merge 全矩阵或 provider-specific 深度恢复。
- 不实现 remote worker offline/fleet 状态机。
- 不吸收 Multica skills / 能力包；coding 能力继续由 `workflow` 工程承接。

## Decisions

### Decision 1: recovery decision owner 是 Core

设计为：

```text
Daemon observation -> Core recovery service -> RecoveryDecision -> Daemon action
```

原因：daemon 只能是可靠运行时，不能变成业务策略层。Core 持有状态机、CAS、operation/idempotency、retry budget 和 tool/surface policy，因此 Core 才能决定 retry、reconciled、unknown、blocked、operator attention 或 wake agent。

备选方案：把 recovery matrix 写进 daemon tick。拒绝原因是这会让 daemon 拥有隐式状态机，污染 `Coordinator Core` 边界，也会让后续 provider/platform 接入难以审计。

### Decision 2: recovery matrix 以 operation + expected resource + observed external state 为主轴

矩阵不为所有资源新增统一 `running/failed/unknown/stalled` 状态。operation 已有 ledger status；workflow run、agent session、task、workspace 各有自己的状态。Core recovery service 读取：

- operation status / kind / idempotency key / retry metadata。
- 资源当前 DB expected state。
- adapter/protocol/provider 返回的 observed summary。
- paused/canceled/retry_due gate。
- retry budget 和 task stateVersion。

然后产出有限 `RecoveryDecision`。

备选方案：抽象一个通用 resource state machine。拒绝原因是过度设计，也容易把 PR/MR、workspace、workflow、agent session 的差异抹平。

### Decision 3: workflow reconciliation 只消费 protocol truth

workflow run 恢复只调用 workflow protocol `status`，并只用 `lifecycle`、`handoff`、`artifacts`、`recovery`、`summary` 影响外层状态。`stage`、`substate`、`gate`、`allowedActions`、`deniedActions` 只能进入 debug/event payload。

`runId/profile mismatch` 是 protocol consistency violation：Core 标记 recovery decision 为 `operator_attention` 或 `unknown`，不自动重启另一个 workflow run，也不读取 `.workflow` private state 来确认。

备选方案：从 `.workflow` 文件或 stage/substate 推断完成度。拒绝原因是直接违背 workflow protocol 边界。

### Decision 4: paused/canceled 允许 safe inspect，但禁止新副作用

paused/canceled task 上，daemon 可以执行 read-only inspect、写 recovery event、保留 machine observation；不能启动 Coordinator Agent、执行 agent tools、resume workflow action、create/update PR/MR 或 merge。answered human request 对 paused task 不被消费，等待 operator resume 后再进入 agent 可见世界。

原因：operator pause/cancel 是强控制信号，但观察和审计仍然需要继续，尤其是为了判断是否有 orphan operation 或 provider hang。

### Decision 5: recovery event payload 保持窄

新增或复用 event 类型时只记录：

```text
resource_kind
resource_id
operation_id
decision
reason_code
observed_summary
next_action
retry_due_at
operator_attention_required
artifact_refs
```

不记录 provider raw output、secret、完整 operation/lock/session/workflow JSON、lock token 或大型日志。详细诊断如有需要写 artifact 或 operator-only summary，不进入 Coordinator Agent Markdown surface。

### Decision 6: agent surface 不新增内部 recovery tools

本 change 不新增 `reconcile_resource`、`recover_task`、`replay_operation`、`release_lock` 等 agent tools。Coordinator Agent 最多看到摘要、current blocker、recommended next step、allowed/denied tools 和必要 artifact refs。恢复矩阵本身属于 Core/daemon/operator 诊断面。

## Risks / Trade-offs

- [Risk] scope 继续膨胀到 workspace/PR/MR/provider-specific 全矩阵。  
  Mitigation: 本 change 的 tasks 和 specs 只覆盖 operation、workflow run、agent session、paused/canceled/retry_due 和 recovery event；workspace/lock 与 PR/MR 留给后续 Slice 12.3/12.4。

- [Risk] recovery service 成为隐藏的通用 scheduler。  
  Mitigation: 使用有限 typed handler，不引入 DSL，不支持任意 DAG 或 plugin recovery rule。

- [Risk] event payload 为了诊断而过大，间接污染 agent surface。  
  Mitigation: recovery event 只写窄摘要和 artifact refs；测试断言 surface 不泄漏 provider raw、lock token、operation replay 细节。

- [Risk] workflow unavailable 场景被误判为 completed 或 pr_ready。  
  Mitigation: workflow reconciliation tests 覆盖 protocol unavailable 和 runId/profile mismatch，要求进入 unknown/operator attention，不推进完成或 PR readiness。

- [Risk] retry 造成同一 stateVersion 下重复启动 provider。  
  Mitigation: agent session no-progress tests 覆盖 stable requestId / task stateVersion gate 和 retry_due gate。
