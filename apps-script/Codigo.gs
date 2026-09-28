/**
 * Recolector de respuestas (Menti casero) — versión para muchos estudiantes a la vez
 * No define preguntas: solo guarda lo que llega y devuelve lo guardado.
 *
 * Instalación: Hoja de cálculo > Extensiones > Apps Script > pegar este código.
 * 1) Cambia CLAVE.  2) Ejecuta "autorizar" una vez.
 * 3) Implementar > Administrar implementaciones > (lápiz) > Versión: Nueva versión > Implementar.
 *    Así la URL /exec NO cambia y no hay que tocar config.js.
 *
 * Qué cambió respecto a la versión anterior:
 *  - Ya no se usa LockService: appendRow() es atómico, y el candado hacía que los votos se
 *    guardaran de a uno (con 100 niños a la vez, los últimos esperaban más de 15 s y fallaban).
 *  - La ronda de cada pregunta se guarda en CacheService (rápido) además de PropertiesService.
 *  - Se ignoran los envíos repetidos con el mismo código "v" (reintentos del celular).
 *  - "leer" (la pantalla del profesor) se guarda 2 s en caché: no recorre toda la hoja en cada consulta.
 */

const CLAVE = "PON_AQUI_TU_CLAVE"; // la pide el botón "Nueva ronda"
const HOJA = "Respuestas";

function doGet(e) {
  const p = e.parameter;
  let out;
  try {
    const q = String(p.q || "").slice(0, 40);
    if (!q) throw new Error("Falta el identificador de la pregunta");
    switch (p.accion) {
      case "enviar": out = enviar_(q, p.r, p.t, p.v); break;
      case "leer":   out = leer_(q); break;
      case "estado": out = { ronda: ronda_(q) }; break;
      case "ronda":  out = nuevaRonda_(q, p.clave); break;
      default: throw new Error("Acción desconocida");
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
    h.appendRow(["fecha", "id_pregunta", "ronda", "pregunta", "respuesta"]);
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

function enviar_(q, r, t, v) {
  r = String(r || "").trim().slice(0, 500);
  if (!r) throw new Error("Respuesta vacía");
  t = String(t || "").slice(0, 300);
  v = String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  const cache = CacheService.getScriptCache();
  const claveV = v ? "v_" + q + "_" + v : "";
  if (claveV) {
    const antes = cache.get(claveV);
    if (antes !== null) return { ok: true, ronda: Number(antes) || ronda_(q), repetido: true };
  }
  const ronda = ronda_(q);
  // appendRow es atómico: no hace falta candado (y el candado serializaba a todos los estudiantes)
  // El apóstrofo obliga a guardar como texto (evita fórmulas y conversiones a número/fecha)
  hoja_().appendRow([new Date(), "'" + q, ronda, "'" + t, "'" + r]);
  if (claveV) cache.put(claveV, String(ronda), 21600);
  return { ok: true, ronda: ronda };
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

function nuevaRonda_(q, clave) {
  if (clave !== CLAVE) throw new Error("Clave incorrecta");
  const r = ronda_(q) + 1;
  PropertiesService.getScriptProperties().setProperty("ronda_" + q, String(r));
  const cache = CacheService.getScriptCache();
  cache.put("ronda_" + q, String(r), 600);
  cache.remove("leer_" + q);
  return { ok: true, ronda: r };
}
