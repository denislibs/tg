# Task 4: ProgressivePreloader — отчёт

**Статус: выполнено.** Ветка `feat/tweb-media-core`, worktree
`.worktrees/media-viewer-touch`, коммит `b3138f17` (не запушен).

## Что сделано

- `web-client/src/components/preloader.ts` — порт tweb
  `src/components/preloader.ts` (313 строк) 1:1 по логике: DOM
  (`preloader-container` / `you-spin-me-round` / `preloader-circular`
  viewBox `27 27 54 54`, streamable `25 25 50 50` / `preloader-path-new` /
  `preloader-close` / `preloader-download` — SVG-path'ы иконок дословно),
  `totalLength = 149.82473754882812` (streamable `118.61124420166016`),
  опции `isUpload`/`cancelable`/`streamable`/`tryAgainOnFail`/`attachMethod`,
  `TRANSITION_TIME = 200`, `setProgress` через `strokeDasharray`
  (`Math.max(5, …)`), `setManual`, отмена по клику → `promise.cancel?.()`,
  ретрай по фейлу (`attach` + `fastRaf` → `setManual`), detach через
  `TRANSITION_TIME·0.75` = 150 мс после 100 %, `tempId`-гард. **RTMP-вариант
  не портирован** (нет RTMP-фичи; комментарий-обоснование в шапке со ссылкой
  на строки tweb для возврата).
- **Интерфейс прогресса — tweb:** `attach(elem, reset?, promise?)` +
  `attachPromise(promise)` с `promise.addNotifyListener?.(({done,total}))` и
  `promise.cancel?.()`. Тип — существующий порт
  `@helpers/cancellablePromise` (`CancellablePromise`/`deferredPromise`,
  уже был в дереве); воркерных событий не выдумывал — источники прогресса
  подключатся на стадии E.
- `web-client/src/core/dom/setTransition.ts` — довезён `useRafs`
  (tweb `singleTransition.ts:27-48`): raf-цепочка отложенного запуска +
  отмена подвешенного raf повторным вызовом. До сих пор не портирован был
  сознательно («потребителей нет») — теперь потребитель есть, комментарий
  обновлён. `onTransitionStart` по-прежнему не портирован (потребителей нет).
- `web-client/src/helpers/dom/clickEvent.ts` — недостающая зависимость, порт
  tweb в объёме потребителей: `CLICK_EVENT_NAME` (тач → mousedown),
  глобальный mousedown-трекер + `hasMouseMovedSinceDown`, `attachClickEvent`
  (с `listenerSetter`/`cancelMouseDown`/`ignoreMove` — понадобятся
  медиавьюверу). PiP-ребиндинг трекера (`bindMouseDownTracker`/`appWindow`)
  не портирован — хелпера `appWindow` у нас нет, вернуть с PiP-работой.
- Остальные зависимости уже были портированы: `fastRaf`
  (`@helpers/schedulers`), `safeAssign`, `cancelEvent`, `isInDOM`.
- **Стили:** `web-client/src/styles/tweb/_preloader.scss` уже полный порт
  tweb `_preloader.scss` (diff — только строка `@use`), подключён в
  `styles/tweb/_index.scss:58`. Ничего не добавлял, дублей `.preloader-path`
  нет.
- **Переименование:** `components/Preloader.tsx` (самодельный React-спиннер,
  единственный потребитель — Chat.tsx:1287) → `SpinnerArc.tsx`
  (+ парный scss): кейс-инсенситив ФС macOS не различает
  `Preloader.tsx`/`preloader.ts`, extensionless-импорт `./Preloader` из
  Chat.tsx начинал резолвиться в порт (`.ts` приоритетнее `.tsx`, TS1149).
  Спиннер — стенд-ин до Стадии E, помечен комментарием на удаление.

## Тесты (TDD, vitest + happy-dom)

Написаны до реализации (первый прогон красный: модулей нет / `useRafs`
игнорируется). `preloader.test.ts` — 17: дерево DOM tweb (в т.ч. streamable
viewBox/totalLength, `preloader-swing` без cancelable), `setProgress(50)` →
`max(5, 0.5·totalLength)`, пол 5 при 1 %, сброс при 0, `setManual` → класс
`manual`, клик не-manual → `promise.cancel` (manual → `loadFunc`),
attach/detach `is-visible` через SetTransition (2 rAF на вставке, синхронно
без анимаций, `reset=true`), tempId-гард протухшего notify, быстрый резолв →
мгновенный detach, долгий → отложенный на 150 мс, reject+`tryAgainOnFail` →
manual через кадр, isUpload-гард второго промиса. `clickEvent.test.ts` — 4
(включая пин строки проводки — глобального mousedown-трекера).
`setTransition.test.ts` — +3 на `useRafs`.

```
 Test Files  215 passed (215)
      Tests  1480 passed | 2 skipped (1482)
```

`npx tsc --noEmit` — 0 ошибок. oxlint: 0 диагностик в новых/тронутых файлах,
общий счёт 2673 = базлайн 2673 (одно подавление `no-loss-of-precision` —
ложное срабатывание на 17 значащих цифрах константы tweb, round-trip точный).

## Мутационная проверка (реальный вывод vitest)

**Мутация 1** — снят `tempId`-гард в notify-листенере
(`if(tempId !== this.tempId) return` удалён):

```
 FAIL  src/components/preloader.test.ts > ProgressivePreloader: attachPromise > notify двигает прогресс; notify ПРОТУХШЕГО промиса игнорируется (tempId-гард)
AssertionError: expected '134.8422637939453, 149.82473754882812' to be '' // Object.is equality
      Tests  1 failed | 16 passed (17)
```

**Мутация 2** — снят пол дуги (`Math.max(5, …)` → голая доля):

```
 FAIL  src/components/preloader.test.ts > ProgressivePreloader: setProgress > setProgress(1): пол дуги — минимум 5 (tweb Math.max(5, …))
AssertionError: expected '1.4982473754882812, 149.82473754882812' to be '5, 149.82473754882812' // Object.is equality
      Tests  1 failed | 16 passed (17)
```

Обе мутации откатаны, финальный полный прогон зелёный.

## Замечания

- Приватные `cancelSvg`/`downloadSvg` в tweb только присваиваются и нигде не
  читаются — у нас это ошибка сборки (noUnusedLocals), убраны с комментарием.
- `attachPromise` — дженерик `<T>` (в tweb `CancellablePromise<any>`):
  контравариантность полей-колбэков под strict не пропустила бы конкретный T.
- innerHTML в порте — статические строки tweb (SVG-иконки/кольцо), без
  пользовательских данных; норма безопасности не нарушена (комментарий в шапке).
- Кейс-коллизия `Preloader.tsx`/`preloader.ts` — единственное касание вне
  прямого периметра задачи (Chat.tsx: импорт + одна JSX-строка).
