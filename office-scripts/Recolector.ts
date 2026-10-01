/**
 * Recolector de respuestas — backend en Office Scripts (Excel para la web, Microsoft 365) + Power Automate.
 * Para quien no tiene Google. Guarda las respuestas en un libro de Excel de OneDrive/SharePoint y responde
 * a las mismas acciones que los otros backends (docs/API.md). Cómo armar el flujo: office-scripts/README.md.
 *
 * Resumen:
 *  1) En Excel para la web: Automatizar › Nuevo script → pega este archivo → guárdalo como «Recolector».
 *  2) Pulsa «Ejecutar» una vez: crea las hojas Respuestas, Estado y Config.
 *     En Config, escribe tu clave de profesor en la celda B1 (fila CLAVE_NUEVA) y vuelve a ejecutar:
 *     guarda solo el hash y borra la clave de la celda.
 *  3) Power Automate: flujo «Cuando se recibe una solicitud HTTP» (GET) → Excel Online (Empresa) «Ejecutar script»
 *     con el parámetro consulta = string(triggerOutputs()?['queries']) → «Respuesta» 200 con el resultado del script
 *     y los encabezados Content-Type: application/json y Access-Control-Allow-Origin: *.
 *  4) Pega la URL del desencadenador HTTP en config.js (API_URL).
 *
 * Limitaciones honestas (ver README): el desencadenador HTTP de Power Automate es un conector premium, las ejecuciones
 * se encolan de a una (configúralo así: evita que dos corran a la vez sobre el libro) y hay cuotas de ejecuciones.
 * Sirve bien para cursos de unas decenas de estudiantes; para cientos, usa el servidor propio o Google.
 * Office Scripts no tiene criptografía incorporada, así que el SHA-256 va implementado aquí mismo, y los tokens
 * de sesión salen de Math.random mezclado con la hora (menos fuerte que en los otros backends).
 * Tampoco hay segundo paso por correo (se puede agregar en el flujo; README).
 */

/* ---------- Ajustes (se pueden cambiar) ---------- */
const HORAS_SESION = 12;   // cuánto dura la sesión del profesor en un navegador
const INTENTOS_MAX = 5;    // fallos seguidos antes de bloquear el acceso
const MINUTOS_BLOQUEO = 15;
const DIGITOS = 5;         // dígitos del código de sorteo (igual que DIGITOS_CODIGO en config.js)

/* ---------- No hace falta tocar lo que sigue ---------- */
const VERSION = 4;
const ITERACIONES = 2000;  // vueltas del hash de la clave (menos que en Apps Script: aquí el SHA-256 es en JavaScript puro)
const SIN_SESION = "Sesión vencida: vuelve a entrar";
const CERRADA = "Votación cerrada";
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const HOJA_RESPUESTAS = "Respuestas";
const HOJA_ESTADO = "Estado";
const HOJA_CONFIG = "Config";
const SEIS_HORAS = 6 * 3600000;

interface Peticion { [clave: string]: string; }
interface Salida { [clave: string]: unknown; }
type Celda = string | number | boolean;

function main(workbook: ExcelScript.Workbook, consulta?: string): string {
  const p = parsearConsulta(consulta);
  if (!p || p["accion"] === "configurar") return JSON.stringify(configurar(workbook));
  try {
    return JSON.stringify(atender(workbook, p));
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

/* La consulta llega como JSON ({"accion":"leer","q":"…"}) o como cadena a=1&b=2 */
function parsearConsulta(consulta?: string): Peticion | null {
  const s = (consulta || "").trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { [k: string]: unknown };
      const p: Peticion = {};
      Object.keys(o).forEach(k => { const v = o[k]; if (v !== null && v !== undefined) p[k] = String(v); });
      return p;
    } catch (e) { return null; }
  }
  const p: Peticion = {};
  s.replace(/^\?/, "").split("&").forEach(par => {
    const i = par.indexOf("=");
    const k = decodeURIComponent((i < 0 ? par : par.slice(0, i)).replace(/\+/g, " "));
    const v = i < 0 ? "" : decodeURIComponent(par.slice(i + 1).replace(/\+/g, " "));
    if (k) p[k] = v;
  });
  return Object.keys(p).length ? p : null;
}

/* ====================== Acciones ====================== */

function atender(wb: ExcelScript.Workbook, p: Peticion): Salida {
  const accion = p["accion"] || "";
  if (accion === "info") return { version: VERSION, backend: "office-scripts", clases: false, exportar: false, segundoPaso: "" };
  const cfg = leerConfig(wb);
  const est = new Estado(wb);
  const api = new Api(wb, cfg, est);
  try {
    return despachar(api, accion, p);
  } finally {
    est.guardar(); // también cuando la acción falló: un intento de clave fallido debe quedar contado
  }
}

