# Ванильная лента не рисует гео, розыгрыш и чек-лист — бабл нулевой высоты

**Статус:** открыт частично. КОНТАКТ закрыт (ветка `fix/visible-cleanup`,
`bubbles.ts::renderContact` + `bubbles.contact.test.ts`); гео, розыгрыш и
чек-лист — по-прежнему пустой бабл.
**Дата фиксации:** 2026-09-06, ветка `feat/poll-message-content`. Найден вместе
с тем же дефектом у ОПРОСА; опрос закрыт `feat/poll-message-content`, контакт —
`fix/visible-cleanup`, остальные три вида — нет.
**Контекст:** `components/chat/bubbles.ts::renderMedia` (`:1301`) →
`core/media/messageMedia.ts::getBubbleMedia` (`:692`).

## Симптом

Сообщение, у которого вложение — не фото и не документ, рисуется баблом
**нулевой высоты**: тела нет вовсе, наружу торчат только абсолютно
спозиционированное время (`span.time`, 12 px) и круглая кнопка «переслать»
(`div.bubble-beside-button.forward`, 38 px). Визуально они садятся на строку
соседнего сообщения — именно так дефект и был замечен на опросе.

## Корень

`renderMedia` выходит на втором шаге:

```ts
const mediaObject = getBubbleMedia(message)
if (!mediaObject) return                      // bubbles.ts:1305-1306
```

`getBubbleMedia` (`core/media/messageMedia.ts:692-694`) по контракту отдаёт
`MyPhoto | MyDocument | undefined` — то есть для любого вложения, которое НЕ
файл, отвечает `undefined`. Под этот гейт попадают:

| Вид | `MessageKind` | конструктор вложения |
|---|---|---|
| гео / venue / live | `geo` | `messageMediaGeo`, `messageMediaGeoLive` |
| розыгрыш | `giveaway` | `messageMediaGiveaway`, `messageMediaGiveawayResults` |
| чек-лист | `checklist` | `messageMediaToDo` |

(`core/messages/messageKind.ts:35-66`.)

Форму бабла им при этом уже назначают — `components/messages/bubbleClasses.ts:89-93`
ставит `contact-message` / `poll-message`, — а время выкладывает
`renderMessageMeta` безусловно (`bubbles.ts:1855`). Отсюда и «пустая коробка с
временем снаружи».

Смежное следствие: `hasMedia` (`bubbleClasses.ts:105-107`) спрашивает тот же
`getBubbleMedia`, поэтому такие сообщения считаются `is-message-empty` — гео там
уже выгорожено отдельным термом (`m.type === 'geo'`), остальные три нет.

## Что в tweb

Все четыре — соседние ветки одного `switch` по `media._`:

| Вид | tweb | Разметка |
|---|---|---|
| Контакт | `bubbles.ts:8706-8755` | `div.message > div.contact[data-peer-id] > avatar(54) + div.contact-details > .contact-name + .contact-number`; класс `contact-message`, `mediaRequiresMessageDiv = true` |
| Гео / venue / live | `bubbles.ts:9045-9099` | класс `photo`; `wrapGeo({attachmentDiv, messageMedia, peerId, date, onLiveExpire})` — `components/wrappers/geo.tsx`; карта в `.attachment`, для venue/live адрес и футер в `.message`, live до истечения прячет `timeSpan` |
| Розыгрыш | `bubbles.ts:9146-9172` | класс `is-giveaway`; Solid-компонент `Giveaway` в контейнер ПЕРЕД `.message` + кнопка |
| Чек-лист | `bubbles.ts:8817-8838` | `ChecklistBubble` в `div.checklist-content`; класс `poll-message` |

Опрос — та же таблица, строка `bubbles.ts:8757-8815` — закрыт веткой
`feat/poll-message-content`; её `renderPoll` показывает и приём монтирования, и
куда встаёт узел (prepend в `.message`).

## Что делать

Четыре независимых задачи, каждая — своя ветка `switch` в `renderMedia`:

~~1. Контакт~~ — СДЕЛАНО (`fix/visible-cleanup`): `renderContact`
   (`components/chat/bubbles.ts`) + ветка клика (профиль по `data-peer-id`,
   иначе копирование номера), стили уже лежали в
   `styles/tweb/_chatBubble.scss:1314-1348`, пин — `bubbles.contact.test.ts`.

1. **Чек-лист.** Бэкенд его умеет (`backend/internal/usecase/chat/checklist.go`,
   `domain/mttodo.go`, `ChecklistInfo.ToMedia`), фронтовые типы есть
   (`messageMediaToDo`). Работа — только рендер + отметка пунктов.
2. **Гео / venue.** Нужен `wrapGeo` и провайдер карты — у нас его нет вовсе;
   решить, чем рисуем статическую карту, до вёрстки.
3. **Розыгрыш.** Самый тяжёлый: у tweb это отдельный Solid-компонент с призами,
   счётчиком и кнопкой участия.

Ни один из четырёх не должен чиниться «заглушкой, лишь бы высота была»:
пустая коробка и коробка с неверной вёрсткой одинаково расходятся с оригиналом.

**Критерий готовности (для каждого):** бабл соответствующего вида имеет
ненулевую высоту, несёт классы оригинала, время стоит ВНУТРИ бабла, и тест
ленты пинует наличие узла-контента (как `bubbles.poll.test.ts` для опроса).

## Честная оценка оставшихся трёх (снята 2026-09-07)

Мерка — уже сделанные соседи по этой же таблице: ОПРОС стоил 630 строк модуля +
382 строки партиала + 452 строки теста; КОНТАКТ — ~80 строк в `bubbles.ts`, 0
строк стилей (партиал уже был портирован целиком) и 230 строк теста.

| Вид | Порядок работы | Чем упирается |
|---|---|---|
| Чек-лист | как ОПРОС (модуль с хендлом + `update` по правке, свой партиал, ручка отметки) | tweb `components/chat/bubbles/checklist.tsx` — 174 строки Solid плюс отметка пунктов; на бэке всё есть (`usecase/chat/checklist.go`, `domain.ChecklistInfo.ToMedia`), на проводе — `messageMediaToDo{todo, completions}` |
| Розыгрыш | больше ОПРОСА | tweb рисует его отдельным Solid-компонентом с призами, счётчиком и кнопкой участия; на бэке есть и вложение (`domain.GiveawayInfo.ToMedia`), и ручки (`POST /channels/{id}/giveaways`, `POST /giveaways/{id}/participate`) — нет только узла |
| Гео / venue / live | БЛОКИРОВАН до решения вне вёрстки | `wrapGeo` оригинала рисует статическую карту через MTProto-прокси Telegram; провайдера карт у нас нет вовсе, и `MessageMediaVenue` честно объявляет, что справочника мест тоже нет (`backend/internal/domain/mtmedia.go:415-425`). Пока не выбран источник картинки карты, вёрстку начинать нечем — «коробка с неверной вёрсткой» здесь так же расходится с оригиналом, как пустая |

Порядок закрытия: чек-лист → розыгрыш → гео (последний — после отдельного
решения про карту).
