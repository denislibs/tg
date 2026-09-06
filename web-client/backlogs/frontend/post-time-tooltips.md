# Тултип времени поста: нет строк «просмотров» и «пересылок»

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** 2026-09-06, ветка `fix/channel-post-classes` (признаки поста
канала на бабле). В саму задачу тултипы не входили.
**Контекст:** `components/chat/messageTime.ts` — `title` узла `.time-inner`.

## Что в tweb

`title` кластера времени собирается по кускам в `MessageRender.setTime`
(`src/components/chat/messageRender.ts:257-283`) и несёт ЧЕТЫРЕ строки, каждая
с новой строки:

```ts
let title = getFullDate(new Date(message.date * 1000));                    // :257
if(isMessage) {
  title += (message.edit_date && !message.pFlags.edit_hide
    ? `\nEdited: ${getFullDate(new Date(message.edit_date * 1000))}` : '')  // :259
    + (fwdFrom ? `\nOriginal: ${getFullDate(...)}` : '');                   // :260
  ...
  if(message.views) {
    title += '\n' + I18n.format('ViewsTooltip', true, [numberThousandSplitter(message.views)]);   // :280
    if(message.forwards) {
      title += '\n' + I18n.format('SharesTooltip', true, [numberThousandSplitter(message.forwards)]); // :282
    }
  }
}
```

Важно: числа в тултипе ПОЛНЫЕ (`numberThousandSplitter` — «9 214»), в отличие
от самого счётчика в `.post-views`, который компактный (`formatNumber(views, 1)`
— «9.2K», `:276`). Тултип — единственное место, где вообще видно число
ПЕРЕСЫЛОК: иконки пересылок в `.time` у оригинала нет вовсе (`forwards` больше
нигде не рисуется).

Ключи langPack: `ViewsTooltip`, `SharesTooltip` — оба со счётчиком (plural).

## Чего нет у нас

`messageTime.ts` ставит `title` одной строкой — только полная дата
(`inner.title = fullDate(message.date)`). Нет ни `Edited:`/`Original:`, ни
строк просмотров и пересылок. Поле `forwards` при этом на проводе ЕСТЬ и
доезжает до модели (`core/models.ts`, пара `views`/`forwards`
из `domain.MessageReal.PostCounters`) — оно просто нигде не читается.

## Что делать

1. Завести ключи `ViewsTooltip` и `SharesTooltip` в словарях (`lib/lang*`), с
   plural-формами — как у оригинала.
2. В `messageTime.ts` собрать `title` теми же кусками и в том же порядке
   (`messageRender.ts:257-283`): полная дата → `Edited:` → `Original:` →
   просмотры → пересылки. Числа — полные, через разделитель тысяч, не через
   `fmtViews`.
3. Помнить про ДВА узла: `title` в оригинале уезжает на `.time-inner`
   (`:344-392`), и у нас так же — второй сборкой частей.

**Критерий готовности:** у поста канала с `views` и `forwards` в `title`
`.time-inner` четыре строки; тест на `messageTime` проверяет, что числа в
тултипе полные, а в `.post-views` — компактные (то есть форматы не перепутаны).

## Смежное

Иконки глаза (`Icon('channelviews', 'time-icon', 'time-part',
'time-icon-views')`, `messageRender.ts:278`) у нас тоже нет — счётчик стоит
голым числом. Она из того же блока и правится тем же заходом.
