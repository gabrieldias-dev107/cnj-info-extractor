const UF_POR_CODIGO = {
  "01": "AC", "02": "AL", "03": "AP", "04": "AM", "05": "BA", "06": "CE", "07": "DF", "08": "ES", "09": "GO", "10": "MA",
  "11": "MT", "12": "MS", "13": "MG", "14": "PA", "15": "PB", "16": "PR", "17": "PE", "18": "PI", "19": "RJ", "20": "RN",
  "21": "RS", "22": "RO", "23": "RR", "24": "SC", "25": "SE", "26": "SP", "27": "TO",
};

export function normalizarNumero(raw) {
  return String(raw == null ? "" : raw).replace(/\D/g, "");
}

function aliasDatajud(segmento, tribunal) {
  const prefixo = "api_publica_";
  const numero = Number(tribunal);
  const uf = UF_POR_CODIGO[tribunal];
  if (segmento === "1") return prefixo + "stf";
  if (segmento === "3") return prefixo + "stj";
  if (segmento === "7") return prefixo + "stm";
  if (segmento === "4" && numero >= 1 && numero <= 6) return prefixo + "trf" + numero;
  if (segmento === "5" && numero >= 1 && numero <= 24) return prefixo + "trt" + numero;
  if (segmento === "5" && tribunal === "90") return prefixo + "tst";
  if (segmento === "6" && tribunal === "00") return prefixo + "tse";
  if (segmento === "6" && uf) return prefixo + "tre-" + uf.toLowerCase();
  if (segmento === "8" && tribunal === "07") return prefixo + "tjdft";
  if (segmento === "8" && uf) return prefixo + "tj" + uf.toLowerCase();
  if (segmento === "9" && ["13", "21", "26"].includes(tribunal)) return prefixo + "tjm" + uf.toLowerCase();
  return null;
}

export function validarNumeroParaConsulta(raw) {
  const numero = normalizarNumero(raw);
  if (numero.length !== 20) return { valido: false, erro: "numero_invalido" };
  const sequencial = numero.slice(0, 7);
  const recebido = numero.slice(7, 9);
  const ano = numero.slice(9, 13);
  const segmento = numero.slice(13, 14);
  const tribunal = numero.slice(14, 16);
  const origem = numero.slice(16, 20);
  const esperado = String(98n - (BigInt(sequencial + ano + segmento + tribunal + origem) * 100n) % 97n).padStart(2, "0");
  if (recebido !== esperado) return { valido: false, erro: "digito_verificador_invalido" };
  const alias = aliasDatajud(segmento, tribunal);
  if (!alias) return { valido: false, erro: "alias_desconhecido" };
  return { valido: true, numero, alias };
}
