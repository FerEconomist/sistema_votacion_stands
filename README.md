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

La primera versión de la interfaz incluye:

- grilla responsive de stands;
- estado visible de la votación;
- botones de voto deshabilitados mientras el evento está en preparación;
- ampliación de cada foto en una ventana;
- acceso visual al futuro panel de administración mediante PIN;
- datos temporales para poder diseñar la pantalla antes de conectar Sheets.

## Diseño propuesto para Google Sheets

Se usará un único archivo con estas hojas:

| Hoja | Responsabilidad |
| --- | --- |
| `Configuracion` | nombre del evento, estado (`draft`, `open`, `closed`) y referencias necesarias |
| `Stands` | identificador, nombre, descripción, URL de la foto, orden y estado visible |
| `Votos` | fecha, identificador anónimo del dispositivo y stand elegido |

El PIN no debe guardarse en una celda ni enviarse al navegador. Se almacenará como propiedad privada del script y se comprobará únicamente en el servidor.

## Criterio para evitar votos repetidos

La opción simple será guardar un identificador aleatorio persistente en el navegador (`localStorage`) y rechazar en el servidor un segundo voto con el mismo identificador. Esto evita el problema de volver a votar al refrescar la página, aunque no impide que alguien use otro navegador o borre sus datos.

Si el evento necesita una garantía más fuerte de “una persona, un voto”, la alternativa recomendada es entregar códigos únicos de votación a los asistentes. No hace falta decidirlo para construir la primera versión.

## Próximas etapas

1. Conectar la grilla con la hoja `Stands`.
2. Crear el panel mínimo de administración: abrir, cerrar y reiniciar.
3. Registrar el voto en el servidor y bloquear duplicados.
4. Agregar carga de fotos y generación del QR público.
5. Mostrar resultados y hacer una prueba de carga.
