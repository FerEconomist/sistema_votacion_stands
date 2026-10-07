const APP_CONFIG = Object.freeze({
  databaseSpreadsheetId: '1vLk2Woi6KEB9Bzhaeeyjs7wq_yXAIAjFlgRTUbueRcI',
  defaultInstitutionName: 'CENMA Brigadier J. I. San Martín Anexo Sacchi',
  defaultSystemTitle: 'Sistema de votación',
  maxStandCount: 30,
  resultsLimit: 10,
  adminSessionSeconds: 21600,
  adminAttemptWindowSeconds: 300,
  adminMaxAttempts: 6,
});

/** Punto de entrada de la aplicación web. */
function doGet(event) {
  const requestedView = normalizeKey_(event && event.parameter && event.parameter.view);
  return requestedView === 'results' || requestedView === 'resultados'
    ? renderResultsPage_()
    : renderVotingPage_();
}

function renderVotingPage_() {
  const template = HtmlService.createTemplateFromFile('Index');
  const initialState = getInitialState_();
  template.initialStateJson = safeJson_(initialState);

  return template
    .evaluate()
    .setTitle(`${initialState.systemTitle} · ${initialState.institutionName}`)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function renderResultsPage_() {
  const template = HtmlService.createTemplateFromFile('Results');
  const initialState = getPublicResults();
  template.initialStateJson = safeJson_(initialState);

  return template
    .evaluate()
    .setTitle(`Resultados · ${initialState.institutionName}`)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function safeJson_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function getInitialState_() {
  const spreadsheet = getDatabase_();
  const configuration = getConfiguration_(spreadsheet);
  return buildPublicState_(spreadsheet, configuration);
}

/** Fuerza el consentimiento de solo lectura de Drive desde el editor de Apps Script. */
function authorizeDriveReadAccess() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  DriveApp.getRootFolder().getId();
  return true;
}

function buildPublicState_(spreadsheet, configuration) {
  const status = normalizeVotingStatus_(
    configuration.estado_votacion || configuration.estado || 'closed'
  );
  const votingUrl = ScriptApp.getService().getUrl() || '';

  return {
    ...getBranding_(configuration),
    status,
    resultsUrl: votingUrl ? `${votingUrl}?view=results` : '?view=results',
    estimatedOpening:
      configuration.horario_apertura ||
      configuration.apertura_estimada ||
      configuration.fecha_hora_apertura ||
      configuration.hora_apertura_estimada ||
      '',
    estimatedClosing:
      configuration.horario_cierre ||
      configuration.cierre_estimado ||
      configuration.fecha_hora_cierre ||
      configuration.hora_cierre_estimada ||
      '',
    showResults: status === 'open' || normalizeYesNo_(configuration.mostrar_resultados),
    stands: getStands_(spreadsheet, configuration),
  };
}

function getBranding_(configuration) {
  const rawLogoUrl = configuration.logo_url || configuration.logo_id_o_logo_url || '';
  return {
    institutionName:
      configuration.nombre_institucion || APP_CONFIG.defaultInstitutionName,
    systemTitle: configuration.titulo_sistema || APP_CONFIG.defaultSystemTitle,
    logoUrl: toBrowserImageUrl_(rawLogoUrl),
  };
}

/** Devuelve el ranking público sin exponer dispositivos. */
function getPublicResults() {
  const spreadsheet = getDatabase_();
  const configuration = getConfiguration_(spreadsheet);
  const branding = getBranding_(configuration);
  const votingUrl = ScriptApp.getService().getUrl() || '';
  const status = normalizeVotingStatus_(
    configuration.estado_votacion || configuration.estado || 'closed'
  );
  const enabled = status === 'open' || normalizeYesNo_(configuration.mostrar_resultados);

  if (!enabled) {
    return {
      ...branding,
      enabled: false,
      status,
      votingUrl,
      totalVotes: 0,
      ranking: [],
      updatedAt: formatDateTime_(spreadsheet, new Date()),
    };
  }

  const votesSheet = findSheet_(spreadsheet, 'votos');
  const voteCounts = {};
  let totalVotes = 0;

  if (votesSheet && votesSheet.getLastRow() > 1) {
    votesSheet
      .getRange(2, 3, votesSheet.getLastRow() - 1, 2)
      .getDisplayValues()
      .forEach((row) => {
        const standId = String(row[0] || '').trim();
        const standName = String(row[1] || '').trim();
        if (!standId && !standName) return;

        const key = standId || normalizeKey_(standName);
        if (!voteCounts[key]) {
          voteCounts[key] = {
            id: standId || key,
            name: standName || standId,
            votes: 0,
          };
        }

        voteCounts[key].votes += 1;
        totalVotes += 1;
      });
  }

  const ranking = Object.values(voteCounts)
    .sort((first, second) =>
      second.votes - first.votes || first.name.localeCompare(second.name, 'es')
    )
    .slice(0, APP_CONFIG.resultsLimit)
    .map((stand, index) => ({
      position: index + 1,
      id: stand.id,
      name: stand.name,
      votes: stand.votes,
      percentage: totalVotes
        ? Math.round((stand.votes / totalVotes) * 1000) / 10
        : 0,
    }));

  return {
    ...branding,
    enabled: true,
    status,
    votingUrl,
    totalVotes,
    ranking,
    updatedAt: formatDateTime_(spreadsheet, new Date()),
  };
}

function registerVote(vote) {
  const standId = String(vote && vote.standId || '').trim();
  const deviceId = String(vote && vote.deviceId || '').trim();
  validateDeviceId_(deviceId);

  const spreadsheet = getDatabase_();
  const configuration = getConfiguration_(spreadsheet);
  const status = normalizeVotingStatus_(
    configuration.estado_votacion || configuration.estado || 'closed'
  );
  if (status !== 'open') {
    throw new Error('La votación no está abierta en este momento.');
  }

  const stand = getStands_(spreadsheet, configuration)
    .find((item) => item.id === standId);
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

/** Inicio de sesión administrativo. El PIN nunca se devuelve al navegador. */
function authenticateAdmin(request) {
  const pin = String(request && request.pin || '').trim();
  const deviceId = String(request && request.deviceId || '').trim();
  validateDeviceId_(deviceId);

  if (!/^\d{4}$/.test(pin)) {
    throw new Error('El PIN debe tener exactamente cuatro dígitos.');
  }

  const cache = CacheService.getScriptCache();
  const attemptKey = `admin_attempts_${digestKey_(deviceId).slice(0, 32)}`;
  const failedAttempts = Number(cache.get(attemptKey) || 0);
  if (failedAttempts >= APP_CONFIG.adminMaxAttempts) {
    throw new Error('Demasiados intentos incorrectos. Esperá cinco minutos y probá nuevamente.');
  }

  const spreadsheet = getDatabase_();
  const configuration = getConfiguration_(spreadsheet);
  const configuredPin = normalizePin_(configuration.pin_admin);
  if (!configuredPin) {
    throw new Error('Falta configurar pin_admin en la hoja Configuracion.');
  }

  if (pin !== configuredPin) {
    cache.put(
      attemptKey,
      String(failedAttempts + 1),
      APP_CONFIG.adminAttemptWindowSeconds
    );
    throw new Error('PIN incorrecto.');
  }

  cache.remove(attemptKey);
  const token = `${Utilities.getUuid()}${Utilities.getUuid()}`.replace(/-/g, '');
  cache.put(adminSessionKey_(token), 'active', APP_CONFIG.adminSessionSeconds);

  return {
    ok: true,
    token,
    adminState: buildAdminState_(spreadsheet, configuration),
  };
}

function getAdminState(token) {
  requireAdmin_(token);
  const spreadsheet = getDatabase_();
  return buildAdminState_(spreadsheet, getConfiguration_(spreadsheet));
}

function logoutAdmin(token) {
  const normalizedToken = String(token || '').trim();
  if (normalizedToken) {
    CacheService.getScriptCache().remove(adminSessionKey_(normalizedToken));
  }
  return { ok: true };
}

function setVotingStatus(request) {
  requireAdmin_(request && request.token);
  const requestedStatus = normalizeVotingStatus_(request && request.status);
  if (!['open', 'closed'].includes(requestedStatus)) {
    throw new Error('El estado solicitado no es válido.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spreadsheet = getDatabase_();
    setConfigurationValue_(spreadsheet, 'estado_votacion', requestedStatus);
    SpreadsheetApp.flush();
    return buildAdminActionResult_(
      spreadsheet,
      requestedStatus === 'open' ? 'La votación quedó abierta.' : 'La votación quedó cerrada.'
    );
  } finally {
    lock.releaseLock();
  }
}

function updateOpeningTime(request) {
  requireAdmin_(request && request.token);
  const openingTime = String(request && request.openingTime || '').trim();
  if (openingTime.length > 80) {
    throw new Error('El horario estimado es demasiado largo.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spreadsheet = getDatabase_();
    setConfigurationValue_(spreadsheet, 'horario_apertura', openingTime);
    SpreadsheetApp.flush();
    return buildAdminActionResult_(spreadsheet, 'Se actualizó el horario estimado.');
  } finally {
    lock.releaseLock();
  }
}

/** Archiva y limpia los votos, pero conserva stands y fotografías. */
function resetVoting(request) {
  requireAdminAndPin_(request && request.token, request && request.pin);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const spreadsheet = getDatabase_();
    const label = buildArchiveLabel_(spreadsheet, 'Reinicio');
    const archivedVotes = archiveVotes_(spreadsheet, label);
    clearSheetData_(findSheet_(spreadsheet, 'votos'));
    setConfigurationValue_(spreadsheet, 'estado_votacion', 'closed');
    SpreadsheetApp.flush();

    return {
      ...buildAdminActionResult_(
        spreadsheet,
        archivedVotes
          ? `Se archivaron ${archivedVotes} votos y la votación quedó lista para comenzar nuevamente.`
          : 'No había votos para archivar. La votación quedó cerrada.'
      ),
      archivedVotes,
    };
  } finally {
    lock.releaseLock();
  }
}

/** Archiva la edición completa y deja Fotos activas vacía. */
function emptyStands(request) {
  requireAdminAndPin_(request && request.token, request && request.pin);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = getDatabase_();
    const configuration = getConfiguration_(spreadsheet);
    const activeFolder = getConfiguredFolder_(
      configuration,
      'carpeta_fotos_activas_id',
      'Fotos activas'
    );
    const archivedFolder = getConfiguredFolder_(
      configuration,
      'carpeta_fotos_archivadas_id',
      'Archivadas'
    );
    const label = buildArchiveLabel_(spreadsheet, 'Stands');
    const destinationFolder = archivedFolder.createFolder(label);

    const archivedVotes = archiveVotes_(spreadsheet, label);
    const archivedStands = archiveStands_(spreadsheet, label);
    const movedItems = moveFolderContents_(activeFolder, destinationFolder);

    clearSheetData_(findSheet_(spreadsheet, 'votos'));
    clearSheetData_(findSheet_(spreadsheet, 'stands'));
    setConfigurationValue_(spreadsheet, 'estado_votacion', 'closed');
    SpreadsheetApp.flush();

    return {
      ...buildAdminActionResult_(
        spreadsheet,
        `Se preparó una nueva edición. Las fotos anteriores quedaron en ${label}.`
      ),
      archivedVotes,
      archivedStands,
      movedItems,
      archiveFolderName: label,
    };
  } finally {
    lock.releaseLock();
  }
}

function buildAdminActionResult_(spreadsheet, message) {
  const configuration = getConfiguration_(spreadsheet);
  return {
    ok: true,
    message,
    adminState: buildAdminState_(spreadsheet, configuration),
    publicState: buildPublicState_(spreadsheet, configuration),
  };
}

function buildAdminState_(spreadsheet, configuration) {
  const stands = getStands_(spreadsheet, configuration);
  const votesSheet = findSheet_(spreadsheet, 'votos');
  const photoMap = getActiveStandPhotos_(configuration);

  return {
    status: normalizeVotingStatus_(
      configuration.estado_votacion || configuration.estado || 'closed'
    ),
    estimatedOpening:
      configuration.horario_apertura || configuration.apertura_estimada || '',
    estimatedClosing:
      configuration.horario_cierre || configuration.cierre_estimado || '',
    showResults: normalizeYesNo_(configuration.mostrar_resultados),
    voteCount: votesSheet ? Math.max(0, votesSheet.getLastRow() - 1) : 0,
    standCount: stands.length,
    photoCount: Object.keys(photoMap).length,
  };
}

function requireAdmin_(token) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken ||
      !CacheService.getScriptCache().get(adminSessionKey_(normalizedToken))) {
    throw new Error('La sesión de administración venció. Ingresá nuevamente.');
  }
}

