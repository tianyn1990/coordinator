## 1. Core / API

- [x] 1.1 新增 operator-facing workflow action helper，复用既有 `invokeWorkflowAction`。
- [x] 1.2 校验 latest status 的 `allowedActions`、`deniedActions` 与 0/1 个 string arg。
- [x] 1.3 增加 `POST /workflow-runs/:workflowRunId/actions` endpoint。
- [x] 1.4 补充 Core/API 测试，覆盖 allowed、denied、缺少参数与 endpoint 调用。

## 2. Web

- [x] 2.1 Task Cockpit 增加 Workflow Action Panel。
- [x] 2.2 支持无参 `freeze-requirements` 与 1 个 string arg。
- [x] 2.3 action 成功后 refresh 当前 task，并执行 task-scoped `Run until blocked`。
- [x] 2.4 task card / Open button 增加 `data-task-id`、`data-action` 与 `aria-label`。
- [x] 2.5 改善 RunUntilBlockedBanner 的 task-scoped/global scope 展示。

## 3. Validation / Review / Archive

- [x] 3.1 运行相关 core/api/web 测试与 build/typecheck。
- [x] 3.2 验证真实 Web flow：点击 `Approve requirements and continue` 后 workflow 离开当前停点或进入下一 action/handoff。
- [x] 3.3 使用 subagent review 检查 docs 边界、过度设计、daemon/outer Agent 自动 action 风险。
- [x] 3.4 OpenSpec archive 并提交完整改动。
