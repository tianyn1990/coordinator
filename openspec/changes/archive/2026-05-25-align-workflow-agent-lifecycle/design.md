## Context

Coordinator 当前已经有一条 operator workflow action 通道：Web 提交 operator intent，API 调 Core helper，Core 重新 inspect latest workflow status 后受控执行 `workflow protocol action`。这条链路适合 `freeze-requirements` 这类人工 gate，但当前 Web 仍把 `allowedActions` 直接理解成 Action Panel 的数据源，导致 `materialize-change <change-id>` 这类 workflow / inner coding agent 内部动作被推给开发者。

本轮设计只调整 Coordinator 侧解释与展示，不修改 `/Users/hetao/Documents/github/workflow`，也不要求 workflow protocol 新增 `operatorActions`、`agentActions`、`blocker.owner` 或 `agent.state`。这些字段只作为未来交接方向。

## Goals / Non-Goals

**Goals:**

- 在 Core 中建立保守 workflow action classification，让 operator-only endpoint 只能执行 operator-facing gate。
- 让 Web Workflow Action Panel / Action Inbox 只展示 operator-facing action。
- 让 `materialize-change <change-id>` 等 agent/internal action 仅作为 Workflow Lens debug/detail 展示，不要求 developer 手动填参数。
- 调整 `Run until blocked` 的 operator explanation，区分 observing、waiting operator gate、handoff ready 和 operator attention。
- 继续保证 daemon / outer Agent 不自动执行 workflow action，不读取 `.workflow` private state，不扩大 Coordinator Agent Surface。

**Non-Goals:**

- 不修改 workflow 工程或 workflow protocol。
- 不引入新的 protocol ownership 字段。
- 不让 daemon 或 outer Agent 自动调用 `materialize-change`、`run-alignment-checks` 等 internal action。
- 不在本轮引入 Codex / Claude SDK adapter；SDK-first provider runtime 属于后续 Slice 14.2。
- 不改变 PR/MR/review/merge human approval gate。

## Decisions

### 1. Classification 放在 Core，而不是 Web

Core 增加可测试的 action classification helper，返回 `operator-facing`、`agent-internal` 或 `debug-only/unknown`。Web 可以消费 Core/API 返回的 projection 或复用同一共享 helper，但最终执行 gate 必须在 Core helper 中校验。

理由：Web 只是 operator surface，不能成为 workflow action 策略真源。即使前端误展示或旧客户端直接调 API，Core 也必须拒绝非 operator-facing action。

### 2. 使用 conservative allowlist / denylist 过渡

本期 workflow protocol 不提供 owner 字段，因此 Coordinator 侧采用保守分类：

- `freeze-requirements`、`approve-planning-dossier`、`approve-review` 和明确 approval/merge 类 action 是 operator-facing。
- `materialize-change`、`run-alignment-checks`、repair/current-change、inspect/resume 和实现推进类 action 是 agent/internal。
- unknown action 默认 debug-only，不进入 needs-me，也不能通过 operator endpoint 执行。

理由：false positive 会把 workflow 内部复杂度推给开发者；false negative 至多让未知 action 暂时停留在 debug/detail，需要后续显式分类后再进入 operator gate。

### 3. actionInputs 只在 operator-facing action 上变成表单

现有 one string arg 支持保留，但只适用于已被分类为 operator-facing 的 action。agent/internal action 即使带 required arg，也只能在 Workflow Lens debug/detail 中展示 sanitized hint。

理由：`change-id` 这类参数通常应由 workflow runtime / inner coding agent 在其上下文中掌握，Web operator 不应被要求理解 workflow 内部推进参数。

### 4. CLI workflow action 保持低层 debug 通道

既有 CLI `workflow action` 仍保留为 operator/debug 入口，调用底层 Core adapter、operation、lock 和 workflow protocol action。它不进入 Web needs-me、Action Inbox、daemon 自动推进或 Coordinator Agent Surface，也不代表 Coordinator 可以自动执行 internal action。

理由：本轮要修的是 Web/Core operator-facing action loop 的产品语义，不是删除低层调试能力。后续如果要收紧 CLI debug action，也应另开 change 处理兼容性和真实 smoke 排障路径。

### 5. Run Until Blocked 只解释，不写新状态

Web run-until-blocked 继续只循环调用 daemon tick、refresh 和状态查询。停止/观察文案从“workflow 有 allowedActions”改为基于 operator-facing gate、handoff、human request、merge approval、operator attention 和 terminal state 的解释。

理由：Run Until Blocked 是 operator convenience，不是 Core 状态机；它不应把 debug projection 写回 DB 成为新的 blocker。

## Risks / Trade-offs

- [Risk] unknown action 可能其实需要 operator 确认，但被默认放进 debug/detail。  
  Mitigation: 采用显式 allowlist，后续只有经过设计确认的 action 才升级为 operator-facing。
- [Risk] Web 与 Core classification 不一致。  
  Mitigation: Core 执行 helper 是最终 gate；Web 展示层应尽量消费 Core 派生字段或共享 helper，并用 tests 覆盖。
- [Risk] 用户误以为 Coordinator 会自动推进 internal action。  
  Mitigation: banner 文案明确 “observing / waiting runtime”，daemon 仍只 inspect/reconcile，不自动执行 workflow action。
- [Risk] 当前 protocol 缺少 inner agent lifecycle 信号，无法精确判断 agent running/exited。  
  Mitigation: 本轮只做保守策略：internal action 不等于 needs-me；更精确 owner 字段留给未来 workflow protocol 增强。
