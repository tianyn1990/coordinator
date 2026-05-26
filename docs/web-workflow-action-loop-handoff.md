# Web Workflow Action Loop 交接文档

> 状态：交接给后续 `coordinator` 会话继续设计与实现  
> 生成时间：2026-05-23 Asia/Shanghai  
> 当前仓库：`/Users/hetao/Documents/github/coordinator`  
> 目标读者：继续实现 Web 驱动真实流程、Workflow action 确认闭环的 agent / 开发者

> 更新说明：本文记录 `add-web-workflow-action-loop` 前后的历史判断。2026-05-25 后，`docs/workflow-agent-lifecycle-handoff.md` 对本文中“所有 allowedActions 都按人类确认处理”的策略做了修正：Coordinator 不应成为 workflow 遥控器；Web 只展示真正 operator-facing gate，`materialize-change <change-id>` 等 agent/internal action 只进入 Workflow Lens debug/detail。本期不修改 workflow protocol。2026-05-26 后，新 Web UI 以 `docs/web-developer-workbench.md` 的 Web V2 方案为准；本文中 `Task Cockpit`、`Action Panel` 等术语仅表示历史实现或旧切片语境。

## 1. 当前目标

用户希望从 Web 页面触发并推进完整真实流程，尽量自动走到最远；但当 workflow 内部出现需要人类确认的阶段时，Coordinator 应该在 Web 中明确展示，并让人确认或补充输入后再继续推进。

这意味着当前工作已经从“能启动 workflow 并展示状态”进入下一阶段：

```text
Web 创建任务
-> Coordinator daemon/outer Agent 推进 execution plan / attempt / workspace / workflow start
-> Workflow 返回 stage/substate/progress/allowedActions
-> Coordinator Web 展示需要人确认的 action
-> 用户确认
-> Coordinator Core 受控调用 workflow protocol action
-> 继续 run until blocked
```

核心判断：

- Coordinator 需要主动推进任务，但不是静默执行所有 workflow action。
- Daemon 可以自动 tick、inspect、reconcile。
- Web 只能把 workflow 当前阶段中的 operator-facing gate 转成 operator action card；不能把所有 allowed action 都视为人工待办。
- 人确认后，Core 才能调用 `workflow protocol action`。
- Outer Agent 不应该自行选择 workflow profile，也不应该根据 `allowedActions` 静默执行 workflow action。

## 2. 当前设计边界

必须继续遵守：

- 根目录 `AGENTS.md`。
- `docs/AGENTS.md`。
- `docs/web-developer-workbench.md`。
- `docs/workflow-protocol.md`。
- `docs/contracts.md`。

关键边界：

- `Coordinator Core` 是唯一状态机和策略校验者。
- Web 不是 truth source，只提交 operator intent。
- Daemon/outer Agent 不应自动执行 workflow 内部 action。
- Workflow `.workflow` private state 不可被 Coordinator 读取或写入。
- Workflow projection 中的 `stage`、`substate`、`gate`、`progress`、`stageArtifacts`、`allowedActions`、`actionInputs` 是 display/operator/control hint，不得直接推导 PR ready、done、merge。
- 复杂内容优先 artifact，工具参数保持窄。
- PR/MR/merge 仍必须走已有 Core gate 和 human approval。

一句话：

```text
workflow 管单次代码变更内部怎么走。
coordinator 管多个任务如何被开发者观察、确认、调度和收口。
```

## 3. 已完成代码与提交

当前分支：

```text
main...origin/main [ahead 2]
```

最近关键提交：

```text
38b334f 修复 Web 真实流程的 workflow 启动适配
4474f9f 适配 workflow 0.6.10 展示投影
09c9d13 完成 Web 任务创建与工程操作切片
5614d99 完成 Task Cockpit 与 Workflow Lens 切片
6ea6d0d 完成 Web Developer Workbench 首个切片
```

### 3.1 `4474f9f` 主要内容

