## 1. PR/MR 外部事实与 failure 分类

- [x] 1.1 扩展 PR/MR provider inspect 类型，表达 absent/open/closed_unmerged/merged/unknown 等有限外部事实。
- [x] 1.2 扩展 Fake/CLI provider 映射与 parse helper，确保 malformed output 不被当作 absent、clean 或 merged。
- [x] 1.3 增加 provider failure 分类 helper，覆盖 timeout、rate_limited、auth_missing、conflict、malformed_output、unknown。

## 2. Core recovery 与 approval invalidation

- [x] 2.1 在 Core recovery decision 中增加 PR/MR 与 merge observation 分支，保持 daemon/runtime 只消费有限 decision。
- [x] 2.2 抽出 PR/MR snapshot 刷新与 approval invalidation helper，供 inspect review、request approval、merge 前 inspect 和 recovery 使用。
- [x] 2.3 补强 create PR inspect-before-create：matches intent 复用，conflicts intent 进入 unknown/operator attention。
- [x] 2.4 补强 merge_after_approval：merge race 可 reconcile，merge conflict/auth_missing/rate_limited/timeout 分类收口，失败后释放 PR merge lock。

## 3. Daemon/runtime 对账入口

- [x] 3.1 增加 active PR/MR 或 active merge operation 的 read-only inspect/reconcile 入口，不让 daemon 判断 review pass/fail 或业务 completed。
- [x] 3.2 确保 recovery event payload 保持窄字段，不包含 provider raw output、完整 operation、完整 approval object 或复杂 JSON。

## 4. 测试与 surface 边界

- [x] 4.1 增加 contract/unit tests 覆盖 PR already exists matches intent、external conflicts intent、closed/unmerged、already merged、approval invalidated。
- [x] 4.2 增加 merge race、merge conflict、timeout/rate_limited/auth_missing/malformed output 分类测试。
- [x] 4.3 增加 surface/recovery tests，确认没有新增 PR/MR recovery agent tool，且不暴露 provider raw output 或内部恢复对象。

## 5. 验证与收尾

- [ ] 5.1 运行 `openspec validate --all --strict`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check`。
- [ ] 5.2 交给独立 `gpt-5.5 high` subagent review，并显式检查设计心智、过度设计、协议偏离、分层污染和 agent surface/tools 复杂度。
- [ ] 5.3 修复合理 review 问题并复审到无必须修复项。
- [ ] 5.4 归档 OpenSpec change，更新 `docs/roadmap.md` 和相关专题文档的已落地事实。
- [ ] 5.5 检查 `git status`，只提交本轮相关改动。
