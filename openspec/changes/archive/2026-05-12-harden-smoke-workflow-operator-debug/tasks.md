## 1. OpenSpec 与设计边界

- [x] 1.1 对齐 `AGENTS.md`、`docs/AGENTS.md`、`docs/workflow-protocol.md`、`docs/observability.md`、`docs/operations.md`。
- [x] 1.2 创建本 change 的 proposal/design/tasks/spec delta。

## 2. CLI scripts hardening

- [x] 2.1 修正 root `cli` / `migrate` scripts，避免把裸 `--` 传入 CLI。
- [x] 2.2 用轻量命令验证正式 pnpm CLI/migrate 入口。

## 3. SQLite operator debug hardening

- [x] 3.1 在 DB 连接初始化中设置 `busy_timeout`，保留 WAL。
- [x] 3.2 更新 docs/roadmap 或相关文档，说明 workflow operator debug 查询会记录 event/status snapshot，不适合作为并发 hammer/polling API。

## 4. Workflow action input hints

- [x] 4.1 在 workflow protocol adapter 中新增 sanitized action input hints 类型和 parser。
- [x] 4.2 让 operator-only workflow status 返回 action input hints。
- [x] 4.3 确保 event payload 只保存窄摘要，不保存完整 workflow status。
- [x] 4.4 保持 Coordinator Surface 不新增 agent-facing action input 字段或工具。

## 5. Workflow 工程交接

- [x] 5.1 新增 workflow action inputs 交接文档，说明 workflow 侧 protocol schema/docs/test 建议。
- [x] 5.2 在 `docs/AGENTS.md` 或相关索引中补充该交接文档入口。

## 6. Review 与收尾

- [x] 6.1 运行 `openspec validate harden-smoke-workflow-operator-debug --strict`。
- [x] 6.2 做静态确认和必要轻量命令验证，不特意执行单测。
- [x] 6.3 交给 `gpt-5.5 high` subagent review，检查 docs 总体设计心智、过度设计、协议偏离、分层污染和 agent surface/tools 复杂度。
- [x] 6.4 修复 review 必须项。
