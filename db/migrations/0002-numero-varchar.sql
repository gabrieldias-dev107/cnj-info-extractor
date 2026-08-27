-- CHAR(20) é bpchar: o Postgres preenche com espaços à direita, e o padding
-- vazava para o JSON da API e para os exports CSV/XLSX em qualquer número com
-- menos de 20 caracteres (na prática, as linhas inválidas do lote).
-- O cast de bpchar para varchar remove os espaços dos dados já gravados.
ALTER TABLE processes ALTER COLUMN numero TYPE VARCHAR(20);
ALTER TABLE batch_items ALTER COLUMN numero TYPE VARCHAR(20);
