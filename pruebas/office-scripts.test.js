"use strict";
// Prueba del backend de Office Scripts fuera de Excel: se compila el .ts con tsc y se ejecuta sobre un libro simulado
// (hojas y tablas en memoria).   node --test pruebas/office-scripts.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

function compilar() {
  const tsc = path.join(execFileSync("npm", ["root", "-g"]).toString().trim(), "typescript", "bin", "tsc");
  if (!fs.existsSync(tsc)) return null;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "office-"));
  execFileSync(process.execPath, [tsc, "--target", "es2019", "--lib", "es2019", "--outDir", out,
    path.join(__dirname, "..", "office-scripts", "Recolector.ts"), path.join(__dirname, "office", "excelscript.d.ts")]);
  return fs.readFileSync(path.join(out, "Recolector.js"), "utf8");
}

/* Libro de Excel simulado: hojas con celdas y tablas con encabezado + filas */
function libro() {
  const hojas = new Map(), tablas = new Map();
  const col = letra => letra.charCodeAt(0) - 65;
  const rango = (hoja, r0, c0, r1, c1) => ({
    _hoja: hoja, _pos: { r0, c0, r1, c1 },
    getValues: () => { const out = []; for (let r = r0; r <= r1; r++) { const fila = []; for (let c = c0; c <= c1; c++) fila.push(hoja.celdas[r]?.[c] ?? ""); out.push(fila); } return out; },
    setValues: v => v.forEach((fila, i) => fila.forEach((x, j) => { (hoja.celdas[r0 + i] ||= [])[c0 + j] = x; })),
    getResizedRange: (dr, dc) => rango(hoja, r0, c0, r1 + dr, c1 + dc),
    setNumberFormat: () => {},
    getRowCount: () => r1 - r0 + 1,
  });
  const hojaDe = nombre => {
    const h = { nombre, celdas: [], getName: () => nombre };
    h.getRange = addr => {
      if (!addr) return rango(h, 0, 0, 0, 0);
      let m = addr.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      if (m) return rango(h, Number(m[2]) - 1, col(m[1]), Number(m[4] || m[2]) - 1, col(m[3] || m[1]));
      m = addr.match(/^([A-Z]+):([A-Z]+)$/);
      if (m) return rango(h, 0, col(m[1]), 1000, col(m[2]));
      throw new Error("rango no soportado: " + addr);
    };
    h.getUsedRange = () => {
      const filas = h.celdas.length;
      if (!filas) return undefined;
      const cols = Math.max(...h.celdas.map(f => (f ? f.length : 0)));
      return rango(h, 0, 0, filas - 1, cols - 1);
    };
    return h;
  };
  const wb = {
    getWorksheet: n => hojas.get(n),
    addWorksheet: n => { const h = hojaDe(n); hojas.set(n, h); return h; },
    getTable: n => tablas.get(n),
    addTable(r) {
      const ancho = r._pos.c1 - r._pos.c0 + 1;
      const t = { hoja: r._hoja, nombre: "", filas: [],
        setName(n) { this.nombre = n; tablas.set(n, this); }, getName() { return this.nombre; },
        getRowCount() { return this.filas.length; },
        getRangeBetweenHeaderAndTotal() { const filas = this.filas; return { getValues: () => (filas.length ? filas.map(f => f.slice()) : [new Array(ancho).fill("")]), getRowCount: () => Math.max(1, filas.length) }; },
        addRows(i, vals) { vals.forEach(v => this.filas.push(v.map(x => String(x)))); },
        deleteRowsAt(i, n) { this.filas.splice(i, n); },
      };
      return t;
    },
  };
  return { wb, hojas, tablas };
}

const codigo = compilar();

