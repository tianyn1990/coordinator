## ADDED Requirements

### Requirement: daemon watchdog 只能把 agent lifecycle signal 用作 observation

系统 SHALL 允许 daemon/watchdog 使用 agent session status、last activity time、latest normalized event 和 failure kind 做 stalled/no-progress observation，并将 observation 交给 Core recovery service。daemon MUST NOT 让 raw 或 normalized provider event 直接驱动业务完成、workflow handoff、PR/MR readiness、merge 或 workflow action。

#### Scenario: active agent session 有最近活动

- **WHEN** daemon inspect active agent session
- **AND** agent lifecycle signal 显示 last activity 尚未超过 stalled threshold
- **THEN** daemon 记录观察或 no-op
- **AND** daemon 不启动重复 Coordinator Agent session

#### Scenario: agent session 无进展

- **WHEN** daemon inspect active agent session
- **AND** lifecycle signal 显示超过 stalled threshold 或 provider failure kind 可见
- **THEN** daemon 将窄 observation 交给 Core recovery service
- **AND** recovery decision event 不包含 raw provider output、完整 transcript 或 permission internals

#### Scenario: provider event 不触发业务推进

- **WHEN** normalized agent event 表示文件变更、命令完成、模型输出或工具调用完成
- **THEN** daemon 不因此标记 task done、PR ready、merge ready 或 workflow handoff
- **AND** 后续推进仍依赖 Coordinator Agent final response、Core tool executor、workflow protocol handoff 或 human gate

