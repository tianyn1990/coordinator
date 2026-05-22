## 1. Workflow Protocol Adapter

- [x] 1.1 扩展 `WorkflowStatus` 类型，增加 `progress` 和 `stageArtifacts`。
- [x] 1.2 扩展 parser，解析 workflow 0.6.10 projection，并保持缺失字段 graceful fallback。
- [x] 1.3 扩展 workflow event payload，让 Web Workflow Lens 能从 Core/API 返回的 events 中读取新字段。

## 2. Tests

- [x] 2.1 更新 workflow protocol adapter fixture，覆盖 `progress` 与 `stageArtifacts`。
- [x] 2.2 增加或更新 contract tests，确认 `status` 和成功 `action` post-action projection 都会持久化新字段。
- [x] 2.3 确认 `progress/stageArtifacts/actionInputHints` 不驱动 handoff、PR readiness、daemon action 或 Agent Surface。

## 3. 验证、Review 与收尾

- [x] 3.1 运行相关 tests、typecheck、Core build 和 OpenSpec validate。
- [x] 3.2 使用独立 `gpt-5.5 high` subagent review，检查 docs 边界、过度设计、协议偏离、分层污染和 Agent Surface 暴露风险。
- [x] 3.3 修复 must-fix 后归档 OpenSpec change，更新 `docs/roadmap.md`，提交本轮改动。
