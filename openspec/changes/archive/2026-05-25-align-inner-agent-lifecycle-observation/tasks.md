## 1. Core Observation Model

- [x] 1.1 新增共享 workflow runtime observation 类型与 helper，基于现有 workflow projection、handoff 和 action classification 派生 mode/owner/reason/actions。
- [x] 1.2 将 task detail / execution summary 暴露 operator-only workflow observation，保持 optional fallback 且不触发实时 inspect。
- [x] 1.3 确认 Coordinator Surface 只展示短 observation 摘要，不新增 workflow action executor 或 operator-only tool。

## 2. Web And Daemon Alignment

- [x] 2.1 让 Task Cockpit、Action Inbox、task card 和 Workflow Lens 优先使用 workflow observation，`materialize-change <change-id>` 只进入 debug/detail。
- [x] 2.2 调整 Run Until Blocked 停止原因，使用 observation 区分 observing runtime、operator gate、handoff/attention 和 global/task scope。
- [x] 2.3 补齐 daemon running workflow tests，确认 internal/debug action 只记录 observation，不创建 human request/operator attention，也不调用 workflow action helper。

## 3. Docs And Future Handoff

- [x] 3.1 更新 docs 中 workflow agent lifecycle / Web Workbench / workflow protocol 相关表述，统一“观察 inner agent，等待真正 gate”的心智。
- [x] 3.2 整理未来 workflow 工程交接建议，明确 `agent.state`、`blocker.owner`、`operatorActions`、`agentActions` 等是后续可选增强，当前版本不依赖。
- [x] 3.3 更新 `docs/roadmap.md` Slice 14.4 状态与验收记录。

## 4. Tests, Review, Archive

- [x] 4.1 增加 core/web tests 覆盖 observation 派生、operator gate、internal/debug action、surface 不扩大工具。
- [x] 4.2 运行 OpenSpec validate、相关 Vitest、typecheck、core build 和 web build。
- [x] 4.3 使用 subagent review 检查 docs 总体设计、过度设计、分层污染、workflow protocol 越界、SDK raw event 泄漏和 daemon/outer Agent 自动 workflow action。
- [x] 4.4 review 通过后归档 OpenSpec change，并提交本轮完整改动。
