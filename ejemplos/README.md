# Ejemplos

- `temas/` — temas listos para copiar sobre `tema.css` (colores, letra y forma). `uss.css` es el tema de la
  Universidad San Sebastián con que nació el proyecto; `verde-sobrio.css` usa solo la letra del sistema;
  `alto-contraste.css` para proyectores débiles. También puedes generar el tuyo con `configurar.html`.
- `epidemiologia-uss/` — las clases reales de un curso de Epidemiología (`clases/*.json`), una página
  interactiva (`policonsumo_prevalencia_vs_tasa.html`) que una de ellas muestra junto a la pregunta
  (campo `pagina`) y el `config.js` de ese sitio (GitHub Pages + Apps Script + enlace corto de TinyURL).
  Para probarlas, copia los `.json` a la carpeta `clases/` del sitio y la página `.html` a la raíz.
  Ojo: la página interactiva carga D3 desde un CDN, así que necesita internet.
