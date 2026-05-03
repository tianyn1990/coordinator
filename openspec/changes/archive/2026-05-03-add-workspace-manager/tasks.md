# Tasks

- [x] 1. 新增 workspace-manager OpenSpec 规格，覆盖 worktree、branch、lock、path containment、checkpoint、resume preflight 和 operator 入口。
- [x] 2. 在 `packages/db` 增加 attempt/workspace/artifact 最小 repository，并补充单测。
- [x] 3. 在 `packages/core` 实现 Workspace Manager service、GitRunner abstraction、branch sanitize、workspace layout 和 path containment。
- [x] 4. 实现 operation-first create workspace：lock、inspect-before-create、git worktree、ownership manifest、checkpoint artifact、event。
- [x] 5. 实现 resume preflight，并补充 path safety、branch mismatch、dirty status、manifest/checkpoint 检查测试。
- [x] 6. 增加 CLI/API operator-only workspace create/preflight 调试入口。
- [x] 7. 运行 OpenSpec validate、typecheck、test、build。
- [x] 8. 交给独立 `gpt-5.5 high` subagent review，显式检查 docs 对齐、持续阅读设计文档、过度设计、协议漂移、分层污染、复杂 JSON 暴露。
- [x] 9. 修复 review 必须项并复验，直到 review 无必须修复问题。
- [x] 10. 归档 OpenSpec change，更新 roadmap 和落地事实，提交本轮改动。
