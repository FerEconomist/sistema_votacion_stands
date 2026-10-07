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
