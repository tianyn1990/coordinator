# workflow actionInputs 交接文档

> 状态：交接给 `/Users/hetao/Documents/github/workflow` 工程的 protocol schema 正式化说明  
> 来源：`coordinator` 第一轮真实工程 smoke test  
> 目标读者：负责 `workflow` 工程的 agent / 开发者

## 1. 背景

`coordinator` 在真实工程 smoke 中已经通过 `workflow protocol status` 观察到顶层 `actionInputs`：

```json
{
  "actionInputs": {
    "materialize-change": {
      "requiredArgs": ["change-id"],
      "usage": "workflow protocol action --run run-... materialize-change <change-id>"
    }
  }
}
```

这个字段能解决 operator 只能看到 action 名、但不知道 action 参数要求的问题。例如 `materialize-change` 需要一个真实 OpenSpec change id；如果 operator 或外层 agent 不知道这个参数，会先触发 `PROTOCOL_INPUT_NOT_SUPPORTED`，再可能触发 `OPENSPEC_CHANGE_NOT_FOUND`。

`coordinator` 侧本轮只做 sanitized projection：把 `actionInputs` 投影为 operator/debug status 中的 action input hints，不进入 Coordinator Agent Surface，也不驱动外层状态机。

`workflow` 工程需要把 `actionInputs` 正式纳入稳定 protocol schema/docs，使它成为受控 protocol 输出，而不是临时 debug 字段。

## 2. 目标

请在 `/Users/hetao/Documents/github/workflow` 工程中完成：

- 将 `actionInputs` 纳入 `workflow protocol status` 和 `workflow protocol action` 后返回 status 的正式 JSON schema。
- 明确 `actionInputs` 是顶层 protocol 字段，不是 `.workflow` private state 泄漏。
- 为需要参数的 action 返回窄化参数提示。
- 补充 runtime contract tests，覆盖 action input schema 和典型 action。

建议 change id：

```text
formalize-protocol-action-inputs
```

## 3. 建议 Schema

`workflow protocol status --run <run-id>` 可返回：

```json
{
  "ok": true,
  "protocolVersion": "1",
  "runId": "run-...",
  "profile": "feature",
  "lifecycle": "active",
  "allowedActions": ["materialize-change"],
  "actionInputs": {
    "materialize-change": {
      "requiredArgs": ["change-id"],
      "usage": "workflow protocol action --run run-... materialize-change <change-id>"
    }
  },
  "handoff": {
    "available": false
  }
}
```

字段约束：

- `actionInputs` 可省略或为空对象。
- key 必须是当前或近期可执行的 action id。
- `requiredArgs` 必须是 string array，元素使用稳定短参数名，例如 `change-id`。
- `usage` 可选；如果提供，应是面向 operator 的短命令示例。
- 不要在 `actionInputs` 中返回绝对路径、`.workflow` private state path、完整 runtime state、OpenSpec 原始对象或复杂 JSON schema。

## 4. 当前需要覆盖的 action

从 smoke 暴露的最小需求看，至少覆盖：

```text
materialize-change -> requiredArgs: ["change-id"]
repair-current-change-reference -> requiredArgs: ["change-id"]
```

如果后续 workflow 有其他带参 action，应按同一窄 schema 增加。

## 5. 与 coordinator 的边界

`coordinator` 可以：

- 解析顶层 `actionInputs`。
- 在 operator/debug status 中展示 sanitized action input hints。
- 把窄摘要写入 workflow status inspected event。

`coordinator` 不会：

- 直接读取 `.workflow` private state 来猜参数。
- 根据 `currentChange` 或文件系统自动猜 `change-id`。
- 根据 `actionInputs` 扩大 Coordinator Agent Surface。
- 根据 `stage/substate/gate/actionInputs` 推导 PR readiness、done 或 merge。

如果未来需要让 Coordinator Agent 自动执行带参 workflow action，应该在 `coordinator` 侧另开 change，更新 `docs/workflow-protocol.md`、`docs/coordinator-surface.md` 和 `docs/agent-tools.md`，明确哪些 action input hint 可以进入 agent-facing surface。

## 6. 测试建议

请在 workflow 工程补充 contract tests：

- status 在 `materialize-change` 窗口返回 `actionInputs.materialize-change.requiredArgs = ["change-id"]`。
- status 在 `test-align` 窗口返回 `repair-current-change-reference` 的参数提示。
- 无参数 action 不需要返回 actionInputs，或返回空 requiredArgs。
- actionInputs 不包含 private state path、完整 state JSON 或复杂对象。
- `protocol action --run <run-id> materialize-change` 缺少 change id 时仍返回 recoverable failure，并在 status 中提供参数提示。

## 7. 兼容性

`coordinator` 应将缺失 `actionInputs` 视为 `{}`，因此 workflow 可以渐进发布。

一旦 workflow 文档把 `actionInputs` 正式化，建议保持字段名和 `requiredArgs` 语义稳定，避免外层 operator/debug 工具频繁调整。
