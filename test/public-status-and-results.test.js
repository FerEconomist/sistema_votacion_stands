const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('muestra un horario estimado de cierre cuando la votación está abierta', () => {
  const server = read('Code.gs');
  const client = read('JavaScript.html');
  const page = read('Index.html');

  assert.match(server, /estimatedClosing:[\s\S]*configuration\.horario_cierre/);
  assert.match(client, /elements\.estimatedClosing\.hidden = !isOpen/);
  assert.match(page, /id="estimatedClosing"[\s\S]*Cierre estimado/);
});

test('abre las primeras diez posiciones en una pestaña nueva', () => {
  const server = read('Code.gs');
  const client = read('JavaScript.html');
  const page = read('Index.html');

  assert.match(server, /resultsLimit: 10/);
  assert.match(server, /showResults: status === 'open'/);
  assert.match(server, /enabled = status === 'open'/);
  assert.match(server, /ScriptApp\.getService\(\)\.getUrl\(\)/);
  assert.match(client, /elements\.resultsLink\.href = state\.resultsUrl/);
  assert.match(page, /id="resultsLink"[\s\S]*target="_blank"[\s\S]*Ver posiciones/);
  assert.match(page, /<h1 id="pageTitle">Elegí tu stand favorito<\/h1>/);
  assert.doesNotMatch(page, />Stands participantes</);
});

test('distingue el podio con copas de oro, plata y bronce', () => {
  const page = read('Results.html');
  const client = read('ResultsJavaScript.html');

  assert.match(page, /ranking-item__trophy/);
  assert.match(client, /copa de oro/);
  assert.match(client, /copa de plata/);
  assert.match(client, /copa de bronce/);
});
