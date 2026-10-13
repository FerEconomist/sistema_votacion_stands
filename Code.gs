const APP_CONFIG = Object.freeze({
  databaseSpreadsheetId: '1vLk2Woi6KEB9Bzhaeeyjs7wq_yXAIAjFlgRTUbueRcI',
  defaultInstitutionName: 'CENMA Brigadier J. I. San Martín Anexo Sacchi',
  defaultSystemTitle: 'Sistema de votación',
  maxStandCount: 30,
  resultsLimit: 10,
  adminSessionSeconds: 21600,
  adminAttemptWindowSeconds: 300,
  adminMaxAttempts: 6,
  voteLockWaitMs: 30000,
  resultsLockWaitMs: 750,
  publicConfigurationCacheSeconds: 30,
  publicStateCacheSeconds: 30,
  standsCacheSeconds: 120,
  photosCacheSeconds: 120,
  resultsCacheSeconds: 8,
  staleResultsCacheSeconds: 60,
  voteIndexCacheSeconds: 120,
  voteIndexLockWaitMs: 500,
});

const CACHE_KEYS = Object.freeze({
  publicConfiguration: 'public_configuration_v2',
  publicState: 'public_state_v2',
  stands: 'public_stands_v2',
  photos: 'active_photos_v2',
  results: 'public_results_v2',
  staleResults: 'public_results_stale_v2',
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
  return observeOperation_('public_state', () => {
    const cache = CacheService.getScriptCache();
    const cachedState = readCachedJson_(cache, CACHE_KEYS.publicState);
    if (cachedState) return cachedState;

    const spreadsheet = getDatabase_();
    const configuration = getCachedPublicConfiguration_(spreadsheet);
    const publicState = buildPublicState_(spreadsheet, configuration);
    putCachedJson_(
      cache,
      CACHE_KEYS.publicState,
      publicState,
      APP_CONFIG.publicStateCacheSeconds
    );
    return publicState;
  });
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
    stands: getCachedStands_(spreadsheet, configuration),
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
  return observeOperation_('public_results', () => {
    const cache = CacheService.getScriptCache();
    const cachedResults = readCachedJson_(cache, CACHE_KEYS.results);
    if (cachedResults) return cachedResults;

    const staleResults = readCachedJson_(cache, CACHE_KEYS.staleResults);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(APP_CONFIG.resultsLockWaitMs)) {
      if (staleResults) return staleResults;
      return buildPublicResults_();
    }

    try {
      const refreshedResults = readCachedJson_(cache, CACHE_KEYS.results);
      if (refreshedResults) return refreshedResults;

      const results = buildPublicResults_();
      putCachedJson_(cache, CACHE_KEYS.results, results, APP_CONFIG.resultsCacheSeconds);
      putCachedJson_(
        cache,
        CACHE_KEYS.staleResults,
        results,
        APP_CONFIG.staleResultsCacheSeconds
      );
      return results;
    } finally {
      lock.releaseLock();
    }
  });
}

