# Tasks

- [x] 新增 workflow protocol adapter OpenSpec 规格。
- [x] 补齐 DB workflow_runs repository 与 event 关联字段映射。
- [x] 实现 workflow protocol runner、JSON 解析、capabilities/status/action/artifacts/events 规范化。
- [x] 实现 start workflow run 的 operation-first、lock 和 active run 复用语义。
- [x] 增加 operator-only CLI/API 调试入口。
- [x] 补充 contract tests：不读写 `.workflow` 私有 state、不用 stage/substate 推进业务状态、profile 必须来自 capabilities implemented。
- [x] 运行 `openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- [x] 完成独立 `gpt-5.5 high` subagent review 并修复问题。
- [x] 归档 change、更新 roadmap/相关设计文档、提交改动。
