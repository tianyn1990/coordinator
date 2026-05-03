## Why

`coordinator` 已具备项目骨架、核心数据模型与 Project Registry，但 Coordinator Agent 还没有受控可见面。Iteration 4 需要把 Core 中的机器真相翻译成 Coordinator Agent 可以稳定行动的 `Coordinator Surface`，为后续 agent tools、daemon、provider 和 workflow adapter 提供统一输入契约。

## What Changes

- 新增 machine JSON surface 与 agent-facing Markdown surface 的同源生成能力。
- 覆盖第一版 surface kind：bootstrap、planning、execution、human_waiting、human_answered、review、merge_waiting、completed、failure、resume。
- 按 `docs/contracts.md` 的唯一 tool visibility matrix 生成当前可见 agent tools，并排除 operator-only tools。
- 将 autonomy 字段翻译成 agent 可读规则，而不是直接暴露裸 enum。
- 明确 denied actions、recommended next step、recovery、artifact root、memory trust boundary、validation contract。
- 提供最小 CLI/API 查看 surface 入口，便于调试和后续 Web 接入。

## Capabilities

### New Capabilities

- `coordinator-surface`: 覆盖 Coordinator Surface 双形态、surface kind、tool visibility、artifact root、memory boundary、DB task surface 调试入口。

### Modified Capabilities

- 无。

## Impact

- 影响 `packages/core`，新增 surface builder、tool visibility 推导和 Markdown renderer。
- 影响 `packages/db`，如有必要只补最小读取接口，不扩张状态机。
- 影响 `packages/cli` 和 `apps/api`，新增查看 task surface 的 operator 调试入口。
- 不实现真实 Coordinator Agent provider、agent tool 副作用、daemon、workspace manager、workflow adapter 或 PR/MR provider。
