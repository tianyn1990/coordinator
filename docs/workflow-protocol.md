# workflow protocol

> 状态：初始方案基线  
> 适用范围：`coordinator` 与 `/Users/hetao/Documents/github/workflow` 的稳定通信协议、边界和演进原则。

## 1. 文档定位

`coordinator` 和 `workflow` 是两个独立项目。

`coordinator` 不应该猜测 `workflow` 的内部文件结构，也不应该直接读写 `.workflow` 内部状态。

两者应通过稳定 protocol 通信。

## 2. 核心边界

`coordinator` 可以：

- 启动 workflow run。
- 查询 workflow run 状态。
- 查询 workflow allowed / denied actions。
- 查询 workflow artifact。
- 查询 workflow event。
- 根据 protocol 消费 workflow handoff。

`coordinator` 不可以：

- 直接修改 `.workflow/current-run.json`。
- 直接修改 `.workflow/runs/<run-id>/state.json`。
- 直接推断 workflow stage 是否完成。
- 绕过 workflow action。
- 根据文件存在与否猜测 current change。

## 3. Protocol 设计原则

### 3.1 JSON 输出

protocol 命令必须输出稳定 JSON。

### 3.2 命令少而高层

不要让 coordinator 调大量低层命令。

### 3.3 参数保持窄

参数优先是：

- profile id。
- run id。
- action id。
- artifact path。

其中 profile id 只用于人类/operator 显式选择或 workflow runtime 返回的实际结果。外层 Coordinator Agent 不应根据 profile id 决策；当人类没有显式选择时，Coordinator 应以 omitted/default/auto 语义委托 workflow runtime 自主选择。

### 3.4 workflow 保留内部控制面

workflow 内部的 stage/gate/surface 仍由 workflow runtime 管。

coordinator 只消费结果。

## 4. 建议命令

### 4.1 capabilities

```bash
workflow protocol capabilities
```

输出：

```json
{
  "protocolVersion": "1",
  "profiles": [
    {
      "id": "feature",
      "purpose": "新增能力、结构调整或完整需求到 review 路线。",
      "implemented": true
    },
    {
      "id": "bugfix",
      "purpose": "恢复既有预期行为的缺陷修复。",
      "implemented": true
    },
    {
      "id": "micro-change",
      "purpose": "需求明确、影响局部、低风险的小型改动。",
      "implemented": true
    }
  ],
  "commands": ["start", "status", "action", "artifacts", "events"],
  "handoffKinds": ["pr_ready", "human_review_required", "manual_handoff", "blocked", "completed_no_pr"]
}
```

Coordinator 可以把 `implemented=true` 的 profile 展示给 operator，并用于校验人类显式选择。profile 选择的最终语义真源仍是 workflow runtime；外层 Coordinator Agent 不得根据 capabilities catalogue 主动选择 profile，也不得靠 Project Registry 默认或外层启发式静默选择。

Agent provider 不属于 workflow capability 真源。provider 能力由 Project Registry / AgentProvider registry 暴露，workflow 只声明它支持哪些 profile 和 protocol 命令。

### 4.2 start

```bash
workflow protocol start --workflow <profile>
# 或省略 --workflow / 使用 default / auto，让 workflow runtime 自主选择
workflow protocol start
workflow protocol start --workflow default
workflow protocol start --workflow auto
```

输出：

```json
{
  "runId": "run-...",
  "profile": "feature",
  "requestedProfile": null,
  "selectionMode": "auto",
  "status": "running",
  "stage": "requirements",
  "substate": null,
  "gate": {
    "state": "open",
    "reason": null
  },
  "artifactRoot": ".workflow/runs/run-.../artifacts",
  "nextStep": {
    "action": "inspect-surface",
    "guidance": "..."
  }
}
```

`profile` 表示 workflow runtime 最终选择或确认的 actual profile。`default` 和 `auto` 不是 actual profile，只表示“委托 workflow runtime 自主选择”。如果 operator 或任务来源提供了 human explicit profile，Coordinator 可以把该选择传给 workflow protocol；若 workflow 无法支持该选择，必须返回受控失败或 blocked/human-needed，而不是让 outer Agent 继续猜测。

### 4.3 status

