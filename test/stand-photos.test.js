const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(`${source}\nthis.testApi = { buildPhotoStands_, extractStandNumber_ };`, context);

const { buildPhotoStands_, extractStandNumber_ } = context.testApi;

test('reconoce nombres de fotos válidos sin importar mayúsculas o separadores', () => {
  assert.equal(extractStandNumber_('Stand 7.jpg'), 7);
  assert.equal(extractStandNumber_('stand_018.PNG'), 18);
  assert.equal(extractStandNumber_('STAND-42.webp'), 42);
  assert.equal(extractStandNumber_('IMG_20261004.jpg'), 0);
  assert.equal(extractStandNumber_('Stand 4 copia.jpg'), 0);
});

test('crea solamente los stands presentes y conserva sus números no secuenciales', () => {
  const stands = buildPhotoStands_({
    42: { imageUrl: 'photo-42' },
    7: { imageUrl: 'photo-7' },
    18: { imageUrl: 'photo-18' },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(stands)),
    [
      { id: 'stand-07', name: 'Stand 7', number: 7, imageUrl: 'photo-7' },
      { id: 'stand-18', name: 'Stand 18', number: 18, imageUrl: 'photo-18' },
      { id: 'stand-42', name: 'Stand 42', number: 42, imageUrl: 'photo-42' },
    ]
  );
});

test('limita la publicación a 30 stands', () => {
  const photoMap = Object.fromEntries(
    Array.from({ length: 35 }, (_, index) => [index + 1, { imageUrl: `photo-${index + 1}` }])
  );

  const stands = buildPhotoStands_(photoMap);
  assert.equal(stands.length, 30);
  assert.equal(stands[0].number, 1);
  assert.equal(stands[29].number, 30);
});
