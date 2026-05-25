## Context

Iteration 14 的方向是让 Coordinator 成为多个 workflow run / agent session 的管理者、观察者、恢复者和人工 gate 收件箱，而不是 workflow 的遥控器。Slice 14.1/14.3 已经分别落地 workflow action classification 与 agent activity summary，但当前观察语义仍分散在 Web helper、Run Until Blocked stop reason、daemon observation 和 operator summary 中。

当前版本必须继续保持 workflow protocol 不变；`stage`、`substate`、`gate`、`allowedActions`、`actionInputs` 仍只是 protocol projection / debug hint。Coordinator 只能在现有字段上做保守解释：active + no handoff + only internal/debug actions 表达为 observing runtime，而不是 operator needs-me。

## Goals / Non-Goals

**Goals:**

- 在 Core 增加共享的 operator-only workflow runtime observation helper，统一派生 mode、owner、reason、operator/internal/debug actions、handoff summary。
- 让 task detail / execution summary / Web Task Cockpit / Run Until Blocked 消费同一类 observation 摘要，减少重复判断和文案漂移。
- 确认 daemon running workflow watchdog 只记录 observation，不创建 human request/operator attention，不调用 workflow action helper。
- 保持 Coordinator Surface 收窄；最多展示短 observation 摘要，不暴露 action executor、raw status、provider raw event 或内部 action 参数通道。
- 更新 docs 中的统一设计心智，并补充给 workflow 工程的未来协议增强交接建议。

**Non-Goals:**

- 不修改 `/Users/hetao/Documents/github/workflow`。
- 不修改 workflow protocol，不要求 `agent.state`、`blocker.owner`、`operatorActions`、`agentActions` 等新字段。
- 不让 daemon 或 outer Coordinator Agent 自动执行 `materialize-change`、`run-alignment-checks`、inspect/resume 或 unknown action。
- 不让 Coordinator 猜测 `change-id`，不读取 `.workflow` private state。
- 不改变 PR/MR/review/merge 的既有人类 approval gate。

## Decisions

### Decision 1: observation 是派生摘要，不是新状态机

新增 helper 只从已持久化 workflow run、latest workflow projection、handoff、action classification、agent activity 和 Core facts 派生 operator summary。它不写入 task status，不改变 workflow run coarse status，不成为 PR readiness 或 done 的依据。

替代方案是在 DB 中新增 lifecycle owner 字段。当前 protocol 尚未提供稳定 owner，持久化容易制造第二真相，因此本轮只做只读派生。

### Decision 2: owner/mode 采用保守枚举

建议最小枚举：

```text
mode: observing_runtime | waiting_operator_gate | handoff_ready | recovery_attention | completed | unknown
owner: workflow_runtime | operator | coordinator | pr_review | recovery | unknown
```

`active + no handoff + operator-facing action` 才是 `waiting_operator_gate`；`active + no handoff + only agent-internal/debug action` 是 `observing_runtime`。unknown action 默认 debug-only，避免误升为人工 gate。

### Decision 3: Web 只展示 Core/API 提供的 observation，分类仍来自 shared helper

前端仍可以使用 `@coordinator/shared` 的 action classification 做 UI grouping，但 Task Cockpit、Action Inbox、Run Until Blocked 的 owner/mode 文案应优先来自 Core/API 的 observation。这样 Web 不需要理解 workflow runtime 的完整状态机，也不会因为 `allowedActions.length > 0` 误报 needs-me。

### Decision 4: daemon 只观察，不补全内部 workflow action

daemon 可以 inspect workflow status 并记录 sanitized observation；如果发现 only internal/debug actions，它不创建 human request、不标记 operator attention、不调用 `/workflow-runs/:id/actions` 或底层 `invokeWorkflowAction`。如果 protocol inspect 失败、profile mismatch 或 provider/session failure 可见，则交给 Core recovery decision，而不是猜 workflow 内部下一步。

### Decision 5: future protocol handoff 只写文档，不作为实现前提

本轮可以整理未来给 workflow 工程的建议，例如 `operatorActions` / `agentActions`、`blocker.owner`、`agent.state`、`lastAgentEventSummary`。这些建议只帮助后续协议演进，当前代码必须在字段缺失时保持兼容和保守。

## Risks / Trade-offs

- [Risk] 现有 protocol 无法准确知道 inner agent 是否仍在运行。→ Mitigation：只表达 “observing / waiting runtime” 的保守状态，不声明完成或内部 owner 已解决。
- [Risk] Web 和 Core 同时保留 action grouping 可能短期重复。→ Mitigation：共享 `classifyWorkflowAction`，并把 owner/mode 文案集中到 Core/API observation。
- [Risk] operator-facing action 白名单过窄，可能隐藏新的真实人工 gate。→ Mitigation：unknown 默认 debug-only；后续必须通过 spec/测试显式加入 operator-facing classification。
- [Risk] future protocol 建议被误解为当前依赖。→ Mitigation：docs 明确当前版本不修改 workflow protocol，所有新字段都是后续可选增强。

## Migration Plan

- 复用现有 DB schema、event payload、workflow projection 和 task detail API。
- 增加只读派生字段时保持 optional，旧数据没有 latest projection 时 fallback 为 unknown / observing 文案。
- 回滚时可删除新 helper 和 Web 展示字段，不影响已持久化 task/workflow run/event。

## Open Questions

- 后续 workflow protocol 是否应由 `blocker.owner` 明确区分 `operator`、`inner_agent`、`runtime`、`external_system`，留给 workflow 工程后续设计。
- inner coding agent 的真实 live state 是否应由 workflow runtime 暴露，还是由 Coordinator 的 AgentProvider runtime 统一汇总，留给下一期跨项目协议讨论。
