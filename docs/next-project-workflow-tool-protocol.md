# 新工程 workflow 工具协议交接文档

> 状态：新工程启动交接  
> 生成时间：2026-05-27 Asia/Shanghai  
> 适用对象：后续负责新工程初始化、runtime 对接、Agent SDK 对接和 UI 设计的 Codex 会话  
> 关联文档：`docs/next-project-workflow-fleet-handoff.md`、`docs/workflow-protocol.md`、`docs/workflow-agent-lifecycle-handoff.md`  
> 目标：明确新工程如何把 `workflow` 作为 Coding Agent skill 使用，并通过稳定、只读、窄化的 protocol 观察 workflow 状态，避免把 Host 做成 workflow 遥控器。

## 1. 为什么需要单独协议文档

`docs/next-project-workflow-fleet-handoff.md` 已经说明了新工程的产品心智：

```text
Host 管确定性资源和安全边界；
Supervisor Agent 管智能判断；
Coding Agent 管代码修改和 workflow skill；
开发者只处理真正需要人的决定。
```

但它没有完整展开 workflow 工具层面的协议细节。新工程初始化时需要额外明确：

- workflow 是 Coding Agent 内的 skill，不是 Host 正常路径直接遥控的 runtime。
- Host 如何配置 workflow skill 触发语。
- Host 如何构造给 Coding Agent 的 prompt。
- Host 如何观察 workflow stage / substate / handoff。
- Host 可以调用哪些 workflow protocol 命令，哪些命令只能 debug / 兼容使用。
- `allowedActions`、`actionInputs`、`stageArtifacts`、`events` 在新工程中分别是什么语义。
- 如果现有 workflow protocol 缺少 active run discovery，新工程应该如何处理。

本文档把这些内容作为新工程的初始协议基线。

## 2. 总体原则

### 2.1 Skill-first

新工程第一版默认采用：

```text
Host -> Coding Agent SDK -> workflow skill -> workflow runtime
```

而不是：

```text
Host -> workflow protocol start/action -> workflow runtime
```

含义：

- Host 创建 workspace、worktree、branch。
- Host 通过 Codex / Claude Code SDK 启动 Coding Agent。
- Coding Agent 在 worktree repo 内工作。
- Coding Agent 通过配置化触发语调用 workflow skill，例如 `$ht-workflow` 或 `/ht-workflow`。
- workflow skill 引导 Coding Agent 完成 requirements / spec / implementation / test / review。
- Host 只读观察 workflow protocol projection 和 SDK visible output。

### 2.2 Host 不遥控 workflow

Host 正常路径不应该：

- 直接调用 `workflow protocol start` 来启动 workflow。
- 直接调用 `workflow protocol action` 来推进 workflow internal action。
- 把 `allowedActions` 当成自动执行队列。
- 把 `actionInputs` 当成让开发者填写的表单。
- 读取或写入 `.workflow` private state。

Host 可以：

- 读取 workflow protocol `capabilities`。
- 读取当前或指定 run 的 `status`。
- 读取 protocol 暴露的 `artifacts` 列表。
- 读取 protocol 暴露的 `events` 摘要。
- 在 debug/兼容路径中暴露 start/action，但默认不进入主流程。

### 2.3 Coding Agent 选择 workflow 使用方式

默认不要要求开发者或 Host 选择 workflow profile。

原因：

- task 的复杂度和类型可以由 Coding Agent 探查工程后判断。
- workflow profile 的选择属于 workflow skill 内部使用策略，不应成为新建 task 的主要 UI 负担。
- 如果项目确实需要固定偏好，可以放进 Project Settings，不在主界面强制展示。

## 3. 协议分层

建议把新工程与 workflow 的对接拆成四层：

```text
Project Workflow Config
  ↓
Coding Agent Prompt Contract
  ↓
Host Read-only Observation Protocol
  ↓
Debug / Compatibility Protocol
```

### 3.1 Project Workflow Config

Project 注册或设置中保存 workflow 工具配置。

建议结构：

