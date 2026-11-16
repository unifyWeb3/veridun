export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  task_id text PRIMARY KEY,
  request_digest text NOT NULL,
  envelope jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  decision text,
  reason_code text,
  response_body bytea,
  response_signature text,
  proof jsonb,
  public_signals jsonb,
  policy_checks jsonb,
  inbound_verification jsonb,
  kurier jsonb,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proof_references (
  proof_tx text PRIMARY KEY,
  first_task_id text NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proof_attempts (
  id bigserial PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_tasks(task_id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_tasks_state_idx ON agent_tasks (state);
CREATE INDEX IF NOT EXISTS agent_tasks_decision_idx ON agent_tasks (decision);
CREATE INDEX IF NOT EXISTS agent_tasks_reason_idx ON agent_tasks (reason_code);
CREATE INDEX IF NOT EXISTS agent_tasks_created_idx ON agent_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS proof_attempts_task_idx ON proof_attempts (task_id, created_at DESC);
`;
