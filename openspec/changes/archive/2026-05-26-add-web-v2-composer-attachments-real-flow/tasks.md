## 1. Data Model / Core Runtime

- [x] 1.1 新增 `task_attachments` migration 与 DB repository 类型/函数，记录 attachment metadata 且不保存 raw payload。
- [x] 1.2 增加 Core operator helper：上传 attachment，校验 size/type/filename/path containment，写 artifact、metadata、event 和 artifact refs。
- [x] 1.3 增加 Core operator helper：追加 task note，写 note artifact、event 和 artifact refs，不改变 task 状态机。
- [x] 1.4 在 operator task detail、execution summary 与 Coordinator Surface 中暴露 attachment/note refs，保持短 metadata，不读取文件正文。

## 2. API

- [x] 2.1 增加 `POST /tasks/:id/attachments` 与 `GET /tasks/:id/attachments` operator-only API。
- [x] 2.2 增加 `POST /tasks/:id/notes` operator-only API。
- [x] 2.3 确保 API schema 拒绝超限字段、非法 base64、缺失 actor 或无效文件 metadata，并保持 CORS/JSON 边界。

## 3. Web V2

- [x] 3.1 替换 Unified Composer placeholder，支持 new task、human answer、task note 三种 mode，并与当前 Focus Drawer / gate projection 联动。
- [x] 3.2 实现本地附件选择与上传，展示 pending file、上传结果和错误，不把 raw base64 展示到 UI。
- [x] 3.3 更新 Attachment Shelf / Evidence Shelf 展示 attachment metadata、artifact path 和 note refs。
- [x] 3.4 保持 workflow operator gate 仍只由 Focus Drawer gate panel 显式提交，Composer 不自动调用 workflow action endpoint。

## 4. Tests

- [x] 4.1 补 DB/Core tests：attachment metadata、path traversal、size/type limit、note artifact/event、Surface 只暴露 refs。
- [x] 4.2 补 API tests：上传 attachment、非法 payload 拒绝、追加 note、task detail 返回 attachments。
- [x] 4.3 补 Web model / component-adjacent tests：Composer mode 派生、internal action 不影响 Composer gate、attachments refs 进入 display model。

## 5. 验证、Review 与收尾

- [x] 5.1 运行 `openspec validate add-web-v2-composer-attachments-real-flow --strict`、`openspec validate --all --strict`、相关 tests、`pnpm typecheck`、`pnpm --filter @coordinator/api build`、`pnpm --filter @coordinator/web build`。
- [x] 5.2 使用浏览器验证桌面视口：创建 task、上传附件或安全占位、追加 note、run until blocked，确认 Composer/Attachment Shelf/Focus Drawer 无明显重叠。
- [x] 5.3 交给独立 subagent review，明确检查 docs 总体设计、过度设计、Core/Daemon/Workflow protocol/AgentProvider/Web 分层污染、daemon/outer Agent 自动 workflow action、raw provider events/workflow debug/attachment payload 是否变成新状态机或 agent surface。
- [x] 5.4 修复 review 必须修复项后归档 OpenSpec change，更新 `docs/roadmap.md` 进度记录并提交。
