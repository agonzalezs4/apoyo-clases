// node pruebas/recopilacion.test.js — comprueba "repaso" del Apps Script y la cola de recopilar.js, sin red
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const raiz = path.join(__dirname, "..");

/* ---- Apps Script ---- */
function script(autorizadas) {
  const hojas = {}, cache = {};
  const ctx = vm.createContext({
    SpreadsheetApp: { getActive: () => ({
      getSheetByName: n => hojas[n] || null,
      insertSheet: n => (hojas[n] = { filas: [], appendRow(f) { this.filas.push(f); }, setFrozenRows() {} }),
    }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) },
    ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: {} },
  });
  const src = fs.readFileSync(path.join(raiz, "apps-script/Codigo.gs"), "utf8")
    .replace("const REPASOS_CON_REGISTRO = [];", "const REPASOS_CON_REGISTRO = " + JSON.stringify(autorizadas) + ";");
  vm.runInContext(src, ctx);
  return { get: p => JSON.parse(ctx.doGet({ parameter: p })), hojas };
}
const d = JSON.stringify([["p1", "Tema", "=HYPERLINK(1)", 1], ["p2", "x".repeat(500), "r".repeat(900), "sí"]]);

let s = script([]); // lista vacía (por defecto): todo se rechaza y no se crea la hoja
assert.match(s.get({ accion: "repaso", clase: "c1", d, s: "abc" }).error, /no registra/);
assert.deepStrictEqual(s.hojas, {});

s = script(["c1"]);
assert.match(s.get({ accion: "repaso", clase: "otra", d }).error, /no registra/);
assert.deepStrictEqual(s.get({ accion: "repaso", clase: "c1", d, s: "ab<c>", v: "v1" }), { ok: true, n: 2 });
const f = s.hojas.Repaso.filas;
assert.strictEqual(f[0].join(), ["fecha", "clase", "id_pregunta", "tema", "respuesta", "correcta", "sesion"].join());
assert.strictEqual(JSON.stringify(f[1].slice(1)), JSON.stringify(["'c1", "'p1", "'Tema", "'=HYPERLINK(1)", 1, "'abc"]));
assert.strictEqual(f[2][3].length, 101); assert.strictEqual(f[2][4].length, 301); assert.strictEqual(f[2][5], 0);
assert.strictEqual(s.get({ accion: "repaso", clase: "c1", d, v: "v1" }).repetido, true); // reintento: no duplica
assert.strictEqual(f.length, 3);
s.get({ accion: "repaso", clase: "c1", d: JSON.stringify(Array.from({ length: 50 }, (_, i) => ["q" + i, "", "r", 0])) });
assert.strictEqual(f.length, 3 + 10); // tope de filas por llamada
assert.ok(!s.hojas.Respuestas); // no toca la hoja de votación
assert.match(s.get({ accion: "lote", d: JSON.stringify([["q", "r", "t"]]) }).error, /./); // las acciones de antes siguen despachándose

/* ---- recopilar.js ---- */
function pagina(apiFalsa, mem = {}) {
  const timers = [], botones = ["1", "0"].map(v => ({ dataset: { enviar: v } })), cambiar = {};
  const ctx = vm.createContext({
    crypto: require("crypto").webcrypto, TypeError,
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } },
    setTimeout: fn => timers.push(fn), api: apiFalsa, addEventListener() {}, document: { addEventListener() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(raiz, "recopilar.js"), "utf8") + ";this.R = Recopilar;", ctx);
  const cont = { innerHTML: "", querySelectorAll: () => botones, querySelector: () => cambiar };
  // elegir en el aviso y volver a pasar por el inicio, como hace repasar.html
  const entrar = (datos, v) => { const seguir = () => R.aviso("c1", datos, cont, seguir); const r = seguir(); if (v) botones[v === "1" ? 0 : 1].onclick(); return r; };
  const R = ctx.R;
  return { R, cont, timers, entrar, mem };
}
const tick = () => new Promise(r => setImmediate(r));
(async () => {
  let llamadas = [], falla = null;
  const api = p => { llamadas.push(p); return falla ? Promise.reject(falla) : Promise.resolve({ ok: true }); };
  const responder = (R, n, desde = 0) => { for (let i = desde; i < desde + n; i++) R.registrar("p" + i, "t", "alt", i % 2); };

  let p = pagina(api); // sin "recopilar": no hay aviso ni llamadas
  assert.strictEqual(p.entrar({ p: [] }), false);
  assert.strictEqual(p.cont.innerHTML, "");
  responder(p.R, 7); p.R.terminar();
  assert.strictEqual(llamadas.length, 0);

  p = pagina(api); // con aviso, «sin enviar»
  assert.strictEqual(p.entrar({ recopilar: true }), true); // sin elección previa: pregunta y espera
  assert.ok(p.cont.innerHTML.includes("No llevan nota"));
  p.entrar({ recopilar: true }, "0"); assert.ok(p.cont.innerHTML.includes("no se envían")); responder(p.R, 7); p.R.terminar();
  assert.strictEqual(llamadas.length, 0);

  p = pagina(api); // «enviar»: grupos de 5 + resto al terminar, solo primer intento
  p.entrar({ recopilar: true }, "1");
  responder(p.R, 7); responder(p.R, 7); p.R.terminar(); p.R.terminar();
  assert.deepStrictEqual(llamadas.map(l => JSON.parse(l.d).length), [5, 2]);
  assert.deepStrictEqual(Object.keys(llamadas[0]).sort(), ["accion", "clase", "d", "s", "v"]);
  assert.strictEqual(llamadas[0].s, llamadas[1].s);

  llamadas = []; falla = new TypeError("sin red"); // corte de red: un reintento y se descarta
  p = pagina(api); p.entrar({ recopilar: true }, "1");
  responder(p.R, 5); await tick();
  assert.strictEqual(p.timers.length, 1); p.timers[0](); await tick();
  assert.strictEqual(llamadas.length, 2); assert.strictEqual(p.timers.length, 1);
  assert.strictEqual(llamadas[0].v, llamadas[1].v); // mismo id de envío: el servidor no duplica

  llamadas = []; falla = new Error("Este repaso no registra respuestas"); // rechazo del servidor: deja de enviar
  p = pagina(api); p.entrar({ recopilar: true }, "1");
  responder(p.R, 5); await tick(); responder(p.R, 5, 5); p.R.terminar();
  assert.strictEqual(llamadas.length, 1); assert.strictEqual(p.timers.length, 0);

  llamadas = []; falla = null; // tras recargar: la elección guardada vale sin volver a preguntar
  p = pagina(api, { repaso_enviar: "1" });
  assert.strictEqual(p.entrar({ recopilar: true }), false);
  responder(p.R, 5); assert.strictEqual(llamadas.length, 1);
  p = pagina(api, { repaso_enviar: "1" }); // la elección guardada no vale si la clase no trae "recopilar"
  p.entrar({}); responder(p.R, 5); assert.strictEqual(llamadas.length, 1);
  console.log("ok");
})();
