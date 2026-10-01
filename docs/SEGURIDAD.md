# Seguridad

Qué protege el sistema, cómo, y qué no cubre. Pensado para que un profesor decida con información, no para
expertos.

## El modelo en una frase

Las páginas son públicas y cualquiera puede leer su código; por eso **nada secreto vive en ellas**. Lo que importa
(abrir y cerrar la votación, nuevas rondas, leer los códigos del sorteo, publicar clases, exportar respuestas) lo
decide el **backend**, que exige una sesión de profesor obtenida con la clave.

## La clave del profesor

- **Nunca está escrita en el código ni en las páginas.** En las versiones anteriores de este proyecto estaba (o
  estaba su *hash*) en un archivo público; eso se eliminó y el historial se colapsó para no exponerla.
- **Nunca se guarda en el navegador.** La ventana de acceso la pide, la envía al backend una vez y la borra. En el
  proyector el campo es de tipo contraseña: no se ve en pantalla.
- **El backend solo guarda un *hash* con sal**, nunca la clave:
  - Servidor propio: `scrypt` (N = 16384), en `datos/secretos.json` o en la variable `CLAVE_PROFESOR_HASH`.
    Si usas `CLAVE_PROFESOR` en texto plano en `.env`, el servidor la convierte en hash al arrancar y no la escribe
    en ningún archivo; aun así, prefiere el hash (`node servidor/configurar.js --sin-archivo`) y protege `.env`.
  - Apps Script: SHA-256 con sal, 5000 iteraciones, en las propiedades del script (solo las ve el dueño).
    `configurar()` borra la propiedad `CLAVE_NUEVA` en cuanto la convierte.
  - Office Scripts: el mismo esquema (2000 iteraciones), en la hoja `Config` del libro. La celda con la clave en
    claro se borra al ejecutar el script. No compartas el libro.
- **Límite de intentos**: tras 5 fallos seguidos (clave o segundo paso), el acceso se bloquea 15 minutos para
  todos (Apps Script además avisa por correo). Las sesiones ya abiertas siguen funcionando.
- **Comparaciones de tiempo constante** en los tres backends: el tiempo de respuesta no revela cuántos caracteres
  coinciden.

## El segundo paso (dos factores)

Aunque alguien consiga la clave, no entra sin:

- **Servidor propio**: un código de 6 dígitos de una **app autenticadora** (TOTP, RFC 6238: Google Authenticator,
  Microsoft Authenticator, Aegis, 1Password…). Se activa con `node servidor/configurar.js`; un código no sirve dos
  veces. Es la opción más fuerte de las tres.
- **Apps Script**: un código de 6 dígitos que llega **a tu correo** (vence en 10 minutos; a lo más uno por minuto;
  tres errores lo invalidan). Se desactiva con `CODIGO_POR_CORREO = false`.
- **Office Scripts**: no trae segundo paso (se puede armar en el flujo; ver su README). Usa una clave larga.

## Sesiones

Al entrar, el backend entrega un **token al azar de 64 caracteres** que vence a las 12 horas (`HORAS_SESION`).
El navegador lo guarda en `localStorage`; el backend guarda solo su hash SHA-256, así que ni quien vea las
propiedades del script, la hoja `Estado` o `datos/estado.json` puede usarlo. **Cerrar sesión** lo invalida en el
backend. Si usaste un computador ajeno y no cerraste: Apps Script `cerrarSesiones`; servidor propio, borra las
entradas `sesiones` de `datos/estado.json` y reinicia; Office Scripts, borra las filas `ses_…` de `Estado`.

## Las respuestas de los estudiantes

- **Anónimas**: no se pide nombre, correo ni cuenta. Lo único que identifica un celular es el código de sorteo
  (letra + 5 dígitos), elegido al azar por el propio celular. Si guardas las planillas, no contienen datos personales,
  salvo que los estudiantes los escriban en una pregunta abierta: adviérteselo si corresponde.
- **Un voto por celular y ronda**: el celular recuerda qué envió y el backend ignora reenvíos del mismo lote. Es una
  protección contra duplicados por reintentos, **no** contra un estudiante que quiera votar varias veces (puede borrar
  los datos del navegador o usar otro): esto es una herramienta pedagógica, no una urna. El código de sorteo visible
  disuade: votar dos veces con el mismo código lo invalida («lo usaron dos personas»).
- **Códigos del sorteo que no se pueden inventar**: la letra inicial es un HMAC de los dígitos con un secreto que
  solo el backend conoce; un código escrito a mano no pasa la verificación. La respuesta correcta nunca sale del
  navegador del profesor: la corrección se hace ahí.
- **La tanda parte cerrada** y el backend rechaza respuestas mientras lo esté: nadie responde antes de tiempo ni
  después de que muestres los resultados.

## Transporte (HTTPS)

- GitHub Pages, Apps Script y Power Automate van siempre por HTTPS.
- El servidor propio en la **red local de la sala** va por HTTP plano: cualquiera en ese Wi-Fi podría ver lo que
  viaja (respuestas anónimas y, al entrar tú, la clave). Es un riesgo acotado pero real. Mitigaciones: usa una clave
  exclusiva para esto, activa el segundo paso TOTP (la clave sola no basta), o publica el servidor en internet con
  HTTPS (`docker-compose.https.yml`) y úsalo desde la sala por esa dirección.

## Qué hace el servidor propio por su cuenta

- Sirve solo los archivos del sitio; nunca `datos/`, `servidor/`, `.env`, ni archivos o carpetas que empiecen con
  punto. Rechaza rutas con `..`.
- `/api` acepta solo GET (y HEAD) con parámetros acotados en largo y cantidad; las clases que se publican se validan
  campo a campo antes de escribirlas; los nombres de clase solo admiten `a-z 0-9 _ -`.
- Responde `Access-Control-Allow-Origin: *` en `/api`, igual que Apps Script: la API no tiene nada privado que una
  página ajena pueda leer sin el token (que no viaja en cookies).
- No registra direcciones IP ni agentes de usuario, salvo que actives `LOG=1` (y entonces solo ruta, código y tiempo).

## Recomendaciones

1. Clave larga (12 o más caracteres), exclusiva para esto, guardada en un gestor de contraseñas.
2. Activa el segundo paso (TOTP en el servidor propio, correo en Apps Script).
3. No compartas la hoja de cálculo, el libro de Excel ni la carpeta `datos/`: ahí están las respuestas y los hashes.
4. Si sospechas que la clave se filtró: cámbiala (Apps Script: `CLAVE_NUEVA` + `configurar`; servidor propio:
   `configurar.js` y reinicia; Office: `Config!B1` y ejecuta el script) y cierra las sesiones.
5. Mantén el proyecto actualizado: el proyector avisa si el backend es más antiguo que las páginas.

Si encuentras un problema de seguridad, abre un *issue* en el repositorio describiendo cómo reproducirlo.