适配 `@hetao-ai/workflow@0.6.10` 的 machine-facing projection：

- 解析并展示：
  - `stage`
  - `substate`
  - `gate`
  - `allowedActions`
  - `deniedActions`
  - `actionInputs`
  - `progress`
  - `stageArtifacts`
- 明确这些字段只进入 operator/debug 展示，不驱动外层状态机。
- Web Task Cockpit / Workflow Lens 可以展示 workflow 当前阶段、子阶段、进度、阶段 artifact 与 action hint。

### 3.2 `38b334f` 主要内容

修复 Web 真实流程中 workflow 启动适配：

- 新增 DB 字段：

```sql
ALTER TABLE tasks ADD COLUMN requested_workflow_profile TEXT;
```

- Web New Task 增加 `Workflow selection`：
  - `auto / runtime decides`
  - `feature`
  - `bugfix`
  - `micro-change`
- 普通 `Create task` 仍允许 `auto`。
- `Create and run until blocked` 在当前 workflow runtime 仍要求 explicit profile 时，会要求人类先选 `feature / bugfix / micro-change`。
- `start_workflow_run` 仍拒绝 outer Agent 传 `profile` 参数，只从 task 上读取人类显式选择。
- Workflow protocol failure envelope 和进程失败输出会以短错误摘要进入 operation ledger，便于 Web 排查。
- 修复 React synthetic event async 后 `event.currentTarget.reset()` 失效问题。

## 4. Workflow 侧当前状态

用户已升级全局 workflow：

```text
@hetao-ai/workflow@0.6.10
```

已验证：

```text
/Users/hetao/.ht-workflow/bin/workflow --version
0.6.10
```

当前 workflow 0.6.10 已稳定输出：

- `stage`
- `substate`
- `gate`
- `allowedActions`
- `deniedActions`
- `actionInputs`
- `progress`
- `stageArtifacts`

但当前 `workflow protocol start` 的 machine-facing 行为仍需要显式 `--workflow <profile>`。因此 Coordinator Web 当前做了保守处理：

- 人类明确选择 profile 时，Coordinator 传给 workflow。
- 未选择 profile 时，不让 `Create and run until blocked` 自动启动 workflow。
- 保留普通 task 的 `auto / runtime decides` 语义，等待未来 workflow runtime 支持无 profile start。

## 5. 当前本地服务状态

本会话中启动过：

```text
API: http://127.0.0.1:4310
Web: http://127.0.0.1:5173/
DB:  /Users/hetao/Documents/github/coordinator/.coordinator-smoke/actioninputs-0.6.9/coordinator.sqlite
```

最近确认时监听进程：

```text
node PID 90045 -> 127.0.0.1:4310
node PID 90087 -> 127.0.0.1:5173
```

新会话不应假设这些进程仍在。建议先执行：

```bash
lsof -nP -iTCP:4310 -sTCP:LISTEN || true
lsof -nP -iTCP:5173 -sTCP:LISTEN || true
curl -sS http://127.0.0.1:4310/health
curl -sS -I http://127.0.0.1:5173/
```

如果需要重启：

```bash
COORDINATOR_DB_PATH=/Users/hetao/Documents/github/coordinator/.coordinator-smoke/actioninputs-0.6.9/coordinator.sqlite pnpm dev:api
VITE_COORDINATOR_API_BASE=http://127.0.0.1:4310 pnpm dev:web
```

## 6. 真实 Web E2E 验证结果

本轮用 Chrome 自动化从 Web 页面真实操作：

1. 打开 `http://127.0.0.1:5173/`。
2. 进入 `New Task`。
3. 选择 project：

```text
fe-contest-student-actioninputs-069
```

4. 填写任务：

```text
Title: Web E2E auto 1779477388406
Workflow selection: feature
```

5. 点击 `Create and run until blocked`。

### 6.1 新任务关键 IDs

