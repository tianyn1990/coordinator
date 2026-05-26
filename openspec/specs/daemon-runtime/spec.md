## Purpose
定义 `coordinator` 第一版 P0 Daemon Runtime 契约：系统必须提供最小 daemon tick，用于调度、探活、reconciliation、retry 和 human request wake-up，同时保持 daemon 不是 agent，不做业务语义判断，不绕过 Coordinator Surface、agent tools executor、workflow protocol 或 operation/idempotency 约束。
## Requirements
### Requirement: 系统必须提供最小 daemon runtime
系统 SHALL 提供一个长运行 daemon，用于调度、探活、reconciliation、retry 和 human request 唤醒，并且 daemon 不能替代 Coordinator Agent 的业务决策。

#### Scenario: daemon 启动
- **WHEN** operator 启动 daemon
- **THEN** 系统进入周期性 tick
- **AND** daemon 只读取持久化状态并触发受控恢复动作
- **AND** daemon 不直接修改业务语义以外的核心判断

### Requirement: daemon 必须能够发现并推进可继续任务
系统 SHALL 在每个 tick 中发现可恢复状态，并根据当前 surface、operation 和外部状态决定是否唤醒 Coordinator Agent、检查 workflow run 或触发 retry。

#### Scenario: 发现可继续任务
- **WHEN** 存在需要继续推进的任务
- **THEN** daemon 选择一个候选任务
- **AND** 构建最新 Coordinator Surface
- **AND** 触发对应恢复动作

### Requirement: daemon 必须执行 watchdog 和 reconciliation

系统 SHALL 对 active agent session、workflow run、workspace、human request、lock 状态和需要恢复的 workflow action operation 执行 watchdog 与 reconciliation，并在外部状态与数据库不一致时通过 Core recovery decision 采取受控修复或降级，而不是静默推进完成。daemon 不得直接拥有恢复策略；daemon 必须把 observation 交给 Core，并执行 Core 返回的有限 recovery action。

#### Scenario: running workflow 只能 inspect

- **WHEN** workflow run 数据库状态为 running
- **AND** workflow protocol status 返回 lifecycle active 且 handoff unavailable
- **THEN** daemon 只记录 status/recovery observation
- **AND** workflow run 保持 running
- **AND** daemon 不调用 `workflow protocol action`
- **AND** daemon 不根据 allowedActions、actionInputHints、stage 或 gate 推进 workflow action

#### Scenario: agent/internal action 不制造 operator blocker

- **WHEN** workflow run 数据库状态为 running
- **AND** workflow protocol status 返回 lifecycle active 且 handoff unavailable
- **AND** allowedActions 只包含 `materialize-change`、`run-alignment-checks`、repair/current-change、inspect/resume、实现推进类或 unknown action
- **THEN** daemon 不创建 human request、operator attention 或 needs-me event
- **AND** daemon 只记录 sanitized workflow status observation
- **AND** daemon 不调用 operator workflow action helper

### Requirement: daemon 必须支持 human request 唤醒
系统 SHALL 在 human request 被回答后唤醒对应 task，并生成新的 Coordinator Surface 继续推进。

#### Scenario: human answer 到达
- **WHEN** human request 进入 answered 状态
- **THEN** daemon 读取对应 task
- **AND** 唤醒 Coordinator Agent
- **AND** 让后续决策基于最新 surface

### Requirement: daemon 必须遵守 retry budget
系统 SHALL 对可重试失败使用受限 retry budget，并在预算耗尽时转为 operator attention、failed 或人工介入，而不是无限重试。retry/handoff/human 的选择必须由 Core recovery decision 产出，daemon 不得自行判断业务 handoff。

#### Scenario: retry 耗尽
- **WHEN** 同类失败超过 retry budget
- **THEN** daemon 不再自动重试
- **AND** Core recovery decision 记录恢复受限原因
- **AND** 系统触发 operator attention、failed 或 human request 等受控结果

#### Scenario: 同一 stateVersion 无进展不重复启动
- **WHEN** 同一 task stateVersion 已有同 wake reason 的 terminal agent session operation 且没有新观察事实
- **THEN** daemon 不再次启动 provider session
- **AND** 系统记录 no-progress 或 retry blocked 事件

### Requirement: daemon 事件必须可观测

系统 SHALL 记录 daemon tick、task claim、reconcile、retry、wake-up、failure 和 recovery decision 事件，以便 UI 和审计追踪。recovery decision event payload 必须保持窄摘要，不得作为 Coordinator Agent 主输入。

#### Scenario: 非 artifact tool 写入额外 artifact

