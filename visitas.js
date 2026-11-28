// Uso anónimo de repasar.html: cuántas veces se abre y cuántos minutos se usa. Necesita config.js (api).
// No envía respuestas ni nada del estudiante: solo la clase, una sesión al azar (nueva en cada carga, no se guarda)
// y los segundos con la página visible y en uso. Va aparte de recopilar.js, que solo envía respuestas si el estudiante acepta.
(() => {
  const clase = new URLSearchParams(location.search).get("clase") || "";
  if (!clase || SCRIPT_URL.startsWith("PEGA")) return;
  const s = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
  const PASO = 5, QUIETO_MS = 120000; // 2 min sin tocar la pantalla ya no cuenta como uso
  let seg = 0, enviado = -1, ultimo = Date.now();
  const moverse = () => { ultimo = Date.now(); };
  ["pointerdown", "keydown", "scroll"].forEach(t => addEventListener(t, moverse, { passive: true }));
  setInterval(() => { if (!document.hidden && Date.now() - ultimo < QUIETO_MS) seg += PASO; }, PASO * 1000);
  const enviar = () => {
    if (seg === enviado) return;
    enviado = seg;
    api({ accion: "visita", clase, s, t: seg }, { keepalive: true }).catch(() => {}); // si falla, se pierde: nunca molesta
  };
  enviar(); // la entrada cuenta aunque después no llegue el tiempo (celulares que cierran sin avisar)
  addEventListener("pagehide", enviar);
  document.addEventListener("visibilitychange", () => { if (document.hidden) enviar(); else moverse(); });
})();
