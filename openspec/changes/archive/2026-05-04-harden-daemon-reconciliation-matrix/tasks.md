## 1. Context and Baseline

- [x] 1.1 Re-read `docs/daemon.md`, `docs/operations.md`, `docs/contracts.md`, `docs/workflow-protocol.md`, `docs/observability.md`, `docs/agent-tools.md`, and this change before editing implementation files.
- [x] 1.2 Inspect current daemon runtime, workflow reconciliation, agent session runtime, operation repository, event helpers, and surface tests to identify exact integration points.
- [x] 1.3 Run the relevant baseline tests for daemon/runtime/surface to confirm the starting point.

## 2. Core Recovery Decision

- [x] 2.1 Add typed observation and recovery decision models with narrow fields and no provider raw output or lock token exposure.
- [x] 2.2 Implement Core recovery service for operation replay decisions covering running/failed/unknown with absent/matches-intent/conflicts-with-intent/unclear observed states.
- [x] 2.3 Implement retry budget and same task stateVersion no-progress checks used by recovery decisions.
- [x] 2.4 Add append-only recovery decision event writer that commits state changes and recovery event in the same transaction when state changes occur.

## 3. Daemon Integration

- [x] 3.1 Route active operation reconciliation through Core recovery service instead of embedding recovery policy directly in daemon tick.
- [x] 3.2 Route workflow run unavailable and runId/profile mismatch handling through Core recovery service while preserving workflow protocol-only boundary.
- [x] 3.3 Route outer agent session stalled/no-progress handling through Core recovery service and prevent repeated provider starts for the same task stateVersion without new facts.
- [x] 3.4 Enforce paused/canceled safe inspect gate across scheduler, human answer wake-up, retry_due, stalled session handling, and operation replay.

## 4. Surface and Observability Safety

- [x] 4.1 Ensure recovery decision details are available to operator events/timeline as narrow summaries.
- [x] 4.2 Ensure Coordinator Surface does not expose internal recovery tools, lock tokens, provider raw output, complete operation JSON, or complete recovery matrix.
- [x] 4.3 Add or update operator-only API/CLI output only if needed for recovery summaries; do not add agent tools.

## 5. Tests and Validation

- [x] 5.1 Add failure injection / contract tests for operation unknown replay, running operation matched/absent/conflicting observations, and retry budget exhausted.
- [x] 5.2 Add workflow reconciliation tests for protocol unavailable, runId mismatch, profile mismatch, and stage/substate not driving completed or pr_ready.
- [x] 5.3 Add agent session tests for stalled inspect, same stateVersion no-progress, retry_due, and no duplicate provider start.
- [x] 5.4 Add paused/canceled guard tests covering scheduler, human answered wake-up, retry_due, stalled session, and operation replay.
- [x] 5.5 Add surface leakage tests ensuring no internal recovery tools or raw recovery internals appear in agent-facing JSON/Markdown.
- [x] 5.6 Run `openspec validate --all --strict`, relevant targeted tests, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## 6. Review and Closeout

- [x] 6.1 Send the completed change to an independent `gpt-5.5 high` subagent review with explicit checks for docs design alignment, continued doc rereading, over-design, protocol drift, layering pollution, and agent surface/tool complexity.
- [x] 6.2 Fix all reasonable must-fix review findings and repeat subagent review until no must-fix findings remain.
- [x] 6.3 Archive the OpenSpec change after validation and review are clean.
- [x] 6.4 Update `docs/roadmap.md` and any relevant docs/specs with landed facts, without changing design boundaries unless confirmed by the user.
- [x] 6.5 Check `git status`, commit the completed change as one coherent unit, and ensure no active change or unrelated work remains.
