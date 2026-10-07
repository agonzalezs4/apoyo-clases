// Pega aquí la URL de la aplicación web de Apps Script (termina en /exec)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwS4JLMcGJLLN6mSAQxQYbNolY0fpp0BKnBY4A8GH84Ai9keizha_hT2hqho7mvPPDg/exec";

/* ----- No es necesario editar lo que sigue ----- */
// A veces Google responde con una página de error HTML (sobrecarga, tiempo agotado) en vez del JSON del script.
// Se trata como un corte de red (TypeError): quien llama ya reintenta o avisa «sin conexión».
async function leerJSON(r) {
  if (!/json/.test(r.headers.get("content-type") || "")) throw new TypeError("Google no respondió (error " + r.status + "): inténtalo de nuevo");
  return r.json();
}

async function api(params) {
  if (SCRIPT_URL.startsWith("PEGA")) throw new Error("falta pegar SCRIPT_URL en config.js");
  const r = await fetch(SCRIPT_URL + "?" + new URLSearchParams(params) + "&_=" + Date.now());
  const d = await leerJSON(r);
  if (d.error) throw new Error(d.error);
  return d;
}

const $ = id => document.getElementById(id);
const SEP = " ‖ "; // separa alternativas cuando se marcan varias
const DIGITOS_CODIGO = 5; // dígitos del código de sorteo, tras la letra (igual que DIGITOS en apps-script/Codigo.gs)
const TIPOS = { alt: "Alternativas", esc: "Escala", abi: "Abierta", num: "Número" };

// Librerías propias (carpeta lib/): ninguna página depende de servidores externos
function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => mal(new TypeError("no pude cargar " + src));
    document.head.appendChild(s);
  });
}
const cargarQR = () => typeof qrcode !== "undefined" ? Promise.resolve() : cargarScript("lib/qrcode.min.js");

// QR como matriz de módulos: n x n bits (1 = oscuro), por filas, en base64. Necesita lib/qrcode.min.js
function qrMatriz(texto) {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount(), bytes = new Uint8Array(Math.ceil(n * n / 8));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) { const k = r * n + c; bytes[k >> 3] |= 128 >> (k & 7); }
  return { n, d: btoa(String.fromCharCode(...bytes)) };
}
// Dibuja la matriz como SVG (un solo trazo, nítido a cualquier tamaño). No necesita ninguna librería
function qrSvg({ n, d }, alt) {
  const b = atob(d), margen = 2;
  const oscuro = (r, c) => { const k = r * n + c; return (b.charCodeAt(k >> 3) >> (7 - (k & 7))) & 1; };
  let ruta = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!oscuro(r, c)) continue;
      let e = c;
      while (e < n && oscuro(r, e)) e++;
      ruta += `M${c + margen} ${r + margen}h${e - c}v1h${c - e}z`;
      c = e;
    }
  }
  const t = n + 2 * margen;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" role="img" aria-label="${alt || "Código QR"}" shape-rendering="crispEdges">` +
         `<rect width="${t}" height="${t}" fill="#fff"/><path d="${ruta}" fill="#000"/></svg>`;
}

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
