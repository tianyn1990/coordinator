# Proposal: add agent provider runtime

## 背景

`coordinator` 已具备 Project Registry、Coordinator Surface、Workspace Manager 和 Workflow Protocol Adapter。下一阶段需要让外层系统能真正启动 `Coordinator Agent` session，并把 prompt、surface snapshot、transcript、final response 作为可观测 artifact 保存。

本轮只落地 `AgentProvider` 与最小 runtime 底座，不提前实现 daemon、PR/MR provider 或完整 agent tool executor。

## 目标

- 新增 `AgentProvider` interface 和 provider registry。
- 支持 `codex`、`claude-code`、`fake` 三类 provider id，其中 fake 用于 contract tests。
- 通过 provider 启动一次 outer Coordinator Agent decision session。
- 生成并保存 agent session 目录：
  - `coordinator/sessions/<session-id>/prompt.md`
  - `coordinator/sessions/<session-id>/surface.json`
  - `coordinator/sessions/<session-id>/surface.md`
  - `coordinator/sessions/<session-id>/transcript.jsonl`
  - `coordinator/sessions/<session-id>/final-response.md`
- agent session 启动遵守 operation-first、active uniqueness、lock/fencing 和 event 记录。
- 提供 operator-only CLI/API 调试入口，用于启动一次外层 agent session。
- 为 CodexProvider / ClaudeCodeProvider 命令形态提供真实 adapter，另一类本机不可用时返回受控 provider error。

## 非目标

- 不实现 daemon/watchdog/retry loop。
- 不实现 Coordinator Agent tools executor。
- 不让 agent 直接调用 DB 或 operator-only tools。
- 不实现 PR/MR provider。
- 不实现 remote worker。
- 不做 agent provider 智能路由策略，只保留 provider id 和 capability 元数据。
- 不实现长期流式事件消费；本轮只保存单次非交互结果和最小 transcript。

## 设计约束

- `Coordinator Surface` 是 agent prompt 的主要事实输入。
- provider 只能接收 Markdown prompt 和少量命令参数；复杂上下文通过 surface/artifact 文件传递。
- agent session 是外部副作用，必须先写 operation intent。
- agent 产物不能成为 hidden memory；后续可见性必须由 surface 显式暴露。
- CLI/API 入口是 operator-only 调试入口，不进入 Coordinator Surface。
- provider adapter 与 workflow protocol adapter 解耦，不互相调用。
