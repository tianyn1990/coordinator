## Context

`docs/web-developer-workbench.md` 明确 Iteration 13 的 Web 结构应包含 Workbench、Task Cockpit、Project Admin 和 Classic Debug。Slice 13.1 已把 Web 默认入口改为多任务 Workbench，但点击任务后仍只能进入 raw-oriented Classic Debug。Slice 13.2 需要补齐单任务主体验，让用户能先理解“任务走到哪里、workflow 内部在做什么、为什么需要我介入”，再按需展开 raw debug。

本切片必须对齐 `docs/workflow-protocol.md`：`stage/substate/gate/allowedActions/actionInputs` 只能用于 operator/debug 展示，不能驱动 coordinator 外层状态迁移、daemon action、PR readiness、done 或 merge。

## Goals / Non-Goals

**Goals:**

- 新增 Task Cockpit 作为单任务默认详情视图。
- 展示外层执行链路和每个节点的只读状态投影。
- 展示 Workflow Lens，兼容 workflow status 缺失 stage/substate/progress/stageArtifacts 的情况。
- 将 human request、merge approval、PR/MR 和 key artifacts 聚合成 Evidence / Actions panel。
- 把 raw surface、timeline、operation ledger、recovery、provider/protocol inspect 放入 Debug Drawer。
- 保留 Classic Debug 入口。

**Non-Goals:**

- 不新增 workflow action executor。
- 不让 daemon 根据 workflow `allowedActions` 自动执行 action。
- 不新增 agent-facing tools，不扩大 Coordinator Surface。
- 不读取 `.workflow` private state。
- 不引入 Core 通用 DAG engine。
- 不实现 Run Until Blocked、Project Admin 或完整 task creation。
- 不精修最终视觉细节；只保证布局清晰、可读、响应式可用。

## Decisions

### Decision 1: Outer Flow Map 使用 Web 侧只读投影

Outer Flow Map 从现有 `TaskDetail` 派生节点：

```text
Task, Plan, Attempt, Workspace, Workflow, PR/MR, Review, Merge, Done
```

节点状态只表达展示分类：`done / active / waiting / attention / idle`。这些状态不写回 Core，不成为业务状态机。这样可以让用户理解外层进度，同时不引入通用 DAG 或新的 truth source。

### Decision 2: Workflow Lens 使用兼容字段模型

当前 `TaskDetail.workflowRuns` 只有 profile/status/handoffKind 等有限字段，正式 workflow stage/substate/progress 仍需要 workflow 工程适配。Web 侧先实现兼容模型：

- 有字段时展示 `stage/substate/gate/progress/stageArtifacts/actionInputs`。
- 缺字段时展示 `unknown/none` 或使用 summary/handoff/artifacts fallback。
- 明确 running workflow without handoff 的解释：Coordinator 只读观察，等待 handoff，不自动执行 workflow action。

### Decision 3: Debug Drawer 替代默认 raw detail

Classic Debug 仍保留为单独视图，但 Task Cockpit 也提供 Debug Drawer，让 operator 不离开 cockpit 就能展开 surface、timeline、operation ledger 和 protocol inspect 摘要。Drawer 默认折叠，避免普通阅读路径被 raw payload 淹没。

### Decision 4: 不引入图形依赖

本轮先用 CSS grid/rail/node 实现 Outer Flow Map 和 Workflow Lens。`@xyflow/react` 能增强复杂图形交互，但当前只需要固定流程投影；引入依赖会增加范围和验证成本。后续如果流程图需要拖拽、缩放或复杂连线，再单独 change 引入。

## Risks / Trade-offs

- [Risk] Workflow Lens 早期字段不完整，用户看到较多 unknown。  
  Mitigation: 明确 fallback 文案，并把 workflow 工程适配需求保留在 `docs/workflow-stage-substate-handoff.md`。

- [Risk] Web 派生流程节点被误认为 Core 状态机。  
  Mitigation: 只在组件内作为 display model，不写 DB，不触发副作用，不影响 Coordinator Surface。

- [Risk] Debug Drawer 与 Classic Debug 存在重复。  
  Mitigation: Debug Drawer 只做 cockpit 内的摘要/折叠排查入口；Classic Debug 保留完整 raw-oriented 视图。

- [Risk] 当前 API 没有单独 workflow status/artifacts/events endpoint。  
  Mitigation: 先使用 `TaskDetail.workflowRuns/events/artifact refs` 展示兼容 lens；如果后续需要更丰富协议查询，另开 operator-only API change。

## Migration Plan

- Web 默认 Workbench 不变。
- 点击任务卡片默认进入 Task Cockpit。
- Classic Debug 仍可从顶部 tab 和 Task Cockpit debug action 进入。
- 不需要数据迁移。

## Open Questions

- 后续 workflow 工程稳定输出 `stageArtifacts/progress/actionInputs` 后，是否需要新增 API 层对 workflow status/artifacts/events 做专门缓存与合并，留到后续 change 评估。
