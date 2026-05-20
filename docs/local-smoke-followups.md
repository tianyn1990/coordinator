# 本地实测后续优化记录

> 状态：暂存观察  
> 适用范围：本地 smoke / operator 联调中发现的非阻塞体验和可靠性优化点。

本文件用于记录真实本地流程中暴露出的后续优化事项。这里的条目不是已确认设计变更；进入实现前仍需对齐 `docs/AGENTS.md` 及对应专题文档。

## 1. Outer Agent 重复写入 execution plan artifact

### 现象

在真实 outer Codex Agent + daemon tick 流程中，任务已经完成 `write_execution_plan` 并进入 `planning` 后，后续 agent session 在请求 `create_attempt` 时仍再次输出了 `coordinator-artifact`，覆盖写入 `execution-plan.md`。

### 当前影响

- 该行为未越权，因为 artifact 仍由 daemon 解析后交给 Core 受控写入。
- 不阻塞流程，`create_attempt` 仍成功执行。
- 但 timeline 中会多出一次 `daemon.agent_artifact_written`，并且 execution plan artifact 可能被非必要改写，影响排查时对“原始计划”的理解。

### 候选优化方向

- 在 outer agent prompt 中明确：只有当当前工具确实需要 artifact，或计划需要修订时，才输出 `coordinator-artifact`。
- 对 `create_attempt`、`create_workspace`、`start_workflow_run` 等不需要 artifact 的工具，在 daemon 侧记录“额外 artifact 写入”调试事件，供 operator 识别。
- 若后续认为覆盖计划风险较高，可为 execution plan artifact 增加更明确的 revise 语义，避免普通推进步骤隐式覆盖已有计划。

## 2. Daemon requestId 与 task stateVersion 推进粒度不匹配

### 现象

`create_attempt` 成功后再次执行 daemon tick，daemon 返回：

```text
task snapshot already processed: daemon-planning-v1
```

对应 task 仍停留在 `planning` / `stateVersion=1`，但 surface 已经因为 attempt 创建而发生变化，并应继续暴露 `create_workspace`。

### 当前影响

- 这会阻止同一个 task 在 `planning` 状态内继续由 daemon 自动推进下一步。
- 目前可以通过 operator 手动执行 `create_workspace` 绕过，但这降低了“真实 outer agent + daemon tick”连续推进能力。

### 候选优化方向

- 重新评估 daemon agent session 的 idempotency key，不应只依赖 `task.status + task.stateVersion`。
- 可考虑把 surface 关键快照版本或 active attempt/workspace/workflow run 摘要纳入 requestId。
- 也可在 `create_attempt` 成功时推进 task stateVersion，确保下一次 tick 生成新的 requestId。
- 实现前需确认不会破坏 retry、幂等和 stalled recovery 语义。
