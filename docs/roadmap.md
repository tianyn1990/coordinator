# Roadmap

> 状态：初始方案基线  
> 适用范围：`coordinator` 第一版实现顺序、完成标准、后续扩展边界。

## 1. 文档定位

本文档回答：

- 第一版如何实现。
- 哪些能力必须第一版完成。
- 哪些能力只预留接口。
- 如何避免因为追求快而破坏长期扩展边界。

## 2. 第一版目标

第一版目标不是做一个极简 demo。

第一版目标是做出长期骨架，但先跑通一条真实闭环：

- Node + TypeScript。
- Web + CLI。
- SQLite。
- operation/idempotency/CAS/必要 lock 可靠性底座。
- Project Registry。
- Coordinator Surface。
- Coordinator Agent tools。
- daemon。
- LocalWorker。
- git worktree workspace。
- 一个真实 AgentProvider 路径。
- 另一个 AgentProvider contract stub / fake adapter。
- workflow protocol adapter。
- 一个真实 PR/MR provider 路径。
- 另一个 PR/MR provider contract stub / fake adapter。
- human request。
- merge approval。
- 最小 observability。

### 2.1 P0 / P1 / P2

#### P0 first E2E

P0 目标是跑通：

```text
register project
create task
plan
create attempt/workspace
start workflow
workflow handoff pr_ready
create PR/MR
human review
approve merge
merge
done
```

P0 只要求一个真实 AgentProvider、一个真实 PR/MR provider，另一个 provider / platform 以 contract stub 或 fake adapter 存在并通过 contract tests。

#### P1 V1 complete

P1 补齐：

- GitHub 和 GitLab 两个平台都可用。
- CodexProvider 和 ClaudeCodeProvider 都可用。
- 更完整的 daemon/reconciliation/retry。
- 更完整的 UI 和 observability。
- 更完整的 lock / lease / fencing。

#### P2 planned

P2 只预留接口和规划，不进入 V1 完成标准：

- Meego adapter。
- remote worker。
- 定时任务。
- multi-agent DAG / decomposition engine。
- plugin marketplace。

## 3. 第一版非目标

第一版不做：

- Meego adapter。
- remote worker 完整执行。
- 定时任务。
- 多租户权限。
- 复杂 DAG engine。
- plugin marketplace。

但必须保留：

- `TaskSource` port。
- `WorkerRuntime` port。
- provider registry。
- source registry。
- PR/MR provider abstraction。

说明：

- GitHub/GitLab、Codex/Claude Code 都是第一版长期目标，但可按 milestone 分阶段验收。第一条 E2E 可先完成一个真实 provider/平台，另一个以 contract stub 起步，随后补齐。
- P2 能力必须写清规划和验收标准，可以在第一版后段继续完成，但不得阻塞 P0 可靠性底座。

## 4. 迭代推进固定动作

后续每一轮实现都必须按固定动作推进。固定动作的目标不是增加流程负担，而是让长期设计心智持续进入实现过程，避免代码在不知不觉中偏离已确认边界。

### 4.1 每轮开始

1. 根据本文档的开发进度记录，确认当前要执行的下一阶段或下一项迭代任务。
2. 根据本轮任务影响范围，先读取根目录 `AGENTS.md`、`docs/AGENTS.md`，再读取相关专题设计文档。
3. 明确本轮任务是否涉及边界、协议、状态机、数据模型、agent 可见性、工具参数、外部副作用或持久化语义。
4. 如果本轮可能改变既有设计文档、设计边界或核心方案，必须先向用户说明冲突点和取舍，获得确认后再继续。
5. 创建对应 OpenSpec change，写清 proposal、spec、design 和 tasks。

### 4.2 每轮实现中

1. 按 OpenSpec tasks 实现本阶段开发任务。
2. 写必要注释，优先解释关键设计原因，而不是逐行解释代码。
3. 为本轮能力补充合适单测、fixture 或 contract test。
4. 在遇到以下决策点时，必须重新阅读相关 `docs/` 文档，并确认实现仍符合总体设计心智：
   - 新增或修改核心对象、状态、状态迁移。
   - 新增或修改 agent surface、agent tools、operator tools。
   - 新增或修改 workflow protocol、provider、workspace、daemon、operation、lock、event、artifact。
   - 引入新依赖或新模块边界。
   - 处理 review 意见时可能扩大范围。
5. 如果出现不确定是否偏离设计的地方，先暂停并与用户确认，再修改设计文档或代码。

### 4.3 每轮验证与 review

1. 运行本轮对应测试、类型检查、构建或 OpenSpec validate。
2. 修复发现的问题并再次验证。
3. 交给独立 `gpt-5.5 high` subagent review。
4. subagent review 请求必须显式要求检查：
   - 是否符合 `docs/` 下总体设计心智和边界约束。
   - 是否在实现过程中持续对齐必要设计文档，而不是只在开始时读过。
   - 是否过度设计。
   - 是否偏离已有协议。
   - 是否污染分层边界。
   - 是否让 agent surface/tools 暴露过多内部字段或复杂 JSON。
5. 主 agent 评估 review 结论。确认合理的问题必须修复，修复后回到 review 步骤，直到没有必须修复的问题。

### 4.4 每轮收尾

1. 归档当前 OpenSpec change。
2. 更新本文档的开发进度和重点事项记录。
3. 更新相关架构、设计或契约文档中必要的已落地事实；凡涉及改变设计边界或核心方案，仍必须先获得用户确认。
4. 提交本轮相关代码和文档改动。提交前必须检查 `git status`，避免裹入无关历史改动。
5. 进入下一轮前，确认本轮没有未归档 change、未记录事项或未提交的相关改动。

## 5. 开发进度与重点事项记录

本节用于持续记录每轮开发进度、当前重点、遗留风险和下一步。每轮结束时必须更新。

### 当前进度

- 当前阶段：`Iteration 13: Web Developer Workbench` 已完成 `Slice 13.2: Task Cockpit 与 Workflow Lens`。
- 当前 OpenSpec change：`add-task-cockpit-workflow-lens` 已完成实现、验证、独立 review 和归档；归档后位置为 `openspec/changes/archive/2026-05-21-add-task-cockpit-workflow-lens`。
- 当前正式规格：已同步到 `openspec/specs/web-human-review-surface/spec.md` 和 `openspec/specs/observability/spec.md`；其他既有规格继续保持当前基线。
- 当前已落地事实：Web 默认视图已从单任务 debug console 调整为多工程、多任务 Developer Workbench；任务卡片默认通过 `Open` 进入 Task Cockpit，也可通过 `Debug` 进入 Classic Debug；Task Cockpit 已展示 Outer Flow、Workflow Lens、Evidence / Actions 和默认折叠 Debug Drawer；Workflow Lens 从现有 task detail/events/workflowRuns 做只读投影，缺少 stage/substate/progress/stageArtifacts 时使用 unknown/none/fallback，不读取 `.workflow` private state，不扩大 Coordinator Agent Surface。
- 当前验证结果：`pnpm --filter @coordinator/web build`、`pnpm typecheck`、`pnpm test -- apps/api/src/server.test.ts`、`openspec validate add-task-cockpit-workflow-lens --strict`、`openspec validate --all --strict` 均已通过；本地 API/Web 基于 `.coordinator-smoke/actioninputs-0.6.9/coordinator.sqlite` 做了 PC 端浏览器验证，确认 Task Cockpit 能展示真实 running workflow 的 inspect-only 文案；窄屏只做基本兜底检查，交互与视觉细节留到后续统一设计调整。
- 下一阶段：按用户确认后进入 `Slice 13.3: Task Creation、Project Admin 与 Run Until Blocked`。
- 下一阶段重点：让 Web 支持更好的任务创建和工程管理入口，并保持 run-until-blocked 仍由 Core/daemon/workflow protocol 控制，不让前端直接执行 workflow action 或绕过人类确认边界。

### Iteration 12 后续切片顺序

Iteration 12 后续按以下切片推进。每个切片都必须继续执行第 4 节固定动作：开始前重读根目录 `AGENTS.md`、`docs/AGENTS.md` 与相关专题文档；创建 OpenSpec change；实现和测试；交给独立 `gpt-5.5 high` subagent review；修复并复审到无必须修复项；归档 change；更新进度和已落地事实；提交。

#### Slice 12.2: daemon/Core recovery matrix

建议 OpenSpec change：

```text
harden-daemon-reconciliation-matrix
```

目标：

- 将恢复逻辑表达为有限的 `Observation -> Core RecoveryDecision -> Daemon Action`，明确 recovery decision owner 是 `Coordinator Core`，daemon 只是 runtime driver。
- 补齐 operation replay matrix，重点处理 `running`、`failed`、`unknown` operation 在外部状态 `absent`、`matches intent`、`conflicts with intent`、`unclear` 下的恢复策略。
- 补强 workflow run reconciliation：只通过 workflow protocol；`runId/profile mismatch` 视为 protocol consistency violation；不得读取 `.workflow` private state；不得用 stage/substate/gate 推导外层完成、PR readiness 或 blocked 语义。
- 补强 outer agent session stalled/no-progress 恢复：先 inspect，再按 retry budget 和 dueAt 决定是否唤醒；避免同一 `task.stateVersion` 无进展重复启动 provider。
- 统一 paused / canceled / retry_due gate：paused/canceled 阻止新副作用，但允许 read-only inspect 和事件记录；answered human request 对 paused task 不应被 daemon 消费。
- 记录 recovery decision event，payload 保持窄字段和 artifact refs，不把 provider raw output、lock token、operation 大对象暴露给 agent-facing surface。

边界：

