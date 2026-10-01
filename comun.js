// comun.js — lo que comparten todas las páginas. Necesita config.js cargado antes.

const API_URL = (typeof CONFIG !== "undefined" && CONFIG.API_URL) || "";
const DIGITOS_CODIGO = (typeof CONFIG !== "undefined" && CONFIG.DIGITOS_CODIGO) || 5;

// La dirección del backend puede traer ya su propia consulta (Power Automate: ?api-version=…&sig=…):
// los parámetros se agregan sin tocarla
function urlApi(params) {
  const q = new URLSearchParams();
  Object.keys(params).forEach(k => { if (params[k] !== undefined && params[k] !== null) q.set(k, params[k]); });
  q.set("_", Date.now()); // sin caché
  return API_URL + (API_URL.includes("?") ? "&" : "?") + q;
}

async function api(params) {
  if (!API_URL) throw new Error("Falta API_URL en config.js");
  const r = await fetch(urlApi(params), { cache: "no-store" });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

// Qué sabe hacer el backend (una sola consulta por página). Un backend antiguo no conoce "info": se asume lo mínimo.
let _info = null;
function infoBackend() {
  if (!_info) _info = api({ accion: "info" }).catch(() => ({ version: 0 })).then(d => Object.assign({ version: 0, backend: "", clases: false, exportar: false, segundoPaso: "" }, d));
  return _info;
}

const $ = id => document.getElementById(id);
const SEP = " ‖ "; // separa alternativas cuando se marcan varias
const TIPOS = { alt: "Alternativas", esc: "Escala", abi: "Abierta", num: "Número" };

// Institución y curso, para los encabezados y el título de la pestaña
function textoMarca() {
  if (typeof CONFIG === "undefined") return "";
  return [CONFIG.INSTITUCION, CONFIG.CURSO].filter(Boolean).join(" · ");
}
function pintarMarca() {
  const t = textoMarca();
  document.querySelectorAll(".marca").forEach(el => { el.textContent = t; });
}

// Las preguntas viajan dentro del enlace, comprimidas (modo de prueba desde el editor)
function empaquetar(obj) { return LZString.compressToEncodedURIComponent(JSON.stringify(obj)); }
function desempaquetar(s) {
  try { return JSON.parse(LZString.decompressFromEncodedURIComponent(s)); } catch (e) { return null; }
}

// Solo lo que necesita el celular del estudiante (QR más liviano)
function paraVotar(p) {
  const o = { id: p.id, tipo: p.tipo, texto: p.texto };
  if (p.tipo === "alt") { o.opciones = p.opciones; if (p.multi) o.multi = 1; }
  if (p.tipo === "esc") { o.min = p.min; o.max = p.max; if (p.etqMin) o.etqMin = p.etqMin; if (p.etqMax) o.etqMax = p.etqMax; }
  if (p.tipo === "num" && p.unidad) o.unidad = p.unidad;
  return o;
}

function aNumero(s) {
  const t = String(s).trim().replace(/\s/g, "").replace(/%$/, "").replace(",", "."); // «10,5 %» vale 10,5
  if (t === "") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}
function formatear(x, dec = 1) { return x.toLocaleString("es-CL", { maximumFractionDigits: dec }); }
function mediana(v) {
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
