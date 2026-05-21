# Web Developer Workbench

> 状态：Iteration 13 设计总纲  
> 适用范围：Web 多工程、多任务工作台、Task Cockpit、任务创建、Project Admin、Run Until Blocked。  
> 目的：为后续 Iteration 13 的多个 OpenSpec change 提供统一产品心智、信息架构、UI 布局、交互边界和验收方向。

## 1. 产品定位

`coordinator` Web 的核心目标不是展示单个 workflow 的内部状态，而是帮助一个开发者同时管理多个工程、多个任务。

单独使用 `workflow` 时，开发者通常被固定在一个工作流上下文里，需要自己持续盯着阶段、确认、PR/MR、异常和下一步。`coordinator` 增加外层智能层和 Web 工作台的目的，是把这些跨任务的常规确认、异常筛选、PR/MR 操作和进度观察集中起来，降低开发者在多个任务之间来回切换的成本。

因此 Web 的主入口必须是：

```text
多工程、多任务开发者工作台
```

而不是：

```text
单任务 debug timeline
```

CLI 仍然重要，但它是 smoke、排查、脚本化和高级 operator 的补充工具。真实日常使用路径应优先从 Web 完成。

## 2. 用户心智

用户打开 Web 时，最想知道的是：

- 我现在管理了哪些工程。
- 每个工程有哪些任务正在执行。
- 哪些任务正在顺利推进。
- 哪些任务需要我确认。
- 哪些任务卡在 workflow、PR/MR、review、merge 或 project config。
- 哪些异常需要我处理。
- 我能安全地让系统继续跑到哪里。
- 我应该在哪个任务上投入注意力。

用户进入单个任务时，才需要知道：

- 这个任务外层流程走到哪里。
- workflow 内部 stage / substate / gate 是什么。
- 当前有哪些 evidence artifact。
- 是否有 human request、PR/MR、merge approval。
- 如果异常，底层 timeline、surface、operation ledger 和 protocol inspect 是什么。

## 3. 页面结构

Iteration 13 应形成四类页面或视图：

```text
Workbench
Task Cockpit
Project Admin
Classic Debug
```

### 3.1 Workbench

Workbench 是默认首页和主工作区。

职责：

- 多 project 概览。
- 多 task 概览。
- Action Inbox。
- 快速创建任务入口。
- 全局 safe queue 推进入口。
- 进入 Task Cockpit / Project Admin / Classic Debug。

布局建议：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Global Command Bar                                                           │
│ Coordinator  Search tasks/projects...        [New Task] [Run safe queue]     │
├───────────────┬──────────────────────────────────────────────┬───────────────┤
│ Project Rail  │ Workbench Board                              │ Action Inbox  │
│               │                                              │               │
│ All     18    │ ┌──────────────────────────────────────────┐ │ Needs me  3   │
│ coordinator 7 │ │ Mission Strip                             │ │               │
│ workflow    5 │ │ running 8 / blocked 3 / review 2 / done 5 │ │ ┌───────────┐ │
│ fe-app      6 │ └──────────────────────────────────────────┘ │ │ │Approve MR │ │
│               │                                              │ │ │Task #42   │ │
│ + Register    │ ┌──────────────┐ ┌──────────────┐            │ │ └───────────┘ │
│ Project       │ │ Needs Human  │ │ Running      │            │ │ ┌───────────┐ │
│               │ │ task cards   │ │ task cards   │            │ │ │Clarify req│ │
│               │ └──────────────┘ └──────────────┘            │ │ │Task #51   │ │
│               │ ┌──────────────┐ ┌──────────────┐            │ │ └───────────┘ │
│               │ │ Workflow     │ │ PR / Review  │            │ │               │
│               │ │ active       │ │ waiting      │            │ │               │
│               │ └──────────────┘ └──────────────┘            │ │               │
├───────────────┴──────────────────────────────────────────────┴───────────────┤
│ Collapsed System Drawer: daemon ticks / failures / raw event stream           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Task Cockpit

Task Cockpit 是单任务主要详情页。

职责：

- 展示外层执行链路。
- 展示 workflow 内部 stage/substate/gate。
- 展示 evidence artifacts。
- 展示当前 action cards。
- 承接 PR/MR、human request、merge approval。
- 将底层 debug 信息折叠到 drawer。

