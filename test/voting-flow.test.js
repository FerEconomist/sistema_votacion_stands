const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'JavaScript.html'), 'utf8');

test('abre la confirmación final al seleccionar desde la foto ampliada', () => {
  assert.match(
    source,
    /function selectActivePhotoStand\(\)[\s\S]*?renderSelection\(\);\s*openVoteConfirmation\(true\);/
  );
});

test('permite volver desde la confirmación a la foto ampliada', () => {
  assert.match(source, /\? 'Volver al stand'\s*: 'Volver'/);
  assert.match(
    source,
    /function cancelVoteConfirmation\(\)[\s\S]*?openPhoto\(activePhotoStand, String\(activePhotoStand\.number \|\| ''\)\);/
  );
});
