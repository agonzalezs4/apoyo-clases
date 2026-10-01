/**
 * Recolector de respuestas — backend en Google Apps Script (hoja de cálculo de Google)
 * No define preguntas: solo guarda lo que llega y devuelve lo guardado. El contrato de la API está en docs/API.md.
 *
 * INSTALACIÓN (detalle en docs/INSTALACION.md)
 *  1) Crea una hoja de cálculo de Google → Extensiones › Apps Script → borra lo que haya y pega este archivo.
 *  2) Configuración del proyecto (engranaje) › Propiedades del script › Agregar propiedad:
 *        CLAVE_NUEVA = la clave de profesor que quieras (12 o más caracteres).
 *     Si no agregas nada, el paso 3 genera una clave al azar y te la manda por correo.
 *  3) En el editor elige la función «configurar» y pulsa Ejecutar. Acepta los permisos (hoja y correo).
 *     Guarda SOLO un hash de la clave y borra CLAVE_NUEVA: la clave no queda escrita en ninguna parte.
 *  4) Implementar › Nueva implementación › tipo «Aplicación web» › Ejecutar como: yo · Acceso: cualquier persona › Implementar.
 *     Copia la URL que termina en /exec y pégala en config.js (API_URL).
 *  Para actualizar el código más adelante: pega el nuevo, ejecuta «configurar» y luego
 *  Implementar › Administrar implementaciones › (lápiz) › Versión: Nueva versión › Implementar (así la URL no cambia).
 *
 * SEGURIDAD
 *  - La clave nunca está en este código ni en las páginas: solo su hash (SHA-256 con sal, 5000 iteraciones) en las
 *    propiedades del script, que solo ve el dueño de la hoja. Para cambiarla: CLAVE_NUEVA + «configurar» otra vez.
 *  - Tras INTENTOS_MAX fallos seguidos, «entrar» queda bloqueado MINUTOS_BLOQUEO minutos (y te llega un correo).
 *  - Con CODIGO_POR_CORREO, además de la clave hace falta un código de 6 dígitos que llega a tu correo.
 *  - Las acciones del profesor (abrir la votación, nueva ronda, sorteo) exigen una sesión que vence en HORAS_SESION.
 *  - Funciones útiles desde el editor: «cerrarSesiones» (si usaste un PC ajeno) y «desbloquearAcceso».
 *
 * CÓMO FUNCIONA
 *  - appendRow() es atómico, así que no se usa LockService para los votos (con 100 celulares a la vez, un candado
 *    los serializaba y los últimos esperaban más de 15 s). La ronda de cada pregunta va en CacheService y PropertiesService.
 *  - "lote": todas las respuestas de la tanda en una consulta; los reintentos con el mismo "v" no duplican filas.
 *  - Código de sorteo: el celular elige DIGITOS dígitos y aquí se antepone una letra verificadora (HMAC con SECRETO),
 *    así nadie puede inventar un código. "sorteo" devuelve los votos de la tanda y el navegador del profesor corrige.
 *  - Una tanda parte CERRADA: "lote" y "enviar" rechazan respuestas hasta que el profesor pulse «Abrir votación».
 */

/* ---------- Ajustes (se pueden cambiar) ---------- */
const CODIGO_POR_CORREO = true; // segundo paso al entrar: un código de 6 dígitos al correo (false = solo la clave)
const CORREO_PROFESOR = "";     // adónde llegan el código y los avisos; vacío = el correo dueño de este script
const HORAS_SESION = 12;        // cuánto dura la sesión del profesor en un navegador
const INTENTOS_MAX = 5;         // fallos seguidos (clave o código) antes de bloquear el acceso
const MINUTOS_BLOQUEO = 15;
const DIGITOS = 5;              // largo de la parte numérica del código (igual que DIGITOS_CODIGO en config.js)

/* ---------- No hace falta tocar lo que sigue ---------- */
const VERSION = 4; // 2 = "lote"; 3 = "abrir" y "entrar"; 4 = "info" y clave con hash en las propiedades
const ITERACIONES = 5000;
const SIN_SESION = "Sesión vencida: vuelve a entrar"; // profesor.js reconoce este texto
const CERRADA = "Votación cerrada"; // votar.html reconoce este texto
const HOJA = "Respuestas";
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O: se confunden con 1 y 0
const RE_DIGITOS = new RegExp("^[1-9]\\d{" + (DIGITOS - 1) + "}$");
const RE_CODIGO = new RegExp("^[" + LETRAS + "]\\d{" + DIGITOS + "}$");