- 不新增 agent tools。
- 不引入通用 reconciliation DSL。
- 不实现 PR/MR merge 全矩阵。
- 不实现 remote worker offline/fleet 状态机。
- 不吸收 Multica skills / 能力包；coding 能力继续由 `workflow` 工程承接。

验收建议：

- failure injection / contract tests 覆盖 operation unknown replay、workflow unavailable、workflow runId/profile mismatch、agent stalled、paused/canceled guard、retry budget exhausted、same stateVersion no-progress 防重复唤醒。
- 测试断言 Coordinator Surface 不新增内部 recovery tool，不暴露 lock token、provider raw response、operation replay 细节或复杂 JSON。

#### Slice 12.3: workspace/lock/fencing reconciliation

目标：

- 补齐 workspace、branch、artifact root、ownership manifest、lock/lease/fencing 的恢复矩阵。
- 过期 lock 不静默接管；必须先 inspect owner/resource 状态，再由 Core 通过 CAS/lease/fencing 校验决定释放、续租、block 或 operator review。
- workspace 缺失、branch mismatch、dirty 来源不明、symlink/realpath 风险继续 fail-fast 或进入 operator review。

边界：

- 不让 daemon 直接修改 workspace 语义。
- 不读取 `workflow` private state。
- 不把 lock/lease 内部字段暴露给 Coordinator Agent。

验收建议：

- tests 覆盖 expired lock reconcile-before-release、workspace path missing、branch mismatch、dirty unknown、manifest mismatch、stale lock token rejected。

#### Slice 12.4: PR/MR and merge reconciliation

目标：

- 补齐 PR/MR inspect/create/update/merge 的 provider-specific reconciliation。
- 让 provider adapter 只返回外部事实，Core 决定 approval 是否失效、是否允许 merge、是否进入 human/operator review。
- 补齐 approval snapshot invalidation、PR already exists reconcile、closed/unmerged、merged reconcile、merge race、merge conflict 的恢复策略。

边界：

- merge 仍必须有显式 human approval。
- daemon 不判断 review 是否通过，不自行决定业务完成。
- provider raw output 不直接进入 agent-facing surface。

验收建议：

- tests 覆盖 PR already exists matches intent、external conflicts intent、approval invalidated、merge race、merge conflict、provider timeout/rate-limit/auth_missing 分类。

#### Slice 12.5: second real provider/platform

状态：已完成，归档 change 为 `openspec/changes/archive/2026-05-05-add-gitlab-pr-mr-provider-contract`。

目标：

- 在 recovery 底座稳定后，补齐 P1 的第二套真实 provider / platform。
- GitHub/GitLab 和 Codex/Claude Code 的缺口按当前实现状态选择顺序推进。
- 保持 provider/platform 通过 interface/capability matrix 接入，不让品牌语义进入 Core 状态机或 Coordinator Agent 工具参数。

边界：

- 不为了接入第二 provider/platform 放宽 operation/idempotency、inspect-before-create、merge approval 或 artifact-first 契约。
- 不将 source-specific 或 provider-specific 状态机污染 Core。

验收建议：

- 新 provider/platform 至少有 contract tests、fake/failure tests 和真实路径最小 smoke 验证。

#### Slice 12.6: observability and operator diagnosis polish

状态：已完成，待归档 change 为 `harden-observability-operator-diagnosis`。

目标：

- 补齐 operator 视角的 recovery 诊断能力：operation ledger 摘要、recovery decision timeline、current blocker、retry budget、provider/protocol inspect 摘要。
- Web/operator UI 可以展示比 agent surface 更多的机器事实，但这些事实不得自动进入 Coordinator Agent Markdown surface。

边界：

- agent-facing Markdown 只保留摘要、blocker、recommended next step、allowed/denied tools 和必要 artifact refs。
- 大块诊断信息继续通过 artifact 或 operator-only API 展示。

验收建议：

- UI/API tests 或 contract tests 覆盖 recovery event 展示和 agent surface 不泄漏内部字段。

#### Slice 12.7: workflow running 观察边界与 smoke 可观测性优化

状态：已完成，归档 change 为 `openspec/changes/archive/2026-05-20-harden-workflow-observability-boundaries`。

建议 OpenSpec change：

```text
harden-workflow-observability-boundaries
```

目标：

- 明确 daemon 对 running workflow run 的职责是通过 `workflow protocol status` inspect/reconcile、记录 handoff/recovery 观察结果，而不是根据 `allowedActions`、`actionInputHints`、stage 或 gate 主动执行 workflow action。
- 优化 Outer Coordinator Agent prompt：只有当前工具需要 artifact，或计划/报告确实需要修订时，才输出 `coordinator-artifact`。`create_attempt`、`create_workspace`、`start_workflow_run`、`inspect_workflow_run` 等普通推进/观察步骤不应顺手改写 `execution-plan.md`。
- 增强 running workflow surface 文案：当 workflow 仍 active 且未 handoff 时，agent-facing surface 应表达“inspect 或等待 handoff”，避免把 workflow debug action 理解为 Coordinator 可执行下一步。
- 增加额外 artifact 写入的可观察信号：当 agent 在不需要 artifact 的工具请求中仍输出 artifact，daemon 可以保留受控写入，但必须记录窄摘要 debug event，帮助 operator 判断这是必要产物还是额外噪音。
- 补充 operator 执行链路摘要：先实现轻量 CLI/API/operator summary 或等价 Core 派生能力，把 task、attempt、workspace、outer agent session、coordinator tools、workflow run、handoff/recovery、关键 artifact 分组展示，降低真实 smoke 和问题排查理解成本。
- 记录 workflow action executor 的边界决策：暂不新增 agent-facing workflow action tool，不让 daemon 自动执行 workflow action；如未来需要，应优先作为 operator/debug 能力单独设计，并明确 action 参数、审计、审批和 handoff 影响。

边界：

- 不新增 agent-facing workflow action executor。
- 不让 daemon 根据 workflow `allowedActions` 或 `actionInputHints` 自动推进 action。
- 不读取或写入 `.workflow` private state。
- 不把 workflow debug 字段、完整 workflow status、operation 大对象或复杂 JSON 暴露给 Coordinator Agent Surface。
- 不把 operator summary 变成新的真相源；summary 只能从已持久化状态、event、operation 和 artifact refs 派生。
- 不做完整 Web UI 重构；本切片先完成可验证的 Core/CLI/API 级摘要或等价最小展示。

验收建议：

- tests 覆盖 daemon running workflow 只 inspect、不执行 workflow action。
- tests 覆盖 running workflow surface 不暴露 `start_workflow_run`、workflow action executor 或 debug action tool，并明确推荐 inspect/等待 handoff。
- tests 覆盖 prompt artifact 规则，提示 agent 非 artifact 工具不要输出 `coordinator-artifact`。
- tests 覆盖额外 artifact 写入会记录 debug event，payload 仅包含 toolName、artifactCount、artifactRefs、tickId 等窄字段。
- tests 或 CLI/API smoke 覆盖 operator summary 分组输出；断言 summary 不进入 agent-facing surface。

#### Slice 12.8: workflow profile 选择委托给 workflow runtime

建议 OpenSpec change：

```text
delegate-workflow-profile-selection-to-runtime
```

目标：

- 将 workflow profile 的最终选择权收回到 `workflow` runtime：外层 Coordinator Agent 不再主动选择 profile，也不根据 workflow capability catalogue 猜测 profile。
- 允许人类在外部入口显式选择 workflow，或在任务提示词中表达倾向；Coordinator 只保存这份人类输入，并在启动 workflow 时把它作为上下文交给 `workflow` 自主判断。
- 将 `default` / `auto` 语义收敛为“委托 workflow 自动选择”，而不是 Coordinator 静态注册的 profile。
- 启动 workflow 时记录 `requested selection` 与 `actual profile`，让 operator 与审计可以区分“人类显式指定”与“workflow 自主选择”。
- 取消 outer agent 侧对 workflow profile 的决策压力，避免 Coordinator 随 workflow profile 升级频繁同步注册表，也避免 agent 基于不完整 catalogue 误选 profile。

边界：

- 不让外层 Coordinator Agent 通过 surface/tool 直接选择 workflow profile。
- 不把 workflow capability catalogue 当成外层 agent 的 profile 决策源。
- 不要求 Coordinator 静态维护全部 workflow profile 注册表。
- 不新增 agent-facing workflow action tool。
- 不让 daemon 根据 running workflow 的 debug 字段自动执行 workflow action。
- 不改变 workflow protocol 的 inspect-only 边界；running workflow 仍以 inspect / wait handoff 为默认动作。

验收建议：

- tests 覆盖外层 Agent 请求启动 workflow 时不携带 profile，或携带 `default/auto` 时由 workflow 自主选择。
- tests 覆盖 human explicit selection 被透传给 workflow runtime，并能在结果中看到 `actual profile`。
- tests 覆盖 outer agent surface 不再暴露 profile 选择参数。
- tests 覆盖 daemon 仍只 inspect running workflow，不执行 workflow action。

### Iteration 13: Web Developer Workbench

Iteration 13 的目标是把 Web 从“单任务 operator debug 页面”升级为“开发者多工程、多任务协调工作台”。这个阶段的产品目标不是给 `workflow` 做一个漂亮状态页，而是让一个开发者能同时管理多个工程、多个任务，并把常规流程确认、异常筛选和 PR/MR 操作集中在 Web 中完成。

本阶段必须继续遵守第 4 节固定动作：每个实现迭代开始前重读根目录 `AGENTS.md`、`docs/AGENTS.md`、`docs/web-developer-workbench.md` 与相关专题文档；创建 OpenSpec change；实现和测试；交给独立 `gpt-5.5 high` subagent review；修复并复审到无必须修复项；归档 change；更新进度和已落地事实；提交。按用户确认，本阶段每完成一个部分后暂停，由用户确认后再进入下一部分。

