# Task 6 — источник данных списка папки (`useDialogListSource`)

**Статус:** сделано. Прогон зелёный: `264 файла / 1876 тестов`, `tsc --noEmit` чист,
`oxlint` без новых предупреждений в тронутых файлах.

## Что сделано

### `web-client/src/core/hooks/useDialogListSource.ts` (новый)

```ts
export const DIALOG_LOAD_COUNT = 20                 // tweb base.ts:23
export function guessLoadCount(): number            // tweb base.ts:216-219
export function useDialogListSource(filterId: number): DialogListSource
```

`DialogListSource = { items, totalCount, isEnd, wasAtLeastOnceFetched, animate, requestItemForIdx }`.

- **Своего списка нет.** `items` — производная от зеркала: `useChatList()` +
  развилка папок, дословно та же, что у владельца (`dialogsManager.ts::forFilter`):
  ALL — всё, кроме архива; ARCHIVE — только архив; пользовательская папка —
  не архив + `chatMatchesFolder`. Определения папки ещё нет → пустой список
  (а не «показать всё»). Порядок берётся как есть, ни `sort`, ни `dialogIndex()`.
- `index` каждой строки — ГОТОВЫЙ индекс из `chatsStore.dialogIndexById`.
- Догрузка — `SequentialCursorFetcher` (вендор этапа 2) поверх
  `managers.dialogs.getDialogs({offsetIndex, limit: guessLoadCount(), filterId})`.
  Курсор — минимальный индекс отданной страницы (порт `base.ts:274-277`), индекс
  берётся из зеркала.
- `blockAnimation` — СЧЁТЧИК (`deferredSortedVirtualList.tsx:241-253`),
  `animate = blockedAnimationCount === 0`; первая загрузка (`!offsetIndex`,
  дословно `dialogs.ts:249`) блокирует, `finally` отпускает.
- `requestItemForIdx(idx, itemsLength?)` — порт `base.ts:63-65`; **отрицательный
  индекс до фетчера не доходит** (в оригинале `revealIdx` не учитывает
  закреплённых, `deferredSortedVirtualList.tsx:289`).

**Отступления от tweb — три, все с комментариями у кода:**

1. `shouldRefetch` через 0.5 с (`base.ts:255-272`) не портирован: он лечит
   `count: null` первого ответа MTProto, наш владелец отдаёт `count` всегда
   (`dialogsManager.ts::countFor`).
2. `Set`-токенов у `blockAnimation` нет: `unblock` наружу не отдаётся и зовётся
   ровно один раз, в `finally` собственного `fetchPage`.
3. **Гвард залипшего курсора** (в оригинале не нужен, т.к. список владеет
   элементами и сам считает индексы): если курсор не сдвинулся — пустая страница
   либо зеркало ещё не знает индексов приехавших диалогов, — фетчеру
   возвращается `count: 0`. Без него цикл `fetchUntilNeededCount` крутился бы
   ВЕЧНО: у владельца сетевой курсор свой (`chatId` хвоста кэша), поэтому
   повторный запрос с тем же `offsetIndex` бесконечно возвращал бы ту же
   страницу. Мутация подтверждена (см. ниже) — воркер vitest падает.

`totalCount` фетчеру (аналог `sortedList.itemsLength()`, `base.ts:297`)
считается по зеркалу ИЗ СТОРА, а не по `items` замыкания: страница применена
проектором раньше ответа RPC (кадр `rt:dialog_op` уходит из воркера до ответа и
по тому же порту — `workerScope.ts` шлёт через тот же SuperMessagePort), а
React-рендер с новыми `items` — нет.

### `web-client/src/client/boot.ts` (правка)

`applyDialogsMirror` больше не зовёт `refresh()`:

```ts
return managers.dialogs.getDialogs({ limit: guessLoadCount() })
  .then(() => managers.dialogs.fillMirror())
  .then((netOp) => { useChatsStore.getState().applyDialogOps([netOp]) }, () => {})
```

- Полный `refresh()` поднимал у владельца `loadedAll`, после чего `getDialogs`
  никогда не ходил в сеть — весь этап 2 оставался мёртвым кодом.
- **`refresh()` не удалён.** Остальные 20+ колсайтов (Sidebar, deep-links,
  `rt:resync`, useAppBootstrap на тёплом релогине, useEditContact, …) не тронуты
  — проверено грепом; `git diff --stat` подтверждает: изменён только `boot.ts`.
