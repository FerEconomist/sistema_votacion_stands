const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const votingClient = fs.readFileSync(path.join(root, 'JavaScript.html'), 'utf8');
const resultsClient = fs.readFileSync(path.join(root, 'ResultsJavaScript.html'), 'utf8');
const simulation = fs.readFileSync(path.join(root, 'Simulation.gs'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8');

test('valida el stand por una ruta liviana y conserva Votos como control definitivo', () => {
  assert.match(server, /function getVoteEligibleStands_\(spreadsheet, configuration\)/);
  assert.match(
    server,
    /function getVoteEligibleStands_[\s\S]*readConfiguredVoteStands_[\s\S]*CACHE_KEYS\.stands/
  );
  assert.match(
    server,
    /function registerVote\(vote\)[\s\S]*getVoteEligibleStands_[\s\S]*tryLock\(APP_CONFIG\.voteLockWaitMs\)[\s\S]*findVoteByDevice_\(votesSheet, deviceId\)[\s\S]*appendRow/
  );
  assert.match(server, /voteLockWaitMs: 30000/);
  assert.match(server, /createTextFinder\(deviceId\)[\s\S]*matchEntireCell\(true\)/);
});

test('usa cachés acotadas e invalida cambios administrativos', () => {
  assert.match(server, /publicConfigurationCacheSeconds: 30/);
  assert.match(server, /standsCacheSeconds: 120/);
  assert.match(server, /photosCacheSeconds: 120/);
  assert.match(server, /resultsCacheSeconds: 8/);
  assert.match(server, /function invalidatePublicCaches_\(options\)/);
  assert.match(server, /function setVotingStatus[\s\S]*invalidatePublicCaches_\(\)/);
  assert.match(server, /function resetVoting[\s\S]*rotateVoteEditionToken_\(\)/);
  assert.match(server, /function emptyStands[\s\S]*invalidatePublicCaches_\(\{ stands: true, photos: true \}\)/);
});

test('vacía votos y stands sin modificar las fotos de Drive', () => {
  assert.match(
    server,
    /function emptyStands[\s\S]*archiveVotes_[\s\S]*archiveStands_[\s\S]*clearSheetData_\(findSheet_\(spreadsheet, 'votos'\)\)[\s\S]*clearSheetData_\(findSheet_\(spreadsheet, 'stands'\)\)/
  );
  assert.match(server, /photosRequireManualCleanup: true/);
  assert.doesNotMatch(server, /function moveFolderContents_/);
  assert.doesNotMatch(server, /function getConfiguredFolder_/);
  assert.match(votingClient, /Las fotos de Fotos activas no se modificarán/);
  assert.match(manifest, /https:\/\/www\.googleapis\.com\/auth\/drive\.readonly/);
  assert.doesNotMatch(manifest, /https:\/\/www\.googleapis\.com\/auth\/drive"/);
});

test('reintenta votos transitorios con espera variable sin quitar el control del servidor', () => {
  assert.match(votingClient, /const MAX_VOTE_RETRIES = 2/);
  assert.match(votingClient, /function registerVoteWithRetry\(payload\)/);
  assert.match(votingClient, /result\.transient/);
  assert.match(votingClient, /Math\.random\(\) \* 500/);
  assert.match(votingClient, /callServer\('registerVote', payload\)/);
  assert.match(votingClient, /requestId: createVoteRequestId\(\)/);
  assert.match(server, /cachedVote\.requestId === requestId/);
  assert.match(server, /idempotentRetry: true/);
});

test('refresca resultados cada 15 segundos y se detiene con la pestaña oculta', () => {
  assert.match(resultsClient, /const REFRESH_INTERVAL_MS = 15000/);
  assert.match(resultsClient, /document\.hidden/);
  assert.match(resultsClient, /visibilitychange/);
  assert.match(resultsClient, /if \(!document\.hidden\) refreshResults\(\)/);
  assert.doesNotMatch(resultsClient, /setInterval\(refreshResults, 7000\)/);
  assert.match(server, /function getPublicResults\(\)[\s\S]*CACHE_KEYS\.results[\s\S]*tryLock/);
});

test('clasifica los errores operativos sin exponer identificadores', () => {
  const context = vm.createContext({ console });
  vm.runInContext(
    `${server}\nthis.testApi = { categorizeOperationalError_, buildTransientVoteFailure_ };`,
    context
  );

  assert.equal(
    context.testApi.categorizeOperationalError_(new Error('Service invoked too many times')),
    'quota'
  );
  assert.equal(
    context.testApi.categorizeOperationalError_(new Error('Authorization is required')),
    'permissions'
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.testApi.buildTransientVoteFailure_('lock'))),
    {
      ok: false,
      transient: true,
      code: 'SYSTEM_BUSY',
      message: 'Hay muchos votos al mismo tiempo. Esperá un instante e intentá nuevamente.',
    }
  );
  assert.match(server, /function observeOperation_\(operation, callback\)/);
  assert.doesNotMatch(server, /logOperationalEvent_\([^\n]*deviceId/);
});

test('la prueba de 1500 votos está bloqueada para la base real', () => {
  assert.match(simulation, /function prepararPruebaVolumen1500\(\)/);
  assert.match(simulation, /ALLOW_LOAD_TESTS/);
  assert.match(simulation, /LOAD_TEST_SPREADSHEET_ID/);
  assert.match(simulation, /configuredId === APP_CONFIG\.databaseSpreadsheetId/);
  assert.match(simulation, /clearSheetData_\(votesSheet\)/);
  assert.match(simulation, /for \(let index = 0; index < 1500; index \+= 1\)/);
  assert.match(simulation, /function verificarPruebaVolumen1500\(\)/);
});
