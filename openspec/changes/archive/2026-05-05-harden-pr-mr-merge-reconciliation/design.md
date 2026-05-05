## Context

当前 PR/MR runtime 已经能创建、更新、inspect review、请求 merge approval、operator approve/reject，并在 approval 有效后执行默认 squash merge。Iteration 12.2 和 12.3 已经把 daemon 恢复路径收敛为 `Observation -> Core RecoveryDecision -> Daemon Action`，并把 workspace/lock/fencing 恢复做成 Core-owned 决策。

本轮延续同一心智：PR/MR provider 只做外部事实观察和外部副作用执行；`Coordinator Core` 负责状态机、approval snapshot、operation/idempotency、merge policy、recovery decision 和 event。daemon 只负责 runtime tick、read-only inspect、调用 Core decision，并执行 Core 允许的有限动作。

## Goals / Non-Goals

**Goals:**

- 为 PR/MR 与 merge 增加 provider-specific reconciliation，但恢复策略仍由 Core 拥有。
- 覆盖 PR already exists、external conflicts intent、closed/unmerged、already merged、merge race、merge conflict、approval invalidated、provider timeout/rate-limit/auth_missing 分类。
- 在 merge 前和 recovery inspect 中统一刷新 PR/MR snapshot，并在 head/base/validation/review/strategy 改变时失效 pending/approved approval。
- 继续保证 merge 只有在显式 human approval 且 snapshot 有效时执行。
- 保持 Coordinator Surface 窄可见，不暴露 provider raw output、lock token、完整 operation、完整 approval 对象或复杂 JSON。

**Non-Goals:**

- 不实现通用 PR/MR state machine DSL。
- 不让 daemon 判断 review 通过、业务完成或是否该 merge。
- 不自动绕过 merge conflict；conflict 只进入 blocked/future conflict-resolution path。
- 不新增 agent-facing recovery tools，也不扩大 agent tool 参数为复杂 JSON。
- 不引入新的外部依赖或远程 worker/fleet 状态机。

## Decisions

### 1. 用外部事实模型承载 provider 观察

新增或扩展 PR/MR provider 的 inspect 结果，表达有限外部事实：

- `state`: `absent` / `open` / `closed_unmerged` / `merged` / `unknown`
- `externalId`、`url`
- `headBranch`、`baseBranch`
- `headSha`、`baseSha`
- `reviewStatus`、`reviewSummary`
- `validationRunId`
- `mergeable`

provider adapter 只负责把 GitHub/GitLab/Fake 的输出映射到这些事实。它不判断 approval 是否失效、不决定是否 merge、不决定是否 human handoff。

原因：这符合 `Coordinator Core` 作为唯一状态机和策略校验者的边界，也避免 provider-specific 逻辑污染 Core 状态机。

### 2. Core-owned PR/MR recovery decision

在 `recovery-decision.ts` 中增加 PR/MR recovery observation/decision。输入是 DB 中的 PR/MR 期望状态、相关 operation、外部事实和 retry/failure 分类；输出仍是有限 `RecoveryDecision`。

主要决策：

- open same head/base：no-op 或 mark reconciled。
- head/base/validation/review 变化：刷新 PR/MR snapshot，并失效不匹配的 approval。
- closed/unmerged：operator attention，不自动 completed。
- merged：reconcile 为 merged/completed，但必须记录 event；若来自 merge operation race，则 operation reconciled。
- conflict：operator attention 或 blocked，为 future conflict-resolution 留入口。
- provider timeout/rate-limit：可按 retry budget retry；auth_missing 不自动 retry。
- provider raw/malformed：unknown/operator attention，不继续 create/merge。

原因：PR/MR 是外部协作对象，外部变化可能来自 human 或平台自动化。Core 必须把“观察到的事实”和“允许的推进”拆开。

### 3. Inspect-before-create/merge 继续保守

`create_pr` 已有 inspect-before-create，本轮补强 conflict intent：

- 如果 inspect 到 matching head/base 的 PR/MR，复用并 `reconciled`。
- 如果 inspect 到同 head 但 base/status/identity 与 intent 冲突，operation 进入 `unknown` 或 operator attention，不继续 create。
- inspect 失败或输出 malformed 不当作 absent。

`merge_after_approval` 继续先 claim PR merge lock，再 inspect 最新 PR/MR snapshot，刷新 DB，校验 approval，然后 merge。merge provider 成功后仍要 reconcile result；merge provider 报 conflict/race/timeout/auth_missing 时按分类收口。

### 4. Approval invalidation 是 Core 行为

新增共享 helper，使所有会刷新 PR/MR snapshot 的路径都能失效不匹配的 pending/approved approval：

- `inspect_review`
- `request_merge_approval`
- `merge_after_approval` 的 merge 前 inspect
- daemon PR/MR recovery inspect

失效旧 approval 时只写窄事件和 snapshot 摘要，不把完整 human request 或 provider raw output 暴露给 agent。

### 5. daemon 只执行 read-only inspect 和 Core 允许动作

daemon 可以扫描 active PR/MR 或 active merge operation，并调用 provider inspect 获得外部事实；然后交给 Core decision。daemon 不选择 merge，不判断 review 是否 pass，不自动将 closed/unmerged 当作 done。

第一版实现可先把 PR/MR recovery 集成到现有 runtime/test 中，保持有限扫描和窄 event。后续 Slice 12.6 再把 operator UI 诊断视图补得更完整。

## Risks / Trade-offs

- [Risk] provider CLI 输出在 GitHub/GitLab 间差异大，容易误判外部状态 → Mitigation：adapter 映射只产出有限外部事实；malformed/unclear 进入 unknown，不当作 absent 或 merged。
- [Risk] 已有 approval 在 snapshot 刷新后未及时失效 → Mitigation：抽出共享 invalidation helper，并用 inspect/review/merge/recovery tests 覆盖。
- [Risk] merge race 中 provider 返回成功但 DB 未落地 → Mitigation：merge operation replay 通过 inspect 看到 merged 后可标记 reconciled 并推进 completed。
- [Risk] recovery 逻辑扩展为隐式状态机 → Mitigation：只增加有限 decision branch，不引入 DSL/DAG，不扩大 daemon 业务判断。
- [Risk] agent surface 泄漏过多 provider/recovery 细节 → Mitigation：测试断言 surface 不暴露 provider raw output、operation replay、approval 原始对象或复杂 JSON。