- **Страницу к зеркалу доставляет второй `fillMirror()`.** `getDialogs` отдаёт
  `Dialog[]` БЕЗ индексов порядка (их считает только владелец,
  `stores/noManualOrder.test.ts`), а его собственная публикация `upsert` — это
  бродкаст `rt:dialog_op`, доставить который на холодном старте некому (насос
  поднимается в `startRealtime()` из эффекта `useAppBootstrap`). Это тот же
  Important #2, что закрывали в прошлый раз: пробел объявляет зеркало, владелец
  отвечает — `fillMirror()` и есть этот канал; второй вызов идёт уже без сети.
- Порядок холодного старта сохранён: `fillMirror()` → применение → сеть.
  `boot.order.test.ts` (fillMirror после `persistScope`, параллельно с чтением
  State) зелёный.
- Под локом сети по-прежнему нет: `if (locked) return Promise.resolve()` —
  пин «под локом — сети нет вовсе: ни getDialogs, ни fillMirror».

## Тесты

Новый `core/hooks/useDialogListSource.test.tsx` (17 тестов) + переработанные
`client/boot.dialogs.test.ts`, `client/boot.order.test.ts` (мок владельца),
`core/hooks/useAppBootstrap.lockedDialogsMirror.test.tsx` (фейк владельца получил
`getDialogs`; догон под локом теперь = страница + второй `fillMirror`).

### Мутации (каждая прогнана, вывод vitest — реальный)

| # | Мутация | Результат |
|---|---|---|
| 1 | снят `if (idx < 0) return` в `requestItemForIdx` | `expected "vi.fn()" to be called 2 times, but got 3 times` |
| 2 | `limit: guessLoadCount()` → `DIALOG_LOAD_COUNT` | `expected [ {offsetIndex: undefined, …} ] to deeply equal [ … ]` |
| 3 | reduce курсора не двигает значение | 2 теста: `to be called 2 times, but got 1`, `[ undefined ] ≠ [ undefined, 20 ]` |
| 4 | снят гвард залипшего курсора | `Error: [vitest-pool]: Worker forks emitted error` — бесконечный цикл догрузки |
| 5 | снят `chatMatchesFolder` в `items` | `expected [ 1, 2 ] to deeply equal [ 1 ]` |
| 6 | снят `if (!folderKnown) return []` | `expected [ {id: 1, …} ] to deeply equal []` |
| 7 | первая загрузка не блокирует анимацию | 2 теста: `expected true to be false` |
| 8 | счётчик глушилки → булев флаг (`setBlocked(1)/(0)`) | `expected true to be false` |
| 9 | boot: `getDialogs(...)` → `refresh()` | 2 теста: `to be called 1 times, but got 0`, `[ 'refresh', 'fillMirror' ] ≠ [ 'getDialogs', 'fillMirror' ]` |
| 10 | boot: снят `.then(() => fillMirror())` | 2 теста: `[ 1 ] ≠ [ 2, 1 ]`, `to be called 1 times, but got 0` |
| 11 | boot: снят `if (locked) return Promise.resolve()` | 2 теста: `[ {chatId: 1, …} ] ≠ []`, `to not be called at all, but been called 1 times` |

Пины владения — зелёные и не ослаблены: `stores/noDuplicateDialogs.test.ts`
(хук в зеркало не пишет; allow-list не расширялся — `boot.ts` в нём был),
`stores/noManualOrder.test.ts` (`dialogIndex()` по-прежнему зовётся ровно в
`core/managers/dialogsManager.ts`, `.sort(` в `chatsStore.ts` ровно один).

## Прогон

```
npx vitest run --reporter=dot   → Test Files 264 passed (264)
                                  Tests 1876 passed | 2 skipped (1878)
npx tsc --noEmit                → чисто
npm run lint                    → без новых предупреждений в тронутых файлах
```

## Замечания для следующих задач

- `requestItemForIdx` объявлен как `(idx: number, itemsLength?: number)` —
  `itemsLength` опционален, как в оригинале (`base.ts:63`), чтобы Task 7 мог
  звать `requestItemForIdx(0)` из `onChatsScroll`.
- Хук зовёт `useChatList()` внутри себя. Если Task 7 смонтирует по списку на
  каждую папку (как решено в спеке), `useChatList` отработает N раз за рендер —
  каждый со своим ref-кэшем. При заметном числе папок это стоит вынести наверх
  и передавать `chats` пропом; сейчас не оптимизировал сознательно (в спеке
  сигнатура `useDialogListSource(filterId)`).
- `src/components/virtual/*` в этом воркtree ещё нет — Task 5 не смержен, его
  файлы не трогал.
