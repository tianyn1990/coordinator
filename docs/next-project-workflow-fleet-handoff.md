# 新工程 Workflow Fleet Manager 交接文档

> 状态：新工程启动交接  
> 生成时间：2026-05-27 Asia/Shanghai  
> 适用对象：后续负责新工程初始化、产品设计、架构设计和第一版实现的 Codex 会话  
> 背景工程：`/Users/hetao/Documents/github/coordinator`  
> 目标：把当前 `coordinator` 实践中已经证明有效的经验、暴露出的过重问题、以及新工程的产品和架构方向完整交接，避免新工程继续沿着“workflow 遥控器 / 复杂控制台”的方向膨胀。

## 1. 背景与真实问题

用户开发了独立的 `workflow` 工程后，在真实开发中遇到的核心问题不是“缺少一个 workflow 控制台”，而是：

```text
单个需求通过 workflow 执行后会变慢。
慢的原因是 workflow 会要求更规范地完成需求、spec、实现、单测、review 等步骤。
开发者在等待这些步骤执行时，个人开发效率下降。
```

更理想的方式是：

```text
一个开发者可以并行托管多个工程或同一工程下的多个需求。
每个需求在独立 worktree / workspace / branch 中执行。
每个需求由一个上层 Supervisor Agent 持续负责。
Supervisor Agent 帮开发者观察、恢复、判断和推进。
只有置信度低、需要产品/业务/merge 判断、或真正 human gate 时才打扰开发者。
```

因此新工程的第一性目标是降低开发者管理多个 workflow coding task 的成本，而不是把 workflow 的内部控制面做成一套漂亮 Web UI。

## 2. 新工程定位

建议新工程定位为：

```text
本地个人 Workflow Task Manager / Workflow Fleet Manager
```

它不是：

- workflow runtime 的遥控器。
- 通用 multi-agent DAG 平台。
- 企业级任务调度系统。
- 完整审计和多租户服务。
- 面向普通用户的项目管理 SaaS。

它是：

- 本地个人开发应用。
- 多 project / 多 task 的并行托管器。
- 每 task 独立 worktree / branch / workspace 的管理器。
- Codex / Claude Code SDK 的受控驱动层。
- 每 task Supervisor Agent 的宿主。
- workflow skill 状态的只读观察者。
- 真正 human gate 的收件箱。

一句话：

```text
Host 管确定性资源和安全边界；
Supervisor Agent 管智能判断；
Coding Agent 管代码修改和 workflow skill；
开发者只处理真正需要人的决定。
```

## 3. 角色分工

### 3.1 Host 程序

Host 是新工程的确定性程序层。

Host 负责：

- Project Registry。
- 本地 SQLite 或类似轻量持久化。
- worktree / workspace / branch 创建与恢复。
- 可选 project bootstrap script 执行。
- 附件复制到 task workspace。
- Codex / Claude Code SDK session 生命周期。
- 每 task Supervisor Agent session 生命周期。
- Coding Agent session 生命周期。
- workflow protocol 只读状态探查。
- PR/MR 创建、review 状态观察、merge gate。
- Web API 和 UI 数据 projection。
- 策略校验、权限边界、日志、debug artifact。

Host 不应该：

- 直接把 workflow `allowedActions` 变成开发者按钮。
- 在正常路径中直接启动或遥控 workflow。
- 读取、解析或修改 `.workflow` private state。
- 根据 raw transcript 或自然语言片段直接改核心状态。
- 让 Supervisor Agent 直接改 DB 或执行危险副作用。
- 自动 merge。

### 3.2 Supervisor Agent

每个 Task 一个 Supervisor Agent，并且该 Supervisor 持续负责同一个 Task。

这样做的原因：

- 单个 task 的上下文、判断和历史更连贯。
- 多 task 并行时，Supervisor 之间天然隔离。
- Host 可以把每轮结构化 observation 交给同一个 Supervisor，让它基于同一任务的连续事实做判断。

