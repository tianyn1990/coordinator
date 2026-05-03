# Design: add-coordinator-surface

## 设计对齐

本 change 对齐：

- `docs/AGENTS.md`：实现必须主动对齐 docs，总体设计心智优先。
- `docs/coordinator-surface.md`：agent 只能基于当前 surface 行动，字段必须翻译成 guidance。
- `docs/contracts.md`：surface required fields、surface kind、tool visibility matrix、artifact path contract 是硬契约。
- `docs/agent-tools.md`：工具参数保持窄，复杂内容使用 artifact path。
- `docs/observability.md`：surface snapshot 是后续观测和审计的基础。

## 模块边界

新增 `packages/core` 内的 surface builder：

- 输入：明确的 `CoordinatorSurfaceSnapshot`。它可以由 fixture、DB loader 或未来 daemon 构造。
- 输出：`CoordinatorSurfaceEnvelope`，包含同源的 `json` 与 `markdown`。
- DB loader：只提供最小 `buildTaskSurfaceFromDb(context, taskId)`，当前主要生成 bootstrap/planning 级 surface；未来随 repository 完善再扩展。

Web/CLI 只调用 core，不拼接 surface 规则。

## Surface Snapshot

Snapshot 是 builder 的唯一输入，包含 task、project、attempt、execution_plan、workspace、workflow_runs、agent_sessions、pull_request、human_requests、memory、validation、artifact_root 等抽象字段。

注意：snapshot 不是数据库 schema 的镜像，而是 Core 已经整理后的机器事实。这样可以避免 agent surface 因数据库字段变化而漂移。

## Tool Visibility

实现使用内部 `deriveVisibleTools(snapshot)`，按当前可判定的 workflow/task/PR/human state 映射到工具集合。

原则：

- 无计划：`write_execution_plan`, `ask_human`。
- 有计划无 attempt：`create_attempt`, `revise_execution_plan`, `ask_human`。
- attempt 已建无 workspace：`create_workspace`, `revise_execution_plan`, `ask_human`。
- workspace ready：`start_workflow_run`, `revise_execution_plan`, `ask_human`。
- workflow running：`inspect_workflow_run`, `resume_workflow_run`, `ask_human`。
- workflow handoff：按 handoff kind 映射。
- pending human request：只保留 inspect/wait 类能力，不暴露副作用工具。
- merge approval missing/valid：只在 snapshot 明确 valid approval 时暴露 `merge_after_approval`。
- terminal：只暴露 inspect 类工具。

本轮不实现工具执行，因此 tool 定义只描述名称、用途、窄参数、side effect、success/recovery。

## Markdown Rendering

Markdown 是 Coordinator Agent 的主要输入。渲染规则：

- 用中文规则说明 autonomy、denied actions、recovery。
- 展示唯一 recommended next step。
- 工具参数以 CLI-like 形式展示，避免复杂 JSON。
- artifact root 明确为 `<workspace>/coordinator/artifacts/` 语义下的根；工具只接受相对路径。

## Artifact Root

Builder 对 artifact root 做轻量校验：

- 必须非空。
- artifact path 规则只展示相对路径约束。
- 真正 realpath containment 留给后续工具执行和 Workspace Manager；本轮 fixture 先锁住 surface 文案和相对路径规则。

## 测试策略

- fixture/test 覆盖所有 surface kind。
- fixture/test 覆盖主要 tool visibility 状态。
- 验证 JSON 与 Markdown 同一 `surface_id`。
- 验证 operator-only tools 不进入 surface。
- 验证 artifact root 与相对路径规则出现在 surface。
- 验证 autonomy enum 被翻译为规则语言。
