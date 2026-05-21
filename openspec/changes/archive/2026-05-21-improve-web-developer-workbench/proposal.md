## Why

当前 Web 更像单任务 debug console：task detail 把 surface、diagnosis、workflow、PR/MR、human request 和 timeline 密集堆在一起，适合排查但不适合作为开发者日常入口。`coordinator` 的核心目标是让开发者同时管理多个工程和多个任务，因此 Web 需要先展示整体局面、需要人介入的事项和任务卡片，再允许钻取到单任务详情。

## What Changes

- 新增 Developer Workbench 视图，作为 Web 默认入口，用于展示多 project、多 task 的整体局面。
- 新增 Project Rail、Mission Strip、Workbench Board、Action Inbox，并用 Classic Debug 承接本切片的 raw detail / debug 入口；完整 System Debug Drawer 留给后续 Task Cockpit 切片。
- 将现有密集 task detail 保留为 Classic Debug / Raw Detail，不删除已有排查能力。
- 将 task list 从简单侧栏升级为按 project/status/needs-me 分类的任务卡片视图。
- 在 Action Inbox 中聚合 pending human request、merge approval、operator attention 和高风险状态。
- 保持现有副作用入口仍通过 API/Core runtime；本轮不新增 daemon 自动动作、不新增 agent-facing tool、不改 Core 状态机。
- 为后续 Task Cockpit、Project Admin、Run Until Blocked 留出导航和页面结构入口，但本轮不实现这些完整能力。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `web-human-review-surface`: Web operator surface 从单任务 debug 页面扩展为多工程、多任务 Developer Workbench，并保留 Classic Debug。
- `observability`: operator-only 诊断摘要可被 Web Workbench 用于 Action Inbox、任务卡片和 Classic Debug 展示；完整系统调试抽屉在后续切片继续拆分，但仍不得成为真相源或进入 agent-facing surface。

## Impact

- Affected code:
  - `apps/web/src/main.tsx`
  - `apps/web/src/styles.css`
  - Web 相关测试或构建配置，如需新增。
- Affected docs/specs:
  - `openspec/specs/web-human-review-surface/spec.md`
  - `openspec/specs/observability/spec.md`
  - `docs/roadmap.md` 完成后更新进度。
- Dependencies:
  - 可引入轻量图标依赖 `lucide-react`；本切片不引入 `@xyflow/react`，流程图留给 Task Cockpit 切片。
- Systems:
  - Web 仍调用现有 API。
  - API/Core/daemon/workflow protocol 边界不变。
