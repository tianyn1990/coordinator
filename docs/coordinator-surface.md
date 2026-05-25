# Coordinator Surface

> 状态：初始方案基线  
> 适用范围：外层 `Coordinator Agent` 的可见性、决策输入、工具可见性、人类确认边界，以及与数据库字段之间的翻译规则。

## 1. 文档定位

`workflow` 项目已经证明一个关键原则：

> agent 只能稳定地基于当前明确可见的 surface 行动。

`coordinator` 中的外层 `Coordinator Agent` 也必须遵守同样原则。

如果外层 agent 只能看到零散数据库字段、日志片段、目录结构和隐含约定，它就会变成靠猜测行动，长期一定不稳定。

因此，`coordinator` 必须为外层 agent 提供明确的 `Coordinator Surface`。

## 2. 核心原则

### 2.1 可见才存在

对 Coordinator Agent 来说，只有当前 surface 明确交付的信息才是有效事实。

以下内容即使存在，也不自动进入 agent 当前世界：

- SQLite 表。
- workspace 目录。
- git branch。
- workflow run artifact。
- PR/MR。
- agent session log。
- task source metadata。
- provider capability。

必须由当前 surface 明确说明：

- 是否存在。
- 有什么用途。
- 当前是否允许读取。
- 读完后可以做什么。

### 2.2 数据字段不等于 agent guidance

数据库可以保存结构化字段，例如：

```text
autonomy = balanced
task.status = waiting_human
attempt.status = running
```

但暴露给 agent 时，不应只扔字段名。

应该翻译为人类可读规则，例如：

```text
当前自主级别：balanced。
你可以自行处理低风险推进、普通重试、非破坏性整理。
遇到需求范围变化、merge、破坏性操作、无法判断的 review 结论时，必须请求人类确认。
```

### 2.3 当前 surface 必须闭环

每次 Coordinator Agent 被唤醒时，surface 必须回答：

- 当前任务是什么。
- 当前目标是什么。
- 当前处于哪个 attempt。
- 当前计划是什么。
- 当前卡点是什么。
- 当前 workspace / branch / workflow run / PR/MR 状态是什么。
- 当前有哪些工具可用。
- 当前禁止做什么。
- 当前是否需要等人。
- 当前推荐下一步是什么。
- 当前验证和终止条件是什么。

### 2.4 工具可见性受当前状态约束

agent 不能看到全量工具列表后自由发挥。

当前 surface 应只暴露当前窗口合理的工具。

例如：

- 未创建 workspace 前，不暴露 `start_workflow_run`。
- workspace ready 时可以暴露 `start_workflow_run`，但不要求外层 agent 选择 workflow profile；profile 最终由 workflow runtime 决定，除非任务已有 human explicit selection。
- 未有可 merge 的 PR/MR 前，不暴露 `merge_after_approval`。
- human request 等待中，不暴露继续执行工具，只暴露 inspect / wait 类信息。

### 2.5 工具参数保持窄

工具参数应优先是：

- 枚举。
- id。
- 短字符串。
- 文件路径。
- boolean。

避免让 agent 手写复杂嵌套 JSON。

工具参数的“窄”不等于把不属于 agent 的决策压给 agent。workflow profile 选择属于 human explicit input 或 workflow runtime 自主判断，不属于外层 Coordinator Agent 的普通参数。

如果未来 Web/manual task 或外部 task source 增加结构化 workflow selection 字段，Surface 只能展示 Core 已持久化的人类显式意图和 workflow runtime 返回的 actual profile；不得把 profile 下拉、capabilities catalogue 或 runtime 内部 profile 说明作为 outer Agent 的选择菜单。

复杂内容应写入 artifact。canonical artifact root 由当前 surface 的 `artifact_root` 给出。

planning 阶段还没有 workspace 时使用 task-local root：

```text
<workspace-root>/<project-id>/<task-id>/_task/coordinator/artifacts/
```

workspace ready 后使用 attempt workspace root：

```text
<workspace>/coordinator/artifacts/
```

agent tool 只接收相对当前 surface `artifact_root` 的路径。示例：

- `execution-plan.md`
- `pr-body.md`
- `review-summary.md`
- `handoff.md`
- `human-question.md`

工具只引用 artifact path。

## 3. Surface 结构

建议 Coordinator Surface 包含以下区块。

### 3.1 Task Brief

向 agent 描述任务：

- 标题。
- 原始描述。
- 来源。
- 约束。
- 用户给出的偏好。
- 初始 autonomy 说明。
- 初始推荐 provider / workflow profile，如果有。

注意：来源系统字段不直接暴露为核心决策语言。

### 3.2 Project Brief

描述当前工程：

- project id。
- repo 名称。
- repo path。
- git provider。
- 默认分支。
- workflow launcher。
- workspace root。
- 可用 agent providers。
- 可用 provider capabilities，例如 `strong-planning`、`long-context`、`code-editing`、`review`、`fast-fix`。
- PR/MR provider 状态。