Supervisor 负责：

- 读取 Host 提供的结构化 observation。
- 判断当前 task 是否可以继续自动推进。
- 生成给 Coding Agent 的下一步 instruction。
- 在需要人判断时生成简洁的 user question。
- 判断是否可以创建 PR/MR。
- 判断是否需要 pause、retry、attention 或 mark done。

Supervisor 不直接：

- 执行 shell。
- 修改 repo。
- 调 workflow action。
- 调 PR/MR API。
- 改 DB。
- 自动确认 merge 或 human gate。

Supervisor 的输出必须通过 Host 校验后执行。

### 3.3 Coding Agent

Coding Agent 是实际写代码的一层，由 Codex 或 Claude Code SDK 启动。

Coding Agent 负责：

- 在 task worktree 的 repo 内探查工程。
- 根据需求调用 workflow skill。
- 由 workflow skill 约束 requirements / spec / implementation / test / review 等内部阶段。
- 修改代码、运行测试、修复问题。
- 需要人确认或无法继续时停下并输出可见反馈。

重要设计：

```text
workflow 本身是安装在 Coding Agent 中的 skill。
Host 不应把 workflow 当成自己直接驱动的 runtime。
Coding Agent 应通过配置化默认提示词触发 workflow skill，例如 $ht-workflow 或 /ht-workflow。
```

### 3.4 workflow skill

workflow 继续负责单个代码工作单元内部的规范流程。

新工程对 workflow 的关系应该是：

- 通过 Coding Agent 使用 workflow skill。
- 可通过 workflow protocol 做只读状态探查。
- 不读取 `.workflow` private state。
- 不把 `allowedActions` 等同为开发者待办。
- 不要求第一版修改 workflow protocol。

第一版正常路径建议：

```text
Host 启动 Coding Agent
-> Coding Agent 根据默认提示词触发 workflow skill
-> workflow skill 引导 Coding Agent 执行内部阶段
-> Host 只读观察 SDK visible output + workflow protocol status
```

### 3.5 Developer

开发者只处理：

- 新建 task 时的目标、约束、附件。
- 真正需要人的 workflow / product / review gate。
- Supervisor 低置信度或无法判断的问题。
- PR/MR review 和 merge approval。
- destructive cleanup 等高风险动作。

开发者不应该被要求：

- 手动填写 `materialize-change <change-id>`。
- 理解每个 workflow internal action。
- 频繁点击“继续 workflow”按钮。
- 读取 operation id、run id、raw JSON、完整 transcript。

## 4. 生命周期设计

### 4.1 总览

```text
Register Project
  ↓
Create Task
  ↓
Host: create worktree / workspace / branch
  ↓
Host: run optional bootstrap command
  ↓
Host: start per-task Supervisor Agent
  ↓
Host: start Coding Agent through SDK
  ↓
Coding Agent: invoke workflow skill
  ↓
Coding Agent + workflow: requirements / spec / implementation / test / review
  ↓
Coding Agent stops / asks / fails / reaches handoff
  ↓
Host: collect observations
  ↓
Supervisor: decide next step
  ↓
Host: validate and execute decision
  ↓
Developer only handles real gates
```

### 4.2 准备阶段：Host 主导

自动化处理：

- 注册 project。
- 检测 repo path、remote、default branch。
- 创建 task。
- 创建 worktree。
- 创建 task branch。
- 创建 workspace 目录。
- 复制本地附件。
- 执行可选 bootstrap command。
- 启动 Supervisor Agent。
- 启动 Coding Agent。

开发者确认：

- 注册 project 时确认 repo path、default branch、workspace root。
- 是否配置 bootstrap command。
- 新建 task 的目标、约束和附件。
- 可选选择 provider；默认值可来自 project config。

### 4.3 执行阶段：Coding Agent + workflow 主导

执行阶段的核心规则：

```text
Coding Agent 仍在运行时，Host 只观察，不抢方向盘。
```

Host 可以观察：

