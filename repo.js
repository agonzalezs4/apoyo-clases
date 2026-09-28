// Clases guardadas como archivos en la carpeta clases/ del repositorio
// Ejemplo: clases/clase-05.json  ->  presentar.html?clase=clase-05&p=2

async function cargarClase(nombre) {
  const r = await fetch(`clases/${encodeURIComponent(nombre)}.json?_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`No encontré clases/${nombre}.json. Si recién lo subiste, espera un par de minutos y recarga.`);
  const c = await r.json();
  if (!c || !Array.isArray(c.p)) throw new Error(`El archivo clases/${nombre}.json no tiene el formato esperado.`);
  return c;
}

// Usuario y repositorio a partir de la dirección de GitHub Pages
function repoGithub() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return null;
  const primero = location.pathname.split("/").filter(Boolean)[0] || "";
  const repo = primero && !primero.includes(".") ? primero : `${m[1]}.github.io`;
  return { usuario: m[1], repo };
}
