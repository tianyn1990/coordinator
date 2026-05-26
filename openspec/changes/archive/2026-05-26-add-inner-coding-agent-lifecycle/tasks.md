## 1. Core Agent Runtime

- [x] 1.1 增加 role-aware provider permission profile，Codex/Claude outer 继续最小权限，inner 使用 workspace repo 可编辑权限且不使用危险 bypass。
- [x] 1.2 实现 `runInnerCodingAgentSession`，在 ready workspace repo 中创建 `role=inner` session、operation、workspace lock 和 session artifacts。
- [x] 1.3 生成 inner coding agent 专用 prompt/context，包含 task/workspace/workflow run 摘要和 gate evidence 输出要求，禁止 `.workflow` private state 与自动 human gate。
- [x] 1.4 导出 inner runtime 类型/API，并确保 outer runtime 行为和 existing tests 不回归。

## 2. Daemon Lifecycle

- [x] 2.1 在 daemon tick 中识别 active workflow run + ready workspace + 缺少 ready evidence + 无 active inner session 的场景。
- [x] 2.2 由 daemon 启动 inner coding agent session，并用稳定 operation key 防止同一 workflow state/action boundary 重复运行。
- [x] 2.3 inner session 完成后执行 workflow protocol status inspect，刷新 workflow projection，但不自动调用 workflow action。
- [x] 2.4 扩展 watchdog / active owner 判断，覆盖 active inner agent session，避免 lock/recovery 误释放或重复推进。

## 3. Operator/Web Surface

- [x] 3.1 确保 operator task detail / execution summary 返回 inner session role、activity、final response artifact refs。
- [x] 3.2 小幅更新 Web V2 Agent Activity / gate evidence 展示，区分 inner evidence 与 outer coordinator activity，不扩大 Workflow Action Panel。
- [x] 3.3 更新 docs/roadmap 和相关 docs，记录 Iteration 17 目标、已落地事实和本期不改 workflow protocol 的边界。

## 4. Tests

- [x] 4.1 补 Core AgentProvider tests：inner cwd 为 workspace repo、permission profile role-aware、prompt/context 边界、outer cwd 不回归。
- [x] 4.2 补 daemon tests：缺 evidence 启动 inner、active inner 不重复、ready evidence 不自动确认、inner 后 inspect workflow、active workflow dirty workspace defer、internal action 不被旧 evidence 阻断、无 provider 不变成 action queue。
- [x] 4.3 补 evidence/operator/Web model tests：inner final response 形成 ready evidence，internal action 不进 needs-me，inner activity 可见。

## 5. 验证、Review 与收尾

- [x] 5.1 运行 `openspec validate add-inner-coding-agent-lifecycle --strict`、相关 tests、`pnpm typecheck` 和必要 build。
- [x] 5.2 使用真实 Web/task flow 尽量走到最远：启动 workflow 后让 inner agent 生成 gate evidence，确认页面不再盲确认。
- [x] 5.3 使用独立 subagent review，明确检查 docs 总体设计、过度设计、Core/Daemon/Workflow protocol/AgentProvider/Web 分层污染、daemon/outer Agent 自动 workflow action、raw provider events/hidden reasoning 是否变成状态机或 Surface。
- [x] 5.4 修复 review 必须修复项后归档 OpenSpec change，更新 `docs/roadmap.md` 进度记录并提交。
