# Sistema de votación de stands

Aplicación web sencilla para publicar fotos de stands y habilitar una votación durante un evento. Está pensada para ejecutarse como una aplicación web de Google Apps Script y utilizar Google Sheets como base de datos.

## Estructura

- `Code.gs`: entrada del servidor y, más adelante, acceso a Sheets y reglas de votación.
- `Index.html`: estructura de la página pública.
- `Stylesheet.html`: estilos responsive.
- `JavaScript.html`: interacción de la interfaz.
- `appsscript.json`: configuración del proyecto de Apps Script.

Apps Script no trabaja cómodamente con carpetas internas, por eso los archivos del proyecto se mantienen en la raíz.

## Estado actual

La interfaz incluye:

- encabezado compacto con institución, título y logo configurables desde Sheets;
- 3 stands por fila en orientación vertical y 5 en horizontal;
- 30 stands temporales mientras no exista la hoja `Stands`;
- ampliación de cada foto y selección desde la vista ampliada;
- confirmación final mediante un botón fijo al pie de la pantalla;
- registro en la hoja `Votos` y bloqueo de un segundo voto desde el mismo navegador;
- acceso visual al futuro panel de administración mediante PIN.

## Diseño propuesto para Google Sheets

Se usará un único archivo con estas hojas:

| Hoja | Responsabilidad |
| --- | --- |
| `configuracion` | nombre de la institución, título, logo y estado (`draft`, `open`, `closed`) |
| `Stands` | identificador, nombre, URL de la foto, orden y estado visible |
| `Votos` | fecha, identificador anónimo del dispositivo y stand elegido |

Claves reconocidas en `configuracion`:

| Clave | Ejemplo |
| --- | --- |
| `nombre_institucion` | `CENMA Brigadier J. I. San Martín Anexo Sacchi` |
| `logo_url` | enlace compartido del archivo de Drive |
| `titulo_sistema` | `Sistema de votación` |
| `estado_votacion` | `open` |

El ID de la base puede reemplazarse sin editar el código mediante la propiedad de
script `SPREADSHEET_ID`.

El PIN no debe guardarse en una celda ni enviarse al navegador. Se almacenará como propiedad privada del script y se comprobará únicamente en el servidor.

## Criterio para evitar votos repetidos

La opción simple será guardar un identificador aleatorio persistente en el navegador (`localStorage`) y rechazar en el servidor un segundo voto con el mismo identificador. Esto evita el problema de volver a votar al refrescar la página, aunque no impide que alguien use otro navegador o borre sus datos.

Si el evento necesita una garantía más fuerte de “una persona, un voto”, la alternativa recomendada es entregar códigos únicos de votación a los asistentes. No hace falta decidirlo para construir la primera versión.

## Próximas etapas

1. Cargar los datos y las fotos definitivas en la hoja `Stands`.
2. Crear el panel mínimo de administración: abrir, cerrar y reiniciar.
3. Agregar carga de fotos y generación del QR público.
4. Mostrar resultados y hacer una prueba de carga.
