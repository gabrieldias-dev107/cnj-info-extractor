CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  entra_oid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processes (
  id UUID PRIMARY KEY,
  numero CHAR(20) NOT NULL UNIQUE,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY,
  process_id UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  dados JSONB NOT NULL,
  estagio TEXT NOT NULL,
  estagio_codigo INTEGER,
  estagio_data TIMESTAMPTZ,
  tpu_versao TEXT NOT NULL,
  consultado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_process_fresh_idx ON snapshots (process_id, expira_em DESC);

CREATE TABLE IF NOT EXISTS movements (
  id UUID PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  codigo INTEGER,
  nome TEXT,
  data_hora TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS consultation_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  origem TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pendente', 'processando', 'concluido', 'falhou')),
  total INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_items (
  id UUID PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  linha INTEGER NOT NULL,
  numero CHAR(20),
  alias TEXT,
  status TEXT NOT NULL CHECK (status IN ('pendente', 'processando', 'concluido', 'invalido', 'duplicado', 'falhou')),
  erro TEXT,
  snapshot_id UUID REFERENCES snapshots(id) ON DELETE SET NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  UNIQUE (batch_id, linha)
);

CREATE INDEX IF NOT EXISTS sessions_expira_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS batches_expira_idx ON batches (expires_at);
