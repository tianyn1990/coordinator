## 1. 设计与协议对齐

- [x] 1.1 读取并对齐 `AGENTS.md`、`docs/AGENTS.md`、`docs/daemon.md`、`docs/operations.md`、`docs/contracts.md`、`docs/observability.md`、`docs/coordinator-surface.md`、`docs/agent-tools.md`、`docs/execution-workspace.md`、`docs/workflow-protocol.md`。
- [x] 1.2 创建 `add-daemon-runtime` OpenSpec change 的 proposal、design、specs 和 tasks。
- [x] 1.3 明确 daemon 只做调度、探活、reconciliation、retry 和 human request 唤醒，不做业务语义判断。

## 2. daemon runtime 实现

- [x] 2.1 在 `packages/core` 新增 daemon runtime 模块与最小 loop 结构。
- [x] 2.2 实现 candidate 发现、tick 结果、claim / inspect / act 的最小流程。
- [x] 2.3 复用现有 surface、agent runtime、agent tools、workspace manager、workflow adapter 执行恢复动作。
- [x] 2.4 实现 stalled / retry_due / human_answered 的受控恢复逻辑。
- [x] 2.5 为 daemon 记录可观测事件和 operation 关联。

## 3. 入口与验证

- [x] 3.1 提供 CLI/API/operator 调试或启动入口（如需要），且不进入 Coordinator Surface。
- [x] 3.2 补充 daemon 单测与 contract test，覆盖调度、恢复、reconciliation、retry budget、human wake-up 和不越权行为。
- [x] 3.3 运行 `openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- [x] 3.4 交给独立 `gpt-5.5 high` subagent review，按 `docs/` 设计心智、过度设计、协议偏离、分层污染和复杂 JSON 暴露检查。
- [x] 3.5 修复 review 问题、重新 review，直到无必须修复项。
- [x] 3.6 归档 change，更新 roadmap 与必要设计文档，提交完整代码改动。
