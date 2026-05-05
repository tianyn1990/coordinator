## ADDED Requirements

### Requirement: recovery matrix 必须覆盖 PR/MR 与 merge observation

系统 SHALL 将 PR/MR、merge approval 和 merge operation observation 纳入 Core recovery matrix，并保持 `Observation -> Core RecoveryDecision -> Daemon Action`。

#### Scenario: PR/MR observation 进入 Core decision

- **WHEN** daemon 或 runtime 观察到 active PR/MR 需要恢复
- **THEN** daemon/runtime 只执行 read-only inspect
- **AND** Core 基于 PR/MR observation 返回 recovery decision

#### Scenario: merge operation observation 进入 Core decision

- **WHEN** merge operation 状态为 running、failed 或 unknown
- **THEN** 系统先 inspect 当前 PR/MR 外部状态
- **AND** Core 决定 retry、reconciled、unknown 或 operator attention

#### Scenario: daemon 不判断 review 或 merge readiness

- **WHEN** PR/MR review、approval 或 merge 状态发生变化
- **THEN** daemon 不直接判断 review 通过、业务完成或是否 merge
- **AND** daemon 只能记录 observation、调用 Core decision 或触发 Core 已允许的动作