- SDK stream event。
- final response。
- visible assistant message。
- tool/activity summary。
- workflow protocol status。
- git status / diff summary。
- bootstrap/test/PR/MR 状态。

Host 不应该因为发现 workflow `allowedActions` 就中断用户。

### 4.4 停顿判断阶段：Supervisor 主导

当 Coding Agent 停止、失败、stalled、请求输入或到达 handoff 后，Host 收集 facts，交给同一个 Supervisor 判断。

Host 收集：

- task 目标和历史摘要。
- workspace path、branch、base branch。
- git status / diff summary。
- Coding Agent final response。
- 最近 visible messages。
- SDK failure/activity summary。
- workflow status snapshot。
- PR/MR state。
- 当前 policy。

Supervisor 输出：

- 继续 Coding Agent。
- 询问用户。
- 创建 PR/MR。
- 等待。
- retry。
- pause attention。
- mark done。

Host 校验 decision 合法性后执行。

### 4.5 收尾阶段：Host + Supervisor + Developer

可以自动：

- 创建 PR/MR，前提是 project policy 允许。
- 观察 review 状态。
- 将 review feedback 交给 Supervisor，再由 Supervisor 指导 Coding Agent rework。
- re-run Coding Agent 修复测试或 review 问题。

必须人工：

- merge approval。
- 高风险 destructive cleanup。
- 需要业务/产品取舍的问题。
- provider credential / permission blocker。

## 5. 自动化边界

### 5.1 默认自动

- worktree / workspace / branch 创建。
- 可选 bootstrap command 执行。
- 附件复制。
- Supervisor session 启动和恢复。
- Coding Agent session 启动和恢复。
- workflow protocol 只读 status 探查。
- SDK visible output 保存和摘要。
- Coding Agent 停止后的 Supervisor 判断。
- 高置信度继续 Coding Agent。
- 可配置的自动 PR/MR 创建。

### 5.2 默认询问开发者

- workflow human gate。
- Supervisor confidence 为 low。
- 需求不清或需要业务判断。
- PR/MR merge。
- merge conflict。
- provider credential / permission issue。
- bootstrap script 首次配置或失败后的处理。
- destructive cleanup。

### 5.3 默认禁止

- 自动 merge。
- Host 直接执行 workflow internal action。
- 把 workflow `allowedActions` 直接转成 Web Action Card。
- 读取/写入 `.workflow` private state。
- Supervisor 直接执行外部副作用。
- UI 默认展示 raw provider JSONL、完整 transcript、operation ledger。

## 6. Host 与 Supervisor 的协议

协议要窄、稳定、可审计。Supervisor 可以智能判断，但只能返回有限 decision。

### 6.1 Host -> Supervisor Observation

建议第一版结构：

```ts
export type SupervisorObservation = {
  task: {
    id: string;
    title: string;
    goal: string;
    constraints: string[];
    attachments: Array<{ name: string; path: string; kind: string }>;
    createdAt: string;
  };
  project: {
    id: string;
    name: string;
    repoPath: string;
    defaultBranch: string;
    provider?: "github" | "gitlab" | "none";
  };
  workspace: {
    path: string;
    repoPath: string;
    branch: string;
    baseBranch: string;
    bootstrapStatus: "not_configured" | "pending" | "running" | "succeeded" | "failed";
    gitStatusSummary: string;
    diffSummary?: string;
  };
  codingAgent: {
    provider: "codex" | "claude-code";
    state: "not_started" | "running" | "completed" | "failed" | "stalled";
    finalResponse?: string;
    recentVisibleMessages: string[];
    failureSummary?: string;
    activitySummary?: string;
  };
  workflow: {
    observed: boolean;
    stage?: string;
    substate?: string;
    lifecycle?: string;
    handoffKind?: string;
    statusSummary?: string;
    operatorGate?: {
      kind: string;
      reason: string;
    };
  };
  delivery: {
    prUrl?: string;
    prState?: "none" | "open" | "merged" | "closed" | "conflict";
    reviewState?: "none" | "requested" | "changes_requested" | "approved";
    mergeState?: "not_ready" | "needs_approval" | "ready" | "merged";
  };
  policy: {
    canAutoContinue: boolean;
    canAutoCreatePr: boolean;
    mustAskBeforeMerge: true;
    maxAutoContinueCount: number;
  };
};
```