test("Office Scripts: configurar, entrar, abrir, lote, leer, ronda, sorteo, bloqueo", { skip: codigo ? false : "sin tsc" }, () => {
  const { wb, hojas, tablas } = libro();
  const g = { Date, JSON, Math, Number, String, Object, Array, RegExp, Error, Map, decodeURIComponent, console };
  vm.createContext(g);
  vm.runInContext(codigo, g, { filename: "Recolector.js" });
  const llamar = p => JSON.parse(g.main(wb, JSON.stringify(p)));

  // 1.ª ejecución desde Excel: crea las hojas y pide la clave
  let r = JSON.parse(g.main(wb));
  assert.match(r.aviso || JSON.stringify(r), /Escribe tu clave/);
  assert.ok(hojas.has("Respuestas") && hojas.has("Estado") && hojas.has("Config"));
  assert.ok(tablas.has("TRespuestas") && tablas.has("TEstado"));
  const config = hojas.get("Config");
  assert.equal(config.celdas[0][0], "CLAVE_NUEVA");
  assert.equal(config.celdas[2][0], "SECRETO");
  assert.equal(config.celdas[2][1].length, 128);
  assert.equal(llamar({ accion: "entrar", clave: "x" }).error.startsWith("Falta configurar la clave"), true);

  // el profesor escribe la clave en B1 y ejecuta otra vez
  config.celdas[0][1] = "mi-clave-office-2026";
  r = JSON.parse(g.main(wb));
  assert.match(r.aviso, /Clave guardada/);
  assert.equal(config.celdas[0][1], "", "la clave en claro se borró de la celda");
  const hash = config.celdas[1][1];
  assert.match(hash, /^sha256i\$2000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  // el hash es el mismo esquema que en Apps Script: lo recalculamos con Node
  const [, iter, sal, h] = hash.split("$");
  let hh = crypto.createHash("sha256").update(sal + "mi-clave-office-2026", "utf8").digest();
  for (let i = 1; i < Number(iter); i++) hh = crypto.createHash("sha256").update(Buffer.concat([hh, Buffer.from(sal, "utf8")])).digest();
  assert.equal(hh.toString("hex"), h, "SHA-256 en TypeScript puro coincide con el de Node");
  assert.equal(g.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(g.sha256Hex("ñandú y más de 56 caracteres para forzar dos bloques del algoritmo de hash......"), crypto.createHash("sha256").update("ñandú y más de 56 caracteres para forzar dos bloques del algoritmo de hash......", "utf8").digest("hex"));
  assert.equal(Buffer.from(g.hmacSha256("clave", "mensaje")).toString("hex"), crypto.createHmac("sha256", "clave").update("mensaje").digest("hex"));

  assert.equal(llamar({ accion: "info" }).backend, "office-scripts");
  assert.equal(llamar({ accion: "entrar", clave: "mala" }).error, "Clave incorrecta");
  const e = llamar({ accion: "entrar", clave: "mi-clave-office-2026" });
  assert.ok(e.ok && e.token.length === 64);
  const token = e.token;
  assert.deepEqual(llamar({ accion: "sesion", token }), { ok: true });

  // también acepta la consulta como cadena a=1&b=2
  assert.deepEqual(JSON.parse(g.main(wb, "accion=estados&qs=q1%2Cq2")), { rondas: { q1: 1, q2: 1 }, abiertas: { q1: false, q2: false } });
  const lote = JSON.stringify([["q1", "1,5", "¿RR?"], ["q2", "7", "¿Cuántas?"]]);
  assert.equal(llamar({ accion: "lote", d: lote, v: "abc", n: "48271" }).error, "Votación cerrada");
  assert.deepEqual(llamar({ accion: "abrir", qs: "q1,q2", abrir: "1", token }), { ok: true, abierta: true });
  const r1 = llamar({ accion: "lote", d: lote, v: "abc", n: "48271" });
  assert.deepEqual(r1.rondas, { q1: 1, q2: 1 });
  assert.match(r1.codigo, /^[A-HJ-NP-Z]48271$/);
  assert.equal(llamar({ accion: "lote", d: lote, v: "abc", n: "48271" }).repetido, true);
  assert.equal(tablas.get("TRespuestas").filas.length, 2);
  assert.equal(tablas.get("TRespuestas").filas[0][4], "1,5", "la coma decimal se guarda tal cual");
  llamar({ accion: "lote", d: JSON.stringify([["q1"], ["q2", "9", "t"]]), v: "zz", n: "11111" });
  assert.deepEqual(llamar({ accion: "leer", q: "q2" }), { ronda: 1, respuestas: ["7", "9"], abierta: true, version: 4 });
  assert.deepEqual(llamar({ accion: "ronda", q: "q1", token }), { ok: true, ronda: 2 });
  assert.deepEqual(llamar({ accion: "leer", q: "q1" }).respuestas, []);
  const so = llamar({ accion: "sorteo", qs: "q1,q2", token });
  assert.equal(so.invalidos, 0);
  assert.deepEqual(so.votos.map(v => v[1]), ["q2", "q2"]);
  assert.equal(llamar({ accion: "sorteo", qs: "q1,q2" }).error, "Sesión vencida: vuelve a entrar");
  // código inventado → inválido
  tablas.get("TRespuestas").filas.push([new Date().toISOString(), "q2", "1", "t", "x", (r1.codigo[0] === "A" ? "B" : "A") + "48271"]);
  assert.equal(llamar({ accion: "sorteo", qs: "q1,q2", token }).invalidos, 1);
  // envío individual
  assert.equal(llamar({ accion: "enviar", q: "q2", r: "hola", v: "v1", n: "22222" }).ronda, 1);
  assert.equal(llamar({ accion: "enviar", q: "q2", r: "hola", v: "v1", n: "22222" }).repetido, true);
  // el estado quedó en la tabla (sobrevive entre ejecuciones del flujo)
  const estado = Object.fromEntries(tablas.get("TEstado").filas);
  assert.equal(estado.ronda_q1, "2");
  assert.equal(estado.abierta_q2, "1");
  assert.ok(Object.keys(estado).some(k => k.startsWith("ses_")));
  // bloqueo
  for (let i = 0; i < 5; i++) llamar({ accion: "entrar", clave: "mala" });
  assert.match(llamar({ accion: "entrar", clave: "mi-clave-office-2026" }).error, /^Demasiados intentos/);
  assert.deepEqual(llamar({ accion: "salir", token }), { ok: true });
  assert.equal(llamar({ accion: "sesion", token }).error, "Sesión vencida: vuelve a entrar");
  assert.equal(llamar({ accion: "nada", q: "q1" }).error, "Acción desconocida");
  assert.equal(JSON.parse(g.main(wb, "{{")).aviso !== undefined, true, "consulta inválida = modo configurar (inofensivo)");
});
