## Context

系统已经有 Coordinator Surface、outer agent runtime、agent tools executor、workspace manager、workflow protocol adapter 和核心数据模型。缺失的是一个长运行 runtime，把这些能力按固定顺序持续推进、恢复和重试。

daemon 的职责必须保持窄：它是可靠运行时，不是 agent，也不是业务裁判。它只能基于数据库状态、surface snapshot 和外部状态做调度与恢复。

## Goals / Non-Goals

**Goals:**
- 提供最小 daemon loop，覆盖 scheduler、watchdog、reconciliation、retry 和 human request 唤醒。
- 复用现有 Core service，不重复实现 workspace、workflow、agent session 或 agent tool 逻辑。
- 使用 operation/lock/event 保证重复执行可恢复、可审计、可收敛。
- 为后续 UI 和命令行 daemon 启动留出入口。

**Non-Goals:**
- 不实现 PR/MR provider。
- 不实现 merge、review 驱动的自动推进。
- 不实现远程 worker。
- 不让 daemon 选择业务方案、workflow profile 或 review 结论。
- 不读写 workflow 私有状态。

## Decisions

1. **Daemon 采用单循环加分层子循环的结构**
   - 外层统一 tick，内部按 scheduler / watchdog / reconciliation / retry / human wake-up 分发。
   - 这样比做成通用 job graph 更符合当前有限有序 plan，也更容易在 SQLite 上恢复。

2. **Daemon 只消费已存在的 Core 接口**
   - 启动 outer agent session、执行 agent tool、启动/检查 workflow run、创建 attempt/workspace 都通过现有 service 完成。
   - daemon 不直接拼 SQL 写业务逻辑，避免绕过 Coordinator Core 的边界。

3. **将 daemon 视为状态驱动的恢复器，而不是事件驱动的聪明调度器**
   - 每次 tick 先从数据库读取候选，再基于 state_version、lock 和外部状态决定是否推进。
   - 这样能保留重启恢复能力，并避免 hidden memory。

4. **human request 唤醒与 retry 统一走受控恢复路径**
   - 对 human answered、retry_due、workflow handoff、stalled session 使用同一套 inspect -> claim -> act -> persist 模式。
   - 原因是这些路径都需要幂等、可重试和可观测，适合统一处理。

5. **本轮 daemon 不引入新复杂调度协议**
   - 先在代码内定义最小 tick/plan/result 结构。
   - 后续如需分布式调度、队列化或 remote worker，再独立扩展。

## Risks / Trade-offs

- [Risk] daemon 过早承担过多决策 → Mitigation: 固定限制 daemon 只做恢复、唤醒和状态推进，不做业务判断。
- [Risk] tick 逻辑膨胀成隐式流程引擎 → Mitigation: 复用现有 service，限制本轮只覆盖 P0 必要循环。
- [Risk] watchdog 误判 stalled → Mitigation: 明确 idle/waiting_human/waiting_review/waiting_merge_approval 不应直接判 stalled，先 inspect 再处理。
- [Risk] 重试放大副作用 → Mitigation: 保持 operation-first、lock fencing 和 retry budget，超过预算进入 handoff 或 human request。