```text
task:          cb8bb59a-5f58-45ba-837b-b3d1f5aad66d
attempt:       8789901e-774f-44b1-916f-692312842e4a
workspace:     53098bd4-e56d-4b56-986a-6dc92609c8f4
workflow run:  2af013a3-3839-4869-b6e5-db27daeb4ce7
external run:  run-1779477448926
profile:       feature
```

Workspace：

```text
/Users/hetao/Documents/github/coordinator/.coordinator-smoke/actioninputs-0.6.9/workspaces/bd7fa169-4378-47df-87eb-195ef1522f1d/cb8bb59a-5f58-45ba-837b-b3d1f5aad66d/8789901e-774f-44b1-916f-692312842e4a
```

Branch：

```text
coordinator/cb8bb59a-5f58-45ba-837b-b3d1f5aad66d/8789901e-774f-44b1-916f-692312842e4a
```

### 6.2 成功走通的链路

真实链路已完成：

```text
Web /tasks
-> daemon tick
-> outer Coordinator Agent
-> write_execution_plan
-> create_attempt
-> create_workspace
-> start_workflow_run
-> workflow protocol start --workflow feature
```

Timeline 中确认：

- `execution_plan.created`
- `attempt.created`
- `workspace.ready`
- `workflow.record_created`
- `workflow.started`
- `agent_tool_call start_workflow_run succeeded`

### 6.3 当前停点

Workflow projection：

```json
{
  "runId": "run-1779477448926",
  "profile": "feature",
  "lifecycle": "active",
  "stage": "requirements",
  "gate": {
    "state": "open",
    "reason": null
  },
  "allowedActions": ["freeze-requirements"],
  "handoff": {
    "available": false
  },
  "progress": {
    "label": "requirements",
    "summary": "workflow is active at requirements/stage-entry",
    "ordinal": 1,
    "total": 3
  },
  "stageArtifacts": [
    {
      "kind": "requirements",
      "path": ".workflow/runs/run-1779477448926/artifacts/requirements.md",
      "label": "requirements stage artifact"
    }
  ]
}
```

Web Task Cockpit 上可见：

```text
Workflow Lens
feature / active
Gate: OPEN
Stage: requirements
Substate: none
Handoff: none
Allowed actions: freeze-requirements
Stage artifact: .workflow/runs/run-1779477448926/artifacts/requirements.md
```

### 6.4 重要验证：Coordinator 没有自动执行 workflow action

再次从 Web 对目标任务触发推进后，outer Agent 请求的是：

```text
tool: inspect_workflow_run
run: 2af013a3-3839-4869-b6e5-db27daeb4ce7
```

Timeline 中确认：

```text
workflow.status_inspected
agent_tool_call inspect_workflow_run succeeded
daemon.agent_tool_executed inspect_workflow_run
```

没有执行：

```text
workflow protocol action ... freeze-requirements
```

这符合当前边界：daemon/outer Agent 只 inspect，不静默推进 workflow action。

## 7. 当前真实问题与产品判断

用户指出：如果 Workflow 中很多地方需要人确认，那 Coordinator 需要承担展示、确认、输入和继续推进的职责。

这是正确的。

当前系统缺少的是：

```text
Workflow operator-facing gate -> Coordinator Web action card -> 人类确认 -> Core 受控 workflow action -> 继续 run until blocked
```

现在停在 `requirements` 阶段不是失败，而是缺少这个 operator-facing gate 确认闭环。

## 8. 推荐设计：Workflow Action Card

建议新增一个 Coordinator 侧的 operator action model，把 Workflow projection 中的真正 operator-facing gate 转成 Web 可操作卡片。`allowedActions` 本身只说明 workflow 内部控制面允许什么，不足以直接成为 Action Card。

### 8.1 输入来源

来自 workflow status projection：

- `workflowRun.id`
- `workflowRun.stateVersion`
- `status.stage`
- `status.substate`
- `status.gate`
- `status.allowedActions`
- `status.deniedActions`
- `status.actionInputs`
- `status.stageArtifacts`
- `status.progress`
- `status.handoff`