function requireAdminAndPin_(token, pin) {
  requireAdmin_(token);
  const spreadsheet = getDatabase_();
  const configuredPin = normalizePin_(getConfiguration_(spreadsheet).pin_admin);
  if (String(pin || '').trim() !== configuredPin) {
    throw new Error('El PIN de confirmación es incorrecto.');
  }
}

function adminSessionKey_(token) {
  return `admin_session_${digestKey_(token).slice(0, 40)}`;
}

function digestKey_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function normalizePin_(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function validateDeviceId_(deviceId) {
  if (!/^[A-Za-z0-9-]{16,100}$/.test(deviceId)) {
    throw new Error('No se pudo identificar este dispositivo. Actualizá la página e intentá nuevamente.');
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

function setConfigurationValue_(spreadsheet, key, value) {
  let sheet = findSheet_(spreadsheet, 'configuracion');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('configuracion');
    sheet.appendRow(['Clave', 'Valor', 'Notas']);
    sheet.setFrozenRows(1);
  }

  const normalizedKey = normalizeKey_(key);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
    const index = keys.findIndex((existingKey) => normalizeKey_(existingKey) === normalizedKey);
    if (index >= 0) {
      sheet.getRange(index + 2, 2).setValue(String(value || ''));
      return;
    }
  }

  sheet.appendRow([key, String(value || ''), '']);
}

function getStands_(spreadsheet, configuration) {
  const photoMap = getActiveStandPhotos_(configuration || {});
  const sheet = findSheet_(spreadsheet, 'stands');

  if (!sheet || sheet.getLastRow() < 2) {
    return buildPhotoStands_(photoMap);
  }

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
      const order = Number(orderIndex >= 0 ? row[orderIndex] : fallbackNumber) || fallbackNumber;
      const name = String(nameIndex >= 0 && row[nameIndex] || `Stand ${fallbackNumber}`);
      const standNumber = extractStandNumber_(name) || order || fallbackNumber;
      const folderPhoto = photoMap[standNumber];

      return {
        id: String(idIndex >= 0 && row[idIndex] || `stand-${fallbackNumber}`),
        name,
        number: standNumber,
        imageUrl: folderPhoto
          ? folderPhoto.imageUrl
          : toBrowserImageUrl_(imageIndex >= 0 ? row[imageIndex] : ''),
        visible: !['false', 'no', '0'].includes(String(rawVisible).trim().toLowerCase()),
        order,
      };
    })
    .filter((stand) => stand.visible)
    .sort((first, second) => first.order - second.order)
    .slice(0, APP_CONFIG.maxStandCount)
    .map(({ id, name, number, imageUrl }) => ({ id, name, number, imageUrl }));
}

