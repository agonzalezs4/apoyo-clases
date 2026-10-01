# Instalación

Tres rutas. Elige una según lo que tengas a mano (la tabla del [README](../README.md) las compara) y sigue solo
esa sección; el resto del manual es común.

- [A. Servidor propio con Docker (o Node)](#a-servidor-propio-con-docker-o-node)
- [B. GitHub Pages + Google Apps Script](#b-github-pages--google-apps-script)
- [C. Office Scripts + Power Automate (Microsoft 365)](#c-office-scripts--power-automate-microsoft-365)
- [D. Configurar las páginas (config.js y tema.css)](#d-configurar-las-páginas)
- [E. Comprobar que todo funciona](#e-comprobar-que-todo-funciona)
- [F. Actualizar a una versión nueva](#f-actualizar-a-una-versión-nueva)

En todas las rutas, lo primero es tener una copia del proyecto: en GitHub, **Use this template** o **Fork**
(así tienes tu propio repositorio), o **Code › Download ZIP** si no usas Git.

---

## A. Servidor propio con Docker (o Node)

Las páginas y el backend corren juntos en tu computador o en un servidor. Nada sale a Google ni a Microsoft.
Las respuestas quedan en la carpeta `datos/` y las clases publicadas en `clases/`.

### A.1 Con Docker (recomendado)

1. Instala [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, Mac) o Docker Engine (Linux).
2. En la carpeta del proyecto, copia `.env.ejemplo` como `.env` y edítalo:
   `CLAVE_PROFESOR=una-clave-larga-que-no-uses-en-otro-sitio`. Nada más es obligatorio.
3. Arranca:
   ```bash
   docker compose up -d
   ```
4. Abre `http://localhost:8080`. Te pide la clave y entras al editor.

**En la sala de clases.** Los celulares tienen que llegar a tu computador por la red:

- Conéctate al mismo Wi-Fi que los estudiantes (o comparte internet desde tu celular y conéctate a esa red).
- Averigua la IP de tu computador: Windows `ipconfig` (Dirección IPv4), Mac `ipconfig getifaddr en0`, Linux `hostname -I`.
- La dirección para los estudiantes es `http://ESA-IP:8080` (el QR que proyecta `presentar.html` ya la lleva).
- Si no cargan, el cortafuegos de tu computador está bloqueando el puerto 8080: permítelo para redes privadas.
- Muchas redes institucionales aíslan a los dispositivos entre sí; en ese caso sirve compartir internet desde un celular,
  o instalar el servidor en internet (A.3).

**Más seguro: la clave sin escribirla en `.env`.** En vez de `CLAVE_PROFESOR`, genera un *hash*:
```bash
docker compose run --rm recolector node servidor/configurar.js --sin-archivo
```
Pide la clave sin mostrarla, ofrece activar un **segundo paso con app autenticadora** (Google Authenticator,
Microsoft Authenticator, Aegis…) e imprime las líneas `CLAVE_PROFESOR_HASH=…` y `TOTP_SECRETO=…` para pegar en `.env`.

**Comandos útiles**
```bash
docker compose logs -f          # ver qué pasa (cada consulta, con LOG=1 en .env)
docker compose down             # apagar; datos/ y clases/ se conservan
docker compose up -d --build    # tras descargar una versión nueva
```

**Respaldo.** Copia la carpeta `datos/` (respuestas en `respuestas.ndjson`, estado y secretos) y `clases/`.
Las respuestas también se descargan como planilla desde el editor («Descargar respuestas (CSV)»).

### A.2 Sin Docker, con Node

Sirve igual si tienes [Node.js](https://nodejs.org) 18 o superior (no hay nada que instalar con npm).

```bash
npm run configurar      # pide la clave (y el segundo paso opcional); guarda solo el hash en datos/secretos.json
npm start               # http://localhost:8080
```
Variables de entorno opcionales: `PUERTO`, `HORAS_SESION`, `INTENTOS_MAX`, `MINUTOS_BLOQUEO`, `DATOS`, `CLASES`, `LOG=1`
(todas documentadas al inicio de `servidor/servidor.js`).

### A.3 En internet con HTTPS

Para usarlo desde cualquier red (y para que los navegadores no muestren avisos), ponlo detrás de HTTPS. El proyecto
trae una variante con [Caddy](https://caddyserver.com), que pide y renueva el certificado solo:

1. Un servidor con Docker y una dirección pública (cualquier VPS pequeño basta) y un dominio o subdominio que
   apunte a él (registro DNS tipo A).
2. En `.env` agrega `DOMINIO=clases.tu-dominio.cl`. Abre los puertos 80 y 443.
3. `docker compose -f docker-compose.https.yml up -d`

Si ya tienes un *reverse proxy* (nginx, Traefik), apúntalo al puerto 8080 del contenedor y sirve el sitio en la
raíz del dominio (el servidor espera estar en `/`, no en una subcarpeta).

---

## B. GitHub Pages + Google Apps Script

Las páginas viven gratis en GitHub Pages y las respuestas llegan a una hoja de cálculo de Google. No hay servidor
que mantener. Es la ruta con que nació el proyecto.

### B.1 Las páginas en GitHub Pages

1. Con tu copia del repositorio en GitHub: **Settings › Pages › Build and deployment › Source: Deploy from a branch**,
   rama `main`, carpeta `/ (root)`. Guarda.
2. En un par de minutos el sitio está en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.
3. Las clases que publiques desde el editor se guardan como archivos en `clases/` del repositorio: el editor te abre
   GitHub con el archivo listo para confirmar (ver el manual del profesor).

### B.2 El backend en Google

1. Crea una **hoja de cálculo de Google** nueva (ahí llegarán las respuestas). Menú **Extensiones › Apps Script**.
2. Borra el contenido del editor y pega **todo** el archivo `apps-script/Codigo.gs`. Guarda (icono de disquete).
3. Elige tu clave: **Configuración del proyecto** (engranaje a la izquierda) › **Propiedades del script › Agregar
   propiedad**: nombre `CLAVE_NUEVA`, valor la clave que quieras (12 caracteres o más). Guarda las propiedades.
   (Si te saltas este paso, el siguiente genera una clave al azar y te la manda a tu correo.)
4. Vuelve al editor, en la lista de funciones (arriba) elige **configurar** y pulsa **Ejecutar**. La primera vez
   Google pide permisos: *Revisar permisos › tu cuenta › Avanzado › Ir a … (no seguro) › Permitir*. Es tu propio
   script pidiendo acceso a tu hoja y a enviar correos desde tu cuenta.
   Al terminar, en el registro de ejecución verás «Clave guardada (solo su hash)…». La propiedad `CLAVE_NUEVA`
   se borra sola: tu clave no queda escrita en ninguna parte.
5. **Implementar › Nueva implementación** › engranaje › tipo **Aplicación web** › Descripción libre ›
   *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Cualquier persona** › **Implementar**. Copia la **URL de la
   aplicación web** (termina en `/exec`).
6. Pega esa URL en `config.js` → `API_URL` (sección D).

Al entrar como profesor, además de la clave te llegará un **código de 6 dígitos al correo** (segundo paso).
Si prefieres solo la clave, cambia `CODIGO_POR_CORREO` a `false` al inicio de `Codigo.gs` y vuelve a implementar.

**Para actualizar el script más adelante** (una versión nueva del proyecto): pega el `Codigo.gs` nuevo, ejecuta
`configurar` otra vez y luego **Implementar › Administrar implementaciones › (lápiz) › Versión: Nueva versión ›
Implementar**. Así la URL no cambia. Si solo guardas sin «Nueva versión», sigue corriendo la versión anterior.

**Cambiar la clave**: agrega de nuevo la propiedad `CLAVE_NUEVA` y ejecuta `configurar`.
**Si te bloqueaste** (5 intentos fallidos): ejecuta `desbloquearAcceso` desde el editor.
**Si dejaste la sesión abierta en un PC ajeno**: ejecuta `cerrarSesiones`.

---

## C. Office Scripts + Power Automate (Microsoft 365)

Para quien tiene Excel de Microsoft 365 y no puede usar Google. Las respuestas quedan en un libro de Excel de tu
OneDrive o SharePoint. Tiene requisitos (Power Automate con el conector HTTP, que es premium) y límites de
capacidad (decenas de estudiantes, no cientos). Todo está explicado paso a paso en
[`office-scripts/README.md`](../office-scripts/README.md).

Las páginas pueden estar en GitHub Pages (sección B.1), en cualquier hosting estático, o incluso en el servidor
propio de la sección A (en ese caso el servidor solo sirve las páginas; `API_URL` apunta al flujo).

---

## D. Configurar las páginas

Dos archivos y nada más:

- **`config.js`**: `API_URL` (la dirección del backend), `INSTITUCION`, `CURSO`, `ENLACE_CORTO`, `PREFIJO_CLASE`.
- **`tema.css`**: colores, letra y redondeo.

La forma fácil es abrir **`configurar.html`** en el navegador (desde tu sitio o directamente desde la carpeta):
eliges el backend y pegas su dirección, escribes los textos, ajustas colores con vista previa (te avisa si algún
contraste es bajo) y descargas los dos archivos listos. Reemplaza con ellos los de la carpeta del sitio:

- Servidor propio: cópialos en la carpeta del proyecto y recarga (Ctrl+F5).
- GitHub Pages: súbelos al repositorio (arrastrándolos en la web de GitHub o con Git).

También puedes editarlos a mano: están comentados línea por línea. Detalles en
[`PERSONALIZACION.md`](PERSONALIZACION.md).

> Con el servidor propio, `API_URL` debe quedar en `"/api"` (es el valor que trae). Con Google, la URL `/exec`.
> Con Power Automate, la URL del desencadenador HTTP tal cual, aunque ya traiga `?…&sig=…`.

---

## E. Comprobar que todo funciona

1. Abre `presentar.html?clase=ejemplo`. Debe decir «Pregunta 1 de 4, ronda 1, 0 respuestas · votación cerrada».
   Si dice «No pude leer las respuestas», `API_URL` está mal o el backend no responde (abre `API_URL` + `?accion=info`
   en el navegador: debe devolver `{"version":4,…}`).
2. Pulsa **Abrir votación**: pide tu clave (y el segundo paso, si lo activaste). Debe pasar a «votación abierta».
3. Escanea el QR con tu celular (o abre `votar.html?clase=ejemplo`), responde y pulsa **Responder**. El proyector
   muestra la respuesta en unos segundos y el celular muestra su código de sorteo.
4. Abre `index.html`: entra con la clave, revisa que la lista de clases muestre `ejemplo`, publica una clase de
   prueba y ábrela con **Presentar**.

Si algo falla, el manual del profesor tiene una sección de problemas frecuentes.

---

## F. Actualizar a una versión nueva

- **Servidor propio**: descarga la versión nueva (o `git pull`), conserva tus `config.js`, `tema.css`, `.env`,
  `datos/` y `clases/`, y vuelve a arrancar (`docker compose up -d --build`).
- **GitHub Pages**: trae los cambios a tu repositorio (si hiciste *fork*, el botón **Sync fork**) y cuida de no
  pisar tus `config.js`, `tema.css` y `clases/`.
- **Backend**: si el cambio toca `apps-script/Codigo.gs` u `office-scripts/Recolector.ts`, actualízalo como indica
  su sección (en Apps Script, siempre **Nueva versión**). El proyector avisa si el backend es más antiguo que las páginas.