### 6.2 Supervisor -> Host Decision

建议第一版结构：

```ts
export type SupervisorDecision = {
  action:
    | "continue_coding_agent"
    | "ask_user"
    | "create_pr"
    | "wait"
    | "retry"
    | "pause_attention"
    | "mark_done";
  confidence: "high" | "medium" | "low";
  userSummary: string;
  codingAgentInstruction?: string;
  userQuestion?: {
    title: string;
    body: string;
    options?: string[];
  };
  safetyNotes?: string[];
};
```

约束：

- Host 必须校验 decision 是否符合 policy。
- `confidence=low` 默认转为 `ask_user` 或 `pause_attention`。
- `create_pr` 必须检查 workspace、diff、remote provider 和 project policy。
- `mark_done` 不能替代 merge 或 workflow handoff。
- `codingAgentInstruction` 只是给 Coding Agent 的下一轮 prompt，不是 shell 命令。

## 7. Coding Agent Prompt 策略

### 7.1 不强制 workflow profile

不要在默认 prompt 中强制传入 `workflow profile`。

理由：

- workflow profile 可以由 Coding Agent 根据需求内容、工程探查结果和复杂度综合判断。
- 开发者不应该在新建 task 时被过多 profile 细节打扰。
- project config 可以提供默认偏好，但不应成为每次 task 的必填项。

### 7.2 workflow skill 触发语可配置

默认 prompt 只表达协作意图，并通过配置化触发语引导 Coding Agent 使用 workflow skill。

示例：

```text
请在当前 worktree 中完成这个任务。你可以使用项目配置中的 workflow skill 触发语推进规范流程。
默认触发语：$ht-workflow
```

或：

```text
请在当前 worktree 中完成这个任务。需要进入规范 workflow 时，使用 /ht-workflow。
```

具体触发语应该在 Settings / Project Config 中配置，不在首页和新建 task 表单中大面积展示。

### 7.3 对 final response 的要求保持轻量

不要把“停下时输出人类可读总结”设计成复杂协议。

可以只在通用协作约定中轻描淡写说明：

```text
当你需要开发者判断、无法继续、或完成阶段性工作时，请用简洁自然语言说明当前状态和需要的决定。
```

Host 通过 SDK visible output 观察这些内容；缺少输出时，Supervisor 或 UI 可以提示 evidence missing。

## 8. Project Registry 与 Bootstrap

Project 注册时建议包含：

```ts
export type ProjectConfig = {
  name: string;
  repoPath: string;
  defaultBranch: string;
  workspaceRoot: string;
  gitProvider?: "github" | "gitlab" | "none";
  agentDefaults: {
    supervisorProvider: "codex" | "claude-code";
    codingProvider: "codex" | "claude-code";
  };
  workflowSkill: {
    trigger: string; // 例如 "$ht-workflow" 或 "/ht-workflow"
    defaultPrompt?: string;
  };
  bootstrap?: {
    enabled: boolean;
    command: string;
    timeoutMs: number;
    env?: Record<string, string>;
  };
  testCommand?: string;
  prPolicy: {
    autoCreatePr: boolean;
    requireMergeApproval: true;
  };
};
```

Bootstrap command 用途：

- `pnpm install`
- `npm ci`
- `bun install`
- 复制本地环境模板。
- 生成必要本地配置。

Bootstrap 要求：

- 默认关闭。
- 注册 project 或 Project Settings 中配置。
- 每个 task workspace 初始化时自动执行。
- 有 timeout。
- 记录 stdout/stderr artifact。
- 失败后 task 进入 attention，不继续启动 Coding Agent。
- 支持手动 retry。

