CREATE TABLE IF NOT EXISTS portfolios (
  id UUID PRIMARY KEY,
  creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_members (
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (portfolio_id, user_id)
);

CREATE TABLE IF NOT EXISTS monitored_processes (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  intervalo_minutos INTEGER NOT NULL CHECK (intervalo_minutos > 0),
  proxima_consulta_em TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (portfolio_id, process_id)
);

CREATE TABLE IF NOT EXISTS health_probes (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  intervalo_minutos INTEGER NOT NULL CHECK (intervalo_minutos > 0),
  proxima_consulta_em TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (portfolio_id, alias)
);

CREATE TABLE IF NOT EXISTS tribunal_health_measurements (
  id UUID PRIMARY KEY,
  health_probe_id UUID NOT NULL REFERENCES health_probes(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  status_code INTEGER,
  duracao_ms INTEGER,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_alerts (
  id UUID PRIMARY KEY,
  monitored_process_id UUID NOT NULL REFERENCES monitored_processes(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_anterior_id UUID REFERENCES snapshots(id) ON DELETE SET NULL,
  snapshot_atual_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  estagio_anterior TEXT,
  estagio_atual TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (monitored_process_id, recipient_user_id, snapshot_atual_id)
);

CREATE TABLE IF NOT EXISTS alert_send_attempts (
  id UUID PRIMARY KEY,
  pending_alert_id UUID NOT NULL REFERENCES pending_alerts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  erro TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS portfolios_expires_at_idx ON portfolios (expires_at);
CREATE INDEX IF NOT EXISTS portfolio_members_expires_at_idx ON portfolio_members (expires_at);
CREATE INDEX IF NOT EXISTS monitored_processes_expires_at_idx ON monitored_processes (expires_at);
CREATE INDEX IF NOT EXISTS health_probes_expires_at_idx ON health_probes (expires_at);
CREATE INDEX IF NOT EXISTS tribunal_health_measurements_expires_at_idx ON tribunal_health_measurements (expires_at);
CREATE INDEX IF NOT EXISTS pending_alerts_expires_at_idx ON pending_alerts (expires_at);
CREATE INDEX IF NOT EXISTS alert_send_attempts_expires_at_idx ON alert_send_attempts (expires_at);
