## 1. Core recovery model

- [x] 1.1 新增 workspace/lock/fencing observation 与 decision 类型，保持 payload 窄字段。
- [x] 1.2 实现 Core decision：workspace safe/no-op、missing、branch mismatch、dirty unknown、manifest mismatch、path escape、expired lock safe release、expired lock blocked/operator attention。
- [x] 1.3 扩展 recovery decision persistence，使 lock release 和 recovery event 可同事务提交，且不泄漏 lock token。

## 2. Workspace inspect 与 fencing

- [x] 2.1 为 Workspace Manager 增加只读 recovery inspect，覆盖 workspace path、repo path、coordinator path、artifact root、git worktree、branch、git status、ownership manifest、checkpoint。
- [x] 2.2 保持 path fail-fast：path 风险后不继续 git/manifest/checkpoint 检查。
- [x] 2.3 增加 lock leaseVersion release 能力和 stale token fencing 测试。

## 3. Daemon reconciliation

- [x] 3.1 daemon tick 接入 active workspace recovery inspect，并将 observation 交给 Core decision。
- [x] 3.2 daemon tick 接入 expired lock inspect-before-release，release 前校验 lock token 和 leaseVersion 仍匹配。
- [x] 3.3 确认 paused/canceled/waiting gate 下 workspace/lock recovery 只做 safe inspect 或 operator attention，不启动 agent 或副作用。

## 4. Tests and contracts

- [x] 4.1 增加 workspace manager tests：workspace path missing、branch mismatch、dirty unknown、manifest mismatch、path escape fail-fast、stale lock token rejected。
- [x] 4.2 增加 daemon/recovery tests：expired lock reconcile-before-release、owner active 不释放、resource unsafe 不释放、leaseVersion changed 不释放、event payload 不泄漏内部字段。
- [x] 4.3 增加 surface/tools 回归测试，确认不新增 workspace/lock recovery agent tool，不泄漏 lock/lease/manifest 内部字段。

## 5. Verification and docs

- [x] 5.1 运行本轮 targeted tests、typecheck、OpenSpec strict validate。
- [x] 5.2 更新 `docs/roadmap.md` 与相关专题文档中的已落地事实。
- [x] 5.3 归档 OpenSpec change，并运行全量测试、build 和 strict validation。
