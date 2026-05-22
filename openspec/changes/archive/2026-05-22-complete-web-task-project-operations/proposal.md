## Why

Workbench 和 Task Cockpit 已经把“多任务局面”和“单任务详情”拆开，但 Web 仍缺少完整的日常操作入口：任务下达还是小表单，工程注册入口不可用，推进流程需要 operator 手动反复触发 daemon tick，PR/MR 常用操作也分散在 raw detail 中。

本轮要让 Web 从“观察面”进一步成为开发者真实使用的工作台，同时保持 Coordinator Core、daemon 和 workflow protocol 的既有边界。

## What Changes

- 新增 New Task 页面/视图，支持 project 选择、大文本任务说明、背景/验收/约束编辑、autonomy 选择、可选 workflow hint 和附件占位。
- 支持 `Create task` 与 `Create and run until blocked`，后者创建任务后只通过 daemon tick + refresh 推进，直到 Core/Workflow 边界要求停止。
- 新增 Project Admin 页面/视图，展示已有 project registry、provider/workflow/agent/workspace 配置、注册新 project 表单和 workspace hook 只读预留。
- 增加全局与单任务 `Run until blocked` 控制，展示每轮 tick action summary 与停止原因。
- 补齐 Task Cockpit / Classic Debug 中常用 PR/MR operator actions 的入口：create/update PR/MR、inspect review、request merge approval、approve/reject、merge。
- 保持 workflow running without handoff 时只读 inspect / 等待 handoff；Web 不执行 workflow action，不根据 workflow debug 字段推进外层状态。
- 附件/图片上传和 workspace init/cleanup hook 只做安全占位，不落地不完整副作用。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `web-human-review-surface`: 增加 New Task、Project Admin、Run Until Blocked、PR/MR operator actions 的 Web 侧契约。
- `project-registry`: 将既有 CLI/API project registry 视图扩展到 Web Project Admin，并明确 hook 预留不执行副作用。
- `operator-task-controls`: 增加 Web run-until-blocked operator loop 契约，限定其只能调用 daemon/Core 安全路径。

## Impact

- Affected code:
  - `apps/web/src/main.tsx`
  - `apps/web/src/styles.css`
  - `apps/api/src/server.test.ts`
- Affected docs/specs:
  - `openspec/specs/web-human-review-surface/spec.md`
  - `openspec/specs/project-registry/spec.md`
  - `openspec/specs/operator-task-controls/spec.md`
  - `docs/roadmap.md` 完成后更新进度。
- Dependencies:
  - 不新增前端重型 UI framework；继续使用 React/CSS 组合现有 operator API。
- Systems:
  - Web 仍是 operator surface。
  - API/Core/daemon/workflow protocol 保持唯一副作用和状态迁移边界。