function buildPhotoStands_(photoMap) {
  return Object.keys(photoMap || {})
    .map(Number)
    .filter((number) => Number.isInteger(number) && number > 0)
    .sort((first, second) => first - second)
    .slice(0, APP_CONFIG.maxStandCount)
    .map((number) => ({
      id: `stand-${String(number).padStart(2, '0')}`,
      name: `Stand ${number}`,
      number,
      imageUrl: photoMap[number].imageUrl,
    }));
}

function getActiveStandPhotos_(configuration) {
  const folderId = getDriveFolderId_(configuration.carpeta_fotos_activas_id);

  try {
    const folder = findActivePhotosFolder_(folderId);
    if (!folder) {
      console.error('No se encontró la carpeta Fotos activas en Drive.');
      return {};
    }

    const files = folder.getFiles();
    const photos = {};
    while (files.hasNext()) {
      const file = files.next();
      if (!String(file.getMimeType() || '').startsWith('image/')) continue;

      const standNumber = extractStandNumber_(file.getName());
      if (!standNumber) continue;

      const updatedAt = file.getLastUpdated().getTime();
      if (!photos[standNumber] || updatedAt > photos[standNumber].updatedAt) {
        photos[standNumber] = {
          fileId: file.getId(),
          imageUrl: toBrowserImageUrl_(file.getId()),
          updatedAt,
        };
      }
    }
    return photos;
  } catch (error) {
    console.error(`No se pudo leer la carpeta Fotos activas: ${error.message}`);
    return {};
  }
}

