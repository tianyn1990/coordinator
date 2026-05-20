## Why

真实 outer Agent smoke 暴露出一个边界问题：外层 Coordinator Agent 会尝试传入 `default`、`codex` 等它臆造的 workflow profile，导致 Core 正确拒绝并反复重试。根因不是 profile 校验不够宽，而是选择权放错了层：Coordinator 只应决定是否启动 workflow，workflow runtime 才知道当前支持哪些内部流程、如何根据任务上下文选择 profile。

这个变更把 workflow profile 的最终选择权委托给 workflow runtime，同时保留人类在外部入口显式选择 workflow 的能力，避免 Coordinator 静态注册表与 workflow 持续升级产生耦合。

## What Changes

- **BREAKING**: agent-facing `start_workflow_run` 不再接受由外层 Agent 选择的 `profile` 参数。
- `default` / `auto` 统一表示“委托 workflow runtime 自动选择”，不是 Coordinator 侧的真实 profile id。
- 人类可以在 Web/CLI/manual task 入口显式选择 workflow profile；Coordinator 只保存并透传这份 human explicit selection，不让外层 Agent 重新判断。
- 任务描述或提示词中的自然语言倾向不由 Coordinator 解析成 profile；启动 workflow 时作为上下文交给 workflow runtime 自主判断。
- workflow start 结果必须持久化实际返回的 `actual profile`，并在 event / operator summary 中区分 requested selection 与 actual profile。
- workflow capabilities 继续可用于 operator 展示和校验 human explicit selection，但不得成为外层 Agent 的 profile 决策源。
- daemon 继续只做 inspect/reconcile/retry，不选择 workflow profile，也不执行 workflow action。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workflow-protocol-adapter`: workflow start 支持 omitted/default/auto selection，由 workflow runtime 决定 actual profile；human explicit selection 可被透传和校验。
- `coordinator-agent-tools`: agent-facing `start_workflow_run` 不再允许外层 Agent 传入具体 profile。
- `coordinator-surface`: workspace ready surface 不再要求外层 Agent 选择 profile，也不把 workflow capabilities 暴露为 agent 决策源。
- `core-data-model`: workflow run 与相关 event 必须保存 requested selection 与 actual profile，用于审计和 operator 理解。

## Impact

- 影响 `docs/roadmap.md`、`docs/workflow-protocol.md`、`docs/coordinator-surface.md`、`docs/agent-tools.md`、`docs/contracts.md`。
- 影响 Workflow Protocol Adapter、Coordinator Agent Tools executor、Surface builder、DB repository、CLI/API/Web task 创建或 workflow start 调试入口。
- 可能需要 SQLite migration 为 `workflow_runs` 或 task metadata 增加 requested/actual profile 相关字段。
- 需要补充 contract tests、surface/tool tests、daemon smoke tests。
- 不新增 npm dependency，不读取或写入 `.workflow` private state，不新增 agent-facing workflow action tool，不改变 daemon running workflow inspect-only 边界。
