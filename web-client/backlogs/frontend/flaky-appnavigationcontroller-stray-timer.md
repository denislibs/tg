# Флейк: необработанный `ReferenceError: history is not defined` из синглтона `appNavigationController`

**Статус:** долг, код не тронут (задача — только зафиксировать факты).
**Дата фиксации:** 2026-09-07, ветка `docs/flaky-tests-debt`.
**Файл-источник:** `web-client/src/core/navigation/appNavigationController.ts`.

## Симптом

При полном прогоне (`npx vitest run`) периодически падают Uncaught
Exception'ы вида:

```
ReferenceError: history is not defined
 ❯ AppNavigationController.pushState src/core/navigation/appNavigationController.ts:516:7
 ❯ src/core/navigation/appNavigationController.ts:419:14
 ❯ Timeout._onTimeout src/core/navigation/appNavigationController.ts:598:7
```

и/или

```
ReferenceError: history is not defined
 ❯ src/core/navigation/appNavigationController.ts:404:11
 ❯ Timeout._onTimeout src/core/navigation/appNavigationController.ts:598:7
```

Vitest помечает каждую как «This error originated in "<файл>" test file. It
doesn't mean the error was thrown inside the file itself, but while it was
running» — то есть ошибка НЕ из тела упомянутого теста, а из фонового таймера,
случайно всплывшего во время его прогона. Итоговый статус тестов при этом
остаётся зелёным (`Test Files N passed`), ошибки попадают в отдельный блок
`Errors`.

## Частота и условия воспроизведения

Установлено ревью + перепроверено на этой ветке (сборка от `origin/main`,
4 полных прогона `npx vitest run`, `npm ci` перед этим):

| прогон | ошибок | файлы-источники |
|---|---|---|
| 1 | 0 | — |
| 2 | 0 | — |
| 3 | 0 | (в этом прогоне упал `wsClient.test.ts`, см. отдельный долг — к этому флейку не относится) |
| 4 | **6** | `popupElement.test.ts` ×3, `popupMute.test.ts` ×2, `ForwardPicker.test.tsx` ×1 |

Число ошибок за прогон плавает от 0 до 6 (наблюдалось и раньше — до 6),
файл-источник каждый раз ДРУГОЙ: помимо файлов из таблицы выше, ранее
наблюдались `ChatDialogs.test.tsx`, `popupPeer.test.ts`,
`DatePickerPopup.test.tsx`, `Menu/Menu.test.tsx`. Общее у всех источников —
они (прямо или через `Popup.tsx`/`Menu.tsx`/`popupElement.ts`) монтируют и
размонтируют попапы/меню, которые дёргают `appNavigationController`.

Воспроизводится и на чистом `origin/main` — к недавним веткам отношения не
имеет.

## Установленная причина

`appNavigationController.ts:609` создаёт МОДУЛЬНЫЙ СИНГЛТОН при первом импорте
файла (или любого модуля, который его использует — список ниже) и живёт он
один на весь тестовый воркер, без `dispose()`/teardown-хука.

Любая мутация записи истории (`pushItem`/`onItemAdded`/`onItemDeleted`/
`overrideHash` и т.д.) кладёт колбэк в очередь `modificationQueue` и планирует
её разбор РЕАЛЬНЫМ (не фейковым) `setTimeout(..., 0)`:

- `appNavigationController.ts:582-606` (`modifyHistoryFromEvent`) —
  `setTimeout` ставится на строке 589, тело таймера — строки 590-604;
- строка 598 — `callback()`, вызывающий отложенный колбэк (например
  `pushState` со строки 419 или прямой `history.back()` со строки 404);
- строка 404 (`history.back()`) и строка 516 (`history.pushState(...)`) —
  собственно места, где падает `ReferenceError`.

Если такая мутация происходит близко к концу теста (типично — размонтирование
попапа/меню в `afterEach` или в последнем `it`), тест успевает завершиться и
vitest успевает СНЕСТИ окружение happy-dom этого тестового файла (в котором
`history`/`window` — обычные глобальные биндинги на общий процесс воркера)
раньше, чем сработает поставленный `setTimeout(0)`. К моменту его срабатывания
`history` уже не существует как идентификатор в глобальной области — отсюда
именно `ReferenceError: history is not defined` (а не «Cannot read property of
undefined»: это стирание БИНДИНГА между файлами, а не пустое значение
свойства).

Ни один тест не изолирует/не мокает `appNavigationController` и не вызывает
`vi.useFakeTimers()` вокруг него, поэтому таймер планируется НАСТОЯЩИМ
`setTimeout` и переживает границу файла как самостоятельный процесс-тик.

