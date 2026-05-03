## 1. DB 与 Core Provider

- [x] 1.1 新增 DB migration，补齐 PR/MR review 与 merge approval snapshot 所需字段或表，并保持已有数据兼容。
- [x] 1.2 在 `packages/db` 增加 pull request、review snapshot、merge approval 相关 repository 方法和类型。
- [x] 1.3 新增 `packages/core/src/pr-mr-provider.ts`，定义 `PullRequestProvider`、CLI provider、fake provider 和错误类型。
- [x] 1.4 实现 create/update/inspect review/request approval/operator approve/reject/merge Core service，遵守 operation-first、inspect-before-create 和 merge approval gate。

## 2. Surface 与 Agent Tools

- [x] 2.1 更新 `buildTaskSurfaceFromDb` 和 surface rendering，把当前 PR/MR、review summary、merge approval snapshot 翻译为 agent-readable 摘要。
- [x] 2.2 更新 tool visibility：`pr_ready` 暴露 `create_pr`，open PR 暴露 `inspect_review`/`update_pr`，approval valid 才暴露 `merge_after_approval`。
- [x] 2.3 更新 `executeCoordinatorAgentTool`，实现 `create_pr`、`update_pr`、`inspect_review`、`request_merge_approval`、`merge_after_approval`，保持窄参数和 sanitized result。

## 3. CLI/API Operator Entrypoints

- [x] 3.1 新增 CLI `pr` 子命令，用于 operator-only create/update/inspect-review/request-approval/approve/reject/merge 调试。
- [x] 3.2 新增 API operator-only endpoints，覆盖 PR/MR create/update/inspect-review/request-approval/approve/reject/merge。

## 4. Tests 与验证

- [x] 4.1 为 DB migration/repository 增加 tests，覆盖 active merge operation、approval snapshot 和 PR/MR record。
- [x] 4.2 为 PR/MR provider 和 Core service 增加 contract tests，覆盖 fake provider、CLI command shape、idempotency、inspect-before-create、merge approval invalidation。
- [x] 4.3 为 surface/tools 增加 tests，覆盖工具可见性、artifact path、安全 result、operator-only 工具不进入 surface。
- [x] 4.4 为 CLI/API 增加 tests，覆盖 operator-only 入口和受控错误。
- [x] 4.5 运行 `openspec validate --all --strict`、`pnpm test`、`pnpm typecheck`、`pnpm build`。

## 5. 收尾

- [x] 5.1 根据落地事实更新 `docs/roadmap.md`、`docs/contracts.md`、`docs/agent-tools.md`、`docs/project-registry.md` 或其他必要设计文档；若发现设计边界需要改变，先暂停与用户确认。
- [x] 5.2 完成独立 `gpt-5.5 high` subagent review，并按固定动作修复到没有必须修复项。
- [x] 5.3 归档 OpenSpec change 并提交本轮改动。
