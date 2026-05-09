# Design: reconcile workflow action operations

## Context

`workflow:action` 是 coordinator 通过 workflow protocol 触发的真实外部副作用。它与 `workflow:start` 类似，必须 operation-first：先持久化 intent，再执行 protocol action，再把观察结果写回 SQLite。

当 protocol action 进入 side effect window 后失败，operation 状态会变成 `unknown`。此时 coordinator 不能直接重放 action，因为外部 workflow run 可能已经部分推进；也不能读取 `.workflow` private state 来判断结果。唯一可信路径是通过 workflow protocol `status --run <run-id>` 做 read-only inspect。

## Decision

新增一个 daemon 内部 reconciliation path，专门处理 `workflow:action` operation：

```text
workflow:action operation
  -> locate DB workflow_run by operation externalId/attempt/task
  -> workflow protocol status --run <external run id>
  -> Core recovery decision
  -> persist operation reconciled / unknown + event
```

### Operation Selection

扫描条件：

- `kind = workflow:action`
- `status IN (running, failed, unknown)`
- `lastObservedState` 尚未包含 recovery decision

这条路径应独立于 `daemon:*` operation replay，避免把 provider/action 的恢复语义塞进通用 daemon operation replay 的 `lastObservedState` 启发式中。

### Observation

daemon 通过现有 `inspectWorkflowRun`/workflow adapter 路径执行 inspect。这样可以复用：

- workflow launcher 配置解析
- workspace repo cwd
- protocol JSON parsing
- runId/profile consistency check
- `persistWorkflowStatus`

daemon 不直接读取 workspace 下的 `.workflow` 文件。

### Recovery Decision

inspect 成功且 workflow protocol 与 DB run 一致时：

- Core decision 可视为 `reconciled`
- 旧 `workflow:action` operation 标记为 `reconciled`
- event payload 只记录窄摘要：operation id、workflow run id、decision、reason code、observed summary

inspect 失败或一致性冲突时：

- 旧 operation 保持/标记为 `unknown`
- 写入 `daemon.recovery_decision`
- 写入 workflow action operation reconcile failed event
- 不把 workflow run 推进到 completed/handoff/pr_ready

### Retry Semantics

旧 action operation 被标记为 `reconciled` 只表示“这次不确定副作用已经通过 read-only inspect 对账封口”，不表示可以用旧 state_version 原样重放 action。

后续调用应基于最新 workflow run state_version 重新生成 action intent。这样新的 idempotency key 会包含新的 state_version，符合既有 CAS/idempotency 语义。

## Risks

- **Risk: inspect 成功但 action 实际未达到调用方期待。**  
  Mitigation: coordinator 只相信 workflow protocol status/handoff，不自行判断 action 语义；如果 workflow 仍 active，后续 surface 会继续暴露 inspect/resume 路径。

- **Risk: 将 `reconciled` 误解为 action succeeded。**  
  Mitigation: event summary 和 tests 明确 `reconciled` 是 operation 封口，不代表业务完成；completed/pr_ready 仍只来自 workflow status/handoff。

- **Risk: daemon 泄漏内部 workflow/provider raw output。**  
  Mitigation: 复用 recovery decision 窄 payload，测试断言不包含 raw output、lock token、完整 operation JSON。
