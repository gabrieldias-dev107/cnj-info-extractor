import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("UI usa dialog nativo e mantém dados remotos fora de HTML interpretado", () => {
  const html = readFileSync("index.html", "utf8");
  const app = readFileSync("js/app.js", "utf8");
  assert.match(html, /<dialog id="login-dialog"/);
  assert.match(html, /role="alert"/);
  assert.match(app, /\.showModal\(\)/);
  assert.match(app, /aria-busy/);
  assert.match(app, /consultaSeq/);
  assert.match(app, /ArrowRight/);
  assert.equal(/\.innerHTML\s*=/.test(app), false);
  assert.match(app, /textContent/);
});

test("UI apresenta o número CNJ como ficha processual com tokens do domínio", () => {
  const html = readFileSync("index.html", "utf8");
  const css = readFileSync("styles.css", "utf8");

  assert.match(html, /<header class="cabecalho">/);
  assert.match(html, /class="produto-marca"/);
  assert.match(html, /class="entrada ficha-entrada"/);
  assert.match(html, /aria-labelledby="entrada-titulo"/);

  assert.match(css, /--papel:/);
  assert.match(css, /--carbono:/);
  assert.match(css, /--azul-cnj:/);
  assert.match(css, /--controle-fundo:/);
  assert.match(css, /--raio-controle:\s*6px/);
  assert.match(css, /\.cards\s*{[^}]*gap:\s*1px/s);
  assert.match(css, /section\.ajuda\s*{/);
  assert.equal(/(^|\n)\.ajuda\s*\{/.test(css), false);
  assert.match(css, /\.btn-consultar\s*{[^}]*padding:\s*8px 16px/s);
  assert.match(css, /\.btn-secundario,[^}]*\.mostrar-mais\s*{[^}]*padding:\s*8px 12px/s);
  assert.match(css, /\.instancia-btn\s*{[^}]*padding:\s*8px 12px/s);
  assert.match(css, /\.btn-consultar:not\(:disabled\):hover/);
  assert.match(css, /\.btn-consultar:not\(:disabled\):active/);
  assert.equal(css.includes(".btn-consultar:hover"), false);
  assert.equal(css.includes(".btn-consultar:active"), false);
  assert.equal(css.includes("--shadow:"), false);
  assert.equal(css.includes("border-radius: 999px"), false);
  assert.equal(css.includes("transition: all"), false);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.dialog-acoes\s*\{\s*flex-direction:\s*column;\s*\}/);
  assert.equal(css.includes("flex-direction: column-reverse"), false);
  const componentes = css.slice(css.indexOf("}") + 1);
  assert.equal(/#[0-9a-f]{3,8}|rgba\(/i.test(componentes), false);
});

test("texto e limites dos controles mantêm contraste AA", () => {
  const css = readFileSync("styles.css", "utf8");
  assert.match(css, /--controle-borda:\s*#[0-9a-f]{6}/i);
  assert.match(css, /#cnj-input::placeholder\s*{\s*color:\s*var\(--grafite\)/);
  assert.match(css, /#cnj-input:focus\s*{[^}]*outline:\s*3px solid var\(--azul-cnj\)[^}]*outline-offset:\s*2px/s);
  assert.match(css, /dialog input\s*{[^}]*border:\s*1px solid var\(--controle-borda\)/s);
  assert.match(css, /dialog input:focus\s*{[^}]*outline:\s*3px solid var\(--azul-cnj\)[^}]*outline-offset:\s*2px/s);
  const token = (nome) => css.match(new RegExp(`--${nome}:\\s*#([0-9a-f]{6})`, "i"))[1];
  const luminancia = (hex) => {
    const canais = hex.match(/../g).map((canal) => parseInt(canal, 16) / 255)
      .map((canal) => canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4);
    return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
  };
  const contraste = (a, b) => {
    const valores = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
    return (valores[0] + 0.05) / (valores[1] + 0.05);
  };

  assert.ok(contraste(token("lapis"), token("papel")) >= 4.5);
  assert.ok(contraste(token("lapis"), token("papel-ficha")) >= 4.5);
  assert.ok(contraste(token("grafite"), token("controle-fundo")) >= 4.5);
  assert.ok(contraste(token("controle-borda"), token("papel-ficha")) >= 3);
  assert.ok(contraste(token("azul-cnj"), token("papel-ficha")) >= 3);
});
