# Preguntas en vivo para la sala de clases

Un «Mentimeter casero» que cualquier profesor puede instalar y adaptar a su curso o universidad:
los estudiantes escanean un QR, responden desde el celular (sin cuentas ni aplicaciones) y el proyector
muestra los resultados al instante. Trae alternativas, escala, número y respuesta abierta; rondas; apertura
y cierre de la votación; y un sorteo con códigos que premia a quienes respondieron bien.

Es **autocontenido**: páginas estáticas sin servicios externos (librerías y fuentes incluidas), un archivo de
configuración, un archivo de tema, y el backend que prefieras para guardar las respuestas.

| Dónde se guardan las respuestas | Para quién | Qué necesitas | Capacidad |
|---|---|---|---|
| **Servidor propio** (Docker o Node) | Quien quiere todo bajo su control, sin Google ni Microsoft; o para la red local de la sala | Un computador o servidor con Docker (o Node 18+) | Cientos de celulares a la vez |
| **Google Apps Script** (hoja de cálculo de Google) | Quien ya usa Google; sin servidor propio ni costo | Cuenta de Google + GitHub Pages (u otro hosting estático) | Cientos de celulares a la vez |
| **Office Scripts + Power Automate** (Excel de Microsoft 365) | Quien tiene Microsoft 365 y no Google | Cuenta M365 con Power Automate (conector premium) | Decenas de celulares |

Las páginas (editor, proyector y votación) son las mismas en los tres casos: solo cambia `API_URL` en `config.js`.
Cualquier otro backend que siga el contrato de [`docs/API.md`](docs/API.md) también sirve.

## Inicio rápido (servidor propio con Docker)

```bash
git clone https://github.com/agonzalezs4/apoyo-clases.git
cd apoyo-clases
cp .env.ejemplo .env        # y escribe tu clave de profesor en CLAVE_PROFESOR
docker compose up -d
```

Abre `http://localhost:8080` (en la sala, `http://IP-de-tu-computador:8080`), entra con la clave y publica
tu primera clase. La guía completa, con las otras dos rutas, está en [`docs/INSTALACION.md`](docs/INSTALACION.md).

## Manuales

- [`docs/INSTALACION.md`](docs/INSTALACION.md) — instalar paso a paso: servidor propio (Docker), Google Apps Script u Office Scripts.
- [`docs/MANUAL-PROFESOR.md`](docs/MANUAL-PROFESOR.md) — usarlo en clase: armar preguntas, proyectar, abrir la votación, rondas, sorteo.
- [`docs/PERSONALIZACION.md`](docs/PERSONALIZACION.md) — colores, letra, textos, enlace corto, páginas embebidas; el asistente `configurar.html`.
- [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md) — cómo se protege la clave del profesor y qué cubre (y qué no) cada backend.
- [`docs/API.md`](docs/API.md) — el contrato entre las páginas y el backend, para implementar otro.

## Qué hay en el repositorio

```
index.html        editor del profesor: arma, publica y lista las clases; genera QR; descarga respuestas (servidor propio)
presentar.html    pantalla del proyector: resultados en vivo, abrir/cerrar votación, rondas, sorteo
votar.html        lo que ve el estudiante en su celular
configurar.html   asistente que genera config.js y tema.css (colores, letra, textos, backend)
config.js         LA configuración: dónde está el backend, institución, curso, enlace corto
tema.css          LOS colores y la letra (ver ejemplos/temas/)
estilos.css       base común; no hace falta tocarlo
comun.js, clases.js, profesor.js   código compartido por las páginas
404.html          convierte direcciones cortas (tu-sitio/10-1) en la página de votación
clases/           las clases publicadas, una por archivo .json (clases/ejemplo.json de muestra)
fuentes/          Atkinson Hyperlegible local (OFL) y fuentes.css
lib/              lz-string y qrcode-generator (MIT), sin CDN
servidor/         servidor propio en Node, sin dependencias: servidor.js, configurar.js, pruebas
apps-script/      backend en Google Apps Script (Codigo.gs)
office-scripts/   backend en Office Scripts + Power Automate (Recolector.ts y su guía)
herramientas/     fuente.js: trae otra fuente de Google Fonts al sitio
pruebas/          pruebas automáticas (API, Apps Script y Office Scripts simulados, navegador real)
ejemplos/         temas de ejemplo y las clases reales del curso donde nació el proyecto
Dockerfile, docker-compose.yml, docker-compose.https.yml, .env.ejemplo
```

## Pruebas

```bash
npm test                              # servidor propio (API, almacenamiento, acceso, TOTP)
node --test pruebas/                  # además, Apps Script y Office Scripts sobre servicios simulados
node pruebas/e2e.js                   # flujo completo en un navegador real (necesita playwright)
```

## Origen y licencias

Nació en un curso de Epidemiología de la Universidad San Sebastián (Chile); sus clases y su tema están en
`ejemplos/` como muestra. El código propio de este repositorio todavía no declara licencia (decisión pendiente del
autor). Las librerías incluidas son MIT (`lib/LICENCIAS.txt`) y la fuente Atkinson Hyperlegible es SIL OFL 1.1
(`fuentes/LICENCIA-OFL.txt`). «QR Code» es marca registrada de DENSO WAVE.
