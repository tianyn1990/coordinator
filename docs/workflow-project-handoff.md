# workflow 工程交接文档

> 状态：交接给 `/Users/hetao/Documents/github/workflow` 工程的实现说明  
> 目标读者：负责 `workflow` 工程的 agent / 开发者  
> 来源：`coordinator` 与 `workflow` 的多轮设计共识，以及 `coordinator` 当前已落地的 workflow protocol adapter  
> 目标：让 `workflow` 补齐稳定 `workflow protocol` 出口，使 `coordinator` 可以开始真实联调和后续端到端实测。

## 1. 背景与目标

`coordinator` 是外层任务协调系统，负责从任务创建、规划、workspace、workflow run、PR/MR、human review、merge 到 done 的外层闭环。

`workflow` 是内层代码变更执行协议，负责单个代码工作单元内部的阶段化执行，包括 profile、requirements、implementation、review、stage、substate、gate、OpenSpec 使用时机和 inner coding agent 的可见面。

两者的边界是：

```text
coordinator 管任务如何被完成。
workflow 管一次代码变更内部如何规范执行。
```

当前 `coordinator` 侧已经实现了 `Workflow Protocol Adapter`，它只通过稳定命令和 JSON stdout 与 `workflow` 通信，不读取、不修改 `.workflow` 私有状态。现在需要 `workflow` 工程补齐对应的正式协议出口。

本次交接给 `workflow` 工程的任务是：

```text
新增一个薄的 workflow protocol bridge，
把 workflow 已有 runtime/control plane 的最小机器事实，
稳定暴露给 coordinator。
```

这不是让 `workflow` 变成外层 orchestrator，也不是把 coordinator 的状态机搬进 workflow。

## 2. 必须先阅读的 workflow 文档

负责实现前，请在 `workflow` 工程中先阅读：

- `AGENTS.md`
- `openspec/AGENTS.md`
- `docs/architecture.md`
- `docs/visibility.md`
- `docs/contracts.md`
- `docs/workflow-profiles.md`
- `docs/execution-plan.md`

如果实现需要新增或调整设计，请按 `workflow` 工程自己的 OpenSpec 流程创建 change，并遵守它的设计对齐约束。

建议 change id：

```text
add-coordinator-protocol-bridge
```

## 3. 总体边界

### 3.1 workflow 可以做什么

`workflow` 可以：

- 在自己的 runtime 内读取 `.workflow` 机器状态。
- 把 run 的稳定事实转换成 protocol JSON。
- 通过 protocol 命令启动 run、查询 run、执行 action、列出 artifact 和 event。
- 根据自身 runtime truth 生成 handoff。
- 将 stage/substate/gate/allowedActions/deniedActions 作为 debug/display 字段返回。

### 3.2 workflow 不应该做什么

`workflow` 不应该：

- 替 `coordinator` 管理 task、attempt、workspace、PR/MR、merge approval 或 human review。
- 把外层任务状态机塞进 `.workflow`。
- 为 `coordinator` 推断 PR/MR 是否可以 merge。
- 引入复杂 JSON 参数作为主交互协议。
- 把 OpenSpec 状态直接当成外层完成状态。
- 把 protocol bridge 做成第二控制面，绕过现有 runtime。
- 为适配 `coordinator` 改变既有 `runtime 单控制面`、`coding agent 可见性优先`、`profile 受控`、`复杂内容写 artifact` 等核心心智。

### 3.3 coordinator 不会做什么

`coordinator` 不会：

- 直接读取 `.workflow/current-run.json`。
- 直接读取 `.workflow/runs/<run-id>/state.json`。
- 直接写 `.workflow` 内部文件。
- 根据文件存在与否猜测 workflow 是否完成。
- 根据 `stage/substate/gate` 推导外层 `pr_ready`。
- 根据 `allowedActions/deniedActions` 推导 Coordinator Agent tool visibility。

因此，`workflow` 必须通过 protocol 明确告诉 `coordinator`：

- 当前 run 是否 active / completed / failed / unknown。
- 是否产生 handoff。
- handoff 是什么类型。
- 哪些 artifact 是交接所需证据。
- 下一步建议是什么。
- 如果受阻，建议如何恢复或是否需要 human request。

