#!/usr/bin/env node
"use strict";
/**
 * Servidor propio del recolector de respuestas (la alternativa a Google Apps Script y a Office Scripts).
 * Sirve las páginas del sitio y guarda las respuestas en archivos. Sin dependencias: solo Node 18 o superior.
 *
 *   node servidor/servidor.js              (o: npm start, o Docker; ver docs/INSTALACION.md)
 *
 * Variables de entorno (todas opcionales salvo la clave):
 *   CLAVE_PROFESOR        clave del profesor en texto plano (se convierte en hash al arrancar y no se guarda)
 *   CLAVE_PROFESOR_HASH   o bien el hash que genera `node servidor/configurar.js` (recomendado: la clave no queda en ningún archivo)
 *   TOTP_SECRETO          segundo paso con una app autenticadora (lo genera configurar.js). Vacío = solo la clave
 *   PUERTO (8080), HOST (0.0.0.0), HORAS_SESION (12), INTENTOS_MAX (5), MINUTOS_BLOQUEO (15), DIGITOS_CODIGO (5)
 *   DATOS (./datos)       carpeta con las respuestas y el estado;  CLASES (./clases) carpeta de las clases publicadas
 *   RAIZ                  carpeta con las páginas (por defecto, la carpeta del proyecto)
 *   LOG=1                 escribe cada consulta en la consola
 *
 * El contrato de la API (las mismas acciones que los otros backends) está en docs/API.md.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RAIZ = path.resolve(process.env.RAIZ || path.join(__dirname, ".."));
const DATOS = path.resolve(process.env.DATOS || path.join(RAIZ, "datos"));
const CLASES = path.resolve(process.env.CLASES || path.join(RAIZ, "clases"));
const PUERTO = Number(process.env.PUERTO || process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const HORAS_SESION = Number(process.env.HORAS_SESION || 12);
const INTENTOS_MAX = Number(process.env.INTENTOS_MAX || 5);
const MINUTOS_BLOQUEO = Number(process.env.MINUTOS_BLOQUEO || 15);
const DIGITOS = Number(process.env.DIGITOS_CODIGO || 5);
const LOG = process.env.LOG === "1";

const VERSION = 4; // 2 = "lote"; 3 = "abrir" y "entrar"; 4 = "info", "clases", "guardarClase", "exportar"
const SIN_SESION = "Sesión vencida: vuelve a entrar"; // profesor.js reconoce este texto
const CERRADA = "Votación cerrada"; // votar.html reconoce este texto
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O: se confunden con 1 y 0
const RE_DIGITOS = new RegExp("^[1-9]\\d{" + (DIGITOS - 1) + "}$");
const RE_CODIGO = new RegExp("^[" + LETRAS + "]\\d{" + DIGITOS + "}$");
const RE_NOMBRE_CLASE = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const TIPOS = new Set(["alt", "esc", "abi", "num"]);
const SEIS_HORAS = 6 * 3600000;

/* =============================== Secretos =============================== */

