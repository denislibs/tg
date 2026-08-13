# Этап 2: пагинация диалогов (бэкенд + воркер)

**Дата:** 2026-08-13
**Статус:** дизайн согласован
**Родительская спека:** [`2026-08-12-dialogs-ownership-and-virtual-list-design.md`](2026-08-12-dialogs-ownership-and-virtual-list-design.md) (этап 2 её дорожной карты)
**Референс:** `~/Documents/tweb`

## Задача

Дать этапу 3 (виртуальный список) три вещи, без которых скелетонам нечего
показывать:

1. `count` — сколько всего диалогов в списке (высота `ul`, число скелетонов);
2. страницу по курсору — «дай `limit` штук после вот этой позиции»;
3. `isEnd` — достигнут ли конец.

Контракт — 1:1 с tweb: `dialogsStorage.getDialogs({offsetIndex, limit, filterId})`
возвращает `{dialogs, count, isEnd}` (`lib/storages/dialogs.ts:1596-1754`),
над ним крутится `SequentialCursorFetcher` (`helpers/sequentialCursorFetcher.ts`).

## Как это устроено в tweb (референс)

### `getDialogs` — три ветки (`dialogs.ts:1691-1753`)

```ts
let offset = 0;
if(offsetIndex > 0) {
  for(const length = curDialogStorage.length; offset < length; ++offset) {
    if(offsetIndex > this.getDialogIndex(curDialogStorage[offset], indexKey)) break;
  }
}

const loadedAll = this.isDialogsLoaded(realFolderId);
const isEnoughDialogs = curDialogStorage.length >= (offset + limit);
if(query || loadedAll || isEnoughDialogs || forceLocal) {
  const dialogs = curDialogStorage.slice(offset, offset + limit);
  return {
    dialogs,
    count: loadedAll ? curDialogStorage.length : this.getFolder(filterId).count,
    isEnd: (query || loadedAll) && (offset + limit) >= curDialogStorage.length
  };
}
return this.appMessagesManager.getTopMessages({limit, folderId: realFolderId})
  .then(() => { /* пересчитать offset, снова нарезать */ });
```

Ключевое:
- **курсор — значение, а не позиция.** `offsetIndex` — это `dialogIndex` последнего
  полученного диалога; `offset` вычисляется линейным поиском по кэшу. Список
  может переехать между запросами — курсор не сломается.
- **`count` до полной загрузки берётся у сервера** (`folder.count`), после —
  это просто длина кэша.
- **сеть дёргается только при нехватке**; попадание в кэш отвечает синхронно.
- фильтр папки применяется ЛОКАЛЬНО: `curDialogStorage = getFolderDialogs(filterId)`.

### `SequentialCursorFetcher` (`helpers/sequentialCursorFetcher.ts`, 74 строки)

Сериализует конкурентные запросы страниц: `fetchUntil(neededCount, currentCount?)`
поднимает планку, `triggerFetching()` не пускает второй заход, пока крутится
первый, цикл `while(fetched < needed || needToFetchMore)` тянет страницы, пока
не хватит или пока страница не придёт пустой. Курсор `T` хранится внутри и
обновляется ответом фетчера.

Потребитель (`autonomousDialogList/base.ts:63-77, 247-299`):
- `requestItemForIdx(idx, len)` → `fetchUntil(idx + 1, len)` — виртуальный список
  просит элемент под пустой индекс;
- `onListShrinked()` — после обрезки списка курсор откатывается на последний
  оставшийся элемент, текущий запрос реджектится;
- новый курсор = `min(dialogIndex)` по полученной пачке (`base.ts:274-277`);
- первый ответ может прийти с `count: null` → через 500 мс повторный запрос
  ради настоящего total (`base.ts:255-272`).

Размер страницы считает потребитель: `guessLoadCount() = max(windowHeight/64*1.25, 20)`
(`base.ts:216-219`). Это **не** часть этого этапа — лимит приезжает аргументом.

## Наше состояние (после этапа 1)