## 4. 需要新增的命令

`workflow` 需要支持以下命令：

```bash
workflow protocol capabilities
workflow protocol start --workflow <profile>
workflow protocol status --run <run-id>
workflow protocol action --run <run-id> <action> [arg]
workflow protocol artifacts --run <run-id>
workflow protocol events --run <run-id>
```

共同要求：

- stdout 必须只输出稳定 JSON。
- stderr 可输出诊断信息，但 `coordinator` 不依赖 stderr 语义。
- exit code 非 0 表示 protocol 调用失败；failure JSON envelope 可作为人工诊断和未来 adapter 扩展，但 `coordinator` v1 只按非 0 exit 处理失败，不解析失败 stdout 作为状态。
- 参数保持窄，不接受复杂嵌套 JSON。
- 所有 path 返回相对 workspace repo 的稳定相对路径，优先是 `.workflow/runs/<run-id>/...`。
- `--run <run-id>` 只定位已有 run，不创建 run，不切换 active run pointer。
- protocol 命令应复用现有 runtime action 和 state 读写机制，不直接绕过 runtime 改状态。

## 4.1 workflowLauncher 约束与本地联调

`coordinator` 当前通过 `execFileSync(launcher, args)` 调用 workflow launcher。

因此 `workflowLauncher` 必须是：

- PATH 上可找到的可执行命令名，例如 `workflow`。
- 或一个可执行文件的绝对路径，例如 `/absolute/path/to/node_modules/.bin/workflow`。

`workflowLauncher` 不允许配置成带参数的 shell 字符串，例如：

```text
node /Users/hetao/Documents/github/workflow/bin/workflow.mjs
```

原因是 `execFileSync(launcher, args)` 不会拆分命令和参数；为了本地源码联调支持带空格 launcher 会引入 shell 解析、安全和跨平台问题。

正式发布或 npm 安装后，推荐：

```text
workflowLauncher = /absolute/path/to/node_modules/.bin/workflow
```

或在 coordinator 运行环境的 `PATH` 能找到已安装版本时：

```text
workflowLauncher = workflow
```

如果需要测试 workflow 本地源码，不要依赖已发布 npm 包，也不要把 launcher 写成 `node ...`。建议创建临时 wrapper：

```bash
mkdir -p /tmp/local-workflow-bin

cat > /tmp/local-workflow-bin/workflow <<'EOF'
#!/usr/bin/env bash
exec node /Users/hetao/Documents/github/workflow/bin/workflow.mjs "$@"
EOF

chmod +x /tmp/local-workflow-bin/workflow
export PATH="/tmp/local-workflow-bin:$PATH"
```

然后在 coordinator 的 project config 中使用：

```text
workflowLauncher = workflow
```

或直接使用：

```text
workflowLauncher = /tmp/local-workflow-bin/workflow
```

`WORKFLOW_STATE_DIR` 的使用也要保持隔离：

- 真实 coordinator 运行时不需要全局设置 `WORKFLOW_STATE_DIR`；coordinator 会把 protocol 命令的 `cwd` 切到 workspace repo，workflow 默认写入该 workspace 下的 `.workflow`。
- 只有单 workspace 手工 smoke test 时，才建议临时设置 `WORKFLOW_STATE_DIR="$PWD/.workflow"`。
- 不要把 `WORKFLOW_STATE_DIR` 固定到某个全局 `/tmp/...` 后跑多个 task 或多个 workspace，否则会破坏 workspace 隔离。

## 5. JSON schema 要求

### 5.1 capabilities

命令：

```bash
workflow protocol capabilities
```

语义：

- 在 project repo 中执行。
- 返回 protocol version、已实现 workflow profile、可用 protocol 命令和支持的 handoff kind。
- profile 真源来自 workflow 自己的 profile catalog。
- 只能把真正可启动的 profile 标记为 `implemented=true`。

示例：

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

字段说明：

