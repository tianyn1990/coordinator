## ADDED Requirements

### Requirement: AgentProvider runtime 必须优先使用 SDK adapter

系统 SHALL 将 `codex` 和 `claude-code` outer AgentProvider 的主路径实现为 SDK-first adapter，并保留 CLI subprocess compatibility fallback。SDK-first adapter MUST 继续实现统一 `AgentProvider` interface，Core/daemon/API/CLI 不得依赖 provider-specific SDK 类型或 provider private session 文件。

#### Scenario: Codex provider 默认使用 SDK-first adapter

- **WHEN** runtime 创建 `codex` provider
- **AND** Codex SDK adapter 可用
- **THEN** provider 通过 SDK adapter 启动 outer Coordinator Agent session
- **AND** provider result 记录 implementation mode 为 `sdk`
- **AND** provider cwd 指向 sessionRoot，不指向 project repo 或 workspace repo

#### Scenario: Claude Code provider 默认使用 SDK-first adapter

- **WHEN** runtime 创建 `claude-code` provider
- **AND** Claude Agent SDK adapter 可用
- **THEN** provider 通过 SDK adapter 启动 outer Coordinator Agent session
- **AND** provider result 记录 implementation mode 为 `sdk`
- **AND** provider cwd 指向 sessionRoot，不指向 project repo 或 workspace repo

#### Scenario: SDK unavailable 时受控 fallback

- **WHEN** SDK 模块、provider auth 或本地 runtime 不可用
- **THEN** provider MAY 使用 CLI compatibility fallback
- **AND** fallback MUST 继续使用最小权限、sessionRoot cwd、prompt stdin 和窄参数
- **AND** provider result 记录 implementation mode 为 `cli-fallback`

### Requirement: Provider SDK raw events 必须只进入 artifact

系统 SHALL 将 SDK raw events、SDK stream items、provider stdout/stderr 摘要和 provider private session 线索视为排查证据，而不是 Core 状态机真相源。raw event MUST 写入 transcript 或 provider events artifact；Coordinator Surface、agent tool 参数、daemon recovery decision 和 Core task 状态不得直接消费 raw SDK event。

#### Scenario: raw event 写入 transcript artifact

- **WHEN** SDK adapter 返回 raw provider events
- **THEN** runtime 将 sanitized raw event 写入 session transcript 或 provider events artifact
- **AND** agent session completed event 只引用 artifact path 和窄摘要
- **AND** event payload 不包含完整 raw JSONL、provider private session 文件路径或 permission internals

#### Scenario: Surface 不暴露 SDK raw event

- **WHEN** 后续 Coordinator Surface 包含 agent session 信息
- **THEN** Surface MAY 展示 provider id、session status、artifact refs 和短摘要
- **AND** Surface MUST NOT 内联 SDK raw event、完整 transcript、provider private session path 或 permission object

### Requirement: Outer provider permission profile 必须保持 decision-only

系统 SHALL 为 outer Coordinator Agent SDK session 使用最小权限 profile。Codex SDK session MUST 使用 read-only sandbox 与 never approval 等价语义；Claude Agent SDK session MUST 使用 `dontAsk` 或更严格 permission mode，并禁用或最小化 tools。任何 SDK adapter 都不得把 cwd 指向 project repo 或 workspace repo 的 `repo/` 目录。

#### Scenario: Codex SDK 权限最小化

- **WHEN** Codex SDK adapter 启动 outer session
- **THEN** adapter 配置 read-only sandbox
- **AND** adapter 配置 never approval 或等价非交互策略
- **AND** adapter 不授予 repo write 权限

#### Scenario: Claude SDK 权限最小化

- **WHEN** Claude Agent SDK adapter 启动 outer session
- **THEN** adapter 配置 `dontAsk` 或更严格 permission mode
- **AND** adapter 使用空 tools 或最小 tools
- **AND** adapter 不授予 repo write 权限

### Requirement: SDK provider result 必须保留统一 session evidence

系统 SHALL 将 SDK session id、provider version、implementation mode、permission profile、final response 和 raw event artifact ref 收敛为统一 `AgentProviderRunResult`。这些字段 MAY 被写入 agent session transcript 和 narrow event payload；它们 MUST NOT 让 Core 根据 provider-specific event 推断 task completed、PR readiness、merge readiness 或 workflow handoff。

#### Scenario: provider result 记录 SDK session evidence

- **WHEN** SDK adapter 成功完成 session
- **THEN** `AgentProviderRunResult` 包含 final response
- **AND** result MAY 包含 provider session id、provider version、permission profile、implementation mode 和 raw event artifact ref
- **AND** runtime 将这些 evidence 写入 transcript artifact 或窄 event payload

#### Scenario: SDK event 不驱动外层业务完成

- **WHEN** SDK raw event 表示文件变更、命令完成、工具调用或模型输出
- **THEN** Core 不基于该 raw event 直接标记 task done、PR ready、merge ready 或 workflow handoff
- **AND** 后续业务推进仍通过 Coordinator Agent final response、Core tool executor、workflow protocol handoff 或 human gate 完成
