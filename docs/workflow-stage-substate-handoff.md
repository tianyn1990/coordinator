# workflow stage/substate 展示交接文档

> 状态：交接给 `/Users/hetao/Documents/github/workflow` 工程的 protocol 展示增强说明  
> 来源：`coordinator` Web V2 多任务工作台、Run Matrix、Focus Drawer 与 Workflow Lens 设计
> 目标读者：负责 `workflow` 工程的 agent / 开发者

> 当前约束：本期 Coordinator 不推进 `/Users/hetao/Documents/github/workflow` 修改，也不要求 workflow protocol 立即变更。本文保留为未来交接参考；Coordinator 侧现阶段必须兼容字段缺失，并且不得把 `allowedActions/actionInputs` 直接升级为 Web needs-me。

> 最新 Coordinator 侧落地：当前 Web/daemon/operator summary 已通过只读 `workflow runtime observation` 把 only internal/debug action 解释为 `observing-runtime`，把明确人工 gate 解释为 `waiting-operator-gate`。这不改变本文对 workflow protocol 的未来建议，也不要求 workflow 本期新增字段。

## 1. 背景

`coordinator` 的核心目标不是替代 `workflow`，而是让一个开发者可以同时管理多个工程、多个任务，并只在真正需要人工判断时介入。

在真实使用中，大部分任务时间会停留在 `workflow` 内部执行阶段。Web 只显示外层 task / attempt / workspace / workflow run 的粗粒度状态时，用户能看到任务仍在 running，却难以判断：

- workflow 当前处于哪个主阶段。
- 主阶段内部走到了哪个子阶段。
- 是否被 gate 阻塞。
- 当前允许或禁止哪些 workflow 内部 action。
- 是否已经产生 handoff。
- 当前阶段有哪些关键 artifact 可供理解进度。

`coordinator` 侧已经通过 `workflow protocol status` 解析 `stage`、`substate`、`gate`、`allowedActions`、`deniedActions`、`actionInputs` 等 debug/display 字段，并明确这些字段不驱动外层状态机。为了让 Web Cockpit 能稳定、直观地展示 workflow 进度，需要 `workflow` 工程把这些字段正式化、稳定化，并尽量在所有 workflow profile 中一致输出。

## 2. 目标

请在 `/Users/hetao/Documents/github/workflow` 工程中完成：

- 将主阶段 `stage` 与子阶段 `substate` 作为稳定 protocol projection 输出。
- 将 `gate`、`allowedActions`、`deniedActions`、`actionInputs` 作为 operator/debug 展示字段稳定输出。
- 为 Web 展示补充面向人的进度摘要，例如 `progress`。
- 为当前阶段补充关键 artifact 引用，例如 `stageArtifacts`。
- 补充 protocol docs 与 contract tests，确保不同 workflow profile 的输出语义一致。

建议 change id：

```text
stabilize-protocol-stage-substate-projection
```

## 3. 非目标与边界

本改造不是让 `coordinator` 接管 workflow 内部控制面。

`workflow` 仍然负责：

- workflow profile。
- stage / substate / gate。
- inner agent 可见面。
- workflow action。
- workflow handoff。

`coordinator` 只做：

- 启动 workflow run。
- 查询 workflow status / artifacts / events。
- 在 Web operator surface 展示 workflow 进度。
- 根据稳定 handoff 消费 workflow 结果。

`coordinator` 不会：

- 读取或写入 `.workflow` private state。
- 根据 `stage` / `substate` / `gate` 推导 `pr_ready`、`done` 或 `merge`。
- 根据 `allowedActions` / `actionInputs` 自动执行 workflow action。
- 根据 `allowedActions` / `actionInputs` 自动生成 Needs-Me Gate Inbox item 或人工待办。
- 把 workflow debug 字段暴露给外层 Coordinator Agent 作为 agent tool。
- 让 daemon 基于 workflow 内部 action 做自动推进。

上层语义保持不变：

```text
workflow 管一次代码变更内部如何规范执行。
coordinator 管多个任务如何被开发者协调、观察和收口。
```

## 4. 建议 Status Schema

`workflow protocol status --run <run-id>` 建议稳定返回：

```json
{
  "ok": true,
  "protocolVersion": "1",
  "runId": "run-1779250522858",
  "profile": "feature",
  "lifecycle": "active",
  "stage": "implementation",
  "substate": "test-align",
  "gate": {
    "state": "open",
    "reason": null
  },
  "progress": {
    "label": "Implementation",
    "summary": "正在对齐实现与测试，尚未产生 handoff。",
    "ordinal": 3,
    "total": 5
  },
  "allowedActions": ["run-alignment-checks"],
  "deniedActions": ["skip-runtime"],
  "actionInputs": {
    "materialize-change": {
      "requiredArgs": ["change-id"],
      "usage": "workflow protocol action --run run-1779250522858 materialize-change <change-id>"
    }
  },
  "stageArtifacts": [
    {
      "kind": "plan",
      "path": ".workflow/runs/run-1779250522858/artifacts/plan.md",
      "label": "Implementation plan"
    },
    {
      "kind": "summary",
      "path": ".workflow/runs/run-1779250522858/artifacts/status-summary.md",
      "label": "Current status summary"
    }
  ],
  "handoff": {
    "available": false,
    "kind": null,
    "artifacts": [],
    "nextStep": {
      "action": "continue-workflow",
      "guidance": "workflow run has not produced a handoff yet"
    },
    "recovery": {
      "action": "inspect-or-resume-workflow",
      "guidance": "inspect workflow status or resume the workflow run"
    }
  },
  "artifactRoot": ".workflow/runs/run-1779250522858/artifacts",
  "eventLog": ".workflow/runs/run-1779250522858/observability/events.jsonl"
}
```