function doGet(e) {
  const p = (e && e.parameter) || {};
  let out;
  try {
    if (p.accion === "info") {
      out = { version: VERSION, backend: "apps-script", clases: false, exportar: false, segundoPaso: CODIGO_POR_CORREO ? "correo" : "" };
    } else if (p.accion === "sorteo") {
      out = sorteo_(p.qs, p.token);
    } else if (p.accion === "entrar") {
      out = entrar_(p.clave, p.codigo);
    } else if (p.accion === "sesion") {
      exigirSesion_(p.token);
      out = { ok: true };
    } else if (p.accion === "salir") {
      out = salir_(p.token);
    } else if (p.accion === "abrir") {
      out = abrir_(p.qs, p.abrir === "1", p.token);
    } else if (p.accion === "lote") {
      out = lote_(p.d, p.v, p.n);
    } else if (p.accion === "estados") {
      out = estados_(p.qs);
    } else {
      const q = String(p.q || "").slice(0, 40);
      if (!q) throw new Error("Falta el identificador de la pregunta");
      switch (p.accion) {
        case "enviar": out = enviar_(q, p.r, p.t, p.v, p.n); break;
        case "leer":   out = leer_(q); break;
        case "estado": out = { ronda: ronda_(q) }; break;
        case "ronda":  out = nuevaRonda_(q, p.token); break;
        default: throw new Error("Acción desconocida");
      }
    }
  } catch (err) {
    out = { error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ====================== Configuración (ejecutar desde el editor) ====================== */

/* Ejecutar UNA vez al instalar y cada vez que pegues una versión nueva o quieras cambiar la clave.
   Crea la pestaña de respuestas, pide los permisos, genera el SECRETO y guarda el hash de la clave. */
function configurar() {
  const props = PropertiesService.getScriptProperties();
  hoja_();
  if (!props.getProperty("SECRETO")) props.setProperty("SECRETO", (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""));
  const nueva = props.getProperty("CLAVE_NUEVA");
  let aviso;
  if (nueva) {
    if (nueva.length < 8) throw new Error("CLAVE_NUEVA es muy corta: usa 8 caracteres o más (mejor 12) y vuelve a ejecutar configurar.");
    props.setProperty("CLAVE_HASH", hashClave_(nueva));
    props.deleteProperty("CLAVE_NUEVA"); // la clave en claro no queda guardada
    aviso = "Clave guardada (solo su hash) y CLAVE_NUEVA borrada.";
  } else if (!props.getProperty("CLAVE_HASH")) {
    const generada = claveAlAzar_();
    props.setProperty("CLAVE_HASH", hashClave_(generada));
    MailApp.sendEmail(correo_(), "Tu clave de profesor (preguntas de la clase)",
      "Se configuró el recolector de respuestas. Tu clave de profesor es:\n\n    " + generada +
      "\n\nGuárdala en tu gestor de contraseñas. Para cambiarla: en Apps Script, Configuración del proyecto › Propiedades del script, " +
      "agrega CLAVE_NUEVA con la clave que quieras y ejecuta «configurar» otra vez.");
    aviso = "No había CLAVE_NUEVA: se generó una clave al azar y se envió a " + correo_() + ".";
  } else {
    aviso = "La clave ya estaba configurada (para cambiarla, agrega la propiedad CLAVE_NUEVA y ejecuta configurar otra vez).";
  }
  desbloquearAcceso();
  if (CODIGO_POR_CORREO) MailApp.getRemainingDailyQuota(); // pide el permiso de correo si falta
  Logger.log(aviso + "\nAhora: Implementar › Nueva implementación (o Administrar implementaciones › Nueva versión). Luego pega la URL /exec en config.js.");
}

/* Compatibilidad con las instrucciones antiguas */
function autorizar() { configurar(); }

/* Ejecutar desde el editor: cierra la sesión en todos los navegadores (p. ej. si dejaste abierta la del PC de la sala) */
function cerrarSesiones() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(k => { if (k.indexOf("ses_") === 0) props.deleteProperty(k); });
}

/* Ejecutar desde el editor si el bloqueo por intentos fallidos te dejó fuera a ti */
function desbloquearAcceso() {
  const props = PropertiesService.getScriptProperties();
  ["acceso_bloqueado_hasta", "acceso_fallos", "acceso_codigo"].forEach(k => props.deleteProperty(k));
}

function claveAlAzar_() {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 14; i++) s += abc.charAt(parseInt(bytes.substr(i * 2, 2), 16) % abc.length);
  return s;
}

/* ====================== Hoja y rondas ====================== */

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

/* ====================== Código de sorteo ====================== */

function secreto_() {
  const s = PropertiesService.getScriptProperties().getProperty("SECRETO");
  if (!s) throw new Error("Falta ejecutar «configurar» en el Apps Script");
  return s;
}

/* Letra verificadora: sale de los dígitos y de SECRETO (HMAC). Sin el secreto no se puede escribir a mano un código que el servidor no emitió */
function letra_(digitos) {
  const firma = Utilities.computeHmacSha256Signature(String(digitos), secreto_());
  return LETRAS.charAt((firma[0] & 255) % LETRAS.length);
}

function codigo_(digitos) { return letra_(digitos) + digitos; }

function codigoValido_(c) { return RE_CODIGO.test(c) && letra_(c.slice(1)) === c.charAt(0); }

/* ====================== Votos ====================== */

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
  if (!estadoTanda_([q]).abiertas[q]) throw new Error(CERRADA);
  const ronda = ronda_(q);
  // appendRow es atómico: no hace falta candado. El apóstrofo obliga a guardar como texto (evita fórmulas y conversiones)
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
  let desde = 0, previas = null; // un intento anterior que falló a medias ya escribió items[0..desde), con las rondas «previas»
  if (claveV) {
    const antes = cache.get(claveV);
    // El mismo lote se está escribiendo en otra ejecución (el celular cortó y reintentó): que espere, sin duplicar
    if (antes === "en-curso") throw new Error("Envío en curso");
    if (antes !== null) {
      const o = JSON.parse(antes);
      if (o.ok) { o.repetido = true; return o; } // reintento de un lote ya guardado: se devuelve lo mismo
      desde = Number(o.desde) || 0;
      previas = o.rondas || null;
    }
  }
  // Con la votación cerrada no se escribe nada. Un lote que falló a medias se completa igual: se envió cuando estaba abierta
  if (!desde) {
    const ab = estadoTanda_(items.map(it => it.q)).abiertas;
    if (items.some(it => !ab[it.q])) throw new Error(CERRADA);
  }
  if (claveV) cache.put(claveV, "en-curso", 360); // una ejecución de Apps Script puede durar hasta 6 min
  const ahora = new Date();
  const rondas = Object.create(null);
  let i = 0;
  try {
    const h = hoja_();
    for (; i < items.length; i++) {
      const it = items[i];
      // lo ya escrito conserva la ronda con que quedó en la hoja (aunque luego se abriera una nueva ronda)
      rondas[it.q] = i < desde && previas && previas[it.q] != null ? previas[it.q] : ronda_(it.q);
      if (i < desde || !it.r) continue; // ya escrita en un intento anterior, o en blanco
      h.appendRow([ahora, "'" + it.q, rondas[it.q], "'" + it.t, "'" + it.r, codigo ? "'" + codigo : ""]);
    }
  } catch (err) {
    if (claveV) { const k = Math.max(i, desde); if (k) cache.put(claveV, JSON.stringify({ desde: k, rondas: Object.assign({}, previas, rondas) }), 21600); else cache.remove(claveV); }
    throw err;
  }
  const out = conCodigo_({ ok: true, rondas: rondas }, codigo);
  if (claveV) cache.put(claveV, JSON.stringify(out), 21600);
  return out;
}

