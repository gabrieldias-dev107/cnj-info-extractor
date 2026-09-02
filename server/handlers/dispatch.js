function nomeDoHandler(req) {
  const nome = req.query?.handler;
  return Array.isArray(nome) ? nome[0] : nome;
}

export function despachar(handlers, { urlsPublicas = {} } = {}) {
  return async function handler(req, res) {
    const nome = nomeDoHandler(req);
    const delegado = handlers[nome];
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