- **WHEN** outer agent 请求的 coordinator tool 不需要 artifact
- **AND** final response 仍包含 coordinator-artifact block
- **THEN** daemon 可以在路径校验通过后受控写入 artifact
- **AND** daemon 记录 debug event 标记 extra artifact
- **AND** event payload 只包含 tickId、toolName、artifactCount、artifactRefs 等窄字段
- **AND** event 不包含 artifact 正文或复杂内部对象

### Requirement: daemon 必须尊重 operator pause 和 cancel

系统 SHALL 在调度、human wake-up 和 retry 时跳过 `paused` 和 `canceled` task；daemon 不得在 operator 暂停或取消后继续启动 Coordinator Agent。

#### Scenario: paused task 不被推进

- **WHEN** task 状态为 `paused`
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** 不执行 agent tools

#### Scenario: canceled task 不被推进

- **WHEN** task 状态为 `canceled`
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** 不执行 workflow 或 PR/MR 副作用

#### Scenario: answered human request 不唤醒 paused task

- **WHEN** human request 已 answered 且 task 状态为 `paused`
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** human request 保持可见，等待 operator resume 后再处理

### Requirement: daemon 必须基于 operator retry dueAt 推进恢复

系统 SHALL 识别 operator retry event 中的 dueAt，并且只有 dueAt 到期后才允许推进 `resuming` task。

#### Scenario: operator retry 未到期

- **WHEN** task 状态为 `resuming` 且最近的 retry event dueAt 晚于当前时间
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** 记录 retry not due 的可观测 action

#### Scenario: operator retry 已到期

- **WHEN** task 状态为 `resuming` 且最近的 retry event dueAt 已到期
- **THEN** daemon 可以基于最新 Coordinator Surface 启动 Coordinator Agent
- **AND** daemon 仍必须遵守 retry budget 和 active session 唯一性

### Requirement: daemon 必须执行 workspace/lock read-only observation
系统 SHALL 在 tick 中对 active workspace 与 expired lock 执行只读 observation，并将 observation 交给 Core recovery service。

#### Scenario: active workspace inspected by daemon
- **WHEN** 存在 active workspace
- **THEN** daemon 执行只读 workspace inspect
- **AND** daemon 不直接修改 workspace 语义

#### Scenario: expired lock inspected by daemon
- **WHEN** 存在 expired lock
- **THEN** daemon 检查 owner/resource 是否仍 active
- **AND** daemon 不在没有 Core decision 的情况下释放 lock

### Requirement: daemon 只能按 Core decision 释放 expired lock
系统 SHALL 仅在 Core decision 明确允许且 lock leaseVersion 仍匹配时释放 expired lock。

#### Scenario: leaseVersion changed before release
- **WHEN** Core 曾允许释放 expired lock
- **AND** release 前 lock leaseVersion 已变化
- **THEN** daemon 不释放 lock
- **AND** 记录 recovery event 或跳过动作

### Requirement: daemon watchdog 只能把 agent lifecycle signal 用作 observation

系统 SHALL 允许 daemon/watchdog 使用 agent session status、last activity time、latest normalized event 和 failure kind 做 stalled/no-progress observation，并将 observation 交给 Core recovery service。daemon MUST NOT 让 raw 或 normalized provider event 直接驱动业务完成、workflow handoff、PR/MR readiness、merge 或 workflow action。

#### Scenario: active agent session 有最近活动

- **WHEN** daemon inspect active agent session
- **AND** agent lifecycle signal 显示 last activity 尚未超过 stalled threshold
- **THEN** daemon 记录观察或 no-op
- **AND** daemon 不启动重复 Coordinator Agent session

#### Scenario: agent session 无进展

- **WHEN** daemon inspect active agent session
- **AND** lifecycle signal 显示超过 stalled threshold 或 provider failure kind 可见
- **THEN** daemon 将窄 observation 交给 Core recovery service
- **AND** recovery decision event 不包含 raw provider output、完整 transcript 或 permission internals

#### Scenario: provider event 不触发业务推进

- **WHEN** normalized agent event 表示文件变更、命令完成、模型输出或工具调用完成
- **THEN** daemon 不因此标记 task done、PR ready、merge ready 或 workflow handoff
- **AND** 后续推进仍依赖 Coordinator Agent final response、Core tool executor、workflow protocol handoff 或 human gate

### Requirement: daemon 必须把 workflow runtime observation 作为只读观察

系统 SHALL 允许 daemon 在 running workflow inspect/reconcile 后记录 sanitized workflow runtime observation，但 daemon MUST NOT 因 observation、allowedActions 或 actionInputHints 自动执行 workflow action、创建 human request、创建 needs-me event 或标记 operator attention，除非 Core recovery decision 基于真实失败/不一致明确要求 operator attention。