function despachar(api: Api, accion: string, p: Peticion): Salida {
  let out: Salida;
  switch (accion) {
    case "entrar": out = api.entrar(p["clave"] || ""); break;
    case "sesion": api.exigirSesion(p["token"] || ""); out = { ok: true }; break;
    case "salir": out = api.salir(p["token"] || ""); break;
    case "abrir": out = api.abrir(p["qs"] || "", p["abrir"] === "1", p["token"] || ""); break;
    case "lote": out = api.lote(p["d"] || "", p["v"] || "", p["n"] || ""); break;
    case "estados": out = api.estados(p["qs"] || ""); break;
    case "sorteo": out = api.sorteo(p["qs"] || "", p["token"] || ""); break;
    default: {
      const q = (p["q"] || "").slice(0, 40);
      if (!q) throw new Error("Falta el identificador de la pregunta");
      switch (accion) {
        case "enviar": out = api.enviar(q, p["r"] || "", p["t"] || "", p["v"] || "", p["n"] || ""); break;
        case "leer": out = api.leer(q); break;
        case "estado": out = { ronda: api.ronda(q) }; break;
        case "ronda": out = api.nuevaRonda(q, p["token"] || ""); break;
        default: throw new Error("Acción desconocida");
      }
    }
  }
  return out;
}

class Api {
  constructor(private wb: ExcelScript.Workbook, private cfg: Map<string, string>, private est: Estado) {}

  /* ---- código de sorteo ---- */
  private letra(digitos: string): string {
    const secreto = this.cfg.get("SECRETO") || "";
    if (!secreto) throw new Error("Falta ejecutar el script una vez desde Excel para configurarlo");
    const firma = hmacSha256(secreto, digitos);
    return LETRAS.charAt(firma[0] % LETRAS.length);
  }
  codigo(digitos: string): string { return this.letra(digitos) + digitos; }
  codigoValido(c: string): boolean {
    const re = new RegExp("^[" + LETRAS + "]\\d{" + DIGITOS + "}$");
    return re.test(c) && this.letra(c.slice(1)) === c.charAt(0);
  }
  private digitosValidos(n: string): boolean { return new RegExp("^[1-9]\\d{" + (DIGITOS - 1) + "}$").test(n); }

  ronda(q: string): number { return Number(this.est.get("ronda_" + q)) || 1; }
  abierta(q: string): boolean { return this.est.get("abierta_" + q) === "1"; }

  private ids(qs: string): string[] {
    const ids = qs.split(",").map(s => s.trim().slice(0, 40)).filter(s => s.length > 0).slice(0, 30);
    if (!ids.length) throw new Error("Faltan las preguntas de la tanda");
    return ids;
  }

  estados(qs: string): Salida {
    const rondas: { [q: string]: number } = {}, abiertas: { [q: string]: boolean } = {};
    this.ids(qs).forEach(q => { rondas[q] = this.ronda(q); abiertas[q] = this.abierta(q); });
    return { rondas, abiertas };
  }

  leer(q: string): Salida {
    const ronda = this.ronda(q);
    const respuestas = filasRespuestas(this.wb).filter(f => f.q === q && f.ronda === ronda).map(f => f.r);
    return { ronda, respuestas, abierta: this.abierta(q), version: VERSION };
  }

  enviar(q: string, r: string, t: string, v: string, n: string): Salida {
    r = r.trim().slice(0, 500);
    if (!r) throw new Error("Respuesta vacía");
    t = t.slice(0, 300);
    v = v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    const codigo = this.digitosValidos(n) ? this.codigo(n) : "";
    const claveV = v ? "voto_" + q + "_" + v : "";
    if (claveV && this.est.get(claveV)) {
      const antes = JSON.parse(this.est.get(claveV)) as { ronda: number };
      return conCodigo({ ok: true, ronda: antes.ronda, repetido: true }, codigo);
    }
    if (!this.abierta(q)) throw new Error(CERRADA);
    const ronda = this.ronda(q);
    agregarRespuestas(this.wb, [[new Date().toISOString(), q, String(ronda), t, r, codigo]]);
    if (claveV) this.est.set(claveV, JSON.stringify({ ronda, t: Date.now() }));
    return conCodigo({ ok: true, ronda }, codigo);
  }

