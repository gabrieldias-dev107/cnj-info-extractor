import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("UI usa dialog nativo e mantém dados remotos fora de HTML interpretado", () => {
  const html = readFileSync("index.html", "utf8");
  const app = readFileSync("js/app.js", "utf8");
  assert.match(html, /<dialog id="login-dialog"/);
  assert.match(html, /role="alert"/);
  assert.match(app, /\.showModal\(\)/);
  assert.match(app, /aria-busy/);
  assert.match(app, /consultaSeq/);
  assert.match(app, /ArrowRight/);
  assert.equal(/\.innerHTML\s*=/.test(app), false);
  assert.match(app, /textContent/);
});

// A interface P1 mostra nome de carteira, e-mail de membro e número de processo
// — tudo vindo do banco. A regra de js/app.js vale igual aqui.
test("interfaces P1 e P2 montam o DOM por nó, sem HTML gerado a partir de dado remoto", () => {
  const arquivos = ["js/p1-api.js", "js/p1-ui.js", "js/p2-api.js", "js/p2-ui.js"].map((caminho) => [caminho, readFileSync(caminho, "utf8")]);
  for (const [caminho, fonte] of arquivos) {
    assert.equal(/\.innerHTML/.test(fonte), false, caminho + " não pode usar innerHTML");
    assert.equal(/\.outerHTML|insertAdjacentHTML|document\.write/.test(fonte), false, caminho + " não pode escrever HTML");
    // Nenhum número de processo ou nome de carteira pode vazar para o console.
    assert.equal(/console\./.test(fonte), false, caminho + " não pode registrar dado do usuário no console");
  }
  const ui = arquivos[1][1];
  assert.match(ui, /createTextNode|textContent/);
  assert.match(ui, /credentials|P1Api/);
});

test("index.html publica as seções P1/P2 e carrega os scripts na ordem certa", () => {
  const html = readFileSync("index.html", "utf8");
  const ancoras = [
    "glossario-busca", "portfolios-lista", "portfolio-detalhe", "historico-form",
    "token-form", "tokens-lista", "token-emitido", "trilha-lista", "trilha-proxima",
  ];
  for (const id of ancoras) {
    assert.match(html, new RegExp('id="' + id + '"'), "falta a âncora " + id);
  }
  const ordem = ["js/tables.js", "js/cnj.js", "js/api.js", "js/p1-api.js", "js/p2-api.js", "js/app.js", "js/p1-ui.js", "js/p2-ui.js"]
    .map((src) => html.indexOf('src="' + src + '"'));
  assert.ok(ordem.every((posicao) => posicao > 0), "todos os scripts precisam estar no index.html");
  assert.deepEqual(ordem.slice().sort((a, b) => a - b), ordem, "a ordem dos scripts clássicos importa");
});

// A CSP de vercel.json não permite unsafe-inline: um <script> ou style= inline
// simplesmente não executa, e o defeito aparece só em produção.
test("index.html não introduz script nem estilo inline", () => {
  const html = readFileSync("index.html", "utf8");
  assert.equal(/<script(?![^>]*\ssrc=)/i.test(html), false, "todo <script> precisa vir de src");
  assert.equal(/\sstyle="/i.test(html), false, "estilo inline é bloqueado pela CSP");
});

// O maior risco de negócio desta entrega é a faixa ser lida como certeza.
test("a faixa nunca é desenhada sem confiança, fatores e ressalva", () => {
  const app = readFileSync("js/app.js", "utf8");
  for (const marca of ["score-ressalva", "ROTULO_CONFIANCA", "score.fatores", "aprovadaPorRisco|score-versao"]) {
    assert.match(app, new RegExp(marca), "js/app.js precisa exibir " + marca);
  }
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /guarda somente o hash/, "o painel de tokens precisa avisar que o valor não se recupera");
  assert.match(html, /número do processo nunca é\s+gravado/, "o painel da trilha precisa dizer o que não é registrado");
});

test("interface usa tokens operacionais Jira adaptados ao CNJ", () => {
  const html = readFileSync("index.html", "utf8");
  const css = readFileSync("styles.css", "utf8");
  assert.match(html, /<main class="container jira-cnj">/);
  for (const token of ["--cnj-background-neutral", "--cnj-surface-raised", "--cnj-text", "--cnj-text-subtle", "--cnj-border", "--cnj-action", "--cnj-action-hover", "--cnj-focus"]) {
    assert.match(css, new RegExp(token + "\\s*:"), "falta o token " + token);
  }
  assert.match(css, /\.jira-cnj\s*\{/);
  assert.match(css, /font-family:\s*var\(--cnj-font-sans\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

// O cliente P1 nunca escolhe o índice do DataJud: quem deriva o alias é o
// servidor, a partir do número. Ver api/health-probes.js.
test("cliente P1 não envia alias para as sondas de saúde", () => {
  const cliente = readFileSync("js/p1-api.js", "utf8");
  assert.equal(/alias/.test(cliente), false);
});