Provider 不应以品牌名承载业务语义。Surface 可以说明某个 capability 当前映射到 Codex 或 Claude Code，但 agent 做选择时应优先基于 capability，而不是硬编码厂商。

### 3.3 Current State

描述当前机器真相：

- task status。
- current attempt。
- execution plan status。
- workspace status。
- outer agent session status。
- inner agent session status。
- workflow run status。
- PR/MR status。
- human request status。

这些应翻译成人类可读描述，而不是只输出 enum。

### 3.4 Execution Plan

展示当前计划。

计划可以来自：

- 初次 Coordinator Agent 生成。
- 人类修改。
- agent 根据运行结果调整。

surface 应说明：

- 当前 step。
- 已完成 step。
- blocked step。
- 每个 step 的证据或产物。
- 允许 agent 修改计划的条件。

Execution plan 是有序 step 列表，不是 DAG。Surface 不应鼓励 agent 创建任意依赖图或多角色 agent 编排。

### 3.5 Autonomy Guidance

将 autonomy 字段翻译为规则。

第一版支持：

- `conservative`
- `balanced`
- `aggressive`

#### conservative

适合高风险任务或早期探索。

对 agent 的提示：

```text
当前自主级别：conservative。
你应优先请求人类确认。
任何需求解释、方案选择、范围变化、PR/MR 创建、merge、重试策略变化，都应先向人确认。
只允许自行执行无副作用的信息收集和状态检查。
```

#### balanced

默认。

对 agent 的提示：

```text
当前自主级别：balanced。
你可以自行处理低风险推进、普通重试、状态检查、workflow run continuation、非破坏性整理。
遇到需求范围变化、方案重大调整、成本较高操作、review 结论不明确、merge、破坏性操作时，必须请求人类确认。
```

#### aggressive

适合用户明确希望尽量无人值守的任务。

对 agent 的提示：

```text
当前自主级别：aggressive。
你应尽量自主推进任务，优先自行处理可验证的实现、rework、重试、报告生成和 PR/MR 更新。
只有在缺少必要信息、需要外部权限、存在高风险范围变化、或即将 merge 时，才请求人类确认。
merge 仍然必须等待显式审批。
```

### 3.6 Available Tools

只列当前允许工具。

每个工具说明：

- 工具名。
- 何时使用。
- 参数。
- 是否有副作用。
- 成功后预期状态。
- 失败恢复方式。

### 3.7 Denied Actions

必须明确当前禁止事项。

常见禁止：

- 不要绕过 workflow protocol。
- 不要直接编辑 `.workflow` 内部状态。
- 不要在未注册工程中创建 workspace。
- 不要在未审批时 merge。
- 不要把复杂计划通过工具 JSON 传递。
- 不要直接猜 PR/MR provider。
- 不要在 human request 等待中继续执行副作用操作。
- 不要把 observability event 当成未经翻译的行动事实。
- 不要读取 hidden memory；只有 surface 明确暴露的 memory artifact 可用。

### 3.8 Recommended Next Step

每次 surface 应给出一个推荐下一步。

它不替代 agent 判断，但能降低漂移。

示例：

```text
推荐下一步：基于当前任务生成 execution plan，并写入 `execution-plan.md`，然后调用 `write_execution_plan --artifact execution-plan.md`。
```

### 3.9 Recovery

说明当前如果失败如何恢复。

例如：

- agent session stalled：等待 daemon retry。
- workflow run blocked：读取 workflow status 并生成 human request。
- PR/MR conflict：启动 conflict-resolution workflow。
- provider unavailable：切换 provider 或 handoff。

## 4. Surface 类型

### 4.1 Bootstrap Surface

Coordinator Agent 首次被唤醒时看到。

必须包含：

- task brief。
- project brief。
- autonomy guidance。
- 可用 provider。
- 当前尚未创建 attempt / workspace。
- 推荐动作：创建 execution plan。

### 4.2 Planning Surface

用于制定或修改 execution plan。

必须包含：

- 当前目标。
- 约束。
- 可用 workflow profiles。
- 可用 agent providers。
- artifact 路径。
- human request policy。
- memory trust boundary。

### 4.3 Execution Surface

用于执行计划中的某个 step。

必须包含：

- 当前 step。
- workspace。
- branch。
- workflow run。
- inner agent provider。
- workflow status。
- workflow handoff，如果存在。
- allowed tools。
- denied actions。

### 4.4 Human Request Surface

用于处理人类请求或人类回答。

必须包含：

- question。
- reason。
- blocked item。
- human answer。
- agent 是否可以消化并继续。
- 是否需要再次追问。

### 4.5 Review Surface

用于 PR/MR review 后。

必须包含：

- review decision。
- comments summary。
- failing checks。
- agent 是否应进入 rework。
- 是否需要 human clarification。
- review contract artifact。
- validation contract artifact。

### 4.6 Merge Surface

用于 merge 前。

必须包含：

- human approval。
- approval snapshot：`pr_id + head_sha + base_sha + validation_run_id + merge_strategy`。
- PR/MR state。
- latest validation。
- base branch sync status。
- merge strategy。
- conflict handling path。