### 4.1 stage

`stage` 是当前 workflow 主阶段。

建议要求：

- 使用稳定短 id，而不是面向 UI 的长句。
- 同一 profile 内的 stage id 应稳定。
- 不同 profile 可以有不同 stage 集合，但相同语义优先复用相同 id。
- 不要把 OpenSpec 具体文件名、内部函数名或临时实现细节作为 stage id。

示例：

```text
requirements
design
implementation
review
handoff
```

### 4.2 substate

`substate` 是当前主阶段内部的细粒度状态。

建议要求：

- 可为 `null`。
- 使用稳定短 id。
- 只表达 workflow 内部执行位置，不表达 coordinator 外层结论。
- 不要通过 substate 暗示 PR/MR ready；PR/MR ready 必须通过 handoff 表达。

示例：

```text
collect-context
draft-spec
materialize-change
edit-code
test-align
review-fixes
handoff-ready
```

### 4.3 gate

`gate` 表示 workflow 内部控制门。

建议最小结构：

```json
{
  "state": "open",
  "reason": null
}
```

`state` 建议使用：

```text
open
blocked
waiting
closed
unknown
```

`reason` 应是短摘要，不应包含完整 private state、secret、绝对路径或大段日志。

### 4.4 progress

`progress` 是给 Web 展示用的稳定摘要，不参与 coordinator 状态机。

建议字段：

```text
label: 面向人的当前阶段名称。
summary: 一句话说明当前正在做什么。
ordinal: 当前阶段序号，可选。
total: 总阶段数，可选。
```

`ordinal` / `total` 只用于 UI 展示，不代表 workflow 的精确百分比，也不应被 coordinator 用来判断完成。

### 4.5 allowedActions / deniedActions

`allowedActions` 与 `deniedActions` 继续表示 workflow 内部控制面。

要求：

- 只放稳定 action id。
- 不要求 coordinator 自动执行。
- 不应把需要复杂 JSON 输入的 action 设计成主路径。
- 需要参数的 action 应在 `actionInputs` 中给出窄提示。

### 4.6 actionInputs

`actionInputs` 已有独立交接说明，见 `docs/workflow-action-inputs-handoff.md`。

本文件只补充一点：当 action 需要参数时，`actionInputs` 应在对应 stage/substate 中稳定出现，方便 operator 理解如何手动 debug。

### 4.7 stageArtifacts

`stageArtifacts` 是当前阶段最有助于理解进度的 artifact 引用。

建议字段：

```text
kind: artifact 类型，例如 plan / summary / report / handoff。
path: 相对 workspace repo 的稳定相对路径。
label: 面向人的短名称，可选。
requiredForHandoff: 是否是 handoff 证据，可选。
```

要求：

- path 必须是相对路径。
- 不返回绝对路径。
- 不返回 `.workflow` private state 文件。
- 不返回 symlink escape 路径。
- artifact 正文仍通过 artifacts 机制读取或由用户进入 workspace 查看，不塞进 status JSON。

## 5. Coordinator 展示语义

`coordinator` Web 会把 workflow 进度放在两个位置：

- Run Matrix 任务行：展示 `profile`、`lifecycle`、`stage`、`substate`、`gate.state`、`handoff.available` 的短摘要。
- Focus Drawer / Workflow Lens：展示 stage rail、substate detail、gate、allowed/denied actions、action input hints、stage artifacts 和 latest events。

示意：

```text
Workflow
  profile: feature
  lifecycle: active
  stage: implementation
  substate: test-align
  gate: open
  handoff: none
```

这些字段不会进入外层 Coordinator Agent Markdown surface，也不会改变 agent tools visibility。

## 6. 兼容性

为了渐进发布，`coordinator` 应继续兼容缺失字段：

- 缺失 `stage`：显示 `unknown`。
- 缺失 `substate`：显示 `none`。
- 缺失 `gate`：显示 `unknown`。
- 缺失 `progress`：使用 `summary` 或 stage/substate 拼出短摘要。
- 缺失 `stageArtifacts`：退回展示 handoff/artifacts 列表。

`workflow` 可以分阶段补齐，但一旦字段进入正式 docs，应保持字段名和基础语义稳定。

## 7. 测试建议

请在 workflow 工程补充 contract tests：

- `status` 在 requirements 阶段返回稳定 `stage=requirements`。
- `status` 在 implementation 阶段返回稳定 `stage=implementation` 与具体 `substate`。
- `status` 在 review 阶段返回稳定 `stage=review`。
- gate blocked 时返回 `gate.state=blocked` 和短 `reason`。
- 需要参数的 action 在 `actionInputs` 中返回窄参数提示。
- `stageArtifacts` 只包含相对路径，不包含 private state、绝对路径或完整 artifact 正文。
- `stage/substate/gate` 不改变 handoff 语义；只有 handoff available 才表示可被 coordinator 消费。
- 不同 profile 的 status 输出都符合相同顶层 schema。

## 8. 验收标准

完成后，`coordinator` 应能仅通过 `workflow protocol status/artifacts/events` 在 Web 中展示：

- 当前 workflow profile。
- 当前主阶段和子阶段。
- 当前 gate 状态和原因。
- 当前 workflow 内部 action 可见性。
- 当前阶段关键 artifacts。
- 是否已经产生 handoff。

同时仍满足：

- `coordinator` 不读写 `.workflow` private state。
- daemon 对 running workflow 仍是 inspect-only。
- outer Coordinator Agent 不选择 workflow 内部 action。
- PR/MR readiness、done、merge 仍只由 handoff、PR provider 和 Core policy gate 决定。