### 8.2 UI 表达

当 workflow running 且无 handoff，并且存在 operator-facing action 时，Task Cockpit 应显示：

```text
Workflow requires operator action

Stage: requirements
Progress: requirements 1/3
Artifact:
  requirements stage artifact
  .workflow/runs/run-.../artifacts/requirements.md

Allowed action:
  freeze-requirements

[Approve requirements and continue]
```

如果 action 需要参数，例如：

```json
{
  "actionInputs": {
    "materialize-change": {
      "requiredArgs": ["change-id"],
      "usage": "workflow protocol action --run run-... materialize-change <change-id>"
    }
  }
}
```

Web 不应默认把这类 agent/internal action 升级成人工表单。`materialize-change <change-id>` 应优先由 workflow runtime / inner coding agent 在其上下文中处理；Coordinator Web 只在 Workflow Lens 或 debug detail 中展示参数提示：

```text
Action: materialize-change
required arg: change-id
usage: workflow protocol action --run run-... materialize-change <change-id>
not shown in needs me
```

### 8.3 风险等级

修正后的第一版建议按 action ownership 分层：

```text
inspect-only:
  workflow status / events / artifacts inspect
  daemon 可自动做

operator-facing:
  freeze-requirements
  approve-planning-dossier
  approve-review
  明确 merge / approval 类 gate
  Web 必须由人确认后做

agent/internal:
  materialize-change
  repair-current-change-reference
  run-alignment-checks
  inspect/resume 类 workflow 内部动作
  只进入 Workflow Lens debug/detail，不进入 needs me

restricted:
  PR/MR create/update
  merge approval
  merge
  workspace cleanup
  继续走既有 Core gate
```

后续如需更精确区分 ownership，应优先推动 workflow protocol 增强 `agent.state`、`blocker.owner`、`operatorActions`、`agentActions`。本期不修改 workflow protocol，Coordinator 侧先使用保守分类，避免误打断开发者。

## 9. 推荐实现方案

建议创建一个 OpenSpec change，名称可用：

```text
add-web-workflow-action-loop
```

目标：

- 在 Task Cockpit 中加入 Workflow Action Panel。
- Panel 只展示 operator-facing gate，不再由 `allowedActions.length > 0` 直接触发。
- Core/API 增加受控 workflow action endpoint。
- Web 提交 operator intent。
- Core 校验 latest status / allowedActions / actionInputs / stateVersion。
- Core 调用 `workflow protocol action`。
- 成功后自动 refresh，并允许用户继续 `Run until blocked`。

### 9.1 Core 层

已有 `packages/core/src/workflow-protocol-adapter.ts` 中存在：

```ts
invokeWorkflowAction(...)
```

后续需要确认并利用它，而不是新写 CLI 调用。

建议新增 operator-facing helper，例如：

```ts
invokeWorkflowActionFromOperator(context, {
  workflowRunId,
  expectedStateVersion,
  action,
  args,
  actor
})
```

职责：

- 读取 workflow run。
- inspect latest status 或使用可证明最新的 projection。
- 校验 action 属于 Coordinator 侧 operator-facing classification。
- 校验 action 在 `allowedActions` 中。
- 校验 action 不在 `deniedActions` 中。
- 根据 `actionInputs[action].requiredArgs` 校验参数。
- 调 `invokeWorkflowAction`。
- 记录 operation/event。
- 返回 sanitized result + updated status projection。

### 9.2 API 层

建议 endpoint：

```http
POST /workflow-runs/:workflowRunId/actions
```

Request：

```json
{
  "expectedStateVersion": 3,
  "action": "freeze-requirements",
  "args": [],
  "actor": "web-operator"
}
```

或如果当前 adapter 只支持单个 arg：

