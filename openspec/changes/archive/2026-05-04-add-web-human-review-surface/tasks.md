## 1. Core / DB / API

- [x] 1.1 补齐 task list、task detail summary、latest records、open human requests、recent events 等 repository 查询能力。
- [x] 1.2 实现 `recordHumanAnswerRuntime`，用 CAS 更新 HumanRequest，并把回答正文写入 artifact。
- [x] 1.3 补齐 API：`GET /tasks`、`POST /tasks`、`GET /tasks/:taskId`、`POST /human-requests/:id/answer`，并复用已有 PR/MR approval、reject、merge、daemon tick operator-only 入口。
- [x] 1.4 为新增 Core/API 能力补充单测，覆盖 human answer、task detail、过期 version 和 operator-only 边界。

## 2. Web Operator Surface

- [x] 2.1 实现 Web API client、加载/错误/刷新状态和基础类型。
- [x] 2.2 实现 task list 与 manual task 创建表单。
- [x] 2.3 实现 task detail：current blocker、surface snapshot、available tools、denied actions、execution plan、workspace/workflow/agent/PR/human 摘要。
- [x] 2.4 实现 event timeline/tool trace、human request answer 表单、merge approval/reject/merge 操作、daemon tick 调试按钮。
- [x] 2.5 调整 CSS 为密集、克制、可排查的 operator console，并确保移动端不重叠。

## 3. Verification / Docs

- [x] 3.1 运行 `openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`，修复发现的问题。
- [x] 3.2 交给独立 `gpt-5.5 high` subagent review，显式检查 docs 设计心智、边界、过度设计、协议漂移、分层污染和 agent surface/tools 暴露。
- [x] 3.3 修复合理 review 意见，并重复 review 直到无必须修复项。
- [x] 3.4 归档 OpenSpec change，更新 `docs/roadmap.md` 和必要设计文档中的已落地事实。
- [x] 3.5 检查 `git status`，提交本轮相关代码和文档改动。
