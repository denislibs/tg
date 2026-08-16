/** Запуск: node --test "tools/tweb-parity/**\/*.test.mjs" */

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {classesOf, parseScss} from './scss.mjs';

test('разворачивает вложенность через пробел', () => {
  const {selectors} = parseScss('.bubble { .time { color: red; } }');
  assert.deepEqual(selectors, ['.bubble', '.bubble .time']);
});

test('склеивает &-суффикс в одно имя класса', () => {
  const {selectors} = parseScss('.bubbles-group { &-avatar { top: 0; } }');
  assert.ok(selectors.includes('.bubbles-group-avatar'));
  assert.ok(classesOf(selectors).has('bubbles-group-avatar'));
});

test('подставляет родителя в середину селектора', () => {
  const {selectors} = parseScss('.bubble { .is-selecting & { opacity: 1; } }');
  assert.ok(selectors.includes('.is-selecting .bubble'));
});

test('размножает по запятым обеих сторон', () => {
  const {selectors} = parseScss('.a, .b { &-x, &-y { color: red; } }');
  for(const expected of ['.a-x', '.a-y', '.b-x', '.b-y']) {
    assert.ok(selectors.includes(expected), expected);
  }
});

test('@media не создаёт лишнего уровня вложенности', () => {
  const {selectors} = parseScss('.bubble { @media (max-width: 600px) { .time { color: red; } } }');
  assert.ok(selectors.includes('.bubble .time'));
  assert.ok(!selectors.some((s) => s.includes('@media')));
});

test('@keyframes и @mixin не дают селекторов', () => {
  const {selectors} = parseScss('@keyframes fade { 0% { opacity: 0; } } @mixin m { .x { color: red; } }');
  assert.deepEqual(selectors, []);
});

test('интерполяция не рвёт селектор пополам', () => {
  const {selectors, dynamic} = parseScss('.popup { #{$p}-container#{$p}-container { max-height: 1px; } }');
  assert.deepEqual(selectors, ['.popup']);
  assert.equal(dynamic.length, 1);
  assert.ok(dynamic[0].includes('#{}'));
});

test('комментарии не попадают в селекторы', () => {
  const {selectors} = parseScss('/* .commented { } */ .real { color: red; } // .also-not { }');
  assert.deepEqual(selectors, ['.real']);
});

test('classesOf вытаскивает все классы селектора', () => {
  assert.deepEqual(
    [...classesOf(['.bubble.is-out .time:hover'])].sort(),
    ['bubble', 'is-out', 'time']
  );
});