```json
{
  "expectedStateVersion": 3,
  "action": "materialize-change",
  "arg": "change-id"
}
```

建议保持第一版窄化：

- `action`: string
- `arg`: optional string
- 后续再扩展多参数，不要一开始做复杂 JSON schema。

### 9.3 Web 层

Task Cockpit / Workflow Lens 增加 Action Panel：

- 展示当前 stage / progress。
- 展示 stageArtifacts。
- 只展示 operator-facing action。
- `actionInputs[action].requiredArgs` 非空时，只有 action 已被分类为 operator-facing 才显示输入；agent/internal action 只展示 debug hint。
- 用户点击后调用 API。
- 成功后 refresh 当前 task。
- 可选：成功后自动触发 task-scoped `Run until blocked`，但第一版建议先只 refresh，由用户再点一次继续；若用户确认，希望体验更连续，可在同一次按钮中做：

```text
Confirm action -> invoke workflow action -> refresh -> run until blocked current task
```

这个按钮文案应明确，例如：

```text
Approve requirements and continue
```

而不是泛化的：

```text
Run all
```

### 9.4 Daemon / outer Agent

本 change 不应让 daemon 自动执行 workflow action。

允许：

- inspect running workflow。
- 如果 handoff 产生，按 handoff 后续处理。
- 如果只有 agent/internal allowedActions，继续视为 workflow/inner agent 内部执行窗口，不制造 operator needs-me。
- 如果 operator-facing gate 存在，等待 operator。

不允许：

- daemon 根据 `allowedActions` 调 `invokeWorkflowAction`。
- outer Agent 生成 `coordinator-tool tool: workflow_action` 并自动执行。
- daemon 在 inner coding agent 仍在运行时，因为看到 `allowedActions` 就打断开发者。

如果未来需要自动低风险 action，必须另开 change，并定义 action allowlist 与风险策略。

## 10. 需要同时修复/优化的问题

### 10.1 Global Run Until Blocked 被历史任务污染

本轮发现：

全局 `Run until blocked` 返回 `FAILED`，但目标新任务没失败。原因是候选队列里存在旧 smoke 任务：

```text
task: ee7735d3-7cdd-4721-bcef-44a6d094eafb
title: Web E2E smoke: workflow 0.6.10 projection via UI
status: resuming
workflow: unknown / starting
failed op: workflow:start unknown
reason: 之前 workflow protocol start 无 profile 失败残留
```

症状：

- 新任务已经成功 running。
- 但 global tick 中某个历史任务 `reconcile_failed` 导致 run banner 显示 `FAILED`。

建议：

- 区分 global run 和 task-scoped run 的 stop reason。
- Global run 不应因为一个历史任务失败就掩盖其他任务的成功推进。
- Web RunUntilBlockedBanner 应显示按 task 分组的 action summary。
- 对历史 stuck/unknown workflow run 提供 operator cleanup/reconcile UI。
- task-scoped `Run until blocked` 应强制只传当前 `taskId`，并在 banner 中显示 scope。

### 10.2 Task card 缺少稳定 selector

自动化时多次误点历史任务，原因：

- `TaskCardView` 没有 `data-task-id`。
- `Open` button 没有 `aria-label` 带 task id/title。
- 自动化只能通过文本和 ancestor 猜测目标卡片。

建议补充：

```tsx
<article
  className={...}
  data-task-id={card.task.id}
  aria-label={`Task ${card.task.title}`}
>
  ...
  <button
    type="button"
    data-action="open-task"
    data-task-id={card.task.id}
    aria-label={`Open task ${card.task.title}`}
  >
    Open
  </button>
</article>
```

这对自动化测试、可访问性和后续 E2E 都有价值。

### 10.3 Task 顶层 status 与 workflow running 不一致

目标新任务：

```text
task.status = planning
workflow.status = running
currentBlocker = planning
next owner = workflow handoff
```

这对用户理解不够直观。

建议：