## 9. UI 产品方案

### 9.1 第一版直接使用 React Flow / xyflow

第一版主视图可以直接上动态画布，因为用户希望用图形和动画管理多个 workflow。

但使用 React Flow 不等于做自由复杂画布。建议是：

```text
结构化动态画布，而不是无限制节点编辑器。
```

画布用于表达：

- 多 project。
- 多 task。
- 每个 task 的生命周期位置。
- 哪些 task running。
- 哪些 task needs me。
- 哪些 task PR ready / merge ready。
- task 与 worktree / PR 的关联。

不用于：

- 让用户拖拽修改状态机。
- 手工连线定义 DAG。
- 暴露 workflow internal action。

### 9.2 页面与路由

建议第一版路由：

```text
/
  Fleet Canvas

/tasks/:taskId
  Task Focus，可直接复用右侧 Drawer 或全页 detail

/projects
  Project Registry

/projects/:projectId/settings
  Project Config，包括 bootstrap、workflow skill trigger、agent defaults

/settings
  全局 provider、SDK、workspace root、UI preference

/debug
  隐藏或弱入口，展示 raw event、transcript、workflow status、operation logs
```

### 9.3 Fleet Canvas 结构

推荐布局：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Top Bar: Project Filter | Search | Needs Me | New Task | Settings   │
├─────────────────────────────────────────────────────────────────────┤
│ Needs-Me Strip                                                      │
│ [task needing decision] [merge approval] [provider blocked]          │
├─────────────────────────────────────────────────────────────────────┤
│ React Flow Canvas                                                   │
│                                                                     │
│  Project Group A                                                    │
│    Task Node: Prep → Workflow:req/impl/review → PR → Merge → Done    │
│    Task Node: Prep → Workflow:impl running → ...                    │
│                                                                     │
│  Project Group B                                                    │
│    Task Node: Needs Me                                              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Optional Focus Drawer / Modal                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.4 Task Node 信息

Task node 默认只展示必要信息：

- task title。
- project badge。
- 当前 owner：agent / supervisor / me / pr / failed。
- 当前 stage：prep / workflow / pr / merge / done。
- workflow stage/substate 的短标签。
- branch / worktree 的短标识或 icon tooltip。
- provider icon：Codex / Claude Code。
- running heartbeat 或 progress animation。
- needs-me pin。

不要默认展示：

- workflow run id。
- operation id。
- raw allowedActions。
- actionInputs。
- full transcript。
- debug JSON。

### 9.5 Modal / Drawer / Icon 交互

可以合理使用弹窗和 icon 降低页面文字密度：

- `New Task` 用 modal。
- `Register Project` 用 modal / wizard。
- `Project Bootstrap` 放 Settings，不放首页。
- `Needs Me` 点开 decision modal。
- `Task Node` 点击打开 Focus Drawer。
- `Debug` 通过 icon 或 command menu 进入。
- worktree path、branch、provider、stage/substate 用 icon + tooltip。

页面不需要填充式说明文案。默认使用者已经理解该工具用途。

### 9.6 动效原则

动效用于表达状态，不用于装饰。

适合动效：

- running task 的流动边。
- agent active heartbeat。
- task 进入 needs-me 时的轻微入队动画。
- stage 变化时节点状态过渡。
- PR/MR ready 时节点完成态切换。
- failed/stalled 的明确但克制的警示。

不适合：

- 大面积背景动效。
- 纯装饰渐变。
- 影响阅读的闪烁。
- 与真实状态无关的“活跃感”。

## 10. 前端技术建议

推荐技术栈：

- Vite + React + TypeScript。
- TanStack Router。
- TanStack Query。
- React Flow / xyflow。
- shadcn/ui + Radix primitives。
- Motion for React。
- lucide-react icons。

参考资料：

