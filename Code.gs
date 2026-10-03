const APP_CONFIG = Object.freeze({
  databaseSpreadsheetId: '1vLk2Woi6KEB9Bzhaeeyjs7wq_yXAIAjFlgRTUbueRcI',
  defaultInstitutionName: 'CENMA Brigadier J. I. San Martín Anexo Sacchi',
  defaultSystemTitle: 'Sistema de votación',
  demoStandCount: 30,
});

/**
 * Punto de entrada de la aplicación web de Google Apps Script.
 */
function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  const initialState = getInitialState_();
  template.initialStateJson = JSON.stringify(initialState).replace(/</g, '\\u003c');

  return template
    .evaluate()
    .setTitle(`${initialState.systemTitle} · ${initialState.institutionName}`)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * Permite incluir archivos HTML parciales dentro de Index.html.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Arma el estado inicial desde la hoja Configuracion y la hoja Stands.
 * Mientras Stands no exista, se muestran 30 stands de demostración.
 */
function getInitialState_() {
  const spreadsheet = getDatabase_();
  const configuration = getConfiguration_(spreadsheet);
  const rawLogoUrl = configuration.logo_url || configuration['logo_id_o_logo_url'] || '';

  return {
    institutionName:
      configuration.nombre_institucion || APP_CONFIG.defaultInstitutionName,
    systemTitle: configuration.titulo_sistema || APP_CONFIG.defaultSystemTitle,
    logoUrl: toBrowserImageUrl_(rawLogoUrl),
    status: normalizeVotingStatus_(
      configuration.estado_votacion || configuration.estado || 'open'
    ),
    stands: getStands_(spreadsheet),
  };
}

/**
 * Registra un voto y evita un segundo voto desde el mismo navegador.
 */
function registerVote(vote) {
  const standId = String(vote && vote.standId || '').trim();
  const deviceId = String(vote && vote.deviceId || '').trim();

  if (!/^[A-Za-z0-9-]{16,100}$/.test(deviceId)) {
    throw new Error('No se pudo identificar este dispositivo. Actualizá la página e intentá nuevamente.');
  }

  const spreadsheet = getDatabase_();
  const configuration = getConfiguration_(spreadsheet);
  const status = normalizeVotingStatus_(
    configuration.estado_votacion || configuration.estado || 'open'
  );

  if (status !== 'open') {
    throw new Error('La votación no está abierta en este momento.');
  }

  const stand = getStands_(spreadsheet).find((item) => item.id === standId);
  if (!stand) {
    throw new Error('El stand seleccionado no está disponible.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const votesSheet = getOrCreateVotesSheet_(spreadsheet);
    const lastRow = votesSheet.getLastRow();

    if (lastRow > 1) {
      const registeredDeviceIds = votesSheet
        .getRange(2, 2, lastRow - 1, 1)
        .getDisplayValues()
        .flat();

      if (registeredDeviceIds.includes(deviceId)) {
        return {
          ok: false,
          alreadyVoted: true,
          message: 'Este dispositivo ya registró un voto.',
        };
      }
    }

    votesSheet.appendRow([new Date(), deviceId, stand.id, stand.name]);
    SpreadsheetApp.flush();

    return {
      ok: true,
      standName: stand.name,
      message: `Tu voto por ${stand.name} quedó registrado.`,
    };
  } finally {
    lock.releaseLock();
  }
}

function getDatabase_() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const spreadsheetId =
    scriptProperties.getProperty('SPREADSHEET_ID') || APP_CONFIG.databaseSpreadsheetId;

  return SpreadsheetApp.openById(spreadsheetId);
}

function getConfiguration_(spreadsheet) {
  const sheet = findSheet_(spreadsheet, 'configuracion');
  if (!sheet || sheet.getLastRow() < 2) return {};

  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 2)
    .getDisplayValues()
    .reduce((configuration, row) => {
      const key = normalizeKey_(row[0]);
      if (key) configuration[key] = String(row[1] || '').trim();
      return configuration;
    }, {});
}

function getStands_(spreadsheet) {
  const sheet = findSheet_(spreadsheet, 'stands');
  if (!sheet || sheet.getLastRow() < 2) return buildDemoStands_();

  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(normalizeKey_);
  const idIndex = findHeaderIndex_(headers, ['id', 'stand_id']);
  const nameIndex = findHeaderIndex_(headers, ['nombre', 'name', 'stand']);
  const imageIndex = findHeaderIndex_(headers, ['foto_url', 'imagen_url', 'image_url']);
  const visibleIndex = findHeaderIndex_(headers, ['visible', 'activo']);
  const orderIndex = findHeaderIndex_(headers, ['orden', 'order']);

  return values
    .map((row, index) => {
      const fallbackNumber = index + 1;
      const rawVisible = visibleIndex >= 0 ? row[visibleIndex] : true;

      return {
        id: String(idIndex >= 0 && row[idIndex] || `stand-${fallbackNumber}`),
        name: String(nameIndex >= 0 && row[nameIndex] || `Stand ${fallbackNumber}`),
        imageUrl: toBrowserImageUrl_(imageIndex >= 0 ? row[imageIndex] : ''),
        visible: !['false', 'no', '0'].includes(String(rawVisible).trim().toLowerCase()),
        order: Number(orderIndex >= 0 ? row[orderIndex] : fallbackNumber) || fallbackNumber,
      };
    })
    .filter((stand) => stand.visible)
    .sort((first, second) => first.order - second.order)
    .map(({ id, name, imageUrl }) => ({ id, name, imageUrl }));
}

function buildDemoStands_() {
  return Array.from({ length: APP_CONFIG.demoStandCount }, (_, index) => {
    const number = index + 1;
    return {
      id: `stand-${String(number).padStart(2, '0')}`,
      name: `Stand ${number}`,
      imageUrl: '',
    };
  });
}

function getOrCreateVotesSheet_(spreadsheet) {
  const existingSheet = findSheet_(spreadsheet, 'votos');
  if (existingSheet) return existingSheet;

  const sheet = spreadsheet.insertSheet('Votos');
  sheet.appendRow(['Fecha', 'Dispositivo', 'Stand ID', 'Stand']);
  sheet.setFrozenRows(1);
  return sheet;
}

function findSheet_(spreadsheet, expectedName) {
  const normalizedExpectedName = normalizeKey_(expectedName);
  return spreadsheet
    .getSheets()
    .find((sheet) => normalizeKey_(sheet.getName()) === normalizedExpectedName) || null;
}

function findHeaderIndex_(headers, acceptedNames) {
  return headers.findIndex((header) => acceptedNames.includes(header));
}

function normalizeKey_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function normalizeVotingStatus_(value) {
  const normalizedValue = normalizeKey_(value);
  const aliases = {
    abierta: 'open',
    abierto: 'open',
    open: 'open',
    cerrada: 'closed',
    cerrado: 'closed',
    closed: 'closed',
    borrador: 'draft',
    draft: 'draft',
  };

  return aliases[normalizedValue] || 'draft';
}

function toBrowserImageUrl_(urlOrId) {
  const value = String(urlOrId || '').trim();
  if (!value) return '';

  const driveFileId = getDriveFileId_(value);
  return driveFileId
    ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w1200`
    : value;
}

function getDriveFileId_(urlOrId) {
  const value = String(urlOrId || '').trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return value;

  const pathMatch = value.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];

  const queryMatch = value.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return queryMatch ? queryMatch[1] : '';
}