| 字段 | 要求 |
| --- | --- |
| `protocolVersion` | 当前固定为 `"1"`。 |
| `profiles[].id` | profile id，必须与 `workflow start --workflow <id>` 使用的 id 一致。 |
| `profiles[].purpose` | 给 Coordinator Agent 阅读的简短用途说明。 |
| `profiles[].implemented` | 只有已实现、可启动的 profile 才为 `true`。 |
| `commands` | 当前 protocol 支持的命令名。 |
| `handoffKinds` | 当前 protocol 可能返回的 handoff kind。 |

### 5.2 start

命令：

```bash
workflow protocol start --workflow <profile>
```

语义：

- 在 ready workspace repo 中执行。
- 通过 workflow runtime 创建新 run。
- 不接受复杂需求 JSON；需求、计划等复杂内容仍由 coding agent 根据 workflow surface 写 artifact。
- 返回内容可以包含 stage/substate/gate 作为 debug/display，但外层状态只能依赖 `lifecycle + handoff + artifacts + recovery + summary`。

建议输出：

```json
{
  "runId": "run-...",
  "profile": "feature",
  "lifecycle": "active",
  "stage": "requirements",
  "substate": null,
  "gate": {
    "state": "open",
    "reason": null
  },
  "allowedActions": [],
  "deniedActions": [],
  "summary": "workflow run started",
  "currentChange": {
    "available": false,
    "id": null
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

兼容说明：

- `coordinator` 当前 adapter 更关注 `lifecycle`，但也可兼容部分旧 start 输出中的 `status`。建议 workflow 直接输出 `lifecycle`，不要只输出 `status`。
- `stage/substate/gate/allowedActions/deniedActions` 只是 debug/display 字段，不应被 `workflow` 设计为外层控制语义。

### 5.3 status

命令：

```bash
workflow protocol status --run <run-id>
```

语义：

- 在 ready workspace repo 中执行。
- 只查询指定 run。
- 不创建 run。
- 不切换 active run pointer。
- 返回指定 run 当前 protocol status。

建议输出：

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

`lifecycle` 建议枚举：

```text
active
completed
failed
unknown
```

约束：

- `blocked` 不是 `lifecycle`。阻塞必须通过 `handoff.available=true` 且 `handoff.kind="blocked"` 表达，避免和 `coordinator` 当前 adapter 的生命周期枚举冲突。
- `stage/substate/gate` 可以帮助 operator 排查，但不等于 handoff。
- `allowedActions/deniedActions` 是 workflow 内层 runtime action，不等于 coordinator 外层 agent tools。
- `currentChange` 是 workflow/OpenSpec 相关事实，不等于外层 PR readiness。

### 5.4 action

命令：

```bash
workflow protocol action --run <run-id> <action> [arg]
```

语义：

- 在 ready workspace repo 中执行。
- 必须复用 workflow 现有 runtime action 路径。
- `action` 是窄字符串。
- `arg` 是可选窄字符串。
- 如果某个 action 需要复杂上下文，应由 workflow surface 指导 inner coding agent 写 artifact，而不是让 coordinator 传复杂 JSON。
- 输出 shape 与 `status` 相同，表示 action 后的最新状态。

示例：

```json
{
  "runId": "run-...",
  "profile": "feature",
  "lifecycle": "active",
  "stage": "review",
  "substate": "triage",
  "gate": {
    "state": "open",
    "reason": null
  },
  "allowedActions": ["complete-commit"],
  "deniedActions": ["skip-runtime"],
  "summary": "workflow action applied",
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

### 5.5 artifacts

命令：

```bash
workflow protocol artifacts --run <run-id>
```

语义：

- 只列出 workflow 愿意暴露给 coordinator 的只读 artifact 引用。
- 不要求 coordinator 扫描 artifact 目录。
- 不要求 artifact 一定存在于固定种类全集中，但 handoff 必需 artifact 应明确 `requiredForHandoff=true`。

建议输出：

```json
{
  "runId": "run-...",
  "artifactRoot": ".workflow/runs/run-.../artifacts",
  "artifacts": [
    {
      "kind": "summary",
      "path": ".workflow/runs/run-.../artifacts/summary.md",
      "requiredForHandoff": true
    },
    {
      "kind": "validation",
      "path": ".workflow/runs/run-.../artifacts/validation-report.md",
      "requiredForHandoff": false
    }
  ]
}
```

artifact kind 建议先保持有限、直观：

```text
summary
validation
handoff
blocked-summary
human-question
review-summary
remaining-work
```

### 5.6 events

命令：

```bash
workflow protocol events --run <run-id>
```

语义：

- 返回 workflow 内层 observability 的只读引用和最近摘要。
- `coordinator` 可以展示摘要和路径，但不会依赖未声明字段推进状态。
- 不要返回大块 raw log。

建议输出：

```json
{
  "runId": "run-...",
  "eventsPath": ".workflow/runs/run-.../observability/events.jsonl",
  "latest": [
    {
      "timestamp": "2026-05-05T00:00:00.000Z",
      "type": "workflow-action",
      "summary": "action completed: run-alignment-checks"
    }
  ]
}
```

## 6. Handoff 设计要求

`handoff` 是本次适配最重要的字段。

`coordinator` 不会从 `stage/substate/gate` 猜 handoff。因此 `workflow` 需要明确输出 `handoff`。

### 6.1 Handoff 基本 shape

```json
{
  "available": true,
  "kind": "pr_ready",
  "reason": "workflow completed review/commit readiness",
  "artifacts": [
    {
      "kind": "summary",
      "path": ".workflow/runs/run-.../artifacts/summary.md"
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

当没有 handoff：

```json
{
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
}
```

### 6.2 Handoff kind

第一版支持：

```text
pr_ready
human_review_required
manual_handoff
blocked
completed_no_pr
```

#### pr_ready

含义：

- workflow 认为当前代码变更内部流程已经达到可由 coordinator 创建 PR/MR 的交接点。
- 这不代表 PR/MR review 通过，也不代表可以 merge。
- merge readiness 和 human approval 仍由 coordinator 管。

要求：

- 必须提供至少一个 summary / handoff artifact。
- 建议提供 validation / review summary artifact。
- `nextStep.action` 建议为 `create-pr`。

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

#### blocked

含义：

- workflow 内层遇到阻塞。
- 可能需要人确认、权限补充、外部依赖、技术决策或手动处理。
- Coordinator Agent 可以判断是否自行消化；如果不能，才创建 human request。

要求：

- 必须提供 `reason`。
- 建议提供 `blocked-summary` artifact。
- 可提供 `humanRequestSuggestion`，但它只是建议，不自动创建 human request。

示例：

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
    "summary": "需要确认是否接受当前技术取舍。"
  }
}
```

#### human_review_required

含义：

- workflow 明确需要人类 review 或确认，且该确认属于内层工作流推进所需。
- coordinator 收到后通常会让 Coordinator Agent 判断是否转成 outer HumanRequest。

适用例子：

- 需求存在未确认取舍。
- 技术方案需要开发者确认。
- review findings 需要人决定是否接受风险。

#### manual_handoff

含义：

- workflow 无法继续自动推进，但也不一定是阻塞错误。
- 需要把当前 run 状态、完成内容、剩余工作交给外层或人类。

适用例子：

- scope 变大，建议拆 task。
- 当前 workflow profile 不适合继续。
- 需要外层重新规划。

#### completed_no_pr

含义：

- workflow 明确完成，但不需要由 coordinator 创建 PR/MR。
- 这通常只适合 no-code、文档外交接、或外层明确允许无 PR 的任务。

约束：

- coordinator 不会因为 `completed_no_pr` 自动把普通代码任务当成 done。
- 如果 workflow 不确定，应返回 `manual_handoff`，不要返回 `completed_no_pr`。

## 7. 和 coordinator 当前实现的对接事实

`coordinator` 当前 adapter 已经按以下方式实现：

- `capabilities` 在 project repo 中执行。
- `start/status/action/artifacts/events` 在 ready workspace repo 中执行。
- `workflowLauncher` 被当作 executable 直接调用，不能是带参数的 shell 字符串。
- `start` 和 `action` 是副作用，coordinator 侧已有 operation、idempotency、lock 和 fencing。
- `action` 调用需要 expected workflow run state version，由 coordinator 自己管理；workflow 只需要保持 protocol action 的 run/action/arg 语义稳定。
- coordinator 会校验 protocol JSON。
- coordinator v1 只消费成功 stdout 的 JSON；失败时以非 0 exit 进入 protocol failure，不解析 failure JSON 为 workflow 状态。
- `runId/profile mismatch` 会被视为 protocol consistency violation。
- `stage/substate/gate/allowedActions/deniedActions` 只进入 debug/event payload，不驱动外层状态。
- `handoff.kind=pr_ready` 是创建 PR/MR 的唯一 workflow 完成信号。
- workflow artifact/event 只作为只读引用进入 coordinator。

这意味着 workflow 侧最重要的兼容要求是：

```text
同一个 run 的 status/action/artifacts/events 必须稳定返回相同 runId 和 profile。
```

## 8. 建议实现策略

建议在 workflow 工程中做薄桥接：

```text
workflow CLI
  └─ protocol 子命令
       ├─ capabilities -> profile catalog
       ├─ start        -> existing runtime start + protocol projection
       ├─ status       -> existing run state read + protocol projection
       ├─ action       -> existing runtime action + protocol projection
       ├─ artifacts    -> run artifact listing projection
       └─ events       -> run event listing projection
```

关键点：

- protocol 子命令不应该复制一套 runtime 状态机。
- protocol projection 可以读取 workflow 自己的 persisted run state，但只输出稳定字段。
- 如果现有 CLI 已经有 `start/status/action`，protocol start/status/action 应尽量复用这些内部函数或同一运行路径。
- 如果短期只能包装现有 CLI 输出，也必须标记为 compatibility adapter，并通过 contract tests 固定退出标准。

## 9. 建议 OpenSpec 内容

### 9.1 proposal 应写清

- 为什么要新增 coordinator protocol bridge。
- 它是 workflow runtime 的外部稳定出口，不是第二控制面。
- 本次只增加 protocol 命令、JSON projection、handoff、artifact/event listing 和测试。
- 不改变 workflow profile 的核心语义。
- 不引入复杂 JSON 参数。
- 不实现 coordinator 外层任务状态机。

### 9.2 design 应写清

- protocol 命令如何复用现有 runtime。
- `--run` 如何定位已有 run 且不切换 active pointer。
- protocol status 如何从 run state 投影出 `lifecycle + handoff + artifacts + recovery + summary`。
- stage/substate/gate 为什么只是 debug/display。
- handoff kind 的生成规则。
- artifact listing 和 event listing 的只读边界。
- 错误、exit code、stderr/stdout 约定。
- compatibility adapter 如存在，什么时候退出。

### 9.3 tasks 建议

```text
- [ ] 1.1 阅读并对齐 AGENTS.md、openspec/AGENTS.md、docs/architecture.md、docs/visibility.md、docs/contracts.md、docs/workflow-profiles.md、docs/execution-plan.md
- [ ] 1.2 创建 OpenSpec change: add-coordinator-protocol-bridge
- [ ] 2.1 增加 protocol capabilities 命令
- [ ] 2.2 增加 protocol start 命令，复用 existing runtime start
- [ ] 2.3 增加 protocol status 命令，支持 --run 且不切换 active pointer
- [ ] 2.4 增加 protocol action 命令，复用 existing runtime action
- [ ] 2.5 增加 protocol artifacts 命令
- [ ] 2.6 增加 protocol events 命令
- [ ] 3.1 增加 protocol projection 层，统一输出 JSON shape
- [ ] 3.2 增加 handoff projection，支持 pr_ready / human_review_required / manual_handoff / blocked / completed_no_pr
- [ ] 3.3 增加错误输出约定，确保 stdout 只输出 JSON
- [ ] 4.1 增加 contract tests 覆盖 capabilities/start/status/action/artifacts/events
- [ ] 4.2 增加 tests 覆盖 status --run 不切换 active pointer
- [ ] 4.3 增加 tests 覆盖 action 不接受复杂 JSON 主载荷
- [ ] 4.4 增加 tests 覆盖 stage/substate/gate 不被表述为外层 handoff
- [ ] 4.5 增加 tests 覆盖 handoff artifact refs
- [ ] 4.6 增加 tests 覆盖 malformed state / missing run 的受控失败
- [ ] 5.1 运行 workflow 测试、typecheck、fixtures check、OpenSpec validate
- [ ] 5.2 独立 review，显式检查是否符合 workflow 总体设计心智
- [ ] 5.3 修复 review 问题并复验
- [ ] 5.4 归档 OpenSpec change 并提交
```

## 10. 测试与验收标准

workflow 工程完成后，请至少证明以下命令可用：

```bash
workflow protocol capabilities
workflow protocol start --workflow feature
workflow protocol status --run <run-id>
workflow protocol action --run <run-id> <action>
workflow protocol artifacts --run <run-id>
workflow protocol events --run <run-id>
```

验收标准：

- `capabilities` 返回 `protocolVersion="1"`。
- `capabilities.profiles` 来自受控 profile catalog。
- `start` 可以创建 run，并返回 `runId/profile/lifecycle/artifactRoot/handoff`。
- `status --run` 可以读取指定 run，不切换 active pointer。
- `action --run` 复用 runtime action，输出 action 后 status。
- `artifacts` 只返回 protocol 暴露的只读 artifact refs。
- `events` 只返回 events path 和最近摘要，不返回大块 raw log。
- `handoff.available=false` 时，不应暗示可以 create PR。
- `handoff.kind=pr_ready` 时，必须有交接 artifact。
- `lifecycle` 只能是 `active/completed/failed/unknown`；阻塞状态通过 `handoff.kind=blocked` 表达。
- blocked / human_review_required / manual_handoff 必须有 reason 和 nextStep。
- stdout 始终是合法 JSON。
- malformed run state、missing run、unsupported profile、unsupported action 都返回受控失败；failure JSON 可用于诊断，但 coordinator v1 不依赖解析 failure JSON。
- 不新增外层 task/PR/merge/human review 状态机。
- 不引入复杂 JSON 参数。

## 11. coordinator 侧后续会如何实测

workflow 完成 protocol bridge 后，`coordinator` 会进入下一轮联调：

```text
register project
create task
create attempt
create workspace
workflow capabilities
workflow start
workflow status
workflow action
workflow artifacts/events
```

然后再进入最小 E2E：

```text
manual task
daemon tick
outer fake agent 写 plan
create attempt
create workspace
start workflow
workflow handoff
create fake PR
request merge approval
operator approve
merge fake PR
done / merged
```

再之后才接真实 GitHub/GitLab、Codex/Claude Code 和长运行 daemon。

因此 workflow 本轮交付不需要一次性证明完整无人值守闭环，只需要把协议出口做稳定、可测、可诊断。

## 12. 特别提醒

- 不要为了适配 coordinator 读取或暴露过多 workflow private state。
- 不要让 protocol 输出依赖自然语言格式。
- 不要把 stage/substate/gate 当作外层完成信号。
- 不要输出 `lifecycle: "blocked"`；阻塞通过 `handoff.kind="blocked"` 表达。
- 不要把 OpenSpec validate/archive 成功直接等价为 `pr_ready`。
- 不要新增复杂 JSON action payload。
- 不要让 protocol bridge 变成第二套 runtime。
- 如果某个判断需要 coding agent 语义判断，优先通过 workflow surface 和 artifact 引导 coding agent 完成，再由 runtime 暴露明确 handoff。
- 如果不确定某个字段是否应该进入 protocol，优先少暴露，用 artifact ref 或 summary 表达。

## 13. 最小交付版本建议

如果希望快速进入联调，第一批可以按这个顺序落：

1. `capabilities`
2. `start`
3. `status`
4. `artifacts`
5. `events`
6. `action`
7. `handoff` 从 `available=false` 开始，然后补 `pr_ready` / `blocked`

但最终进入 coordinator 实测前，至少需要：

- `capabilities/start/status/action/artifacts/events` 全部存在。
- `status` 能稳定返回 `handoff`。
- `pr_ready` 的生成规则已被 contract tests 固定。
- `blocked/manual_handoff` 的受控输出已被 tests 覆盖。
