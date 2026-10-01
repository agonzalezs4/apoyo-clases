#!/usr/bin/env node
"use strict";
/**
 * Configura la clave del profesor para el servidor propio, sin dejarla escrita en ningún archivo:
 * guarda solo su hash (scrypt) en datos/secretos.json. Opcionalmente activa un segundo paso con una
 * app autenticadora (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…).
 *
 *   node servidor/configurar.js                 guarda datos/secretos.json
 *   node servidor/configurar.js --sin-archivo   solo imprime las variables para el archivo .env (Docker)
 *   DATOS=/otra/carpeta node servidor/configurar.js
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { hashClave, totpValido } = require("./servidor.js");

const RAIZ = path.resolve(process.env.RAIZ || path.join(__dirname, ".."));
const DATOS = path.resolve(process.env.DATOS || path.join(RAIZ, "datos"));
const SIN_ARCHIVO = process.argv.includes("--sin-archivo");
let terminado = false;

// Lectura de respuestas. En una terminal se leen las teclas una a una (así la clave no se muestra);
// con entrada por tubería (pruebas, scripts) se leen líneas, guardando las que lleguen antes de tiempo.
const lineas = { cola: [], esperas: [], cerrado: false, rl: null };
function leerLinea() {
  if (!lineas.rl) {
    lineas.rl = readline.createInterface({ input: process.stdin, terminal: false });
    lineas.rl.on("line", l => { if (lineas.esperas.length) lineas.esperas.shift()(l); else lineas.cola.push(l); });
    lineas.rl.on("close", () => { lineas.cerrado = true; while (lineas.esperas.length) lineas.esperas.shift()(null); });
  }
  return new Promise(res => {
    if (lineas.cola.length) res(lineas.cola.shift());
    else if (lineas.cerrado) res(null);
    else lineas.esperas.push(res);
  });
}
function leerTeclas(oculto) {
  return new Promise(resolver => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let v = "";
    const fin = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", alTeclear); process.stdout.write("\n"); };
    const alTeclear = ch => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { fin(); return resolver(v); }
        if (c === "\u0003") { fin(); process.stdout.write("Cancelado.\n"); process.exit(1); }
        if (c === "\u007f" || c === "\b") { if (v && !oculto) process.stdout.write("\b \b"); v = v.slice(0, -1); continue; }
        if (c >= " ") { v += c; if (!oculto) process.stdout.write(c); }
      }
    };
    stdin.on("data", alTeclear);
  });
}
async function preguntar(texto, oculto) {
  process.stdout.write(texto);
  if (process.stdin.isTTY) return leerTeclas(oculto);
  const v = await leerLinea();
  process.stdout.write("\n");
  if (v === null) { console.log("Se acabó la entrada antes de terminar. Nada se guardó."); process.exit(1); }
  return v;
}

function base32(bytes) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, valor = 0, out = "";
  for (const b of bytes) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { out += alfabeto[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alfabeto[(valor << (5 - bits)) & 31];
  return out;
}

function qrAscii(texto) {
  try {
    const qrcode = require(path.join(RAIZ, "lib", "qrcode.js"));
    const qr = qrcode(0, "M");
    qr.addData(texto);
    qr.make();
    return qr.createASCII(1, 1);
  } catch (e) { return ""; }
}

(async () => {
  console.log("\nConfiguración del acceso del profesor\n" + "=".repeat(38));
  let clave;
  for (;;) {
    clave = await preguntar("Clave del profesor (mínimo 8 caracteres; no se muestra al escribir): ", true);
    if (clave.length < 8) { console.log("Muy corta. Mejor una frase larga que no uses en otro sitio.\n"); continue; }
    const otra = await preguntar("Repítela: ", true);
    if (otra !== clave) { console.log("No coinciden. Otra vez.\n"); continue; }
    break;
  }
  const claveHash = hashClave(clave);
  clave = null;

  let totp = "";
  const resp = (await preguntar("¿Agregar un segundo paso con una app autenticadora? Es lo más seguro: aunque alguien sepa la clave, no entra sin tu celular. [s/N] ")).trim().toLowerCase();
  if (resp === "s" || resp === "si" || resp === "sí") {
    totp = base32(crypto.randomBytes(20));
    const etiqueta = encodeURIComponent("Recolector de respuestas");
    const url = `otpauth://totp/${etiqueta}:profesor?secret=${totp}&issuer=${etiqueta}&algorithm=SHA1&digits=6&period=30`;
    console.log("\nAbre tu app autenticadora, elige «agregar cuenta» y escanea este código (o escribe la clave de abajo a mano):\n");
    console.log(qrAscii(url));
    console.log("Clave para escribir a mano: " + totp.match(/.{1,4}/g).join(" ") + "\n");
    for (;;) {
      const codigo = (await preguntar("Escribe el código de 6 dígitos que muestra la app, para comprobar: ")).trim();
      if (totpValido(totp, codigo)) { console.log("Correcto.\n"); break; }
      const otra = (await preguntar("No coincide. ¿Probar otra vez? [S/n] ")).trim().toLowerCase();
      if (otra === "n" || otra === "no") { console.log("Se deja sin segundo paso.\n"); totp = ""; break; }
    }
  }

  terminado = true;
  if (lineas.rl) lineas.rl.close();
  if (SIN_ARCHIVO) {
    console.log("Pega estas líneas en tu archivo .env (Docker) o expórtalas como variables de entorno:\n");
    console.log("CLAVE_PROFESOR_HASH=" + claveHash);
    if (totp) console.log("TOTP_SECRETO=" + totp);
    console.log();
    return;
  }
  fs.mkdirSync(DATOS, { recursive: true });
  const ruta = path.join(DATOS, "secretos.json");
  fs.writeFileSync(ruta, JSON.stringify({ claveHash, totp }, null, 2) + "\n", { mode: 0o600 });
  console.log(`Listo: ${ruta} (solo el hash de la clave${totp ? " y el secreto de la app autenticadora" : ""}).`);
  console.log("Arranca el servidor con: npm start   (o docker compose up -d). Para cambiar la clave, vuelve a ejecutar este programa.\n");
})().catch(e => { console.error(e.message); process.exit(1); });
