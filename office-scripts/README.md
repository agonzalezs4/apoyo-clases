# Backend con Office Scripts + Power Automate (Microsoft 365)

Para quien tiene Excel de Microsoft 365 y no puede (o no quiere) usar Google. Las respuestas
quedan en un libro de Excel de tu OneDrive o SharePoint. **Léelo entero antes de elegir esta ruta:**
tiene requisitos y límites que los otros dos backends no tienen.

## Antes de empezar: qué necesitas y qué límites tiene

- Una cuenta de Microsoft 365 de trabajo o estudio con **Excel para la web** (Office Scripts) y **Power Automate**.
- El desencadenador «Cuando se recibe una solicitud HTTP» es un **conector premium** de Power Automate. En muchas
  universidades está incluido en el plan institucional; si no lo tienes, pregunta a tu área de informática o usa
  otro backend.
- Cada respuesta de un celular es **una ejecución del flujo** que corre el script sobre el libro. Las ejecuciones
  deben ir **de a una** (lo configuras más abajo) para que dos no escriban el libro a la vez, y Power Automate tiene
  cuotas de ejecuciones por día y por minuto según tu licencia. En la práctica funciona bien con grupos de unas
  decenas de estudiantes que responden en un lapso de minutos; con cientos a la vez, usa el servidor propio (Docker)
  o Google Apps Script.
- No hay segundo paso por correo al entrar (solo la clave, con bloqueo tras 5 intentos fallidos). Usa una clave larga.
- Office Scripts no trae criptografía: el SHA-256 va implementado en el propio script y los tokens de sesión salen de
  `Math.random` mezclado con la hora. Es razonable para este uso, pero menos fuerte que en los otros backends.
- Esta ruta está **menos probada**: el script pasa pruebas automáticas sobre un Excel simulado
  (`pruebas/office-scripts.test.js`), no sobre Microsoft 365 real. Si algo no calza con tu Excel, abre un *issue*.

## 1. El script en Excel

1. Crea un libro nuevo en Excel para la web (OneDrive o SharePoint). Ponle un nombre claro, p. ej. `respuestas-clases.xlsx`.
2. Pestaña **Automatizar › Nuevo script**. Borra el contenido, pega `office-scripts/Recolector.ts` entero y guárdalo
   con el nombre **Recolector**.
3. Pulsa **Ejecutar**. La primera vez crea las hojas `Respuestas`, `Estado` y `Config`, y en `Config` deja una fila
   `CLAVE_NUEVA` con la celda **B1 vacía**.
4. Escribe tu clave de profesor en **Config!B1** (8 caracteres o más; mejor 12) y vuelve a **Ejecutar**. El script
   guarda solo el *hash* de la clave en `CLAVE_HASH`, borra B1 y genera el `SECRETO` que firma los códigos del sorteo.
   Para cambiar la clave más adelante, repite este paso.

La hoja `Config` solo la debe ver el profesor: no compartas el libro con los estudiantes (no hace falta; ellos
hablan con el flujo, no con el libro).

## 2. El flujo en Power Automate

1. En [make.powerautomate.com](https://make.powerautomate.com) → **Crear › Flujo de nube instantáneo**, sin plantilla.
   Nombre: `Recolector de respuestas`. Desencadenador: **Cuando se recibe una solicitud HTTP** (categoría *Solicitud*).
2. En el desencadenador: **Método: GET**. Deja el esquema del cuerpo vacío. En «Quién puede desencadenar el flujo»
   elige **Cualquiera** (los celulares de los estudiantes no tienen cuenta Microsoft).
3. Agrega la acción **Excel Online (Empresa) › Ejecutar script**:
   - Ubicación / Biblioteca / Archivo: tu libro `respuestas-clases.xlsx`.
   - Script: **Recolector**.
   - Parámetro **consulta**: pulsa «Expresión» y pega exactamente:
     ```
     string(triggerOutputs()?['queries'])
     ```
     (así el script recibe todos los parámetros de la dirección, p. ej. `accion`, `q`, `token`, en un solo texto JSON).
4. Agrega la acción **Respuesta** (categoría *Solicitud*):
   - Código de estado: `200`.
   - Encabezados: `Content-Type` = `application/json; charset=utf-8`, `Access-Control-Allow-Origin` = `*`,
     `Cache-Control` = `no-store`.
   - Cuerpo: contenido dinámico **result** de «Ejecutar script» (o la expresión `outputs('Ejecutar_script')?['body/result']`).
5. **Importante:** en el desencadenador, menú `…` › **Configuración › Control de simultaneidad: Activado, Grado de
   paralelismo: 1**. Así las ejecuciones se encolan y dos estudiantes no escriben el libro al mismo tiempo.
6. Guarda. Vuelve a abrir el desencadenador: ya muestra la **URL HTTP POST** (aunque diga POST sirve para GET, que es
   el método que elegiste). Cópiala completa: es larga y termina en `…&sig=…`.

## 3. Conectar el sitio

Pega esa URL en `config.js` → `API_URL` (o en `configurar.html`, opción *Office Scripts + Power Automate*).
El sitio agrega sus parámetros con `&` detrás de los que ya trae la URL, así que no hay que tocarla.

Prueba: abre `presentar.html?clase=ejemplo`. Si aparece «Pregunta 1 de 4, ronda 1, 0 respuestas · votación cerrada»,
el flujo responde. Pulsa **Abrir votación**, entra con tu clave y responde desde tu celular.

## Opcional: código al correo como segundo paso

El script no envía correos, pero el flujo sí puede. Si quieres el segundo paso: en Power Automate, antes de
«Respuesta», agrega una **Condición** sobre el `result` del script (por ejemplo que contenga `"paso":"codigo"`) y en la
rama «sí» una acción **Office 365 Outlook › Enviar correo** con el código. Requiere adaptar `entrar()` en el script
para generar y guardar el código en `Estado` (igual que hace `apps-script/Codigo.gs`); si te animas, la lógica de
Apps Script es una buena guía y se agradece un *pull request*.

## Si algo falla

- **La página dice «No pude leer las respuestas»**: abre la URL del flujo en el navegador agregando
  `&accion=info` al final; debe devolver `{"version":4,"backend":"office-scripts",…}`. Si devuelve un error de Power
  Automate, revisa el historial de ejecuciones del flujo: ahí se ve el paso que falló.
- **«Falta configurar la clave»**: no se ejecutó el script desde Excel con la clave en `Config!B1` (paso 1.4).
- **Las respuestas tardan**: es la cola de ejecuciones (paralelismo 1). Pide a los estudiantes que respondan con calma;
  el celular reintenta solo hasta que el servidor confirma.
- **Excel cambia «1,5» por una fecha o un número**: las columnas de `Respuestas` se formatean como texto al crearlas.
  Si creaste la tabla a mano, selecciona las columnas y ponles formato *Texto*.