```ts
export type WorkflowToolConfig = {
  enabled: boolean;
  trigger: string;
  launcher?: string;
  cwdMode: "workspace-repo";
  defaultPrompt?: string;
  env?: Record<string, string>;
  observation: {
    enabled: boolean;
    preferActiveRunDiscovery: boolean;
    pollIntervalMs: number;
  };
};
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `enabled` | 当前 project 是否启用 workflow skill。 |
| `trigger` | 传给 Coding Agent 的触发语，例如 `$ht-workflow` 或 `/ht-workflow`。 |
| `launcher` | 可选 workflow CLI launcher，用于 protocol observation；不是正常启动 workflow 的入口。 |
| `cwdMode` | 第一版固定为 `workspace-repo`，所有 workflow observation 都在 task worktree 的 repo 内执行。 |
| `defaultPrompt` | 可选补充提示词，放在 Project Settings，不在新建 task 主界面展开。 |
| `env` | protocol observation 需要的环境变量；不得放 secret 明文到 UI 主界面。 |
| `observation` | Host 只读观察策略。 |

`launcher` 可以是：

- PATH 上的 `workflow`。
- 绝对路径 launcher。
- 本地 wrapper，例如 `/tmp/local-workflow-bin/workflow`。

`launcher` 不应该是带参数的 shell 字符串，例如：

```text
node /path/to/workflow/bin/workflow.mjs
```

如需本地源码联调，建议创建 wrapper：

```bash
#!/usr/bin/env bash
exec node /Users/hetao/Documents/github/workflow/bin/workflow.mjs "$@"
```

### 3.2 Coding Agent Prompt Contract

Host 启动 Coding Agent 时，需要把 workflow skill 使用方式作为轻量协作约定注入 prompt。

建议 prompt 片段：

```text
你正在 task 专属 worktree 中工作。

任务目标：
{{task_goal}}

约束：
{{task_constraints}}

如果需要进入项目规范 workflow，请使用项目配置的 workflow skill 触发语：
{{workflow_trigger}}

