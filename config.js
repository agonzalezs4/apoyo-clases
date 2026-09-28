// Pega aquí la URL de la aplicación web de Apps Script (termina en /exec)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwS4JLMcGJLLN6mSAQxQYbNolY0fpp0BKnBY4A8GH84Ai9keizha_hT2hqho7mvPPDg/exec";

/* ----- No es necesario editar lo que sigue ----- */
async function api(params) {
  if (SCRIPT_URL.startsWith("PEGA")) throw new Error("falta pegar SCRIPT_URL en config.js");
  const r = await fetch(SCRIPT_URL + "?" + new URLSearchParams(params) + "&_=" + Date.now());
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

const $ = id => document.getElementById(id);
const SEP = " ‖ "; // separa alternativas cuando se marcan varias
const TIPOS = { alt: "Alternativas", esc: "Escala", abi: "Abierta", num: "Número" };

// Las preguntas viajan dentro del enlace, comprimidas
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
  const t = String(s).trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}
function formatear(x, dec = 1) { return x.toLocaleString("es-CL", { maximumFractionDigits: dec }); }
function mediana(v) {
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