- Vite Guide: https://vite.dev/guide/
- TanStack Router: https://tanstack.com/router/latest/docs/framework/react/overview
- shadcn/ui: https://ui.shadcn.com/docs
- Motion for React: https://motion.dev/docs/react
- React Flow / xyflow: https://reactflow.dev/
- Radix UI: https://www.radix-ui.com/primitives

选型理由：

- Vite 足够轻，适合本地个人应用和快速迭代。
- TanStack Query 适合管理 task/project/agent session 这类 server state。
- TanStack Router 适合明确路由和 deep link。
- React Flow 适合构建动态 task canvas，但需要约束成结构化画布。
- shadcn/ui + Radix 适合构建 dialog、popover、tooltip、command 等简洁交互。
- Motion 用于状态过渡和画布动效。

## 11. Agent SDK 建议

第一版应 SDK-first，不以拼接 CLI 参数作为主路径。

### 11.1 Codex

参考：

- Codex TypeScript SDK README: https://github.com/openai/codex/blob/main/sdk/typescript/README.md

可吸收点：

- SDK 包装 Codex CLI。
- 可以通过 streamed structured events 观察中间进展、tool call、file change、final response。
- raw event 应作为 debug artifact，不直接进入核心状态机。

### 11.2 Claude Code

参考：

- Claude Code Agent SDK TypeScript: https://code.claude.com/docs/en/agent-sdk/typescript

可吸收点：

- `query()` 返回 async generator，可流式接收 SDK message。
- 支持 options、permission、hooks 等能力。
- 适合保存 visible output、result、activity summary。

### 11.3 SDK 事件分层

建议统一分层：

```text
raw provider events
  只进 debug artifact

normalized activity
  进入 timeline / task detail 的简短摘要

visible final response / assistant message
  可作为 human gate evidence

core state
  只由 Host 的确定性状态、Supervisor decision、workflow protocol facts 和 PR/MR facts 驱动
```

## 12. 数据模型建议

第一版只保留少量核心对象：

```text
Project
Task
Workspace
AgentSession
SupervisorDecision
Gate
Attachment
Event
PullRequest
```

### 12.1 Project

- id
- name
- repoPath
- defaultBranch
- workspaceRoot
- bootstrap config
- workflow skill trigger config
- agent defaults
- PR/MR policy

### 12.2 Task

- id
- projectId
- title
- goal
- constraints
- status
- currentOwner
- currentStage
- needsMe
- createdAt / updatedAt

### 12.3 Workspace

- id
- taskId
- path
- repoPath
- branch
- baseBranch
- bootstrapStatus
- status

### 12.4 AgentSession

- id
- taskId
- role: supervisor / coding
- provider: codex / claude-code
- state
- startedAt / endedAt
- finalResponseArtifact
- rawEventsArtifact
- activitySummary

### 12.5 Gate

- id
- taskId
- kind
- title
- summary
- evidence
- status: pending / resolved / dismissed
- createdBy: host / supervisor / workflow-observation / pr-provider

Gate 是 UI `Needs Me` 的唯一主要来源。

## 13. 可以借鉴当前 Coordinator 的部分

当前工程路径：

```text
/Users/hetao/Documents/github/coordinator
```

建议阅读：

- `docs/AGENTS.md`
- `docs/workflow-agent-lifecycle-handoff.md`
- `docs/execution-workspace.md`
- `docs/workflow-protocol.md`
- `docs/web-developer-workbench.md`
- `packages/core/src/agent-provider-runtime.ts`
- `packages/core/src/workspace-manager.ts`
- `packages/core/src/workflow-gate-evidence.ts`
- `packages/core/src/daemon-runtime.ts`

可继承经验：

- worktree 隔离是正确方向。
- provider SDK-first 是正确方向。
- raw provider events 只进 artifact，不进核心状态机。
- SDK visible output 可以作为 gate evidence。
- workflow protocol status 适合做 stage/substate/handoff 的只读观察。
- `allowedActions` 不能直接等同为 Web action。
- 不读写 `.workflow` private state。
- merge 必须 human approval。
- docs / AGENTS / roadmap 约束对长期协作有价值。