- 在 task summary projection 中把 workflow running no handoff 且存在 operator-facing gate 的场景显示为：

```text
currentBlocker: waiting operator-facing workflow gate
nextOwner: operator gate confirmation
```

或增加 UI-only derived status：

```text
workflow_running
waiting_operator_gate
```

如果只存在 `materialize-change <change-id>` 这类 agent/internal action，则不应派生为 `waiting_operator_gate`，只在 Workflow Lens debug/detail 展示。

谨慎点：

- 不一定要立即改变 task DB status。
- 可以先在 Web card/cockpit 中做 derived display。
- 如果要改变 Core task status，需要更新状态机契约和测试。

### 10.4 Workflow action artifact 可读性

当前 `stageArtifacts` 返回相对路径：

```text
.workflow/runs/run-1779477448926/artifacts/requirements.md
```

Coordinator 不应读取 `.workflow` private state，但 protocol-owned stage artifact 是 display path。Web 目前只是展示 path，没有打开/预览。

后续可考虑：

- 通过 workflow protocol artifacts endpoint 获取 artifact list。
- 或增加受控 artifact read endpoint，仅允许 protocol-owned artifact / coordinator artifact。
- 第一版 action card 可以先只展示 path，不做预览。

## 11. 推荐下一步执行顺序

建议新会话按这个顺序做：

1. 阅读：
   - 根目录 `AGENTS.md`
   - `docs/AGENTS.md`
   - `docs/web-developer-workbench.md`
   - `docs/workflow-protocol.md`
   - 本文档
2. 检查当前 git：

```bash
git status --short --branch
git log --oneline -5
```

3. 创建 OpenSpec change：

```text
add-web-workflow-action-loop
```

4. Proposal 中明确：
   - 不让 daemon/outer Agent 自动执行 workflow action。
   - Web action card 是 operator-facing gate 的 human-confirmed intent。
   - Core 是唯一执行和校验 workflow action 的入口。
5. 实现最小闭环：
   - `freeze-requirements` 无参数 action card。
   - API endpoint 调 Core。
   - Web button 触发。
   - 成功后 refresh。
6. 补充参数 action 支持：
   - 使用 `actionInputs.requiredArgs` 显示输入。
   - 第一版只支持 0 或 1 个 string arg。
7. 修复 Web selector：
   - `data-task-id`
   - action button `aria-label`
8. 改善 task-scoped/global run banner：
   - 明确 scope。
   - 避免历史任务失败污染当前任务结果。
9. 验证真实流程：
   - 选择已有目标 task 或新建 task。
   - Web 点击 action card `freeze-requirements`。
   - 确认 workflow 进入下一 stage 或返回下一 action/handoff。
   - 再 run until blocked。
10. 使用 subagent review：
    - 必查 docs 边界。
    - 必查是否过度设计。
    - 必查是否错误扩大 Coordinator Agent Surface。
    - 必查是否让 daemon 自动执行 workflow action。
11. OpenSpec 完成后归档，再提交。

## 12. 建议 OpenSpec 任务草案