| Что | Где | Статус |
|---|---|---|
| Выдача чатов | `GET /chats` без параметров → `{chats: [...]}` | весь список одним куском, ни `count`, ни `is_end` |
| SQL | `chatsrepo.go:188-227` | `ORDER BY m.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST`, без `LIMIT`, без тайбрейка |
| Redis-кэш | `dialogscache.go` | ключ `dialogs:<userID>`, TTL 15 с, значение — весь `[]domain.Dialog` |
| Владелец списка | `core/managers/dialogsManager.ts` (воркер) | `refresh()` бьёт в `/chats` и делает `reset` на весь список |
| Курсор/`totalCount` | — | нет |
| `DialogOp.upsert` | `core/dialogs/dialogOps.ts` | тип заведён, зеркало умеет, владелец не производит |
| Фильтр папки | `core/folderFilter.ts` (main), принимает `Chat` | на main, воркеру недоступен |
| Определения папок | `AppState.folders` | воркер уже зеркалит `pinnedOrders`/`drafts` тем же механизмом |
| Контакты | `foldersStore.contactIds` (UI-стейт) | в воркер не попадают |
| `SequentialCursorFetcher` | — | нет, довозим вендором |

## Решение

### Бэкенд: курсор поверх материализованного порядка

**Что НЕ делаем и почему.** Настоящий keyset по `(pinned_at, lm.created_at, c.id)`
здесь не окупается: `lm.created_at` — результат `LEFT JOIN LATERAL`, индексировать
его нечем, поэтому Postgres всё равно посчитает последнее сообщение для каждой
строки пользователя, чтобы отсортировать. `LIMIT` срежет только объём выдачи, а
не работу. Настоящий выигрыш дала бы денормализация (`chat_members.last_message_at`
+ составной индекс, поддержка на отправке/удалении/очистке) — это отдельная
задача, в этот этап не входит; здесь пагинация решает контракт, а не
производительность. Это записано явно, чтобы никто не считал, что тяжёлый
запрос уже разобран.

**Что делаем.**

1. **Тайбрейк в `ORDER BY`.** `chatsrepo.go` получает третий ключ `c.id DESC`:
   ```sql
   ORDER BY m.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST, c.id DESC
   ```
   Без него порядок двух диалогов с одинаковым `created_at` (или двух пустых)
   не определён — курсор по такому порядку невоспроизводим. Для существующего
   непагинированного пути это чистое улучшение: выдача становится
   детерминированной.

2. **Курсор — `offset_chat_id`.** Порядок уже материализован (полный список из
   БД или из кэша), поэтому «страница после чата X» находится точно: ищем X в
   упорядоченном списке, отдаём следующие `limit`. Курсор — значение, а не
   позиция: список может переехать между запросами.

   Если `offset_chat_id` в списке не нашёлся (чат удалён/уехал в архив) —
   отдаём с начала. Клиент сливает страницы по `chatId`, поэтому худшее
   последствие — повторная страница, а не дыра. Это осознанный размен на
   отсутствие сортировочного ключа в выдаче; отступление от tweb, где курсор —
   само значение `dialogIndex` и живёт без привязки к существованию диалога.

3. **Ответ всегда несёт метаданные:**
   ```json
   { "chats": [...], "count": 137, "is_end": false }
   ```
   `count` — размер полного отфильтрованного набора, `is_end` — «дальше пусто».
   Без параметра `limit` поведение прежнее: весь список, `count = len`,
   `is_end = true`. Добавление ключей обратно совместимо — старый клиент их
   игнорирует.

4. **Кэш не меняется.** Единица кэширования — по-прежнему полный список
   (`ListDialogs`), нарезка идёт после чтения кэша. Пагинация не плодит
   кэш-ключей и не трогает TTL/инвалидацию.

**Слои:**

```go
// domain/chat.go
type DialogPage struct {
    Limit        int   // 0 = без пагинации (весь список)
    OffsetChatID int64 // 0 = с начала
}
type DialogPageResult struct {
    Dialogs []Dialog
    Count   int
    IsEnd   bool
}

// usecase/chat/chat.go
func (i *Interactor) ListDialogsPage(ctx context.Context, userID int64, p domain.DialogPage) (domain.DialogPageResult, error)

// usecase/chat/dialogpage.go — чистая функция, ядро логики
func sliceDialogPage(all []domain.Dialog, p domain.DialogPage) domain.DialogPageResult
```

