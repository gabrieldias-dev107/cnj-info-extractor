// A Vercel mescla a query do rewrite com a query enviada pelo cliente, então
// `handler` chega como array quando o chamador acrescenta o próprio `?handler=`.
// Enquanto a agregadora só tinha rotas de cookie do mesmo usuário isso era
// inofensivo; com rotas autenticadas por token de serviço no mesmo arquivo, um
// chamador poderia dirigir a Function para outro handler. Valor ambíguo é
// recusado em vez de resolvido por precedência.
function nomeDoHandler(req) {
  return req.query ? req.query.handler : undefined;
}

export function despachar(handlers, { urlsPublicas = {} } = {}) {
  return async function handler(req, res) {
    const nome = nomeDoHandler(req);
    if (nome !== undefined && typeof nome !== "string") return res.status(400).json({ error: "rota_ambigua" });
    // Só chave própria: `?handler=toString` acharia um método do protótipo e o
    // executaria como se fosse rota registrada.
    const registrado = typeof nome === "string" && Object.prototype.hasOwnProperty.call(handlers, nome);
    const delegado = registrado ? handlers[nome] : null;
    if (!delegado) return res.status(404).json({ error: "rota_nao_encontrada" });

    const urlOriginal = req.url;
    if (urlsPublicas[nome]) req.url = urlsPublicas[nome];
    try {
      return await delegado(req, res);
    } finally {
      req.url = urlOriginal;
    }
  };
}
