const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10000;

function falha(codigo, extras = {}) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  return Object.assign(erro, extras);
}

// Lido a cada envio, como `required()` da fila: a chave só existe em runtime e
// nunca entra em log, mensagem de erro ou resposta.
function obrigatorio(nome) {
  const valor = String(process.env[nome] || "").trim();
  if (!valor) throw falha("email_indisponivel");
  return valor;
}

export async function enviarEmail({ para, assunto, html, texto }, fetchImpl = globalThis.fetch) {
  const chave = obrigatorio("RESEND_API_KEY");
  const remetente = obrigatorio("RESEND_FROM_EMAIL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resposta;
  try {
    resposta = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
      body: JSON.stringify({ from: remetente, to: [para], subject: assunto, html, text: texto }),
      signal: controller.signal,
    });
  } catch (erro) {
    throw falha(erro && erro.name === "AbortError" ? "email_timeout" : "email_indisponivel");
  } finally {
    clearTimeout(timer);
  }
  // Só um 2xx conta como aceite; o corpo da recusa não é propagado para não
  // arrastar conteúdo de terceiro para dentro de log ou resposta.
  if (!resposta.ok) throw falha("email_rejeitado", { status: resposta.status });
  const dados = await resposta.json().catch(() => ({}));
  return { id: (dados && dados.id) || null };
}
