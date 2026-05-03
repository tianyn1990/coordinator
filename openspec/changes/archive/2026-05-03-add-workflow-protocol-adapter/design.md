# Design: add workflow protocol adapter

## 本轮边界

本轮新增的是 Execution Adapter，不是 daemon，也不是 Coordinator Agent tool executor。CLI/API 入口仅供 operator 调试，不进入 Coordinator Surface。

## 模块

在 `packages/core` 新增 `workflow-protocol-adapter.ts`：

- `inspectWorkflowCapabilities(context, input)`
- `startWorkflowRun(context, input)`
- `inspectWorkflowRun(context, input)`
- `invokeWorkflowAction(context, input)`
- `listWorkflowArtifacts(context, input)`
- `listWorkflowEvents(context, input)`

默认 runner 使用 Project Registry 的 `workflowLauncher`。测试可以注入 fake runner。

## DB 读写

需要补齐 `workflow_runs` repository：

- `createWorkflowRun`
- `getWorkflowRun`
- `getActiveWorkflowRunByAttempt`
- `updateWorkflowRun`

启动 workflow run 时：

1. 读取 attempt/project/workspace。
2. 校验 project 有 `workflowLauncher`，workspace ready 且 repo path 存在。
3. 读取 capabilities，确认 profile implemented。
4. 创建或复用 `workflow:start:<attempt-id>:<profile-id>` operation。
5. 获取 attempt workflow lock。
6. 写入 running operation。
7. 调用 `workflow protocol start --workflow <profile>`。
8. 校验返回 JSON，写入 `workflow_runs`，append `workflow.started` event。
9. 更新 operation succeeded。

如果 operation 已 terminal 且 active workflow run 已存在，则返回现有记录，不重复启动。

## Protocol 校验

校验策略保持 P0 最小：

- `capabilities.protocolVersion` 必须兼容 `"1"`。
- profiles 必须包含 `id`、`purpose`、`implemented`。
- `status.runId` 必须是字符串。
- `status.lifecycle` 必须是已知 lifecycle。
- `handoff.kind` 如存在，必须属于文档约定集合。
- artifact path 只作为 workflow protocol 暴露的只读引用保存，不允许作为 coordinator tool payload。

## 状态映射

`workflow_runs.status` 只保存粗粒度状态：

- `starting`
- `running`
- `blocked`
- `handoff`
- `completed`
- `failed`
- `unknown`

映射规则：

- `lifecycle=active` 且无 handoff：`running`
- `lifecycle=failed`：`failed`
- `lifecycle=unknown`：`unknown`
- `handoff.available=true`：`handoff`
- `handoff.kind=blocked/human_review_required/manual_handoff` 仍是 `handoff`，不是 coordinator task blocked 真源

`stage/substate/gate` 仅进入 event payload 的 debug 区域，不驱动 tool visibility 或 task 状态。

## 兼容适配

如果当前 `workflow` 尚未提供完整 protocol，本轮只允许通过命令 runner 层封装：

- 正式命令形态仍固定为 `protocol <command>`。
- 不解析 `.workflow` 私有文件。
- 不解析旧 CLI 非稳定输出。
- 测试用 fake runner 覆盖 protocol JSON，不把 fake 当真实协议。

## 可观测性

每次 inspect/action/start/artifacts/events 都 append event：

- operation id，如有。
- workflow run id，如有。
- protocol command。
- summary。
- handoff snapshot，如有。
- artifact refs，如有。

payload 可以保存 protocol 摘要，但不把大对象默认塞入 agent surface。