function buildPublicResults_() {
  const spreadsheet = getDatabase_();
  const configuration = getCachedPublicConfiguration_(spreadsheet);
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
  return observeOperation_('register_vote', () => {
    const standId = String(vote && vote.standId || '').trim();
    const deviceId = String(vote && vote.deviceId || '').trim();
    const requestId = String(vote && vote.requestId || '').trim();
    validateDeviceId_(deviceId);
    validateVoteRequestId_(requestId);

    try {
      const spreadsheet = getDatabase_();
      const configuration = getConfiguration_(spreadsheet);
      const status = normalizeVotingStatus_(
        configuration.estado_votacion || configuration.estado || 'closed'
      );
      if (status !== 'open') {
        throw new Error('La votación no está abierta en este momento.');
      }

      // La ruta normal usa la lista que ya preparó la carga pública y no recorre Drive.
      const stand = getVoteEligibleStands_(spreadsheet, configuration)
        .find((item) => item.id === standId);
      if (!stand) {
        throw new Error('El stand seleccionado no está disponible.');
      }

      const lock = LockService.getScriptLock();
      if (!lock.tryLock(APP_CONFIG.voteLockWaitMs)) {
        return buildTransientVoteFailure_('lock');
      }

      let registeredVote = null;
      try {
        // Se vuelve a consultar el estado dentro del bloqueo para respetar un cierre
        // administrativo que haya ocurrido mientras este voto esperaba.
        const lockedConfiguration = getConfiguration_(spreadsheet);
        const lockedStatus = normalizeVotingStatus_(
          lockedConfiguration.estado_votacion || lockedConfiguration.estado || 'closed'
        );
        if (lockedStatus !== 'open') {
          throw new Error('La votación no está abierta en este momento.');
        }

        const votesSheet = getOrCreateVotesSheet_(spreadsheet);
        registeredVote = findVoteByDevice_(votesSheet, deviceId);

        if (!registeredVote) {
          try {
            votesSheet.appendRow([new Date(), deviceId, stand.id, stand.name]);
            SpreadsheetApp.flush();
          } catch (error) {
            markOperationalError_(error, 'sheets_write');
            throw error;
          }
        }
      } finally {
        lock.releaseLock();
      }

      if (registeredVote) {
        const cachedVote = getCachedVoteStatus_(deviceId);
        if (requestId && cachedVote && cachedVote.requestId === requestId) {
          return {
            ok: true,
            idempotentRetry: true,
            standName: registeredVote.standName,
            message: `Tu voto por ${registeredVote.standName} ya había quedado registrado.`,
          };
        }
        cacheVoteStatus_(deviceId, registeredVote);
        return {
          ok: false,
          alreadyVoted: true,
          message: 'Este dispositivo ya registró un voto.',
        };
      }

      cacheVoteStatus_(
        deviceId,
        { standId: stand.id, standName: stand.name },
        requestId
      );
      return {
        ok: true,
        standName: stand.name,
        message: `Tu voto por ${stand.name} quedó registrado.`,
      };
    } catch (error) {
      const category = categorizeOperationalError_(error);
      if (['lock', 'quota', 'sheets', 'sheets_write', 'temporary'].includes(category)) {
        return buildTransientVoteFailure_(category);
      }
      if (category === 'permissions') {
        return {
          ok: false,
          transient: false,
          code: 'PERMISSIONS',
          message: 'El sistema necesita una autorización del administrador antes de aceptar votos.',
        };
      }
      throw error;
    }
  });
}

/** Informa si el navegador ya votó en la edición actual. */
function getVoteStatus(deviceId) {
  return observeOperation_('vote_status', () => {
    const normalizedDeviceId = String(deviceId || '').trim();
    validateDeviceId_(normalizedDeviceId);

    const cachedVote = getCachedVoteStatus_(normalizedDeviceId);
    if (cachedVote) return buildVoteStatusResult_(cachedVote);

    const cache = CacheService.getScriptCache();
    const indexKey = voteIndexCacheKey_();
    let voteIndex = readCachedJson_(cache, indexKey);
    let indexWasBuilt = false;
    if (!voteIndex) {
      const indexLock = LockService.getScriptLock();
      if (!indexLock.tryLock(APP_CONFIG.voteIndexLockWaitMs)) {
        const spreadsheet = getDatabase_();
        const registeredVote = findVoteByDevice_(
          findSheet_(spreadsheet, 'votos'),
          normalizedDeviceId
        );
        if (registeredVote) cacheVoteStatus_(normalizedDeviceId, registeredVote);
        return buildVoteStatusResult_(registeredVote);
      }

      try {
        voteIndex = readCachedJson_(cache, indexKey);
        if (!voteIndex) {
          const spreadsheet = getDatabase_();
          voteIndex = buildVoteIndex_(findSheet_(spreadsheet, 'votos'));
          putCachedJson_(cache, indexKey, voteIndex, APP_CONFIG.voteIndexCacheSeconds);
          indexWasBuilt = true;
        }
      } finally {
        indexLock.releaseLock();
      }
    }

    const voteHashes = Array.isArray(voteIndex)
      ? voteIndex
      : Array.isArray(voteIndex.hashes) ? voteIndex.hashes : [];
    let registeredVote = voteHashes.includes(digestKey_(normalizedDeviceId))
      ? { standId: '', standName: '' }
      : null;

    // Una ausencia sólo es definitiva si la hoja no creció desde que se creó
    // el índice. Así la caché nunca se convierte en fuente de verdad negativa.
    if (!registeredVote && !indexWasBuilt) {
      const spreadsheet = getDatabase_();
      const votesSheet = findSheet_(spreadsheet, 'votos');
      const currentVoteCount = votesSheet ? Math.max(0, votesSheet.getLastRow() - 1) : 0;
      const indexedVoteCount = Array.isArray(voteIndex)
        ? -1
        : Number(voteIndex.rowCount || 0);
      if (currentVoteCount !== indexedVoteCount) {
        registeredVote = findVoteByDevice_(votesSheet, normalizedDeviceId);
      }
    }
    if (registeredVote) cacheVoteStatus_(normalizedDeviceId, registeredVote);
    return buildVoteStatusResult_(registeredVote);
  });
}

