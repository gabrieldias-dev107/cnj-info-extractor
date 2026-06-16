# Decodificador de Número CNJ

Site estático que extrai, **offline**, todas as informações codificadas em um número
único de processo do CNJ (Resolução CNJ nº 65/2008): segmento da Justiça, tribunal,
ano de autuação, unidade de origem e validação do dígito verificador.

Nada é enviado a servidores — toda a decodificação acontece no navegador.

## Como usar

Abra `index.html` direto no navegador (duplo clique ou `file://`). Sem build, sem
dependências, sem servidor.

Cole ou digite o número do processo. O campo aplica a máscara
`NNNNNNN-DD.AAAA.J.TR.OOOO` em tempo real e aceita entrada com ou sem pontuação.
Botões de exemplo cobrem diferentes segmentos (TJSP, TRT, TRF, TRE, STJ).

## Formato do número

| Parte | Dígitos | Significado |
|-------|---------|-------------|
| `NNNNNNN` | 7 | Número sequencial do processo (por unidade/ano) |
| `DD` | 2 | Dígito verificador (módulo 97, ISO 7064) |
| `AAAA` | 4 | Ano de autuação |
| `J` | 1 | Segmento do Poder Judiciário |
| `TR` | 2 | Tribunal |
| `OOOO` | 4 | Unidade de origem (vara/foro) |

O nome da **unidade de origem** não é resolvido (a tabela não é pública/estável offline);
mostramos apenas o código.

## Estrutura

- `index.html` — página e marcação.
- `styles.css` — estilos.
- `js/tables.js` — tabelas de mapeamento (segmento, TRF, TRT, TRE, TJ, TJM).
- `js/cnj.js` — lógica pura (normalizar, máscara, parse, validar, descrever).
- `js/app.js` — integração com o DOM.
- `tests/cnj.test.html` — testes da lógica; abra no navegador (todos devem ficar verdes).

## Deploy (Vercel)

Site estático, sem build. Hospedado na Vercel com deploy automático a cada `git push`.

- `vercel.json` — serve a raiz como estático (sem build command), com `cleanUrls` e
  cabeçalhos de segurança básicos.
- `.vercelignore` — exclui `tests/` do site publicado (continua versionado no Git).

Para atualizar o site no ar: faça commit e `git push`; a Vercel redeploya sozinha.

## Escopo

Apenas decodificação do número. Não consulta dados reais do processo (partes,
movimentações), pois isso exigiria API/backend (ex.: DataJud do CNJ).

Base normativa: Resolução CNJ nº 65/2008.
