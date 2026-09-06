# Ванильная лента не рисует контакт, гео, розыгрыш и чек-лист — бабл нулевой высоты

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** 2026-09-06, ветка `feat/poll-message-content`. Найден вместе
с тем же дефектом у ОПРОСА; опрос закрыт этой веткой, остальные четыре вида —
нет.
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
| контакт | `contact` | `messageMediaContact` |
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

1. **Контакт** (самая дешёвая: чистая вёрстка, данные едут во вложении). Нужен
   `avatarNew`-эквивалент на 54 px — у нас аватарка ленты уже есть.
2. **Чек-лист.** Бэкенд его умеет (`backend/internal/usecase/chat/checklist.go`,
   `domain/mttodo.go`, `ChecklistInfo.ToMedia`), фронтовые типы есть
   (`messageMediaToDo`). Работа — только рендер + отметка пунктов.
3. **Гео / venue.** Нужен `wrapGeo` и провайдер карты — у нас его нет вовсе;
   решить, чем рисуем статическую карту, до вёрстки.
4. **Розыгрыш.** Самый тяжёлый: у tweb это отдельный Solid-компонент с призами,
   счётчиком и кнопкой участия.

Ни один из четырёх не должен чиниться «заглушкой, лишь бы высота была»:
пустая коробка и коробка с неверной вёрсткой одинаково расходятся с оригиналом.

**Критерий готовности (для каждого):** бабл соответствующего вида имеет
ненулевую высоту, несёт классы оригинала, время стоит ВНУТРИ бабла, и тест
ленты пинует наличие узла-контента (как `bubbles.poll.test.ts` для опроса).