```bash
workflow protocol status --run <run-id>
```

Coordinator 外层状态迁移只依赖：

- `lifecycle`
- `handoff`
- `artifacts`
- `recovery`
- `summary`

以下字段只能用于 debug/display：

- `stage`
- `substate`
- `gate`
- `allowedActions`
- `deniedActions`
- `actionInputs`
- `currentChange`
- `eventLog`

这些字段不得驱动 Coordinator Agent tool visibility、PR readiness、done 判断或 merge 判断。

输出：

```json
{
  "runId": "run-...",
  "profile": "feature",
  "lifecycle": "active",
  "stage": "implementation",
  "substate": "test-align",
  "gate": {
    "state": "open",
    "reason": null
  },
  "allowedActions": ["run-alignment-checks"],
  "deniedActions": ["skip-runtime"],
  "actionInputs": {
    "materialize-change": {
      "requiredArgs": ["change-id"],
      "usage": "workflow protocol action --run run-... materialize-change <change-id>"
    }
  },
  "summary": "workflow run is active and has not produced a handoff",
  "currentChange": {
    "available": true,
    "id": "add-feature-x"
  },
  "handoff": {
    "available": false,
    "kind": null,
    "reason": null,
    "artifacts": [],
    "nextStep": {
      "action": "continue-workflow",
      "guidance": "workflow run has not produced a handoff yet"
    },
    "deniedActions": ["create-pr-from-coordinator"],
    "recovery": {
      "action": "inspect-or-resume-workflow",
      "guidance": "inspect workflow status or resume the workflow run"
    }
  },
  "artifactRoot": ".workflow/runs/run-.../artifacts",
  "eventLog": ".workflow/runs/run-.../observability/events.jsonl"
}
```

`actionInputs` 是 workflow 对 action 参数的窄提示。coordinator 只在 operator/debug status 中展示 sanitized action input hints，例如 action id、`requiredArgs` 和 `usage`。这些 hint 不进入 Coordinator Agent Surface，不扩大 `available_tools`，也不让 coordinator 根据 workflow debug 字段自动猜测参数或推进外层状态机。

同理，`allowedActions` 只说明 workflow 当前内部控制面允许哪些 action。它不是 Coordinator 的自动执行计划，也不是 daemon 的 action queue。running workflow 没有 handoff 时，Coordinator 的稳定动作是 inspect 或等待 handoff；daemon 不得根据 `allowedActions` 或 `actionInputs` 自动调用 `workflow protocol action`。

当前 Coordinator 版本保持本协议不变，不要求 `/Users/hetao/Documents/github/workflow` 增加新字段。Coordinator 侧会保守地区分 operator-facing gate 与 agent/internal action：`freeze-requirements`、`approve-planning-dossier` 这类明确人工确认可进入 Needs-Me Gate Inbox / Focus Drawer gate item；`materialize-change <change-id>`、对齐检查、实现推进等 action 默认只作为 debug/detail 展示，不进入 needs-me，也不要求 Web operator 手动填写内部参数。

Coordinator 会在 operator-only surface 中从现有字段派生 `workflow runtime observation` 摘要，用于解释当前 run 的 owner/mode：

```text
observing-runtime
waiting-operator-gate
handoff-ready
recovery-attention
completed / unknown
```

该 observation 不是 workflow protocol 字段，不写入 `.workflow`，也不改变 workflow run coarse status。它只帮助 Web/daemon/operator summary 说明“当前是在观察 inner agent / runtime，还是等待真正 operator gate”。

未来如果 workflow 希望让外层系统更准确理解 owner，可以另行交接 protocol 增强，例如：

```json
{
  "agent": {
    "state": "running",
    "lastEventSummary": "coding agent is materializing change"
  },
  "blocker": {
    "owner": "inner-agent",
    "reason": "workflow runtime is still materializing the change"
  },
  "operatorActions": [],
  "agentActions": ["materialize-change"]
}
```

这些字段只是未来方向；在本期中不得作为已存在契约实现或测试。

### 4.4 action

```bash
workflow protocol action --run <run-id> <action> [arg]
```

输出与 `status` 类似，反映 action 后状态。

参数仍保持窄。

