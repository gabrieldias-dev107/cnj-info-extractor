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
