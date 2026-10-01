# Manual del profesor

Cómo usarlo en clase, de principio a fin. Supone que el sitio ya está instalado ([INSTALACION.md](INSTALACION.md)).
Tres páginas: el **editor** (`index.html`), el **proyector** (`presentar.html`) y la página que ven los estudiantes
en su celular (`votar.html`).

## 1. Antes de la clase: armar las preguntas

Abre `index.html` (la portada del sitio). Te pide la **clave de profesor** y, según el backend, un segundo paso
(código al correo o de tu app autenticadora). La sesión dura 12 horas en ese navegador; cierra sesión si usas un
computador ajeno.

### Tipos de pregunta

| Tipo | El estudiante… | El proyector muestra | Sirve para el sorteo |
|---|---|---|---|
| **Alternativas** | toca una (o varias, si lo permites) | barras con conteo y porcentaje | sí |
| **Escala** (p. ej. 1 a 5, con texto en los extremos) | toca un valor | barras, promedio y mediana | opcional |
| **Número** (con unidad opcional) | escribe un número | histograma, mediana, promedio y rango | sí |
| **Abierta** | escribe hasta 200 caracteres | nube de palabras (las repetidas crecen) o lista | no |

Cada pregunta puede llevar una **página** opcional: un archivo `.html` de tu sitio (un gráfico interactivo, una
tabla, una imagen) que se muestra junto a la pregunta en el proyector y en el celular. Ver [PERSONALIZACION.md](PERSONALIZACION.md).

### Una clase = una tanda

Las preguntas de una clase forman una **tanda**: el estudiante escanea **un solo QR**, pasa de pregunta en pregunta
deslizando o con las flechas, puede cambiar sus respuestas, y al final pulsa **Responder** una vez. Conviene que la
tanda tenga pocas preguntas (3 a 6) y que las uses en un mismo momento de la clase. Para otro momento, publica otra
clase (por ejemplo `clase-10-1` y `clase-10-2`).

### Publicar

1. Ponle **nombre** a la clase (minúsculas, números y guiones; se usa en la dirección: `clase-10-1`).
2. Pulsa **Publicar**. Lo que pasa depende de dónde esté el sitio; el editor lo detecta solo:
   - **Servidor propio**: botón **Guardar en el servidor**. Queda disponible al instante.
   - **GitHub Pages**: el editor abre GitHub con el archivo `clases/<nombre>.json` listo; pulsa **Commit changes**.
     Tarda uno o dos minutos en aparecer. Si la clase ya existía, usa el segundo enlace (editar el archivo existente).
   - **Otro hosting**: copia o descarga el archivo y súbelo a la carpeta `clases/`.
3. La sección **Clases publicadas** las lista. Desde ahí: **Presentar**, **Editar aquí** (carga la clase en el
   editor; al volver a publicar con el mismo nombre, reemplaza la anterior) y **Ver enlaces por pregunta**.

**Probar sin publicar** abre el proyector con las preguntas dentro del enlace: sirve para ver cómo quedan, y los
celulares reciben un enlace por pregunta (no una tanda).

El editor guarda el borrador en tu navegador: si cierras la pestaña, al volver sigue ahí.

### El QR

El proyector ya muestra el QR de la tanda. El panel **Generar un QR** del editor es para otros usos: un QR del
enlace corto para la diapositiva de bienvenida, del sitio completo, de una lectura, etc. Se descarga como PNG o se
muestra a pantalla completa.

## 2. En la clase: el proyector

Abre `presentar.html?clase=<nombre>` (o **Presentar** desde el editor). Se ve la pregunta, el QR y, debajo, los
controles. Todo tiene atajo de teclado:

| Acción | Botón | Tecla | Qué hace |
|---|---|---|---|
| Cambiar de pregunta | Anterior / Siguiente | ← → | La dirección cambia (`&p=2`): puedes enlazar cada pregunta desde tus diapositivas. |
| **Abrir / Cerrar votación** | Abrir votación | **V** | La tanda parte **cerrada**: los celulares esperan. Al abrir, aparecen las preguntas en los celulares. Al cerrar, el servidor deja de aceptar respuestas. |
| Ocultar resultados | Ocultar resultados | H | Para que respondan sin ver cómo van los demás. El QR sigue a la vista. |
| Nube o lista | Ver como lista | W | Solo en preguntas abiertas. |
| Nueva ronda | Nueva ronda | R | El gráfico de **esa pregunta** parte de cero; los celulares pueden responderla de nuevo. Las respuestas anteriores no se borran (quedan con su número de ronda). |
| Sortear | Sortear | S | Premia a los códigos que respondieron bien (abajo). |
| QR | Ocultar QR | Q | Más espacio para el gráfico. |
| Pantalla completa | Pantalla completa | F | |

