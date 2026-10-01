"use strict";
// Pruebas del servidor propio:  npm test   (o: node --test servidor/servidor.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Almacen, Api, crearServidor, hashClave, totp, totpValido, validarClase, CERRADA, SIN_SESION } = require("./servidor.js");

const CLAVE = "clave-de-prueba";

async function levantar(opciones = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recolector-"));
  const datos = path.join(dir, "datos"), clases = path.join(dir, "clases");
  fs.mkdirSync(clases);
  const secretos = { claveHash: hashClave(CLAVE, 1024), totp: opciones.totp || "", secreto: "secreto-de-prueba" };
  const almacen = new Almacen(datos);
  const api = new Api(almacen, secretos, { clases });
  const servidor = crearServidor({ api, raiz: path.resolve(__dirname, ".."), clases });
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const llamar = async params => {
    const u = new URL("/api", base);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return (await fetch(u)).json();
  };
  return { base, llamar, api, almacen, datos, clases, secretos, cerrar: () => new Promise(r => servidor.close(r)) };
}

test("flujo completo: entrar, abrir, votar, leer, nueva ronda, sorteo, salir", async () => {
  const s = await levantar();
  try {
    const info = await s.llamar({ accion: "info" });
    assert.equal(info.version, 4);
    assert.equal(info.backend, "servidor");
    assert.equal(info.clases, true);
    assert.equal(info.segundoPaso, "");

    assert.equal((await s.llamar({ accion: "entrar", clave: "otra" })).error, "Clave incorrecta");
    const e = await s.llamar({ accion: "entrar", clave: CLAVE });
    assert.ok(e.ok && e.token.length === 64 && e.expira > Date.now());
    const token = e.token;
    assert.deepEqual(await s.llamar({ accion: "sesion", token }), { ok: true });
    assert.equal((await s.llamar({ accion: "sesion", token: "x".repeat(64) })).error, SIN_SESION);

    // la tanda parte cerrada
    const est = await s.llamar({ accion: "estados", qs: "q1,q2" });
    assert.deepEqual(est, { rondas: { q1: 1, q2: 1 }, abiertas: { q1: false, q2: false } });
    const lote = JSON.stringify([["q1", "Riesgo relativo", "¿Qué medida…?"], ["q2", "7", "¿Cuántas…?"]]);
    assert.equal((await s.llamar({ accion: "lote", d: lote, v: "abc123", n: "48271" })).error, CERRADA);

    // sin sesión no se abre
    assert.equal((await s.llamar({ accion: "abrir", qs: "q1,q2", abrir: "1" })).error, SIN_SESION);
    assert.deepEqual(await s.llamar({ accion: "abrir", qs: "q1,q2", abrir: "1", token }), { ok: true, abierta: true });

    const r1 = await s.llamar({ accion: "lote", d: lote, v: "abc123", n: "48271" });
    assert.deepEqual(r1.rondas, { q1: 1, q2: 1 });
    assert.match(r1.codigo, /^[A-HJ-NP-Z]48271$/);
    assert.ok(s.api.codigoValido(r1.codigo));
    assert.ok(!s.api.codigoValido("A48271") || r1.codigo === "A48271"); // solo una letra es la correcta

    // reintento del mismo lote: no duplica
    const r2 = await s.llamar({ accion: "lote", d: lote, v: "abc123", n: "48271" });
    assert.equal(r2.repetido, true);
    assert.equal(r2.codigo, r1.codigo);
    let l = await s.llamar({ accion: "leer", q: "q1" });
    assert.deepEqual(l, { ronda: 1, respuestas: ["Riesgo relativo"], abierta: true, version: 4 });

    // segundo estudiante, pregunta en blanco viaja solo con su id
    const r3 = await s.llamar({ accion: "lote", d: JSON.stringify([["q1"], ["q2", "9", "t"]]), v: "zzz9", n: "11111" });
    assert.ok(r3.ok && r3.codigo.endsWith("11111"));
    assert.equal((await s.llamar({ accion: "leer", q: "q1" })).respuestas.length, 1);
    assert.equal((await s.llamar({ accion: "leer", q: "q2" })).respuestas.length, 2);

    // nueva ronda: el gráfico parte de cero y el sorteo solo cuenta la ronda vigente
    assert.deepEqual(await s.llamar({ accion: "ronda", q: "q1", token }), { ok: true, ronda: 2 });
    l = await s.llamar({ accion: "leer", q: "q1" });
    assert.equal(l.ronda, 2);
    assert.equal(l.respuestas.length, 0);
    assert.equal((await s.llamar({ accion: "sorteo", qs: "q1,q2" })).error, SIN_SESION);
    const so = await s.llamar({ accion: "sorteo", qs: "q1,q2", token });
    assert.equal(so.invalidos, 0);
    assert.deepEqual(so.votos.map(v => v[1]).sort(), ["q2", "q2"]);
    assert.ok(so.votos.some(v => v[0] === r1.codigo && v[2] === "7"));

    // envío individual (versión antigua de votar.html)
    const env = await s.llamar({ accion: "enviar", q: "q1", r: "hola", t: "t", v: "v1", n: "22222" });
    assert.equal(env.ronda, 2);
    assert.equal((await s.llamar({ accion: "enviar", q: "q1", r: "hola", t: "t", v: "v1", n: "22222" })).repetido, true);
    assert.equal((await s.llamar({ accion: "leer", q: "q1" })).respuestas.length, 1);

    // cerrar la votación
    await s.llamar({ accion: "abrir", qs: "q1,q2", abrir: "0", token });
    assert.equal((await s.llamar({ accion: "lote", d: lote, v: "nuevo", n: "33333" })).error, CERRADA);

    // acciones malformadas
    assert.equal((await s.llamar({ accion: "nada" })).error, "Falta el identificador de la pregunta");
    assert.equal((await s.llamar({ accion: "nada", q: "q1" })).error, "Acción desconocida");
    assert.equal((await s.llamar({ accion: "lote", d: "{{", v: "x" })).error, "Envío inválido");

    assert.deepEqual(await s.llamar({ accion: "salir", token }), { ok: true });
    assert.equal((await s.llamar({ accion: "sesion", token })).error, SIN_SESION);

    // lo guardado sobrevive a un reinicio
    const otro = new Almacen(s.datos);
    assert.equal(otro.estado.rondas.q1, 2);
    assert.equal(otro.respuestasDe("q2").length, 2);
  } finally { await s.cerrar(); }
});

