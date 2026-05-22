## Context

当前 Web 默认入口已经是 Developer Workbench，Task Cockpit 已经承接单任务主要详情。但真实日常流程还缺三类能力：

- 任务下达需要承接大量上下文编辑，而不是侧栏小表单。
- 工程注册和配置需要从 Web 可见、可操作。
- operator 想“尽量走到最远”，但推进必须仍由 daemon/Core/workflow protocol 控制。

现有 API 已提供 `/tasks`、`/projects/register`、`/daemon/tick`、task control、workflow status、PR/MR create/update/inspect/request approval/approval/merge 等入口。本轮优先把这些能力以 Web operator flow 串起来，避免新增 Core 状态机或前端 truth source。

## Goals / Non-Goals

**Goals:**

- 让 Web 支持更完整的 New Task 体验，并保留 `Create and run until blocked`。
- 让 Web 支持 Project Admin，能查看 project registry 和注册新 project。
- 让 Web 支持全局/单任务 run-until-blocked，并清楚展示停止原因和 tick summary。
- 让 PR/MR 常用 operator actions 在 Task Cockpit / Classic Debug 中可达，并继续调用既有 API/Core runtime。
- 对附件上传、workflow profile、workspace hook 做安全占位：能表达边界，不落地未设计副作用。

**Non-Goals:**

- 不新增自动 workflow action executor。
- 不让外层 Agent 主动选择 workflow profile。
- 不直接读写 `.workflow` private state。
- 不让 Web 直接写 SQLite 或重建 Core 状态机。
- 不执行任意 workspace init/cleanup hook。
- 不实现完整文件/图片上传系统。
- 不做移动端精细设计；本轮以 PC 端功能闭环为主。

## Decisions

### 1. New Task 使用专门视图，Quick Composer 降级为入口

Workbench 侧栏保留轻量入口，但主要任务下达进入 `new-task` view。这样可以放下大文本、验收标准、约束、workflow hint 和附件占位，符合开发者真实输入任务时需要长时间编辑的场景。

替代方案是继续扩展侧栏表单。该方案会把主工作台压得过窄，并让长文本输入体验变差，因此不采用。

### 2. Workflow selection 只作为 human explicit hint，不做 outer Agent 自动选择

New Task 可提供 `workflow hint` 文本或可选输入，但默认语义是 `auto/default`，即委托 workflow runtime 自主选择。Web 不维护 workflow profile catalogue，不要求 outer Agent 知道所有 workflow。

替代方案是 Web 固定下拉 `feature/bugfix/micro-change`。该方案会把 workflow 内部演进耦合到 Coordinator UI，因此本轮不采用；未来只有在 workflow 通过 protocol capabilities 稳定暴露 profile catalogue 后，才适合展示可选列表。

### 3. Run Until Blocked 是 Web operator loop，不是新状态机

前端循环调用 `/daemon/tick` 和 task/project refresh，并根据 Core 返回的最新 task detail、humanRequests、workflowRuns、diagnosis、PR/MR 状态做停止解释。它不调用 `/workflow-runs/:id/action`，不根据 `allowedActions/actionInputs` 自动推进 workflow。

停止原因属于 operator explanation，不写入 Core 状态机。真相仍来自 Core DB 与 daemon events。

### 4. Project Admin 复用现有 project registry API

Project Admin 调用 `/projects` 与 `/projects/register`。工程健康用已有字段做展示：registrationStatus、defaultBranch、workflowLauncher、provider/default agent 配置等。workspace hook 只显示预留字段和“未执行副作用”提示。

如果后续要执行 hook，必须另开 change 设计 sandbox、approval、path containment、secret handling、audit event、retry/recovery 和 cleanup。

### 5. PR/MR actions 只展示已有 Core/API 能力

Task Cockpit / Classic Debug 可以展示 create/update/inspect-review/request-approval/approve/reject/merge 表单或按钮，但所有副作用继续走 API/Core。Web 只根据 surface tools、task detail 和 PR/MR 当前存在性控制可见性与禁用态，不自行判断 merge readiness。

## Risks / Trade-offs

- [Risk] 前端 run-until-blocked 停止条件与 Core 后续语义不完全一致。  
  Mitigation: 停止原因只作为 operator explanation；每轮都 refresh task detail；不写回 DB，不影响 Core 状态。

- [Risk] create-and-run 循环可能让用户误以为 Web 会执行 workflow action。  
  Mitigation: running workflow without handoff 时明确显示 inspect-only stop reason，并在 UI 文案中说明不会自动执行 workflow action。

- [Risk] Project Admin 健康展示字段有限。  
  Mitigation: 第一版只展示已有 registry 字段与缺失状态，不伪造 provider health；后续可通过只读 health API 增强。

- [Risk] PR/MR 操作表单需要 bodyArtifact 等已有 artifact path，用户可能不知道填什么。  
  Mitigation: UI 以 operator/debug 能力方式展示，提供当前 key artifacts 作为参考；不自动生成或猜测 artifact。
