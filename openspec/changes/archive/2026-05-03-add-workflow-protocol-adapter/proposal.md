# Proposal: add workflow protocol adapter

## 背景

`coordinator` 已完成 Project Registry、Coordinator Surface 和 Workspace Manager。下一阶段需要让外层系统能通过稳定 `workflow protocol` 与内层 `workflow` 项目通信，而不是读写 `.workflow` 私有状态或猜测 stage/substate。

## 目标

- 新增 `WorkflowRuntime` / `Workflow Protocol Adapter` 核心模块。
- 支持 `capabilities`、`start`、`status`、`action`、`artifacts`、`events` 六类 protocol 命令。
- 对 workflow 返回 JSON 做最小 schema 校验和规范化。
- 启动 workflow run 时遵守 operation-first、lock 和 inspect-before-create。
- 将 workflow run 机器事实、handoff、artifact、events 写入 DB/event store。
- 提供 operator-only CLI/API 调试入口。

## 非目标

- 不实现 daemon 调度循环。
- 不实现 Coordinator Agent provider。
- 不实现 PR/MR provider。
- 不实现 agent tool 执行器。
- 不读写 `.workflow` 私有 state 文件。
- 不把 workflow stage/substate/gate 映射为 coordinator 业务状态。

## 设计约束

- `workflow protocol` 是唯一边界真源。
- `stage`、`substate`、`gate`、`allowedActions`、`deniedActions` 只能用于 debug/display。
- Coordinator 外层状态推进只依赖 `lifecycle`、`handoff`、`artifacts`、`recovery`、`summary`。
- 工具/CLI/API 参数保持窄：attempt/run/profile/action/id/path，不传复杂 JSON。
- 复杂结果作为 artifact 或 event payload 引用保存，agent-facing surface 后续再做摘要。