/* Rondas vigentes y apertura de toda la tanda en una sola consulta */
function estados_(qs) { return estadoTanda_(ids_(qs)); }

function ids_(qs) {
  const ids = String(qs || "").split(",").map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, 30);
  if (!ids.length) throw new Error("Faltan las preguntas de la tanda");
  return ids;
}

/* Ronda vigente y si está abierta, para varias preguntas con una sola lectura de la caché.
   Los celulares que esperan a que se abra la votación consultan esto seguido: tiene que ser liviano. */
function estadoTanda_(ids) {
  const cache = CacheService.getScriptCache();
  const claves = [];
  ids.forEach(q => claves.push("ronda_" + q, "abierta_" + q));
  const enCache = cache.getAll(claves);
  const faltan = {};
  let props = null;
  const valor = (k, porDefecto) => {
    if (enCache[k] != null) return enCache[k];
    props = props || PropertiesService.getScriptProperties().getProperties();
    const v = props[k] != null ? String(props[k]) : porDefecto;
    faltan[k] = v;
    return v;
  };
  const rondas = Object.create(null), abiertas = Object.create(null);
  ids.forEach(q => {
    rondas[q] = Number(valor("ronda_" + q, "1")) || 1;
    abiertas[q] = valor("abierta_" + q, "0") === "1"; // una pregunta nunca abierta está cerrada
  });
  if (Object.keys(faltan).length) cache.putAll(faltan, 600);
  return { rondas: rondas, abiertas: abiertas };
}

