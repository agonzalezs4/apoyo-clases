#!/usr/bin/env node
"use strict";
/**
 * Prueba de punta a punta con un navegador real (Playwright + Chromium) sobre el servidor propio:
 * el profesor entra y publica una clase, abre la votación en el proyector, un estudiante responde la tanda
 * desde un celular, el proyector muestra los resultados, el sorteo premia al código y se exporta el CSV.
 *
 *   node pruebas/e2e.js            (necesita el paquete playwright y Chromium; CAPTURAS=/carpeta guarda pantallazos)
 */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const RAIZ = path.resolve(__dirname, "..");
const CLAVE = "clave-e2e-segura-123";
const CAPTURAS = process.env.CAPTURAS || "";

async function esperar(cond, ms = 15000, paso = 200) {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > ms) throw new Error("Se agotó la espera");
    await new Promise(r => setTimeout(r, paso));
  }
}
const captura = async (page, nombre) => { if (CAPTURAS) { fs.mkdirSync(CAPTURAS, { recursive: true }); await page.screenshot({ path: path.join(CAPTURAS, nombre + ".png"), fullPage: true }); } };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
  const datos = path.join(dir, "datos"), clases = path.join(dir, "clases");
  fs.mkdirSync(clases);
  fs.copyFileSync(path.join(RAIZ, "clases", "ejemplo.json"), path.join(clases, "ejemplo.json"));
  const puerto = 8100 + Math.floor(Math.random() * 500);
  const srv = spawn(process.execPath, [path.join(RAIZ, "servidor", "servidor.js")], {
    env: { ...process.env, CLAVE_PROFESOR: CLAVE, DATOS: datos, CLASES: clases, PUERTO: String(puerto), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  srv.stdout.on("data", d => { log += d; }); srv.stderr.on("data", d => { log += d; });
  const base = `http://127.0.0.1:${puerto}`;
  await esperar(async () => { try { return (await fetch(base + "/salud")).ok; } catch (e) { return false; } }, 10000);

  const navegador = await chromium.launch();
  const fallos = [];
  let paso = "inicio";
  const paginas = [];
  try {
    paso = "Profesor: entra al editor y publica una clase";
    const profe = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CL" });
    profe.on("page", p => p.on("pageerror", e => fallos.push("profe: " + e.message)));
    const editor = await profe.newPage();
    editor.on("pageerror", e => fallos.push("editor: " + e.message));
    await editor.goto(base + "/index.html");
    await editor.waitForSelector("#dlgAcceso[open]");
    await editor.fill("#accesoClave", "mala");
    await editor.click("#accesoEntrar");
    await editor.waitForFunction(() => document.getElementById("accesoError").textContent === "Clave incorrecta");
    await editor.fill("#accesoClave", CLAVE);
    await editor.click("#accesoEntrar");
    await editor.waitForFunction(() => !document.getElementById("dlgAcceso").open && document.documentElement.style.visibility === "visible");
    await editor.waitForFunction(() => /ejemplo/.test(document.getElementById("clases").textContent));
    assert.equal(await editor.isHidden("#btnExportar"), false, "en modo servidor se ve «Descargar respuestas»");
    await captura(editor, "01-editor");
    // publicar la clase de muestra con otro nombre
    await editor.fill("#nombre", "Clase E2E 01");
    assert.equal(await editor.inputValue("#nombre"), "clase-e2e-01");
    await editor.click("#btnPublicar");
    await editor.waitForSelector("#conServidor:not([hidden])");
    await editor.click("#btnGuardarServidor");
    await editor.waitForFunction(() => /quedó publicada/.test(document.getElementById("aviso").textContent));
    assert.ok(fs.existsSync(path.join(clases, "clase-e2e-01.json")), "la clase se guardó en el servidor");
    await editor.waitForFunction(() => /clase-e2e-01/.test(document.getElementById("clases").textContent));
    await captura(editor, "02-editor-publicada");

    paso = "Proyector";
    const proyector = await profe.newPage();
    proyector.on("pageerror", e => fallos.push("proyector: " + e.message));
    await proyector.goto(base + "/presentar.html?clase=ejemplo");
    await proyector.waitForFunction(() => /votación cerrada/.test(document.getElementById("meta").textContent));
    assert.match(await proyector.textContent("#corto b"), new RegExp(`127\\.0\\.0\\.1:${puerto}/votar\\.html\\?clase=ejemplo`), "sin enlace corto muestra la dirección completa");
    assert.ok(await proyector.getAttribute("#qr img", "src"), "hay QR");
    await proyector.click("#btnVotacion"); // con la sesión guardada no pide la clave
    await proyector.waitForFunction(() => /votación abierta/.test(document.getElementById("meta").textContent));
    await captura(proyector, "03-proyector-abierta");

    paso = "Estudiante en un celular";
    const alumno = await navegador.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: "es-CL" });
    const cel = await alumno.newPage();
    cel.on("pageerror", e => fallos.push("votar: " + e.message));
    await cel.goto(base + "/votar.html?clase=ejemplo");
    await cel.waitForSelector(".opcion");
    assert.equal(await cel.textContent("#pregunta"), "¿Qué parte de la clase anterior te costó más?");
    await cel.click(".opcion:has-text('Los conceptos')");
    await cel.waitForSelector(".opcion.elegida");
    await captura(cel, "04-votar-p1");
    await cel.click("#sig");
    await cel.waitForTimeout(450); // tras navegar, la página ignora toques durante 400 ms (protección contra el doble toque)
    await cel.waitForSelector("textarea");
    await cel.fill("textarea", "estadística");
    await cel.click("#sig");
    await cel.waitForTimeout(450); // tras navegar, la página ignora toques durante 400 ms (protección contra el doble toque)
    await cel.waitForSelector(".escala .opcion");
    await cel.click(".escala .opcion:has-text('4')");
    await cel.click("#sig");
    await cel.waitForTimeout(450); // tras navegar, la página ignora toques durante 400 ms (protección contra el doble toque)
    await cel.waitForSelector("input[inputmode=decimal]");
    await cel.fill("input[inputmode=decimal]", "6");
    await cel.waitForTimeout(500); // la página ignora un toque a menos de 400 ms de la navegación anterior (doble toque)
    await cel.click(".enviar:has-text('Revisar y responder')");
    await cel.waitForFunction(() => document.getElementById("pregunta").textContent === "Revisa y responde");
    await captura(cel, "05-votar-revisar");
    await cel.waitForTimeout(500);
    await cel.click(".resumen + .enviar");
    await cel.waitForFunction(() => /quedaron registradas/.test(document.getElementById("pregunta").textContent), null, { timeout: 20000 });
    const codigo = (await cel.textContent("#codigo b")).trim();
    assert.match(codigo, /^[A-HJ-NP-Z]\d{5}$/, "el celular muestra su código de sorteo");
    await captura(cel, "06-votar-listo");

    paso = "El proyector muestra la respuesta";
    await proyector.waitForFunction(() => /1 respuesta\b/.test(document.getElementById("meta").textContent), null, { timeout: 15000 });
    await proyector.waitForFunction(() => { const f = [...document.querySelectorAll(".fila")].find(x => /Los conceptos/.test(x.textContent)); return f && /^1/.test(f.querySelector(".valor").textContent); });
    await captura(proyector, "07-proyector-resultado");
    await proyector.keyboard.press("ArrowRight");
    await proyector.waitForFunction(() => /Pregunta 2 de 4/.test(document.getElementById("meta").textContent) && document.querySelector(".nube"));
    assert.match(await proyector.textContent(".nube"), /estadística/);
    await proyector.keyboard.press("ArrowRight");
    await proyector.keyboard.press("ArrowRight");
    await proyector.waitForFunction(() => /Pregunta 4 de 4/.test(document.getElementById("meta").textContent) && /Mediana 6/.test(document.getElementById("resumen").textContent));
    await captura(proyector, "08-proyector-numero");

    paso = "Sorteo";
    await proyector.click("#btnVotacion"); // cerrar
    await proyector.waitForFunction(() => /votación cerrada/.test(document.getElementById("meta").textContent));
    await proyector.keyboard.press("s");
    await proyector.waitForTimeout(300);
    const estadoDlg = await proyector.evaluate(() => { const d = document.getElementById("dlgSorteo"); const r = d.getBoundingClientRect(); return { open: d.open, display: getComputedStyle(d).display, alto: r.height, activo: document.activeElement && (document.activeElement.id || document.activeElement.tagName), otroAbierto: !!document.querySelector("dialog[open]:not(#dlgSorteo)") }; });
    if (!estadoDlg.open) { console.error("La tecla S no abrió el sorteo; estado:", JSON.stringify(estadoDlg), "→ se usa el botón"); await proyector.click("#btnSorteo"); }
    await proyector.waitForSelector("#dlgSorteo[open]", { state: "attached" });
    await proyector.waitForFunction(() => document.getElementById("dlgSorteo").getBoundingClientRect().height > 100);
    await proyector.check("#sorteoPreguntas fieldset[data-id=ej-alt1] input[value='Los conceptos']");
    await proyector.check("#sorteoPreguntas fieldset[data-id=ej-esc1] input[value='4']");
    await proyector.fill("#sorteoPreguntas fieldset[data-id=ej-num1] input", "6");
    await proyector.fill("#sorteoPct", "100");
    await proyector.click("#btnCalcular");
    await proyector.waitForFunction(() => /premiado/.test(document.getElementById("sorteoResultado").textContent));
    const resultado = await proyector.textContent("#sorteoResultado");
    assert.match(resultado, /1 código premiado de 1 que participaron/);
    assert.ok(resultado.includes(codigo), "el código del celular está entre los premiados");
    await proyector.fill("#sorteoCodigo", codigo.toLowerCase());
    await proyector.waitForFunction(() => /Premiado: 3 de 3 buenas/.test(document.getElementById("sorteoVerif").textContent));
    await captura(proyector, "09-sorteo");

    await proyector.click("#btnCerrarSorteo");
    await proyector.waitForSelector("#dlgSorteo", { state: "hidden" }); // cerrado = oculto

    paso = "Modo de prueba desde el editor (pregunta dentro del enlace, lz-string local)";
    await proyector.click("#btnVotacion"); // reabrir: en el modo de prueba las preguntas tienen los mismos ids
    await proyector.waitForFunction(() => /votación abierta/.test(document.getElementById("meta").textContent));
    const prueba = await alumno.newPage();
    prueba.on("pageerror", e => fallos.push("votar-hash: " + e.message));
    const enlace = await proyector.evaluate(() => new URL("votar.html#" + empaquetar(paraVotar(clase.p[0])), location.href).href);
    await prueba.goto(enlace);
    await prueba.waitForSelector(".opcion");
    assert.equal(await prueba.textContent("#pregunta"), "¿Qué parte de la clase anterior te costó más?");
    assert.ok(await prueba.evaluate(() => typeof LZString !== "undefined"), "lz-string se cargó desde lib/");

    paso = "Exportar CSV desde el editor";
    const [descarga] = await Promise.all([editor.waitForEvent("download"), editor.click("#btnExportar")]);
    const csv = fs.readFileSync(await descarga.path(), "utf8").replace(/^﻿/, "");
    assert.ok(csv.startsWith("fecha;id_pregunta;ronda;pregunta;respuesta;codigo"));
    assert.match(csv, new RegExp(`;ej-abi1;1;[^;]*;estadística;${codigo}`));
    assert.equal(csv.trim().split("\r\n").length, 5, "encabezado + 4 respuestas");

    paso = "Cerrar sesión";
    editor.once("dialog", d => d.accept());
    await editor.click("#btnSalir");
    await editor.waitForSelector("#dlgAcceso[open]");

    paso = "El asistente de configuración genera los archivos";
    const asistente = await profe.newPage();
    asistente.on("pageerror", e => fallos.push("configurar: " + e.message));
    await asistente.goto(base + "/configurar.html");
    await asistente.fill("#institucion", "Universidad de Prueba");
    await asistente.fill("#curso", "Curso E2E");
    await asistente.click("[data-preset=verde]");
    await asistente.check("[name=backend][value=google]");
    await asistente.fill("#apiUrl", "https://script.google.com/macros/s/ABC/exec");
    const cfg = await asistente.inputValue("#outConfig");
    assert.match(cfg, /API_URL: "https:\/\/script\.google\.com\/macros\/s\/ABC\/exec"/);
    assert.match(cfg, /INSTITUCION: "Universidad de Prueba"/);
    const tema = await asistente.inputValue("#outTema");
    assert.match(tema, /--color-principal:\s+#1B5E3B/);
    assert.match(tema, /"Atkinson Hyperlegible"/);
    assert.equal(await asistente.textContent("#contraste"), "");
    await captura(asistente, "10-configurar");

    assert.deepEqual(fallos, [], "sin errores de JavaScript en las páginas");
    console.log("E2E OK: editor, publicación, proyector, votación, resultados, sorteo, CSV, asistente.");
  } catch (e) {
    console.error("E2E FALLÓ en el paso «" + paso + "»:", e.message);
    if (CAPTURAS) for (const ctx of navegador.contexts()) for (const pg of ctx.pages()) { try { await pg.screenshot({ path: path.join(CAPTURAS, "fallo-" + (pg.url().split("/").pop() || "pagina").replace(/[^a-z0-9.]+/gi, "_").slice(0, 40) + ".png"), fullPage: true }); console.error("  captura:", pg.url(), "| h1:", (await pg.textContent("h1").catch(() => "")).trim().slice(0, 80)); } catch (err) {} }
    if (fallos.length) console.error("Errores JS:", fallos);
    console.error("Registro del servidor:\n" + log);
    process.exitCode = 1;
  } finally {
    await navegador.close();
    srv.kill();
  }
})();