不要照搬：

- 过重的 operation ledger UI。
- 复杂 Task Cockpit。
- workflow action panel 作为主交互。
- 过多 task detail 字段。
- 把 Web 做成 debug workbench。
- 过早引入通用平台边界。

## 14. 文档与工程管理机制建议

新工程可以借鉴当前 `coordinator` 的文档管理方式，但第一版要更轻。

建议新工程初始化后立即创建：

```text
AGENTS.md
docs/AGENTS.md
docs/product-principles.md
docs/architecture.md
docs/runtime-protocol.md
docs/workspace.md
docs/agent-sdk.md
docs/ui-design.md
docs/roadmap.md
```

### 14.1 AGENTS.md

写长期协作约束：

- 始终中文回复和写文档。
- 新增核心逻辑要写简洁中文注释。
- 修改架构边界前先读 docs。
- 不读写 `.workflow` private state。
- 不自动 merge。
- 不把 workflow internal action 产品化。
- SDK raw events 不进入核心状态机。

### 14.2 docs/AGENTS.md

作为设计文档索引：

- 项目定位。
- 文档列表。
- 关键边界。
- 每次实现前需要读哪些文档。
- review 必查项。

### 14.3 docs/roadmap.md

只记录短而清晰的迭代：

```text
Iteration 1: Project registry + local workspace
Iteration 2: SDK-backed Coding Agent + Supervisor protocol
Iteration 3: Workflow skill observation + Needs-Me Gate
Iteration 4: React Flow Fleet Canvas
Iteration 5: PR/MR + merge approval
```

每个 iteration 不要太小，也不要做成平台大阶段。

### 14.4 是否需要 OpenSpec

如果新工程继续使用 OpenSpec，可以用在中大型变更上；但不要让 OpenSpec 变成额外负担。

建议：

- 初始化阶段可以先不用 OpenSpec，直接写 docs + skeleton。
- 一旦进入核心 runtime、Supervisor protocol、SDK adapter、UI Canvas 等较大改动，再按 change 管理。
- 每个 change 必须先对齐 `docs/AGENTS.md`。

## 15. 第一版建议迭代

### Iteration 1: Local Project + Workspace Foundation

目标：

- pnpm monorepo。
- Vite React Web。
- Fastify 或轻量 API。
- SQLite。
- Project Registry。
- Local worktree workspace。
- optional bootstrap command。

验收：

- 注册本地 repo。
- 创建 task 后自动创建 worktree 和 branch。
- bootstrap 成功/失败可见。

### Iteration 2: SDK Agent Runtime

目标：

- Codex SDK provider。
- Claude Code SDK provider。
- AgentSession model。
- raw event artifact。
- normalized activity summary。
- Coding Agent 在 workspace repo 中运行。

验收：

- 可以通过 Codex 或 Claude Code SDK 在 worktree 中执行一个简单任务。
- raw events 不进入主状态。
- final response 可见。

### Iteration 3: Supervisor Protocol

目标：

- 每 task Supervisor Agent。
- Host -> Supervisor Observation。
- Supervisor -> Host Decision。
- Host decision validator。
- continue / ask_user / wait / retry 初版。

验收：

- Coding Agent 停止后，Supervisor 可以决定继续或问人。
- `confidence=low` 不自动继续。

### Iteration 4: Workflow Skill Observation + Needs-Me

目标：

- Coding Agent 默认 prompt 可配置 workflow skill trigger。
- Host 只读 workflow protocol status。
- Gate model。
- Needs-Me projection。

验收：

- workflow stage/substate 可展示。
- workflow internal action 不进 Needs-Me。
- human gate / low confidence / provider blocker 进入 Needs-Me。

### Iteration 5: React Flow Fleet Canvas

目标：

- 首页 React Flow dynamic canvas。
- Project group。
- Task node。
- stage animation。
- Needs-Me strip。
- Task Focus drawer。
- New Task / Register Project modal。

