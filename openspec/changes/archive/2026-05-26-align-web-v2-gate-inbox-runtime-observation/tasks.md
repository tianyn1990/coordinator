## 1. Gate Projection

- [x] 1.1 扩展 Web V2 display model，定义统一的 Needs-Me gate projection 与 gate kind/reason，供 Command Bar、Run Matrix、Focus Drawer 共用。
- [x] 1.2 将 PR/MR review required/conflict、Core recovery attention、failed/unknown high-risk、operator-facing workflow gate、human request、merge approval 纳入同一 projection。
- [x] 1.3 确保 `materialize-change`、`run-alignment-checks`、inspect/resume、unknown/debug action 只进入 Workflow Lens / Debug Detail，不生成 needs-me pin 或 gate item。

## 2. Run Until Blocked 展示语义

- [x] 2.1 增加 observation-aware stop reason helper，区分 observing-runtime、waiting-operator-gate、handoff-ready、recovery-attention、terminal、no-candidate、max-ticks 和 failed。
- [x] 2.2 调整 task-scoped run banner，只展示当前 task 的 stop kind/reason 与本轮 tick 摘要。
- [x] 2.3 调整 global run banner，只展示全局 queue 摘要，不污染当前 Focus Drawer task owner/mode 或 blocker。
- [x] 2.4 保持 operator-facing workflow action 只通过 Focus Drawer gate panel 显式提交，run banner 不自动调用 workflow action endpoint。

## 3. UI 与测试

- [x] 3.1 更新 Run Matrix / Focus Drawer 文案与短标签，让 owner/mode 与 stop reason 使用同一套 projection，避免旧 Action Inbox / Task Cockpit 术语。
- [x] 3.2 补充 Web model tests：internal action 不进 Needs-Me、operator gate 进 Needs-Me、PR review/conflict 进 Needs-Me、普通 open PR 不进 Needs-Me。
- [x] 3.3 补充 run-until-blocked stop reason tests：observing runtime、operator gate、handoff ready、recovery attention、global no-candidate/max-ticks。

## 4. 验证、review 与收尾

- [x] 4.1 运行 `openspec validate align-web-v2-gate-inbox-runtime-observation --strict`、`openspec validate --all --strict`、`pnpm --filter @coordinator/web build`、`pnpm typecheck` 和相关 tests。
- [x] 4.2 使用浏览器或等价截图验证桌面视口的 Run Matrix / Focus Drawer / banner 无明显重叠或旧页面回退。
- [x] 4.3 交给独立 subagent review，明确检查 docs 总体设计、过度设计、Core/Daemon/Workflow protocol/AgentProvider/Web 分层污染、daemon/outer Agent 自动 workflow action、raw provider events 或 workflow debug 字段是否变成新状态机。
- [x] 4.4 修复 review 必须修复项后归档 OpenSpec change，更新 `docs/roadmap.md` 进度记录并提交。
