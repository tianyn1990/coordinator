## Why

Web V2 已完成 Run Matrix、Focus Drawer、Needs-Me Gate Inbox 和 runtime observation，但开发者仍缺少单一输入入口来创建 task、回复 gate、补充上下文和上传本地附件。Slice 15.3 需要把 Unified Composer 与本地附件第一版落地，让真实 Web 流程能从同一个桌面工作台继续推进，而不恢复旧 New Task / Task Cockpit 页面心智。

## What Changes

- 实现 Web V2 `Unified Composer`：无选中 task 时创建新 task；选中 task 且有 pending human request 时回复该 request；选中 task 且无 pending gate 时追加 task note / follow-up context。
- 实现本地附件第一版：Web 选择本地图片/文件后通过受控 API 上传，Core 保存到 task artifact root 下的 `attachments/<attachment-id>/<safe-name>`，DB 记录 size/type/path/actor/retention metadata，并写入 event/artifact refs。
- Focus Drawer / Attachment Shelf 展示 task attachments metadata；Evidence / Surface 只暴露 artifact refs 和受控路径，不暴露二进制内容或 raw file payload。
- Composer 继续只调用 API/Core runtime；operator-facing workflow gate 仍通过现有 Focus Drawer gate panel 显式确认，Composer 不自动调用 workflow action endpoint。
- 做真实 Web flow hardening：创建 task、上传附件或安全占位、run until blocked、观察 stage/substate/internal action 不进 Needs-Me，并验证桌面视口无明显重叠。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `web-human-review-surface`: Web V2 Unified Composer、Attachment Shelf、本地附件上传与 gate/follow-up 上下文入口。
- `core-data-model`: task attachment metadata、artifact path containment、size/type/retention contract。
- `coordinator-surface`: task brief / operator summary 只暴露 attachment refs，不暴露大文件内容或 raw payload。
- `observability`: attachment upload / task note / composer submit 的事件和 artifact refs 审计。

## Impact

- Affected code:
  - `packages/db/migrations/*`
  - `packages/db/src/index.ts`
  - `packages/core/src/operator-surface.ts`
  - `packages/core/src/surface.ts`
  - `apps/api/src/server.ts`
  - `apps/web/src/main.tsx`
  - `apps/web/src/workbench-v2-model.ts`
  - Web/API/Core/DB tests
- Systems:
  - Web 仍只调用 API/Core runtime，不直接写 SQLite。
  - 不修改 workflow protocol，不读取 `.workflow` private state。
  - 不新增 daemon 自动 workflow action，不扩大 Coordinator Agent Surface。
  - 附件内容仅落 artifact 文件，Surface/Web 默认展示 metadata 和 refs。
