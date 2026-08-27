function valor(...nomes) {
  for (const nome of nomes) {
    const encontrado = String(process.env[nome] || "").trim();
    if (encontrado) return encontrado;
  }
  return "";
}

export function configuracaoSso() {
  return {
    tenantId: valor("M365_TENANT_ID", "ENTRA_TENANT_ID"),
    clientId: valor("M365_CLIENT_ID", "ENTRA_CLIENT_ID"),
    clientSecret: valor("M365_CLIENT_SECRET", "ENTRA_CLIENT_SECRET"),
  };
}

export function segredoSessaoSso() {
  const segredo = valor("SESSION_SECRET");
  return segredo.length >= 32 ? segredo : "";
}

export function ssoConfigurado() {
  const config = configuracaoSso();
  return Boolean(config.tenantId && config.clientId && config.clientSecret && segredoSessaoSso() && valor("DATABASE_URL"));
}
