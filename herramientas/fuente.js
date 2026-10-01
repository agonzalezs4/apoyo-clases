#!/usr/bin/env node
"use strict";
/**
 * Trae una fuente de Google Fonts al sitio (archivos .woff2 locales + su CSS), para no depender de Google en clase.
 *
 *   node herramientas/fuente.js "Montserrat"                 pesos 400 y 700, normal e itálica, subconjunto latino
 *   node herramientas/fuente.js "Roboto Condensed" 400,700   solo esos pesos
 *   node herramientas/fuente.js "Lato" 400,700 --sin-italica --latin-ext
 *
 * Deja fuentes/<nombre>.css y los .woff2 en fuentes/. Luego, en tema.css:
 *   @import url("fuentes/<nombre>.css");      (en la primera línea)
 *   --fuente: "Montserrat", system-ui, …;
 * Revisa la licencia de la fuente en fonts.google.com (casi todas son SIL OFL: se pueden redistribuir).
 */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith("--")));
const familia = args[0];
if (!familia) { console.error("Uso: node herramientas/fuente.js \"Nombre de la fuente\" [400,700] [--sin-italica] [--latin-ext]"); process.exit(1); }
const pesos = (args[1] || "400,700").split(",").map(s => s.trim()).filter(Boolean);
const italica = !flags.has("--sin-italica");
const subconjuntos = flags.has("--latin-ext") ? ["latin", "latin-ext"] : ["latin"];
const DESTINO = path.join(__dirname, "..", "fuentes");
const slug = familia.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Un navegador moderno: así Google entrega woff2 (a un cliente desconocido le da ttf, mucho más pesado)
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

(async () => {
  const ejes = italica ? "ital,wght@" + pesos.map(p => "0," + p).concat(pesos.map(p => "1," + p)).join(";") : "wght@" + pesos.join(";");
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(familia).replace(/%20/g, "+")}:${ejes}&display=swap`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) { console.error(`Google Fonts respondió ${r.status} para «${familia}». ¿Está bien escrito el nombre? ¿Existen esos pesos?`); process.exit(1); }
  const css = await r.text();
  const bloques = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face \{([\s\S]*?)\}/g)];
  if (!bloques.length) { console.error("No encontré @font-face en la respuesta de Google Fonts."); process.exit(1); }
  fs.mkdirSync(DESTINO, { recursive: true });
  const reglas = [];
  for (const [, sub, cuerpo] of bloques) {
    if (!subconjuntos.includes(sub)) continue;
    const estilo = (cuerpo.match(/font-style:\s*(\w+)/) || [])[1] || "normal";
    const peso = (cuerpo.match(/font-weight:\s*(\d+)/) || [])[1] || "400";
    const src = (cuerpo.match(/url\((\S+?)\)/) || [])[1];
    if (!src) continue;
    const archivo = `${slug}-${sub}-${peso}${estilo === "italic" ? "-italic" : ""}.woff2`;
    const rf = await fetch(src, { headers: { "User-Agent": UA } });
    if (!rf.ok) { console.error(`No pude descargar ${src} (${rf.status})`); process.exit(1); }
    fs.writeFileSync(path.join(DESTINO, archivo), Buffer.from(await rf.arrayBuffer()));
    const rango = (cuerpo.match(/unicode-range:\s*([^;]+);/) || [])[1];
    reglas.push(`@font-face { font-family: "${familia}"; font-style: ${estilo}; font-weight: ${peso}; font-display: swap; src: url("${archivo}") format("woff2");${rango ? ` unicode-range: ${rango.trim()};` : ""} }`);
    console.log(`  ${archivo}  (${(fs.statSync(path.join(DESTINO, archivo)).size / 1024).toFixed(0)} KB)`);
  }
  if (!reglas.length) { console.error("Google no entregó archivos para esos subconjuntos."); process.exit(1); }
  const salida = path.join(DESTINO, slug + ".css");
  fs.writeFileSync(salida, `/* ${familia} — traída de Google Fonts con herramientas/fuente.js. Revisa su licencia en fonts.google.com/specimen/${encodeURIComponent(familia).replace(/%20/g, "+")} */\n${reglas.join("\n")}\n`);
  console.log(`\nListo: fuentes/${slug}.css con ${reglas.length} variantes.\n\nAhora, en tema.css:\n  1) Agrega en la PRIMERA línea:   @import url("fuentes/${slug}.css");\n  2) Cambia la letra:              --fuente: "${familia}", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;\n`);
})().catch(e => { console.error("Error:", e.message); process.exit(1); });
