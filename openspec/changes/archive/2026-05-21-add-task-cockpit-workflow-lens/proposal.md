## Why

Workbench 已经解决“多个任务的局面”问题，但单个任务的主要详情仍只有 Classic Debug。开发者需要一个更清晰的 Task Cockpit 来理解任务外层流程、workflow 内部进度、当前 evidence 和需要介入的原因，同时把 raw surface/timeline/operation 继续收进调试层。

## What Changes

- 新增 Task Cockpit 视图，作为从 Workbench task card 进入单任务详情的默认路径。
- 新增 Outer Flow Map，展示 `Task -> Plan -> Attempt -> Workspace -> Workflow -> PR/MR -> Review -> Merge -> Done` 的只读流程投影。
- 新增 Workflow Lens，展示 workflow profile、lifecycle、stage、substate、gate、handoff、allowed/denied actions、action input hints、stage artifacts 和 latest workflow events 的 operator-only 摘要。
- 新增 Evidence / Actions panel，集中展示 human request、merge approval、PR/MR、key artifacts 和安全操作入口。
- 新增折叠 Debug Drawer，把 surface、timeline、operation ledger、recovery timeline、provider/protocol inspect 和 raw-oriented detail 放入排查区域。
- 保留 Classic Debug 入口；本轮不删除现有 detail 能力。
- 保持所有副作用仍通过既有 API/Core runtime；本轮不新增 daemon 自动 action、不新增 agent-facing tool、不修改 Core 状态机。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `web-human-review-surface`: Web 单任务详情从 Classic Debug 扩展为 Task Cockpit，并增加 Workflow Lens、Outer Flow Map、Evidence / Actions panel 和 Debug Drawer。
- `observability`: operator-only diagnosis、timeline、workflow protocol status/artifacts/events 可用于 Task Cockpit 和 Workflow Lens 展示，但仍不得成为 truth source 或进入 agent-facing surface。

## Impact

- Affected code:
  - `apps/web/src/main.tsx`
  - `apps/web/src/styles.css`
  - 如需要，Web 相关测试或 mock 数据。
- Affected docs/specs:
  - `openspec/specs/web-human-review-surface/spec.md`
  - `openspec/specs/observability/spec.md`
  - `docs/roadmap.md` 完成后更新进度。
- Dependencies:
  - 第一版优先使用 React/CSS 实现 Outer Flow Map，避免把图形依赖引入当前切片；如后续需要复杂交互图，再单独评估 `@xyflow/react`。
- Systems:
  - Web 仍调用现有 API。
  - API/Core/daemon/workflow protocol 边界不变。