请根据需求和工程复杂度自行判断 workflow 的使用方式。遇到需要开发者判断、无法继续、或完成阶段性工作时，请用简洁自然语言说明当前状态和需要的决定。
```

约束：

- 不强制指定 workflow profile。
- 不把 workflow run id 当成 prompt 必填项。
- 不把 Host 的 DB id、operation id、大段 JSON 暴露给 Coding Agent。
- 不要求 Coding Agent 输出机器协议 JSON；SDK visible output 是 evidence，不是状态机协议。
- 附件通过本地路径或 artifact refs 提供，不把大文件正文塞进 prompt。

### 3.3 Host Read-only Observation Protocol

Host 可以通过 workflow protocol 做只读观察。

推荐命令：

```bash
workflow protocol capabilities
workflow protocol status
workflow protocol status --run <run-id>
workflow protocol artifacts --run <run-id>
workflow protocol events --run <run-id>
```

其中 `status` 的 active run discovery 很关键。

新工程第一版建议优先支持：

```bash
workflow protocol status
```

语义：

- 在当前 workspace repo 中执行。
- 不创建 run。
- 不切换 run。
- 返回当前 active/latest workflow run 的 protocol projection。
- 如果没有 active/latest run，返回受控空状态，而不是让 Host 读取 `.workflow`。

示例：

```json
{
  "ok": true,
  "protocolVersion": "1",
  "runId": "run-1779675757693",
  "profile": "feature",
  "lifecycle": "active",
  "stage": "implementation",
  "substate": "materialize-change",
  "summary": "workflow run is active",
  "handoff": {
    "available": false,
    "kind": null,
    "reason": null,
    "artifacts": []
  }
}
```

如果当前 workflow protocol 只支持 `status --run <run-id>`，新工程需要显式设计 run id 发现策略，见第 8 节。

### 3.4 Debug / Compatibility Protocol

以下命令只作为 debug、兼容或未来显式 operator 能力，不进入第一版正常主循环：

```bash
workflow protocol start [--workflow <profile>]
workflow protocol action --run <run-id> <action> [arg]
```

使用规则：

- `start` 不作为新工程默认启动 workflow 的方式；默认由 Coding Agent 调用 workflow skill。
- `action` 不作为 Host 自动推进 workflow 的方式；internal action 由 Coding Agent / workflow skill 处理。
- 如果未来要让 Web 或 Supervisor 触发 operator-facing workflow action，必须先设计 gate evidence、human confirmation、audit 和 idempotency。

## 4. workflow protocol 命令契约

### 4.1 capabilities

命令：

```bash
workflow protocol capabilities
```

语义：

- 在 project repo 或 workspace repo 中执行。
- 返回 protocol version、支持命令、已实现 profile 和 handoff kind。
- 新工程可用它做配置检查和 debug 展示。
- 不应让 Supervisor Agent 根据 profile catalog 主动替用户或 Coding Agent 选择 profile。

建议输出：

```json
{
  "ok": true,
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
  "commands": ["capabilities", "status", "artifacts", "events", "start", "action"],
  "handoffKinds": ["pr_ready", "human_review_required", "manual_handoff", "blocked", "completed_no_pr"]
}
```

### 4.2 status

命令：

```bash
workflow protocol status
workflow protocol status --run <run-id>
```

语义：

- `status`：查询当前 workspace repo 的 active/latest run。
- `status --run`：查询指定 run。
- 两者都不得创建 run 或修改 workflow 状态。
- `status` 缺少 active/latest run 时应返回 `ok=true` 的空状态或 `ok=false` 的稳定错误 envelope，不能要求 Host 读取 `.workflow`。

建议输出：

```json
{
  "ok": true,
  "protocolVersion": "1",
  "runId": "run-...",
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
      "usage": "workflow protocol action --run run-... materialize-change <change-id>"
    }
  },
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
    "recovery": {
      "action": "inspect-or-resume-workflow",
      "guidance": "inspect workflow status or resume the workflow run"
    }
  },
  "stageArtifacts": [
    {
      "kind": "summary",
      "path": ".workflow/runs/run-.../artifacts/status-summary.md",
      "label": "Current status summary",
      "requiredForHandoff": false
    }
  ],
  "artifactRoot": ".workflow/runs/run-.../artifacts",
  "eventLog": ".workflow/runs/run-.../observability/events.jsonl"
}
```

字段使用边界：

| 字段 | 新工程使用方式 |
| --- | --- |
| `runId` | 关联 workflow observation；不是主 UI 必显字段。 |
| `profile` | debug / detail 展示；默认不作为用户必选项。 |
| `lifecycle` | 观察 workflow 是否 active/completed/failed/unknown。 |
| `stage` / `substate` | UI 展示 workflow 内部位置。 |
| `gate` | workflow 内部 gate 状态，不能单独等于 needs-me。 |
| `progress` | 画布/节点展示，不驱动状态机。 |
| `allowedActions` | debug/display，不自动执行，不直接进 needs-me。 |
| `actionInputs` | debug/display 参数 hint，不让开发者默认填写。 |
| `currentChange` | workflow 内部事实，不等于 PR readiness。 |
| `handoff` | Host 消费 workflow 结果的主要结构化边界。 |
| `stageArtifacts` | 可作为 supporting refs，不默认读取正文。 |
| `artifactRoot` / `eventLog` | debug refs，不读取 private state。 |

### 4.3 artifacts

命令：

```bash
workflow protocol artifacts --run <run-id>
```

语义：

- 只列出 workflow 愿意暴露给外层的只读 artifact 引用。
- 不要求 Host 扫描 `.workflow` 目录。
- artifact path 必须是相对 workspace repo 的路径。
- 不返回绝对路径、secret 或 private state 文件。

建议输出：

```json
{
  "ok": true,
  "protocolVersion": "1",
  "runId": "run-...",
  "artifactRoot": ".workflow/runs/run-.../artifacts",
  "artifacts": [
    {
      "kind": "summary",
      "path": ".workflow/runs/run-.../artifacts/summary.md",
      "label": "Summary",
      "requiredForHandoff": true
    },
    {
      "kind": "validation",
      "path": ".workflow/runs/run-.../artifacts/validation-report.md",
      "label": "Validation report",
      "requiredForHandoff": false
    }
  ]
}
```

Host 对 artifact 的使用：

- 默认只展示 refs 和短 label。
- 需要查看正文时走显式 detail / debug。
- 不把 artifact 正文作为 Supervisor 的默认大块 prompt 输入。

### 4.4 events

命令：

```bash
workflow protocol events --run <run-id>
```

语义：

- 返回 workflow observability 的只读摘要。
- 不返回大块 raw log。
- 不让 Host 依赖未声明字段推进状态。

建议输出：

```json
{
  "ok": true,
  "protocolVersion": "1",
  "runId": "run-...",
  "eventsPath": ".workflow/runs/run-.../observability/events.jsonl",
  "latest": [
    {
      "timestamp": "2026-05-27T00:00:00.000Z",
      "type": "workflow-action",
      "summary": "action completed: run-alignment-checks"
    }
  ]
}
```

Host 对 events 的使用：

- 只展示短摘要。
- 可作为 Supervisor observation 的轻量 context。
- 不基于 event 私有字段自动确认 gate、PR readiness 或 done。

### 4.5 start

命令：

```bash
workflow protocol start
workflow protocol start --workflow <profile>
```

新工程默认语义：

- `start` 是 debug / compatibility / migration 能力。
- 正常 task 执行不通过 Host 直接调用 `start`。
- 默认由 Coding Agent 通过 workflow skill 触发 runtime。

如果临时必须兼容旧路径：

- 只能由 Host deterministic runtime 调用，不能由 Supervisor 直接调用。
- 必须记录 operation / event。
- 如果要求 `--workflow <profile>`，该 profile 必须来自明确用户选择或 Project Settings，不应由 Supervisor 猜测。
- 一旦 Coding Agent skill-first 路径可用，应回到 skill-first。

### 4.6 action

命令：

```bash
workflow protocol action --run <run-id> <action> [arg]
```

新工程默认语义：

- `action` 不是 Host 自动推进主路径。
- `materialize-change`、`run-alignment-checks` 等 internal action 默认由 Coding Agent / workflow skill 处理。
- Web 不因 `allowedActions` 出现就生成 action card。
- Supervisor 不直接返回 “调用 workflow action” 决策。

未来如需支持 operator-facing action：

- 必须先生成 Gate。
- 必须展示 SDK visible output 或 Supervisor summary 作为 evidence。
- 必须由开发者确认。
- 必须由 Host 校验当前 workflow status。
- 必须记录 audit event。

## 5. Handoff 契约

`handoff` 是 Host 消费 workflow 结果的主要边界。

Host 不应从 `stage/substate/gate/allowedActions` 猜测 PR readiness 或 done。

建议 handoff kind：

```text
pr_ready
human_review_required
manual_handoff
blocked
completed_no_pr
```

### 5.1 pr_ready

语义：

- workflow 认为当前 worktree branch 已达到可创建 PR/MR 的状态。
- Host 可以结合 git diff、test summary、project policy 和 Supervisor decision 创建 PR/MR。
- PR/MR 创建仍由 Host 执行，不由 workflow 执行。

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
    "guidance": "Host may create a PR/MR from the current workspace branch."
  },
  "recovery": {
    "action": "inspect-workflow",
    "guidance": "If PR creation fails, inspect workflow status and artifacts again before retrying."
  }
}
```