function abierta_(q) { return estadoTanda_([q]).abiertas[q]; }

/* Abre o cierra toda la tanda de una vez (solo el profesor) */
function abrir_(qs, abrir, token) {
  exigirSesion_(token);
  const ids = ids_(qs);
  const valores = {};
  ids.forEach(q => { valores["abierta_" + q] = abrir ? "1" : "0"; });
  PropertiesService.getScriptProperties().setProperties(valores); // no borra las demás propiedades
  const cache = CacheService.getScriptCache();
  cache.putAll(valores, 21600);
  cache.removeAll(ids.map(q => "leer_" + q));
  return { ok: true, abierta: abrir };
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
  const out = { ronda: ronda, respuestas: respuestas, abierta: abierta_(q), version: VERSION };
  const s = JSON.stringify(out);
  if (s.length < 90000) cache.put("leer_" + q, s, 2); // 2 s: el proyector consulta cada 3 s y no recorre la hoja cada vez
  return out;
}

/* Una sola lectura de la hoja para toda la tanda. La sesión evita que un estudiante lea los códigos de los demás. */
function sorteo_(qs, token) {
  exigirSesion_(token);
  const rondas = estadoTanda_(ids_(qs)).rondas; // solo cuenta la ronda vigente de cada pregunta
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

function nuevaRonda_(q, token) {
  exigirSesion_(token);
  const r = ronda_(q) + 1;
  PropertiesService.getScriptProperties().setProperty("ronda_" + q, String(r));
  const cache = CacheService.getScriptCache();
  cache.put("ronda_" + q, String(r), 600);
  cache.remove("leer_" + q);
  return { ok: true, ronda: r };
}

/* ====================== Acceso del profesor ====================== */
// La clave se comprueba solo aquí (nunca en la página, que es pública), contra su hash y con límite de intentos.
// Las propiedades "acceso_*" y "ses_*" viven en PropertiesService: sobreviven a la caché y son las mismas para todos.

function entrar_(clave, codigo) {
  const props = PropertiesService.getScriptProperties();
  const guardado = props.getProperty("CLAVE_HASH");
  if (!guardado) throw new Error("Falta ejecutar «configurar» en el Apps Script (ver docs/INSTALACION.md)");
  const lock = LockService.getScriptLock(); // los intentos se atienden de a uno: no se pueden lanzar miles en paralelo
  if (!lock.tryLock(20000)) throw new Error("El servidor está ocupado: inténtalo de nuevo");
  try {
    const ahora = Date.now();
    const hasta = Number(props.getProperty("acceso_bloqueado_hasta")) || 0;
    if (hasta > ahora) throw new Error("Demasiados intentos fallidos. Espera " + Math.ceil((hasta - ahora) / 60000) + " min y vuelve a intentarlo.");
    if (!verificarClave_(String(clave || ""), guardado)) { fallo_(props); throw new Error("Clave incorrecta"); }
    if (CODIGO_POR_CORREO) {
      codigo = String(codigo || "").replace(/\D/g, "");
      if (!codigo) return enviarCodigo_(props, ahora);
      const pend = JSON.parse(props.getProperty("acceso_codigo") || "null");
      if (!pend || pend.exp < ahora) { props.deleteProperty("acceso_codigo"); throw new Error("El código venció. Pide uno nuevo."); }
      if (!iguales_(hash_(codigo), pend.h)) {
        pend.n = (pend.n || 0) + 1;
        if (pend.n >= 3) props.deleteProperty("acceso_codigo"); // 3 errores con el mismo código: hay que pedir otro
        else props.setProperty("acceso_codigo", JSON.stringify(pend));
        fallo_(props);
        throw new Error(pend.n >= 3 ? "Código incorrecto. Pide uno nuevo." : "Código incorrecto");
      }
      props.deleteProperty("acceso_codigo");
    }
    props.deleteProperty("acceso_fallos");
    return nuevaSesion_(props, ahora);
  } finally {
    lock.releaseLock();
  }
}

function fallo_(props) {
  const n = (Number(props.getProperty("acceso_fallos")) || 0) + 1;
  if (n < INTENTOS_MAX) { props.setProperty("acceso_fallos", String(n)); return; }
  props.setProperty("acceso_bloqueado_hasta", String(Date.now() + MINUTOS_BLOQUEO * 60000));
  props.deleteProperty("acceso_fallos");
  props.deleteProperty("acceso_codigo");
  try {
    MailApp.sendEmail(correo_(), "Acceso bloqueado por intentos fallidos",
      "Hubo " + INTENTOS_MAX + " intentos fallidos seguidos de entrar como profesor. El acceso queda bloqueado " + MINUTOS_BLOQUEO +
      " minutos (las sesiones ya abiertas siguen funcionando).\n\nSi no fuiste tú, alguien está probando claves: conviene cambiarla " +
      "(propiedad CLAVE_NUEVA + ejecutar «configurar») e implementar una nueva versión.");
  } catch (err) {} // sin permiso de correo el bloqueo funciona igual
}

function enviarCodigo_(props, ahora) {
  const pend = JSON.parse(props.getProperty("acceso_codigo") || "null");
  const correo = correo_();
  // Ya se envió uno hace menos de un minuto: no se manda otro (así nadie llena tu correo, ni se agota la cuota diaria)
  if (pend && pend.exp > ahora && ahora - pend.t < 60000) return { paso: "codigo", correo: enmascarar_(correo) };
  const codigo = String(parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 12), 16) % 1000000).padStart(6, "0");
  props.setProperty("acceso_codigo", JSON.stringify({ h: hash_(codigo), exp: ahora + 10 * 60000, t: ahora, n: 0 }));
  MailApp.sendEmail(correo, codigo + " es tu código de acceso (clases)",
    "Código para entrar como profesor: " + codigo + "\n\nVence en 10 minutos. Si no lo pediste tú, alguien conoce tu clave: cámbiala (CLAVE_NUEVA + «configurar»).");
  return { paso: "codigo", correo: enmascarar_(correo) };
}

