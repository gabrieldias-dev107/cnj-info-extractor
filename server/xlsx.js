import { inflateRawSync } from "node:zlib";
import { COLUNAS_LOTE, linhasDoLote } from "./batch-export.js";

const LIMITE_XLSX = 2 * 1024 * 1024;
const CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let valor = i;
    for (let j = 0; j < 8; j += 1) valor = (valor >>> 1) ^ (valor & 1 ? 0xedb88320 : 0);
    tabela[i] = valor >>> 0;
  }
  return tabela;
})();

function crc32(dados) {
  let valor = 0xffffffff;
  for (const byte of dados) valor = (valor >>> 8) ^ CRC[(valor ^ byte) & 0xff];
  return (valor ^ 0xffffffff) >>> 0;
}

function u16(valor) { const b = Buffer.alloc(2); b.writeUInt16LE(valor); return b; }
function u32(valor) { const b = Buffer.alloc(4); b.writeUInt32LE(valor >>> 0); return b; }

function zipStore(arquivos) {
  let deslocamento = 0;
  const locais = [];
  const centrais = [];
  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, "utf8");
    const dados = Buffer.from(arquivo.dados, "utf8");
    const crc = crc32(dados);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(dados.length), u32(dados.length), u16(nome.length), u16(0), nome, dados]);
    locais.push(local);
    centrais.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(dados.length), u32(dados.length), u16(nome.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(deslocamento), nome]));
    deslocamento += local.length;
  }
  const diretorio = Buffer.concat(centrais);
  return Buffer.concat([...locais, diretorio, u32(0x06054b50), u16(0), u16(0), u16(arquivos.length), u16(arquivos.length), u32(diretorio.length), u32(deslocamento), u16(0)]);
}

function xml(valor) {
  return String(valor == null ? "" : valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function textoXml(valor) {
  return String(valor || "").replace(/<[^>]*>/g, "").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function coluna(indice) {
  let n = indice + 1;
  let resultado = "";
  while (n) { const resto = (n - 1) % 26; resultado = String.fromCharCode(65 + resto) + resultado; n = Math.floor((n - 1) / 26); }
  return resultado;
}

function arquivosZip(bruto) {
  const zip = Buffer.from(bruto || []);
  if (zip.length < 22 || zip.length > LIMITE_XLSX) throw new Error("xlsx_invalido");
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i -= 1) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("xlsx_invalido");
  const total = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  const saida = new Map();
  let tamanhoTotal = 0;
  for (let i = 0; i < total; i += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error("xlsx_invalido");
    const metodo = zip.readUInt16LE(cursor + 10);
    const compactado = zip.readUInt32LE(cursor + 20);
    const descompactado = zip.readUInt32LE(cursor + 24);
    const nomeTam = zip.readUInt16LE(cursor + 28);
    const extraTam = zip.readUInt16LE(cursor + 30);
    const comentarioTam = zip.readUInt16LE(cursor + 32);
    const local = zip.readUInt32LE(cursor + 42);
    const nome = zip.subarray(cursor + 46, cursor + 46 + nomeTam).toString("utf8");
    if (descompactado > LIMITE_XLSX || (tamanhoTotal += descompactado) > LIMITE_XLSX || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new Error("xlsx_invalido");
    const localNome = zip.readUInt16LE(local + 26);
    const localExtra = zip.readUInt16LE(local + 28);
    const inicio = local + 30 + localNome + localExtra;
    if (inicio + compactado > zip.length) throw new Error("xlsx_invalido");
    const dados = zip.subarray(inicio, inicio + compactado);
    if (metodo === 0) saida.set(nome, dados);
    else if (metodo === 8) saida.set(nome, inflateRawSync(dados, { maxOutputLength: LIMITE_XLSX }));
    else throw new Error("xlsx_invalido");
    cursor += 46 + nomeTam + extraTam + comentarioTam;
  }
  return saida;
}

function valorCelula(conteudo, tipo, compartilhadas) {
  if (conteudo.includes("<f")) return "";
  const valor = /<v>([\s\S]*?)<\/v>/.exec(conteudo);
  if (tipo === "s") return compartilhadas[Number(valor && valor[1])] || "";
  const inline = /<is[^>]*>([\s\S]*?)<\/is>/.exec(conteudo);
  return textoXml((inline && inline[1]) || (valor && valor[1]) || "");
}

export function lerPlanilhaXlsx(bruto) {
  const arquivos = arquivosZip(bruto);
  const planilha = arquivos.get("xl/worksheets/sheet1.xml");
  if (!planilha) throw new Error("xlsx_invalido");
  const compartilhadas = [];
  const xmlCompartilhado = arquivos.get("xl/sharedStrings.xml");
  if (xmlCompartilhado) for (const item of xmlCompartilhado.toString("utf8").matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) compartilhadas.push(textoXml(item[1]));
  const linhas = [];
  for (const linha of planilha.toString("utf8").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const valores = [];
    for (const celula of linha[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const referencia = /\br=\"([A-Z]+)\d+\"/.exec(celula[1]);
      const tipo = /\bt=\"([^\"]+)\"/.exec(celula[1]);
      const posicao = referencia ? referencia[1].split("").reduce((n, letra) => n * 26 + letra.charCodeAt(0) - 64, 0) - 1 : valores.length;
      const conteudo = celula[2];
      const valor = valorCelula(conteudo, tipo && tipo[1], compartilhadas);
      valores[posicao] = valor;
    }
    linhas.push(valores.map((valor) => String(valor == null ? "" : valor)));
  }
  return linhas;
}

export function xlsxDeLote(itens) {
  // Mesmas colunas do CSV, montadas pelo mesmo módulo: dois formatos com listas
  // divergentes já foi bug uma vez.
  const linhas = [COLUNAS_LOTE, ...linhasDoLote(itens)];
  const corpo = linhas.map((linha, y) => "<row r=\"" + (y + 1) + "\">" + linha.map((valor, x) => "<c r=\"" + coluna(x) + (y + 1) + "\" t=\"inlineStr\"><is><t>" + xml(valor) + "</t></is></c>").join("") + "</row>").join("");
  return zipStore([
    { nome: "[Content_Types].xml", dados: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>" },
    { nome: "_rels/.rels", dados: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>" },
    { nome: "xl/workbook.xml", dados: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Triagem\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>" },
    { nome: "xl/_rels/workbook.xml.rels", dados: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>" },
    { nome: "xl/worksheets/sheet1.xml", dados: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>" + corpo + "</sheetData></worksheet>" },
  ]);
}