#### Slice 13.0: workflow stage/substate handoff

状态：已完成文档草案，等待用户确认后进入 roadmap 与实现迭代。

产物：

```text
docs/workflow-stage-substate-handoff.md
```

目标：

- 给 `/Users/hetao/Documents/github/workflow` 工程一份独立交接文档，说明为了 Web Workbench / Task Cockpit 展示 workflow 进度，workflow protocol 需要稳定输出 `stage`、`substate`、`gate`、`progress`、`stageArtifacts`、`allowedActions`、`deniedActions` 和 `actionInputs`。
- 明确这些字段只用于 coordinator Web operator/debug 展示，不驱动 coordinator 外层状态机、PR readiness、done、merge，也不让 daemon 自动执行 workflow action。
- 给 workflow 工程建议 OpenSpec change id、schema 示例、兼容性要求和 contract tests。

边界：

- 不修改 `/Users/hetao/Documents/github/workflow` 工程代码。
- 不扩大 Coordinator Agent Surface。
- 不新增 agent-facing workflow action tool。
- 不改变 `docs/workflow-protocol.md` 已确认的 handoff 边界；真正外层推进仍依赖 `lifecycle + handoff + artifacts + recovery + summary`。

验收建议：

- `docs/AGENTS.md` 索引包含该 handoff 文档。
- 文档能直接交给 workflow 工程 Agent 创建并执行对应 OpenSpec change。
- 文档明确兼容字段缺失：缺失时 Web 显示 unknown/none 或退回 summary/artifacts，而不是失败。

#### Slice 13.1: Developer Workbench 信息架构与多任务入口

建议 OpenSpec change：

```text
improve-web-developer-workbench
```

目标：

- 新增 Web Workbench 入口，作为开发者日常使用的主页面；老的密集 task detail 页面保留为 Classic Debug / Raw Detail。
- 具体信息架构、页面布局、Action Inbox、task card、视觉方向和数据边界以 `docs/web-developer-workbench.md` 为准；本切片开始前必须重点阅读其中第 1-7、11-13 节。
- Workbench 支持按 project、task status、operator attention、human request、PR/MR/review/merge 状态理解当前所有任务。
- 页面默认回答“我现在同时管理哪些工程和任务、哪些在跑、哪些卡住、哪些需要我处理、下一步最安全的动作是什么”。
- 新增 Action Inbox，集中展示待处理 human request、merge approval、PR/MR operator action、project config blocker 和高风险 recovery attention。
- 新增任务卡片视图，卡片展示 project、title、task status、current blocker、outer flow 粗进度、workflow profile/stage/substate 简短摘要、PR/MR 状态、关键 artifact refs。
- 保留全局 refresh / daemon tick 入口，但不把 raw timeline、surface JSON、operation ledger 默认铺满主页面。

上层语义：

- Web Workbench 是开发者的任务调度与确认中心。
- CLI 继续作为补充工具，适合 smoke、排查和自动化脚本；真实用户主路径应尽量在 Web 完成。
- Workbench 展示“多个任务的局面”，Task Cockpit 展示“单个任务的细节”。

推荐页面结构：

```text
Global Command Bar
Project Rail
Workbench Board
Action Inbox
System Debug Drawer
```

可能需要的实现：

- 前端路由或轻量 view state：`Workbench`、`Task Cockpit`、`Project Admin`、`Classic Debug`。
- 基于现有 `GET /projects`、`GET /tasks`、`GET /tasks/:taskId` 先完成第一版多任务聚合；如性能或信息不足，再补只读 operator summary API。
- 新增 Web 侧派生模型，把 task detail 转成 board/card/inbox 所需的展示结构。
- 引入轻量 UI 依赖时优先考虑 `lucide-react`；流程图可在 13.2 再引入 `@xyflow/react`，避免 13.1 范围过大。

边界：

- 不改变 Core 状态机。
- 不新增 daemon 自动动作。
- 不新增 agent-facing tools。
- 不把 diagnosis/operator summary 变成新的真相源；它只能从已持久化 task、project、attempt、workspace、workflow run、PR/MR、human request、event、operation 和 artifact refs 派生。
- 不在前端重建业务状态机；前端只能做展示派生和 action routing。

验收建议：

- Web 能展示所有 project 和近期 tasks，并能按 project/status/needs-me 快速定位任务。
- Pending human request 与 merge approval 能在 Action Inbox 中出现。
- 点击任务卡片能进入单任务 Cockpit 或 Classic Debug。
- Classic Debug 老页面仍可访问，便于排查。
- 测试或浏览器验证覆盖：空状态、多 project、多状态任务、pending human request、merge approval、operator attention。
- `pnpm --filter @coordinator/web build`、相关 API/Core tests、`pnpm typecheck` 通过。

#### Slice 13.2: Task Cockpit 与 Workflow Lens

建议 OpenSpec change：

```text
add-task-cockpit-workflow-lens
```

目标：

- 新增单任务 Task Cockpit 页面，承接 Workbench 中点击任务后的主要详情体验。
- 具体 Task Cockpit、Workflow Lens、Outer Flow Map、Debug Drawer、视觉方向和 workflow 展示边界以 `docs/web-developer-workbench.md` 为准；本切片开始前必须重点阅读其中第 1-5、8、11-13 节。
- 展示外层流程：`Task -> Plan -> Attempt -> Workspace -> Workflow -> PR/MR -> Review -> Merge -> Done`。
- 将 Workflow 作为 Task Cockpit 的核心观察区域，展示 `profile`、`lifecycle`、`stage`、`substate`、`gate`、`handoff`、`allowedActions`、`deniedActions`、`actionInputs`、`stageArtifacts` 和 latest workflow events。
- 接入 workflow operator-only status/artifacts/events API，用于展示 workflow 内部进度和 evidence。
- 将 raw surface、raw timeline、operation ledger、provider/protocol inspect、完整 event payload 等调试信息放入折叠 Debug Drawer。
- 页面视觉方向采用 `industrial mission control`：深色石墨底、冷青 running、琥珀 waiting、人类确认强调、红色 blocked/failed、绿色 done；Workflow 节点视觉权重大于其他节点。

上层语义：

- Task Cockpit 用来理解单个任务“现在走到了哪里”和“为什么需要我介入”。
- Workflow Lens 用来观察 workflow 内部执行位置，但不让 coordinator 接管 workflow 内部控制面。
- Debug Drawer 服务工程排查，不是普通用户的默认阅读路径。

推荐页面结构：

```text
Task Header
Outer Flow Map
Workflow Lens
Evidence / Actions Panel
Debug Drawer
```

可能需要的实现：

- `TaskCockpitView`、`OuterFlowMap`、`WorkflowLens`、`EvidencePanel`、`DebugDrawer` 等前端组件。
- 可引入 `@xyflow/react` 做交互式流程图；如果引入，应只用于 Web 展示，不把通用 DAG 引入 Core。
- Web 侧为 workflow status 增加查询和缓存；如果 workflow status 缺失 `progress/stageArtifacts`，使用现有 `summary/handoff/artifacts/events` graceful fallback。
- 将 `allowedActions/actionInputs` 放在 operator/debug 区域，避免用户误以为 daemon 会自动执行这些 action。

边界：

- `stage/substate/gate` 只做展示，不驱动 coordinator PR readiness、done、merge 或 task status 推断。
- `allowedActions/actionInputs` 只展示，不触发 daemon 自动 action。
- 不新增 agent-facing workflow action tool。
- 不读取 `.workflow` private state；所有 workflow 信息都来自 protocol status/artifacts/events。
- 不让流程图变成 Core 的通用 DAG engine；它只是 UI projection。

验收建议：

- Task Cockpit 能在不同 task 状态下展示外层流程节点状态。
- Workflow running 且无 handoff 时，页面明确显示 coordinator 正在只读观察 workflow，下一步等待 handoff 或 operator/debug action。
- Workflow status 缺少 stage/substate/progress/stageArtifacts 时页面仍可用。
- PR/MR、human request、merge approval 的主要操作仍经 API/Core runtime 执行。
- Browser/Playwright 或等价截图验证桌面和窄屏布局无重叠、文本不溢出、核心节点清晰。
- `pnpm --filter @coordinator/web build`、相关 tests、`pnpm typecheck` 通过。

#### Slice 13.3: Task Creation、Project Admin 与 Run Until Blocked

建议 OpenSpec change：

```text
complete-web-task-project-operations
```

目标：

- 重做任务创建体验，让 Web 成为真实任务下达入口，而不是小表单。
- 具体 New Task、Project Admin、Run Until Blocked、workspace hook 预留、附件上传边界以 `docs/web-developer-workbench.md` 为准；本切片开始前必须重点阅读其中第 1-3、6-13 节。
- 新增 Project Admin 页面，承接工程注册、provider/workflow/agent 配置、workspace root 与未来 workspace hook 预留。
- 增加全局和单任务 `Run until blocked`，让用户可以从 Web 触发真实流程并尽量走到最远。
- 补齐 Web 侧常用 PR/MR operator actions：create/update/inspect-review/request-approval/approve/reject/merge 的入口按当前 Core/API 能力逐步展示。
- 预留附件/图片上传与任务上下文 artifact 能力，但如当前 artifact/API 模型不足，第一版只做设计和安全占位，不落不完整副作用。

任务创建页面目标：