function hashClave(clave, N = 16384) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(clave), sal, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${sal.toString("hex")}$${h.toString("hex")}`;
}

function verificarClave(clave, guardado) {
  return new Promise(resolver => {
    const partes = String(guardado || "").split("$");
    if (partes.length !== 4 || partes[0] !== "scrypt") return resolver(false);
    const N = Number(partes[1]), sal = Buffer.from(partes[2], "hex"), esperado = Buffer.from(partes[3], "hex");
    crypto.scrypt(String(clave || ""), sal, esperado.length, { N, r: 8, p: 1 }, (err, h) => {
      resolver(!err && h.length === esperado.length && crypto.timingSafeEqual(h, esperado));
    });
  });
}

function leerSecretos() {
  let archivo = {};
  try { archivo = JSON.parse(fs.readFileSync(path.join(DATOS, "secretos.json"), "utf8")); } catch (e) {}
  const s = {
    claveHash: process.env.CLAVE_PROFESOR_HASH || (process.env.CLAVE_PROFESOR ? hashClave(process.env.CLAVE_PROFESOR) : archivo.claveHash || ""),
    totp: (process.env.TOTP_SECRETO !== undefined ? process.env.TOTP_SECRETO : archivo.totp || "").replace(/[\s=-]/g, "").toUpperCase(),
  };
  // El secreto de la letra verificadora se genera solo una vez y se guarda: así los códigos del sorteo siguen valiendo tras reiniciar
  const rutaSecreto = path.join(DATOS, "secreto.txt");
  if (process.env.SECRETO) s.secreto = process.env.SECRETO;
  else {
    try { s.secreto = fs.readFileSync(rutaSecreto, "utf8").trim(); } catch (e) {}
    if (!s.secreto) { s.secreto = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(rutaSecreto, s.secreto + "\n", { mode: 0o600 }); }
  }
  return s;
}

/* ============================ TOTP (RFC 6238) ============================ */

function base32Decodificar(s) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, valor = 0;
  const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    valor = (valor << 5) | alfabeto.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function totp(secretoBase32, t = Date.now(), pasoSeg = 30) {
  const contador = Math.floor(t / 1000 / pasoSeg);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(contador / 0x100000000), 0);
  buf.writeUInt32BE(contador >>> 0, 4);
  const h = crypto.createHmac("sha1", base32Decodificar(secretoBase32)).update(buf).digest();
  const o = h[19] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}

function totpValido(secreto, codigo, ahora = Date.now()) {
  codigo = String(codigo || "").replace(/\D/g, "");
  if (codigo.length !== 6) return false;
  const c = Buffer.from(codigo);
  return [-1, 0, 1].some(d => crypto.timingSafeEqual(Buffer.from(totp(secreto, ahora + d * 30000)), c)); // un paso de tolerancia al reloj
}

/* ============================== Almacenamiento ============================== */

const sha256 = s => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");

function escribirAtomico(ruta, contenido) {
  const tmp = ruta + ".tmp";
  fs.writeFileSync(tmp, contenido);
  fs.renameSync(tmp, ruta);
}

class Almacen {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.rutaEstado = path.join(dir, "estado.json");
    this.rutaRespuestas = path.join(dir, "respuestas.ndjson");
    this.estado = { rondas: {}, abiertas: {}, sesiones: {}, acceso: { fallos: 0, bloqueadoHasta: 0, ultimoTotp: "" }, lotes: {}, votos: {} };
    try { Object.assign(this.estado, JSON.parse(fs.readFileSync(this.rutaEstado, "utf8"))); } catch (e) {}
    this.estado.acceso = Object.assign({ fallos: 0, bloqueadoHasta: 0, ultimoTotp: "" }, this.estado.acceso);
    this.filas = []; // { f, q, r, t, v, c }  (fecha, pregunta, ronda, texto, respuesta, código)
    this.porPregunta = new Map();
    try {
      for (const linea of fs.readFileSync(this.rutaRespuestas, "utf8").split("\n")) {
        if (!linea.trim()) continue;
        try { this._indexar(JSON.parse(linea)); } catch (e) { console.error("Línea dañada en respuestas.ndjson (se ignora):", linea.slice(0, 80)); }
      }
    } catch (e) {}
  }
  _indexar(fila) {
    this.filas.push(fila);
    if (!this.porPregunta.has(fila.q)) this.porPregunta.set(fila.q, []);
    this.porPregunta.get(fila.q).push(fila);
  }
  agregarRespuesta(fila) {
    fs.appendFileSync(this.rutaRespuestas, JSON.stringify(fila) + "\n");
    this._indexar(fila);
  }
  respuestasDe(q) { return this.porPregunta.get(q) || []; }
  guardar() {
    // lo caducado no se guarda: sesiones vencidas y envíos duplicados de hace más de 6 h
    const ahora = Date.now(), e = this.estado;
    for (const k of Object.keys(e.sesiones)) if (e.sesiones[k] < ahora) delete e.sesiones[k];
    for (const k of Object.keys(e.lotes)) if (ahora - (e.lotes[k].t || 0) > SEIS_HORAS) delete e.lotes[k];
    for (const k of Object.keys(e.votos)) if (ahora - (e.votos[k].t || 0) > SEIS_HORAS) delete e.votos[k];
    escribirAtomico(this.rutaEstado, JSON.stringify(e));
  }
}

/* ================================== API ================================== */

class Api {
  constructor(almacen, secretos, opciones = {}) {
    this.a = almacen;
    this.s = secretos;
    this.clases = opciones.clases || CLASES;
    this.entrando = Promise.resolve(); // los intentos de entrar se atienden de a uno
  }

  /* ---- código de sorteo: letra verificadora = HMAC(dígitos, SECRETO) ---- */
  letra(digitos) {
    const firma = crypto.createHmac("sha256", this.s.secreto).update(String(digitos)).digest();
    return LETRAS.charAt(firma[0] % LETRAS.length);
  }
  codigo(digitos) { return this.letra(digitos) + digitos; }
  codigoValido(c) { return RE_CODIGO.test(c) && this.letra(c.slice(1)) === c.charAt(0); }

  ronda(q) { return Number(this.a.estado.rondas[q]) || 1; }
  abierta(q) { return this.a.estado.abiertas[q] === true; }

  ids(qs) {
    const ids = String(qs || "").split(",").map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, 30);
    if (!ids.length) throw new Error("Faltan las preguntas de la tanda");
    return ids;
  }

  info() {
    return { version: VERSION, backend: "servidor", clases: true, exportar: true, segundoPaso: this.s.totp ? "totp" : "" };
  }

  estados(qs) {
    const rondas = {}, abiertas = {};
    this.ids(qs).forEach(q => { rondas[q] = this.ronda(q); abiertas[q] = this.abierta(q); });
    return { rondas, abiertas };
  }

  leer(q) {
    const ronda = this.ronda(q);
    const respuestas = this.a.respuestasDe(q).filter(f => Number(f.r) === ronda).map(f => f.v);
    return { ronda, respuestas, abierta: this.abierta(q), version: VERSION };
  }

  enviar(q, r, t, v, n) {
    r = String(r || "").trim().slice(0, 500);
    if (!r) throw new Error("Respuesta vacía");
    t = String(t || "").slice(0, 300);
    v = String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    n = String(n || "");
    const codigo = RE_DIGITOS.test(n) ? this.codigo(n) : "";
    const claveV = v ? q + "_" + v : "";
    if (claveV && this.a.estado.votos[claveV]) return this.conCodigo({ ok: true, ronda: this.a.estado.votos[claveV].ronda, repetido: true }, codigo);
    if (!this.abierta(q)) throw new Error(CERRADA);
    const ronda = this.ronda(q);
    this.a.agregarRespuesta({ f: new Date().toISOString(), q, r: ronda, t, v: r, c: codigo });
    if (claveV) { this.a.estado.votos[claveV] = { ronda, t: Date.now() }; this.a.guardar(); }
    return this.conCodigo({ ok: true, ronda }, codigo);
  }

  /* Guarda de una vez las respuestas de la tanda. d = JSON [[pregunta, respuesta, texto], ...]
     Una pregunta en blanco viaja como [pregunta]: no se guarda, solo se devuelve su ronda */
  lote(d, v, n) {
    let items;
    try { items = JSON.parse(String(d || "")); } catch (e) { throw new Error("Envío inválido"); }
    if (!Array.isArray(items) || !items.length) throw new Error("No hay respuestas que guardar");
    items = items.slice(0, 30).map(it => {
      it = Array.isArray(it) ? it : [];
      return { q: String(it[0] || "").slice(0, 40), r: String(it[1] || "").trim().slice(0, 500), t: String(it[2] || "").slice(0, 300) };
    });
    if (items.some(it => !it.q)) throw new Error("Falta el identificador de la pregunta");
    if (!items.some(it => it.r)) throw new Error("Respuesta vacía");
    v = String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    n = String(n || "");
    const codigo = RE_DIGITOS.test(n) ? this.codigo(n) : "";
    if (v && this.a.estado.lotes[v]) { // reintento de un lote ya guardado: se devuelve lo mismo
      const o = Object.assign({}, this.a.estado.lotes[v].out);
      o.repetido = true;
      return o;
    }
    if (items.some(it => !this.abierta(it.q))) throw new Error(CERRADA);
    const ahora = new Date().toISOString(), rondas = {};
    for (const it of items) {
      rondas[it.q] = this.ronda(it.q);
      if (it.r) this.a.agregarRespuesta({ f: ahora, q: it.q, r: rondas[it.q], t: it.t, v: it.r, c: codigo });
    }
    const out = this.conCodigo({ ok: true, rondas }, codigo);
    if (v) { this.a.estado.lotes[v] = { out, t: Date.now() }; this.a.guardar(); }
    return out;
  }

  conCodigo(out, codigo) { if (codigo) out.codigo = codigo; return out; }

  abrir(qs, abrir, token) {
    this.exigirSesion(token);
    this.ids(qs).forEach(q => { this.a.estado.abiertas[q] = !!abrir; });
    this.a.guardar();
    return { ok: true, abierta: !!abrir };
  }

  nuevaRonda(q, token) {
    this.exigirSesion(token);
    const r = this.ronda(q) + 1;
    this.a.estado.rondas[q] = r;
    this.a.guardar();
    return { ok: true, ronda: r };
  }

  /* Votos con código de toda la tanda (ronda vigente), para corregir en el navegador del profesor */
  sorteo(qs, token) {
    this.exigirSesion(token);
    const votos = [], validez = new Map();
    let invalidos = 0;
    for (const q of this.ids(qs)) {
      const ronda = this.ronda(q);
      for (const f of this.a.respuestasDe(q)) {
        if (Number(f.r) !== ronda || !f.c) continue;
        if (!validez.has(f.c)) validez.set(f.c, this.codigoValido(f.c));
        if (!validez.get(f.c)) { invalidos++; continue; }
        votos.push([f.c, q, f.v]);
      }
    }
    return { votos, invalidos };
  }

  /* ---- acceso del profesor ---- */
  entrar(clave, codigo) {
    // de a uno: no se pueden lanzar miles de intentos en paralelo
    const p = this.entrando.then(() => this._entrar(clave, codigo));
    this.entrando = p.catch(() => {});
    return p;
  }

  async _entrar(clave, codigo) {
    if (!this.s.claveHash) throw new Error("Falta configurar la clave del profesor en el servidor (CLAVE_PROFESOR o servidor/configurar.js)");
    const acc = this.a.estado.acceso, ahora = Date.now();
    if (acc.bloqueadoHasta > ahora) throw new Error("Demasiados intentos fallidos. Espera " + Math.ceil((acc.bloqueadoHasta - ahora) / 60000) + " min y vuelve a intentarlo.");
    if (!(await verificarClave(clave, this.s.claveHash))) { this.fallo(); throw new Error("Clave incorrecta"); }
    if (this.s.totp) {
      codigo = String(codigo || "").replace(/\D/g, "");
      if (!codigo) return { paso: "codigo", texto: "Escribe el código de 6 dígitos de tu app autenticadora.", reenvio: false };
      if (!totpValido(this.s.totp, codigo) || codigo === acc.ultimoTotp) { this.fallo(); throw new Error("Código incorrecto"); }
      acc.ultimoTotp = codigo; // un código no sirve dos veces
    }
    acc.fallos = 0;
    return this.nuevaSesion();
  }

  fallo() {
    const acc = this.a.estado.acceso;
    acc.fallos = (acc.fallos || 0) + 1;
    if (acc.fallos >= INTENTOS_MAX) {
      acc.bloqueadoHasta = Date.now() + MINUTOS_BLOQUEO * 60000;
      acc.fallos = 0;
      console.error(`[${new Date().toISOString()}] Acceso del profesor bloqueado ${MINUTOS_BLOQUEO} min tras ${INTENTOS_MAX} intentos fallidos seguidos.`);
    }
    this.a.guardar();
  }

  nuevaSesion() {
    const token = crypto.randomBytes(32).toString("hex"); // 64 caracteres al azar
    const expira = Date.now() + HORAS_SESION * 3600000;
    this.a.estado.sesiones[sha256(token)] = expira; // se guarda el hash, no el token
    this.a.guardar();
    return { ok: true, token, expira };
  }

  exigirSesion(token) {
    token = String(token || "");
    const exp = token.length >= 32 ? this.a.estado.sesiones[sha256(token)] : 0;
    if (!exp || exp < Date.now()) throw new Error(SIN_SESION);
  }

  salir(token) {
    token = String(token || "");
    if (token.length >= 32) { delete this.a.estado.sesiones[sha256(token)]; this.a.guardar(); }
    return { ok: true };
  }

  /* ---- clases publicadas (solo este backend sabe guardarlas) ---- */
  listarClases() {
    let nombres = [];
    try { nombres = fs.readdirSync(this.clases).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)); } catch (e) {}
    const clases = nombres.filter(n => RE_NOMBRE_CLASE.test(n)).map(n => {
      let preguntas = 0, modificado = null;
      try {
        const ruta = path.join(this.clases, n + ".json");
        modificado = fs.statSync(ruta).mtime.toISOString();
        const c = JSON.parse(fs.readFileSync(ruta, "utf8"));
        preguntas = Array.isArray(c.p) ? c.p.length : 0;
      } catch (e) {}
      return { nombre: n, preguntas, modificado };
    });
    return { clases };
  }

  guardarClase(nombre, d, token) {
    this.exigirSesion(token);
    nombre = String(nombre || "");
    if (!RE_NOMBRE_CLASE.test(nombre)) throw new Error("Nombre de clase no válido: usa minúsculas, números y guiones (p. ej. clase-05)");
    let c;
    try { c = JSON.parse(String(d || "")); } catch (e) { throw new Error("La clase no tiene un formato válido"); }
    const limpia = validarClase(c, nombre);
    fs.mkdirSync(this.clases, { recursive: true });
    escribirAtomico(path.join(this.clases, nombre + ".json"), JSON.stringify(limpia, null, 2) + "\n");
    return { ok: true, nombre, preguntas: limpia.p.length };
  }

  /* ---- todas las respuestas, como planilla (CSV con ; y BOM, que Excel en español abre directo) ---- */
  exportarCsv(token) {
    this.exigirSesion(token);
    const celda = v => { const s = String(v == null ? "" : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lineas = ["fecha;id_pregunta;ronda;pregunta;respuesta;codigo"];
    for (const f of this.a.filas) lineas.push([f.f, f.q, f.r, f.t, f.v, f.c].map(celda).join(";"));
    return "﻿" + lineas.join("\r\n") + "\r\n";
  }
}

/* Deja la clase solo con los campos conocidos y dentro de límites razonables */
function validarClase(c, nombre) {
  if (!c || !Array.isArray(c.p) || !c.p.length) throw new Error("La clase no tiene preguntas");
  if (c.p.length > 50) throw new Error("Una clase puede tener hasta 50 preguntas");
  const texto = (s, max) => String(s == null ? "" : s).slice(0, max);
  const ids = new Set();
  const p = c.p.map((q, i) => {
    if (!q || typeof q !== "object") throw new Error(`La pregunta ${i + 1} no es válida`);
    if (!TIPOS.has(q.tipo)) throw new Error(`La pregunta ${i + 1} tiene un tipo desconocido`);
    const id = texto(q.id, 40).replace(/[^A-Za-z0-9_-]/g, "");
    if (!id || ids.has(id)) throw new Error(`La pregunta ${i + 1} no tiene un identificador válido o está repetido`);
    ids.add(id);
    const out = { id, tipo: q.tipo, texto: texto(q.texto, 1000) };
    if (!out.texto.trim()) throw new Error(`La pregunta ${i + 1} no tiene texto`);
    if (q.pagina) {
      const pag = texto(q.pagina, 200).trim();
      if (!/^[\w./-]+\.html?$/i.test(pag) || pag.includes("..")) throw new Error(`La pregunta ${i + 1}: la página debe ser un archivo .html de este sitio`);
      out.pagina = pag;
    }
    if (q.tipo === "alt") {
      out.opciones = (Array.isArray(q.opciones) ? q.opciones : []).slice(0, 30).map(o => texto(o, 300).trim()).filter(Boolean);
      if (out.opciones.length < 2) throw new Error(`La pregunta ${i + 1} necesita al menos dos alternativas`);
      out.multi = !!q.multi;
    }
    if (q.tipo === "esc") {
      out.min = Number.isInteger(q.min) ? q.min : 1;
      out.max = Number.isInteger(q.max) ? q.max : 5;
      if (!(out.max > out.min && out.max - out.min <= 10)) throw new Error(`La pregunta ${i + 1}: la escala debe ir de menor a mayor y tener como máximo 11 valores`);
      out.etqMin = texto(q.etqMin, 100);
      out.etqMax = texto(q.etqMax, 100);
    }
    if (q.tipo === "num") out.unidad = texto(q.unidad, 50);
    return out;
  });
  return { nombre, p };
}

/* ============================= Servidor HTTP ============================= */

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf", ".csv": "text/csv; charset=utf-8", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
};
const CARPETAS_PRIVADAS = new Set(["servidor", "datos", "node_modules", "office-scripts", "apps-script"]);

function responderJson(res, obj, status = 200) {
  const cuerpo = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*", // igual que Apps Script: así las páginas pueden estar en otro sitio (p. ej. GitHub Pages)
    "Content-Length": Buffer.byteLength(cuerpo),
  });
  res.end(cuerpo);
}

function crearServidor({ api, raiz = RAIZ, clases = CLASES }) {
  const servir = (req, res, rutaArchivo, cache) => {
    fs.stat(rutaArchivo, (err, st) => {
      if (err || !st.isFile()) return noEncontrado(req, res);
      const ext = path.extname(rutaArchivo).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Length": st.size,
        "Cache-Control": cache,
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(rutaArchivo).on("error", () => res.destroy()).pipe(res);
    });
  };
  const noEncontrado = (req, res) => {
    // Como en GitHub Pages: 404.html resuelve direcciones cortas (tu-sitio/10-1 → votar.html?clase=clase-10-1)
    const ruta404 = path.join(raiz, "404.html");
    fs.readFile(ruta404, (err, cuerpo) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(cuerpo);
    });
  };

  return http.createServer({ maxHeaderSize: 65536 }, (req, res) => {
    const t0 = Date.now();
    if (LOG) res.on("finish", () => console.log(`${new Date().toISOString()} ${req.method} ${req.url.split("?")[0]} ${res.statusCode} ${Date.now() - t0}ms`));
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
    let url;
    try { url = new URL(req.url, "http://x"); } catch (e) { res.writeHead(400); return res.end(); }
    const ruta = url.pathname;

    if (ruta === "/api" || ruta === "/api/") {
      const p = {};
      url.searchParams.forEach((v, k) => { if (!(k in p)) p[k] = v; });
      return atenderApi(api, p, res);
    }
    if (ruta === "/salud") return responderJson(res, { ok: true, version: VERSION });

    let rel;
    try { rel = decodeURIComponent(ruta); } catch (e) { res.writeHead(400); return res.end(); }
    if (rel.includes("\0")) { res.writeHead(400); return res.end(); }
    const segmentos = rel.split("/").filter(Boolean);
    if (segmentos.some(s => s === ".." || s.startsWith(".")) || CARPETAS_PRIVADAS.has(segmentos[0])) return noEncontrado(req, res);
    if (segmentos[0] === "clases" && segmentos.length === 2 && segmentos[1].endsWith(".json")) {
      // las clases pueden vivir en otra carpeta (volumen de Docker) y nunca se guardan en caché: recién publicadas, al instante
      if (!RE_NOMBRE_CLASE.test(segmentos[1].slice(0, -5))) return noEncontrado(req, res);
      return servir(req, res, path.join(clases, segmentos[1]), "no-store");
    }
    let archivo = path.resolve(raiz, ...segmentos);
    if (archivo !== raiz && !archivo.startsWith(raiz + path.sep)) return noEncontrado(req, res);
    if (!segmentos.length || rel.endsWith("/")) archivo = path.join(archivo, "index.html");
    const ext = path.extname(archivo).toLowerCase();
    if (!ext) return noEncontrado(req, res); // «/10-1»: 404.html lo convierte en la clase
    servir(req, res, archivo, ext === ".html" || ext === ".json" ? "no-cache" : "public, max-age=3600");
  });
}

async function atenderApi(api, p, res) {
  try {
    if (p.accion === "exportar") {
      const csv = api.exportarCsv(p.token);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="respuestas-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(csv);
    }
    let out;
    switch (p.accion) {
      case "info": out = api.info(); break;
      case "entrar": out = await api.entrar(p.clave, p.codigo); break;
      case "sesion": api.exigirSesion(p.token); out = { ok: true }; break;
      case "salir": out = api.salir(p.token); break;
      case "abrir": out = api.abrir(p.qs, p.abrir === "1", p.token); break;
      case "lote": out = api.lote(p.d, p.v, p.n); break;
      case "estados": out = api.estados(p.qs); break;
      case "sorteo": out = api.sorteo(p.qs, p.token); break;
      case "clases": out = api.listarClases(); break;
      case "guardarClase": out = api.guardarClase(p.nombre, p.d, p.token); break;
      default: {
        const q = String(p.q || "").slice(0, 40);
        if (!q) throw new Error("Falta el identificador de la pregunta");
        switch (p.accion) {
          case "enviar": out = api.enviar(q, p.r, p.t, p.v, p.n); break;
          case "leer": out = api.leer(q); break;
          case "estado": out = { ronda: api.ronda(q) }; break;
          case "ronda": out = api.nuevaRonda(q, p.token); break;
          default: throw new Error("Acción desconocida");
        }
      }
    }
    responderJson(res, out);
  } catch (err) {
    // 200 con {error}: es lo que esperan las páginas (igual que Apps Script, que no puede devolver otro código)
    responderJson(res, { error: String(err && err.message || err) });
  }
}

/* ================================= Arranque ================================= */

function arrancar() {
  fs.mkdirSync(DATOS, { recursive: true });
  const secretos = leerSecretos();
  if (!secretos.claveHash) {
    console.error([
      "",
      "Falta la clave del profesor. Elige una de estas dos formas:",
      "  1) node servidor/configurar.js      → pide la clave y guarda solo su hash en datos/secretos.json (recomendado)",
      "  2) variable de entorno CLAVE_PROFESOR=«tu clave»  (o CLAVE_PROFESOR_HASH con el hash que imprime configurar.js)",
      "Con Docker, ponla en el archivo .env (ver .env.ejemplo y docs/INSTALACION.md).",
      "",
    ].join("\n"));
    process.exit(1);
  }
  const almacen = new Almacen(DATOS);
  const api = new Api(almacen, secretos, { clases: CLASES });
  const servidor = crearServidor({ api, raiz: RAIZ, clases: CLASES });
  servidor.listen(PUERTO, HOST, () => {
    console.log(`Recolector de respuestas v${VERSION} escuchando en http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PUERTO}`);
    console.log(`  páginas: ${RAIZ}\n  clases:  ${CLASES}\n  datos:   ${DATOS}\n  segundo paso: ${secretos.totp ? "app autenticadora (TOTP)" : "no (solo clave)"}`);
  });
  const cerrar = () => { servidor.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on("SIGTERM", cerrar);
  process.on("SIGINT", cerrar);
}

if (require.main === module) arrancar();

module.exports = { Almacen, Api, crearServidor, hashClave, verificarClave, totp, totpValido, validarClase, VERSION, SIN_SESION, CERRADA };
