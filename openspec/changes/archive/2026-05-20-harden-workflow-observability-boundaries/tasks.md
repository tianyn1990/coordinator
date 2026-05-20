## 1. OpenSpec 与设计边界

- [x] 1.1 对齐 `AGENTS.md`、`docs/AGENTS.md`、`docs/workflow-protocol.md`、`docs/daemon.md`、`docs/observability.md`、`docs/coordinator-surface.md`、`docs/agent-tools.md`。
- [x] 1.2 在 `docs/roadmap.md` 登记 Slice 12.7 的目标、边界和验收建议。
- [x] 1.3 创建本 change 的 proposal/design/tasks/spec delta。

## 2. 文档和规格 hardening

- [x] 2.1 更新 daemon/workflow protocol 文档，明确 running workflow inspect-only，workflow debug action hints 不驱动 daemon 自动 action。
- [x] 2.2 更新 observability 文档，说明 operator execution summary 和额外 artifact debug event。
- [x] 2.3 更新 OpenSpec specs，覆盖 inspect-only、surface 文案、artifact 使用纪律、operator summary。

## 3. Prompt 与 Surface 优化

- [x] 3.1 优化 Coordinator Agent prompt，约束 `coordinator-artifact` 使用时机。
- [x] 3.2 优化 running workflow surface 的 recommended next step / recovery / tool description。
- [x] 3.3 补充聚焦测试，确保 prompt 和 surface 行为符合边界。

## 4. Daemon artifact 可观测性

- [x] 4.1 在 daemon 中识别当前 tool 是否需要 artifact。
- [x] 4.2 当非 artifact tool 仍写入 artifact 时，记录窄 payload debug event。
- [x] 4.3 补充测试，确保 event 不记录 artifact 正文或复杂对象。

## 5. Operator execution summary

- [x] 5.1 新增 operator-only execution summary 派生能力。
- [x] 5.2 增加 CLI/API 或等价最小入口，便于 smoke/debug 查看分组摘要。
- [x] 5.3 补充测试，确保 summary 不触发外部 inspect、不进入 Coordinator Agent Surface。

## 6. Workflow action executor 边界记录

- [x] 6.1 在相关文档中记录：暂不新增 agent-facing workflow action tool，不让 daemon 自动执行 workflow action。
- [x] 6.2 若已有 operator-only workflow action 能力，明确它仍是 operator/debug，不是 daemon 自动推进路径。

## 7. 验证、Review 与收尾

- [x] 7.1 运行聚焦测试和 `openspec validate harden-workflow-observability-boundaries --strict`。
- [x] 7.2 执行 `pnpm --filter @coordinator/core build`。
- [x] 7.3 交给独立 `gpt-5.5 high` subagent review，检查 docs 总体设计心智、过度设计、协议偏离、分层污染和 agent surface/tools 复杂度。
- [x] 7.4 修复 review 必须项。
- [x] 7.5 归档 OpenSpec change，更新 `docs/roadmap.md` 开发进度和已落地事实。
- [x] 7.6 检查 git status 并提交本轮相关改动。