- 支持选择 project。
- 支持较大文本编辑区，用于描述需求、背景、验收标准和约束。
- 支持 autonomy 选择。
- 支持可选 human explicit workflow selection 或提示词内描述；默认仍委托 workflow runtime 自主选择。
- 预留图片/文件 drop zone；实现前需先确认 artifact upload contract、路径安全、大小限制和存储位置。
- 支持 `Create task` 与 `Create and run until blocked` 两种入口。

Project Admin 目标：

- 支持 Web 注册 project，对齐 `docs/project-registry.md`：repo path、default branch 确认、provider kind、workflow launcher、outer/inner agent defaults、workspace root。
- 展示 project health：git/provider/workflow/agent/pr provider 的已配置/缺失状态。
- 预留 workspace policy：create worktree preflight、init script hook、cleanup script hook、retention policy。
- init/cleanup hook 第一版只做配置设计或只读占位；除非另开明确安全执行 contract，不执行任意脚本。

Run Until Blocked 目标：

- 全局模式：循环触发 daemon tick + refresh，推进安全队列直到没有可安全推进项或出现需要人类介入。
- 单任务模式：聚焦当前 task 循环 tick + refresh，直到该 task 达到 terminal、waiting human、waiting merge approval、workflow running no handoff、operator attention、failed 或其他高风险停止条件。
- 每轮 tick 后展示 actions summary 和停止原因。

边界：

- `Run until blocked` 只调用 daemon tick、refresh 和只读 inspect，不执行 workflow action。
- 不绕过 Core policy gate，不直接写 DB。
- 不让前端自己判断 merge readiness；merge 仍经 Core 重新 inspect 和 approval snapshot 校验。
- 工程 init/cleanup hook 不在本切片直接执行任意脚本；如果要落地执行，必须另开 change 设计 sandbox、审批、审计、失败恢复和 path 安全。
- 文件/图片上传不应绕过 artifact path 规则；若落地，需要明确 size/type/path/cleanup contract。

验收建议：

- Web 能完成 project register、manual task create、create-and-run 起步流程。
- `Run until blocked` 在 workflow running no handoff 时停止，并明确显示 daemon inspect-only 边界。
- `Run until blocked` 在 pending human request 或 merge approval 时停止并展示对应 action card。
- Project Admin 能展示已有 project 配置和注册新 project；workspace hook 字段若只是预留，UI 必须标明尚未执行副作用。
- PR/MR operator actions 在对应 Core gate 满足时可见，不满足时给出不可操作原因。
- Browser/Playwright 或等价验证覆盖创建任务长文本、工程注册表单、run-until-blocked 停止状态、窄屏布局。
- `pnpm --filter @coordinator/web build`、`pnpm --filter @coordinator/api build`、相关 tests、`pnpm typecheck`、`openspec validate --all --strict` 通过。

### 重点关注事项

