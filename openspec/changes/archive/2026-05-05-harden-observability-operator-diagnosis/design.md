## Context

当前系统已经具备：

- append-only event timeline。
- `daemon.recovery_decision` 窄 payload。
- operation ledger。
- workflow / workspace / PR/MR / agent session 的最小机器事实。
- Web task detail 和 timeline。

问题是这些事实仍偏底层，operator 需要在 timeline、PR/MR、agent session、workflow run 和 operation 之间手动推断当前卡点与恢复状态。Slice 12.6 的目标是补齐诊断视图，而不是增加新的自动化能力。

必须遵守的设计约束：

- `Coordinator Core` 仍是唯一状态机和策略校验者。
- daemon 不是 agent，只执行 Core decision。
- Web 是 operator surface，不得绕过 Core gate。
- Coordinator Agent 只能看到 Coordinator Surface 暴露的信息和 tools。
- 复杂事实优先写入 artifact；operator diagnosis 只能展示窄摘要和 artifact refs。

## Goals / Non-Goals

**Goals:**

- 给 operator 一个稳定的 `diagnosis` summary，用于理解任务当前为什么卡住、最近 recovery decision 是什么、retry 是否被阻止、哪些 provider/protocol inspect 已发生。
- 复用已有事件、operation、session、workflow、PR/MR 记录，不新增新的真相源。
- 在 Web task detail 中展示 diagnosis，改善本地调试和未来云端部署排查体验。
- 用测试保证 diagnosis 不泄漏 raw provider output、lock token 或完整内部对象。

**Non-Goals:**

- 不新增 Coordinator Agent tools。
- 不新增 daemon recovery policy。
- 不新增通用 observability DSL 或 dashboard 子系统。
- 不做新的 SQLite migration。
- 不改变 workflow protocol、PR/MR provider 或 AgentProvider contract。
- 不把 operator diagnosis 自动注入 agent-facing Markdown surface。

## Decisions

### Decision 1: diagnosis 是 Core operator summary，而不是新状态表

`diagnosis` 从当前 task 的 events、operations、agent sessions、workflow runs、pull requests、human requests 和 surface snapshot 派生。这样避免引入新的持久化真相和同步问题。

替代方案是新增 `diagnoses` 表。拒绝原因：第一版不需要历史可变诊断对象，append-only events 已经保存审计事实；派生 summary 更符合当前单 SQLite 真相源。

### Decision 2: operation ledger 只展示摘要

operator 需要知道 operation kind/status/failure code/external id 和最近 observation，但不需要完整 `lastObservedState`。因此 summary 只取有限字段和已收窄的 recovery decision 摘要。

替代方案是把完整 operation JSON 返回给 Web。拒绝原因：这会鼓励 UI 和未来 agent 依赖内部结构，也容易泄漏 provider raw output。

### Decision 3: recovery decision timeline 基于 event payload 白名单

`daemon.recovery_decision` 已保证 payload 窄字段。diagnosis 仍只白名单读取：

- decision。
- reasonCode。
- resourceKind/resourceId。
- operationId。
- observedSummary。
- nextAction。
- retryDueAt。
- operatorAttentionRequired。
- artifactRefs。

其他 payload 字段忽略，避免历史事件或未来 provider 输出意外进入 operator summary。

### Decision 4: provider/protocol inspect 摘要来自事件与实体状态

本轮不直接调用 provider 或 workflow protocol 做实时 inspect。diagnosis 只展示最近已经发生的 inspect/reconcile 事实，例如 workflow status inspected、PR/MR review inspected、provider failure、merge attempted、recovery decision。

原因：operator detail 查询必须是 read-only，不应因为打开页面触发外部副作用或网络调用。

### Decision 5: Web 展示 operator-only 机器事实，但不改变 Coordinator Surface

Web 可以展示比 agent surface 更多的机器事实，因为它是 operator surface；但这些信息不自动进入 Coordinator Agent Markdown，也不新增 agent tools。

## Risks / Trade-offs

- [Risk] diagnosis 变成第二套状态机。  
  Mitigation: 所有字段只从已有事实派生，命名为 summary/timeline，测试覆盖 task state/surface tools 不变。

- [Risk] UI 为了方便直接显示复杂 JSON。  
  Mitigation: Core 输出已经收窄，Web 只渲染摘要字段，不渲染完整 payload。

- [Risk] operator 误以为 diagnosis 会自动推进任务。  
  Mitigation: diagnosis 只读；所有副作用仍通过既有 operator controls、daemon tick、PR/MR runtime 和 Core gate。

- [Risk] 过早做 dashboard 框架导致过度设计。  
  Mitigation: 仅扩展现有 task detail，不引入新依赖、新路由体系或通用插件机制。
