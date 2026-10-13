# Operación y verificación para el evento

## Antes de publicar

1. Ejecutar `npm test` y confirmar que no haya fallos.
2. Subir los archivos con `npx clasp push`.
3. En Apps Script, abrir **Implementar > Administrar implementaciones**.
4. Editar la implementación que ya usa el QR, elegir **Nueva versión** y
   publicar. No crear otra implementación: la URL impresa debe conservarse.
5. Si Apps Script lo solicita, autorizar Sheets y la lectura de Drive. La
   aplicación no requiere permiso para modificar archivos de Drive.
6. Abrir la URL canónica desde el QR y comprobar la portada, las fotos, un voto,
   la actualización y el bloqueo posterior.

## Preparar una edición con fotos nuevas

1. En el panel administrativo, ejecutar **Vaciar stands**. La aplicación archiva
   y limpia votos y stands, cierra la votación y permite que los mismos
   dispositivos participen en la edición siguiente.
2. Eliminar manualmente las fotografías anteriores de `Fotos activas`. La
   aplicación no mueve ni borra archivos de Drive.
3. Verificar que la sincronización de la tablet no vuelva a subir las imágenes
   anteriores.
4. Cargar entre 1 y 30 fotografías nuevas y nombrarlas `Stand 1`, `Stand 2`,
   etc. Los números no necesitan ser consecutivos.
5. Esperar a que termine la sincronización, recargar la página y comprobar las
   tarjetas con la votación todavía cerrada.
6. Abrir la votación cuando todas las fotografías estén correctas.

## Qué observar durante el evento

Abrir el proyecto en Apps Script y entrar en **Ejecuciones**. Las operaciones
críticas escriben un registro JSON sin identificadores de dispositivos:

```text
{"event":"operation","operation":"register_vote","result":"ok","category":"none","durationMs":421}
```

Filtrar principalmente estas operaciones:

- `register_vote`: registro definitivo del voto;
- `vote_status`: comprobación inicial del navegador;
- `public_state`: carga de la página pública;
- `public_results`: cálculo o lectura en caché del ranking;
- `drive_photos`: lectura de la carpeta de fotografías;
- `load_test_1500`: prueba controlada de volumen.

Las categorías permiten distinguir rápidamente el origen:

| Categoría | Significado | Acción sugerida |
| --- | --- | --- |
| `lock` | muchas escrituras simultáneas | observar si los reintentos posteriores terminan en `ok` |
| `quota` | límite temporal de Apps Script | reducir pantallas abiertas y esperar unos segundos |
| `permissions` | autorización faltante | autorizar desde el editor con la cuenta propietaria |
| `drive_read` | carpeta, ID o permiso de fotos | revisar `carpeta_fotos_activas_id` y sus permisos |
| `sheets` / `sheets_write` | lectura o escritura de Sheets | revisar acceso, nombre de hojas y cuotas |
| `cache` | caché rechazada o expulsada | no es fatal; el sistema reconstruye desde Sheets/Drive |
| `unknown` | error no clasificado | abrir el detalle y revisar el mensaje o stack técnico |

Un resultado `SYSTEM_BUSY` o `TEMPORARY_FAILURE` es visible para el votante con
un mensaje simple. El navegador realiza hasta dos reintentos breves y variables;
el servidor vuelve a revisar `Votos`, por lo que un reintento no agrega una
segunda fila.

## Prueba de volumen, siempre aislada

Última ejecución: 13 de octubre de 2026, completada correctamente en una copia
aislada. Resultado: 1.500 votos cargados, 1.500 dispositivos únicos, 0 duplicados
y 9 entradas en el ranking. El despliegue temporal usado para ejecutarla fue
retirado y la URL canónica continuó respondiendo con HTTP 200.

La función `prepararPruebaVolumen1500` se niega a escribir en la base configurada
como real. Para usarla:

1. Crear una copia de la planilla. La función limpia solamente la hoja `Votos`
   de esa copia antes de cargar los datos; la planilla real no se modifica.
2. En las propiedades de script, definir `LOAD_TEST_SPREADSHEET_ID` con el ID de
   la copia y `ALLOW_LOAD_TESTS` con el valor `SI`. La aplicación publicada sigue
   usando `SPREADSHEET_ID`, por lo que el QR no cambia de base durante la prueba.
3. Abrir la votación de la copia y ejecutar `prepararPruebaVolumen1500`.
4. Ejecutar `verificarPruebaVolumen1500`. El resultado esperado es
   `loadedVotes: 1500`, `uniqueDevices: 1500`, `duplicates: 0` y diez o menos
   entradas en `topTen`.
5. Revisar los tiempos de `public_state`, `vote_status` y `public_results` en
   **Ejecuciones**.
6. Eliminar o archivar la copia y quitar `ALLOW_LOAD_TESTS` y
   `LOAD_TEST_SPREADSHEET_ID` de las propiedades del proyecto.

## Prueba de concurrencia y recuperación

Última prueba automatizada: 13 de octubre de 2026. Se enviaron 20 votos
simultáneos contra la copia aislada y todos fueron aceptados en 25,9 segundos,
sin fallos transitorios. Una segunda ráfaga idéntica produjo 20 reintentos
idempotentes en 18,1 segundos. Resultado final: 20 dispositivos únicos, 0
duplicados y 0 filas incompletas. El despliegue temporal fue retirado.

Además de la comprobación automatizada del servidor, conviene una pasada manual
para validar el comportamiento visual en navegadores y teléfonos:

1. Usar entre 15 y 20 dispositivos, perfiles o sesiones privadas contra una
   edición de prueba.
2. Confirmar votos casi al mismo tiempo y repetir pequeñas ráfagas durante
   varios minutos, con una pantalla de resultados abierta.
3. Verificar que cada dispositivo tenga una sola fila, que no haya filas
   incompletas y que los mensajes transitorios se recuperen o permitan pulsar
   **Intentar nuevamente**.
4. Cortar brevemente la conexión de una sesión al confirmar un voto, volver a
   conectarla y reintentar. Debe existir una sola fila para ese dispositivo.
5. Repetir el flujo desde Android y iPhone: escanear, votar, actualizar y
   comprobar el bloqueo.

## Comportamiento esperado del ranking

La pantalla consulta aproximadamente cada 15 segundos, no consulta mientras la
pestaña está oculta y actualiza inmediatamente al volver a verla. El servidor
conserva cada cálculo durante 8 segundos y mantiene una respuesta reciente de
respaldo durante 60 segundos si otra ejecución ya está recalculando.
