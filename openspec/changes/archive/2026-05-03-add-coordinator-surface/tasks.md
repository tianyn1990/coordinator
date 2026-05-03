# Tasks

- [x] 1. 新增 coordinator-surface OpenSpec 规格，覆盖 surface kind、双形态、tool visibility、artifact path、memory boundary。
- [x] 2. 在 `packages/core` 实现 surface types、tool visibility 推导和 Markdown renderer。
- [x] 3. 提供从当前 DB task/project 构建最小 surface 的 core 入口。
- [x] 4. 增加 CLI/API surface 查看入口，作为 operator 调试 surface，不作为 agent tool。
- [x] 5. 增加 fixture/tests 覆盖所有 surface kind、工具可见性、operator-only tool 排除、artifact root 规则。
- [x] 6. 运行 OpenSpec validate、typecheck、test、build。
- [x] 7. 交给独立 `gpt-5.5 high` subagent review，显式检查 docs 对齐、过度设计、协议漂移、分层污染、agent surface/tools 暴露复杂 JSON。
- [x] 8. 修复 review 必须项并复验。
- [x] 9. 归档 OpenSpec change，更新 roadmap 和落地事实，提交本轮改动。
