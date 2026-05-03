# Research Notes

> 状态：初始调研记录  
> 适用范围：记录 `coordinator` 设计过程中参考过的外部资料、可吸收点、不应吸收点，防止未来遗忘或误吸收。

## 1. 文档定位

本文档不是运行时契约。

它用于记录：

- 参考来源。
- 核心启发。
- 可吸收设计。
- 不应吸收的部分。
- 对本项目文档和实现的影响。

## 2. OpenAI Symphony

来源：

- https://github.com/openai/symphony
- https://github.com/openai/symphony/blob/main/SPEC.md
- https://openai.com/index/open-source-codex-orchestration-symphony/

核心启发：

- issue/task tracker 可以成为 agent 工作控制面。
- orchestration 应有长运行 daemon。
- 每个 issue/task 使用隔离 workspace。
- scheduler 需要 bounded concurrency。
- active runs 需要 reconciliation。
- transient failure 需要 retry/backoff。
- operator 需要 structured observability。
- workflow policy 应随 repo 版本化。

吸收：

- task -> workspace -> agent session -> workflow run -> handoff/review。
- daemon/retry/reconcile。
- workspace isolation。
- structured event。

不吸收：

- Linear-first 绑定。
- 高信任默认。
- 让 agent 无审计地直接写外部状态。
- 把 Symphony Elixir prototype 当实现模板。

## 3. OpenAI Harness Engineering

来源：

- https://openai.com/index/harness-engineering/

核心启发：

- 好的 harness 比大 prompt 更重要。
- repo-local docs/tests/skills/validation 是 agent 成功关键。
- agent 看不到的上下文等于不存在。

吸收：

- Coordinator Surface。
- artifact-first。
- validation/report artifact。
- workflow protocol 明确边界。

## 4. OpenHands

来源：

- https://github.com/All-Hands-AI/OpenHands

核心启发：

- issue/PR resolver。
- sandbox。
- GUI / local control surface。
- feedback loop。

吸收：

- Web control surface。
- workspace sandbox 思想。
- review/rework loop。

不吸收：

- 将 provider/runtime 形态作为 coordinator core。
- 直接复刻产品结构。

## 5. SWE-agent

来源：

- https://github.com/SWE-agent/SWE-agent

核心启发：

- agent-computer interface 很重要。
- 工具边界影响 agent 解决问题能力。

吸收：

- tools 要少而清晰。
- command/action feedback 要具体。

不吸收：

- benchmark-first 架构。
- 将它作为外层 coordinator。

## 6. aider / OpenCode / Gemini CLI / Qwen Code

来源：

- https://github.com/Aider-AI/aider
- https://github.com/sst/opencode 或相关 OpenCode 项目
- https://github.com/google-gemini/gemini-cli
- https://github.com/QwenLM/qwen-code

核心启发：

- coding agent provider 生态会持续变化。
- provider 应是 adapter，不是 core。

吸收：

- AgentProvider abstraction。
- provider capability tags。

不吸收：

- 让 provider 决定 task lifecycle。

## 7. LangGraph / AutoGen / CrewAI / MetaGPT

来源：

- https://github.com/langchain-ai/langgraph
- https://github.com/microsoft/autogen
- https://github.com/crewAIInc/crewAI
- https://github.com/FoundationAgents/MetaGPT

核心启发：

- durable execution、checkpoint、human interrupt、trace 有价值。
- 多 agent runtime 有成熟概念。

吸收：

- checkpoint / resume。
- human interrupt。
- trace / event。

不吸收：

- 通用 DAG engine。
- persona role framework。
- 多 agent role 固化到 coordinator core。

## 8. oh-my-openagent

来源：

- https://github.com/code-yeongyu/oh-my-openagent

核心启发：

- 多模型/多角色调度。
- session continuity。
- notepad / learnings。
- category -> provider/model 路由。

吸收：

- provider routing policy 用 capability/tag，而不是品牌语义。
- continuation artifact。
- accumulated learnings 作为 artifact。

不吸收：

- named agents / category matrix 作为 core。
- prompt 魔法或插件生态假设。
- hash edit 作为 coordinator 核心抽象。

## 9. compound-engineering-plugin

来源：

- https://github.com/EveryInc/compound-engineering-plugin

核心启发：

- brainstorm -> plan -> work -> review -> compound。
- strategy / review / long-term learning。
- 知识复利。

吸收：

- review summary artifact。
- project strategy context 作为可选 artifact。
- compound memory 必须 artifact-first。

不吸收：

- 大量 skills/agents 作为 coordinator core。
- 产品战略/创意 persona 与 runtime 耦合。

## 10. gstack

来源：

- https://github.com/garrytan/gstack

核心启发：

- checkpoint。
- review/qa/ship 分离。
- learn/memory。
- browser QA / release automation。

吸收：

- checkpoint event。
- review/QA/merge readiness artifact。
- memory trust boundary。

不吸收：

- CEO/Founder/Designer persona workflow。
- 跨项目共享记忆作为默认。
- 自动修复 review/QA 后直接 merge。

## 11. Anthropic Long-running Harness

来源：

- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://www.anthropic.com/engineering/harness-design-long-running-apps

核心启发：

- 长任务关键是 durable handoff artifacts，不只是 context compaction。
- initializer 与 coder 分工。
- 每次 resume 先读进度、检查 git、跑 smoke test。
- planner/generator/evaluator 可以分离，但不必固化成核心角色。

吸收：

- resume preflight。
- handoff.md / remaining-work.md / verification.md。
- smoke-check。
- evaluator/review 作为可选模式。

不吸收：

- 固定 planner/generator/evaluator 三角色。
- 默认 context reset。
- evaluator DAG。

## 12. 当前设计结论

应坚持：

- coordinator/workflow 边界。
- Coordinator Surface。
- daemon/reconcile/retry。
- operation/idempotency。
- artifact-first。
- human/merge gate。
- provider adapter。

应避免：

- 通用 DAG。
- persona role system。
- hidden memory。
- 高信任自动 merge。
- 复杂 JSON 工具参数。
- provider-branding 驱动业务语义。