如果 action 需要复杂上下文，应由 workflow surface 指导 inner agent 写 artifact，而不是让 coordinator 传复杂 JSON。

第一版中，workflow action 入口属于 operator/debug 能力或 workflow runtime 内部推进能力，不进入 Coordinator Agent Surface，也不进入 daemon 自动推进路径。若未来需要让外层 agent 触发 workflow action，必须作为独立设计变更重新确认 agent-visible 工具、参数来源、审批边界、operation 审计和 handoff 影响。

### 4.5 artifacts

```bash
workflow protocol artifacts --run <run-id>
```

输出：

```json
{
  "runId": "run-...",
  "artifactRoot": ".workflow/runs/run-.../artifacts",
  "artifacts": [
    {
      "kind": "summary",
      "path": ".workflow/runs/run-.../artifacts/summary.md",
      "requiredForHandoff": true
    }
  ]
}
```

### 4.6 events

```bash
workflow protocol events --run <run-id>
```

输出：

```json
{
  "runId": "run-...",
  "eventsPath": ".workflow/runs/run-.../observability/events.jsonl",
  "latest": [
    {
      "timestamp": "...",
      "type": "workflow-action",
      "summary": "..."
    }
  ]
}
```

## 5. Workflow Handoff

Workflow handoff 以 workflow protocol 为准。

coordinator 不自己猜。

`handoff` 是 workflow 对 coordinator 的边界结果，不是 workflow 内部 stage/substate 镜像。

### 5.1 Handoff Kind

第一版支持：

```text
pr_ready
human_review_required
manual_handoff
blocked
completed_no_pr
```

### 5.2 pr_ready

示例：

```json
{
  "available": true,
  "kind": "pr_ready",
  "reason": "workflow completed review/commit readiness",
  "artifacts": [
    {
      "kind": "summary",
      "path": ".workflow/runs/run-.../artifacts/summary.md"
    },
    {
      "kind": "validation",
      "path": ".workflow/runs/run-.../artifacts/validation-report.md"
    }
  ],
  "nextStep": {
    "action": "create-pr",
    "guidance": "Coordinator may create a PR/MR from the current workspace branch."
  },
  "deniedActions": [],
  "recovery": {
    "action": "inspect-workflow",
    "guidance": "If PR creation fails, inspect workflow status and artifacts again before retrying."
  }
}
```

### 5.3 blocked

```json
{
  "available": true,
  "kind": "blocked",
  "reason": "human confirmation required",
  "artifacts": [
    {
      "kind": "blocked-summary",
      "path": ".workflow/runs/run-.../artifacts/blocked.md"
    }
  ],
  "nextStep": {
    "action": "ask-human-or-handoff",
    "guidance": "Coordinator Agent should decide whether it can resolve this or must ask a human."
  },
  "deniedActions": ["create-pr", "merge"],
  "recovery": {
    "action": "ask-human",
    "guidance": "Create a HumanRequest if the Coordinator Agent cannot safely resolve the blocker."
  },
  "humanRequestSuggestion": {
    "kind": "technical-decision",
    "summary": "..."
  }
}
```

## 6. Coordinator 如何使用 protocol

### 6.1 启动

Coordinator Agent 请求：

```text
start_workflow_run
```

Execution Adapter 根据任务上下文启动 workflow：

```bash
# 无 human explicit selection 时
workflow protocol start

# 有 human explicit selection 时
workflow protocol start --workflow <human-selected-profile>
```

Coordinator Agent 不选择 workflow profile。人类可以在外部入口显式选择，也可以在提示词中自然语言表达倾向；前者由 Coordinator 作为 human explicit selection 透传，后者由 workflow runtime 根据任务上下文自行理解。

当前 Web/manual task 创建入口尚未提供独立 workflow selection 字段；若用户在任务描述中自然语言指定工作流，Coordinator 仍只把它作为任务上下文，具体 profile 由 workflow runtime 判断。后续如增加 UI 下拉或外部 task source 的结构化 profile 字段，必须保存为 human explicit selection，并继续禁止 outer Agent 改写或猜测该选择。

### 6.2 监控

daemon 定期调：

```bash
workflow protocol status --run <run-id>
```

### 6.3 判断 handoff

