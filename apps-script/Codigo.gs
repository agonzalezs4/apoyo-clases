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
 *
 * Apertura de la votación y acceso del profesor (nuevo):
 *  - Una tanda parte CERRADA: "lote" (y "enviar") rechazan las respuestas de las preguntas que no estén abiertas.
 *    El profesor la abre y la cierra con el botón «Abrir votación» de presentar.html ("abrir").
 *    "estados" devuelve también qué preguntas están abiertas, y así votar.html sabe cuándo mostrarlas.
 *  - La CLAVE ya no viaja en cada acción ni se guarda en el navegador: "entrar" la comprueba UNA vez y entrega
 *    una sesión (un token al azar) que vence en HORAS_SESION. "abrir", "ronda" y "sorteo" exigen esa sesión.
 *  - Fuerza bruta: tras INTENTOS_MAX fallos seguidos, "entrar" queda bloqueado MINUTOS_BLOQUEO minutos para
 *    todos (y te llega un correo de aviso). Una sesión ya abierta sigue funcionando durante el bloqueo.
 *  - Segundo paso (CODIGO_POR_CORREO): con la clave correcta, te llega al correo un código de 6 dígitos que
 *    vence en 10 minutos. Sin tu correo no se puede entrar, aunque alguien conozca la clave.
 *  - Tras pegar esta versión: ejecuta "autorizar" otra vez (pide el permiso para enviar correos) e implementa
 *    una Nueva versión. Funciones útiles desde el editor: "cerrarSesiones" (si usaste un PC ajeno y no
 *    cerraste sesión) y "desbloquearAcceso" (si te bloqueaste tú).
 */

const CLAVE = "PON_AQUI_TU_CLAVE"; // la del acceso del profesor. Mejor larga (12 o más caracteres) y que no uses en otro sitio
const SECRETO = "PON_AQUI_TU_SECRETO"; // solo tú lo sabes: de él sale la letra verificadora del código
const CODIGO_POR_CORREO = true; // segundo paso al entrar: un código de 6 dígitos al correo (false = solo la clave)
const CORREO_PROFESOR = ""; // adónde llega el código; vacío = el correo dueño de este script
const HORAS_SESION = 12; // cuánto dura la sesión del profesor en un navegador
const INTENTOS_MAX = 5; // fallos seguidos (clave o código) antes de bloquear el acceso
const MINUTOS_BLOQUEO = 15;
const SIN_SESION = "Sesión vencida: vuelve a entrar"; // presentar.html e index.html reconocen este texto
const CERRADA = "Votación cerrada"; // votar.html reconoce este texto
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
      out = sorteo_(p.qs, p.token); // recibe varias preguntas (qs), no una sola (q)
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

/* Ejecutar UNA vez desde el editor para dar permisos y crear la pestaña */
function autorizar() {
  hoja_();
  MailApp.getRemainingDailyQuota(); // pide el permiso para enviar el código de acceso por correo
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
  if (!estadoTanda_([q]).abiertas[q]) throw new Error(CERRADA);
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
    // appendRow (una por pregunta) es atómico: no hace falta candado. No se usa setValues porque dos lotes simultáneos pisarían las mismas filas
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

/* Rondas vigentes de toda la tanda en una sola consulta */
function estados_(qs) {
  return estadoTanda_(ids_(qs));
}

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

function abierta_(q) {
  return estadoTanda_([q]).abiertas[q];
}

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
  // version: presentar.html la usa para avisar si el Apps Script publicado es anterior (2 = "lote"; 3 = "abrir" y "entrar")
  const out = { ronda: ronda, respuestas: respuestas, abierta: abierta_(q), version: 3 };
  const s = JSON.stringify(out);
  if (s.length < 90000) cache.put("leer_" + q, s, 2);
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

/* ---------- Acceso del profesor ---------- */
// La clave se comprueba solo aquí (nunca en la página, que es pública) y con límite de intentos.
// Las propiedades "acceso_*" y "ses_*" viven en PropertiesService: sobreviven a la caché y son las mismas para todos.

function entrar_(clave, codigo) {
  if (CLAVE === "PON_AQUI_TU_CLAVE") throw new Error("Falta cambiar CLAVE en el Apps Script");
  const lock = LockService.getScriptLock(); // los intentos se atienden de a uno: no se pueden lanzar miles en paralelo
  if (!lock.tryLock(20000)) throw new Error("El servidor está ocupado: inténtalo de nuevo");
  try {
    const props = PropertiesService.getScriptProperties();
    const ahora = Date.now();
    const hasta = Number(props.getProperty("acceso_bloqueado_hasta")) || 0;
    if (hasta > ahora) throw new Error("Demasiados intentos fallidos. Espera " + Math.ceil((hasta - ahora) / 60000) + " min y vuelve a intentarlo.");
    if (!iguales_(String(clave || ""), CLAVE)) { fallo_(props); throw new Error("Clave incorrecta"); }
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
      " minutos (las sesiones ya abiertas siguen funcionando).\n\nSi no fuiste tú, alguien está probando claves: conviene cambiar CLAVE en el Apps Script e implementar una nueva versión.");
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
    "Código para entrar como profesor: " + codigo + "\n\nVence en 10 minutos. Si no lo pediste tú, alguien conoce tu clave: cámbiala en el Apps Script.");
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

function correo_() {
  return CORREO_PROFESOR || Session.getEffectiveUser().getEmail();
}

function enmascarar_(correo) {
  const m = String(correo).match(/^(.{1,2})[^@]*(@.*)$/);
  return m ? m[1] + "…" + m[2] : "tu correo";
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ("0" + (b & 255).toString(16)).slice(-2)).join("");
}

/* Comparación de largo fijo: no revela por el tiempo de respuesta cuántos caracteres coinciden */
function iguales_(a, b) {
  a = hash_(a); b = hash_(b);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
