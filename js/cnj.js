// Lógica pura de decodificação do número único CNJ. Sem DOM — testável isoladamente.
// Formato: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos).
// Script clássico. Depende de window.CNJ_TABLES. Expõe window.CNJ.
(function (global) {
  "use strict";

  var TABLES = global.CNJ_TABLES;

  // Remove tudo que não for dígito.
  function normalize(raw) {
    return (raw == null ? "" : String(raw)).replace(/\D/g, "");
  }

  // Aplica a máscara progressivamente sobre dígitos crus.
  function format(raw) {
    var d = normalize(raw).slice(0, 20);
    var out = d.slice(0, 7);                            // NNNNNNN
    if (d.length > 7)  out += "-" + d.slice(7, 9);      // -DD
    if (d.length > 9)  out += "." + d.slice(9, 13);     // .AAAA
    if (d.length > 13) out += "." + d.slice(13, 14);    // .J
    if (d.length > 14) out += "." + d.slice(14, 16);    // .TR
    if (d.length > 16) out += "." + d.slice(16, 20);    // .OOOO
    return out;
  }

  // Quebra os 20 dígitos nos campos do número CNJ. Retorna null se != 20 dígitos.
  function parse(raw) {
    var d = normalize(raw);
    if (d.length !== 20) return null;
    return {
      sequencial: d.slice(0, 7),
      verificador: d.slice(7, 9),
      ano: d.slice(9, 13),
      segmento: d.slice(13, 14),
      tribunal: d.slice(14, 16),
      origem: d.slice(16, 20),
      digitos: d,
    };
  }

  // Recalcula o dígito verificador esperado (ISO 7064, MOD 97-10).
  // Concatena na ordem de cálculo (sequencial+ano+J+TR+origem), não na de exibição.
  function digitoEsperado(parsed) {
    if (!parsed) return null;
    var concat = parsed.sequencial + parsed.ano + parsed.segmento + parsed.tribunal + parsed.origem;
    var dv = 98n - (BigInt(concat) * 100n) % 97n;
    return String(dv).padStart(2, "0");
  }

  // Valida o dígito verificador: o DD informado bate com o recalculado.
  function validate(parsed) {
    if (!parsed) return false;
    return digitoEsperado(parsed) === parsed.verificador;
  }

  // Sugere candidatos que passam no DV, sem corrigir ou alterar a entrada.
  // A interface decide se o usuário quer aplicar um deles.
  function sugerirCorrecoes(raw) {
    var digitos = normalize(raw);
    var parsed = parse(digitos);
    if (!parsed || validate(parsed)) return [];

    var candidatos = new Map();
    function adicionar(numero, tipo) {
      if (numero === digitos || candidatos.has(numero)) return;
      if (validate(parse(numero))) candidatos.set(numero, { numero: numero, tipo: tipo });
    }

    for (var indice = 0; indice < digitos.length; indice += 1) {
      for (var digito = 0; digito <= 9; digito += 1) {
        var substituto = String(digito);
        if (substituto === digitos.charAt(indice)) continue;
        adicionar(digitos.slice(0, indice) + substituto + digitos.slice(indice + 1), "um_digito");
      }
    }

    for (var posicao = 0; posicao < digitos.length - 1; posicao += 1) {
      if (digitos.charAt(posicao) === digitos.charAt(posicao + 1)) continue;
      adicionar(
        digitos.slice(0, posicao) + digitos.charAt(posicao + 1) + digitos.charAt(posicao) + digitos.slice(posicao + 2),
        "transposicao_adjacente",
      );
    }

    return Array.from(candidatos.values());
  }

  // Junta parse + tabelas + validação numa descrição pronta para exibir.
  function describe(raw) {
    var parsed = parse(raw);
    if (!parsed) return null;

    var segmentoNome = TABLES.SEGMENTOS[parsed.segmento] || "Segmento desconhecido (" + parsed.segmento + ")";
    var tribunal = TABLES.nomeTribunal(parsed.segmento, parsed.tribunal);

    var out = {
      valido: validate(parsed),
      digitoEsperado: digitoEsperado(parsed),
      segmentoNome: segmentoNome,
      segmentoConhecido: Boolean(TABLES.SEGMENTOS[parsed.segmento]),
      tribunalNome: tribunal.nome,
      tribunalConhecido: tribunal.conhecido,
      formatado: format(parsed.digitos),
    };
    for (var k in parsed) { if (parsed.hasOwnProperty(k)) out[k] = parsed[k]; }
    return out;
  }

  global.CNJ = {
    normalize: normalize,
    format: format,
    parse: parse,
    validate: validate,
    sugerirCorrecoes: sugerirCorrecoes,
    digitoEsperado: digitoEsperado,
    describe: describe,
  };
})(typeof window !== "undefined" ? window : globalThis);
