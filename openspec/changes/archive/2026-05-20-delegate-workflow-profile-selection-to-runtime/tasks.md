## 1. OpenSpec 与设计边界

- [x] 1.1 对齐 `AGENTS.md`、`docs/AGENTS.md`、`docs/workflow-protocol.md`、`docs/coordinator-surface.md`、`docs/agent-tools.md`、`docs/contracts.md`、`docs/daemon.md`。
- [x] 1.2 在 `docs/roadmap.md` 登记 Slice 12.8 的目标、边界和验收建议。
- [x] 1.3 创建并验证本 change 的 proposal/design/spec delta/tasks。

## 2. 文档与规格同步

- [x] 2.1 更新 workflow protocol 文档，说明 omitted/default/auto 表示 runtime auto selection，human explicit selection 只由人类入口提供。
- [x] 2.2 更新 Coordinator Surface 与 Agent Tools 文档，明确 outer Agent 不选择 workflow profile。
- [x] 2.3 更新 contracts/daemon 相关边界文档，保持 daemon 不选择 profile、不执行 workflow action。

## 3. Core 数据模型与 Repository

- [x] 3.1 为 workflow run 或 task metadata 增加 requested selection 与 actual profile 持久化字段，保持旧数据兼容。
- [x] 3.2 更新 repository 读写、timeline/operator summary 和 migration 测试。
- [x] 3.3 确保 `default/auto` 不会被保存为 actual profile。

## 4. Workflow Protocol Adapter

- [x] 4.1 引入 workflow selection model，支持 runtime auto 与 human explicit selection。
- [x] 4.2 调整 workflow start operation idempotency key，从 profile-id 迁移到 selection key。
- [x] 4.3 支持 omitted/default/auto start；如果 workflow runtime 不支持，返回受控错误，不 fallback 猜 profile。
- [x] 4.4 持久化 workflow 返回的 actual profile，并在 status reconcile 中检查 actual profile consistency。

## 5. Agent Surface 与 Agent Tools

- [x] 5.1 修改 workspace ready surface，使 `start_workflow_run` 不要求 agent 传 profile。
- [x] 5.2 修改 agent tool executor，拒绝 outer Agent 传入具体 profile 或不把它当作 human explicit selection。
- [x] 5.3 更新 daemon tool block parser 相关测试，确保真实 outer Agent profile-less start 可执行。

## 6. Operator 入口

- [x] 6.1 更新 CLI/API workflow start 调试入口，profile 参数变成 optional operator/human explicit selection。
- [x] 6.2 如 Web/manual task 创建已支持 workflow selection，确保它作为 human explicit input 保存；如尚未支持，保留清晰扩展点。
- [x] 6.3 更新 operator summary 展示 requested selection 与 actual profile。

## 7. 验证、Review 与收尾

- [x] 7.1 运行 OpenSpec strict validation。
- [x] 7.2 运行相关 unit/contract tests、typecheck、build。
- [x] 7.3 修改 `packages/core/src` 后执行 `pnpm --filter @coordinator/core build`、`pnpm --filter @coordinator/cli build`、`pnpm --filter @coordinator/api build`，并记录 API 需要重启。
- [x] 7.4 进行真实 smoke：outer Agent 通过 daemon tick 启动 workflow 时不手动触发 profile 选择；能走多远走多远。
- [x] 7.5 交给独立 `gpt-5.5 high` subagent review，检查 docs 总体设计心智、过度设计、协议偏离、分层污染和 agent surface/tools 复杂度。
- [x] 7.6 修复 review 必须项，归档 OpenSpec change，更新 roadmap 已落地事实并提交。
