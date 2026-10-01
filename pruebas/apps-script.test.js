"use strict";
// Prueba del Apps Script fuera de Google: se simulan los servicios (PropertiesService, CacheService, hoja, Utilities…)
// y se recorre el flujo completo.   node --test pruebas/apps-script.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const path = require("node:path");

function entorno() {
  const props = {}, cache = {}, filas = [], correos = [];
  const aSigned = buf => [...buf].map(b => (b > 127 ? b - 256 : b)); // Apps Script devuelve bytes con signo
  const deSigned = arr => Buffer.from(arr.map(b => b & 255));
  const hoja = {
    appendRow: f => filas.push(f),
    getLastRow: () => filas.length + 1,
    setFrozenRows() {},
    getRange: (r, c, n, w) => ({ getValues: () => filas.slice(r - 2, r - 2 + n).map(f => f.slice(c - 1, c - 1 + w).map(v => (typeof v === "string" && v.startsWith("'") ? v.slice(1) : v))) }),
  };
  const g = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; },
      getProperties: () => ({ ...props }),
      setProperties: o => { Object.keys(o).forEach(k => { props[k] = String(o[k]); }); },
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => (k in cache ? cache[k] : null),
      put: (k, v) => { cache[k] = String(v); },
      remove: k => { delete cache[k]; },
      getAll: ks => { const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; },
      putAll: o => { Object.keys(o).forEach(k => { cache[k] = String(o[k]); }); },
      removeAll: ks => ks.forEach(k => { delete cache[k]; }),
    }) },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => hoja, insertSheet: () => hoja }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (alg, data) => aSigned(crypto.createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : deSigned(data)).digest()),
      computeHmacSha256Signature: (v, k) => aSigned(crypto.createHmac("sha256", k).update(v).digest()),
      getUuid: () => crypto.randomUUID(),
      newBlob: s => ({ getBytes: () => aSigned(Buffer.from(s, "utf8")) }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { sendEmail: (para, asunto, cuerpo) => correos.push({ para, asunto, cuerpo }), getRemainingDailyQuota: () => 100 },
    Session: { getEffectiveUser: () => ({ getEmail: () => "profe@ejemplo.cl" }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ setMimeType: () => ({ texto: s }) }) },
    Logger: { log() {} },
    Date, JSON, Math, Number, String, Object, Array, RegExp, Error, parseInt,
  };
  vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "apps-script", "Codigo.gs"), "utf8"), g, { filename: "Codigo.gs" });
  return { g, props, cache, filas, correos, llamar: p => JSON.parse(g.doGet({ parameter: p }).texto) };
}

