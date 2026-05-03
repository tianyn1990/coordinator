# Tasks

- [x] 新增 agent provider runtime OpenSpec 规格。
- [x] 补齐 DB agent_sessions repository、active outer session 唯一性约束和 event 关联字段映射。
- [x] 实现 `AgentProvider` interface、CodexProvider、ClaudeCodeProvider、FakeAgentProvider。
- [x] 实现 `runCoordinatorAgentSession` 和 `inspectAgentSession`。
- [x] 保存 prompt、surface snapshot、transcript、final response artifact，并登记必要 artifact/event。
- [x] 增加 operator-only CLI/API 调试入口。
- [x] 补充 contract tests：operation-first、active session uniqueness、provider 命令窄参数、artifact 落盘、surface 是 prompt 主输入、CLI/API 不进入 Coordinator Surface。
- [x] 运行 `openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- [x] 完成独立 `gpt-5.5 high` subagent review 并修复问题。
- [x] 归档 change、更新 roadmap/相关设计文档、提交改动。