布局建议：

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Task Header                                                                 │
│ title / project / status / blocker     [Run until blocked] [Pause] [Debug] │
├────────────────────────────────────────────────────────────────────────────┤
│ Outer Flow                                                                  │
│ Task ─ Plan ─ Attempt ─ Workspace ─ Workflow ─ PR ─ Review ─ Merge ─ Done   │
├──────────────────────────────────────────────┬─────────────────────────────┤
│ Workflow Lens                                │ Evidence / Actions          │
│ requirements ✓                               │ Pending human request       │
│ design/spec ✓                                │ PR approval                 │
│ implementation ●                             │ Merge button                │
│   substate: test-align                       │ Key artifacts               │
│ review ○                                     │                             │
│ handoff ○                                    │                             │
├──────────────────────────────────────────────┴─────────────────────────────┤
│ Debug Drawer: timeline / surface / operation ledger / workflow events       │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Project Admin

Project Admin 管工程级配置。

职责：

- 注册工程。
- 查看和修复 provider/workflow/agent 配置。
- 配置 workspace root。
- 展示 project health。
- 预留 workspace init / cleanup hook。

布局建议：

```text
Project Admin
├─ Registry
│  ├─ repo path
│  ├─ default branch
│  ├─ provider kind
│  ├─ workflow launcher
│  └─ agent defaults
├─ Workspace Policy
│  ├─ workspace root
│  ├─ create worktree preflight
│  ├─ init script hook  预留
│  ├─ cleanup script hook  预留
│  └─ retention policy  预留
└─ Provider Health
   ├─ git
   ├─ PR/MR provider
   ├─ workflow
   └─ agent provider
```

### 3.4 Classic Debug

Classic Debug 保留老页面能力。

职责：

- raw surface。
- raw timeline。
- operation ledger。
- recovery timeline。
- provider/protocol inspect。
- full artifact refs。

普通用户不应默认进入 Classic Debug，但排查时必须可达。

## 4. 信息分层

Web 信息必须分三层：

### 4.1 Decision Layer

默认展示，服务决策：

- 当前状态。
- 当前 blocker。
- next owner。
- needs me。
- safe action。
- run-until-blocked 停止原因。

### 4.2 Evidence Layer

按需展示，服务理解：

- execution plan。
- workflow summary。
- stage artifacts。
- PR/MR URL。
- validation run。
- human question/answer artifact。
- review summary。

### 4.3 Debug Layer

默认折叠，服务排查：

- surface JSON。
- raw timeline。
- operation ledger。
- recovery decision。
- provider/protocol inspect。
- full event payload summary。

不要把 Debug Layer 默认铺在主页面上。

## 5. Task Card 信息模型

Workbench 的 task card 应展示：

```text
project
title
task status
current blocker
next owner
outer flow coarse progress
workflow profile / stage / substate
workflow gate state
PR/MR status
human request / merge approval indicator
latest safe action
key artifact refs
updated at
```

示例：

```text
┌──────────────────────────────────────────────┐
│ fe-app                         running       │
│ 修复空提交评分异常                            │
│                                              │
│ Coordinator: workspace ready                 │
│ Workflow: implementation / test-align        │
│ PR: none                                     │
│                                              │
│ ▰▰▰▰▱▱  Workflow active                      │
│                                              │
│ next: waiting workflow handoff               │
│ artifacts: execution-plan.md, summary.md     │
└──────────────────────────────────────────────┘
```

如果 workflow stage/substate 尚未由 workflow 工程稳定输出，则 card 必须 graceful fallback：

```text
Workflow: running / stage unknown
```

## 6. Action Inbox

Action Inbox 聚合需要人介入的事项。

优先级建议：

1. merge approval。
2. human request。
3. PR/MR review or conflict。
4. project config blocker。
5. operator attention / recovery required。
6. failed or unknown task。

Inbox card 应显示：

```text
action kind
task title
project
reason
primary action
secondary action
link to cockpit/debug
```

Inbox action 必须调用 API/Core runtime，不直接改 DB。

## 7. Task Creation 设计

任务创建应是重点页面，不应是窄表单。

目标：

- 支持大量文本输入。
- 支持结构化描述需求、背景、验收标准、约束。
- 支持 project/context 选择。
- 支持 autonomy 选择。
- 支持 human explicit workflow selection 的入口，但默认委托 workflow runtime 自动选择。
- 预留图片/文件上传。

布局建议：

```text
┌──────────────────────────────────────────────────────────────┐
│ New Task                                                     │
├───────────────────────┬──────────────────────────────────────┤
│ Project / Context     │ Task Brief Editor                    │
│ Project select        │ Title                                │
│ Branch / base info    │ Markdown editor                      │
│ Autonomy              │ Acceptance criteria                  │
│ Optional workflow     │ Constraints                          │
│ Attachments           │ Images / files drop zone             │
│                       │                                      │
│                       │ [Create task] [Create and run]       │
└───────────────────────┴──────────────────────────────────────┘
```

附件/图片上传不能在没有 artifact upload contract 时临时落地。若实现，需要先设计：

- size limit。
- type allowlist。
- artifact root。
- path safety。
- cleanup。
- how agent sees or does not see attachment refs。

