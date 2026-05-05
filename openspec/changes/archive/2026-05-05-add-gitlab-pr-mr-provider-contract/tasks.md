## 1. OpenSpec 与设计对齐

- [x] 1.1 创建 `add-gitlab-pr-mr-provider-contract` proposal、design、spec delta 和 tasks。
- [x] 1.2 运行 `openspec validate add-gitlab-pr-mr-provider-contract --strict`，确认规格可归档。

## 2. GitLab PR/MR Provider Contract

- [x] 2.1 补强 `CliPullRequestProvider` 的 GitLab 命令参数，确保 `glab mr list/view/update/merge` 使用官方 JSON/非交互窄参数。
- [x] 2.2 补强 GitLab JSON 解析，覆盖 source/target branch、web_url、iid/id、sha、merge_status、detailed_merge_status、blocking_discussions_resolved 等有限 external fact。
- [x] 2.3 确保 GitLab provider failure/malformed output 不被当成 absent 或成功，不向 event/surface 泄漏 raw output。

## 3. 测试

- [x] 3.1 增加 GitLab inspect-before-create 和 create 命令形态 contract tests。
- [x] 3.2 增加 GitLab update、inspect review、merge after approval 命令形态与解析 tests。
- [x] 3.3 增加 GitLab malformed inspect 输出阻断 create 的回归测试。
- [x] 3.4 运行本轮相关测试、typecheck、build 和 OpenSpec validate。

## 4. Review 与收尾

- [x] 4.1 交给独立 `gpt-5.5 high` subagent review，显式检查 docs 设计心智、过度设计、协议偏离、分层污染、agent surface/tools 暴露。
- [x] 4.2 修复 review 必须修复项，并循环复审到无 must-fix。
- [x] 4.3 归档 OpenSpec change，更新 roadmap/相关文档已落地事实。
- [x] 4.4 检查 `git status` 后提交本轮改动。