- 已建立 project registry 核心服务，支持工程注册、GitHub/GitLab 识别、默认分支确认、workflow launcher 和默认 provider 配置。
- 已为 `projects` 补充 registry 相关字段，并通过 `packages/core` 作为业务层统一承载注册逻辑；CLI/API 只调用 service，不直接拼接注册规则。
- 已实现 CLI `register` / `projects` 和 API `/projects` / `/projects/:projectId` / `/projects/register` 的最小入口。
- 已建立 `Coordinator Surface` builder，支持 machine JSON 与 agent-facing Markdown 同源生成，并覆盖 bootstrap / planning / execution / human_waiting / human_answered / review / merge_waiting / completed / failure / resume fixture。
- 已实现 DB task surface 入口：`buildTaskSurfaceFromDb` 读取 task/project、latest attempt、active workspace、active workflow run、recent agent session 等当前已有机器事实，并翻译为 agent-facing Markdown；仍不把 PR/MR provider、human request 完整生命周期或未来 daemon 逻辑塞入 DB loader。
- 已实现 CLI `surface --db <path> --task <task-id> [--format json|markdown]` 和 API `GET /tasks/:taskId/surface`，二者都是 operator 调试入口，不是 agent tool。
- Tool visibility 已按 `contracts.md` 收窄，显式排除 operator-only tools；普通 PR/MR open、merge_waiting、human_waiting、completed/failure 等关键窗口已由 fixture tests 覆盖。
- Merge approval 可见性已改为显式 `mergeApproval` snapshot 校验，只有匹配当前 PR/MR 且 head/base/validation/merge strategy 有效时才暴露 `merge_after_approval`。
- Tool 参数已对齐 `agent-tools.md` 的窄参数契约，复杂内容仍通过 artifact path 引用，不使用复杂 JSON 作为主交互方式。
- SQLite 当前使用 Node 内置 `node:sqlite`，并通过 `engines.node >=22.22.2` 明确运行时约束；测试仍会出现 Node 的 ExperimentalWarning。后续如部署环境或稳定性要求变化，应在独立 change 中评估替换 driver。
- 已实现 Workspace Manager：支持最小 `LocalWorker`、确定性 branch、project default branch 作为 base、git worktree 创建、workspace/attempt/project-branch lock、operation 状态推进、ownership manifest、checkpoint artifact 和 resume preflight。
- Workspace Manager 遵守本轮边界：不实现 daemon、workflow adapter、AgentProvider、PR/MR provider，不读写 `.workflow` private state；CLI/API workspace create/preflight 只是 operator 调试入口，不进入 Coordinator Surface。
- Workspace 创建已经覆盖 operation-first 与 fencing：创建 `workspace:create:<attempt-id>` operation，获取必要 lock 后推进 running；ready 状态、artifact record、`workspace.ready` event、operation succeeded 在同一 transaction 内提交；lock conflict 不污染共享 operation。
- Resume preflight 是只读检查：path containment 逐项 fail-fast，path 失败后不执行 git、不读取 manifest/checkpoint、不创建缺失目录；对 workspace/repo/coordinator/artifact/manifest/checkpoint 做 realpath containment。
- 已补充 Workspace Manager 高风险测试：deterministic branch、缺失 default branch、branch exists、active/ready 复用、creating workspace 收敛、operation terminal 防回退、workspace lock conflict、symlink escape、dirty/branch mismatch、missing workspace path fail-fast。
- 第五轮独立 `gpt-5.5 high` subagent review 已确认无必须修复项。后续可加强但不阻塞本轮：更严格确认 git worktree 属于 project repo；如果未来 `assertArtifactRelativePath` 接收用户输入，应改为原始 path segment 级拒绝 `..`，不要依赖 normalize 后判断。
- 已实现 Workflow Protocol Adapter：支持 capabilities/start/status/action/artifacts/events，所有入口只消费 workflow protocol JSON stdout，不读写 `.workflow` private state，不根据 workflow stage/substate/gate 推进外层业务状态。
- Workflow capabilities 在 project repo 中查询，start/status/action/artifacts/events 在 ready workspace repo 中执行；当前 profile 的最终选择权由 workflow runtime 自主决定，Coordinator 只在 human explicit selection 场景下透传选择意图，`default/auto` 表示交给 workflow 自主选择。
- Workflow start 已按 operation-first 与 fail-safe replay 收敛：先创建 `workflow:start:<attempt-id>:<profile-id>` operation 并获取 `attempt-workflow` lock，再落 `starting` workflow run 记录，之后执行 protocol start；start 成功后 workflow run 更新、`workflow.started` event、operation succeeded 在同一 transaction 内完成；side effect 窗口开始后的失败标记 operation `unknown`，避免自动重跑。
- Workflow action 已纳入副作用契约：operator 必须传 expected workflow run state version，idempotency key 使用 canonical JSON + sha256，action/arg 先规范化再同时用于 protocol 入参和 idempotency key；action 成功后的 workflow run 更新、`workflow.action` event、operation succeeded 同 transaction 提交，并携带 lock token 做 fencing。
- Workflow status 只用 lifecycle/handoff/artifacts/recovery/summary 更新 workflow run 粗粒度状态；stage/substate/gate/allowedActions/deniedActions/actionInputs 只进入 operator/debug payload。`actionInputs` 会被收窄为 action input hints，用于 operator 判断 action 参数，不进入 Coordinator Agent Surface。
- 已实现 CLI/API operator-only workflow 调试入口：capabilities/start/status/action/artifacts/events；这些入口未进入 Coordinator Surface，也不是 agent tools。`workflow action` CLI/API 需要显式 expected state version，避免响应丢失后的重复副作用。
- 本轮 Slice 12.8 已把 workflow profile 选择语义收拢为 runtime auto / human explicit 两类：outer Agent 不再主动选 profile，CLI/API 调试入口对 `profile` 改为 optional，`default/auto` 表示委托 workflow 自主选择；workflow start 结果新增 `selection_source`、`requested_profile_id`、`requested_profile_alias`，operator summary 与 surface 也展示这份分离语义。
- smoke 与回归验证已确认 daemon 仍只 inspect running workflow，不执行 workflow action；真实 smoke 中旧 smoke DB 先需迁移到 `0007_workflow_selection.sql`，迁移后 daemon tick 能正常进入 running workflow inspect-only 分支。当前 `/Users/hetao/Documents/github/workflow` 侧仍以显式 `--workflow` 为主，profile-less start 的完整端到端能力仍受外部 runtime 支持程度限制。
- 本地 smoke hardening 后，root `pnpm cli ...` / `pnpm migrate ...` 入口不再向 CLI 传入裸 `--`；SQLite 连接设置短暂 `busy_timeout`，降低 operator debug 查询写审计 event 时的短暂 writer contention。workflow operator debug 查询仍不是纯读高频 polling API。
- Slice 12.7 已明确 running workflow 的 inspect-only 边界：daemon 只通过 `workflow protocol status` 观察 running workflow，不根据 `allowedActions`、`actionInputHints`、stage 或 gate 自动执行 workflow action；workflow action 入口继续是 operator/debug 能力，不进入 Coordinator Agent Surface。
- Outer Coordinator Agent prompt 已补充 artifact 使用纪律：只有 artifact-based tool 或真实计划/报告修订才输出 `coordinator-artifact`，普通推进/观察工具不应顺手覆盖 `execution-plan.md`。
- Running workflow surface 已增强推荐语义：当前 workflow 未 handoff 时，agent-facing guidance 表达 inspect 或等待 handoff，不暗示 Coordinator 可绕过 workflow protocol 执行内部 action。
- Daemon artifact bridge 已增加 `daemon.agent_extra_artifact_written` debug event；当非 artifact tool 携带 artifact 时仍受控写入，但额外记录窄摘要，且 `update_pr` 仅在带 `body-artifact` 时才视为 artifact 必需。
- 已新增 operator-only execution summary：Core `getOperatorExecutionSummary`、CLI `summary --db <path> --task <task-id>`、API `GET /tasks/:taskId/summary` 按 task/attempt/workspace/agent/tool/workflow/artifact/next step 分组展示，只从持久化事实派生，不触发外部 inspect，不进入 agent-facing surface。
- 已补充 Workflow Protocol Adapter contract tests：capabilities cwd、profile implemented gate、operation-first start、start side effect 后 unknown、stage/substate 不驱动 handoff、action operation/idempotency/replay、arg 规范化、artifact/event 只读引用、`.workflow` private state 不读写、active run 复用与 profile conflict。
- 第六轮经过多轮独立 `gpt-5.5 high` subagent review，所有必须修复项已处理并复验。后续可加强但不阻塞本轮：status/action/artifacts/events 校验返回 runId 与当前 externalId 一致；API 对 CAS/lock conflict 返回更细的 409 与 machine-readable code；capabilities.commands 按命令做 gate；daemon/reconciliation 迭代补齐 `unknown` operation 的 inspect/reconcile 矩阵。
- 已实现 Agent Provider Runtime：提供 `AgentProvider` interface、`CodexProvider`、`ClaudeCodeProvider`、`FakeAgentProvider`，以及 `runCoordinatorAgentSession` / `inspectAgentSession`。
- Outer Coordinator Agent 本轮是 decision-only runtime：provider cwd 固定为 sessionRoot，不指向 project repo 或 workspace repo；Codex 使用 read-only sandbox，Claude Code 使用 bare / dontAsk / 空 tools，避免绕过 Coordinator Surface 和 agent tools executor。
- Agent session 启动已按 operation-first 与 fencing 收敛：创建 `agent:session:<task-id>:outer:<provider-id>:<request-id>` operation，获取 `task-agent` lock，写 `starting/running/completed` session 状态，保存 prompt/surface/transcript/final-response artifact；默认 request id 为 `task-v<task.stateVersion>`，CLI/API 可显式传入。
- Agent session 可靠性约束已覆盖：active outer session 唯一性、provider 参数窄化、复杂上下文通过 prompt/surface artifact、failure 后 operation/session 受控进入 failed/unknown 并登记可观测 artifact；lock TTL 至少覆盖 `timeoutMs + 60_000`，completion/failure 使用 fresh timestamp 做 fencing。
- 已实现 CLI/API operator-only agent 调试入口：`agent run/inspect` 和 `POST /tasks/:taskId/agent-sessions`、`GET /agent-sessions/:agentSessionId`；这些入口未进入 Coordinator Surface，也不是 agent tools。
- 已补充 Agent Provider Runtime contract tests：fake provider、Codex/Claude command shape、operation idempotency requestId、active session uniqueness、surface prompt 主输入、active workspace 下 provider cwd 仍为 sessionRoot、CLI/API operator-only 入口。
- 第七轮经过多轮独立 `gpt-5.5 high` subagent review，所有必须修复项已处理并复验。修复点包括：outer provider 权限边界、provider cwd/sessionRoot、lock TTL/fresh timestamp fencing、DB surface 投影补齐、稳定 requestId idempotency key、OpenSpec 与 docs 对齐。
- 已实现 Coordinator Agent Tools executor：Core 入口 `executeCoordinatorAgentTool` 只允许调用当前 surface 暴露的 P0 工具，覆盖 `write_execution_plan`、`revise_execution_plan`、`create_attempt`、`create_workspace`、`start_workflow_run`、`inspect_workflow_run`、`ask_human`。
- Agent tool result 已收窄为 sanitized output，只返回 `kind/id/status/artifactPath/reused/handoffKind/nextStep` 等 agent 需要的信息；workspace lock token、manifest path、workflow debug、operation internals 等内部细节不进入 agent-facing tool result。
- Agent tool artifact 采用 artifact-first：工具只接受相对当前 surface `artifact_root` 的路径；pre-workspace planning 阶段使用 task-local root，workspace ready 后使用 attempt workspace root；路径校验覆盖绝对路径、`..` segment、realpath containment、文件存在和大小限制。
- Surface 当前只暴露 Iteration 8 executor 已实现的工具。PR/MR、merge、mark_done、handoff_to_human、resume_workflow_run 等未来工具继续保留在设计规划中，但在对应 executor 未落地前不作为当前 `available_tools` 暴露。
- `start_workflow_run` 当前不应让 outer agent 主动选择 profile；profile 仅在 human explicit selection 或 workflow 自主选择的语义下出现。后续若需要把选择意图显式拆分为 `default/auto` 与 `human_explicit`，需要在独立 change 中同步 surface、Core 和 workflow adapter 契约。
- 已补 DB repository 中 execution plan 与 human request 的最小方法，并让 DB surface 投影 execution plan 与 recent human requests；human waiting 无 workflow run 时不暴露可调用工具，有 workflow run 时仅允许 inspect。
- 已实现 CLI/API operator-only agent tool 调试入口：`agent-tool execute` 和 `POST /tasks/:taskId/agent-tools`；这些入口未进入 Coordinator Surface，不是 agent tools。
- 已补充 Coordinator Agent Tools contract tests：surface visibility gate、artifact path 安全、execution plan 写入、human request 等待、sanitized workspace/workflow result、CLI/API operator 调试入口、未来未实现工具不提前暴露。
- 第八轮经过多轮独立 `gpt-5.5 high` subagent review，所有必须修复项已处理并复验。修复点包括：raw result 泄漏、surface/executor tool 集不一致、task-local artifact root 契约、provider 参数契约、human waiting 工具可见性。
- 已实现 P0 最小 Daemon Runtime：`runDaemonTick` 按单次 tick 执行 workflow reconciliation、human request wake-up、candidate task advance、outer agent session 启动、agent tool request 解析与执行、最小 stalled watcher 和 retry_due gate。
- daemon 仍不是 agent：它不做需求理解、方案选择、review 判断、workflow profile 语义选择，不读写 `.workflow` private state，不提前实现 PR/MR provider 或 merge；它只复用现有 Coordinator Surface、Agent Provider Runtime、Coordinator Agent Tools executor、Workflow Protocol Adapter 和 DB repository。
- 已补 outer agent 的受控 artifact bridge：agent 可在 final response 中输出 `coordinator-artifact` block，daemon 先由 Core 写入当前 surface `artifact_root`，再执行 `coordinator-tool` 请求；outer provider 仍在 sessionRoot/read-only 边界内运行，不直接写 repo/workspace。
- daemon agent session idempotency 已收敛为 `daemon-<wakeReason>-v<task.stateVersion>`，同一 task stateVersion 已有 terminal operation 时跳过，避免无进展 tick 重复启动 provider。
- 已实现 CLI/API operator-only daemon tick 调试入口：`daemon tick` 和 `POST /daemon/tick`；这些入口未进入 Coordinator Surface，也不是 agent tools。
- 已补充 Daemon Runtime tests：artifact bridge、surface/tool gate 串联、无 tool 请求不猜测下一步、稳定 idempotency、workflow protocol reconciliation 不猜 completed、human answer wake-up、retry budget、CLI/API operator-only 入口。
- 第九轮独立 `gpt-5.5 high` review 已完成，先后指出 artifact bridge、稳定 requestId、watchdog/retry_due、symlink containment 等问题，均已修复并复验；最终 review 已确认无必须修复项，可以归档。
- 已实现 PR/MR Provider Runtime：新增 `PullRequestProvider` interface、`CliPullRequestProvider`、`FakePullRequestProvider`，支持 create/update/inspect review/request merge approval/operator approve/reject/merge after approval。
- PR/MR provider 仍是 execution adapter：Core 负责 task/attempt/workspace/workflow handoff gate、operation idempotency、approval snapshot、merge policy、event 记录和状态迁移；provider 只执行外部平台动作。
- `createPullRequestRuntime` 强制当前 attempt 必须已有 workflow protocol handoff `pr_ready`；不会从 workflow stage/substate/gate 推导 PR readiness，也不读写 `.workflow` private state。
- PR/MR create 已实现 inspect-before-create：provider inspect 明确区分 `found` 与 `absent`；inspect 失败或 malformed output 不会被当成 absent，避免重复创建；running operation 可在 inspect 到匹配外部 PR/MR 后 reconcile。
- Merge approval 已落地为有效 snapshot，而不是布尔值：必须绑定 `pr_id + head_sha + base_sha + validation_run_id + merge_strategy`，且 PR status 可 merge、review status 为 `clean`/`approved` 时才允许 request approval 或暴露 merge 工具。
- `requestMergeApprovalRuntime` 已 operation 化；同 snapshot 的 pending/approved request 可复用，不同 snapshot 的旧 pending/approved request 会失效后再创建新 request，避免 stale approval 阻塞或被误用。
- `mergeAfterApprovalRuntime` 在获取 PR merge lock 后会先重新 inspect review/PR snapshot，刷新本地记录并重新校验 approval；provider inspect/merge 失败会受控标记 operation `failed`/`unknown`、释放 lock、记录 failure event。
- Coordinator Surface 已接入 PR/MR snapshot、review summary 和 merge approval snapshot；只有 Core 同等严格语义下有效的 approval 才暴露 `merge_after_approval`。operator-only 的 approve/reject 不进入 surface。
- Coordinator Agent Tools 已接入 `create_pr`、`update_pr`、`inspect_review`、`request_merge_approval`、`merge_after_approval`；参数保持 `title/pr/artifact path` 等窄参数，复杂 PR body、approval 问题和 review 内容继续走 artifact。
- CLI/API 已新增 operator-only PR/MR 调试入口，覆盖 create/update/inspect-review/request-approval/approve/reject/merge；这些入口只调用 Core policy gate，不是 agent tools。
- 第十轮经过多轮独立 `gpt-5.5 high` subagent review，所有必须修复项已处理并复验。关键修复包括：`pr_ready` Core gate、inspect-before-create、running operation replay reconcile、merge 前重新 inspect、完整 approval snapshot、旧 pending/approved approval 失效、surface 与 Core merge readiness 对齐、provider failure operation/lock 收口。
- 本轮验证通过：`openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`（148 passed）、`pnpm build`。
- 已实现 Web Operator Surface：Vite + React 页面从占位升级为可连接 API 的 operator console，支持 project/task 加载、manual task 创建、task list、task detail、current blocker、surface snapshot、available tools、denied actions、execution plan、workspace/workflow/agent/PR/human 摘要。
- Web/API 本轮仍保持 operator surface 边界：Web 不直接修改 SQLite，不在前端重建状态机；所有副作用都经 API 调用 Core runtime，operator-only action 未进入 Coordinator Surface `available_tools`。
- 已实现 Web human request answer：operator 提交正文后由 Core 写入唯一 human answer artifact，并用 HumanRequest `state_version` 做 CAS；如果 DB transaction 失败，会清理本次已写 artifact，避免 stale artifact 污染。
- human answer 的语义仍是唤醒而不是消化：Core 只把 HumanRequest 更新为 `answered`，必要时把 task 从 `waiting_human` 唤醒到 `human_answered`；后续如何理解回答仍交给 daemon/Coordinator Agent。
- 已实现 Web PR/MR approval/reject/merge 操作入口：UI 展示 approval snapshot 字段，approve/reject/merge 复用既有 PR/MR Provider Runtime；merge 前仍由 Core 重新 inspect 并校验 snapshot。
- 已实现 Web event timeline 和 tool trace：timeline 展示 type/summary/severity/operation/artifact refs；`agent_tool_call` 事件额外展示 tool name、status、failure code 和 result summary，便于排查 agent tool 行为。
- API 已补充 Web 所需 operator 查询和动作入口：`GET /tasks`、`POST /tasks`、`GET /tasks/:taskId`、`POST /human-requests/:humanRequestId/answer`，并复用 daemon tick、PR/MR approval/reject/merge 等已有 operator-only 入口。
- API CORS 默认只允许本地 Vite dev/preview origin：`http://127.0.0.1:5173`、`http://localhost:5173`、`http://127.0.0.1:4173`、`http://localhost:4173`，可通过 `COORDINATOR_WEB_ORIGINS` 配置；没有使用通配 `*`。
- Web 默认 API base 为 `VITE_COORDINATOR_API_BASE ?? "http://127.0.0.1:4310"`，保持本机开发优先，同时为后续部署配置留出口。
- 第十一轮独立 `gpt-5.5 high` subagent review 已完成。首次 review 指出 tool trace 展示不足、human answer artifact 先写文件后事务失败可能留下 stale artifact；两项均已修复并复验，最终 review 确认无必须修复项。
- 本轮验证通过：`openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`；review 修复后也通过 targeted tests、typecheck、build 和 OpenSpec strict validation。
- 已实现 operator-only task controls：Core 新增统一 task control runtime，支持 pause/resume/cancel/retry，所有入口必须携带 expected task state version，并由 Core 校验 terminal state、human/review/merge gate、状态合法性和 event 写入。
- Task control 仍保持 operator surface 边界：API `POST /tasks/:taskId/control`、CLI `task control`、Web task detail 按钮都只调用 Core runtime；`pause_task`、`resume_task`、`cancel_task`、`retry_task` 不进入 Coordinator Surface `available_tools`。
- cancel 语义已明确为停止 coordinator 自动推进，不默认删除 workspace、关闭 PR/MR 或清理 artifact；这些外部副作用保留给后续独立 operator cleanup 能力。
- resume/retry 已接入 daemon 恢复路径：二者写带 dueAt 的 operator event，daemon 只有在 dueAt 到期后才会基于最新 surface 继续推进；resume 使用 dueAt=now，以复用 retry_due gate 而不新增状态字段。
- daemon 已补强 paused/canceled 守卫：candidate advance、stale session retry、answered human request wake-up 都不会在 paused/canceled task 上启动 Coordinator Agent 或执行 agent tools。
- Coordinator Surface 已补强 paused/canceled 语义：paused 映射到现有 resume surface、canceled 映射到 completed terminal surface；二者只保留 inspect 或空工具，并在 recommended next step、recovery 和 denied actions 中明确不得继续执行副作用操作。
- 第十二轮第一个切片经过独立 `gpt-5.5 high` subagent review。首次 review 指出 paused/canceled surface 仍可能暴露执行工具；已修复并补回归测试，复审确认无 must-fix。
- 本切片验证通过：`openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`；review 修复后也通过 focused tests 和最终全量验证。
- 已补齐 workflow:action operation 的正式恢复闭环：daemon 通过 workflow protocol status 只读 inspect 同步对账，unknown/running/failed 的旧 action operation 可被封口为 reconciled；inspect 失败或冲突保持 unknown/operator attention，不读取 `.workflow` private state，不静默推进 completed/handoff/pr_ready。
- workflow action recovery 已补强同 tick 去重与失败路径可观测性：同一 workflow run 多个 action operation 复用一次 status observation；真实 `invokeWorkflowAction` 失败会记录 workflowRunId，便于 daemon 恢复时准确定位对应 run；相关测试已补齐。
- 已实现 daemon/Core recovery matrix：新增 Core-owned `RecoveryDecision`，将 daemon 恢复路径收敛为有限的 `Observation -> Core RecoveryDecision -> Daemon Action`，daemon 继续只做 runtime driver，不判断业务完成、review 结论、workflow profile 或 merge readiness。
- Operation replay 已覆盖 `running`、`failed`、`unknown` operation 的主要恢复场景：`matches-intent` 标记 reconciled，`absent` 按 retry budget 安排 retry 或 operator attention，`conflicts-with-intent` 进入 operator attention，`unclear` 保持 unknown/operator review。
- Daemon operation replay 候选查询已在 DB 层按 `kind LIKE 'daemon:%'` 和未持久化 recovery decision 过滤后再 `LIMIT`，避免非 daemon backlog 或已处理 daemon backlog 挤占候选窗口。
- Workflow reconciliation 已补强 protocol-only 边界：只通过 workflow protocol `status`，`runId/profile mismatch` 进入 protocol consistency violation，不读取 `.workflow` private state，不用 stage/substate/gate 推导 completed 或 pr_ready。
- Recovery observability 已落地为 `daemon.recovery_decision` event，payload 保持窄字段：resource、operation、decision、reason code、observed summary、next action、retry dueAt、operator attention 和 artifact refs；不写 provider raw output、lock token、完整 operation JSON、完整 workflow status 或完整 recovery matrix。
- Agent surface/tool 泄漏防护已补强：Coordinator Surface 不新增内部 recovery tools；`inspect_workflow_run` 等 agent tool 失败事件不会把 workflow protocol mismatch 的 expected/actual、raw run id/profile、provider raw output、lock token 或完整 operation 信息写入 agent-facing event payload。
- Paused/canceled/waiting gate 已纳入 safe inspect 语义：paused/canceled 阻止 agent 启动、agent tools、workflow action、PR/MR mutation 和 merge，但允许 read-only inspect 与 recovery event；answered human request 对 paused task 不被 daemon 消费。
- 本切片经过多轮独立 `gpt-5.5 high` subagent review。review 发现并已修复：workflow mismatch error 泄漏、agent tool failureMessage 泄漏、workflow reconcile 成功/失败路径事务一致性、同 tick 重复 workflow inspect、operation replay 候选饥饿问题；最终复审确认无 must-fix。
- 本切片验证通过：targeted tests、`pnpm typecheck`、`openspec validate --all --strict`、`pnpm test`（182 passed）、`pnpm build`。
- 已知后续收敛项：same task stateVersion no-progress 的判断当前仍在 daemon advance path 中做短路，行为已受控且不扩大 surface；后续可在独立 change 中进一步改为显式 Core recovery observation/decision。
- 已实现 workspace/lock/fencing recovery：新增 workspace/lock resource kind 与 Core-owned `RecoveryDecision`，daemon 只做 active workspace read-only inspect、expired lock inspect-before-release 和 Core action 执行，不直接成为 workspace/lock 状态机。
- Workspace recovery inspect 已覆盖 workspace path、repo path、coordinator path、artifact root、git worktree、branch、dirty、ownership manifest、checkpoint artifact 等窄 observation；path/realpath/artifact root 风险继续 fail-fast，path 失败后不继续 git、manifest 或 checkpoint 检查。
- Workspace recovery 对 `missing`、`branch_mismatch`、`dirty_unknown`、`manifest_mismatch`、`path_escape` 等风险进入 `operator_attention`；malformed `ownership.json` 也收敛为 `manifest_mismatch`，不会中断 daemon tick。
- Expired workspace lock release 已改为 inspect-before-release：只有 owner 无 active outer agent session、无 active workflow run、无 active workspace operation，且 workspace observation `safeToReleaseLock=true` 时，Core 才允许 `release_expired_lock`。
- Lock release 使用 `lockToken + leaseVersion` 做 fencing，并在同一 transaction 内释放 lock 和写入 `daemon.recovery_decision` event；如果 leaseVersion 已变化，daemon 不误报 `lock_reconciled`。
- Workspace 被 recovery 判定需要 operator attention 时会被标记为 `blocked` 并加入本 tick `touchedTaskIds`，阻止同一 tick 继续启动 Coordinator Agent 或执行后续副作用。
- Coordinator Surface 已将 `blocked` workspace 纳入 active workspace 查询与 gate：workflow running / handoff / `create_pr` / `start_workflow_run` 等窗口都会先短路，不暴露内部 recovery tools，也不泄漏 lock token、leaseVersion、manifest 原文或完整 git output。
- 本切片经过多轮独立 `gpt-5.5 high` subagent review。review 发现并已修复：workspace operator attention 只写 event 未阻止后续推进、malformed manifest 中断 tick、leaseVersion changed 误报 reconciled、blocked gate 位置过晚、workspace status CAS 未检查 changes；最终复审确认无 must-fix。
- 本切片验证通过：targeted tests、`pnpm test`（193 passed）、`pnpm build`、`pnpm typecheck`、`openspec validate --all --strict`、`openspec validate --changes "harden-workspace-lock-fencing-reconciliation" --strict`、`git diff --check`。
- 已补齐第二套真实 PR/MR provider/platform：GitLab `glab` CLI 路径现在有明确 OpenSpec contract、runner contract tests 和 GitLab JSON external fact 归一化。
- `CliPullRequestProvider("gitlab")` 覆盖 inspect-before-create、create、update、inspect review、merge after approval 的窄命令形态；GitLab `mr list/create/update/view/merge` 均保持 provider adapter 边界，不新增 Core brand-specific 状态机。
- GitLab review inspect 已兼容 `source_branch/target_branch/web_url/iid/id/sha/state/merge_status/detailed_merge_status/blocking_discussions_resolved/diff_refs/head_pipeline/pipeline` 等常见字段，并统一转换为有限 external fact；`diff_refs.head_sha/base_sha` 与 `head_pipeline.id` 会刷新 approval snapshot 所需 head/base/validation 字段。
- GitLab create 输出会从 URL 或 `!iid` 抽取短 external id，便于后续 update/view/merge 稳定引用同一 MR；create 阶段 synthetic head/base 不能直接通过 merge readiness，后续 inspect review 必须刷新真实 snapshot 后才能 request approval。
- GitLab malformed inspect output 会阻断 create，不会被当成 absent；provider raw JSON、`diff_refs`、`head_pipeline` 原始结构不会进入 Coordinator Agent surface/tools。
- 本切片经过独立 `gpt-5.5 high` subagent review。首次 review 指出 GitLab approval snapshot 未解析真实 `diff_refs` 与 `head_pipeline`；已修复并复审，最终确认无 must-fix。
- 本切片验证通过：`openspec validate add-gitlab-pr-mr-provider-contract --strict`、`openspec validate --all --strict`、`pnpm typecheck`、`pnpm test packages/core/src/pr-mr-provider.test.ts`、`pnpm test`（214 passed）、`pnpm build`、`git diff --check`。
- 已实现 operator-only diagnosis summary：`GET /tasks/:taskId` 和 Web task detail 现在展示 current blocker、operator attention、retry budget、operation ledger、recovery timeline、provider/protocol inspect 摘要。
- Diagnosis 仍由 Core 从已持久化 events、operations 和实体状态只读派生，不新增状态表、不新增状态机、不触发 provider/workflow 实时 inspect，不改变 daemon/recovery/PR/workflow 协议。
- Diagnosis 输出已做 payload 白名单和长度限制：不返回 provider raw output、lock token、完整 operation JSON、完整 recovery matrix 或复杂内部对象；Web 只渲染 Core summary，不直接展示完整 event payload。
- 当前/历史语义已收紧：历史 workflow/PR/agent session 和历史 recovery decision 可以保留在 recovery timeline 中供 operator 排查，但不会驱动当前 `operatorAttention.required`；当前 attention 只看 latest attempt/current entity，blocked workspace 会进入 operator detail current blocker 和 attention reason。
- Operator detail 使用 operator-only workspace 查询纳入 `blocked` workspace；执行路径继续使用原有 active workspace 查询，避免把 operator 诊断语义污染到 workflow/PR/agent side-effect runtime。
- Coordinator Surface 未新增 recovery/operator/internal tools，agent-facing Markdown 和 `available_tools` 未因 diagnosis 扩大；operator-only diagnosis 不自动进入 Coordinator Agent 当前世界。
- 本切片经过多轮独立 `gpt-5.5 high` subagent review。review 发现并已修复：历史 `daemon.recovery_decision` attention 污染当前 diagnosis、blocked workspace 未进入 operator detail；最终复审确认无 must-fix。
- 本切片验证通过：`pnpm test -- packages/core/src/operator-surface.test.ts apps/api/src/server.test.ts`（Vitest 实际全量 218 passed）、`pnpm typecheck`、`openspec validate harden-observability-operator-diagnosis --strict`、`git diff --check`。

