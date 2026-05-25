## Context

Web 真实流程目前已经能创建 task、attempt、workspace，并通过 Core 启动 workflow run。workflow 0.6.10 已在 status/action projection 中输出 `allowedActions`、`actionInputs`、`progress` 与 `stageArtifacts`，但这些字段当前只用于 Workflow Lens 展示；当 workflow 停在 `requirements` 且允许 `freeze-requirements` 时，operator 没有 Web 入口确认并继续推进。

既有边界要求保持不变：Coordinator Core 是唯一状态机与策略校验入口；Web 不是 truth source；daemon/outer Agent 只能 inspect/reconcile，不能根据 `allowedActions` 自动执行 workflow action；Coordinator 不读写 `.workflow` private state；PR/MR/merge 继续走 human approval gate。

## Goals / Non-Goals

**Goals:**

- 在 Task Cockpit 中把 active workflow 的 allowed action 转成 operator action card。
- 通过 Core/API 受控调用 `workflow protocol action`，并复用既有 operation、lock、fencing 与 idempotency。
- 第一版支持 0 个参数或 1 个 string 参数的 workflow action。
- action 成功后刷新当前 task，并支持明确的 task-scoped `Run until blocked` 继续推进。
- 改善 Web E2E selector 与 run banner 的 scope 表达。

**Non-Goals:**

- 不让 daemon 或 outer Agent 自动执行 workflow action。
- 不新增 Coordinator Agent Surface tool。
- 不推导 workflow stage/substate 为 Coordinator task status、PR readiness、done 或 merge 条件。
- 不读取或预览 `.workflow` private state；stage artifact 第一版只展示 protocol path。
- 不设计复杂 action 参数 schema、批量 action、action allowlist 自动化或低风险自动确认。

## Decisions

### 1. Core helper 重新 inspect 再调用既有 action adapter

新增 operator-facing helper，例如 `invokeWorkflowActionFromOperator(context, input)`，对外接收 `workflowRunId`、`expectedStateVersion`、`action`、可选 `arg`、`actor`。helper 先通过 protocol status 获取 latest projection，并用 latest `allowedActions`、`deniedActions`、`actionInputHints` 校验 operator intent；通过后再调用既有 `invokeWorkflowAction`。

原因：Web 展示的 projection 可能过期，直接信任前端会绕开 Core 策略；直接复用 `invokeWorkflowAction` 又缺少 allowed/actionInputs 校验。重新 inspect 会产生一次只读 status event，但能把校验真源留在 Core 与 workflow protocol。

替代方案：让 Web 仅用页面上的 projection 校验。拒绝，因为 Web 不是 truth source，且并发 action 后会出现 stale intent。

### 2. API 使用复数 `/workflow-runs/:workflowRunId/actions`

新增复数 endpoint 承接 Web action card。现有单数 `/workflow-runs/:workflowRunId/action` 可保留为兼容 operator debug 入口，但 Web 使用新 endpoint 和 Core helper。

原因：复数路径更符合“对 run 创建一次 action intent”的语义，并能在兼容旧入口的同时收紧 Web 路径。新 endpoint 的 body 保持窄：`action`、`expectedStateVersion`、可选 `arg`、可选 `actor`。

### 3. Web action panel 只展示 human-confirmed action

Task Cockpit 从已有 `WorkflowLensModel` 派生 action card：active workflow、handoff unavailable、存在 allowed actions 时展示。若 action 没有 required arg，显示确认按钮；若 action 有 1 个 required arg，显示一个 string input；若超过 1 个 required arg，显示 unsupported 提示而不提交。

原因：这满足当前 `freeze-requirements` 闭环，同时不给 Coordinator 引入复杂 JSON 参数通道。复杂上下文继续由 workflow surface 指导 inner agent 写 artifact。

### 4. “Approve requirements and continue” 是 Web 编排，不是 daemon 自动 action

按钮行为为：提交 operator action intent -> Core 执行 workflow action -> refresh 当前 task -> task-scoped run-until-blocked。这里的继续推进只调用既有 daemon tick loop；如果 workflow 再次停在 action/gate，Web 继续展示 action card，不自动点下一张卡。

原因：用户体验需要一次点击推进到下一个 blocker，但 policy 边界要求每个 workflow action 都有人工确认。

### 5. Run banner 带 scope 与 task summary

`RunUntilBlockedState` 增加 scope 文案，task-scoped run 明确显示当前 task；global run 显示全局结果并保留 action summary。停止原因只用于 operator explanation，不写入 Core DB。

原因：当前 global run 会被历史失败任务污染，用户需要看清本次操作是否针对当前 task。

## Risks / Trade-offs

- [Risk] action 前额外 inspect 增加一次 protocol 调用。→ Mitigation：该入口是 operator-confirmed 低频副作用路径，正确性优先于少一次调用。
- [Risk] Web 自动继续 run until blocked 可能被误解为自动执行后续 workflow action。→ Mitigation：按钮文案和停止原因明确“确认当前 action 后继续 tick”，Web 不自动提交下一次 action。
- [Risk] 仅支持一个 string arg 不能覆盖未来复杂 action。→ Mitigation：第一版保持窄参数；复杂输入应由 workflow artifact/surface 承载，后续如要扩展需另开设计。
- [Risk] 新旧 API action endpoint 并存。→ Mitigation：Web 只使用新 endpoint；旧 endpoint 保留 operator debug 兼容，不进入 Agent Surface。

## Migration Plan

无需数据迁移。部署时先更新 Core 并 build `@coordinator/core`，再更新 API/Web。回滚时 Web action panel 消失或 endpoint 不可用，不影响已存在 workflow run；daemon 仍只 inspect running workflow。

## Open Questions

- 是否需要在后续 change 中增加受控 artifact preview endpoint，让 operator 在确认 workflow action 前预览 protocol-owned stage artifact。
- 是否需要把 workflow action card 汇总到 Workbench Action Inbox；本 change 先在 Task Cockpit 落最小闭环。