function findActivePhotosFolder_(folderId) {
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (error) {
      console.error(`El ID configurado para Fotos activas no es accesible: ${error.message}`);
    }
  }

  const acceptedNames = ['Fotos activas', 'Fotos Activas', 'Fotos activa', 'Fotos Activa'];
  for (const name of acceptedNames) {
    const folders = DriveApp.getFoldersByName(name);
    if (folders.hasNext()) return folders.next();
  }

  return null;
}

function extractStandNumber_(filename) {
  const match = String(filename || '')
    .trim()
    .match(/^stand[\s_-]*0*(\d{1,3})(?:\.[^.]+)?$/i);
  return match ? Number(match[1]) : 0;
}

function getOrCreateVotesSheet_(spreadsheet) {
  const existingSheet = findSheet_(spreadsheet, 'votos');
  if (existingSheet) return existingSheet;

  const sheet = spreadsheet.insertSheet('Votos');
  sheet.appendRow(['Fecha', 'Dispositivo', 'Stand ID', 'Stand']);
  sheet.setFrozenRows(1);
  return sheet;
}

function archiveVotes_(spreadsheet, label) {
  const votesSheet = findSheet_(spreadsheet, 'votos');
  if (!votesSheet || votesSheet.getLastRow() < 2) return 0;

  const values = votesSheet
    .getRange(2, 1, votesSheet.getLastRow() - 1, 4)
    .getValues();
  const historySheet = getOrCreateHistorySheet_(
    spreadsheet,
    'Historial_Votos',
    ['Archivado', 'Edición', 'Fecha voto', 'Dispositivo', 'Stand ID', 'Stand']
  );
  const archivedAt = new Date();
  const output = values.map((row) => [archivedAt, label, ...row]);
  historySheet
    .getRange(historySheet.getLastRow() + 1, 1, output.length, output[0].length)
    .setValues(output);
  return output.length;
}

