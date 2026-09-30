/**
 * Recolector de respuestas (Menti casero) — versión para muchos estudiantes a la vez
 * No define preguntas: solo guarda lo que llega y devuelve lo guardado.
 *
 * Instalación: Hoja de cálculo > Extensiones > Apps Script > pegar este código.
 * 1) Cambia CLAVE y SECRETO.  2) Ejecuta "autorizar" una vez.
 * 3) Implementar > Administrar implementaciones > (lápiz) > Versión: Nueva versión > Implementar.
 *    Así la URL /exec NO cambia y no hay que tocar config.js.
 *
 * Qué cambió respecto a la versión anterior:
 *  - Ya no se usa LockService: appendRow() es atómico, y el candado hacía que los votos se
 *    guardaran de a uno (con 100 niños a la vez, los últimos esperaban más de 15 s y fallaban).
 *  - La ronda de cada pregunta se guarda en CacheService (rápido) además de PropertiesService.
 *  - Se ignoran los envíos repetidos con el mismo código "v" (reintentos del celular).
 *  - "leer" (la pantalla del profesor) se guarda 2 s en caché: no recorre toda la hoja en cada consulta.
 *
 * Código de sorteo (nuevo):
 *  - Cada celular elige 4 dígitos al azar y los envía con cada voto ("n"). Aquí se les antepone una
 *    letra verificadora que solo se puede calcular con SECRETO, y el código completo (ej. K4827) se
 *    guarda en la columna F y se devuelve al celular. Cero llamadas extra: viaja en el mismo "enviar".
 *  - "sorteo" lee la hoja UNA vez para todas las preguntas de la tanda y devuelve (código, pregunta,
 *    respuesta). La corrección la hace la pantalla del profesor: la alternativa correcta nunca sale de ahí.
 *  - En la hoja "Respuestas" agrega el encabezado "codigo" en la celda F1 (solo es una etiqueta).
 */

const CLAVE = "PON_AQUI_TU_CLAVE"; // la piden los botones "Nueva ronda" y "Sortear"
const SECRETO = "PON_AQUI_TU_SECRETO"; // solo tú lo sabes: de él sale la letra verificadora del código
const HOJA = "Respuestas";
const DIGITOS = 4; // largo de la parte numérica del código (debe coincidir con votar.html)
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O: se confunden con 1 y 0
const RE_DIGITOS = new RegExp("^[1-9]\\d{" + (DIGITOS - 1) + "}$");
const RE_CODIGO = new RegExp("^[" + LETRAS + "]\\d{" + DIGITOS + "}$");

