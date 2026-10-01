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
 *  - Cada celular elige 5 dígitos al azar y los envía con cada voto ("n"). Aquí se les antepone una
 *    letra verificadora que solo se puede calcular con SECRETO, y el código completo (ej. K48271) se
 *    guarda en la columna F y se devuelve al celular. Cero llamadas extra: viaja en el mismo "enviar".
 *  - "sorteo" lee la hoja UNA vez para todas las preguntas de la tanda y devuelve (código, pregunta,
 *    respuesta). La corrección la hace la pantalla del profesor: la alternativa correcta nunca sale de ahí.
 *  - En la hoja "Respuestas" agrega el encabezado "codigo" en la celda F1 (solo es una etiqueta).
 *
 * Envío por tanda (nuevo):
 *  - El celular ya no envía cada pregunta al tocarla: el estudiante puede cambiar sus alternativas y,
 *    al final, pulsa "Responder". "lote" recibe TODAS las respuestas en una sola consulta (d = JSON con
 *    [pregunta, respuesta, texto]) y devuelve el código y la ronda de cada pregunta. No es obligatorio
 *    responder todas: las que quedan en blanco viajan solo con su id y no generan fila en la hoja.
 *  - "estados" devuelve las rondas de toda la tanda en una sola consulta (antes era una por pregunta).
 *  - "enviar" y "estado" siguen existiendo por si algún celular tiene abierta la versión anterior.
 *  - Mientras un lote se escribe queda marcado "en curso": si el celular reintenta (la red cortó o
 *    Google tardó), el reintento no vuelve a escribir las filas. Si el lote falló a medias, el
 *    reintento sigue desde la primera fila que faltaba.
 *  - IMPORTANTE: implementa esta versión (Nueva versión; no basta con Guardar) ANTES de publicar el
 *    votar.html nuevo. Si presentar.html avisa «El Apps Script publicado es la versión anterior», falta ese paso.
 */

const CLAVE = "PON_AQUI_TU_CLAVE"; // la piden los botones "Nueva ronda" y "Sortear"
const SECRETO = "PON_AQUI_TU_SECRETO"; // solo tú lo sabes: de él sale la letra verificadora del código
const HOJA = "Respuestas";
const DIGITOS = 5; // largo de la parte numérica del código (debe coincidir con DIGITOS_CODIGO en config.js)
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O: se confunden con 1 y 0
const RE_DIGITOS = new RegExp("^[1-9]\\d{" + (DIGITOS - 1) + "}$");
const RE_CODIGO = new RegExp("^[" + LETRAS + "]\\d{" + DIGITOS + "}$");

function doGet(e) {
  const p = e.parameter;
  let out;
  try {
    if (p.accion === "sorteo") {
      out = sorteo_(p.qs, p.clave); // recibe varias preguntas (qs), no una sola (q)
    } else if (p.accion === "lote") {
      out = lote_(p.d, p.v, p.n); // todas las respuestas de la tanda en una consulta
    } else if (p.accion === "estados") {
      out = estados_(p.qs);
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

/* Guarda de una vez las respuestas de la tanda. d = JSON [[pregunta, respuesta, texto], ...]
   Una pregunta que el estudiante dejó en blanco viaja como [pregunta]: no se escribe fila, solo se devuelve su ronda */
function lote_(d, v, n) {
  let items;
  try { items = JSON.parse(String(d || "")); } catch (err) { throw new Error("Envío inválido"); }
  if (!Array.isArray(items) || !items.length) throw new Error("No hay respuestas que guardar");
  items = items.slice(0, 30).map(it => {
    it = Array.isArray(it) ? it : [];
    return { q: String(it[0] || "").slice(0, 40), r: String(it[1] || "").trim().slice(0, 500), t: String(it[2] || "").slice(0, 300) };
  });
  if (items.some(it => !it.q)) throw new Error("Falta el identificador de la pregunta");
  if (!items.some(it => it.r)) throw new Error("Respuesta vacía");
  v = String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  n = String(n || "");
  const codigo = RE_DIGITOS.test(n) ? codigo_(n) : "";
  const cache = CacheService.getScriptCache();
  const claveV = v ? "lote_" + v : "";
  let desde = 0; // un intento anterior que falló a medias ya escribió items[0..desde)
  if (claveV) {
    const antes = cache.get(claveV);
    // El mismo lote se está escribiendo en otra ejecución (el celular cortó y reintentó): que espere, sin duplicar
    if (antes === "en-curso") throw new Error("Envío en curso");
    if (antes !== null) {
      const o = JSON.parse(antes);
      if (o.ok) { o.repetido = true; return o; } // reintento de un lote ya guardado: se devuelve lo mismo
      desde = Number(o.desde) || 0;
    }
    cache.put(claveV, "en-curso", 90);
  }
  const ahora = new Date();
  const rondas = Object.create(null);
  let i = 0;
  try {
    const h = hoja_();
    // appendRow (una por pregunta) es atómico: no hace falta candado. No se usa setValues porque dos lotes simultáneos pisarían las mismas filas
    for (; i < items.length; i++) {
      const it = items[i];
      rondas[it.q] = ronda_(it.q);
      if (i < desde || !it.r) continue; // ya escrita en un intento anterior, o en blanco
      h.appendRow([ahora, "'" + it.q, rondas[it.q], "'" + it.t, "'" + it.r, codigo ? "'" + codigo : ""]);
    }
  } catch (err) {
    if (claveV) { const k = Math.max(i, desde); if (k) cache.put(claveV, JSON.stringify({ desde: k }), 21600); else cache.remove(claveV); }
    throw err;
  }
  const out = conCodigo_({ ok: true, rondas: rondas }, codigo);
  if (claveV) cache.put(claveV, JSON.stringify(out), 21600);
  return out;
}

/* Rondas vigentes de toda la tanda en una sola consulta */
function estados_(qs) {
  const ids = String(qs || "").split(",").map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, 30);
  if (!ids.length) throw new Error("Faltan las preguntas de la tanda");
  const rondas = Object.create(null);
  ids.forEach(q => { rondas[q] = ronda_(q); });
  return { rondas: rondas };
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
  const filas = n > 1 ? h.getRange(2, 2, n - 1, 4).getValues() : []; // columnas B:E (sin la fecha)
  const respuestas = filas
    .filter(f => String(f[0]) === q && Number(f[1]) === ronda)
    .map(f => String(f[3]));
  // version: presentar.html la usa para avisar si el Apps Script publicado aún no tiene "lote"
  const out = { ronda: ronda, respuestas: respuestas, version: 2 };
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
