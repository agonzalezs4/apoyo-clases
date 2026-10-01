/* =====================================================================
   config.js — la configuración del sitio. Es lo único que hay que editar
   (o genera este archivo con configurar.html y reemplázalo).
   ===================================================================== */
const CONFIG = {
  // Dónde se guardan las respuestas. Pega la dirección que te entregó la instalación (docs/INSTALACION.md):
  //  - Servidor propio (Docker):         "/api"  → la misma dirección donde están estas páginas
  //  - Google Apps Script:               "https://script.google.com/macros/s/…/exec"
  //  - Office Scripts + Power Automate:  la dirección del desencadenador HTTP (muy larga, con sig=…)
  API_URL: "/api",

  // Textos que aparecen en las páginas (vacío = no se muestra)
  INSTITUCION: "",   // p. ej. "Universidad de Ejemplo"
  CURSO: "",         // p. ej. "Epidemiología 2026"

  // Enlace corto que los estudiantes pueden escribir a mano (opcional; vacío = se muestra la dirección completa).
  // Con "tinyurl.com/mi-curso/" la pantalla dice «tinyurl.com/mi-curso/10-1» para la clase «clase-10-1»
  // (ver docs/PERSONALIZACION.md para crear ese enlace).
  ENLACE_CORTO: "",
  PREFIJO_CLASE: "clase-",  // parte del nombre de la clase que se omite en el enlace corto

  DIGITOS_CODIGO: 5,        // dígitos del código de sorteo tras la letra (igual que en el backend)
};
