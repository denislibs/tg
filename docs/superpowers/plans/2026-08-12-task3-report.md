# Task 3: listLoader — отчёт

**Статус: выполнено.** Ветка `feat/tweb-media-core`, worktree `.worktrees/media-viewer-touch`.

## Что сделано

- `web-client/src/components/mediaViewer/listLoader.ts` — порт tweb
  `src/helpers/listLoader.ts` (202 строки) 1:1 по логике: `loadCount = 50`,
  `loadWhenLeft = 20`, `go()` со сплайсом previous/next и `onJump(item, older)`,
  `load()` (дедуп по инфлайт-`loadPromise`, `loadedAll` при неполной странице,
  выбор анкора и направление вставки с учётом `reverse`), `setTargets`, `reset`,
  `index`, `goUnsafe`/`unsetCurrent` (нужны будущей SearchListLoader-надстройке).
  SearchListLoader/AvatarListLoader не портированы — подключение источника
  данных отдано задаче V4 (Task 14).
- `web-client/src/helpers/array/forEachReverse.ts` — недостающая зависимость,
  порт tweb 1:1 (у `animationIntersector.ts` осталась своя локальная копия —
  сведение вне периметра). `safeAssign` уже был (`@helpers/object/safeAssign`).
- Адаптации (в шапке файла, поведение не менялось): строгий tsconfig
  (`current`/`count` честно `| undefined`, loadPromise `| null`, options
  объявляют сигнатуры сами — в tweb индексация protected-полей, TS2445);
  `ListLoaderResult.items: P[]` вместо `any[]`; `void`/`if` вместо
  выражений-операторов и `Promise.resolve`-обёртка агрегатора (oxlint);
  закомментированный в tweb `filter` не перенесён (мёртвый код).

## Тесты (TDD)

`web-client/src/components/mediaViewer/listLoader.test.ts` — 16 тестов, писались
до реализации (первый прогон красный: модуль не существует). Пины: сплайс
`go(±N)` включая прыжки и пустой край; `onJump(item, older)` и подавление
`dispatchJump=false`; дозагрузка при остатке < `loadWhenLeft` (анкор, older,
loadCount, один инфлайт, порядок вставки push/unshift с реверсом и без);
`loadedAll` по неполной странице; `setTargets` с `reverse` и reverse-направление
загрузки; `reset()`/`reset(true)`; `index`; `goUnsafe` в пределах и за.

```
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

Полный прогон:

```
 Test Files  213 passed (213)
      Tests  1456 passed | 2 skipped (1458)
```

`npx tsc --noEmit` — 0 ошибок. oxlint: 0 диагностик в трёх новых файлах,
общий счёт репозитория 2673 = базлайн 2673 (не вырос).

## Мутационная проверка (реальный вывод vitest)

**Мутация 1** — направление сплайса в `go()`:
`this.previous.push(...items)` → `this.previous.unshift(...items)`:

```
 FAIL  … > go(+1): current уходит в хвост previous, голова next становится current
AssertionError: expected [ 3, 1, 2 ] to deeply equal [ 1, 2, 3 ]
 FAIL  … > go(+2): прыжок через элемент — промежуточные оседают в previous
AssertionError: expected [ 3, 4, 1, 2 ] to deeply equal [ 1, 2, 3, 4 ]
 FAIL  … > ListLoader.onJump > зовётся с (item, older): вперёд older=true, назад older=false
AssertionError: expected last "vi.fn()" call to have been called with [ { id: 2 }, false ]
      Tests  3 failed | 13 passed (16)
```

**Мутация 2** — сломан порог `loadWhenLeft`:
`this.next.length < this.loadWhenLeft` → `this.next.length < 0`:

```
 × остаток next < loadWhenLeft: loadMore(анкор=хвост next, older=true, loadCount); один инфлайт
 × неполная страница ⇒ loadedAll: повторной дозагрузки в ту сторону нет
 × reverse: нехватка next идёт как older=false, результаты push после реверса
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times   (×3)
      Tests  3 failed | 13 passed (16)
```

Обе мутации откатаны, финальный прогон зелёный.

## Замечания

- `unsetSearchPromises` из формулировки задачи в tweb не существует (grep по
  всему tweb — 0 вхождений); ближайший аналог — обнуление
  `loadPromiseUp/Down` в `setLoaded(…, false)` и в финальном `.then` `load()`,
  оно портировано и покрыто (`reset(false)` оставляет дозагрузку живой).
- В async-тестах ожидание завершения `load()` сделано повторным вызовом
  `loader.load(...)` — во время полёта он возвращает тот же инфлайт-промис
  (заодно пинит дедуп).
