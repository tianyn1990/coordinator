ALTER TABLE agent_sessions ADD COLUMN prompt_path TEXT;
ALTER TABLE agent_sessions ADD COLUMN surface_json_path TEXT;
ALTER TABLE agent_sessions ADD COLUMN surface_markdown_path TEXT;
ALTER TABLE agent_sessions ADD COLUMN final_response_path TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_outer_agent_session_per_task
ON agent_sessions(task_id, role)
WHERE role = 'outer' AND status IN ('planned', 'starting', 'running', 'stalled', 'unknown');
