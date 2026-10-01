// clases.js — las clases publicadas: archivos clases/<nombre>.json junto a estas páginas
// Ejemplo: clases/clase-05.json  ->  presentar.html?clase=clase-05&p=2
// Se publican de tres maneras (index.html lo detecta solo): guardándolas en el servidor propio (Docker),
// subiéndolas al repositorio de GitHub Pages, o copiando el archivo a mano.

async function cargarClase(nombre) {
  const r = await fetch(`clases/${encodeURIComponent(nombre)}.json?_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`No encontré clases/${nombre}.json. Si recién lo subiste, espera un par de minutos y recarga.`);
  const c = await r.json();
  if (!c || !Array.isArray(c.p)) throw new Error(`El archivo clases/${nombre}.json no tiene el formato esperado.`);
  return c;
}

// Nombre válido de clase: minúsculas, números, guiones (es parte de la dirección y del nombre del archivo)
function limpiarNombreClase(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 60);
}

// «clase-10-1» -> «10-1» (lo que el estudiante escribe tras el enlace corto)
function nombreCorto(nombre) {
  const pre = (typeof CONFIG !== "undefined" && CONFIG.PREFIJO_CLASE) || "";
  return pre && nombre.startsWith(pre) ? nombre.slice(pre.length) : nombre;
}

// Lo que se muestra en el proyector para escribir a mano: el enlace corto configurado o la dirección completa
function enlaceParaEscribir(nombre) {
  const corto = (typeof CONFIG !== "undefined" && CONFIG.ENLACE_CORTO) || "";
  if (corto) return corto.replace(/^https?:\/\//, "") + nombreCorto(nombre);
  return new URL(`votar.html?clase=${encodeURIComponent(nombre)}`, location.href).href.replace(/^https?:\/\//, "");
}

// Usuario y repositorio a partir de la dirección de GitHub Pages (null si no estamos ahí)
function repoGithub() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return null;
  const primero = location.pathname.split("/").filter(Boolean)[0] || "";
  const repo = primero && !primero.includes(".") ? primero : `${m[1]}.github.io`;
  return { usuario: m[1], repo };
}

const ordenarNombres = ns => ns.sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

// Lista de clases publicadas: { nombres, rama }, o null si no hay dónde leerla. modo = "servidor" | "github" | "manual" (ver index.html)
async function listarClasesPublicadas(modo, GH) {
  if (modo === "servidor") {
    const d = await api({ accion: "clases" });
    return { nombres: ordenarNombres((d.clases || []).map(c => c.nombre)), rama: null };
  }
  if (modo === "github" && GH) {
    let rama = "main";
    const info = await fetch(`https://api.github.com/repos/${GH.usuario}/${GH.repo}`).then(r => r.ok ? r.json() : null);
    if (info && info.default_branch) rama = info.default_branch;
    const r = await fetch(`https://api.github.com/repos/${GH.usuario}/${GH.repo}/contents/clases?ref=${rama}`);
    if (r.status === 404) return { nombres: [], rama };
    if (!r.ok) throw new Error("GitHub respondió " + r.status);
    const nombres = (await r.json()).filter(a => a.type === "file" && a.name.endsWith(".json")).map(a => a.name.slice(0, -5));
    return { nombres: ordenarNombres(nombres), rama };
  }
  return null;
}
