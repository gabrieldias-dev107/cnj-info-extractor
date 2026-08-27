// Leitor de CSV para importação de lotes. Deliberadamente pequeno: aceita
// aspas duplas com escape `""`, delimitador `,` ou `;` detectado no cabeçalho,
// CRLF e BOM. Nada de dependência externa — o mesmo critério que motivou o
// leitor XLSX nativo em server/xlsx.js.
const LIMITE_BYTES = 2 * 1024 * 1024;
const LIMITE_LINHAS = 5000;

function detectarDelimitador(texto) {
  const primeira = texto.split(/\r?\n/, 1)[0] || "";
  let virgulas = 0;
  let pontos = 0;
  let entreAspas = false;
  for (const caractere of primeira) {
    if (caractere === '"') entreAspas = !entreAspas;
    else if (entreAspas) continue;
    else if (caractere === ",") virgulas += 1;
    else if (caractere === ";") pontos += 1;
  }
  return pontos > virgulas ? ";" : ",";
}

export function lerPlanilhaCsv(bruto) {
  const buffer = Buffer.isBuffer(bruto) ? bruto : Buffer.from(String(bruto || ""), "utf8");
  if (buffer.length > LIMITE_BYTES) throw new Error("arquivo_maior_que_2mb");

  let texto = buffer.toString("utf8");
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  if (!texto.trim()) throw new Error("csv_invalido");

  const delimitador = detectarDelimitador(texto);
  const linhas = [];
  let linha = [];
  let campo = "";
  let entreAspas = false;

  for (let i = 0; i < texto.length; i += 1) {
    const caractere = texto[i];
    if (entreAspas) {
      if (caractere !== '"') { campo += caractere; continue; }
      if (texto[i + 1] === '"') { campo += '"'; i += 1; continue; }
      entreAspas = false;
      continue;
    }
    if (caractere === '"') { entreAspas = true; continue; }
    if (caractere === delimitador) { linha.push(campo); campo = ""; continue; }
    if (caractere === "\r") continue;
    if (caractere === "\n") {
      linha.push(campo);
      linhas.push(linha);
      if (linhas.length > LIMITE_LINHAS) throw new Error("csv_invalido");
      linha = [];
      campo = "";
      continue;
    }
    campo += caractere;
  }
  if (entreAspas) throw new Error("csv_invalido");
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }

  const uteis = linhas.filter((atual) => atual.some((valor) => String(valor).trim()));
  if (!uteis.length) throw new Error("csv_invalido");
  return uteis;
}
