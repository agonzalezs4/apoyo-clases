// Acceso del profesor (lo usan index.html y presentar.html; necesita config.js)
// La clave NO se comprueba aquí: esta página es pública y cualquiera puede leer su código. La comprueba el
// Apps Script, con límite de intentos y (si está activado) un código que llega al correo. A cambio entrega una
// sesión que vence sola; la clave nunca se guarda en el navegador.
// Computador conocido: tras escribir el código del correo con «Recordar este computador», el servidor entrega una
// marca que se guarda aquí; mientras siga vigente, en este navegador basta la clave (sin código).

const SESION = "menti-sesion";
const EQUIPO = "menti-equipo";
// Las versiones anteriores guardaban la clave (o su hash) en el navegador: se borran
try { localStorage.removeItem("menti-clave"); localStorage.removeItem("editor-ok"); } catch (e) {}

function sesionGuardada() {
  try {
    const s = JSON.parse(localStorage.getItem(SESION));
    if (s && s.token && s.expira > Date.now()) return s.token;
  } catch (e) {}
  return null;
}
function equipoGuardado() {
  try {
    const s = JSON.parse(localStorage.getItem(EQUIPO));
    if (s && s.token && s.expira > Date.now()) return s.token;
  } catch (e) {}
  return "";
}
function olvidarSesion() { try { localStorage.removeItem(SESION); } catch (e) {} }
const sesionVencida = e => /^Sesión vencida/.test(e.message);

// Como api(), pero con la sesión del profesor. Si no hay sesión (o venció) pide entrar. null = el profesor canceló.
async function apiProfesor(params) {
  for (let k = 0; k < 2; k++) {
    const token = sesionGuardada() || await entrar(k ? "Tu sesión venció. Vuelve a entrar." : "");
    if (!token) return null;
    try { return await api(Object.assign({}, params, { token })); }
    catch (e) { if (!sesionVencida(e) || k) throw e; olvidarSesion(); }
  }
}

async function salirProfesor() {
  const token = sesionGuardada();
  olvidarSesion();
  if (token) try { await api({ accion: "salir", token }); } catch (e) {}
}

let accesoEnCurso = null;
// Ventana para entrar: clave (oculta, no queda a la vista en el proyector) y, si el servidor lo pide, el código del correo
function entrar(motivo) {
  if (accesoEnCurso) return accesoEnCurso;
  accesoEnCurso = new Promise(resolver => {
    const d = dialogoAcceso(), el = id => d.querySelector("#" + id);
    const clave = el("accesoClave"), codigo = el("accesoCodigo"), error = el("accesoError"), boton = el("accesoEntrar");
    let paso = "clave", hecho = false;
    const fin = token => {
      if (hecho) return;
      hecho = true;
      clave.value = codigo.value = ""; // la clave no queda en la página
      accesoEnCurso = null;
      if (d.open) d.close();
      resolver(token);
    };
    const mostrarPaso = (p, texto) => {
      paso = p;
      el("accesoLblClave").hidden = p !== "clave";
      el("accesoLblCodigo").hidden = el("accesoLblRecordar").hidden = p !== "codigo";
      el("accesoOtro").hidden = p !== "codigo";
      el("accesoTexto").textContent = texto;
      (p === "clave" ? clave : codigo).focus();
    };
    error.textContent = "";
    clave.value = codigo.value = "";
    d.querySelector("form").onsubmit = async ev => {
      ev.preventDefault();
      if (!clave.value || (paso === "codigo" && !codigo.value.trim())) return;
      boton.disabled = true;
      error.textContent = "";
      try {
        const r = await api({ accion: "entrar", clave: clave.value, codigo: paso === "codigo" ? codigo.value.trim() : "",
          equipo: equipoGuardado(), recordar: paso === "codigo" && el("accesoRecordar").checked ? 1 : 0 });
        if (r.paso === "codigo") {
          codigo.value = "";
          mostrarPaso("codigo", `Te enviamos un código de 6 dígitos a ${r.correo}. Escríbelo aquí (vence en 10 minutos).`);
          return;
        }
        try { localStorage.setItem(SESION, JSON.stringify({ token: r.token, expira: r.expira })); } catch (e) {}
        if (r.equipo) try { localStorage.setItem(EQUIPO, JSON.stringify({ token: r.equipo, expira: r.equipoExpira })); } catch (e) {}
        fin(r.token);
      } catch (e) {
        error.textContent = e instanceof TypeError ? "No hay conexión con el servidor. Inténtalo de nuevo." : e.message;
        if (/Clave incorrecta|Pide uno nuevo/.test(e.message)) { clave.value = ""; mostrarPaso("clave", "Escribe tu clave de profesor."); }
        else if (paso === "codigo") { codigo.select(); }
      } finally {
        boton.disabled = false;
      }
    };
    el("accesoOtro").onclick = () => { codigo.value = ""; error.textContent = ""; mostrarPaso("clave", "Escribe tu clave otra vez para recibir un código nuevo."); };
    el("accesoCancelar").onclick = () => fin(null);
    d.oncancel = ev => { ev.preventDefault(); fin(null); }; // tecla Esc
    d.showModal();
    mostrarPaso("clave", motivo || "Escribe tu clave de profesor.");
  });
  return accesoEnCurso;
}

