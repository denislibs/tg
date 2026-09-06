# Подпись автора поста (`.time-post-author`) — нет ни узла, ни поля на проводе

**Статус:** открыт, долг назван (не закрыт кодом). ЗАБЛОКИРОВАН БЭКЕНДОМ —
см. «Чего нет на проводе».
**Дата фиксации:** 2026-09-06, ветка `fix/channel-post-classes` (признаки поста
канала на бабле). В саму задачу подпись автора не входила.
**Контекст:** `components/chat/messageTime.ts` — кластер `span.time`.

## Что в tweb

Между просмотрами и «edited» в кластер времени встаёт подпись автора поста
(`MessageRender.setTime`, `src/components/chat/messageRender.ts:288-295`):

```ts
const postAuthor = options.chat.getPostAuthor(message);
if(postAuthor) {
  const span = document.createElement('span');
  span.classList.add('time-post-author');
  setInnerHTML(span, wrapEmojiText(postAuthor));
  span.insertAdjacentHTML('beforeend', '<span class="time-post-author-comma">,' + NBSP + '</span>');
  args.push(span);
}
```

Источник значения — `Chat.getPostAuthor` (`src/components/chat/chat.ts:1418-1435`):

```ts
getPostAuthor(message) {
  if(this.isLikeGroup) return;                   // :1419-1421 — в группе подписи нет
  const fwdFrom = message.fwd_from;
  const isPost = !!(message.pFlags.post || (fwdFrom?.post_author && !this.isOutMessage(message)));
  if(!isPost) return;
  return message.post_author || fwdFrom?.post_author;   // :1434
}
```

То есть подпись показывается ТОЛЬКО у поста вещательного канала (не
`isLikeGroup`) и берётся либо из самого сообщения (`post_author`), либо из шапки
пересылки (`fwd_from.post_author`).

CSS уже есть: `styles/tweb/_chatBubble.scss` — `.time-post-author` и
`.time-post-author-comma` (построчная копия tweb `_chatBubble.scss:1713-1860`).

## Чего нет на проводе (главное)

**Поля `post_author` у нас нет вовсе** — ни в `Message`
(`web-client/src/core/models.ts`, конструктор `message`), ни в
`MessageFwdHeader` (`models.ts:515-523`), ни на бэкенде
(`backend/internal/domain/mtmessage.go` — счётчики поста ставит
`PostCounters`, подписи среди них нет). Значит долг НЕ фронтовый в одиночку:
пока сервер не начнёт отдавать подпись, рисовать нечего, и любая «реализация»
свелась бы к выдумке значения.

Смежно отсутствует и `signature_profiles` в рендере (флаг у карточки канала
есть, но `isLikeGroup` из него не выводится) — а именно он у оригинала
переключает канал между «подпись строкой» и «имя+аватарка автора».
См. `docs/tweb/channels.md`, таблица бабла.

## Что делать

1. **Бэкенд:** завести подпись автора поста в модели сообщения
   (`domain/mtmessage.go`) и отдавать её тем же ключом схемы — `post_author`.
   Источник значения — тот, кто опубликовал пост от лица канала.
2. **Фронт, модель:** добавить `post_author?: string` в `Message` и
   `MessageFwdHeader` (`core/models.ts`), сверить со схемой в
   `core/messages/message.schema.test.ts`.
3. **Фронт, рендер:** портировать `getPostAuthor` (гейт `isLikeGroup` +
   `pFlags.post`) и узел `.time-post-author` с вложенной запятой
   (`messageRender.ts:288-295`) в `components/chat/messageTime.ts` — в ТОМ ЖЕ
   месте порядка частей: после просмотров, до «edited».

**Критерий готовности:** у поста канала с подписью в `.time` стоит
`span.time-post-author` с вложенным `span.time-post-author-comma`, а в
мегагруппе того же сообщения подписи нет; тест пинует обе половины гейта.