Потребители синглтона, из-за которых источник каждый раз разный (любой из них
триггерит мутацию истории при монтировании/размонтировании):
`web-client/src/shared/ui/Popup/Popup.tsx`,
`web-client/src/shared/ui/Menu/Menu.tsx`,
`web-client/src/components/popups/popupElement.ts`,
`web-client/src/core/navigation/chatHistory.ts`,
`web-client/src/core/hooks/useNavLayer.ts`,
`web-client/src/core/hooks/useUrlSync.ts`,
`web-client/src/core/hooks/useDeepLinks.ts`,
`web-client/src/core/hooks/useAuthGate.ts`,
`web-client/src/core/hooks/useAppHotkeys.ts`,
`web-client/src/core/hotkeys.ts`,
`web-client/src/components/Chat.tsx`,
`web-client/src/components/slider.ts`,
`web-client/src/components/chat/selection.ts`,
`web-client/src/components/chat/VanillaFeed.tsx`,
`web-client/src/components/mediaViewer/openMediaViewer.ts`,
`web-client/src/components/mediaViewer/base.ts`,
`web-client/src/components/auth/cards/SignImportCard.solid.tsx`,
`web-client/src/helpers/overlayClickHandler.ts`.
Любой тест, который прямо или транзитивно тянет один из этих модулей и
монтирует/закрывает попап/меню/оверлей ближе к концу теста, — кандидат в
источники на следующий прогон.

## Почему это не регрессия конкретной ветки

Установлено ревью и подтверждено повторно на ветке, поднятой от свежего
`origin/main` (см. таблицу прогонов выше — прогон 4 дал 6 ошибок на чистом
дереве без каких-либо правок). Причина — в самой конструкции синглтона
(модульный, без teardown, с настоящим `setTimeout`) и в модели тестового
окружения (vitest/happy-dom рвёт глобальные биндинги между файлами), а не в
изменениях какой-либо рабочей ветки.

## Только тестовая среда или может уронить бой (приоритет)

**Вывод: дефект только тестовой среды, продуктового риска не установлено.**

Обоснование:

1. `appNavigationController.ts:151-153` — конструктор явно выходит рано, если
   `typeof window === 'undefined'` (нет `window`/`history` вовсе — например
   в Web/SharedWorker). То есть за пределы контекста, где `window` жив, синглтон
   осознанно не выбирается — там он просто не запускается.
2. В реальной вкладке браузера `window`/`history` живут ЦЕЛИКОМ до самого
   конца жизни документа — они не могут «частично исчезнуть» так, как это
   происходит между тестовыми файлами (там `history` буквально стирается из
   глобальной области, оставляя рядом рабочий `setTimeout`/event loop). В
   браузере эти две вещи не расходятся: пока жив JS-realm страницы — жив и
   `history`; когда происходит настоящая выгрузка (навигация/закрытие
   вкладки), спецификация HTML требует, что задачи, ассоциированные с
   документом, который выгружается, ПРОСТО НЕ ВЫПОЛНЯЮТСЯ — а не выполняются
   в «осиротевшем» окружении без `history`. Условия для буквально такого же
   `ReferenceError` в проде нет.
3. Единственный правдоподобный аналог в проде — не эта ошибка, а общий
   смысл дефекта: «синглтон планирует настоящий макротаск и не умеет его
   отменить». В проде это не проявится как краш (нет сценария, где `history`
   исчезает, а `setTimeout` продолжает тикать), но сам факт отсутствия
   отмены — независимый повод присмотреться (см. «Что нужно сделать»,
   пункт 2) на случай будущих изменений модели (например, если контроллер
   когда-нибудь получит `dispose()` для SPA-в-iframe сценария).

Итог по приоритету: чинить нужно, но НЕ как продуктовый инцидент — как
загрязнение сигнала тестов (мешает видеть настоящие красные тесты на фоне
шума). Приоритет — гигиена CI, не безопасность/стабильность прод-рантайма.

## Что нужно сделать для починки

1. Дать тестам, которые монтируют/закрывают попапы, меню и подобные оверлеи,
   способ детерминированно дождаться/слить очередь `modificationQueue`
   синглтона перед завершением (например через `vi.useFakeTimers()` +
   `vi.runAllTimers()` в `afterEach`, либо явный `flush()`, которого сейчас у
   класса нет).
2. Альтернатива без правки тестов поштучно — завести в
   `AppNavigationController` метод отмены отложенных мутаций (`dispose()`/
   `cancelPendingModifications()`) и звать его из общего `afterEach` тестового
   окружения (`web-client/src/test/setup.ts`).
3. Не годится как решение: подавление ошибки глобальным
   `unhandledRejection`-фильтром — спрячет и настоящие будущие баги той же
   природы.

## Как проверить, что починено

10+ полных прогонов `npx vitest run` подряд без единой строки
`ReferenceError: history is not defined` в блоке `Errors` (сейчас блок
`Errors` то пуст, то содержит от 1 до 6 таких записей).

**Затрагиваемые файлы:**
- `web-client/src/core/navigation/appNavigationController.ts:404,419,516,589,598,609-611` — сама очередь и синглтон.
- `web-client/src/test/setup.ts` — вероятное место общего teardown-хука, если чинить вариантом 2.