## 6. 实现顺序

### Iteration 0: 文档基线

目标：

- 落地当前 docs。
- 明确长期边界和第一版范围。

完成标准：

- `docs/AGENTS.md`
- `docs/architecture.md`
- `docs/coordinator-surface.md`
- `docs/agent-tools.md`
- `docs/daemon.md`
- `docs/workflow-protocol.md`
- `docs/execution-workspace.md`
- `docs/project-registry.md`
- `docs/observability.md`
- `docs/contracts.md`
- `docs/operations.md`
- `docs/research.md`
- `docs/roadmap.md`

### Iteration 0.1: 契约与运行机制收敛

目标：

- 新增硬契约文档。
- 新增运行机制文档。
- 新增调研记录。
- 将 review 结论收口到可测试 contract。

完成标准：

- `docs/contracts.md` 覆盖 surface schema、tool visibility、state ownership、operation/idempotency、HumanRequest、handoff、merge approval、artifact path。
- `docs/operations.md` 覆盖 operation ledger、CAS、lock、reconcile、retry、watchdog、resume preflight。
- `docs/research.md` 记录所有已调研来源、可吸收/不吸收点。
- 现有文档引用这些 contract，而不是重复发散。

### Iteration 1: 项目骨架

目标：

- Node + TypeScript。
- Fastify。
- Vite + React。
- SQLite。
- 基础 CLI。

