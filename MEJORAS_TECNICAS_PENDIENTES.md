# Mejoras técnicas pendientes para el evento

## Contexto

El sistema ya permite votar una sola vez por navegador, conserva ese bloqueo al
actualizar la página, administra los horarios de apertura y cierre y publica el
ranking. La URL canónica es la que ya está impresa en los códigos QR.

La cantidad prevista es de aproximadamente 1.500 participantes. Ese volumen de
datos es pequeño para Google Sheets: cada voto ocupa solamente una fila. El
riesgo principal no es la cantidad total, sino una concentración de muchas
solicitudes simultáneas durante la apertura de la votación.

El navegador guarda en `localStorage` un único identificador anónimo, no una
lista de votos. Por lo tanto, el problema observado en el sistema anterior al
superar aproximadamente 500 votos no corresponde a una falta de espacio en
`localStorage`.

## Riesgos actuales

### 1. Escrituras simultáneas

Cada voto obtiene un `ScriptLock`, revisa los dispositivos registrados y agrega
una fila en `Votos`. Este control evita duplicaciones y colisiones, pero también
serializa las escrituras. El tiempo de espera actual es de 10 segundos; una
ráfaga grande de votos podría producir vencimientos del bloqueo.

### 2. Trabajo innecesario durante el voto

La validación del stand utiliza actualmente el mismo recorrido que arma las
tarjetas públicas. Ese recorrido consulta las fotos de Drive aunque el registro
del voto sólo necesita comprobar el ID y el nombre del stand.

### 3. Lecturas repetidas de Drive y Sheets

La carga de la página vuelve a recorrer la carpeta de fotografías. Además, la
consulta del estado del navegador lee los identificadores ya registrados. Con
1.500 filas esto sigue siendo manejable, pero repetir esas operaciones para
muchos usuarios al mismo tiempo aumenta la latencia y el consumo de servicios.

### 4. Actualización frecuente del ranking

La página de resultados consulta la hoja completa cada 7 segundos. Una sola
pantalla de resultados no representa un problema, pero muchos asistentes con el
ranking abierto podrían generar más ejecuciones que los propios votos.

### 5. Límites de Apps Script

Apps Script publica límites de ejecuciones simultáneas y puede rechazar
temporalmente solicitudes cuando hay demasiadas en curso. El diseño debe asumir
que pueden existir picos aunque el promedio de votos por minuto sea bajo.

Referencias oficiales:

- [Cuotas y límites de Apps Script](https://developers.google.com/apps-script/guides/services/quotas)
- [Lock Service](https://developers.google.com/apps-script/reference/lock/)
- [Buenas prácticas de rendimiento](https://developers.google.com/apps-script/guides/support/best-practices)

## Estado de implementación

Las cuatro prioridades de código quedaron implementadas el 12 de octubre de
2026. También se incorporaron pruebas automatizadas y funciones protegidas para
la prueba de 1.500 votos. El 13 de octubre de 2026 se ejecutó esa prueba en una
copia aislada: se cargaron y contaron 1.500 votos, con 1.500 dispositivos únicos,
0 duplicados y un ranking válido para los 9 stands disponibles. La implementación
temporal se retiró y la URL canónica del QR continuó respondiendo correctamente.
Ese mismo día se ejecutaron 20 solicitudes web simultáneas: las 20 fueron
aceptadas sin fallos transitorios; una segunda ráfaga con las mismas solicitudes
fue reconocida como 20 reintentos idempotentes y dejó 0 duplicados y 0 filas
incompletas. Permanecen manuales la verificación final en Android/iPhone y la
recuperación visual ante una desconexión breve. El procedimiento está en
`OPERACION_EVENTO.md`.

## Mejoras propuestas

### Prioridad 1: endurecer el registro de votos

- Crear una lectura liviana de stands para validar votos sin consultar Drive.
- Reducir al mínimo el trabajo realizado mientras se mantiene el `ScriptLock`.
- Ampliar el tiempo de espera del bloqueo y devolver un mensaje específico si
  el sistema está temporalmente ocupado.
- Mantener siempre la hoja `Votos` como fuente de verdad para impedir votos
  duplicados, incluso si una caché se pierde o vence.
- Implementar en el cliente uno o dos reintentos automáticos con una espera
  breve y variable únicamente para errores transitorios. Un reintento nunca
  debe duplicar un voto ya aceptado.

### Prioridad 2: incorporar caché con invalidación segura

- Guardar temporalmente en `CacheService` la configuración pública, la lista de
  stands y las referencias de fotografías.
- Invalidar la caché al abrir o cerrar la votación, modificar horarios, vaciar
  stands o preparar una nueva edición.
- Guardar el ranking calculado durante un intervalo corto, por ejemplo entre 5
  y 10 segundos.
- La caché será una optimización y no una fuente de verdad. Ante una ausencia o
  expulsión de datos, el sistema debe reconstruirlos desde Sheets y Drive.

### Prioridad 3: reducir consultas del ranking

- Cambiar la actualización automática de 7 a aproximadamente 15 segundos.
- Pausar las consultas cuando la pestaña de resultados no esté visible.
- Actualizar inmediatamente al volver a una pestaña visible.
- Evitar que varias solicitudes simultáneas recalculen el mismo ranking cuando
  todavía existe una respuesta reciente en caché.

### Prioridad 4: observabilidad operativa

- Registrar duración y resultado de las operaciones críticas sin guardar datos
  personales adicionales.
- Distinguir fallos de bloqueo, cuotas, permisos, lectura de Drive y escritura
  en Sheets.
- Preparar una guía breve para observar las ejecuciones desde el panel de Apps
  Script durante el evento.
- Mantener mensajes comprensibles para el votante y detalles técnicos en los
  registros del servidor.

## Pruebas necesarias

### Prueba de volumen

Debe realizarse en una copia de la base o en una edición de prueba, no agregando
1.500 votos ficticios a la edición real.

- Cargar 1.500 votos con identificadores únicos.
- Comprobar el total y las primeras diez posiciones.
- Medir la apertura de la página, la consulta de elegibilidad y el ranking.
- Confirmar que un dispositivo registrado continúa bloqueado después de
  actualizar la página.
- Archivar o eliminar la edición de prueba al finalizar.

Resultado del 13 de octubre de 2026: carga y verificación completadas en la copia
aislada, con `loadedVotes: 1500`, `uniqueDevices: 1500`, `duplicates: 0` y 9
entradas en `topTen`. La copia se conserva por ahora como evidencia de prueba.

### Prueba de concurrencia

Una carga masiva mediante una sola función no reproduce votantes simultáneos.
También se necesita una prueba práctica o automatizada de concurrencia.

- Hacer votar entre 15 y 20 dispositivos o sesiones casi al mismo tiempo.
- Repetir con pequeñas ráfagas durante varios minutos.
- Verificar que no haya votos perdidos, filas incompletas ni dispositivos
  duplicados.
- Revisar en Apps Script las ejecuciones completadas, fallidas y en espera.
- Mantener una pantalla de resultados abierta durante la prueba para incluir su
  consumo real.

Resultado automatizado del 13 de octubre de 2026: 20 ejecuciones web simultáneas
aceptadas en 25,9 segundos, sin fallos transitorios. Los 20 reintentos paralelos
posteriores se resolvieron como idempotentes en 18,1 segundos. La verificación
final encontró 20 dispositivos únicos, 0 duplicados y 0 filas incompletas.

### Prueba operativa final

- Escanear el QR impreso desde Android y iPhone, cuando estén disponibles.
- Votar, actualizar y comprobar el bloqueo.
- Confirmar horarios, apertura, cierre y ranking.
- Probar la recuperación ante una desconexión breve o una respuesta transitoria
  del servidor.
- Verificar que la URL del QR siga siendo la implementación canónica después de
  cada publicación.

## Criterios de aceptación

El endurecimiento podrá considerarse terminado cuando:

- 1.500 votos puedan almacenarse y contarse correctamente;
- ninguna prueba genere votos duplicados para el mismo dispositivo;
- una ráfaga razonable de votos no produzca pérdidas silenciosas;
- los fallos transitorios muestren una opción clara de reintento;
- el ranking no multiplique innecesariamente las lecturas de Sheets;
- la carga pública no recorra Drive en cada solicitud;
- el administrador pueda identificar errores desde el historial de ejecuciones;
- el QR impreso continúe abriendo la versión publicada más reciente.

## Decisiones que deben conservarse

- No depender sólo de `localStorage` para impedir votos repetidos.
- No retirar la comprobación definitiva del servidor.
- No eliminar el proyecto de Apps Script asociado al QR.
- No probar volumen contaminando los votos reales del evento.
- No crear una implementación nueva cuando se publique una actualización: se
  debe actualizar la implementación existente del QR.
