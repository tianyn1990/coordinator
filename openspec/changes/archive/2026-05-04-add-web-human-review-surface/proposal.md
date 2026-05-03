## Why

`coordinator` 已经具备 Project Registry、Surface、Workspace、Workflow Protocol、Agent Provider、Daemon 和 PR/MR Provider 的核心闭环能力，但 Web 仍停留在骨架占位。进入 Iteration 11 后，需要把这些已落地能力转换为 operator 可见、可操作、可审计的 Web 操作面，让没有外部任务源时也能通过 Web 完成 human review、merge approval 和调试闭环。

## What Changes

- 新增 Web Operator Surface，用于查看 task list、task detail、current blocker、event timeline、surface snapshot、execution plan、human request、PR/MR 与 merge approval snapshot。
- 新增 Web 手动 task 创建入口，保持 TaskSource 解耦；Web 只创建 normalized manual task，不引入外部任务源状态机。
- 新增 Web human request answer 入口，通过 operator-only API 记录回答；回答只唤醒 Core/daemon，不直接推进业务语义。
- 新增 Web merge approval / reject / merge 操作入口；approval snapshot 必须显式展示，merge 仍由 Core 校验并重新 inspect。
- 新增 Web daemon tick / agent tool / PR/MR 调试操作的薄入口，所有副作用仍调用已有 Core/API，不让 Web 绕过 policy gate。
- 补齐 API 和 repository 的 operator 查询/操作能力，以支撑 Web 页面；不扩大 Coordinator Agent surface。

## Capabilities

### New Capabilities

- `web-human-review-surface`: Web operator surface 的任务查看、人类介入、PR/MR 审批和最小可观测性能力。

### Modified Capabilities

- `core-data-model`: 补充 Web 所需的 task list/detail、human answer 和最小 operator 查询/更新契约。
- `project-skeleton`: 将 Web 从占位页提升为可构建、可连接 API 的 operator surface。
- `pr-mr-provider`: 明确 Web approval/reject/merge 入口是 operator-only，并复用既有 Core policy gate。

## Impact

- 影响 `apps/web`：新增真实 React 操作台页面、API client、表单和状态视图。
- 影响 `apps/api`：补充 task list/create/detail、human answer、operator action 等 Web 所需 API。
- 影响 `packages/db` / `packages/core`：补齐 Web 所需 repository/service 查询与 human answer 操作，但不改变 Core 作为唯一状态机和策略校验层的边界。
- 影响测试：新增 API contract tests、Web build/typecheck 覆盖，必要时补充 core/db 单测。
- 不新增外部 UI 依赖；第一版保持 Vite + React + Fastify + SQLite。
