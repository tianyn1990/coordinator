## 1. Task Cockpit 数据派生

- [x] 1.1 梳理现有 `TaskDetail` 数据，补充 Task Cockpit 所需的 outer flow、workflow lens、evidence/action、debug drawer 展示派生类型。
- [x] 1.2 从现有 task detail、diagnosis、workflowRuns、pullRequests、humanRequests、events 和 artifact refs 派生 outer flow 节点状态。
- [x] 1.3 为 workflow stage/substate/gate/progress/stageArtifacts/actionInputs 缺失场景实现安全 fallback，不伪造 handoff 或 workflow 内部阶段。

## 2. Task Cockpit 视图与导航

- [x] 2.1 新增 `TaskCockpitView`，并让 Workbench task card 默认进入 Task Cockpit。
- [x] 2.2 新增 `OuterFlowMap`、`WorkflowLens`、`EvidenceActionsPanel` 和 `DebugDrawer` 组件。
- [x] 2.3 保留 Classic Debug 入口，并支持 Task Cockpit、Workbench、Classic Debug 之间切换。
- [x] 2.4 保持 human answer、merge approval、merge、task controls、daemon tick 操作仍复用既有 API/Core handler。

## 3. 视觉与响应式体验

- [x] 3.1 按 `industrial mission control` 方向为 Task Cockpit 补充基础样式：流程节点、workflow lens、evidence/action panel、debug drawer。
- [x] 3.2 保证桌面和窄屏布局可读，文本不溢出，debug/raw 信息默认折叠。
- [x] 3.3 明确 running workflow without handoff 的 inspect-only 文案，避免暗示 daemon 或 outer Agent 会执行 workflow action。

## 4. 验证与文档收尾

- [x] 4.1 运行 Web build、typecheck 和相关测试，修复发现的问题。
- [x] 4.2 启动本地 Web/API 或使用等价浏览器验证 Task Cockpit 桌面/窄屏主要状态无明显布局问题。
- [x] 4.3 更新 `docs/roadmap.md` 的 Iteration 13 进度记录。
- [x] 4.4 运行 `openspec validate add-task-cockpit-workflow-lens --strict` 和 `openspec validate --all --strict`。