function doGet(e) {
  const p = e.parameter;
  let out;
  try {
    if (p.accion === "sorteo") {
      out = sorteo_(p.qs, p.clave); // recibe varias preguntas (qs), no una sola (q)
    } else {
      const q = String(p.q || "").slice(0, 40);
      if (!q) throw new Error("Falta el identificador de la pregunta");
      switch (p.accion) {
        case "enviar": out = enviar_(q, p.r, p.t, p.v, p.n); break;
        case "leer":   out = leer_(q); break;
        case "estado": out = { ronda: ronda_(q) }; break;
        case "ronda":  out = nuevaRonda_(q, p.clave); break;
        default: throw new Error("Acción desconocida");
      }
    }
  } catch (err) {
    out = { error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Ejecutar UNA vez desde el editor para dar permisos y crear la pestaña */
function autorizar() {
  hoja_();
}

function hoja_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA);
  if (!h) {
    h = ss.insertSheet(HOJA);
    h.appendRow(["fecha", "id_pregunta", "ronda", "pregunta", "respuesta", "codigo"]);
    h.setFrozenRows(1);
  }
  return h;
}

function ronda_(q) {
  const cache = CacheService.getScriptCache();
  const c = cache.get("ronda_" + q);
  if (c !== null) return Number(c) || 1;
  const r = Number(PropertiesService.getScriptProperties().getProperty("ronda_" + q)) || 1;
  cache.put("ronda_" + q, String(r), 600);
  return r;
}

/* Letra verificadora: sale de los dígitos y de SECRETO (HMAC). Sin el secreto no se puede escribir a mano un código que el servidor no emitió */
function letra_(digitos) {
  const firma = Utilities.computeHmacSha256Signature(String(digitos), SECRETO);
  return LETRAS.charAt((firma[0] & 255) % LETRAS.length);
}

function codigo_(digitos) {
  return letra_(digitos) + digitos;
}

function codigoValido_(c) {
  return RE_CODIGO.test(c) && letra_(c.slice(1)) === c.charAt(0);
}

function enviar_(q, r, t, v, n) {
  r = String(r || "").trim().slice(0, 500);
  if (!r) throw new Error("Respuesta vacía");
  t = String(t || "").slice(0, 300);
  v = String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  // Sin "n" válido (enlaces antiguos o preguntas sueltas) el voto se guarda igual, pero sin código
  n = String(n || "");
  const codigo = RE_DIGITOS.test(n) ? codigo_(n) : "";
  const cache = CacheService.getScriptCache();
  const claveV = v ? "v_" + q + "_" + v : "";
  if (claveV) {
    const antes = cache.get(claveV);
    if (antes !== null) return conCodigo_({ ok: true, ronda: Number(antes) || ronda_(q), repetido: true }, codigo);
  }
  const ronda = ronda_(q);
  // appendRow es atómico: no hace falta candado (y el candado serializaba a todos los estudiantes)
  // El apóstrofo obliga a guardar como texto (evita fórmulas y conversiones a número/fecha)
  hoja_().appendRow([new Date(), "'" + q, ronda, "'" + t, "'" + r, codigo ? "'" + codigo : ""]);
  if (claveV) cache.put(claveV, String(ronda), 21600);
  return conCodigo_({ ok: true, ronda: ronda }, codigo);
}

function conCodigo_(out, codigo) {
  if (codigo) out.codigo = codigo;
  return out;
}

function leer_(q) {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get("leer_" + q);
  if (guardado !== null) return JSON.parse(guardado);
  const ronda = ronda_(q);
  const h = hoja_();
  const n = h.getLastRow();
  const filas = n > 1 ? h.getRange(2, 1, n - 1, 5).getValues() : [];
  const respuestas = filas
    .filter(f => String(f[1]) === q && Number(f[2]) === ronda)
    .map(f => String(f[4]));
  const out = { ronda: ronda, respuestas: respuestas };
  const s = JSON.stringify(out);
  if (s.length < 90000) cache.put("leer_" + q, s, 2);
  return out;
}

/* Una sola lectura de la hoja para toda la tanda. La clave evita que un estudiante lea los códigos de los demás. */
function sorteo_(qs, clave) {
  if (clave !== CLAVE) throw new Error("Clave incorrecta");
  const ids = String(qs || "").split(",").map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, 30);
  if (!ids.length) throw new Error("Faltan las preguntas de la tanda");
  const rondas = Object.create(null); // solo cuenta la ronda vigente de cada pregunta
  ids.forEach(q => { rondas[q] = ronda_(q); });
  const h = hoja_();
  const n = h.getLastRow();
  const filas = n > 1 ? h.getRange(2, 1, n - 1, 6).getValues() : [];
  const votos = [];
  const validez = new Map(); // un mismo código aparece en cada pregunta: se comprueba una sola vez
  let invalidos = 0;
  filas.forEach(f => {
    const q = String(f[1]);
    if (!(q in rondas) || Number(f[2]) !== rondas[q]) return;
    const c = String(f[5] || "");
    if (!c) return; // voto sin código
    if (!validez.has(c)) validez.set(c, codigoValido_(c));
    if (!validez.get(c)) { invalidos++; return; }
    votos.push([c, q, String(f[4])]);
  });
  return { votos: votos, invalidos: invalidos };
}

function nuevaRonda_(q, clave) {
  if (clave !== CLAVE) throw new Error("Clave incorrecta");
  const r = ronda_(q) + 1;
  PropertiesService.getScriptProperties().setProperty("ronda_" + q, String(r));
  const cache = CacheService.getScriptCache();
  cache.put("ronda_" + q, String(r), 600);
  cache.remove("leer_" + q);
  return { ok: true, ronda: r };
}