### 5.2 blocked / human_review_required

语义：

- workflow 或 Coding Agent 到达需要外部判断的停点。
- Host 需要结合 SDK visible output、workflow facts 和 Supervisor summary 生成 Gate。
- 没有可见 evidence 时，不应让开发者盲确认。

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
    "guidance": "Supervisor should decide whether to ask the developer."
  },
  "humanRequestSuggestion": {
    "kind": "technical-decision",
    "summary": "需要确认缓存失效策略。"
  }
}
```

### 5.3 completed_no_pr

语义：

- workflow 判断该任务无需 PR/MR 收口。
- Host 仍需结合 project policy 和 Supervisor decision 判断是否 mark done。
- 不能把 `completed_no_pr` 当成所有代码任务的默认完成路径。

## 6. Needs-Me 分类规则

进入 Needs-Me：

- workflow handoff 为 `blocked` 或 `human_review_required`。
- Supervisor decision 为 `ask_user`。
- merge approval。
- provider credential / permission blocker。
- bootstrap failed 且需要人处理。
- PR/MR conflict 或 review changes 需要人判断。
- workflow operator gate 且有足够 evidence。

不进入 Needs-Me：

- `allowedActions` 里出现 internal action。
- `actionInputs` 里出现 required arg。
- `stage/substate` 是 `materialize-change`。
- Coding Agent 仍在运行。
- raw SDK event 中出现某个关键词。
- workflow events 里出现 debug action。

内部 action 示例：

```text
materialize-change
run-alignment-checks
repair-current-change-reference
inspect
resume
continue-implementation
```

operator-facing gate 示例：

```text
freeze-requirements
approve-planning-dossier
approve-review
merge approval
```

注意：operator-facing action 进入 Needs-Me 仍需要 evidence，不能只靠 action id。

## 7. Supervisor Observation 中的 workflow 字段

Host 交给 Supervisor 的 observation 中，workflow 部分建议保持窄摘要。

```ts
export type SupervisorWorkflowObservation = {
  observed: boolean;
  runId?: string;
  profile?: string;
  lifecycle?: "active" | "completed" | "failed" | "unknown";
  stage?: string;
  substate?: string;
  progressSummary?: string;
  handoff?: {
    available: boolean;
    kind?: "pr_ready" | "human_review_required" | "manual_handoff" | "blocked" | "completed_no_pr";
    reason?: string;
    artifactRefs: Array<{ kind?: string; path: string; label?: string }>;
  };
  debugHints?: {
    allowedActions: string[];
    deniedActions: string[];
    actionInputs: Record<string, { requiredArgs?: string[]; usage?: string }>;
  };
};
```

约束：

- `debugHints` 可以给 Supervisor 理解状态，但 Supervisor 不应返回直接调用 workflow action 的 decision。
- artifact refs 默认只给 path/kind/label，不塞正文。
- 如果 status 缺失或协议不可用，`observed=false`，由 Supervisor 判断是否继续、等待或 ask_user。

## 8. Active Run Discovery

新工程 skill-first 后会遇到一个实际问题：

```text
workflow run 是 Coding Agent 通过 skill 创建的。
Host 不一定天然知道 runId。
```

因此新工程需要一个安全的 active run discovery 方案。

优先级：

1. 最佳：workflow protocol 支持 `workflow protocol status` 无 `--run` 参数，返回当前 workspace repo 的 active/latest run。
2. 次佳：workflow protocol 增加 `workflow protocol runs --active` 或 `workflow protocol current-run`，返回 active run id 和 status。
3. 兼容：Coding Agent final response 中自然语言提到 run id；Host 仅作 debug hint，不能作为唯一真源。
4. 禁止：Host 读取 `.workflow/current-run.json`、扫描 `.workflow/runs` 或解析 private state。

建议新工程第一版把 active run discovery 写入能力检测：

```text
if capabilities.commands includes "status-active" or status without --run works:
  use active status