  lote(d: string, v: string, n: string): Salida {
    let crudo: unknown;
    try { crudo = JSON.parse(d); } catch (e) { throw new Error("Envío inválido"); }
    if (!Array.isArray(crudo) || !crudo.length) throw new Error("No hay respuestas que guardar");
    const items = (crudo as unknown[]).slice(0, 30).map(it => {
      const a = Array.isArray(it) ? (it as unknown[]) : [];
      return { q: String(a[0] || "").slice(0, 40), r: String(a[1] || "").trim().slice(0, 500), t: String(a[2] || "").slice(0, 300) };
    });
    if (items.some(it => !it.q)) throw new Error("Falta el identificador de la pregunta");
    if (!items.some(it => it.r)) throw new Error("Respuesta vacía");
    v = v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    const codigo = this.digitosValidos(n) ? this.codigo(n) : "";
    const claveV = v ? "lote_" + v : "";
    if (claveV && this.est.get(claveV)) {
      const antes = JSON.parse(this.est.get(claveV)) as { out: Salida };
      const o: Salida = {};
      Object.keys(antes.out).forEach(k => { o[k] = antes.out[k]; });
      o["repetido"] = true;
      return o;
    }
    if (items.some(it => !this.abierta(it.q))) throw new Error(CERRADA);
    const ahora = new Date().toISOString();
    const rondas: { [q: string]: number } = {};
    const filas: string[][] = [];
    items.forEach(it => {
      rondas[it.q] = this.ronda(it.q);
      if (it.r) filas.push([ahora, it.q, String(rondas[it.q]), it.t, it.r, codigo]);
    });
    if (filas.length) agregarRespuestas(this.wb, filas);
    const out = conCodigo({ ok: true, rondas }, codigo);
    if (claveV) this.est.set(claveV, JSON.stringify({ out, t: Date.now() }));
    return out;
  }

  abrir(qs: string, abrir: boolean, token: string): Salida {
    this.exigirSesion(token);
    this.ids(qs).forEach(q => this.est.set("abierta_" + q, abrir ? "1" : "0"));
    return { ok: true, abierta: abrir };
  }

  nuevaRonda(q: string, token: string): Salida {
    this.exigirSesion(token);
    const r = this.ronda(q) + 1;
    this.est.set("ronda_" + q, String(r));
    return { ok: true, ronda: r };
  }

  sorteo(qs: string, token: string): Salida {
    this.exigirSesion(token);
    const ids = this.ids(qs);
    const rondas: { [q: string]: number } = {};
    ids.forEach(q => { rondas[q] = this.ronda(q); });
    const votos: string[][] = [];
    const validez = new Map<string, boolean>();
    let invalidos = 0;
    filasRespuestas(this.wb).forEach(f => {
      if (!(f.q in rondas) || f.ronda !== rondas[f.q] || !f.codigo) return;
      if (!validez.has(f.codigo)) validez.set(f.codigo, this.codigoValido(f.codigo));
      if (!validez.get(f.codigo)) { invalidos++; return; }
      votos.push([f.codigo, f.q, f.r]);
    });
    return { votos, invalidos };
  }

  /* ---- acceso del profesor ---- */
  entrar(clave: string): Salida {
    const guardado = this.cfg.get("CLAVE_HASH") || "";
    if (!guardado) throw new Error("Falta configurar la clave: escribe CLAVE_NUEVA en la hoja Config y ejecuta el script desde Excel");
    const ahora = Date.now();
    const hasta = Number(this.est.get("acceso_bloqueado_hasta")) || 0;
    if (hasta > ahora) throw new Error("Demasiados intentos fallidos. Espera " + Math.ceil((hasta - ahora) / 60000) + " min y vuelve a intentarlo.");
    if (!verificarClave(clave, guardado)) {
      const n = (Number(this.est.get("acceso_fallos")) || 0) + 1;
      if (n >= INTENTOS_MAX) { this.est.set("acceso_bloqueado_hasta", String(ahora + MINUTOS_BLOQUEO * 60000)); this.est.del("acceso_fallos"); }
      else this.est.set("acceso_fallos", String(n));
      throw new Error("Clave incorrecta");
    }
    this.est.del("acceso_fallos");
    const token = azar() + azar().slice(0, 0); // 64 caracteres hexadecimales
    const expira = ahora + HORAS_SESION * 3600000;
    this.est.set("ses_" + sha256Hex(token), String(expira)); // se guarda el hash del token, no el token
    return { ok: true, token, expira };
  }

  exigirSesion(token: string): void {
    const exp = token.length >= 32 ? Number(this.est.get("ses_" + sha256Hex(token))) : 0;
    if (!exp || exp < Date.now()) throw new Error(SIN_SESION);
  }