test("clases: guardar, listar, servir y validar", async () => {
  const s = await levantar();
  try {
    const { token } = await s.llamar({ accion: "entrar", clave: CLAVE });
    const clase = { nombre: "clase-05", p: [
      { id: "a1", tipo: "alt", texto: "¿Cuál?", opciones: ["Uno", "Dos"], multi: false, idOrig: "zz" },
      { id: "b1", tipo: "esc", texto: "¿Cuánto?", min: 1, max: 5, etqMin: "Nada", etqMax: "Mucho" },
      { id: "c1", tipo: "abi", texto: "Di algo" },
      { id: "d1", tipo: "num", texto: "¿Número?", unidad: "%" },
    ] };
    assert.equal((await s.llamar({ accion: "guardarClase", nombre: "clase-05", d: JSON.stringify(clase) })).error, SIN_SESION);
    const g = await s.llamar({ accion: "guardarClase", nombre: "clase-05", d: JSON.stringify(clase), token });
    assert.deepEqual(g, { ok: true, nombre: "clase-05", preguntas: 4 });
    const guardada = JSON.parse(fs.readFileSync(path.join(s.clases, "clase-05.json"), "utf8"));
    assert.equal(guardada.p[0].idOrig, undefined); // campos del editor fuera
    assert.equal(guardada.p[1].etqMax, "Mucho");

    const lista = await s.llamar({ accion: "clases" });
    assert.equal(lista.clases.length, 1);
    assert.equal(lista.clases[0].nombre, "clase-05");
    assert.equal(lista.clases[0].preguntas, 4);

    const r = await fetch(s.base + "/clases/clase-05.json");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal((await r.json()).p.length, 4);

    assert.match((await s.llamar({ accion: "guardarClase", nombre: "../x", d: JSON.stringify(clase), token })).error, /Nombre de clase no válido/);
    assert.match((await s.llamar({ accion: "guardarClase", nombre: "ok", d: "{", token })).error, /formato válido/);
    assert.match((await s.llamar({ accion: "guardarClase", nombre: "ok", d: JSON.stringify({ p: [{ id: "x", tipo: "alt", texto: "t", opciones: ["solo una"] }] }), token })).error, /dos alternativas/);
    assert.match((await s.llamar({ accion: "guardarClase", nombre: "ok", d: JSON.stringify({ p: [{ id: "x", tipo: "abi", texto: "t", pagina: "https://evil" }] }), token })).error, /página/);
    assert.throws(() => validarClase({ p: [{ id: "a", tipo: "abi", texto: "t" }, { id: "a", tipo: "abi", texto: "t" }] }, "n"), /repetido/);
  } finally { await s.cerrar(); }
});