function findVoteByDevice_(votesSheet, deviceId) {
  if (!votesSheet || votesSheet.getLastRow() < 2) return null;

  const deviceCell = votesSheet
    .getRange(2, 2, votesSheet.getLastRow() - 1, 1)
    .createTextFinder(deviceId)
    .matchEntireCell(true)
    .findNext();
  const match = deviceCell
    ? votesSheet.getRange(deviceCell.getRow(), 2, 1, 3).getDisplayValues()[0]
    : null;

  return match
    ? {
        deviceId: String(match[0] || '').trim(),
        standId: String(match[1] || '').trim(),
        standName: String(match[2] || '').trim(),
      }
    : null;
}

function buildVoteIndex_(votesSheet) {
  if (!votesSheet || votesSheet.getLastRow() < 2) {
    return { rowCount: 0, hashes: [] };
  }

  const rowCount = votesSheet.getLastRow() - 1;
  const hashes = votesSheet
    .getRange(2, 2, rowCount, 1)
    .getDisplayValues()
    .flat()
    .map((deviceId) => String(deviceId || '').trim())
    .filter(Boolean)
    .map(digestKey_);
  return { rowCount, hashes };
}

function buildVoteStatusResult_(registeredVote) {
  return registeredVote
    ? {
        ok: true,
        hasVoted: true,
        standId: String(registeredVote.standId || ''),
        standName: String(registeredVote.standName || ''),
      }
    : {
        ok: true,
        hasVoted: false,
        standId: '',
        standName: '',
      };
}

function getCachedVoteStatus_(deviceId) {
  return readCachedJson_(
    CacheService.getScriptCache(),
    voteStatusCacheKey_(deviceId)
  );
}

function cacheVoteStatus_(deviceId, registeredVote, requestId) {
  putCachedJson_(
    CacheService.getScriptCache(),
    voteStatusCacheKey_(deviceId),
    {
      standId: String(registeredVote && registeredVote.standId || ''),
      standName: String(registeredVote && registeredVote.standName || ''),
      requestId: String(requestId || ''),
    },
    APP_CONFIG.voteIndexCacheSeconds
  );
}

function invalidateVoteIndexCache_() {
  CacheService.getScriptCache().remove(voteIndexCacheKey_());
}

function voteIndexCacheKey_() {
  return `vote_index_${getVoteEditionToken_()}`;
}

function voteStatusCacheKey_(deviceId) {
  return `vote_status_${getVoteEditionToken_()}_${digestKey_(deviceId).slice(0, 32)}`;
}

function getVoteEditionToken_() {
  const properties = PropertiesService.getScriptProperties();
  let token = properties.getProperty('VOTE_EDITION_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    properties.setProperty('VOTE_EDITION_TOKEN', token);
  }
  return token;
}

