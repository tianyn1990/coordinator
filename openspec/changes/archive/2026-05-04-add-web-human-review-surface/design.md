## Context

当前代码已经完成 Iteration 10：Core、Surface、Daemon、Agent Tools、Workflow Protocol 和 PR/MR Provider 都有 P0 级能力，CLI/API 也有一批 operator-only 调试入口。但 Web 仍是项目骨架中的占位页，无法承担 `docs/observability.md` 和 `docs/roadmap.md` 中要求的 operator surface 职责。

这轮实现必须主动对齐既有设计心智：

- Web/CLI 是 operator surface，不是 Coordinator Agent。
- Web 只能调用 API/API 再调用 Core service；不能在前端重建状态机。
- `Coordinator Core` 仍是唯一状态机和策略校验层。
- human answer 不直接推进业务状态，只记录回答并唤醒后续 agent/daemon。
- merge approval 必须展示并绑定 snapshot；merge 执行前仍由 Core 重新 inspect 与校验。
- Web 展示 machine JSON / event / artifact ref 是为了 operator 审计，不是给 agent 增加 hidden memory。

## Goals / Non-Goals

**Goals:**

- 提供可用的 Web task list/detail 操作面。
- 支持 Web 手动创建 task，作为第一版 manual source。
- 支持 Web 查看 current blocker、event timeline、surface snapshot、execution plan、human request、PR/MR 和 merge approval。
- 支持 Web 记录 human answer、批准/拒绝 merge、触发 merge after approval。
- 支持 Web 手动触发 daemon tick，便于没有长期 daemon 进程时调试推进。
- 补齐必要 API 和 repository 查询/操作，并覆盖 contract tests。

**Non-Goals:**

- 不接入 Meego/GitHub Issues/GitLab Issues 等外部任务源。
- 不实现通用 dashboard query language。
- 不让 Web 直接执行 agent tools 或修改 SQLite。
- 不在 Web 中推导 workflow private stage/substate 的业务语义。
- 不绕过 merge approval，也不实现高信任自动 merge。
- 不新增复杂 UI 状态管理库；第一版使用 React 本地 state 与简单 API client。

## Decisions

### 1. Web 以 Task Detail 为主轴，而不是先做平台首页

选择：

- 首页展示 project/task 选择、manual task 创建和 task list。
- 进入某个 task 后，显示一屏操作台：blocker、surface、timeline、human request、PR/MR、operation/event 摘要。

原因：

- 当前 P0 闭环围绕 task 推进。
- operator 调试最需要知道“这个 task 卡在哪里、下一步能做什么”。
- 避免第一版先做大而空的 dashboard。

备选：

- 做多页路由和全局导航。暂不采用，因为会增加 UI 框架复杂度；第一版可以用单页面状态切换。

### 2. Web 只消费 API 汇总资源，不直接拼接 Core 规则

选择：

- 新增 `GET /tasks`、`POST /tasks`、`GET /tasks/:taskId` 等 API。
- task detail API 返回 task/project/latest attempt/workspace/workflow/PR/human/events/surface 的 operator summary。
- Web 只按 API 返回值展示，不自行判断 merge 是否允许；按钮是否可用由 summary/surface 中的状态和 API 返回共同约束。

原因：

- 保持 Web 是 operator surface，不是第二状态机。
- 后续 CLI、远程 UI 或外部平台 adapter 可复用同一 Core/API 查询。

备选：

- 前端分别调用很多底层 API 再聚合。暂不采用，因为容易让 UI 拼出第二套“当前事实”。

### 3. Human answer 走 operator-only Core service

选择：

- 新增 Core service `recordHumanAnswerRuntime`。
- 输入为 `humanRequestId`、`expectedStateVersion`、`answer`、`answeredBy`。
- Core 把 answer 写入当前 task/attempt 的 coordinator artifact root，并更新 human request 为 `answered`。
- API 暴露 `POST /human-requests/:humanRequestId/answer`。

原因：

- 复杂回答写 artifact，符合 artifact-first。
- `expectedStateVersion` 让 UI 操作具备 CAS 保护。
- answer 只改变 HumanRequest 状态，不直接把 task 置为 completed/running。

备选：

- 让 Web 直接传 answer artifact path。暂不采用，因为 Web 用户编辑的是正文；Core 更适合统一创建 artifact 和记录事件。

### 4. Merge approval / reject / merge 复用 PR/MR Provider Runtime

选择：

- Web 调用已有 `approveMergeRuntime`、`rejectMergeRuntime`、`mergeAfterApprovalRuntime` 的 API。
- UI 必须展示当前 approval snapshot 字段：PR、head/base sha、validation run、merge strategy、approved by/status。

原因：

- PR/MR Provider Runtime 已经实现 Core gate 和 provider gate。
- Web 不应重新实现 snapshot 校验。

备选：

- 在 Web 中根据字段启禁按钮。UI 可以提示风险，但不能替代 Core 校验。

### 5. UI 风格采用密集、克制、可排查的操作台

选择：

- 使用 Vite + React + CSS，避免新增依赖。
- 布局为左侧任务列表 + 右侧详情/操作区。
- 用分区、表格、timeline 和短表单呈现事实。

原因：

- 这是工程运维工具，不是营销页。
- 第一版重点是减少 operator 找信息的成本。

备选：

- 引入组件库。暂不采用，避免新依赖和样式范式冲突。

## Risks / Trade-offs

- [Risk] API 汇总过厚，未来可能变成第二 Core。→ Mitigation：汇总只读，所有副作用仍调用 Core runtime；不在 API 层做业务状态迁移。
- [Risk] UI 操作入口过多，operator 误以为可绕过 agent。→ Mitigation：按钮文案明确为 operator-only；merge/answer 都通过 Core gate；agent surface 不新增 operator tools。
- [Risk] Web 创建 task 后没有 daemon 长运行，用户以为任务会自动推进。→ Mitigation：提供 daemon tick 调试入口，并在 current blocker 中显示下一步。
- [Risk] human answer 正文很长。→ Mitigation：由 Core 写 artifact，数据库只保存 artifact path。
- [Risk] approval snapshot 字段缺失时 UI 难以解释。→ Mitigation：以 surface/current blocker 和 API 错误为准，UI 显示缺失字段，不隐藏。

## Migration Plan

1. 新增 repository/Core service/API 查询和 operator action。
2. 新增 Web API client 与操作台 UI。
3. 补充 API/Core/Web 测试。
4. `openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
5. review 通过后归档 change，并同步 `docs/roadmap.md` / 必要设计文档中的已落地事实。

Rollback：

- 若 UI 有问题，可回滚 `apps/web` 改动；API/Core 新增入口保持 operator-only，不影响已有 CLI/API。
- 若 human answer service 有问题，可禁用 Web answer 按钮，既有 ask_human/daemon 不受影响。