## 8. Workflow Lens

Workflow Lens 展示 workflow 内部进度，但不改变 coordinator 边界。

展示字段：

```text
profile
lifecycle
stage
substate
gate.state
gate.reason
progress.label
progress.summary
allowedActions
deniedActions
actionInputs
stageArtifacts
handoff
latest events
```

边界：

- `stage/substate/gate` 只做展示。
- `allowedActions/actionInputs` 只做 operator/debug 展示。
- `handoff` 才是 coordinator 消费 workflow 结果的边界。
- daemon 不根据 workflow debug 字段自动执行 workflow action。
- outer Agent 不根据 workflow debug 字段选择 workflow action。

## 9. Run Until Blocked

`Run until blocked` 是 Web 真实流程体验的关键。

它做：

- 循环调用 daemon tick。
- 刷新 Web detail/summary。
- 记录每轮 actions summary。
- 在停止条件命中时停止并解释原因。

它不做：

- 不执行 workflow action。
- 不绕过 Core policy gate。
- 不自动 approve merge。
- 不从前端推断 PR readiness。
- 不直接写 DB。

停止条件：

```text
terminal task
pending human request
pending merge approval
workflow running without handoff
operator attention required
project config blocker
PR/MR waiting review
merge conflict
failed / unknown high-risk state
no candidate actions
max tick count reached
```

页面必须把停止原因说清楚。例如：

```text
已停止：workflow 正在运行且尚未产生 handoff。Coordinator 会继续只读 inspect，不会自动执行 workflow action。
```

## 10. Project Admin 与 Workspace Hook 预留

Project Admin 必须对齐 `docs/project-registry.md`。

第一版可落地：

- repo path。
- name。
- provider override。
- confirmed default branch。
- workflow launcher。
- outer/inner agent defaults。
- workspace root。

未来预留：

- workspace init script hook。
- workspace cleanup script hook。
- retention policy。
- provider health repair。

Hook 执行是高风险能力。除非另开设计并确认：

- sandbox。
- approval。
- path containment。
- secret handling。
- audit event。
- retry/recovery。
- failure cleanup。

否则 Iteration 13 只做 UI 占位或配置草案，不执行脚本。

## 11. 视觉方向

采用：

```text
industrial mission control
```

原则：

- 简洁但有工业控制台气质。
- 深色石墨背景。
- 冷青表示 running。
- 琥珀表示 waiting / needs human。
- 红色表示 blocked / failed。
- 绿色只用于 done。
- 适度线框、轨道、节点、状态灯。
- Workflow 节点在 Task Cockpit 中视觉权重大于其他节点。
- Debug 信息克制折叠。
- 不使用通用 SaaS 卡片堆叠感。
- 不使用一眼 AI 感的紫色渐变。
- 不为了酷炫牺牲可读性。

可用依赖：

- `lucide-react`：状态和操作 icon。
- `@xyflow/react`：Task Cockpit 外层流程图，若引入，只作为 UI projection。
- 暂不引入重型 UI framework。

## 12. 数据与 API 原则

前端可以聚合和派生展示模型，但不能成为真相源。

允许：

- 从 `/projects`、`/tasks`、`/tasks/:taskId` 聚合 board/card/inbox。
- 调用 workflow status/artifacts/events operator-only API 展示 Workflow Lens。
- 调用 Core API 执行 human answer、merge approval、merge、task control、daemon tick。
- 后续补只读 summary API，以减少 N+1 和 payload 噪音。

不允许：

- 前端直接写 SQLite。
- 前端重建 Core 状态机。
- 前端自行判断 merge readiness。
- 前端根据 stage/substate 推导 PR ready。
- 前端根据 allowedActions 自动执行 workflow action。

## 13. 迭代引用要求

Iteration 13 的每个 OpenSpec change 开始前，除 `AGENTS.md`、`docs/AGENTS.md` 和相关专题文档外，还必须阅读本文档。

对应关系：

- Slice 13.1 重点阅读：第 1-7、11-13 节。
- Slice 13.2 重点阅读：第 1-5、8、11-13 节。
- Slice 13.3 重点阅读：第 1-3、6-13 节。

如果实现中发现本文档与已有 `docs/` 边界冲突，应先暂停并与用户确认。

## 14. 非目标

Iteration 13 不做：

- 通用 DAG engine。
- 新的 Core 状态机。
- 自动 workflow action executor。
- 自动 merge approval。
- 任意脚本 hook 执行。
- 完整文件上传系统，除非另行设计 artifact upload contract。
- 远程 worker fleet 管理。
- 多租户权限系统。

这些能力可以预留入口，但不能在没有设计和确认的情况下落地副作用。
