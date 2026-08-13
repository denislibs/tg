# Task 6 — источник данных списка папки (`useDialogListSource`)

**Статус:** сделано; ревью (5 Important + 6 Minor) и ре-ревью (2 находки)
закрыты. Прогон зелёный: `267 файлов / 1897 тестов`, `tsc --noEmit` чист (кроме
файлов параллельных агентов — `components/ArchiveRow.tsx`, `ChatList*`,
`virtual/*`), `oxlint` без предупреждений в тронутых файлах.

## Файлы

| Файл | Что |
|---|---|
| `web-client/src/core/dialogs/loadCount.ts` (+ `.test.ts`) | `DIALOG_LOAD_COUNT`, `guessLoadCount()` |
| `web-client/src/stores/notifyStore.ts` (+ `noDuplicateMuteRule.test.ts`) | `isDialogMuted()` — единственный дом правила «заглушён» |
| `web-client/src/core/hooks/useChatList.ts` (+ `.test.ts`) | колсайт правила в витрине |
| `web-client/src/client/uiNotifications.ts` | колсайт правила в гейте уведомлений |
| `web-client/src/core/hooks/useDialogListSource.ts` (+ `.test.tsx`) | сам источник |
| `web-client/src/client/boot.ts` | первичный догон — страницей |
| `web-client/src/client/boot.dialogs.test.ts`, `boot.order.test.ts` | пины boot |
| `web-client/src/core/hooks/useAppBootstrap.lockedDialogsMirror.test.tsx` | догон после разблокировки |

## Что сделано

### `core/dialogs/loadCount.ts`

```ts
export const DIALOG_LOAD_COUNT = 20                 // tweb base.ts:23
export function guessLoadCount(): number            // tweb base.ts:216-219
```

Отдельный модуль (M12): страницу просит и React-хук, и точка входа
`client/boot.ts` — тянуть в boot React-хук ради двух чистых функций незачем.

### `core/hooks/useDialogListSource.ts`

```ts
export function useDialogListSource(filterId: number, chats: Chat[]): DialogListSource
// { items, totalCount, isEnd, wasAtLeastOnceFetched, animate, requestItemForIdx }
```

- **Своего списка нет.** `items` — производная от зеркала: строки берутся из
  `chatsStore.dialogs` в их порядке, витринное значение (`Chat`) — из `chats`.
  Ни `sort`, ни `dialogIndex()`.
- **Правило папки РОВНО ОДНО** — `matchesThisFolder(d: Dialog)`, им считаются и
  строки, и размер набора для фетчера. Развилка дословно как у владельца
  (`dialogsManager.ts::forFilter`): ALL — всё, кроме архива; ARCHIVE — только
  архив; пользовательская папка — не архив + `dialogMatchesFolder`. Определения
  папки ещё нет → пустой список.
- `index` каждой строки — ГОТОВЫЙ индекс из `chatsStore.dialogIndexById`.
- Догрузка — `SequentialCursorFetcher` поверх
  `managers.dialogs.getDialogs({offsetIndex, limit: guessLoadCount(), filterId})`;
  курсор — минимальный индекс отданной страницы (порт `base.ts:274-277`),
  индекс берётся из зеркала.
- `totalCount` фетчеру — размер НАБОРА в зеркале (порт `sortedList.itemsLength()`,
  `base.ts:297`), а не длина страницы.
- `blockAnimation` — СЧЁТЧИК (`deferredSortedVirtualList.tsx:241-253`),
  `animate = blockedAnimationCount === 0`; первая загрузка (`!offsetIndex`,
  дословно `dialogs.ts:249`) блокирует, `finally` отпускает.
- Гвард актуальности: ответ после размонтирования (`middleware()`) или после
  переключения папки (`currentFilterId()`) не пишет состояние и не двигает курсор.
- Смена `filterId` сбрасывает `totalCount`/`isEnd`/`wasAtLeastOnceFetched`.
- `requestItemForIdx(idx, itemsLength?)` — порт `base.ts:63-65`; отрицательный
  индекс до фетчера не доходит.