**Flujo típico**: proyectas la primera pregunta con el QR, pides que escaneen (una sola vez, sirve para toda la
tanda), pulsas **V** para abrir, das tiempo, y vas pasando por las preguntas mientras llegan las respuestas (el
proyector se actualiza cada 3 segundos). Cuando todos pulsaron **Responder**, cierras con **V** y comentas los
resultados. Si quieres volver a preguntar algo tras la discusión, **R** abre una nueva ronda de esa pregunta.

**Escribir la dirección a mano**: bajo el QR aparece el enlace. Si configuraste un enlace corto, es algo como
`tinyurl.com/mi-curso/10-1`; si no, la dirección completa de la página de votación.

### El sorteo

Cada celular recibe un **código** (una letra y cinco dígitos, p. ej. `K48271`) que se muestra en su pantalla y vale
para toda la tanda. Con **S**:

1. Marca la **respuesta correcta** de cada pregunta de alternativas y de número; en las de escala, elige el valor
   correcto o «Sin correcta» (entonces no cuenta). Las abiertas no entran. Lo marcado se recuerda para esa clase.
2. Elige el **porcentaje** de preguntas buenas que premia («50 % o más» de 4 preguntas = al menos 2).
3. **Calcular premiados**: se leen los votos de toda la tanda **una sola vez** y se corrige en tu navegador; la
   respuesta correcta nunca viaja al servidor ni a los celulares. Aparecen los códigos premiados en grande.
4. **Verificar un código**: escribe el que te muestra un estudiante y te dice si está premiado y cuántas buenas tuvo.

Cierra la votación antes de mostrar las respuestas correctas, o alguien podría responder después de verlas (el
diálogo te lo recuerda). Un código que aparece con respuestas distintas a la misma pregunta se marca como «lo usaron
dos personas» y no se premia. Los códigos no se pueden inventar: llevan una letra que solo el servidor sabe calcular.

## 3. Qué ve el estudiante

Escanea el QR o escribe la dirección. Si la votación está cerrada, ve «Espera a que tu profesor abra la votación»
y la página se abre sola cuando pulsas **V**. Responde cada pregunta (puede dejar alguna en blanco, se le avisa),
revisa el resumen y pulsa **Responder**. Desde ese momento ya no puede cambiar nada, salvo que abras una nueva
ronda. Arriba ve su código de sorteo. No se le pide nombre ni cuenta; lo marcado queda guardado en su celular hasta
que lo envía, así que un corte de red no le hace perder nada.

## 4. Después de la clase

- **Las respuestas**: en el servidor propio, botón **Descargar respuestas (CSV)** del editor (una planilla con
  fecha, pregunta, ronda, respuesta y código; se abre directo en Excel). Con Google, están en la hoja de cálculo
  (pestaña `Respuestas`). Con Office Scripts, en el libro de Excel.
- **Reusar una clase**: la misma clase se puede proyectar en otra sección. Pero las respuestas se acumulan en la
  misma pregunta y ronda; para partir de cero sin perder lo anterior, usa **Nueva ronda** en cada pregunta, o
  publica la clase con otro nombre (p. ej. `clase-10-1-seccion-b`).
- **Cerrar sesión** en el editor si el computador no es tuyo.

## 5. Problemas frecuentes

| Qué ves | Qué pasa | Qué hacer |
|---|---|---|
| «No pude leer las respuestas: …» en el proyector | Las páginas no llegan al backend | Revisa `API_URL` en `config.js`; abre `API_URL?accion=info` en el navegador. Con Docker, revisa que el contenedor esté corriendo. |
| «El backend publicado es una versión anterior» | Actualizaste las páginas pero no el backend | Apps Script: pega el `Codigo.gs` nuevo, ejecuta `configurar` y **Nueva versión**. Docker: `docker compose up -d --build`. |
| Los celulares no cargan la página (servidor propio en la sala) | No llegan a tu computador por la red | Mismo Wi-Fi; cortafuegos (puerto 8080); comparte internet desde un celular; o pon el servidor en internet. |
| Los celulares ven «Espera a que tu profesor abra la votación» | La tanda está cerrada | Pulsa **V** en el proyector. |
| «Demasiados intentos fallidos» al entrar | Cinco claves o códigos malos seguidos (tuyos o de otro) | Espera 15 minutos. Apps Script: `desbloquearAcceso`. Docker: reinicia el contenedor o espera. Si no fuiste tú, cambia la clave. |
| Un estudiante dice que envió y su respuesta no aparece | Cerraste la votación antes de que llegara, o respondió una ronda anterior | Lo marcado sigue en su celular: abre la votación (o una nueva ronda) y que pulse **Responder** de nuevo. |
| Se cerró una pestaña del celular y perdió el código | El código vive en el navegador del celular | Si vuelve a abrir el mismo enlace en el mismo navegador, lo recupera. En otro navegador tendrá un código nuevo. |
| Enunciado muy largo en el celular | | Se muestra con letra más pequeña; mejor acorta la pregunta y pon el detalle en una **página** adjunta. |