完成标准：

- 可启动 API。
- 可启动 Web。
- 可运行测试。
- SQLite migration 可执行。

### Iteration 2: 数据模型与 Event Store

目标：

- 建核心表。
- 建 append-only events。
- 建基础 repository 层。
- 建 operation ledger。
- 建 state_version / CAS。
- 建 lock / lease / lock_token。
- 建 partial unique index，保证 active 唯一性。

表：

- projects。
- tasks。
- attempts。
- execution_plans。
- plan_steps。
- workspaces。
- agent_sessions。
- workflow_runs。
- pull_requests。
- human_requests。
- events。
- artifacts。
- operations。
- locks。

完成标准：

- 可创建 project/task。
- 所有状态变化和关键 event 同 SQLite transaction。
- CAS conflict 能被测试覆盖。
- operation idempotency key 能防重复副作用。
- active 唯一性约束生效。
- CLI/Web 能查看最小 event timeline。

说明：

- 这一阶段先把 P0 必需表建起来。
- 其他表字段可以 nullable / stubbed / reserved，但必须有 migration 规划。

### Iteration 3: Project Registry

目标：

- 注册工程。
- 检测 git repo。
- 检测 GitHub/GitLab。
- 检测 remote HEAD 并显式确认 default branch。
- 配置 workflow launcher。

完成标准：

- Web/CLI 可注册工程。
- 自动检测 provider。
- 不确定时要求用户选择。
- default branch 检测失败时阻塞注册，直到用户确认。
- 项目 surface 可生成。
- 如果 provider / PR platform 只有 stub，也允许保存项目，但 surface 必须明确暴露缺失能力和补齐路径。

### Iteration 4: Coordinator Surface

目标：

- 将数据库状态翻译成 agent-facing Markdown surface。
- 支持 autonomy guidance。
- 支持 tool visibility。
- 支持 denied actions。
- 支持 memory trust boundary。
- 支持 resume surface。
- 支持 validation contract surface。

完成标准：

- bootstrap surface。
- planning surface。
- execution surface。
- human request surface。
- review surface。
- merge surface。
- fixtures / tests 覆盖工具可见性。
- artifact root 和相对路径规则进入 fixture。

### Iteration 5: Workspace Manager

目标：

- LocalWorker。
- git worktree workspace。
- branch 创建。
- workspace lock。
- workspace reconciliation。
- path realpath containment。
- checkpoint artifact。
- resume preflight。

完成标准：

- task attempt 可创建 workspace。
- workspace path 在 root 内。
- branch 规则稳定。
- 默认 base branch 为 project default branch。
- stale lock / symlink escape / branch exists 场景有测试。

### Iteration 6: Workflow Protocol Adapter

