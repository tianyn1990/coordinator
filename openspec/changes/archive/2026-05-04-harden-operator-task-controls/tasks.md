## 1. Core Runtime

- [x] 1.1 新增 operator task control Core runtime，覆盖 pause、resume、cancel、retry 的输入校验、CAS、状态迁移和 event。
- [x] 1.2 让 retry event 携带 dueAt，并对齐 daemon 现有 retry due 查询语义。
- [x] 1.3 导出 task control 类型和 runtime，保持 operator-only 边界。

## 2. API / CLI / Web

- [x] 2.1 新增 API task control endpoint，并统一错误映射。
- [x] 2.2 新增 CLI task control 命令，输出更新后的 task 状态。
- [x] 2.3 在 Web task detail 增加 pause/resume/cancel/retry 操作区，成功后刷新 detail 和 timeline。

## 3. Daemon / Surface Boundary

- [x] 3.1 补强 daemon 对 paused/canceled task 的跳过测试。
- [x] 3.2 补强 Coordinator Surface 不暴露 pause/resume/cancel/retry operator-only tools 的测试。

## 4. Verification

- [x] 4.1 补充 Core/API/CLI/Web 单测或 contract test。
- [x] 4.2 运行 `openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- [x] 4.3 交给独立 `gpt-5.5 high` subagent review，并按固定动作修复到无必须修复项。