**Отступления от tweb — три, все с комментариями у кода:**

1. `shouldRefetch` через 0.5 с (`base.ts:255-272`) не портирован: он лечит
   `count: null` первого ответа MTProto, наш владелец отдаёт `count` всегда.
2. `Set`-токенов у `blockAnimation` нет: `unblock` наружу не отдаётся и зовётся
   ровно один раз, в `finally` собственного `fetchPage`.
3. **Гвард залипшего курсора.** Если курсор не сдвинулся — пустая страница либо
   зеркало ещё не знает индексов приехавших диалогов, — фетчеру возвращается
   `count: 0`. Без него цикл крутился бы ВЕЧНО: у владельца сетевой курсор свой
   (`chatId` хвоста кэша), повторный запрос с тем же `offsetIndex` бесконечно
   возвращал бы ту же страницу. Легитимную догрузку это глушит **мягко**:
   обрывается только текущий цикл, следующий `requestItemForIdx` (скролл, новый
   видимый индекс) начнёт с того же курсора заново; само окно почти
   недостижимо — `startRealtime()` поднимает насос раньше, чем долетит ответ
   RPC, а кадр `rt:dialog_op` уходит из воркера до ответа и по тому же порту.

### `client/boot.ts`

```ts
return managers.dialogs.getDialogs({ limit: guessLoadCount() })
  .then(() => managers.dialogs.fillMirror())
  .then((netOp) => { useChatsStore.getState().applyDialogOps([netOp]) }, () => {})
```

- Полный `refresh()` поднимал у владельца `loadedAll`, после чего `getDialogs`
  никогда не ходил в сеть — весь этап 2 оставался мёртвым кодом.
- **`refresh()` не удалён.** Остальные 20+ колсайтов не тронуты — `git diff`
  по ним пуст.
- **Страницу к зеркалу доставляет второй `fillMirror()`.** `getDialogs` отдаёт
  `Dialog[]` без индексов порядка, а его `upsert` — бродкаст `rt:dialog_op`,
  доставить который на холодном старте некому.
- Порядок холодного старта сохранён; под локом сети нет.

## Ответ на находки ревью

### I4 (настоящий баг) — два адаптера правила папки

Было: `items` считались через `chatMatchesFolder(Chat)`, а `countInMirror` —
через `dialogMatchesFolder(Dialog)`. `useChatList` навешивает `muted` ещё и по
глобально выключенному ТИПУ чатов (`notifyStore`, tweb `isPeerLocalMuted` с
`respectType`), а у `Dialog.muted` этого нет → в папке с `excludeMuted`
`countInMirror() > items.length`, фетчер считает набранным то, чего в списке
нет, цикл обрывается, **папка не наполняется никогда**.

Стало: одно правило `matchesThisFolder(d: Dialog)` на оба потребителя. Считается
по `Dialog` (размер нужен вне рендера, где витринных `Chat` нет), а расхождение
по `muted` снято явной функцией `isMuted(d, notifySettings)` — тем же выражением,
что у `useChatList`. `items` теперь идут по `dialogs` из зеркала, а `chats`
используются только как источник витринного значения строки.

Пин: «excludeMuted + глобально заглушённый тип: чат не в списке И не в размере
набора» (проверяет и пустой `items`, и то, что цикл догрузки идёт до конца
набора, а не обрывается на первой странице).

### I1 — `totalCount: countInMirror()` покрыт

Тест «фетчеру отдаётся размер набора в зеркале, а не длина страницы»:
перекрывающиеся страницы (3 отдано → 3 новых, затем 2 отдано → 1 новый).
С `totalCount` цикл добирает третью страницу, без него — считает уже известные
строки заново и обрывается. Фильтр папки внутри `countInMirror` покрыт этим же
тестом и тестом I4 (мутация «считать все диалоги подряд» краснеет).

