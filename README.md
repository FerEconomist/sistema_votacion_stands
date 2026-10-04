# Sistema de votación de stands

Aplicación web sencilla para publicar fotos de stands y habilitar una votación durante un evento. Está pensada para ejecutarse como una aplicación web de Google Apps Script y utilizar Google Sheets como base de datos.

## Estructura

- `Code.gs`: servidor, acceso a Sheets y Drive, autenticación y reglas de votación.
- `Index.html`: estructura de la página pública.
- `Results.html`: ranking público actualizado automáticamente.
- `Stylesheet.html`: estilos responsive.
- `JavaScript.html`: interacción de la interfaz.
- `appsscript.json`: configuración del proyecto de Apps Script.

Apps Script no trabaja cómodamente con carpetas internas, por eso los archivos del proyecto se mantienen en la raíz.

## Estado actual

La interfaz incluye:

- encabezado institucional centrado y destacado, con título y logo configurables desde Sheets;
- aviso superior prominente del estado de la votación y de la apertura estimada;
- 3 stands por fila en orientación vertical y 5 en horizontal;
- 30 stands temporales mientras no exista la hoja `Stands`;
- ampliación de cada foto y selección desde la vista ampliada;
- confirmación final mediante un botón fijo al pie de la pantalla;
- registro en la hoja `Votos` y bloqueo de un segundo voto desde el mismo navegador;
- panel administrativo para tablet protegido con un PIN de cuatro dígitos;
- apertura, cierre, cambio de horario, reinicio de votos y vaciado seguro de stands;
- ranking público con las primeras diez posiciones y actualización automática;
- lectura automática de fotos llamadas `Stand 1`, `Stand 2`, etc. desde `Fotos activas`.

## Diseño propuesto para Google Sheets

Se usará un único archivo con estas hojas:

| Hoja | Responsabilidad |
| --- | --- |
| `configuracion` | nombre de la institución, título, logo y estado (`draft`, `open`, `closed`) |
| `Stands` | identificador, nombre, URL de la foto, orden y estado visible |
| `Votos` | fecha, identificador anónimo del dispositivo y stand elegido |
| `Historial_Votos` | copias creadas antes de reiniciar o vaciar una edición |
| `Historial_Stands` | copias de los datos de stands antes de vaciarlos |

Claves reconocidas en `configuracion`:

| Clave | Ejemplo |
| --- | --- |
| `nombre_institucion` | `CENMA Brigadier J. I. San Martín Anexo Sacchi` |
| `logo_url` | enlace compartido del archivo de Drive |
| `titulo_sistema` | `Sistema de votación` |
| `estado_votacion` | `closed` |
| `horario_apertura` | `18:30 h` |
| `pin_admin` | `1234` |
| `mostrar_resultados` | `no` |
| `carpeta_fotos_activas_id` | ID de la carpeta `Fotos activas` |
| `carpeta_fotos_archivadas_id` | ID de la carpeta `Archivadas` |

La aplicación comienza cerrada si `estado_votacion` está vacío o no existe. Para
habilitar los votos, cambiá su valor a `open` o utilizá el panel administrativo.
Mientras permanezca cerrada, `horario_apertura` aparece como horario estimado.
`mostrar_resultados` acepta `si` o `no`.

El ID de la base puede reemplazarse sin editar el código mediante la propiedad de
script `SPREADSHEET_ID`.

El PIN se lee desde `configuracion`, se comprueba únicamente en el servidor y
nunca se incluye en el estado enviado al navegador. Después de varios intentos
incorrectos, el acceso se bloquea temporalmente.

## Flujo de fotografías

La carpeta `Fotos activas` contiene las imágenes de la edición actual. El nombre
de cada archivo debe seguir el formato `Stand 1`, `Stand 2`, etc.; la extensión
puede ser `.jpg`, `.png`, `.webp` u otro formato de imagen compatible con el
navegador. Si existe más de una imagen para el mismo número, se usa la modificada
más recientemente.

Al ejecutar `Vaciar stands`, la aplicación crea una subcarpeta fechada dentro de
`Archivadas`, mueve allí el contenido de `Fotos activas`, respalda votos y datos
de stands, limpia la edición actual y deja la votación cerrada. La carpeta
`imagenes`, utilizada para el logo, no se modifica.

## Criterio para evitar votos repetidos

La opción simple será guardar un identificador aleatorio persistente en el navegador (`localStorage`) y rechazar en el servidor un segundo voto con el mismo identificador. Esto evita el problema de volver a votar al refrescar la página, aunque no impide que alguien use otro navegador o borre sus datos.

Si el evento necesita una garantía más fuerte de “una persona, un voto”, la alternativa recomendada es entregar códigos únicos de votación a los asistentes. No hace falta decidirlo para construir la primera versión.

## Publicación

Los cambios locales se suben al proyecto de Apps Script con `npx clasp push`.
Después hay que actualizar la implementación de la aplicación web para que la
URL pública utilice la nueva versión. La primera ejecución con las funciones de
archivado solicitará autorización para administrar las carpetas de Drive.
