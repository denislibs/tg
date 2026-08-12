# Отчёт Task 1: порт swipeHandler.ts

Коммит: `42798048` на ветке `feat/media-viewer-touch` (создана от HEAD worktree —
`de3c74cb`, `feat/tweb-media-core`; ветки `feat/media-viewer-touch` до этого не существовало).
Не запушено.

## Что портировано

- `web-client/src/core/dom/swipeHandler.ts` — порт tweb `src/components/swipeHandler.ts`
  (все 521 строка логики, кроме перечисленного ниже): пороги, `handleWheel`
  (ctrl/meta/shift → `onWheelZoom`, дельта `clamp(e.deltaY,-25,25)*0.01`,
  трекпад-пинч через `ctrlKey`, «двойной тап» трекпада через `-0`-дельты),
  пинч двумя касаниями (центр = середина, `zoomFactor = endDistance/initialDistance`),
  `onDoubleClick` (dblclick на таче), `verifyTouchTarget` (sync и async с
  `tempId`-гонкой), `cancelDrag` в wheel-drag, mouse-drag с `cursor`,
  ленивое связывание end-листенера на `element.ownerDocument` (PiP), `add(x, y)`,
  `setCursor`, `middleware.onDestroy`.
- Тесты — `web-client/src/core/dom/swipeHandler.test.ts` (6 тестов, happy-dom).

## Зависимости: откуда взяты

Уже были в проекте (порты/шимы tweb по тем же путям):
- `cancelEvent` — `@helpers/dom/cancelEvent`
- `IS_TOUCH_SUPPORTED` — `@environment/touchSupport`
- `safeAssign` — `@helpers/object/safeAssign`
- `clamp` — `@helpers/number/clamp`
- `Middleware` — `@helpers/middleware`
- `logger` — `@lib/logger`
- `windowSize` — `@helpers/windowSize` (проектный шим с теми же `.width`/`.height`)

Отсутствовали — портированы 1:1 по путям tweb (новые файлы):
- `web-client/src/helpers/listenerSetter.ts` (tweb `helpers/listenerSetter.ts`);
  правка под strict: локальная `listener` в `removeManual` — `Listener | undefined` (TS2454)
- `web-client/src/helpers/schedulers/debounce.ts` (tweb `helpers/schedulers/debounce.ts`);
  правки под strict: `| undefined` у `waitingTimeout`/`waitingPromise`/`resolve`/`reject`
  (tweb сам пишет в них `undefined`), `!` на чтениях после проверок
- `web-client/src/helpers/dom/isSwipingBackSafari.ts` (tweb `helpers/dom/isSwipingBackSafari.ts`, без правок)

## Что выброшено и почему (обоснования продублированы в шапке файла)

- `contextMenuController` + флаг `RESET_GLOBAL` (сброс жеста при открытом
  контекстном меню): в проекте нет глобального оверлей-контроллера меню
  (меню — React-компоненты), подписываться не на что. При появлении
  контроллера вернуть подписку из tweb (строки 51–54 оригинала).
- Опция `withDelay` (long-press-старт жеста): тянет `attachContextMenuListener`
  → `contextMenuController` (целая подсистема: OverlayClickHandler,
  overlayCounter, mediaSizes), а единственный потребитель порта — медиавьювер
  (tweb `mediaViewer/base.ts:522`) — её не передаёт. С ней ушли и `pause`/`deferredPromise`.
- Опции `onDrag`/`minZoom`/`maxZoom`: мертвы уже в tweb — объявлены в типах,
  но не читаются ни в самом файле, ни у потребителей (проверено grep'ом по tweb).
- liteMode/lottie-зависимостей в файле не оказалось (упомянуты в задаче на всякий случай).

Адаптация типов под наш strict tsconfig (в tweb `strict` выключен): сигнатуры
колбэков объявлены в `SwipeHandlerOptions`, поля класса ссылаются на них
(в tweb наоборот — options индексирует приватные поля класса, у нас TS2341);
`!`/`?:` на полях, заполняемых `safeAssign`/`resetValues`; `WheelEvent → EE`
через `as any as EE` (его `target: EventTarget | null`, TS2345); `void` на
трёх floating-promise вызовах (`handleStart` из `onWheelCapture`,
`releaseWheelDrag(e)`, `releaseWheelZoom(e)`). Рантайм-семантика не менялась.

## Тесты (TDD)

Сначала написаны тесты — красные на отсутствующем модуле (падение резолва
импорта `./swipeHandler`, «Test Files 1 failed, Tests no tests»), затем реализация.

6 тестов:
1. горизонтальный свайп мышью → `onSwipe(30, 10, e)` и `(60, -5, e)` — диффы от точки нажатия;
2. wheel+ctrl → `onZoom` c `zoomAdd = 0.25` (deltaY −50 клампится до −25) и центром;
3. wheel без модификаторов → drag-путь: `onSwipe(20, 10, e, cancelDrag)`, `onZoom` не зовётся;
4. `verifyTouchTarget=false` глушит жест (onSwipe не зовётся);
5. dblclick (тач-ветка) → `onDoubleClick({centerX: 44, centerY: 55})`;
6. пинч двумя касаниями → `onZoom` с `zoomFactor = 2` и центром (150, 100).

`IS_TOUCH_SUPPORTED` — модульная константа, поэтому тач/мышь-ветки грузят
модуль заново через `vi.resetModules` + `vi.doMock('@environment/touchSupport')`.

## Мутационная проверка (реальный вывод vitest)

Мутация 1 — `handleMove`: `xUp - this.xDown` → `xUp + this.xDown`:

```
 ❯ src/core/dom/swipeHandler.test.ts (6 tests | 1 failed) 109ms
     × горизонтальный свайп доводит onSwipe с корректными xDiff/yDiff 88ms
AssertionError: expected "vi.fn()" to be called with arguments: [ 30, 10, Anything ]
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Мутация 2 — `onWheelZoom`: `this.wheelZoom -= delta * 0.01` → `+=`:

```
 ❯ src/core/dom/swipeHandler.test.ts (6 tests | 1 failed) 86ms
     × wheel с ctrl вызывает onZoom с zoomAdd (дельта clamp(deltaY,-25,25)*0.01) 5ms
AssertionError: expected -0.25 to be close to 0.25, received difference is 0.5, but expected 0.005
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Мутация 3 — `handleStart`: гейт `if(!result) { return this.reset() }` → `if(false && !result)`:

```
 ❯ src/core/dom/swipeHandler.test.ts (6 tests | 1 failed) 90ms
     × verifyTouchTarget=false глушит жест: onSwipe не зовётся 8ms
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Все три мутации откачены (проверено grep'ом восстановленных строк).

## Итоговая проверка

- `npx vitest run` (весь набор): **209 файлов passed, 1427 passed | 2 skipped (1429)**, 14.4 с.
- `npx tsc --noEmit`: чисто (exit 0).
- `npx oxlint src`: в новых файлах **0 ошибок**; общий счёт ошибок репозитория
  не изменился (2388 → 2388 — это давние style-ошибки в других вендор-файлах,
  `npx oxlint src` на HEAD и без моих файлов выходит с кодом 1; проверено
  прогоном с временно убранными новыми файлами). На новых файлах остались
  только warn-уровневые `typescript/no-explicit-any` (15 шт.) — тот же класс,
  что у остальных tweb-портов (`listenerSetter`, `scrollable` и др.), правило
  в `.oxlintrc.json` стоит в `warn`.