只看 protocol handoff。

如果 `handoff.kind = pr_ready`：

- Coordinator Agent 生成 PR body。
- coordinator 创建 PR/MR。

如果 `handoff.kind = blocked` 或 `human_review_required`：

- Coordinator Agent 判断是否可自行消化。
- 不可消化则 ask_human。

如果 `handoff.kind = manual_handoff`：

- Coordinator Agent 生成 handoff artifact。
- task 进入 handoff 或 waiting_human。

如果 `handoff.kind = completed_no_pr`：

- coordinator 只能按 no-code / no-PR policy 收口，不得自动假设普通代码任务完成。

## 7. Artifact 边界

coordinator 可读取 protocol 暴露的 artifact。

但必须遵守：

- 只读。
- 不直接修改 workflow artifact。
- 如果需要外层总结，写 coordinator 自己的 artifact。

## 8. Event 边界

workflow event 是 inner runtime 事件。

coordinator 可以：

- 摘要。
- 关联到 outer event。
- 展示在 UI。

不应该：

- 根据 event 私有字段推进状态。
- 依赖未声明字段。

## 9. 版本协商

`capabilities` 必须返回 `protocolVersion`。

coordinator 应校验兼容性。

不兼容时：

- 不启动 workflow run。
- 生成 failure surface。
- 提示升级 workflow。

## 10. workflow 需要补充的能力

为更好适配 coordinator，`workflow` 需要补：

- protocol 命令。
- stable handoff。
- stable artifact listing。
- stable event listing。
- profile capabilities。
- blocked reason。
- human request suggestion。

## 10.1 Compatibility Adapter 退出标准

如果第一版必须用兼容适配器包装现有 CLI，适配器只能是临时层。

退出标准：

- `workflow protocol` 的 `capabilities/status/start/action/artifacts/events` 已稳定可用。
- handoff / artifact / event 的 JSON schema 已稳定。
- coordinator 不再依赖旧 CLI 私有输出格式。
- 所有兼容分支都有 contract tests。

如果以上任一条件不满足，compatibility adapter 只能保留为临时实现，不能成为隐式协议真源。

## 10.2 coordinator 已落地 adapter 事实

截至 `Iteration 6: Workflow Protocol Adapter`，`coordinator` 已落地外层 adapter：

- 支持 capabilities/start/status/action/artifacts/events。
- capabilities 在 project repo 中执行，用于获得 protocol version、implemented profiles、commands 和 handoff kinds。
- start/status/action/artifacts/events 在 ready workspace repo 中执行。
- start 支持 omitted/default/auto 语义，由 workflow runtime 返回 actual profile；human explicit selection 由 operator/task input 提供，不来自 outer Agent。
- start/action 是副作用，必须走 operation、lock、fencing 和 idempotency。
- action 必须携带 expected workflow run state version，避免响应丢失后基于最新状态重复执行同一副作用。
- action idempotency key 使用 canonical JSON hash，不直接拼接 action/arg。
- stage/substate/gate/allowedActions/deniedActions 只作为 debug payload，不作为外层状态迁移依据。
- workflow artifact/event 仅作为 protocol 暴露的只读引用进入外层 event，不作为 coordinator tool payload。

仍待后续 daemon/reconciliation 迭代补齐：

- `unknown` workflow operation 的 inspect/reconcile 矩阵。
- protocol 返回 run id 与当前 external id 的一致性校验。
- protocol 返回 actual profile 与当前 workflow run 记录的一致性校验。
- capabilities.commands 的 command gate。

## 11. 禁止事项

- coordinator 不读写 `.workflow` 状态文件。
- coordinator 不扫描 workflow artifact 来猜 completion。
- coordinator 不把 workflow stage/substate 映射为 handoff。
- coordinator 不把 workflow stage/substate/gate/allowedActions 当成外层状态迁移依据。
- coordinator 不让 outer Agent 选择 workflow profile。
- coordinator 不把 `default` 或 `auto` 当作 actual profile。
- coordinator 不把 OpenSpec 状态当成 workflow 完成状态。
- coordinator 不直接调用 OpenSpec 替 workflow 完成内部流程。
- coordinator 不把 workflow private fixture 当成 protocol。