验收：

- 一个页面看清多个 task 的状态。
- 无需阅读大段文字即可识别 running / needs-me / PR ready / failed。

### Iteration 6: PR/MR + Merge Gate

目标：

- GitHub 或 GitLab 先支持一个真实 provider。
- create PR/MR。
- review status inspect。
- merge approval gate。

验收：

- Supervisor 可建议 create PR。
- Host 按 policy 创建 PR。
- merge 必须开发者确认。

## 16. 新工程启动提示词

下面这段可以直接给新工程负责的 Codex 会话：

```text
请初始化一个新的本地个人 Workflow Task Manager 工程。这个新工程不是 workflow 遥控器，也不是通用 agent 平台，而是帮助一个开发者并行托管多个 workflow coding task 的本地应用。

请先完整阅读以下交接文档：

/Users/hetao/Documents/github/coordinator/docs/next-project-workflow-fleet-handoff.md

按文档中的产品心智和边界设计新工程：

1. 新工程第一版是个人本地应用，只支持 local worktree。
2. 每个 Task 一个独立 Supervisor Agent，持续负责同一个 Task。
3. Coding Agent 通过 Codex SDK 或 Claude Code SDK 启动，在 task worktree 内工作。
4. workflow 是安装在 Coding Agent 中的 skill，由 Coding Agent 通过配置化触发语调用，例如 $ht-workflow 或 /ht-workflow；Host 不应在正常路径中直接启动或遥控 workflow。
5. Host 负责 project registry、workspace/worktree/branch、bootstrap、SDK session、只读 workflow observation、PR/MR、merge gate 和 Web API。
6. Supervisor 只通过窄协议返回 decision，不能直接改 DB、执行 shell、调用 PR/MR 或确认 human gate。
7. Host 可以读取 SDK visible output、final response、workflow protocol status、git diff summary、PR/MR state，并把这些作为 Observation 交给 Supervisor。
8. 只有真正 needs-me 的事项进入 UI 收件箱：human gate、low confidence、需求不清、provider blocker、merge approval、冲突或高风险失败。
9. workflow internal action、allowedActions、actionInputs、raw transcript、operation/debug JSON 默认不进入主 UI。
10. UI 第一版直接使用 React Flow / xyflow 做动态 Fleet Canvas，并结合 Vite + React + TypeScript、TanStack Router/Query、shadcn/ui、Radix、Motion、lucide-react。
11. Project 注册时支持可选 bootstrap shell command，用于初始化 worktree，例如 pnpm install；默认关闭，失败后进入 attention。
12. 默认不要求用户选择 workflow profile；Coding Agent 可根据需求和工程复杂度判断 workflow 使用方式。
13. merge 必须人工确认，不允许自动 merge。
14. 不读取或修改 .workflow private state。

请先不要实现完整功能。第一步先完成：

- 建议项目名、目录结构和包结构。
- 创建 AGENTS.md。
- 创建 docs/AGENTS.md、docs/product-principles.md、docs/architecture.md、docs/runtime-protocol.md、docs/workspace.md、docs/agent-sdk.md、docs/ui-design.md、docs/roadmap.md。
- 在 docs/roadmap.md 中按合理粒度规划 5-6 个迭代。
- 给出第一轮实现计划并等待我确认。

所有回复、文档和核心逻辑注释使用中文，专业词汇保持英文。
```

## 17. 最终判断

新工程最需要守住的不是“能力完整”，而是“体验不重”。

第一版成功标准应该是：

```text
开发者能把多个需求丢进去；
每个需求自动拥有独立 worktree 和 agent；
页面用一张动态画布告诉开发者所有任务在哪里；
只有真正需要开发者判断时才出现明确、简洁、可操作的确认；
其他时候系统安静地观察、继续、恢复和记录。
```

如果某个功能会让开发者更像是在操作 workflow runtime，而不是托管多个 coding task，就应该推迟或放进 debug。
