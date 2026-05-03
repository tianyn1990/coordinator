# Proposal: add Coordinator Agent Tools executor

## 背景

Iteration 7 已经落地外层 Coordinator Agent Runtime，但该 runtime 仍是 decision-only。外层 agent 可以基于 Coordinator Surface 输出决策文本，却还不能通过受控工具推进任务。

Iteration 8 需要补上 P0 最小 agent tools executor，让 Coordinator Agent 的行动从“文字建议”进入“受控、可审计、可恢复的 Core 工具调用”。

## 目标

- 提供 `CoordinatorAgentToolExecutor` 业务入口。
- 实现 P0 最小 agent tools：
  - `write_execution_plan`
  - `revise_execution_plan`
  - `create_attempt`
  - `create_workspace`
  - `start_workflow_run`
  - `inspect_workflow_run`
  - `ask_human`
- 工具执行前必须基于当前 `Coordinator Surface` 校验可见性。
- 工具参数保持窄，复杂内容通过 artifact path 引用。
- 副作用工具遵守 operation/idempotency/lock 或复用已有已合规 Core service。
- 每次工具调用必须写入可观测 event。
- 提供 CLI/API operator 调试入口；这些入口不是 agent tools，也不能进入 surface。

## 非目标

- 不实现 daemon/watchdog/reconciliation loop。
- 不实现 PR/MR provider tools。
- 不实现 merge approval、merge、review rework。
- 不实现 agent provider 自动解析 tool calls。
- 不改变 `workflow` protocol 边界。
- 不读取或写入 `.workflow` private state。