else:
  workflow observation = unavailable
  rely on SDK visible output and Supervisor summary
  show config attention: workflow protocol cannot discover active run without private state
```

如果需要交接给 workflow 工程补协议，建议新增：

```bash
workflow protocol status
```

或：

```bash
workflow protocol current
```

输出至少包含：

```json
{
  "ok": true,
  "protocolVersion": "1",
  "available": true,
  "runId": "run-...",
  "status": {
    "lifecycle": "active",
    "stage": "implementation",
    "substate": "test-align",
    "handoff": {
      "available": false
    }
  }
}
```

## 9. 错误 Envelope

protocol 命令失败时，建议 stdout 输出稳定错误 envelope，stderr 只作诊断。

```json
{
  "ok": false,
  "protocolVersion": "1",
  "error": {
    "code": "WORKFLOW_RUN_NOT_FOUND",
    "message": "workflow run not found",
    "recoverable": true
  }
}
```

常见错误码：

```text
WORKFLOW_PROTOCOL_UNAVAILABLE
WORKFLOW_RUN_NOT_FOUND
WORKFLOW_NO_ACTIVE_RUN
WORKFLOW_PROFILE_REQUIRED
WORKFLOW_PROFILE_UNSUPPORTED
WORKFLOW_ACTION_DENIED
WORKFLOW_ACTION_INPUT_REQUIRED
WORKFLOW_STATE_CORRUPTED
```

Host 处理原则：

- `WORKFLOW_NO_ACTIVE_RUN`：不读 private state；继续依赖 SDK visible output。
- `WORKFLOW_PROFILE_REQUIRED`：仅 debug/compat start 相关；skill-first 正常路径不应触发。
- `WORKFLOW_ACTION_INPUT_REQUIRED`：不把 required arg 表单化给普通用户；只进 debug。
- unknown error：进入 attention，但不自动停止所有 task。

## 10. UI 映射

React Flow / xyflow Fleet Canvas 中 workflow 信息映射：

| Protocol 字段 | UI 映射 |
| --- | --- |
| `lifecycle=active` | Task node running animation。 |
| `stage` | Workflow segment 当前主标签。 |
| `substate` | 小 chip / tooltip。 |
| `progress.summary` | Hover tooltip 或 Focus Drawer 一句话。 |
| `handoff.kind=pr_ready` | Task node 切到 PR ready。 |
| `handoff.kind=blocked` | Needs-Me 或 attention，取决于 evidence。 |
| `allowedActions` | Debug drawer。 |
| `actionInputs` | Debug drawer。 |
| `stageArtifacts` | Focus Drawer supporting refs。 |
| `events.latest` | Debug / activity mini log。 |

主画布不要展示：

- raw JSON。
- full transcript。
- operation id。
- workflow run id。
- 完整 allowed action 列表。

## 11. 第一版实现建议

新工程第一版可以按以下顺序落地：

1. Project Settings 保存 `workflow.trigger` 和可选 `workflow.launcher`。
2. Coding Agent prompt 注入 `workflow.trigger`。
3. Host 在 workspace repo 中调用 `workflow protocol capabilities` 做配置检查。
4. Host 尝试 `workflow protocol status` 做 active run observation。
5. 如果 active status 不可用，降级为 `workflow observed=false`，不读 `.workflow`。
6. UI 先展示 SDK visible output 和 Supervisor summary；workflow stage/substate 等 protocol 可用后再展示。
7. `artifacts/events` 只进入 detail/debug。
8. `start/action` 保留在隐藏 debug 工具，不进入正常主循环。

## 12. 交接给新工程会话的短提示词

如果需要单独让新工程会话实现 workflow 工具对接，可以使用：

```text
请阅读：

