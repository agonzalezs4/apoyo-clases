// Modo recopilación de repasar.html (opcional). Necesita config.js (api).
// Sin "recopilar": true en el archivo de la clase, o si el estudiante elige «Practicar sin enviar»,
// este archivo no hace ninguna llamada de red.
// Uso desde repasar.html:
//   Recopilar.aviso(nombre, clase, contenedor, seguir) -> true si quedó preguntando; al elegir llama a seguir()
//   Recopilar.registrar(idPregunta, tema, textoElegido, correcta)   (después de mostrar la retroalimentación o antes: no espera)
//   Recopilar.terminar()                                            (al llegar al final)
const Recopilar = (() => {
  const CLAVE = "repaso_enviar", GRUPO = 5, REINTENTO_MS = 20000;
  let clase = "", activo = false, cola = [];
  const vistas = new Set(); // solo cuenta el primer intento de cada pregunta
  const azar = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
  const sesion = azar(); // nueva en cada carga de la página y nunca se guarda: no identifica a la persona
  const leer = () => { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } };

  let eleccion = leer(); // "1" enviar, "0" no enviar, null sin elegir. También en memoria por si falla localStorage

  // Devuelve true si quedó preguntando (la página espera a «seguir»); false si puede continuar
  function aviso(nombre, datos, contenedor, seguir) {
    activo = false;
    if (!datos || datos.recopilar !== true) return false;
    clase = nombre;
    const preguntar = () => {
      contenedor.innerHTML =
        '<p>Tus respuestas se guardan sin tu nombre para que el profesor sepa qué temas reforzar. No llevan nota.</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">' +
        '<button type="button" data-enviar="1">Practicar y enviar</button>' +
        '<button type="button" data-enviar="0">Practicar sin enviar</button></div>';
      contenedor.querySelectorAll("button[data-enviar]").forEach(b => {
        b.onclick = () => {
          eleccion = b.dataset.enviar;
          try { localStorage.setItem(CLAVE, eleccion); } catch (e) {}
          seguir();
        };
      });
    };
    if (eleccion === null) { preguntar(); return true; }
    activo = eleccion === "1";
    contenedor.innerHTML = '<p><small>' + (activo ? "Tus respuestas se envían sin tu nombre." : "Tus respuestas no se envían.") +
      ' <button type="button">Cambiar</button></small></p>';
    contenedor.querySelector("button").onclick = preguntar;
    return false;
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
    api(params, { keepalive: true }).catch(e => { // keepalive: el envío sobrevive a recargar o cerrar la página
      if (!(e instanceof TypeError)) { activo = false; cola = []; return; } // el servidor lo rechazó (clase sin registro): no insistir
      if (reintentar) setTimeout(() => enviar(params, false), REINTENTO_MS); // corte de red: una vez más y se descarta
    });
  }

  // Al recargar, salir o dejar la página en segundo plano (en celulares cerrar la pestaña solo avisa así), lo pendiente se envía igual
  addEventListener("pagehide", terminar);
  document.addEventListener("visibilitychange", () => { if (document.hidden) terminar(); });

  return { aviso, registrar, terminar };
})();
