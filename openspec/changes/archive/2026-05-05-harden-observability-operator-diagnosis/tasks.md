## 1. Core Operator Diagnosis

- [x] 1.1 为 task detail 增加 operator-only diagnosis 类型，覆盖 current blocker、operator attention、retry budget、operation ledger、recovery timeline、provider/protocol inspect 摘要。
- [x] 1.2 实现从已持久化 events / operations / entity records 派生 diagnosis 的 Core helper，确保 payload 白名单和摘要长度限制。
- [x] 1.3 补充 Core tests，验证 diagnosis 输出、只读语义和不泄漏 raw provider output、lock token、完整 operation JSON。

## 2. API / Web 展示

- [x] 2.1 确认 `GET /tasks/:taskId` 返回 diagnosis，并补充 API test。
- [x] 2.2 在 Web task detail 中展示 Diagnosis、Recovery timeline、Operation ledger、Provider/protocol inspect 摘要。
- [x] 2.3 调整 Web 样式，保持 operator 诊断信息可扫描、不与现有 panel 互相遮挡。

## 3. Surface Boundary / Validation

- [x] 3.1 补充测试，确认 diagnosis 存在时 Coordinator Surface 不新增 recovery/operator/internal tools。
- [x] 3.2 运行 OpenSpec validate、typecheck 和相关 test，修复问题。
- [x] 3.3 更新 `docs/roadmap.md` 与必要已落地事实，准备 review 和归档。