/Users/hetao/Documents/github/coordinator/docs/next-project-workflow-fleet-handoff.md
/Users/hetao/Documents/github/coordinator/docs/next-project-workflow-tool-protocol.md

实现新工程的 workflow tool integration 设计时，请遵守：

1. workflow 是 Coding Agent 中的 skill，默认由 Coding Agent 通过配置化触发语调用，例如 $ht-workflow 或 /ht-workflow。
2. Host 不在正常路径直接调用 workflow protocol start/action，不把 workflow 当遥控 runtime。
3. Host 可以通过 workflow protocol capabilities/status/artifacts/events 做只读观察。
4. 第一版要优先支持 active run discovery：workflow protocol status 无 --run 返回当前 workspace 的 active/latest run；如果当前 workflow 不支持，则降级为 workflow observed=false，不读取 .workflow private state。
5. allowedActions/actionInputs 只进 debug，不直接变成 Needs-Me 或 Web Action Card。
6. stage/substate/progress/handoff 可以用于 React Flow task node 展示；handoff 才是 Host 消费 workflow 结果的结构化边界。
7. Supervisor 可以看到 workflow observation 摘要，但不能直接返回“调用 workflow action”的 decision。
8. merge 仍必须人工确认。

请先设计 Project Workflow Config、Coding Agent prompt contract、workflow observation adapter、错误 envelope 处理和 UI projection，不要急于实现 start/action 主流程。
```

## 13. 最终边界

这份协议的核心判断是：

```text
workflow 工具面向 Coding Agent；
workflow protocol 面向 Host 只读观察；
Host 面向开发者提供多任务托管和真正 gate 收件箱。
```

任何让开发者开始手动操作 workflow internal action 的设计，都应该默认进入 debug，而不是进入第一版主体验。