`ListDialogs` остаётся как есть (его зовут кэш и другие места); `ListDialogsPage`
надстраивается над ним. Ядро — чистая `sliceDialogPage`, тестируется без БД и
Redis.

### Воркер: `getDialogs` — порт `dialogs.ts:1691-1753`

```ts
type DialogsPage = { dialogs: Dialog[]; count: number; isEnd: boolean }

getDialogs(options?: {
  offsetIndex?: number   // dialogIndex последнего полученного; 0/undefined — сверху
  limit?: number         // по умолчанию 20
  filterId?: number      // ALL_FOLDER_ID | ARCHIVE_FOLDER_ID | id папки
}): Promise<DialogsPage>
```

Алгоритм — тот же, что в tweb:

1. `cur` = элементы кэша, прошедшие фильтр `filterId` (порядок сохранён);
2. `offset` — линейный поиск первого элемента с `index < offsetIndex`;
3. `loadedAll` — флаг владельца: последний сетевой ответ пришёл с `isEnd`;
4. `isEnoughDialogs = cur.length >= offset + limit`;
5. хватает (или `loadedAll`) → нарезаем локально, возвращаем
   `{dialogs: cur.slice(offset, offset+limit), count: loadedAll ? cur.length : serverCount, isEnd: loadedAll && offset+limit >= cur.length}`;
6. не хватает → сеть за следующей страницей → слить в кэш → пересчитать `offset`
   → нарезать.

**Сеть.** `fetchPage({limit, offsetChatId})` → `GET /chats?limit&offset_chat_id`.
Курсор для сети — `chatId` последнего элемента кэша (а не `offsetIndex`): у
сервера своего понятия `dialogIndex` нет.

**Слияние страницы.** Новые диалоги дописываются в кэш, уже известные
обновляются на месте; публикуется `DialogOp.upsert` — тип для этого и заведён
на этапе 1. `reset` остаётся за `refresh()` и гидрацией.

**`serverCount`.** Владелец запоминает `count` из последнего ответа. До первой
сетевой страницы (холодный кэш из IDB) `count` неизвестен — отдаём длину кэша;
tweb в этом месте отдаёт `count: null` и потребитель через 500 мс перезапрашивает
(`base.ts:255-272`). Мы отдаём длину кэша: это не хуже (список ровно такой
высоты, какой у нас есть данных), а перезапрос по таймеру — механика этапа 3.

### Фильтр папки переезжает в воркер

`matchesFolder` сейчас принимает `Chat` (вью-модель main) и живёт на main. В
воркере есть `Dialog`. Чтобы не заводить вторую реализацию правил папок
(расхождение здесь = чаты в разных папках на разных экранах), функция
обобщается до структурного типа по фактически используемым полям:

```ts
// core/folderFilter.ts
export type FolderMatchable = {
  chatId: number
  type: 'private' | 'group' | 'channel' | string
  unread?: number | null
  muted?: boolean
  peerId?: number | null
}
export function matchesFolder(item: FolderMatchable, folder: Folder, contactIds: ReadonlySet<number>): boolean
```

`Chat` и `Dialog` оба ей удовлетворяют через тонкие адаптеры на местах вызова.
Реализация одна — пинится тестом «правила папок описаны ровно в одном файле».

Воркеру нужны два входа:
- **определения папок** — `AppState.folders`, тем же каналом `setStateKey`,
  которым уже приезжают `pinnedOrders` и `drafts`;
- **контакты** — сейчас живут в UI-стейте `foldersStore.contactIds`. Владелец
  получает их отдельным сеттером `setContactIds(ids)`, который зовёт тот же
  код, что уже наполняет стор (`loadFolders`). Отдельного владения контактами
  этот этап не заводит — это задел, а не переезд.

Если папка воркеру неизвестна (ещё не приехала) — `getDialogs` для неё
отдаёт пустую страницу с `isEnd: false`, а не весь список: показать не тот
список хуже, чем показать скелетоны.

### Хвост из этапа 1: `syncPinnedOrder`

Сейчас порядок закреплённых выводится из ПОЛНОГО списка. С пагинацией первая
частичная страница «не увидит» остальные пины и затрёт их порядок. Правило
становится: `syncPinnedOrder` вызывается только на `reset`, полученном при
`loadedAll` (полный список), и никогда — при слиянии страницы. Пинится тестом.

