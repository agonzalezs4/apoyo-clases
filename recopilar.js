// Modo recopilación de repasar.html (opcional). Necesita config.js (api).
// Sin "recopilar": true en el archivo de la clase, o si el estudiante elige «Practicar sin enviar»,
// este archivo no hace ninguna llamada de red.
// Uso desde repasar.html:
//   Recopilar.aviso(nombre, clase, contenedor, comenzar) -> true si mostró el aviso con sus dos botones
//   Recopilar.registrar(idPregunta, tema, textoElegido, correcta)   (después de mostrar la retroalimentación o antes: no espera)
//   Recopilar.terminar()                                            (al llegar al final)
const Recopilar = (() => {
  const CLAVE = "repaso_enviar", GRUPO = 5, REINTENTO_MS = 20000;
  let clase = "", activo = false, cola = [];
  const vistas = new Set(); // solo cuenta el primer intento de cada pregunta
  const azar = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
  const sesion = azar(); // nueva en cada carga de la página y nunca se guarda: no identifica a la persona
  const leer = () => { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } };

  function aviso(nombre, datos, contenedor, comenzar) {
    activo = false;
    if (!datos || datos.recopilar !== true) return false;
    clase = nombre;
    const previa = leer();
    contenedor.innerHTML =
      '<p>Tus respuestas se guardan sin tu nombre para que el profesor sepa qué temas reforzar. No llevan nota.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">' +
      '<button type="button" data-enviar="1">Practicar y enviar</button>' +
      '<button type="button" data-enviar="0">Practicar sin enviar</button></div>' +
      (previa === null ? "" : '<p><small>La vez anterior elegiste «Practicar ' + (previa === "1" ? "y" : "sin") + ' enviar». Puedes cambiarlo ahora.</small></p>');
    contenedor.querySelectorAll("button").forEach(b => {
      b.setAttribute("aria-pressed", String(b.dataset.enviar === previa)); // la elección anterior queda marcada y se puede cambiar
      b.onclick = () => {
        try { localStorage.setItem(CLAVE, b.dataset.enviar); } catch (e) {}
        activo = b.dataset.enviar === "1";
        comenzar();
      };
    });
    return true;
  }

  function registrar(id, tema, texto, correcta) {
    if (!activo || vistas.has(id)) return;
    vistas.add(id);
    cola.push([String(id), String(tema || "").slice(0, 100), String(texto || "").slice(0, 300), correcta ? 1 : 0]);
    if (cola.length >= GRUPO) terminar();
  }

  function terminar() {
    if (!activo || !cola.length) return;
    enviar({ accion: "repaso", clase, s: sesion, v: azar(), d: JSON.stringify(cola) }, true);
    cola = [];
  }

  // Nunca lanza ni muestra nada: la práctica no depende del envío
  function enviar(params, reintentar) {
    api(params).catch(e => {
      if (!(e instanceof TypeError)) { activo = false; cola = []; return; } // el servidor lo rechazó (clase sin registro): no insistir
      if (reintentar) setTimeout(() => enviar(params, false), REINTENTO_MS); // corte de red: una vez más y se descarta
    });
  }

  return { aviso, registrar, terminar };
})();
