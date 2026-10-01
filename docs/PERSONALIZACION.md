# Personalización

Todo lo que se puede adaptar sin tocar el código: colores y letra (`tema.css`), textos y backend (`config.js`),
el enlace corto, páginas junto a las preguntas, y cómo llevar la identidad de tu institución.

## El asistente: `configurar.html`

Ábrelo en el navegador (desde tu sitio, p. ej. `https://tu-sitio/configurar.html`, o haciendo doble clic en el
archivo). Eliges el backend, escribes los textos, ajustas los colores con **vista previa en vivo** y una
comprobación de contraste, eliges la letra y descargas `config.js` y `tema.css` listos para reemplazar los del sitio.
Parte de los valores que ya tiene tu sitio, así que sirve también para retocar.

## `tema.css`: colores, letra y forma

Un solo bloque de variables, comentadas. Cámbialas y recarga.

```css
:root {
  --color-principal:    #1F4E79;  /* barras de resultados, botones principales, títulos */
  --color-sobre-principal: #FFFFFF; /* texto encima del color principal */
  --color-acento:       #C9A227;  /* contorno del foco (teclado) y subrayado de enlaces */
  --color-fondo:        #F4F6F8;
  --color-superficie:   #FFFFFF;  /* tarjetas, botones, cuadros de texto */
  --color-texto:        #14213D;
  --color-texto-suave:  #55637A;  /* ayudas, metadatos */
  --color-borde:        #CBD3DD;  /* bordes y rieles de las barras */
  --color-error:        #9A3B1B;
  --fuente: "Atkinson Hyperlegible", system-ui, …;
  --fuente-cifras: var(--fuente);  /* números y códigos del sorteo */
  --radio: 6px;                    /* redondeo (0 = esquinas rectas) */
}
```

Consejos para el proyector: contraste alto entre `--color-texto` y `--color-fondo` (4,5:1 o más), un
`--color-principal` oscuro y saturado para que las barras se vean desde atrás, y evita fondos oscuros si la sala
tiene mucha luz. En `ejemplos/temas/` hay tres temas listos: `uss.css` (Universidad San Sebastián), `verde-sobrio.css`
(solo letra del sistema) y `alto-contraste.css`. Para usar uno, cópialo sobre `tema.css`.

`estilos.css` es la base común y no hace falta editarlo; si quieres cambiar algo más fino (tamaños, espaciados),
cada página tiene su propio bloque `<style>` al inicio.

## La letra

Viene incluida **Atkinson Hyperlegible** (diseñada para legibilidad, licencia libre OFL), en cuatro archivos de unos
18 KB que se sirven desde `fuentes/`: ninguna página pide nada a Google Fonts ni a otro servidor.

Opciones:

- **Letra del sistema** (cero descargas): en `tema.css` deja `--fuente` a partir de `system-ui, …`. El archivo
  `fuentes/fuentes.css` puede quedar enlazado; el navegador no descarga fuentes que no se usan.
- **Otra fuente de Google Fonts, pero local**: con Node instalado,
  ```bash
  node herramientas/fuente.js "Montserrat"              # pesos 400 y 700, normal e itálica, subconjunto latino
  node herramientas/fuente.js "Roboto Condensed" 700 --sin-italica
  ```
  descarga los `.woff2` a `fuentes/` y crea `fuentes/montserrat.css`. Luego, en la primera línea de `tema.css`:
  `@import url("fuentes/montserrat.css");` y `--fuente: "Montserrat", system-ui, …`. Revisa la licencia de la fuente en
  fonts.google.com (casi todas son OFL, redistribuibles).
- **Una fuente propia o institucional** (p. ej. la corporativa, si tienes licencia para publicarla): deja los
  `.woff2` en `fuentes/`, escribe sus reglas `@font-face` en un `.css` ahí mismo (copia el formato de
  `fuentes/fuentes.css`) e impórtalo desde `tema.css` como arriba. Si no puedes publicarla, ponla igual en
  `--fuente` seguida de alternativas: los computadores que la tengan instalada la usarán.
- `--fuente-cifras` es para los números (conteos, porcentajes, códigos del sorteo), por si quieres una condensada
  o monoespaciada.

## `config.js`: textos y backend