test("exportar: CSV con BOM, separado por ; y protegido por la sesión", async () => {
  const s = await levantar();
  try {
    const { token } = await s.llamar({ accion: "entrar", clave: CLAVE });
    await s.llamar({ accion: "abrir", qs: "p1", abrir: "1", token });
    await s.llamar({ accion: "lote", d: JSON.stringify([["p1", 'dijo "hola"; y chao', "¿Qué?"]]), v: "v", n: "12345" });
    const sinToken = await fetch(s.base + "/api?accion=exportar");
    assert.match(sinToken.headers.get("content-type"), /json/);
    assert.equal((await sinToken.json()).error, SIN_SESION);
    const r = await fetch(s.base + `/api?accion=exportar&token=${token}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/csv/);
    assert.match(r.headers.get("content-disposition"), /attachment; filename="respuestas-/);
    const bytes = Buffer.from(await r.arrayBuffer()); // text() quitaría el BOM: se mira en bruto
    assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
    const csv = bytes.subarray(3).toString("utf8");
    assert.ok(csv.startsWith("fecha;id_pregunta;ronda;pregunta;respuesta;codigo\r\n"));
    assert.match(csv, /;p1;1;¿Qué\?;"dijo ""hola""; y chao";[A-Z]12345\r\n$/);
  } finally { await s.cerrar(); }
});

test("archivos estáticos: páginas sí, carpetas privadas y rutas raras no, 404 con 404.html", async () => {
  const s = await levantar();
  try {
    let r = await fetch(s.base + "/");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.match(await r.text(), /Preguntas de la clase/);
    r = await fetch(s.base + "/votar.html?clase=ejemplo");
    assert.equal(r.status, 200);
    r = await fetch(s.base + "/fuentes/atkinson-hyperlegible-latin-400.woff2");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "font/woff2");
    r = await fetch(s.base + "/lib/qrcode.js");
    assert.equal(r.status, 200);
    for (const ruta of ["/servidor/servidor.js", "/datos/estado.json", "/.env", "/.git/config", "/..%2F..%2Fetc%2Fpasswd", "/apps-script/Codigo.gs", "/clases/..%2Findex.json"]) {
      r = await fetch(s.base + ruta);
      assert.equal(r.status, 404, ruta);
    }
    r = await fetch(s.base + "/10-1"); // dirección corta: la resuelve 404.html en el navegador
    assert.equal(r.status, 404);
    assert.match(await r.text(), /Abriendo la pregunta/);
    r = await fetch(s.base + "/salud");
    assert.deepEqual(await r.json(), { ok: true, version: 4 });
    r = await fetch(s.base + "/api?accion=info", { method: "POST" });
    assert.equal(r.status, 405);
  } finally { await s.cerrar(); }
});

test("límite de intentos: tras 5 fallos se bloquea, incluso con la clave correcta", async () => {
  const s = await levantar();
  try {
    for (let i = 0; i < 4; i++) assert.equal((await s.llamar({ accion: "entrar", clave: "mala" })).error, "Clave incorrecta");
    assert.equal((await s.llamar({ accion: "entrar", clave: "mala" })).error, "Clave incorrecta");
    const r = await s.llamar({ accion: "entrar", clave: CLAVE });
    assert.match(r.error, /^Demasiados intentos fallidos/);
    assert.ok(s.almacen.estado.acceso.bloqueadoHasta > Date.now());
    // una sesión ya abierta seguiría funcionando: el bloqueo es solo para entrar
    s.almacen.estado.acceso.bloqueadoHasta = 0;
    assert.ok((await s.llamar({ accion: "entrar", clave: CLAVE })).ok);
  } finally { await s.cerrar(); }
});

test("TOTP: vector de prueba de la RFC 6238 y segundo paso al entrar", async () => {
  const secreto = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890" en base32
  assert.equal(totp(secreto, 59 * 1000), "287082");
  assert.equal(totp(secreto, 1111111109 * 1000), "081804");
  assert.ok(totpValido(secreto, "287082", 59 * 1000));
  assert.ok(totpValido(secreto, "287082", 89 * 1000)); // un paso de tolerancia
  assert.ok(!totpValido(secreto, "287082", 200 * 1000));
  const s = await levantar({ totp: secreto });
  try {
    assert.equal((await s.llamar({ accion: "info" })).segundoPaso, "totp");
    const paso = await s.llamar({ accion: "entrar", clave: CLAVE });
    assert.equal(paso.paso, "codigo");
    assert.equal(paso.reenvio, false);
    assert.match(paso.texto, /app autenticadora/);
    assert.equal((await s.llamar({ accion: "entrar", clave: CLAVE, codigo: "000000" })).error, "Código incorrecto");
    const codigo = totp(secreto);
    const ok = await s.llamar({ accion: "entrar", clave: CLAVE, codigo });
    assert.ok(ok.ok && ok.token);
    assert.equal((await s.llamar({ accion: "entrar", clave: CLAVE, codigo })).error, "Código incorrecto"); // el mismo código no vale dos veces
  } finally { await s.cerrar(); }
});