目标：

- 调用 `workflow protocol capabilities/status/start/action/artifacts/events`。
- 如果 workflow 尚未实现完整 protocol，可先用 compatibility adapter 包装现有 CLI，但必须标记为临时。

完成标准：

- 可启动 workflow run。
- 可查询 status。
- 可读取 handoff。
- 不直接读写 `.workflow` 内部 state。
- 不映射 workflow 私有 stage/substate 作为外层状态迁移依据。

说明：

- `stage/substate/gate/allowedActions` 只能作为 debug/display 信息。
- 外层判断只能依赖 `lifecycle + handoff + artifacts + recovery + summary`。

### Iteration 7: Agent Provider

目标：

- CodexProvider。
- ClaudeCodeProvider。
- agent session state。
- transcript / prompt / surface snapshot artifact。

完成标准：

- outer Coordinator Agent 可通过 provider 运行。
- inner workflow coding agent 可通过 provider 运行。
- 两者 provider 可配置。
- P0 至少一条真实路径可用，另一条可作为 stub / fake。

### Iteration 8: Coordinator Agent Tools

目标：

- 实现核心 tools。
- 工具参数保持窄。
- 工具调用写 event。
- artifact path 校验。
- 副作用工具 operation 化。
- Web-only tools 与 agent tools 分离。

优先工具：

- `write_execution_plan`
- `revise_execution_plan`
- `create_attempt`
- `create_workspace`
- `start_workflow_run`
- `inspect_workflow_run`
- `ask_human`

后续工具：

- `create_pr`
- `request_merge_approval`
- `merge_after_approval`
- `mark_done`
- `handoff_to_human`
- `resume_workflow_run`

完成标准：

- agent 只能调用当前 surface 暴露工具。
- 不允许复杂 JSON 主交互。
- 工具失败有可恢复错误和 tool trace。
- inspect-before-create 覆盖 workspace/workflow；PR/MR/merge 相关 inspect-before-create 留到对应 provider 迭代。
- P0 最小工具闭环先可跑通，非闭环工具可留到 P1 或对应后续迭代。

### Iteration 9: Daemon

目标：

- scheduler loop。
- watchdog loop。
- reconciliation loop。
- retry loop。
- human request loop。
- reconciliation invariant matrix。
- watchdog timeout / process stop / process group kill。
- retry budget / handoff。

完成标准：

- daemon 重启后恢复 active task。
- stalled session 可检测。
- human answer 可唤醒。
- retry 可执行。
- concurrency 可配置。
- claim/CAS/lock/idempotency 的最小故障注入测试通过。

### Iteration 10: GitHub/GitLab PR/MR Provider

目标：

- 创建 PR/MR。
- 更新 PR/MR。
- inspect review。
- merge after approval。
- conflict detection。
- approval snapshot 校验。
- merge result reconciliation。

完成标准：

- P0 至少一个平台可创建并 merge。
- P1 GitHub 和 GitLab 都可创建并 merge。
- 默认 squash merge。
- merge 前重新验证。
- head/base/checks 变化后 approval 失效。

### Iteration 11: Web UI

目标：

- 手动 task 创建。
- task list。
- task detail。
- event timeline。
- execution plan。
- human request answer。
- PR/MR approval。
- pause/resume/cancel/retry。

完成标准：

- 不依赖外部任务源即可完成手动任务闭环。
- 能看清当前 blocker。
- 能显式批准 merge。
- approval snapshot 在 UI 可见。
- HumanRequest 生命周期可追踪。

已落地事实：

- Web 已支持 manual task 创建、task list 和 task detail。
- task detail 已展示 current blocker、surface snapshot、available tools、denied actions、execution plan、workspace/workflow/agent/PR/human 摘要。
- timeline 已展示关键 event，且对 `agent_tool_call` 提供 tool trace。
- human request answer 通过 operator-only API 记录到 artifact，并用 CAS 防止过期回答覆盖。
- merge approval/reject/merge 通过 Web 调用 Core PR/MR Provider Runtime，仍由 Core 校验 snapshot 和 merge policy。
- pause/resume/cancel/retry 尚未在 Web 中完成完整按钮闭环；进入 Iteration 12 hardening 时继续按 operator-only/Core gate 原则补齐或明确推迟。
- pause/resume/cancel/retry 已在 Iteration 12 第一个 hardening 切片中补齐 operator-only Core/API/CLI/Web 闭环。

### Iteration 12: P1 / P2 Hardening

目标：

- 补齐 P1 的第二套真实 provider / platform。
- 补齐 P2 的接口与规划文档，但不强行实现。
- 扩大故障注入与恢复测试。
- 验证长期边界没有被 stub 污染。

完成标准：

- 文档与实现一致。
- P0 闭环稳定。
- P1 补齐能力可用。
- P2 只停留在预留接口和规划记录。

## 5. 后续扩展

### 5.1 Meego Adapter

在第一版稳定后接入。

复用：

- TaskSource。
- HumanInteraction。
- external status mapping。
- report publishing。

验收建议：

- polling 或 webhook 至少实现一种。
- Meego 状态映射不进入 core。
- Meego report 由 adapter 发布，核心只写 TaskEvent。

### 5.2 Remote Worker

复用：

- WorkerRuntime。
- WorkspaceStrategy。
- AgentProvider。
- daemon heartbeat。

规划细节：

- RemoteWorker 遵守同一 WorkerRuntime interface。
- workspace root 在远程解释。
- agent provider auth 不由 core 硬编码。
- heartbeat 丢失后进入 reconciliation。
- 不允许本地 worker 静默接管已经在远程产生副作用的 attempt。

验收建议：

- 远程 worker register/heartbeat。
- 远程 workspace create/inspect。
- provider command 可执行。
- 断连后状态可恢复或 handoff。

### 5.3 Task Source 扩展

包括：

- GitHub Issues。
- GitLab Issues。
- Linear。

规划细节：

- 所有 source adapter 只产出 normalized task。
- source status mapping 可配置。
- source comment/report 不成为 core state。
- webhook/polling 统一转 TaskEvent。

### 5.4 conflict-resolution workflow

依赖 `workflow` 新增 profile。

Coordinator 只负责在 merge conflict 时启动对应 workflow run。

规划细节：

- merge conflict 产生 workflow handoff 或 coordinator blocked state。
- Coordinator Agent 可启动 `conflict-resolution` profile。
- 冲突解决完成后必须重新验证并刷新 merge approval snapshot。

验收建议：

- 人工制造冲突。
- 进入 conflict-resolution。
- 解决后 approval 失效并重新请求。

### 5.5 decomposition workflow

依赖 `workflow` 新增 profile。

Coordinator 可用它做多子任务规划。

规划细节：

- decomposition 输出 plan artifact。
- coordinator 不把 plan artifact 自动变成 DAG。
- 子任务必须显式创建 Task/Attempt。
- parent/child 关系只作为 trace，不作为自由编排 engine。

验收建议：

- decomposition 生成子任务建议。
- 人或 Coordinator Agent 显式创建子任务。
- 子任务各自有独立 attempt/workspace。

### 5.6 完整 circuit breaker / dead-letter UI

规划细节：

- 基于 retry budget 和 error kind。
- 进入 terminal handoff 或 failed 后在 UI 中展示。
- 不做分布式队列式复杂 dead-letter 系统。

验收建议：

- 连续 provider failure 后进入 handoff。
- UI 可查看失败链路和恢复建议。

### 5.7 Provider routing policy

规划细节：

- 用 capability/tag 表达能力，不用品牌表达业务语义。
- project/task 可配置偏好。
- Coordinator Surface 暴露能力和当前映射。

验收建议：

- 同一任务可切换 provider。
- 切换理由写入 event。
- agent 不直接依赖厂商品牌做业务判断。

## 6. 架构防污染规则

必须避免：

- core import GitHub/GitLab 具体实现。
- scheduler import manual source。
- Coordinator Agent 直接访问 SQLite。
- PR provider 直接推进 task completed。
- workflow adapter 读取 `.workflow` private state。
- Web UI 绕过 core 直接改 attempt 状态。
- 工具接收复杂 JSON payload。
- daemon 做业务语义判断。
- handoff 镜像 workflow 内部 stage/substate。
- hidden cross-project memory。
- execution plan 演化成 DAG engine。

## 7. 测试策略

第一版至少需要：

- unit tests。
- repository tests。
- surface fixture tests。
- tool visibility tests。
- daemon simulation tests。
- workspace path safety tests。
- workflow adapter contract tests。
- provider stub tests。
- PR/MR provider smoke tests。
- operation idempotency tests。
- CAS conflict tests。
- duplicate scheduler tick tests。
- stale lock takeover tests。
- approval invalidation tests。
- workflow handoff contract tests。
- crash-after-side-effect / crash-before-event tests。

## 8. Definition of Done

### 8.1 P0 DoD

- 文档与实现一致。
- Web 可完成手动任务闭环。
- SQLite 可恢复状态。
- daemon 可恢复 active task。
- 一个真实 AgentProvider 可用。
- 一个真实 PR/MR provider 可用。
- workflow protocol adapter 可运行。
- merge 必须审批。
- 事件完整可查。
- 关键扩展点有接口。
- operation/idempotency/CAS/必要 lock 可靠性底座可验证。
- workflow handoff 取代 ready-only readiness。

### 8.2 P1 DoD

- 第二个 AgentProvider 可用。
- 第二个 PR/MR provider 可用。
- 更完整的 recovery / retry / reconciliation 可用。
- full observability 视图可用。

### 8.3 P2 Acceptance

- P2 能力仍然只在文档和接口里预留，按需进入后续实现。