function dialogoAcceso() {
  let d = document.getElementById("dlgAcceso");
  if (d) return d;
  const estilo = document.createElement("style");
  estilo.textContent = `
    #dlgAcceso { visibility: visible; width: min(420px, 92vw); padding: 24px; background: var(--papel); color: var(--tinta); border: 1px solid var(--riel); border-radius: 6px; font-size: 17px; }
    #dlgAcceso::backdrop { background: rgba(16, 43, 66, .55); }
    #dlgAcceso [hidden] { display: none; }
    #dlgAcceso h2 { margin: 0 0 8px; font-size: 24px; }
    #dlgAcceso p { margin: 0 0 14px; }
    #dlgAcceso .ayuda { color: var(--suave); }
    #dlgAcceso label { display: block; margin: 0 0 14px; color: var(--suave); font-size: 16px; }
    #dlgAcceso input { display: block; box-sizing: border-box; width: 100%; margin-top: 4px; padding: 8px 12px; font: inherit; font-size: 20px; color: var(--tinta); background: #fff; border: 1px solid var(--riel); border-radius: 4px; }
    #dlgAcceso #accesoLblRecordar { color: var(--tinta); }
    #dlgAcceso #accesoRecordar { display: inline; width: auto; margin: 0 8px 0 0; vertical-align: middle; }
    #dlgAcceso #accesoCodigo { letter-spacing: .2em; font-variant-numeric: tabular-nums; }
    #dlgAcceso .botones { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    #dlgAcceso button { font: inherit; font-size: 16px; padding: 8px 14px; color: var(--tinta); background: #fff; border: 1px solid var(--riel); border-radius: 4px; cursor: pointer; }
    #dlgAcceso button.principal { background: var(--barra); border-color: var(--barra); color: #fff; }
    #dlgAcceso button:disabled { opacity: .5; cursor: default; }
    #dlgAcceso #accesoOtro { margin-right: auto; }`;
  document.head.appendChild(estilo);
  d = document.createElement("dialog");
  d.id = "dlgAcceso";
  d.setAttribute("aria-labelledby", "accesoTitulo");
  d.innerHTML = `
    <form>
      <h2 id="accesoTitulo">Acceso del profesor</h2>
      <p id="accesoTexto" class="ayuda" aria-live="polite"></p>
      <label id="accesoLblClave">Clave <input id="accesoClave" type="password" autocomplete="current-password"></label>
      <label id="accesoLblCodigo" hidden>Código del correo <input id="accesoCodigo" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
      <label id="accesoLblRecordar" hidden><input id="accesoRecordar" type="checkbox" checked>Recordar este computador (no volver a pedir el código aquí)</label>
      <p id="accesoError" class="error" aria-live="polite"></p>
      <div class="botones">
        <button type="button" id="accesoOtro" hidden>Pedir otro código</button>
        <button type="button" id="accesoCancelar">Cancelar</button>
        <button type="submit" id="accesoEntrar" class="principal">Entrar</button>
      </div>
    </form>`;
  document.body.appendChild(d);
  return d;
}

// Para páginas enteras del profesor (el editor): se ocultan hasta que haya una sesión válida.
// Ojo: esto solo evita que un estudiante entre por error; el código de la página sigue siendo público.
// Lo que de verdad importa (abrir la votación, nueva ronda, sorteo) lo protege el servidor.
function protegerPagina() {
  const raiz = document.documentElement;
  raiz.style.visibility = "hidden";
  const bloquear = () => {
    document.body.innerHTML = "<p style='padding:24px;font-size:20px;max-width:32em'>Esta página es solo para el profesor. Para responder, usa el enlace o el código que aparece en la pantalla.</p>";
    raiz.style.visibility = "visible";
  };
  const comprobar = async () => {
    let token = sesionGuardada();
    if (token) {
      try { await api({ accion: "sesion", token }); }
      catch (e) { if (sesionVencida(e)) { olvidarSesion(); token = null; } } // sin conexión: vale la sesión guardada
    }
    if (!token) {
      raiz.style.visibility = "visible";
      document.body.style.visibility = "hidden"; // el fondo oscuro del diálogo tapa la página; el diálogo sí se ve
      token = await entrar("Esta página es para el profesor.");
      document.body.style.visibility = "";
      if (!token) return bloquear();
    }
    raiz.style.visibility = "visible";
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", comprobar);
  else comprobar();
}
