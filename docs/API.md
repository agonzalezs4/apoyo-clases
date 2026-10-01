# Contrato de la API

Lo que las páginas (`presentar.html`, `votar.html`, `index.html`, `profesor.js`) esperan del backend. Cualquier
servicio que lo cumpla sirve: hoy hay tres implementaciones (`servidor/servidor.js`, `apps-script/Codigo.gs`,
`office-scripts/Recolector.ts`). Las pruebas de `servidor/servidor.test.js` y `pruebas/` muestran el comportamiento
esperado con ejemplos concretos.

## Forma general

- **Transporte**: `GET` a `API_URL` con los parámetros en la consulta (`?accion=…&q=…`). Las páginas agregan un
  parámetro `_` (marca de tiempo) para evitar cachés; ignóralo. Si `API_URL` ya trae consulta, los parámetros se
  agregan con `&`.
- **Respuesta**: siempre `200` con JSON (`Content-Type: application/json`). Un error es `{"error": "texto"}`,
  también con `200` (Apps Script no puede devolver otro código y las páginas se basan en el JSON). Si el backend está
  en otro origen que las páginas, debe enviar `Access-Control-Allow-Origin: *`.
- **Dos textos de error son parte del contrato** porque las páginas los reconocen:
  - `"Sesión vencida: vuelve a entrar"` → `profesor.js` descarta la sesión guardada y vuelve a pedir la clave.
  - `"Votación cerrada"` → `votar.html` sabe que no se guardó nada y muestra la pantalla de espera.
- **Límites** que aplican los backends existentes (conviene mantenerlos): id de pregunta ≤ 40 caracteres; respuesta
  ≤ 500; texto de la pregunta ≤ 300; hasta 30 preguntas por tanda; `v` ≤ 24 caracteres `[A-Za-z0-9_-]`.
- **Ronda**: entero que parte en 1 por pregunta. **Abierta**: la tanda parte cerrada; una pregunta nunca abierta
  está cerrada.

## Acciones públicas (las usan los celulares y el proyector)

| `accion` | Parámetros | Respuesta | Notas |
|---|---|---|---|
| `info` | — | `{version, backend, clases, exportar, segundoPaso}` | `version` ≥ 4. `clases`/`exportar`: si implementa `clases`+`guardarClase` y `exportar`. `segundoPaso`: `""`, `"correo"` o `"totp"` (solo informativo). Un backend antiguo responde `Acción desconocida` y las páginas asumen lo mínimo. |
| `estados` | `qs` = ids separados por coma | `{rondas: {id: n}, abiertas: {id: bool}}` | La consultan los celulares cada 5–10 s mientras esperan; debe ser liviana. |
| `leer` | `q` | `{ronda, respuestas: [texto…], abierta, version}` | Respuestas de la ronda vigente, en orden de llegada. El proyector la llama cada 3 s. `version` ≥ 3 o el proyector avisa que el backend es antiguo. |
| `lote` | `d` = JSON `[[id, respuesta, textoPregunta], [id], …]`, `v` = id del envío, `n` = dígitos elegidos por el celular | `{ok, rondas: {id: n}, codigo?, repetido?}` | Guarda todas las respuestas de la tanda de una vez. Un ítem `[id]` (sin respuesta) no se guarda, pero se devuelve su ronda. Si alguna pregunta está cerrada → error `Votación cerrada` y **no se guarda nada**. Reintento con el mismo `v` → devuelve lo mismo con `repetido: true`, sin duplicar. `codigo` = letra + `n` si `n` tiene el largo correcto y empieza en 1–9. |
| `enviar` | `q`, `r`, `t`, `v`, `n` | `{ok, ronda, codigo?, repetido?}` | Versión antigua de `lote` para una sola pregunta; mantenla por compatibilidad. |
| `estado` | `q` | `{ronda}` | Antiguo; `estados` lo reemplaza. |
| `entrar` | `clave`, `codigo?` | `{ok, token, expira}` o `{paso: "codigo", correo?, texto?, reenvio?}` | Ver «Acceso». |

## Acciones del profesor (exigen `token`)

Todas reciben `token` y responden `Sesión vencida: vuelve a entrar` si falta, no existe o venció.

| `accion` | Parámetros | Respuesta | Notas |
|---|---|---|---|
| `sesion` | `token` | `{ok: true}` | Para comprobar una sesión guardada. |
| `salir` | `token` | `{ok: true}` | Invalida el token. Debe responder `ok` aunque el token no exista. |
| `abrir` | `qs`, `abrir` = `"1"`/`"0"` | `{ok, abierta}` | Abre o cierra toda la tanda. |
| `ronda` | `q` | `{ok, ronda}` | Nueva ronda de esa pregunta (ronda + 1). |
| `sorteo` | `qs` | `{votos: [[codigo, id, respuesta]…], invalidos}` | Votos **con código** de la ronda vigente de cada pregunta. `invalidos` = votos con un código que no pasa la verificación de la letra (se excluyen). La corrección la hace el navegador del profesor. |
| `clases` | — | `{clases: [{nombre, preguntas, modificado}]}` | Opcional (`info.clases`). |
| `guardarClase` | `nombre`, `d` = JSON de la clase | `{ok, nombre, preguntas}` | Opcional. Debe validar `nombre` (`^[a-z0-9][a-z0-9_-]{0,59}$`) y la estructura (abajo) antes de escribir `clases/<nombre>.json`. |
| `exportar` | `token` | archivo CSV (`text/csv`, `Content-Disposition: attachment`) | Opcional (`info.exportar`). La única acción que no responde JSON cuando tiene éxito; un error sigue siendo JSON. |

