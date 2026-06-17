// Tabelas de mapeamento do número único CNJ (Resolução CNJ nº 65/2008).
// Tudo offline. Script clássico (sem ES modules) p/ funcionar abrindo via file://.
// Expõe window.CNJ_TABLES.
(function (global) {
  "use strict";

  // J -> segmento do Poder Judiciário
  var SEGMENTOS = {
    "1": "Supremo Tribunal Federal (STF)",
    "2": "Conselho Nacional de Justiça (CNJ)",
    "3": "Superior Tribunal de Justiça (STJ)",
    "4": "Justiça Federal",
    "5": "Justiça do Trabalho",
    "6": "Justiça Eleitoral",
    "7": "Justiça Militar da União",
    "8": "Justiça Estadual",
    "9": "Justiça Militar Estadual",
  };

  // Justiça Federal (J=4): TR = região do TRF
  var TRF = {
    "01": "TRF da 1ª Região",
    "02": "TRF da 2ª Região",
    "03": "TRF da 3ª Região",
    "04": "TRF da 4ª Região",
    "05": "TRF da 5ª Região",
    "06": "TRF da 6ª Região",
    "90": "Conselho da Justiça Federal (CJF)",
  };

  // Justiça do Trabalho (J=5): TR = região do TRT. Cada região cobre uma ou mais UFs.
  var TRT_UF = {
    "01": "RJ", "02": "SP", "03": "MG", "04": "RS", "05": "BA",
    "06": "PE", "07": "CE", "08": "PA/AP", "09": "PR", "10": "DF/TO",
    "11": "AM/RR", "12": "SC", "13": "PB", "14": "RO/AC", "15": "SP",
    "16": "MA", "17": "ES", "18": "GO", "19": "AL", "20": "SE",
    "21": "RN", "22": "PI", "23": "MT", "24": "MS",
  };
  var TRT = {};
  Object.keys(TRT_UF).forEach(function (k) {
    TRT[k] = "TRT da " + Number(k) + "ª Região (" + TRT_UF[k] + ")";
  });
  TRT["90"] = "Tribunal Superior do Trabalho (TST) / CSJT";

  // Estados por código numérico CNJ (usado por J=6, J=8, J=9). Ordem alfabética de UF.
  var UF_POR_CODIGO = {
    "01": "AC", "02": "AL", "03": "AP", "04": "AM", "05": "BA",
    "06": "CE", "07": "DF", "08": "ES", "09": "GO", "10": "MA",
    "11": "MT", "12": "MS", "13": "MG", "14": "PA", "15": "PB",
    "16": "PR", "17": "PE", "18": "PI", "19": "RJ", "20": "RN",
    "21": "RS", "22": "RO", "23": "RR", "24": "SC", "25": "SE",
    "26": "SP", "27": "TO",
  };

  // Justiça Estadual (J=8): TR = código do estado -> TJ
  var TJ_ESTADUAL = {};
  // Justiça Eleitoral (J=6): TR = código do estado -> TRE; 00 = TSE
  var TRE = { "00": "Tribunal Superior Eleitoral (TSE)" };
  Object.keys(UF_POR_CODIGO).forEach(function (cod) {
    var uf = UF_POR_CODIGO[cod];
    TJ_ESTADUAL[cod] = "Tribunal de Justiça (TJ" + uf + ")";
    TRE[cod] = "TRE-" + uf;
  });

  // Justiça Militar Estadual (J=9): apenas SP, MG, RS possuem TJM próprio
  var TJM = {
    "13": "Tribunal de Justiça Militar de Minas Gerais (TJMMG)",
    "21": "Tribunal de Justiça Militar do Rio Grande do Sul (TJMRS)",
    "26": "Tribunal de Justiça Militar de São Paulo (TJMSP)",
  };

  function tribunalUnico(tr, nome) {
    return { nome: nome, conhecido: tr === "00" };
  }

  function lookup(tabela, tr) {
    if (tabela[tr]) return { nome: tabela[tr], conhecido: true };
    return { nome: "Código de tribunal " + tr, conhecido: false };
  }

  // Aliases especiais de Justiça Estadual cujo índice DataJud foge da regra "tj"+uf.
  var ALIAS_TJ_ESPECIAL = { "07": "tjdft" }; // DF -> Tribunal de Justiça do DF e Territórios

  // Deriva o alias do índice DataJud (ex.: "api_publica_tjsp") a partir de J e TR.
  // Retorna { alias: string|null, conhecido: boolean }. alias null => sem consulta online.
  function deriveAlias(segmento, tribunal) {
    var j = String(segmento);
    var tr = String(tribunal);
    var pre = "api_publica_";
    var uf, n;

    switch (j) {
      case "1": return { alias: pre + "stf", conhecido: true };
      case "3": return { alias: pre + "stj", conhecido: true };
      case "7": return { alias: pre + "stm", conhecido: true };

      case "4": // Justiça Federal
        if (tr === "90") return { alias: null, conhecido: false }; // CJF não tem índice público
        n = Number(tr);
        if (n >= 1 && n <= 6) return { alias: pre + "trf" + n, conhecido: true };
        return { alias: null, conhecido: false };

      case "5": // Justiça do Trabalho
        if (tr === "90") return { alias: pre + "tst", conhecido: true };
        n = Number(tr);
        if (n >= 1 && n <= 24) return { alias: pre + "trt" + n, conhecido: true };
        return { alias: null, conhecido: false };

      case "6": // Justiça Eleitoral
        if (tr === "00") return { alias: pre + "tse", conhecido: true };
        uf = UF_POR_CODIGO[tr];
        if (uf) return { alias: pre + "tre-" + uf.toLowerCase(), conhecido: true };
        return { alias: null, conhecido: false };

      case "8": // Justiça Estadual
        if (ALIAS_TJ_ESPECIAL[tr]) return { alias: pre + ALIAS_TJ_ESPECIAL[tr], conhecido: true };
        uf = UF_POR_CODIGO[tr];
        if (uf) return { alias: pre + "tj" + uf.toLowerCase(), conhecido: true };
        return { alias: null, conhecido: false };

      case "9": // Justiça Militar Estadual: só MG (13), RS (21), SP (26)
        if (TJM[tr]) return { alias: pre + "tjm" + UF_POR_CODIGO[tr].toLowerCase(), conhecido: true };
        return { alias: null, conhecido: false };

      default: // "2" (CNJ) e desconhecidos: sem índice público
        return { alias: null, conhecido: false };
    }
  }

  // Resolve o nome do tribunal a partir do segmento (J) e do código TR.
  function nomeTribunal(j, tr) {
    switch (j) {
      case "1": return tribunalUnico(tr, "Supremo Tribunal Federal (STF)");
      case "2": return tribunalUnico(tr, "Conselho Nacional de Justiça (CNJ)");
      case "3": return tribunalUnico(tr, "Superior Tribunal de Justiça (STJ)");
      case "7": return tribunalUnico(tr, "Superior Tribunal Militar (STM)");
      case "4": return lookup(TRF, tr);
      case "5": return lookup(TRT, tr);
      case "6": return lookup(TRE, tr);
      case "8": return lookup(TJ_ESTADUAL, tr);
      case "9": return lookup(TJM, tr);
      default:  return { nome: "Código de tribunal " + tr, conhecido: false };
    }
  }

  global.CNJ_TABLES = { SEGMENTOS: SEGMENTOS, nomeTribunal: nomeTribunal, deriveAlias: deriveAlias };
})(typeof window !== "undefined" ? window : globalThis);