  salir(token: string): Salida {
    if (token.length >= 32) this.est.del("ses_" + sha256Hex(token));
    return { ok: true };
  }
}

function conCodigo(out: Salida, codigo: string): Salida {
  if (codigo) out["codigo"] = codigo;
  return out;
}

/* ====================== Hojas ====================== */

interface FilaRespuesta { q: string; ronda: number; r: string; codigo: string; }

function tabla(wb: ExcelScript.Workbook, hoja: string, columnas: string[]): ExcelScript.Table {
  const existente = wb.getTable("T" + hoja);
  if (existente) return existente;
  let ws = wb.getWorksheet(hoja);
  if (!ws) ws = wb.addWorksheet(hoja);
  const enc = ws.getRange("A1").getResizedRange(0, columnas.length - 1);
  enc.setValues([columnas]);
  // todo como texto: Excel no debe convertir «1,5» o «7» ni interpretar fechas
  ws.getRange("A:" + String.fromCharCode(64 + columnas.length)).setNumberFormat("@");
  const t = wb.addTable(enc, true);
  t.setName("T" + hoja);
  return t;
}

function filasDe(t: ExcelScript.Table): Celda[][] {
  const r = t.getRangeBetweenHeaderAndTotal();
  if (!r) return [];
  return r.getValues().filter(f => String(f[0]) !== "");
}

function filasRespuestas(wb: ExcelScript.Workbook): FilaRespuesta[] {
  return filasDe(tabla(wb, HOJA_RESPUESTAS, ["fecha", "id_pregunta", "ronda", "pregunta", "respuesta", "codigo"]))
    .map(f => ({ q: String(f[1]), ronda: Number(f[2]) || 1, r: String(f[4]), codigo: String(f[5] || "") }));
}

function agregarRespuestas(wb: ExcelScript.Workbook, filas: string[][]): void {
  tabla(wb, HOJA_RESPUESTAS, ["fecha", "id_pregunta", "ronda", "pregunta", "respuesta", "codigo"]).addRows(-1, filas);
}

/* Estado: tabla clave/valor (rondas, aperturas, sesiones, intentos, envíos ya recibidos). Se lee entera una vez y se
   reescribe solo si cambió, podando lo caducado. */
class Estado {
  private mapa = new Map<string, string>();
  private cambiado = false;
  private t: ExcelScript.Table;
  constructor(wb: ExcelScript.Workbook) {
    this.t = tabla(wb, HOJA_ESTADO, ["clave", "valor"]);
    filasDe(this.t).forEach(f => this.mapa.set(String(f[0]), String(f[1])));
  }
  get(k: string): string { return this.mapa.get(k) || ""; }
  set(k: string, v: string): void { if (this.mapa.get(k) !== v) { this.mapa.set(k, v); this.cambiado = true; } }
  del(k: string): void { if (this.mapa.delete(k)) this.cambiado = true; }
  guardar(): void {
    if (!this.cambiado) return;
    const ahora = Date.now();
    this.mapa.forEach((v, k) => {
      if (k.startsWith("ses_") && Number(v) < ahora) this.mapa.delete(k);
      if ((k.startsWith("lote_") || k.startsWith("voto_")) && ahora - (JSON.parse(v) as { t?: number }).t! > SEIS_HORAS) this.mapa.delete(k);
    });
    const filas: string[][] = [];
    this.mapa.forEach((v, k) => filas.push([k, v]));
    const actuales = this.t.getRowCount();
    if (actuales > 0) this.t.deleteRowsAt(0, actuales);
    if (filas.length) this.t.addRows(-1, filas);
  }
}

/* Config: hoja con clave en la columna A y valor en la B (la edita el profesor) */
function leerConfig(wb: ExcelScript.Workbook): Map<string, string> {
  const m = new Map<string, string>();
  const ws = wb.getWorksheet(HOJA_CONFIG);
  if (!ws) return m;
  const r = ws.getUsedRange(true);
  if (!r) return m;
  r.getValues().forEach(f => { const k = String(f[0] || "").trim(); if (k) m.set(k, String(f[1] === undefined ? "" : f[1]).trim()); });
  return m;
}