### I2 — гвард актуальности покрыт

Два теста: «хук размонтирован — цикл догрузки не продолжается» и «папку
переключили, пока страница летела — цикл прошлой папки не продолжается».
Оба на фейке с ручным разрешением запроса.

### I3 — сброс `page` при смене папки покрыт

Тест «смена папки сбрасывает totalCount/isEnd/wasAtLeastOnceFetched».

### I5 — `chats` пропом

Сигнатура: `useDialogListSource(filterId, chats)`. Собственного `useChatList()`
внутри больше нет — при списке на каждую папку это давало бы N ref-кэшей с
`JSON.stringify` по всему массиву диалогов на каждую операцию. Task 7 передаёт
`chats` из `Sidebar.tsx:95`, где они уже есть. В тестах хук вызывается как
`useDialogListSource(fid, useChatList())` — ровно так, как его позовёт Sidebar.

### Minor

- **M7** — докблок `applyDialogsMirror` переписан: `getDialogs` cache-first
  (как tweb `dialogsStorage.getDialogs`), поэтому холодный старт при прогретом
  кэше сети не касается вовсе. Смысл `dialogsReady` записан явно: «первая
  страница ДОЕХАЛА ДО ЗЕРКАЛА — из сети или из кэша владельца», а не «сетевой
  список приехал»; потребителю (сид презенса) нужно ровно это.
- **M9** — фейк `getDialogs` бросает после `MAX_CALLS = 12`. Мутация «снять
  гвард залипшего курсора» теперь даёт `expected "vi.fn()" to be called 1 times,
  but got 13 times`, а не краш пула vitest.
- **M10** — мягкость гварда дописана комментарием у строки (см. отступление 3).
- **M11** — формулировка комментария у `if (idx < 0) return` исправлена: tweb
  сознательно переписывает `fetchedItemsCount` на каждом вызове, это не баг
  оригинала. Наше обоснование другое: у нас «уже набрано» приходит ещё и из
  ответа владельца (`totalCount`), и молча смешивать два источника на вызове,
  который ничего не просит, незачем.
- **M12** — `DIALOG_LOAD_COUNT`/`guessLoadCount` переехали в
  `core/dialogs/loadCount.ts` со своим тестом. **Task 7: импортировать оттуда,
  а не из хука** — реэкспорта из `useDialogListSource` намеренно нет.

### Про второй `fillMirror` (моё прежнее сомнение №1)

Формулировка «единственная альтернатива» была неточной — снята. Цена нынешней
схемы записана комментарием у кода: полный список едет по порту ДВАЖДЫ за
холодный старт (ответ первого `fillMirror` + ответ второго) плюс лишний
бродкаст `reset` соседним вкладкам (`announce` внутри `fillMirror`); со стороны
стора это бесплатно — `reconcile`/`sameList`/`sameIndex` сохраняют ссылки,
второго рендера нет. Инвариант «одно батч-чтение до первого рендера» не нарушен.
Дешевле было бы `getSnapshot()` владельца (`dialogsManager.ts:549`, индексы там
есть, сейчас не зовётся ниоткуда) — но это отдельный RPC-контракт и правка
этапа 2.

## Ответ на находки ре-ревью

### 1 — правило «заглушён» сведено к одной функции

Было: выражение `dialog.muted || settings[notifyTypeForChat(type)].muted`
написано в ТРЁХ местах — `useChatList.ts:27`, `useDialogListSource.ts:59`,
`client/uiNotifications.ts:27`. Совпадали, но ничто их не скрепляло: удаление
строки `useChatList.ts:27` оставляло весь прогон зелёным, то есть I4 мог
вернуться молча и в проде.

Стало:

- `stores/notifyStore.ts::isDialogMuted(dialog, settings)` — единственный дом
  правила, рядом с `notifyTypeForChat`. `dialog` опционален: уведомление
  приходит и по чату, которого ещё нет в зеркале.