```js
const CONFIG = {
  API_URL: "/api",             // dónde se guardan las respuestas (ver INSTALACION.md)
  INSTITUCION: "",             // aparece en letra pequeña sobre los títulos (vacío = no aparece)
  CURSO: "",
  ENLACE_CORTO: "",            // ver abajo
  PREFIJO_CLASE: "clase-",
  DIGITOS_CODIGO: 5,           // igual que en el backend (DIGITOS)
};
```

## El enlace corto

Debajo del QR, el proyector muestra una dirección para quien prefiera escribirla. Por defecto es la dirección
completa de la página de votación, que puede ser larga. Con `ENLACE_CORTO` se muestra algo como
`tinyurl.com/mi-curso/10-1` para la clase `clase-10-1` (`PREFIJO_CLASE` es lo que se omite del nombre).

Cómo funciona: el sitio trae una página `404.html` que convierte `tu-sitio/10-1` en `votar.html?clase=clase-10-1`
(prueba `10-1`, `clase-10-1` y, si termina en número, también la pregunta). Así, basta un acortador que **agregue lo
que viene después** de su alias a la dirección de destino:

1. En [tinyurl.com](https://tinyurl.com) crea un alias (p. ej. `mi-curso`) que apunte a la **raíz de tu sitio**,
   con barra final: `https://tu-usuario.github.io/apoyo-clases/` (o `https://clases.tu-dominio.cl/`).
2. Comprueba que `https://tinyurl.com/mi-curso/10-1` abre la votación de la clase `clase-10-1`.
3. En `config.js`: `ENLACE_CORTO: "tinyurl.com/mi-curso/"`.

Con el servidor propio también funciona la dirección corta sin acortador: `http://IP:8080/10-1` llega a `404.html`
y abre la clase. En GitHub Pages, lo mismo con `https://tu-usuario.github.io/apoyo-clases/10-1`.

## Una página junto a la pregunta

Cada pregunta tiene el campo **Página**: el nombre de un archivo `.html` de tu sitio (en la raíz o en una
subcarpeta, p. ej. `graficos/incidencia.html`). Se muestra en un marco bajo el enunciado, en el proyector y en el
celular. Sirve para un gráfico interactivo, una tabla, una imagen con su leyenda, un fragmento de texto.

- Si la página mide su alto y lo avisa, el marco se ajusta sin barra de desplazamiento:
  `parent.postMessage({ tipo: "alto-widget", alto: document.documentElement.scrollHeight }, "*")` al cargar y al
  cambiar de tamaño.
- En `ejemplos/epidemiologia-uss/policonsumo_prevalencia_vs_tasa.html` hay un ejemplo real con D3 (ese ejemplo sí
  carga D3 desde un CDN; si quieres que funcione sin internet, descarga `d3.min.js` a `lib/` y cambia el `<script>`).
- Deslizar sobre la página embebida también cambia de pregunta en el celular.

## Textos e idioma

Todo está en español, escrito en los propios archivos HTML (los mensajes al estudiante en `votar.html`, los del
proyector en `presentar.html`, los del editor en `index.html`) y los mensajes de error del backend en cada
implementación (`servidor/servidor.js`, `apps-script/Codigo.gs`, `office-scripts/Recolector.ts`). Dos textos del backend
los reconocen las páginas y deben quedar iguales en ambos lados: «Sesión vencida: vuelve a entrar» y
«Votación cerrada» (ver [API.md](API.md)).

## Otras cosas

- **Código de sorteo**: `DIGITOS_CODIGO` (páginas) y `DIGITOS` (backend) deben coincidir; 5 dígitos hace muy
  improbable que dos celulares coincidan y es fácil de leer en el proyector.
- **Tiempos**: la sesión del profesor (`HORAS_SESION`), los intentos antes del bloqueo (`INTENTOS_MAX`) y su duración
  (`MINUTOS_BLOQUEO`) se ajustan en el backend (variables de entorno en el servidor propio; constantes al inicio de
  `Codigo.gs` y de `Recolector.ts`).
- **Página 404**: `404.html` también es lo que ve quien escribe mal una dirección; puedes darle tu estilo (carga
  `tema.css` si quieres) manteniendo el script que resuelve los nombres de clase.