merge surface 必须明确：

```text
没有显式审批，不允许 merge。
PR/MR head/base/checks 或 validation 变化后，旧审批失效。
```

### 4.7 Human Waiting Surface

用于等待人类回答或进行人工确认时。

必须包含：

- 当前 blocked item。
- 当前 question artifact。
- human request 状态。
- 推荐动作：等待、查看问题、重新生成 surface。

不得暴露：

- `record_human_answer`
- `merge_after_approval`
- 任何执行性副作用工具

### 4.8 Human Answered Surface

当 operator 记录了回答后使用。

必须包含：

- answer artifact。
- answer version。
- agent 是否可以消化并继续。
- 是否需要追问。

此时 agent 可以读取回答并决定下一步，但仍不能自己记录回答。

### 4.9 Resume Surface

用于 daemon 恢复、中断后继续、retry 前后。

必须包含：

- 上次停在哪。
- 为什么停止。
- 最近一次 surface snapshot。
- 最近一次 handoff/checkpoint artifact。
- workspace/git/workflow preflight 结果。
- 推荐的单一下一步。

Resume Surface 应要求 agent 一次只推进一个明确增量，不要在恢复后同时展开多条未验证路径。

### 4.10 Project Memory Surface

项目级记忆只能作为 artifact 显式暴露。

Memory trust boundary：

```text
attempt-local：同 attempt 默认可见。
project-local：必须由 surface 明确暴露。
cross-project：默认禁止。
```

不存在 hidden memory。

### 4.11 Validation Contract Surface

当任务进入 review、merge 或恢复执行前，surface 应列出：

- 已知验证要求。
- 最近验证结果。
- validation artifact。
- 是否需要 smoke-check。
- 当前是否允许继续或必须先验证。

## 5. Surface Contract

稳定 contract 见 [contracts.md](./contracts.md)。

本文件负责解释 surface 设计意图；`contracts.md` 负责可测试 schema、tool visibility matrix、failure surface 和 completed surface 等硬约束。

## 6. Artifact-first 规则

以下内容默认写 artifact，而不是工具 JSON：

- execution plan。
- plan revision rationale。
- PR/MR body。
- implementation summary。
- review summary。
- human question detail。
- handoff note。
- risk analysis。
- validation report。

建议路径：

```text
execution-plan.md
plan-revision.md
pr-body.md
review-summary.md
handoff.md
decisions.md
verification.md
remaining-work.md
validation-report.md
merge-readiness.md
```

工具参数只传：

```text
--artifact execution-plan.md
```

## 7. Surface 与数据库的关系

数据库是机器真相。

Surface 是 agent-facing truth。

不允许 agent 直接依赖数据库 schema。

程序必须负责：

- 从数据库读取机器状态。
- 校验状态一致性。
- 翻译为 agent 可理解的 surface。
- 只暴露当前需要的信息。
- 隐藏不相关字段。
- 把 enum 转为规则语言。

## 8. Surface 与 workflow 的关系

Coordinator Surface 不替代 workflow surface。

Coordinator Surface 可以告诉外层 agent：

- 当前 workflow run 处于什么状态。
- 是否可以 resume。
- 是否 blocked。
- 是否产生 handoff。
- artifact 在哪里。

但不能替 inner workflow 做 stage 判断。

workflow 内部 allowed actions / denied actions 仍以 `workflow protocol status` 为准。

这些 workflow 内部 action 不是 Coordinator Agent 的工具队列。Surface 不应因为 `allowedActions/actionInputs` 出现而新增 workflow action executor，也不应把 `materialize-change <change-id>` 等内部推进动作包装成外层 agent 或开发者必须处理的下一步。

Surface 可以展示 Core 派生的短 `workflow runtime observation`，例如 `observing-runtime` 或 `waiting-operator-gate`，帮助 outer Agent 理解当前 owner；但该摘要不得包含完整 `actionInputs`、required arg、workflow raw status 或 Web/API action endpoint，也不得让 outer Agent 代替 operator 确认 workflow gate。

当 inner coding agent 仍在运行时，Surface 的推荐语义应是观察、inspect 或等待 handoff；当 agent 停止、失败、stalled 或 workflow 产生 handoff 后，Core 才结合 agent final response、transcript/artifacts 摘要、workflow status/events 和 operation ledger 生成下一步。

Provider SDK 的 raw event stream 不直接进入 Coordinator Surface。Surface 只能引用受控 artifact 或展示归一化摘要，例如 agent session 状态、last activity、final response artifact 和必要 error summary，避免把完整 JSONL、provider raw output、权限细节或复杂事件对象暴露给外层 agent。

## 9. 测试要求

第一版应有 surface fixture。

至少覆盖：

- bootstrap surface。
- planning surface。
- execution surface。
- human request waiting surface。
- review surface。
- merge approval surface。
- resume surface。
- memory boundary surface。
- denied merge without approval。
- tool visibility by state。
- autonomy guidance translation。
- artifact-first guidance。