function nuevaSesion_(props, ahora) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""); // 64 caracteres al azar
  const expira = ahora + HORAS_SESION * 3600000;
  // Se guarda el hash del token, no el token: quien vea las propiedades del script no puede usarlo
  const todas = props.getProperties();
  Object.keys(todas).forEach(k => { if (k.indexOf("ses_") === 0 && Number(todas[k]) < ahora) props.deleteProperty(k); });
  props.setProperty("ses_" + hash_(token), String(expira));
  return { ok: true, token: token, expira: expira };
}

function exigirSesion_(token) {
  token = String(token || "");
  const exp = token.length >= 32 ? Number(PropertiesService.getScriptProperties().getProperty("ses_" + hash_(token))) : 0;
  if (!exp || exp < Date.now()) throw new Error(SIN_SESION);
}

function salir_(token) {
  token = String(token || "");
  if (token.length >= 32) PropertiesService.getScriptProperties().deleteProperty("ses_" + hash_(token));
  return { ok: true };
}

function correo_() {
  return CORREO_PROFESOR || Session.getEffectiveUser().getEmail();
}

function enmascarar_(correo) {
  const m = String(correo).match(/^(.{1,2})[^@]*(@.*)$/);
  return m ? m[1] + "…" + m[2] : "tu correo";
}

/* ====================== Hashes ====================== */

function hash_(s) {
  return aHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

function aHex_(bytes) {
  return bytes.map(b => ("0" + (b & 255).toString(16)).slice(-2)).join("");
}

/* Hash de la clave: SHA-256 con sal al azar, repetido ITERACIONES veces. Formato: sha256i$iteraciones$sal$hash */
function hashClave_(clave, sal, iteraciones) {
  sal = sal || Utilities.getUuid().replace(/-/g, "");
  iteraciones = iteraciones || ITERACIONES;
  const salBytes = Utilities.newBlob(sal).getBytes();
  let h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + String(clave), Utilities.Charset.UTF_8);
  for (let i = 1; i < iteraciones; i++) h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h.concat(salBytes));
  return "sha256i$" + iteraciones + "$" + sal + "$" + aHex_(h);
}

function verificarClave_(clave, guardado) {
  const partes = String(guardado).split("$");
  if (partes.length !== 4 || partes[0] !== "sha256i") return false;
  return iguales_(hashClave_(clave, partes[2], Number(partes[1])), guardado);
}

/* Comparación de largo fijo: no revela por el tiempo de respuesta cuántos caracteres coinciden */
function iguales_(a, b) {
  a = hash_(a); b = hash_(b);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