test("Apps Script: configurar genera clave y secreto; entrar con código por correo; votar; sorteo", () => {
  const e = entorno();
  assert.equal(e.llamar({ accion: "info" }).version, 4);
  assert.equal(e.llamar({ accion: "info" }).segundoPaso, "correo");
  assert.match(e.llamar({ accion: "entrar", clave: "x" }).error, /Falta ejecutar «configurar»/);

  // sin CLAVE_NUEVA: clave al azar por correo, hash guardado, nada en claro
  e.g.configurar();
  assert.equal(e.correos.length, 1);
  const clave = e.correos[0].cuerpo.match(/es:\n\n\s+(\S+)/)[1];
  assert.equal(clave.length, 14);
  assert.match(e.props.CLAVE_HASH, /^sha256i\$5000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(e.props.SECRETO && e.props.SECRETO.length === 64);
  assert.equal(e.props.CLAVE_NUEVA, undefined);
  assert.ok(!JSON.stringify(e.props).includes(clave));

  // clave mala, clave buena → código al correo → sesión
  assert.equal(e.llamar({ accion: "entrar", clave: "mala" }).error, "Clave incorrecta");
  const paso = e.llamar({ accion: "entrar", clave });
  assert.deepEqual(paso, { paso: "codigo", correo: "pr…@ejemplo.cl" });
  const codigo = e.correos[1].asunto.match(/^(\d{6}) es tu código/)[1];
  assert.equal(e.llamar({ accion: "entrar", clave, codigo: "000000" }).error, "Código incorrecto");
  const s = e.llamar({ accion: "entrar", clave, codigo });
  assert.ok(s.ok && s.token.length === 64);
  const token = s.token;
  assert.deepEqual(e.llamar({ accion: "sesion", token }), { ok: true });

  // cambiar la clave con CLAVE_NUEVA
  e.props.CLAVE_NUEVA = "mi-clave-nueva-2026";
  const hashAntes = e.props.CLAVE_HASH;
  e.g.configurar();
  assert.notEqual(e.props.CLAVE_HASH, hashAntes);
  assert.equal(e.props.CLAVE_NUEVA, undefined);
  assert.equal(e.llamar({ accion: "entrar", clave }).error, "Clave incorrecta");
  assert.equal(e.llamar({ accion: "entrar", clave: "mi-clave-nueva-2026" }).paso, "codigo");
  assert.equal(e.correos.length, 3);

  // votación: cerrada → abrir → lote → leer → ronda → sorteo
  assert.deepEqual(e.llamar({ accion: "estados", qs: "q1,q2" }), { rondas: { q1: 1, q2: 1 }, abiertas: { q1: false, q2: false } });
  const lote = JSON.stringify([["q1", "Riesgo relativo", "¿Qué?"], ["q2", "7", "¿Cuántas?"]]);
  assert.equal(e.llamar({ accion: "lote", d: lote, v: "abc", n: "48271" }).error, CERRADA_());
  assert.equal(e.llamar({ accion: "abrir", qs: "q1,q2", abrir: "1" }).error, "Sesión vencida: vuelve a entrar");
  assert.deepEqual(e.llamar({ accion: "abrir", qs: "q1,q2", abrir: "1", token }), { ok: true, abierta: true });
  const r1 = e.llamar({ accion: "lote", d: lote, v: "abc", n: "48271" });
  assert.deepEqual(r1.rondas, { q1: 1, q2: 1 });
  assert.match(r1.codigo, /^[A-HJ-NP-Z]48271$/);
  assert.equal(e.filas.length, 2);
  assert.equal(e.filas[0][1], "'q1"); // texto forzado con apóstrofo
  assert.equal(e.llamar({ accion: "lote", d: lote, v: "abc", n: "48271" }).repetido, true);
  assert.equal(e.filas.length, 2);
  e.llamar({ accion: "lote", d: JSON.stringify([["q1"], ["q2", "9", "t"]]), v: "zz", n: "11111" });
  assert.equal(e.filas.length, 3);
  let l = e.llamar({ accion: "leer", q: "q2" });
  assert.deepEqual(l, { ronda: 1, respuestas: ["7", "9"], abierta: true, version: 4 });
  assert.deepEqual(e.llamar({ accion: "ronda", q: "q1", token }), { ok: true, ronda: 2 });
  l = e.llamar({ accion: "leer", q: "q1" });
  assert.equal(l.ronda, 2);
  assert.deepEqual(l.respuestas, []);
  const so = e.llamar({ accion: "sorteo", qs: "q1,q2", token });
  assert.equal(so.invalidos, 0);
  assert.deepEqual(so.votos.map(v => v[1]), ["q2", "q2"]);
  assert.ok(so.votos.some(v => v[0] === r1.codigo && v[2] === "7"));
  // un código inventado (letra equivocada) se ignora en el sorteo
  const letraMala = r1.codigo[0] === "A" ? "B" : "A";
  e.filas.push([new Date(), "'q2", 1, "'t", "'1", "'" + letraMala + "48271"]);
  e.cache["leer_q2"] = undefined; delete e.cache["leer_q2"];
  assert.equal(e.llamar({ accion: "sorteo", qs: "q1,q2", token }).invalidos, 1);

  // bloqueo por intentos
  for (let i = 0; i < 5; i++) e.llamar({ accion: "entrar", clave: "mala" });
  assert.match(e.llamar({ accion: "entrar", clave: "mi-clave-nueva-2026" }).error, /^Demasiados intentos/);
  assert.match(e.correos[e.correos.length - 1].asunto, /bloqueado/);
  e.g.desbloquearAcceso();
  assert.equal(e.llamar({ accion: "entrar", clave: "mi-clave-nueva-2026" }).paso, "codigo");

  assert.deepEqual(e.llamar({ accion: "salir", token }), { ok: true });
  assert.equal(e.llamar({ accion: "sesion", token }).error, "Sesión vencida: vuelve a entrar");
  e.g.cerrarSesiones();
  assert.ok(!Object.keys(e.props).some(k => k.startsWith("ses_")));
});

function CERRADA_() { return "Votación cerrada"; }