```markdown
## 1. Spec / Design

- [ ] 1.1 定义 Web Workflow Action Loop 的边界：仅 operator-facing gate human-confirmed，不自动执行。
- [ ] 1.2 定义 operator action card 的输入、展示、执行语义，只承接 operator-facing gate。
- [ ] 1.3 定义 Core/API workflow action endpoint 的校验契约。
- [ ] 1.4 定义 task-scoped/global run until blocked 的停止原因展示。

## 2. Core / API

- [ ] 2.1 新增 operator-facing workflow action helper。
- [ ] 2.2 校验 expectedStateVersion / action classification / allowedActions / deniedActions / actionInputs。
- [ ] 2.3 增加 POST /workflow-runs/:id/actions。
- [ ] 2.4 补充 operation/event 记录和 sanitized response。

## 3. Web

- [ ] 3.1 Task Cockpit 增加 Workflow Action Panel。
- [ ] 3.2 支持无参 action：freeze-requirements。
- [ ] 3.3 agent/internal action input 只进入 Workflow Lens debug/detail，不进入 needs-me。
- [ ] 3.4 action 成功后 refresh 当前 task。
- [ ] 3.5 task card 增加 data-task-id 和 aria-label。
- [ ] 3.6 RunUntilBlockedBanner 显示 scope 和分组结果。

## 4. Tests / Validation

- [ ] 4.1 Core tests：action 不在 allowedActions 时拒绝。
- [ ] 4.2 Core tests：缺少 required arg 时拒绝。
- [ ] 4.3 API tests：Web endpoint 可调用 workflow action。
- [ ] 4.4 Web build/typecheck。
- [ ] 4.5 真实 Web smoke：freeze-requirements -> 继续 run until blocked。
- [ ] 4.6 subagent review。
- [ ] 4.7 OpenSpec archive + commit。
```

## 13. 当前可用命令

### 13.1 DB migrate

```bash
pnpm cli migrate --db /Users/hetao/Documents/github/coordinator/.coordinator-smoke/actioninputs-0.6.9/coordinator.sqlite
```

### 13.2 启动本地服务

```bash
COORDINATOR_DB_PATH=/Users/hetao/Documents/github/coordinator/.coordinator-smoke/actioninputs-0.6.9/coordinator.sqlite pnpm dev:api
VITE_COORDINATOR_API_BASE=http://127.0.0.1:4310 pnpm dev:web
```

### 13.3 查看目标 task

```bash
curl -sS http://127.0.0.1:4310/tasks/cb8bb59a-5f58-45ba-837b-b3d1f5aad66d
curl -sS http://127.0.0.1:4310/tasks/cb8bb59a-5f58-45ba-837b-b3d1f5aad66d/timeline
```

### 13.4 Workflow status

```bash
pnpm cli workflow status \
  --db /Users/hetao/Documents/github/coordinator/.coordinator-smoke/actioninputs-0.6.9/coordinator.sqlite \
  --run 2af013a3-3839-4869-b6e5-db27daeb4ce7
```

### 13.5 常规验证

```bash
pnpm --filter @coordinator/db build
pnpm --filter @coordinator/core build
pnpm --filter @coordinator/api build
pnpm --filter @coordinator/web build
pnpm typecheck
openspec validate --all --strict
```

针对本功能建议测试：

```bash
pnpm test -- packages/core/src/workflow-protocol-adapter.test.ts packages/core/src/coordinator-agent-tools.test.ts packages/core/src/operator-surface.test.ts apps/api/src/server.test.ts
```

## 14. 不要做的事

新会话不要：

- 直接编辑 workflow private state。
- 让 daemon 自动执行 `freeze-requirements`。
- 让 outer Agent 通过 coordinator-tool 传 workflow action。
- 把复杂 workflow raw status 直接暴露给 Agent Surface。
- 让 Web 绕过 Core 直接执行 workflow CLI。
- 在没有 human approval 的情况下做 PR/MR merge。
- 为了解决 global run 污染而删除历史 DB 记录，除非用户明确要求清理 smoke DB。

## 15. 最小成功标准

下一轮最小成功标准建议：

1. Web Task Cockpit 对 `requirements` 阶段显示：

```text
Approve requirements and continue
```

2. 点击后 Core 受控执行：

```text
workflow protocol action --run run-1779477448926 freeze-requirements
```

3. Timeline 出现：

```text
workflow.action
workflow.status_inspected 或 action 后 projection
```

4. Web 刷新后 workflow 不再停留在同一个 `requirements/stage-entry`，而是进入下一阶段、下一 action，或产生 handoff。

5. Daemon/outer Agent 仍然没有在未确认时自动执行 workflow action。

这就是 Coordinator 从“能观察 workflow”走向“能作为多任务人机协作层推进 workflow”的关键闭环。