/* Ejecutar desde Excel (botón «Ejecutar»): crea las hojas, genera el SECRETO y guarda el hash de la clave */
function configurar(wb: ExcelScript.Workbook): Salida {
  tabla(wb, HOJA_RESPUESTAS, ["fecha", "id_pregunta", "ronda", "pregunta", "respuesta", "codigo"]);
  tabla(wb, HOJA_ESTADO, ["clave", "valor"]);
  let ws = wb.getWorksheet(HOJA_CONFIG);
  if (!ws) ws = wb.addWorksheet(HOJA_CONFIG);
  const cfg = leerConfig(wb);
  const nueva = cfg.get("CLAVE_NUEVA") || "";
  let hash = cfg.get("CLAVE_HASH") || "";
  let aviso = "";
  if (nueva) {
    if (nueva.length < 8) return { error: "La clave es muy corta: usa 8 caracteres o más (mejor 12) y vuelve a ejecutar." };
    hash = hashClave(nueva, azar().slice(0, 32), ITERACIONES);
    aviso = "Clave guardada (solo su hash) y borrada de la celda. ";
  } else if (!hash) {
    aviso = "Escribe tu clave de profesor en la celda B1 (fila CLAVE_NUEVA) y ejecuta el script otra vez. ";
  } else {
    aviso = "La clave ya estaba configurada; para cambiarla escribe otra en B1 y vuelve a ejecutar. ";
  }
  const secreto = cfg.get("SECRETO") || azar() + azar();
  ws.getRange("A:C").setNumberFormat("@");
  ws.getRange("A1:C4").setValues([
    ["CLAVE_NUEVA", "", "← escribe aquí la clave de profesor y ejecuta el script; se guarda solo su hash y esta celda se borra"],
    ["CLAVE_HASH", hash, "hash de la clave (no es la clave). Para cambiarla usa CLAVE_NUEVA"],
    ["SECRETO", secreto, "firma de los códigos del sorteo: no lo compartas ni lo cambies con una tanda en curso"],
    ["", "", "Esta hoja solo la debe ver el profesor. Las respuestas llegan a la hoja Respuestas; Estado es interno."],
  ]);
  return { ok: true, aviso: aviso + "Ahora crea el flujo de Power Automate (office-scripts/README.md)." };
}

/* ====================== Criptografía en JavaScript puro ====================== */
// Office Scripts no trae SHA-256: esta implementación sigue FIPS 180-4 (misma salida que cualquier otra).

function utf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(i + 1) - 0xdc00); i++; }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function hex(bytes: number[]): string { return bytes.map(b => ("0" + (b & 255).toString(16)).slice(-2)).join(""); }

const K256: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Bytes(msg: number[]): number[] {
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const largoBits = msg.length * 8;
  const m = msg.slice();
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (largoBits / Math.pow(2, i * 8)) & 255); // largo en 64 bits (mensajes < 2^32 bits)
  const w = new Array<number>(64);
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3]) >>> 0;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out: number[] = [];
  H.forEach(x => out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255));
  return out;
}

function sha256Hex(s: string): string { return hex(sha256Bytes(utf8(s))); }

function hmacSha256(clave: string, mensaje: string): number[] {
  let k = utf8(clave);
  if (k.length > 64) k = sha256Bytes(k);
  while (k.length < 64) k.push(0);
  const ipad = k.map(b => b ^ 0x36), opad = k.map(b => b ^ 0x5c);
  return sha256Bytes(opad.concat(sha256Bytes(ipad.concat(utf8(mensaje)))));
}

/* Mismo formato que en Apps Script (sha256i$iteraciones$sal$hash): h = SHA256(sal+clave); luego h = SHA256(h + sal) */
function hashClave(clave: string, sal: string, iteraciones: number): string {
  const salBytes = utf8(sal);
  let h = sha256Bytes(utf8(sal + clave));
  for (let i = 1; i < iteraciones; i++) h = sha256Bytes(h.concat(salBytes));
  return "sha256i$" + iteraciones + "$" + sal + "$" + hex(h);
}

function verificarClave(clave: string, guardado: string): boolean {
  const partes = guardado.split("$");
  if (partes.length !== 4 || partes[0] !== "sha256i") return false;
  const calculado = hashClave(clave, partes[2], Number(partes[1]));
  // comparación de largo fijo
  let d = 0;
  for (let i = 0; i < calculado.length; i++) d |= calculado.charCodeAt(i) ^ (guardado.charCodeAt(i) || 0);
  return d === 0 && calculado.length === guardado.length;
}

/* 64 caracteres hexadecimales al azar. Office Scripts no tiene crypto.getRandomValues: se mezclan varios Math.random con la hora */
function azar(): string {
  let semilla = String(Date.now());
  for (let i = 0; i < 8; i++) semilla += "|" + Math.random().toString(36).slice(2);
  return sha256Hex(semilla);
}