function rotateVoteEditionToken_() {
  PropertiesService.getScriptProperties().setProperty(
    'VOTE_EDITION_TOKEN',
    Utilities.getUuid().replace(/-/g, '')
  );
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
    invalidatePublicCaches_();
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
    invalidatePublicCaches_();
    return buildAdminActionResult_(spreadsheet, 'Se actualizó el horario estimado.');
  } finally {
    lock.releaseLock();
  }
}

function updateVotingSchedule(request) {
  requireAdmin_(request && request.token);
  const openingTime = String(request && request.openingTime || '').trim();
  const closingTime = String(request && request.closingTime || '').trim();
  if (openingTime.length > 80 || closingTime.length > 80) {
    throw new Error('Los horarios estimados no pueden superar los 80 caracteres.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spreadsheet = getDatabase_();
    setConfigurationValue_(spreadsheet, 'horario_apertura', openingTime);
    setConfigurationValue_(spreadsheet, 'horario_cierre', closingTime);
    SpreadsheetApp.flush();
    invalidatePublicCaches_();
    return buildAdminActionResult_(spreadsheet, 'Se actualizaron los horarios estimados.');
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
    rotateVoteEditionToken_();
    invalidatePublicCaches_();

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

/** Archiva y limpia los datos de la edición; las fotos se eliminan manualmente. */
function emptyStands(request) {
  requireAdminAndPin_(request && request.token, request && request.pin);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const spreadsheet = getDatabase_();
    const label = buildArchiveLabel_(spreadsheet, 'Stands');
    const archivedVotes = archiveVotes_(spreadsheet, label);
    const archivedStands = archiveStands_(spreadsheet, label);

    clearSheetData_(findSheet_(spreadsheet, 'votos'));
    clearSheetData_(findSheet_(spreadsheet, 'stands'));
    setConfigurationValue_(spreadsheet, 'estado_votacion', 'closed');
    SpreadsheetApp.flush();
    rotateVoteEditionToken_();
    invalidatePublicCaches_({ stands: true, photos: true });

    const result = buildAdminActionResult_(
      spreadsheet,
      'Se archivaron y vaciaron los votos y los stands. La votación quedó cerrada. ' +
        'Ahora eliminá manualmente las fotos de Fotos activas antes de cargar las nuevas.'
    );
    // El estado administrativo puede consultar las fotos todavía presentes.
    // Se invalida otra vez para que la próxima recarga refleje el borrado manual.
    invalidatePublicCaches_({ stands: true, photos: true });

    return {
      ...result,
      archivedVotes,
      archivedStands,
      photosRequireManualCleanup: true,
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
  const stands = getCachedStands_(spreadsheet, configuration);
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

function validateVoteRequestId_(requestId) {
  if (requestId && !/^[A-Za-z0-9-]{12,100}$/.test(requestId)) {
    throw new Error('No se pudo validar la solicitud de voto. Intentá nuevamente.');
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

function getCachedPublicConfiguration_(spreadsheet) {
  const cache = CacheService.getScriptCache();
  const cachedConfiguration = readCachedJson_(cache, CACHE_KEYS.publicConfiguration);
  if (cachedConfiguration) return cachedConfiguration;

  const configuration = getConfiguration_(spreadsheet);
  const publicKeys = [
    'nombre_institucion',
    'titulo_sistema',
    'logo_url',
    'logo_id_o_logo_url',
    'estado_votacion',
    'estado',
    'horario_apertura',
    'apertura_estimada',
    'fecha_hora_apertura',
    'hora_apertura_estimada',
    'horario_cierre',
    'cierre_estimado',
    'fecha_hora_cierre',
    'hora_cierre_estimada',
    'mostrar_resultados',
    // Sólo se usa internamente para resolver la carpeta; nunca se envía al navegador.
    'carpeta_fotos_activas_id',
  ];
  const publicConfiguration = publicKeys.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(configuration, key)) {
      result[key] = configuration[key];
    }
    return result;
  }, {});

  putCachedJson_(
    cache,
    CACHE_KEYS.publicConfiguration,
    publicConfiguration,
    APP_CONFIG.publicConfigurationCacheSeconds
  );
  return publicConfiguration;
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

function getCachedStands_(spreadsheet, configuration) {
  const cache = CacheService.getScriptCache();
  const cachedStands = readCachedJson_(cache, CACHE_KEYS.stands);
  if (Array.isArray(cachedStands)) return cachedStands;

  const stands = getStands_(spreadsheet, configuration);
  putCachedJson_(cache, CACHE_KEYS.stands, stands, APP_CONFIG.standsCacheSeconds);
  return stands;
}

/**
 * Catálogo mínimo para registrar un voto. Si Stands tiene datos, sólo consulta
 * esa hoja. En instalaciones basadas exclusivamente en nombres de fotos usa el
 * catálogo creado al servir la página y reconstruye desde Drive sólo si la
 * caché fue expulsada.
 */
function getVoteEligibleStands_(spreadsheet, configuration) {
  const configuredStands = readConfiguredVoteStands_(
    findSheet_(spreadsheet, 'stands')
  );
  if (configuredStands !== null) return configuredStands;

  const cache = CacheService.getScriptCache();
  const cachedStands = readCachedJson_(cache, CACHE_KEYS.stands);
  const stands = Array.isArray(cachedStands)
    ? cachedStands
    : getCachedStands_(spreadsheet, configuration);
  return stands.map((stand) => ({ id: stand.id, name: stand.name }));
}

function readConfiguredVoteStands_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return null;

  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(normalizeKey_);
  const idIndex = findHeaderIndex_(headers, ['id', 'stand_id']);
  const nameIndex = findHeaderIndex_(headers, ['nombre', 'name', 'stand']);
  const visibleIndex = findHeaderIndex_(headers, ['visible', 'activo']);
  const orderIndex = findHeaderIndex_(headers, ['orden', 'order']);

  return values
    .map((row, index) => {
      const fallbackNumber = index + 1;
      const rawVisible = visibleIndex >= 0 ? row[visibleIndex] : true;
      return {
        id: String(idIndex >= 0 && row[idIndex] || `stand-${fallbackNumber}`),
        name: String(nameIndex >= 0 && row[nameIndex] || `Stand ${fallbackNumber}`),
        visible: !['false', 'no', '0'].includes(String(rawVisible).trim().toLowerCase()),
        order: Number(orderIndex >= 0 ? row[orderIndex] : fallbackNumber) || fallbackNumber,
      };
    })
    .filter((stand) => stand.visible)
    .sort((first, second) => first.order - second.order)
    .slice(0, APP_CONFIG.maxStandCount)
    .map(({ id, name }) => ({ id, name }));
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
  const cache = CacheService.getScriptCache();
  const cachedPhotos = readCachedJson_(cache, CACHE_KEYS.photos);
  if (cachedPhotos) return cachedPhotos;

  const photos = loadActiveStandPhotos_(configuration);
  putCachedJson_(cache, CACHE_KEYS.photos, photos, APP_CONFIG.photosCacheSeconds);
  return photos;
}

function loadActiveStandPhotos_(configuration) {
  const folderId = getDriveFolderId_(configuration.carpeta_fotos_activas_id);

  try {
    const folder = findActivePhotosFolder_(folderId);
    if (!folder) {
      logOperationalEvent_('drive_photos', 'error', 'drive_read', 0,
        'No se encontró la carpeta Fotos activas en Drive.');
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
    logOperationalEvent_(
      'drive_photos',
      'error',
      categorizeOperationalError_(error, 'drive_read'),
      0,
      error && error.message
    );
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

function buildArchiveLabel_(spreadsheet, prefix) {
  const timezone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  return `${prefix} ${Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH.mm.ss')}`;
}

function formatDateTime_(spreadsheet, date) {
  const timezone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  return Utilities.formatDate(date, timezone, "dd/MM/yyyy 'a las' HH:mm:ss");
}

function readCachedJson_(cache, key) {
  try {
    const value = cache.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logOperationalEvent_('cache_read', 'error', 'cache', 0, error && error.message);
    return null;
  }
}

function putCachedJson_(cache, key, value, seconds) {
  try {
    cache.put(key, JSON.stringify(value), seconds);
  } catch (error) {
    // La caché es una optimización: un rechazo o expulsión nunca impide operar.
    logOperationalEvent_('cache_write', 'error', 'cache', 0, error && error.message);
  }
}

function invalidateResultsCache_() {
  CacheService.getScriptCache().remove(CACHE_KEYS.results);
}

function invalidatePublicCaches_(options) {
  const settings = options || {};
  const keys = [
    CACHE_KEYS.publicConfiguration,
    CACHE_KEYS.publicState,
    CACHE_KEYS.results,
    CACHE_KEYS.staleResults,
  ];
  if (settings.stands) keys.push(CACHE_KEYS.stands);
  if (settings.photos) keys.push(CACHE_KEYS.photos);
  CacheService.getScriptCache().removeAll(keys);
}

function buildTransientVoteFailure_(category) {
  const lockFailure = category === 'lock';
  const response = {
    ok: false,
    transient: true,
    code: lockFailure ? 'SYSTEM_BUSY' : 'TEMPORARY_FAILURE',
    message: lockFailure
      ? 'Hay muchos votos al mismo tiempo. Esperá un instante e intentá nuevamente.'
      : 'El servicio está temporalmente ocupado. Intentá nuevamente en unos segundos.',
  };
  Object.defineProperty(response, 'operationalCategory', {
    value: category || 'temporary',
    enumerable: false,
  });
  return response;
}

function markOperationalError_(error, category) {
  try {
    error.operationalCategory = category;
  } catch (ignoredError) {
    // Algunas excepciones nativas no permiten propiedades adicionales.
  }
  return error;
}

function categorizeOperationalError_(error, fallbackCategory) {
  if (error && error.operationalCategory) return error.operationalCategory;

  const message = String(error && error.message || error || '').toLowerCase();
  if (/lock|bloqueo|obtain lock/.test(message)) return 'lock';
  if (/quota|too many|service invoked too many|rate limit|l[ií]mite/.test(message)) {
    return 'quota';
  }
  if (/temporar|timeout|timed out|server error|try again/.test(message)) {
    return 'temporary';
  }
  if (/permission|authorization|authorisation|forbidden|permis|autoriz/.test(message)) {
    return 'permissions';
  }
  if (/drive/.test(message)) return 'drive_read';
  if (/spreadsheet|sheet|range|append|hoja/.test(message)) return 'sheets';
  return fallbackCategory || 'unknown';
}

function observeOperation_(operation, callback) {
  const startedAt = Date.now();
  try {
    const result = callback();
    const resultCode = result && result.ok === false
      ? String(result.code || (result.alreadyVoted ? 'ALREADY_VOTED' : 'REJECTED'))
      : 'ok';
    const category = result && result.transient
      ? (result.operationalCategory ||
        (result.code === 'SYSTEM_BUSY' ? 'lock' : 'temporary'))
      : 'none';
    logOperationalEvent_(
      operation,
      resultCode,
      category,
      Date.now() - startedAt,
      ''
    );
    return result;
  } catch (error) {
    logOperationalEvent_(
      operation,
      'error',
      categorizeOperationalError_(error),
      Date.now() - startedAt,
      error && error.message
    );
    throw error;
  }
}

function logOperationalEvent_(operation, result, category, durationMs, detail) {
  const event = {
    event: 'operation',
    operation: String(operation || 'unknown'),
    result: String(result || 'unknown'),
    category: String(category || 'unknown'),
    durationMs: Math.max(0, Number(durationMs) || 0),
  };
  if (detail) event.detail = String(detail).slice(0, 500);
  console.log(JSON.stringify(event));
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