function archiveStands_(spreadsheet, label) {
  const standsSheet = findSheet_(spreadsheet, 'stands');
  if (!standsSheet || standsSheet.getLastRow() < 2) return 0;

  const values = standsSheet.getDataRange().getValues();
  const headers = values.shift().map(normalizeKey_);
  const idIndex = findHeaderIndex_(headers, ['id', 'stand_id']);
  const nameIndex = findHeaderIndex_(headers, ['nombre', 'name', 'stand']);
  const imageIndex = findHeaderIndex_(headers, ['foto_url', 'imagen_url', 'image_url']);
  const visibleIndex = findHeaderIndex_(headers, ['visible', 'activo']);
  const orderIndex = findHeaderIndex_(headers, ['orden', 'order']);
  const archivedAt = new Date();
  const output = values.map((row, index) => [
    archivedAt,
    label,
    String(idIndex >= 0 ? row[idIndex] || '' : ''),
    String(nameIndex >= 0 ? row[nameIndex] || `Stand ${index + 1}` : `Stand ${index + 1}`),
    String(imageIndex >= 0 ? row[imageIndex] || '' : ''),
    visibleIndex >= 0 ? row[visibleIndex] : true,
    orderIndex >= 0 ? row[orderIndex] : index + 1,
  ]);
  const historySheet = getOrCreateHistorySheet_(
    spreadsheet,
    'Historial_Stands',
    ['Archivado', 'Edición', 'Stand ID', 'Stand', 'Foto URL', 'Visible', 'Orden']
  );
  historySheet
    .getRange(historySheet.getLastRow() + 1, 1, output.length, output[0].length)
    .setValues(output);
  return output.length;
}

function getOrCreateHistorySheet_(spreadsheet, name, headers) {
  const existing = findSheet_(spreadsheet, name);
  if (existing) return existing;

  const sheet = spreadsheet.insertSheet(name);
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  return sheet;
}

function clearSheetData_(sheet) {
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
}

function getConfiguredFolder_(configuration, key, label) {
  const folderId = getDriveFolderId_(configuration[key]);
  if (!folderId) {
    throw new Error(`Falta configurar ${key} en la hoja Configuracion.`);
  }

  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    throw new Error(`No se pudo acceder a la carpeta ${label}. Revisá su ID y sus permisos.`);
  }
}

function moveFolderContents_(sourceFolder, destinationFolder) {
  let movedItems = 0;
  const files = sourceFolder.getFiles();
  while (files.hasNext()) {
    files.next().moveTo(destinationFolder);
    movedItems += 1;
  }

  const folders = sourceFolder.getFolders();
  while (folders.hasNext()) {
    folders.next().moveTo(destinationFolder);
    movedItems += 1;
  }
  return movedItems;
}

function buildArchiveLabel_(spreadsheet, prefix) {
  const timezone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  return `${prefix} ${Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH.mm.ss')}`;
}

function formatDateTime_(spreadsheet, date) {
  const timezone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  return Utilities.formatDate(date, timezone, "dd/MM/yyyy 'a las' HH:mm:ss");
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
  return aliases[normalizeKey_(value)] || 'draft';
}

function normalizeYesNo_(value) {
  return ['si', 'sí', 'yes', 'true', '1', 'on']
    .includes(String(value || '').trim().toLowerCase());
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

function getDriveFolderId_(urlOrId) {
  const value = String(urlOrId || '').trim();
  if (!value) return '';

  const cleanIdMatch = value.match(/^([A-Za-z0-9_-]{15,})(?:\?.*)?$/);
  if (cleanIdMatch) return cleanIdMatch[1];

  const folderMatch = value.match(/\/folders\/([A-Za-z0-9_-]+)/);
  return folderMatch ? folderMatch[1] : '';
}
