DROP INDEX IF EXISTS uq_active_workflow_run_per_attempt;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_workflow_run_per_attempt
ON workflow_runs(attempt_id)
WHERE status IN ('planned', 'starting', 'running', 'blocked', 'handoff', 'unknown');
