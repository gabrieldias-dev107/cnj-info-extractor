function campo(valor) {
  let texto = String(valor == null ? "" : valor);
  if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
  return /[",\r\n]/.test(texto) ? "\"" + texto.replace(/\"/g, "\"\"") + "\"" : texto;
}

export function csvDeLote(itens) {
  const colunas = ["linha", "numero", "status", "erro", "estagio"];
  const linhas = (Array.isArray(itens) ? itens : []).map((item) => colunas.map((coluna) => campo(item[coluna])).join(","));
  return colunas.join(",") + "\r\n" + linhas.join("\r\n") + (linhas.length ? "\r\n" : "");
}
