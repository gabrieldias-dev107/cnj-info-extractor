ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS score_faixa TEXT;

ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS score_pontos INTEGER;

ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS score_versao TEXT;

-- A confiança é persistida junto com a faixa porque a tabela do lote e as
-- exportações leem só colunas: sem ela, uma faixa apoiada em movimento TPU
-- curado ficaria indistinguível de uma tirada apenas de sinais secundários.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS score_confianca TEXT;

CREATE TABLE IF NOT EXISTS service_tokens (
  id UUID PRIMARY KEY,
  creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  -- Parte não secreta do token, mostrada na interface para identificar qual
  -- credencial revogar. O segredo existe só como hash em token_hash.
  prefixo TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  limite_dia INTEGER NOT NULL CHECK (limite_dia > 0),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_em TIMESTAMPTZ,
  revogado_em TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('usuario', 'token', 'automacao')),
  -- Rótulo pseudonimizado do ator. Nunca e-mail, nunca número de processo.
  ator_rotulo TEXT,
  -- As três FKs são ON DELETE SET NULL de propósito. Com CASCADE, o expurgo do
  -- usuário inativo apagaria a trilha junto com o ator e destruiria a evidência
  -- que esta tabela existe para preservar.
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  service_token_id UUID REFERENCES service_tokens(id) ON DELETE SET NULL,
  process_id UUID REFERENCES processes(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  recurso TEXT,
  resultado TEXT NOT NULL,
  req_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS service_tokens_expires_at_idx ON service_tokens (expires_at);

CREATE INDEX IF NOT EXISTS service_tokens_prefixo_idx ON service_tokens (prefixo);

CREATE INDEX IF NOT EXISTS service_tokens_creator_idx ON service_tokens (creator_user_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS audit_events_user_idx ON audit_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_expires_at_idx ON audit_events (expires_at);

CREATE INDEX IF NOT EXISTS consultation_events_created_at_idx ON consultation_events (created_at);
