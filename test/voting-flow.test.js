const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const client = fs.readFileSync(path.join(__dirname, '..', 'JavaScript.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

test('abre la confirmación final al seleccionar desde la foto ampliada', () => {
  assert.match(
    client,
    /function selectActivePhotoStand\(\)[\s\S]*?renderSelection\(\);\s*openVoteConfirmation\(true\);/
  );
});

test('permite volver desde la confirmación a la foto ampliada', () => {
  assert.match(client, /\? 'Volver al stand'\s*: 'Volver'/);
  assert.match(
    client,
    /function cancelVoteConfirmation\(\)[\s\S]*?openPhoto\(activePhotoStand, String\(activePhotoStand\.number \|\| ''\)\);/
  );
});

test('consulta al servidor si el navegador ya votó antes de habilitar la selección', () => {
  assert.match(server, /function getVoteStatus\(deviceId\)/);
  assert.match(server, /findVoteByDevice_\([\s\S]*normalizedDeviceId/);
  assert.match(client, /voteStatusReady: false/);
  assert.match(client, /callServer\('getVoteStatus', deviceId\)/);
  assert.match(client, /state\.voteStatusReady = true;[\s\S]*renderSelection\(\);/);
  assert.match(client, /state\.status === 'open' && state\.voteStatusReady && !state\.hasVoted/);
});

test('mantiene el rechazo definitivo de votos repetidos en el servidor', () => {
  assert.match(
    server,
    /function registerVote\(vote\)[\s\S]*LockService\.getScriptLock\(\)[\s\S]*findVoteByDevice_\(votesSheet, deviceId\)/
  );
});
