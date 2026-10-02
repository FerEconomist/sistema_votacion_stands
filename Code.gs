const APP_CONFIG = Object.freeze({
  title: 'Votación de stands',
  eventName: 'Feria de Stands',
});

/**
 * Punto de entrada de la aplicación web de Google Apps Script.
 */
function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.initialStateJson = JSON.stringify(getInitialState_()).replace(/</g, '\\u003c');

  return template
    .evaluate()
    .setTitle(APP_CONFIG.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Permite incluir archivos HTML parciales dentro de Index.html.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Datos temporales para construir y probar la interfaz.
 * En la siguiente etapa se reemplazarán por datos de Google Sheets.
 */
function getInitialState_() {
  return {
    eventName: APP_CONFIG.eventName,
    status: 'draft',
    stands: [
      {
        id: 'stand-01',
        name: 'Stand 1',
        description: 'La descripción del stand aparecerá aquí.',
        imageUrl: '',
      },
      {
        id: 'stand-02',
        name: 'Stand 2',
        description: 'La descripción del stand aparecerá aquí.',
        imageUrl: '',
      },
      {
        id: 'stand-03',
        name: 'Stand 3',
        description: 'La descripción del stand aparecerá aquí.',
        imageUrl: '',
      },
    ],
  };
}