#### Scenario: internal workflow action only records observation

- **WHEN** daemon inspect running workflow run
- **AND** latest status 为 active、handoff unavailable
- **AND** workflow runtime observation 为 observing runtime
- **THEN** daemon 只记录 status/recovery observation
- **AND** daemon 不调用 operator workflow action helper
- **AND** daemon 不创建 human request 或 operator attention

#### Scenario: operator gate remains human confirmed

- **WHEN** daemon inspect running workflow run
- **AND** workflow runtime observation 为 waiting operator gate
- **THEN** daemon 不自动确认该 gate
- **AND** 后续确认只能来自 Web/API/CLI operator-only action 并通过 Core helper 校验

#### Scenario: recovery attention requires real failure or inconsistency

- **WHEN** workflow protocol inspect 失败、profile mismatch、provider failure 或 retry budget 耗尽
- **THEN** daemon 将窄 observation 交给 Core recovery decision
- **AND** recovery decision event 不包含完整 workflow status JSON、actionInputs raw payload、provider raw event 或 lock token

### Requirement: daemon 必须调度 inner coding agent 生命周期

系统 SHALL 允许 daemon 在 active workflow run 需要 coding agent 可见输出时启动 inner coding agent session。daemon MUST 只启动或观察 provider session，不得因为 `allowedActions`、`actionInputs` 或 gate evidence 自动调用 workflow action。

#### Scenario: 缺少 evidence 时启动 inner session

- **WHEN** workflow run 状态为 running
- **AND** 对应 attempt 存在 ready workspace
- **AND** task/project 存在可用 inner agent provider 配置
- **AND** 当前没有 active inner agent session
- **AND** 当前 workflow gate evidence 不是 ready
- **THEN** daemon 启动一个 inner coding agent session
- **AND** daemon action 摘要记录 inner agent session id

#### Scenario: active inner session 运行中只观察

- **WHEN** workflow run 状态为 running
- **AND** 同一 task 已有 starting 或 running inner agent session
- **THEN** daemon 不启动第二个 inner session
- **AND** daemon 不调用 workflow protocol action

#### Scenario: evidence ready 时等待 operator

- **WHEN** workflow run 存在 operator-facing gate
- **AND** gate evidence 为 ready 且 canSubmit 为 true
- **THEN** daemon 不自动确认该 gate
- **AND** gate 仍只能由 Web/API/CLI operator-only action 提交

### Requirement: inner session 完成后 daemon 必须通过 workflow protocol inspect 对齐状态

系统 SHALL 在 inner session 完成或停止后，通过既有 workflow protocol `status` 做 read-only inspect/reconcile，以刷新 workflow projection 和 handoff。daemon MUST NOT 从 inner final response 自然语言直接推导 task completed、PR readiness、merge readiness 或 workflow handoff。

#### Scenario: inner session 完成后 inspect workflow

- **WHEN** daemon 在 tick 中运行并完成 inner coding agent session
- **THEN** daemon 随后调用 workflow protocol status inspect
- **AND** workflow run coarse status 仍只由 protocol lifecycle/handoff 更新
- **AND** final response 只作为 gate evidence 或 operator observability 使用

#### Scenario: inner session 没有可用 provider 时不回落成 action queue

- **WHEN** workflow run 状态为 running
- **AND** project 没有 inner agent provider 配置
- **THEN** daemon 不把 `allowedActions` 全部转成 human request
- **AND** daemon 记录 provider/config 缺失的受控 observation 或 recovery attention
- **AND** daemon 不调用 workflow protocol action

### Requirement: daemon 必须防止重复 inner session

系统 SHALL 使用 active session 检查和稳定 operation idempotency key 防止同一 workflow state/action boundary 被重复启动。operation key MUST 至少区分 task、attempt、workflow run、provider、workflow state version 与最近 workflow action boundary。

#### Scenario: 同一 boundary 已处理不重复启动

- **WHEN** 同一 workflow run state version 和最近 workflow action boundary 已有 terminal inner session operation
- **THEN** 后续 daemon tick 不再次启动 inner provider
- **AND** 系统记录 skipped/no-op 摘要

#### Scenario: 新 workflow action boundary 可重新生成 evidence

- **WHEN** 最近一次 `workflow.action` 之后出现新的 operator gate
- **THEN** daemon 可以基于新的 boundary 启动新的 inner session
- **AND** 旧 final response 不会被当作新 gate 的 ready evidence

