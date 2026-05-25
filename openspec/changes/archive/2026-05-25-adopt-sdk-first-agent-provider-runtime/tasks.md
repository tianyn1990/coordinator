## 1. SDK adapter shape

- [x] 1.1 调研并确认当前 `@openai/codex-sdk` 与 `@anthropic-ai/claude-agent-sdk` 的最小 TypeScript 调用面、session id、cwd、权限和 stream event 字段。
- [x] 1.2 为 `AgentProviderRunResult` 增加 provider session id、provider version、implementation mode、permission profile 与 raw event artifact ref 等统一 evidence 字段。
- [x] 1.3 增加 SDK adapter runner 抽象，使 tests 可注入 fake SDK runner，真实 runtime 可动态调用官方 SDK。

## 2. Provider implementation

- [x] 2.1 将 `CodexProvider` 默认改为 SDK-first，配置 sessionRoot cwd、read-only sandbox、never approval，并保留 CLI fallback。
- [x] 2.2 将 `ClaudeCodeProvider` 默认改为 SDK-first，配置 sessionRoot cwd、`dontAsk`/最小 tools，并保留 CLI fallback。
- [x] 2.3 将 SDK raw events 写入 transcript/provider events artifact，不进入 Coordinator Surface、Core 状态机或 agent tool 参数。
- [x] 2.4 记录 implementation mode、permission profile、provider session id 和 provider version 的窄摘要。

## 3. Tests

- [x] 3.1 更新 AgentProvider runtime tests，覆盖 Codex/Claude SDK-first 默认路径、CLI fallback、cwd 固定 sessionRoot、权限 profile 和 final response。
- [x] 3.2 增加 raw SDK event 不泄漏到 Surface/event payload 的回归测试。
- [x] 3.3 确认 CLI/API agent entrypoint 仍保持 operator-only，Coordinator Agent Surface 不新增 provider-specific tool 或 SDK raw event。

## 4. Docs / 验证 / Review

- [x] 4.1 更新必要 docs 与 roadmap，记录 Slice 14.2 已落地事实和本期不改 workflow protocol 的边界。
- [x] 4.2 运行相关 tests、typecheck、Core build 和 `openspec validate adopt-sdk-first-agent-provider-runtime --strict`。
- [x] 4.3 使用独立 subagent review，检查 docs 总体设计心智、是否过度设计、是否污染 Core/Daemon/Workflow protocol/AgentProvider 分层、是否错误让 SDK raw events 成为状态机或 Surface 真相。
- [x] 4.4 修复 must-fix 后归档 OpenSpec change，更新 `docs/roadmap.md`，提交本轮改动。