- Три колсайта зовут её; `uiNotifications` продолжает брать `typeSettings`
  для `preview` — это ДРУГАЯ настройка, правило она не выводит.
- **Пин `stores/noDuplicateMuteRule.test.ts`** (образец —
  `stores/noManualOrder.test.ts`): скан по исходникам, копия узнаётся по паре
  признаков «файл берёт настройки по типу чата (`notifyTypeForChat`) И читает у
  них `.muted`». Экран настроек уведомлений читает `settings[key].muted` без
  `notifyTypeForChat` — правило не выводит, под пин не попадает. Второй тест —
  анти-протухание: сам дом правила его содержит.
- **Пин на ПРИМЕНЕНИЕ в витрине** — новый `core/hooks/useChatList.test.ts`: то
  самое место, удаление которого раньше проходило зелёным.

Мутации: удаление половины правила в самом `isDialogMuted` краснит обоих
потребителей (витрину и фильтр папок); возврат второй копии в
`useDialogListSource` краснит пин (`[ 'core/hooks/useDialogListSource.ts' ] ≠ []`);
удаление колсайта в `useChatList` краснит его тест.

### 2 — `if (!value) continue` покрыт

Тест «диалог, которого нет в пропе `chats`, в items не попадает» (мутация
«оставлять строку без витринного `Chat`» → `[ 1, 2 ] ≠ [ 1 ]`). У строки
комментарий: контракт `chats` — ПОЛНАЯ витрина зеркала, поэтому в норме ветка
недостижима; держим её как единственную честную реакцию — если сработает, набор
папки станет больше списка (`countInMirror` считает по зеркалу, а не по `chats`)
и догрузка встанет ровно так же, как вставала на разъехавшемся `muted`.

### Принято как есть (зафиксировано, не чинилось)

- **`countInMirror` читает `useChatsStore.getState()`** — мутация «читать
  `dialogs` из замыкания рендера» зелёная, хотя выбор обоснован отдельным
  абзацем докблока. Различить их тестом можно только смоделировав окно «зеркало
  уже применило страницу, React ещё не перерисовал», которого в `act()` не
  бывает; выбор оставлен как есть, обоснование — у кода.
- **Ненаблюдаемые различения:** `filterId: forFilterId` в аргументах запроса и в
  `setPageState` — мутации на «текущий `filterId`» зелёные, потому что гвард
  актуальности обрывает цикл прошлой папки раньше следующей итерации. Туда же
  `index: dialogIndexById[d.chatId] ?? 0` — `?? 0` недостижим, индексы владелец
  считает на все строки зеркала.
- **Колсайт в `client/uiNotifications.ts` остаётся без теста** — как и был до
  задачи: у файла нет тестов вовсе (он тянет `startClient()` на уровне модуля).
  Правило, которое он теперь зовёт, покрыто в своём доме; сам гейт уведомлений —
  предсуществующий долг, вне периметра Task 6.

## Мутации (каждая прогнана, вывод vitest — реальный)