## Acceso

1. La página envía `entrar` con `clave` (y `codigo` vacío).
2. Si la clave es incorrecta → `{"error": "Clave incorrecta"}`. Cuenta un intento fallido; tras `INTENTOS_MAX`
   seguidos → `{"error": "Demasiados intentos fallidos. Espera N min…"}` durante `MINUTOS_BLOQUEO`.
3. Si la clave es correcta y hay segundo paso → `{"paso": "codigo", "correo": "pr…@x.cl"}` (código enviado por
   correo) o `{"paso": "codigo", "texto": "Escribe el código de tu app autenticadora.", "reenvio": false}`.
   La página muestra `texto` si viene; con `reenvio: false` oculta «Pedir otro código». Luego repite `entrar` con
   `clave` y `codigo`. Código malo → `{"error": "Código incorrecto"}` (o `"Código incorrecto. Pide uno nuevo."`,
   `"El código venció. Pide uno nuevo."`: los textos que contienen «Pide uno nuevo» hacen volver al paso de la clave).
4. Si todo está bien → `{"ok": true, "token": "…64 caracteres…", "expira": milisegundosEpoch}`. La página guarda
   `token` y `expira` en `localStorage` y manda `token` en las acciones del profesor.

Recomendaciones: guardar solo el hash del token y de la clave; comparar en tiempo constante; atender los intentos
de a uno.

## Código de sorteo

El celular elige `DIGITOS` dígitos (sin cero inicial) una vez por tanda y los manda como `n` en cada `lote`. El
backend antepone una **letra verificadora** = `LETRAS[HMAC-SHA256(SECRETO, dígitos)[0] % 24]` con
`LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"` (sin I ni O), guarda el código completo junto a cada respuesta y lo devuelve.
`sorteo` solo entrega votos cuyo código pasa la verificación. `SECRETO` es propio de cada instalación; cambiarlo
invalida los códigos de las tandas en curso.

## Formato de una clase (`clases/<nombre>.json`)

```json
{
  "nombre": "clase-10-1",
  "p": [
    { "id": "c101-a", "tipo": "alt", "texto": "¿…?", "opciones": ["A", "B"], "multi": false, "pagina": "grafico.html" },
    { "id": "c101-b", "tipo": "esc", "texto": "¿…?", "min": 1, "max": 5, "etqMin": "Nada", "etqMax": "Mucho" },
    { "id": "c101-c", "tipo": "num", "texto": "¿…?", "unidad": "%" },
    { "id": "c101-d", "tipo": "abi", "texto": "…" }
  ]
}
```
`id` es único dentro del sitio (`[A-Za-z0-9_-]`, ≤ 40): el backend agrupa respuestas, rondas y aperturas por `id`,
así que dos clases no deben compartir ids (el editor los deriva del nombre de la clase). `pagina` es opcional y
debe ser una ruta relativa a un `.html` del sitio. Varias alternativas marcadas viajan en una sola respuesta
separadas por `" ‖ "`.

## Versiones

| `version` | Qué agrega |
|---|---|
| 1 | `enviar`, `leer`, `estado`, `ronda` |
| 2 | `lote`, `estados`, código de sorteo, `sorteo` |
| 3 | `abrir`/cerrar la tanda, `entrar`/`sesion`/`salir` con sesión en vez de clave por acción |
| 4 | `info`; clave guardada como hash (no en el código); opcionales `clases`, `guardarClase`, `exportar` |

## Lista de verificación para un backend nuevo

- [ ] Responde `info` con `version: 4` y su nombre.
- [ ] `estados` y `leer` funcionan sin sesión y son rápidas (se consultan mucho).
- [ ] `lote` rechaza con `Votación cerrada` si alguna pregunta está cerrada y no guarda nada en ese caso.
- [ ] `lote` con el mismo `v` no duplica y responde `repetido: true`.
- [ ] `entrar` limita intentos, nunca guarda la clave en claro, entrega tokens al azar con vencimiento.
- [ ] Las acciones del profesor rechazan con el texto exacto `Sesión vencida: vuelve a entrar`.
- [ ] `sorteo` excluye códigos cuya letra no verifica y cuenta `invalidos`.
- [ ] CORS `*` si vive en otro origen que las páginas.
- [ ] Pasa un flujo como el de `servidor/servidor.test.js` (puedes adaptar ese archivo para apuntar a tu servicio).