## Отступления от tweb (осознанные)

1. **Курсор к серверу — `chatId`, а не значение сортировочного ключа.** Причина:
   у нашего бэкенда нет понятия `dialogIndex`, а `pinned_at`/`last_at` в выдаче
   не полны (есть `Pinned bool`, нет ранга пина). Последствие — при исчезновении
   опорного чата страница переигрывается с начала; клиент сливает по `chatId`,
   дыры не будет. Внутри воркера курсор остаётся значением (`offsetIndex`), как
   в tweb.
2. **Пагинация не разгружает БД.** У tweb за `getTopMessages` стоит MTProto с
   настоящим keyset. У нас тяжёлая часть (`LATERAL` на каждый диалог) остаётся;
   этап решает контракт. Денормализация `last_message_at` — отдельная задача.
3. **`count` при холодном кэше — длина кэша, а не `null`.** У tweb `null`
   лечится перезапросом через 500 мс; у нас первая же сетевая страница приносит
   настоящий `count`, а до неё показывать «столько, сколько есть» честнее, чем
   скелетоны неизвестной длины.

## Тесты

Норма прежняя: строка проводки без теста, чья мутация краснеет, — нарушение.

**Бэкенд:**
- `usecase/chat/dialogpage_test.go` — чистая `sliceDialogPage`: первая страница;
  страница по курсору; курсор на последнем элементе → пустая страница + `is_end`;
  неизвестный `offset_chat_id` → с начала; `limit=0` → весь список, `is_end`;
  `limit` больше остатка → `is_end` в той же странице; `count` не зависит от
  `limit` и курсора.
- `adapter/repo/postgres` — детерминированность порядка: два диалога с
  одинаковым `lm.created_at` (и два без сообщений) выдаются в стабильном
  порядке между повторными запросами; тайбрейк по `c.id` соблюдён.
- `adapter/delivery/http/chat_handler_test.go` — `GET /chats?limit=1` отдаёт один
  чат + `count`/`is_end`; проход по курсору собирает весь список без дублей и
  пропусков; `GET /chats` без параметров — прежняя форма плюс `count`/`is_end`.

**Фронт:**
- `core/managers/dialogsManager.pagination.test.ts` — попадание в кэш не ходит в
  сеть; нехватка → ровно один сетевой запрос; `offsetIndex` двигает окно;
  `isEnd`/`count`; повторная страница не плодит дублей; слияние публикует
  `upsert`, а не `reset`.
- `helpers/sequentialCursorFetcher.test.ts` — сериализация конкурентных
  `fetchUntil`; пустая страница останавливает цикл; `setCursor`/`setFetchedItemsCount`
  после shrink; `reset`.
- `core/folderFilter.test.ts` — одна реализация правил на `Chat` и на `Dialog`
  даёт одинаковый ответ на одинаковых данных; скан: правила папок описаны в
  одном файле.
- `core/managers/dialogsManager.folders.test.ts` — фильтрация по `filterId` в
  воркере; неизвестная папка → пустая страница, а не весь список.
- Регрессия этапа 1: `syncPinnedOrder` не вызывается на слиянии страницы.

**Переориентируются:** тесты `refresh()` (ответ теперь несёт `count`/`is_end`).

## Критерии приёмки

Этап 2 не меняет внешний вид списка: UI по-прежнему запрашивает всё и рисует
всё. Проверяемо:

1. `npm test`, `npm run typecheck`, `npm run lint`, `go build ./...`, `go test ./...`
   — с приведённым выводом. (Известный красный до наших правок:
   `TestWS_RevokeClosesSocket` в `adapter/delivery/ws` — падает на чистом `main`,
   этим этапом не чинится.)
2. `GET /chats` без параметров возвращает прежний список — ни порядок, ни состав
   не изменились; добавились `count`/`is_end`.
3. Проход курсором по страницам собирает ровно тот же набор `chat_id`, что и
   выдача без параметров, в том же порядке.
4. `dialogsManager.getDialogs()` с пустым `offsetIndex` и `limit >= размера`
   отдаёт то же, что `getSnapshot()`.
5. Список чатов в UI не изменился: порядок, пины, папки, архив.
