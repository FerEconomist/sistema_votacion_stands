/**
 * Carga 75 votos de demostración para revisar el ranking completo.
 * Los identificadores son fijos, por lo que volver a ejecutarla no duplica
 * los votos de esta simulación.
 */
function simularMuchosVotosDePrueba() {
  const spreadsheet = getDatabase_();
  const configuration = getConfiguration_(spreadsheet);
  const status = normalizeVotingStatus_(
    configuration.estado_votacion || configuration.estado || 'closed'
  );

  if (status !== 'open') {
    throw new Error('Abrí la votación antes de ejecutar la simulación.');
  }

  const plan = [
    { number: 1, votes: 18 },
    { number: 2, votes: 15 },
    { number: 4, votes: 12 },
    { number: 6, votes: 9 },
    { number: 12, votes: 7 },
    { number: 15, votes: 5 },
    { number: 19, votes: 4 },
    { number: 22, votes: 3 },
    { number: 26, votes: 2 },
  ];
  const stands = getStands_(spreadsheet, configuration);
  const standsByNumber = stands.reduce((index, stand) => {
    index[Number(stand.number)] = stand;
    return index;
  }, {});
  const missingNumbers = plan
    .map((item) => item.number)
    .filter((number) => !standsByNumber[number]);

  if (missingNumbers.length) {
    throw new Error(`Faltan estos stands para simular: ${missingNumbers.join(', ')}.`);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const votesSheet = getOrCreateVotesSheet_(spreadsheet);
    const lastRow = votesSheet.getLastRow();
    const existingDeviceIds = new Set(
      lastRow > 1
        ? votesSheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues().flat()
        : []
    );
    const rows = [];
    let sequence = 0;
    let alreadyPresent = 0;

    plan.forEach((item) => {
      const stand = standsByNumber[item.number];
      for (let index = 0; index < item.votes; index += 1) {
        sequence += 1;
        const deviceId = `demo-ranking-20261006-${String(sequence).padStart(3, '0')}`;
        if (existingDeviceIds.has(deviceId)) {
          alreadyPresent += 1;
          continue;
        }

        rows.push([new Date(), deviceId, stand.id, stand.name]);
        existingDeviceIds.add(deviceId);
      }
    });

    if (rows.length) {
      votesSheet
        .getRange(votesSheet.getLastRow() + 1, 1, rows.length, rows[0].length)
        .setValues(rows);
    }

    setConfigurationValue_(spreadsheet, 'mostrar_resultados', 'si');
    SpreadsheetApp.flush();
    invalidateVoteIndexCache_();
    invalidatePublicCaches_();

    const summary = {
      ok: true,
      requested: sequence,
      added: rows.length,
      alreadyPresent,
      totalVotes: Math.max(votesSheet.getLastRow() - 1, 0),
      resultsEnabled: true,
    };
    console.log(JSON.stringify(summary));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Carga 1.500 votos únicamente en una copia de pruebas.
 *
 * Requisitos deliberados para evitar contaminar la edición real:
 * 1. LOAD_TEST_SPREADSHEET_ID debe apuntar a una copia, nunca a la base real.
 * 2. La propiedad de script ALLOW_LOAD_TESTS debe valer "SI".
 * 3. La votación de la copia debe estar abierta.
 */
function prepararPruebaVolumen1500() {
  return observeOperation_('load_test_1500', () => {
    const spreadsheet = requireLoadTestSpreadsheet_();
    invalidatePublicCaches_({ stands: true, photos: true });
    const configuration = getConfiguration_(spreadsheet);
    const status = normalizeVotingStatus_(
      configuration.estado_votacion || configuration.estado || 'closed'
    );
    if (status !== 'open') {
      throw new Error('Abrí la votación en la copia de pruebas antes de cargar el volumen.');
    }

    const stands = getVoteEligibleStands_(spreadsheet, configuration);
    if (!stands.length) {
      throw new Error('La copia de pruebas no tiene stands disponibles.');
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(APP_CONFIG.voteLockWaitMs)) {
      throw new Error('La copia de pruebas está ocupada. Volvé a ejecutar la función.');
    }

    try {
      const votesSheet = getOrCreateVotesSheet_(spreadsheet);
      clearSheetData_(votesSheet);
      const rows = [];

      for (let index = 0; index < 1500; index += 1) {
        const deviceId = `load-test-1500-${String(index + 1).padStart(4, '0')}`;
        const stand = stands[index % stands.length];
        rows.push([new Date(), deviceId, stand.id, stand.name]);
      }

      if (rows.length) {
        votesSheet
          .getRange(votesSheet.getLastRow() + 1, 1, rows.length, 4)
          .setValues(rows);
      }
      setConfigurationValue_(spreadsheet, 'mostrar_resultados', 'si');
      SpreadsheetApp.flush();
      invalidateVoteIndexCache_();
      invalidatePublicCaches_();

      const summary = {
        ok: true,
        requested: 1500,
        added: rows.length,
        totalVotes: Math.max(votesSheet.getLastRow() - 1, 0),
        uniqueLoadTestDevices: 1500,
      };
      console.log(JSON.stringify(summary));
      return summary;
    } finally {
      lock.releaseLock();
    }
  });
}

/** Comprueba total, duplicados y top 10 de la copia usada en la prueba. */
function verificarPruebaVolumen1500() {
  const spreadsheet = requireLoadTestSpreadsheet_();
  const votesSheet = findSheet_(spreadsheet, 'votos');
  const rows = votesSheet && votesSheet.getLastRow() > 1
    ? votesSheet.getRange(2, 2, votesSheet.getLastRow() - 1, 3).getDisplayValues()
    : [];
  const loadTestRows = rows.filter((row) => /^load-test-1500-\d{4}$/.test(row[0]));
  const uniqueDevices = new Set(loadTestRows.map((row) => row[0]));
  const duplicates = loadTestRows.length - uniqueDevices.size;
  const counts = loadTestRows.reduce((result, row) => {
    const key = row[1] || row[2];
    if (!result[key]) result[key] = { id: row[1], name: row[2], votes: 0 };
    result[key].votes += 1;
    return result;
  }, {});
  const topTen = Object.values(counts)
    .sort((first, second) => second.votes - first.votes ||
      first.name.localeCompare(second.name, 'es'))
    .slice(0, 10);

  const result = {
    ok: loadTestRows.length === 1500 && duplicates === 0,
    loadedVotes: loadTestRows.length,
    uniqueDevices: uniqueDevices.size,
    duplicates,
    topTen,
  };
  console.log(JSON.stringify(result));
  return result;
}

function requireLoadTestSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const enabled = String(properties.getProperty('ALLOW_LOAD_TESTS') || '')
    .trim()
    .toUpperCase();
  const configuredId = String(
    properties.getProperty('LOAD_TEST_SPREADSHEET_ID') || ''
  ).trim();
  if (enabled !== 'SI') {
    throw new Error('Definí ALLOW_LOAD_TESTS=SI antes de ejecutar una prueba de volumen.');
  }
  if (!configuredId || configuredId === APP_CONFIG.databaseSpreadsheetId) {
    throw new Error(
      'LOAD_TEST_SPREADSHEET_ID debe apuntar a una copia de la base, nunca a la edición real.'
    );
  }

  const spreadsheet = SpreadsheetApp.openById(configuredId);
  if (spreadsheet.getId() === APP_CONFIG.databaseSpreadsheetId) {
    throw new Error('La prueba de volumen está bloqueada para la base real.');
  }
  return spreadsheet;
}