| # | Мутация | Результат |
|---|---|---|
| 1 | снят `if (idx < 0) return` | `expected "vi.fn()" to be called 2 times, but got 3 times` |
| 2 | `limit: guessLoadCount()` → `20` | `expected [ {offsetIndex: undefined, …} ] to deeply equal [ … ]` |
| 3 | reduce курсора не двигает значение | 2 теста: `to be called 2 times, but got 1`, `[ undefined ] ≠ [ undefined, 20 ]` |
| 4 | снят гвард залипшего курсора | 2 теста: `[ undefined, 20, 20, 20, … ] ≠ [ undefined, 20 ]`, `to be called 1 times, but got 13 times` |
| 5 | снят фильтр папки в `items` | `expected [ 1, 2 ] to deeply equal [ 1 ]` |
| 6 | снят `if (!folderKnown) return []` | `expected [ {id: 1, …} ] to deeply equal []` |
| 7 | первая загрузка не блокирует анимацию | 2 теста: `expected true to be false` |
| 8 | счётчик глушилки → булев флаг | `expected true to be false` |
| 9 | **I4:** `dialogMatchesFolder(d, …)` без `isMuted` | `expected [ {id: 1, …}, …(1) ] to deeply equal []` |
| 10 | **I1a:** снят `totalCount: countInMirror()` | 2 теста: `to be called 3 times, but got 2 times` (×2) |
| 11 | **I1b:** `countInMirror` считает все диалоги подряд | `to be called 3 times, but got 1 times` |
| 12 | **I2:** снят `if (!middleware() \|\| currentFilterId() !== forFilterId)` | 2 теста: `to be called 1 times, but got 2 times` (×2) |
| 13 | **I3:** `const page = pageState` | `expected 137 to be +0` |
| 14 | boot: `getDialogs(...)` → `refresh()` | 2 теста: `to be called 1 times, but got 0`, `[ 'refresh', 'fillMirror' ] ≠ [ 'getDialogs', 'fillMirror' ]` |
| 15 | boot: снят `.then(() => fillMirror())` | 2 теста: `[ 1 ] ≠ [ 2, 1 ]`, `to be called 1 times, but got 0` |
| 16 | boot: снят `if (locked) return Promise.resolve()` | 2 теста: `[ {chatId: 1, …} ] ≠ []`, `to not be called at all, but been called 1 times` |
| 17 | **ре-ревью 1:** `isDialogMuted` теряет половину правила (`return !!dialog?.muted`) | 2 теста: `expected undefined to be true` (витрина), `[ {id: 1, …}, …(1) ] ≠ []` (фильтр папки) |
| 18 | **ре-ревью 1:** вторая копия правила возвращена в `useDialogListSource` | пин: `[ 'core/hooks/useDialogListSource.ts' ] to deeply equal []` |
| 19 | **ре-ревью 1:** снят колсайт `useChatList.ts` | `expected undefined to be true` |
| 20 | **ре-ревью 2:** снят `if (!value) continue` | `expected [ 1, 2 ] to deeply equal [ 1 ]` |

Пины владения — зелёные и не ослаблены: `stores/noDuplicateDialogs.test.ts`
(хук в зеркало не пишет; allow-list не расширялся), `stores/noManualOrder.test.ts`
(`dialogIndex()` по-прежнему зовётся ровно в `core/managers/dialogsManager.ts`).

## Прогон

```
npx vitest run --reporter=dot   → Test Files 267 passed (267)
                                  Tests 1900 passed | 2 skipped (1902)
npx tsc --noEmit                → чисто
npm run lint                    → без предупреждений в тронутых файлах
```

## В бэклог этапа (не чинил — вне периметра брифа)

- **M8: любой `refresh()` глушит пагинацию до конца сеанса.** `doRefresh()`
  поднимает `loadedAll`, после чего `getDialogs` отвечает только из памяти.
  Значит тёплый релогин (`useAppBootstrap`, ветка без префетча), кадр
  `rt:resync` (`refetchSubscriber`), deep-links и десяток других колсайтов
  по-прежнему переводят вкладку в режим «весь список одним куском». Правка —
  в `core/managers/dialogsManager.ts` (этап 2), бриф Task 6 её трогать запрещал.
- Замена второго `fillMirror()` на `getSnapshot()` (см. выше).

## Замечания для Task 7

- `DIALOG_LOAD_COUNT`/`guessLoadCount` импортировать из
  `core/dialogs/loadCount.ts`.
- Сигнатура: `useDialogListSource(filterId, chats)`; `chats` брать из
  `Sidebar.tsx:95` (`useChatList()`), не звать хук повторно в каждом списке.
- `requestItemForIdx(idx, itemsLength?)` — `itemsLength` опционален
  (`base.ts:63`), чтобы работал `requestItemForIdx(0)` из `onChatsScroll`.
- `src/components/virtual/*` не трогал (параллельная задача).
