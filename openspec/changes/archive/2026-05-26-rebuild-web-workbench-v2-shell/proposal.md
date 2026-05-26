## Why

当前 Web 的日常入口仍带有旧 board/card/cockpit 心智：它能支撑真实 smoke 和 debug，但不适合长期同时管理多个 workflow。Web V2 需要先建立桌面端 Run Matrix 与 Focus Drawer 基础壳层，让 operator 默认看到“哪些任务在跑、哪些需要我、哪些只是内部推进”，而不是进入单任务 debug 页面。

## What Changes

- 将 Web 默认主体验重写为全新的桌面端 Web V2 shell：Command Bar、Run Matrix、Focus Drawer、Unified Composer 占位和 Debug Detail Drawer。
- 用 Run Matrix 行式结构替代旧 task card board，展示 project/title、outer lifecycle rail、workflow stage rail、stage/substate chip、owner/mode、heartbeat、needs-me pin 和 focus action。
- 删除旧 Workbench board、Task Cockpit、Classic Debug、New Task 和 Project Admin 页面结构；本切片只保留 Web V2 单页中的必要 operator action 与 debug detail 入口。
- 用 Focus Drawer 展示 task summary、workflow run summary、agent activity summary、operator gate panel、recent evidence、attachments shelf 占位和 Workflow Lens / Debug Detail。
- 采用 `Operational Paper + Instrument Status` 视觉方向：浅色、高密度、细线轨道、克制状态色和状态驱动动效。
- 本切片不实现 Unified Composer 的完整创建/附件行为，不修改 workflow protocol，不新增 daemon 自动动作，不改变 Core 状态机。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `web-human-review-surface`: Web operator surface 的默认主入口、任务摘要和单任务详情结构从旧 Workbench/Task Cockpit 迁移到 Web V2 Run Matrix / Focus Drawer。
- `observability`: Web 默认调试信息展示边界调整为 Debug Detail Drawer 默认折叠，raw surface、operation、provider event 和复杂 payload 不默认铺在主界面。

## Impact

- Affected code:
  - `apps/web/src/main.tsx`
  - `apps/web/src/styles.css`
  - 新增 Web V2 展示模型 helper 与测试。
- Affected docs/specs:
  - `openspec/specs/web-human-review-surface/spec.md`
  - `openspec/specs/observability/spec.md`
  - `docs/roadmap.md` 完成后更新进度。
- Dependencies:
  - 优先复用现有 React/Vite 与现有依赖；不引入重型 UI framework。
- Systems:
  - Web 仍调用现有 API/Core runtime。
  - API/Core/daemon/workflow protocol 边界不变。
