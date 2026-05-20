## Context

当前 coordinator 的长期边界已经明确：

- `Coordinator` 管任务如何完成。
- `workflow` 管一次代码变更内部如何阶段化执行。
- `daemon` 是可靠运行时，不是智能体，不做业务语义判断。
- `Coordinator Agent` 只能基于当前 Surface 请求一个受控 tool。

本地 smoke 走到 `workflow status: running / stage=requirements / handoff.available=false / allowedActions=["freeze-requirements"]` 后，最重要的设计判断是：daemon 应继续 inspect running workflow，而不是主动推进 `freeze-requirements`。这与 `docs/workflow-protocol.md` 中“stage/substate/gate/actionInputs 只能用于 debug/display，不驱动外层完成语义”的原则一致。

## Decisions

### 1. Running workflow 继续 inspect-only

Daemon 对 active workflow run 的动作保持：

```text
workflow protocol status --run <external-run-id>
persist status/handoff/recovery observation
if handoff unavailable -> keep running
if handoff available -> persist handoff and let next surface decide
```

Daemon 不调用 `workflow protocol action`。即使 status 中出现 `allowedActions` 或 `actionInputHints`，也只作为 operator/debug 信息展示。

### 2. Artifact block 只服务需要 artifact 的工具或真实修订

Outer Agent prompt 需要把 artifact 使用约束讲清楚：

- `write_execution_plan` / `revise_execution_plan` / `ask_human` 需要 artifact。
- 普通推进工具如 `create_attempt`、`create_workspace`、`start_workflow_run` 和 inspect 类工具默认不需要 artifact。
- 如果计划确实需要修订，应使用 `revise_execution_plan` 语义，而不是在普通推进步骤中覆盖 `execution-plan.md`。

这不取消 daemon artifact bridge，因为 artifact-first 仍是复杂内容传递的核心规则。

### 3. 额外 artifact 写入记录 debug event，不阻断流程

Agent 额外输出 artifact 不一定是越权；只要 path 通过 root/symlink 校验，daemon 仍可受控写入。但当当前 tool 不需要 artifact 时，系统应记录一个 debug event，帮助 operator 区分必要产物和额外噪音。

payload 必须保持窄字段：

- `tickId`
- `toolName`
- `artifactCount`
- `artifactRefs`
- `classification`

不记录 artifact 正文。

### 4. Operator summary 是只读派生，不是新状态源

执行链路摘要只从已持久化事实派生：

- task / project
- latest attempt
- active workspace
- workflow run
- recent agent sessions
- events
- artifacts

它不触发 provider、workflow protocol、git inspect，不进入 Coordinator Agent Surface，也不改变 tool visibility。

### 5. Workflow action executor 暂不实现 agent-facing 能力

本 change 只记录边界。未来如果需要由 coordinator 触发 workflow action，应作为独立 change 讨论：

- operator-only 还是 agent-facing。
- 是否需要 human approval。
- action 参数如何从 `actionInputHints` 安全传入。
- action event 和 operation 如何审计。
- action 是否影响 handoff 判定。

## Risks

- 如果 prompt 约束过强，Agent 可能在需要 artifact 的场景少写 artifact。通过明确列出 artifact-based tools 缓解。
- 额外 artifact debug event 会增加 timeline 事件数量。通过只在“不需要 artifact 的 tool + artifactCount > 0”时记录，避免噪音过大。
- Operator summary 如果做得过重，容易变成 UI 重构。本轮只做轻量 Core/CLI/API 能力，不做完整 Web 体验。

## Validation

- OpenSpec strict validate。
- 针对 agent prompt、surface、daemon artifact classification、operator summary 的聚焦测试。
- `pnpm --filter @coordinator/core build`，确保 CLI/API/daemon 使用的 dist 更新。
