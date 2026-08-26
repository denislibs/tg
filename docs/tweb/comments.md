# tweb: каналы и комментарии — живой DOM + логика

Снято 2026-08-13 с **боевого** `web.telegram.org/k` (канал `#-2797275107`, группа обсуждения
`#-2688959007`) через расширение Chrome; логика сверена с исходниками tweb
(`/Users/denisurevic/Documents/tweb`, `e52b5d931`).

Дампы: `tweb-dom/19-ch-*.json` (канал) и `tweb-dom/20-cm-*.json` (комментарии).
Формат тот же, что у прежних дампов (`tag.class1.class2 [attr="v"] "текст"`, отступ 2 пробела
на уровень), поэтому они разбираются `scripts/domdiff/parseDump.js` наравне с остальными.

## Как снималось и что вырезано

Клиент под настоящим аккаунтом → **режим только чтение**: навигация, открытие треда,
открытие правого сайдбара, открытие меню. Ничего не отправлялось и не менялось.
Дамп собирает **структуру, а не содержимое**:

- текст сообщений, имена пиров (`peer-title`), подписи и превью в дамп **не попадают**
  (`.message`, `.peer-title`, `.dialog-subtitle`, `.name`, `.reply-*`, `.quote-text`, … вырезаются);
- берётся текст UI-узлов: `i18n`, `tgico`, `row-title`, лейблы кнопок, `time`/`post-views`;
- `href`/`src`/`title`/`alt`/`data-peer-id` → `"X"`, `style` → только список свойств;
- подряд идущие однотипные соседи схлопнуты: первые 3, дальше `… ещё N таких же`.

Технически дамп уезжал на диск POST-ом на локальный приёмник `127.0.0.1:45671`
(вывод js-инструмента режется на ~1.2 КБ); приёмник одноразовый, в репозиторий не входит.
Cross-origin `fetch` из вкладки tweb в этот раз **не блокируется** SW — iframe-костыль
из августовской сессии не понадобился.

---

## 1. Канал: колонка чата — `19-ch-01-column-center.json`

```text
div.tabs-tab.main-column#column-center
  div.chats-container.tabs-container [data-animation="navigation"]
    div.chat.tabs-tab.active.can-click-date [data-type="chat"]
      div.sidebar-header.topbar.has-avatar [data-floating="1"]   ← has-avatar есть у канала
        div.chat-info-container
          button.btn-icon.sidebar-close-button > span.tgico + span.badge.back-unread-badge "1"
          div.chat-info > div.person
            div.avatar.avatar-40.person-avatar
            div.content > div.top > .user-title > span.peer-title
                        > div.bottom > .info > span.i18n "4 652 subscribers"
          div.chat-utils > 6 × button.btn-icon.rp (часть с .hide)
      div.topbar-floating-plates
        div.pinned-container.pinned-message [data-mid]      ← закреп канала
        div.pinned-container.pinned-requests.hide
        div.pinned-container.pinned-actions.hide
        … pinned-automation / pinned-live / pinned-group-call / pinned-translation
          / pinned-remove-fee / pinned-sponsored (все .hide)
      div.bubbles.scrolled-down.has-groups.has-sticky-dates
      div.bubbles-viewport.disable-hover
      div.chat-input.chat-input-main
```

Нижняя панель подписчика (`19-ch-04-bottom.json`): **инпут остаётся в DOM** (плейсхолдер
`Broadcast`), поверх него — `div.chat-input-control.chat-input-wrapper` с пачкой
взаимоисключающих кнопок, все кроме одной `.hide`:

```text
div.chat-input-control.chat-input-wrapper
  button.btn-primary.btn-transparent.text-bold.chat-input-control-button.chat-input-plate-button.rp.hide "START"
  … "Unblock" (.hide)
  button…btn-color-primary… "JOIN" (.hide)
  button…btn-transparent… "Mute"           ← активная для подписанного канала
  … "Hide Pinned Messages" (.hide), "Open Chat" (.hide)
```

То есть «Mute / JOIN / Unblock / Open Chat» — не разные компоненты, а один ряд
`chat-input-control-button`, где видимость раздаётся классом `hide`.

## 2. Пост канала — `19-ch-02-post-album.json`

Классы бабла поста-альбома с комментариями:

```text
div.bubble.channel-post.with-beside-button.with-replies.hide-name.photo
        .is-album.is-grouped.is-in.can-have-tail.is-group-first.is-group-last
   [data-mid data-peer-id data-timestamp data-text-mid style="--peer-color-rgb …"]
```

- `channel-post` ставится **по наличию `message.views`** (`bubbles.ts:7673`), а не по типу пира;
- `with-beside-button` — есть круглая кнопка «переслать» сбоку;
- `with-replies` — есть футер комментариев;
- `hide-name` — у канала имя автора в бабле не рисуется.

Порядок детей `.bubble-content` (важен, у нас порядок другой):

```text
div.bubble-content [style="max-width"]
  div.attachment.no-brb                     ← сетка альбома: .album-item.grouped-item × N
  div.message.spoilers-container.mt-shorter
    span.translatable-message               ← текст + a.anchor-url / a.mention / a.anchor-hashtag
    span.clearfix
    reactions-element.reactions.reactions-block.reactions-like-block
      reaction-element.reaction.reaction-block.reaction-like-block × N (последний .is-last)
      span.time                             ← ВРЕМЯ ЛЕЖИТ ВНУТРИ reactions-element
        i.time-edited.time-part.i18n
        span.post-views                     ← «438»
        span.tgico.time-icon.time-part.time-icon-views
        span.i18n [dir="auto"]              ← «19:25»
        div.time-inner [title]              ← дубль содержимого для floating-варианта
  div.bubble-beside-button.with-hover.forward > span.tgico
  replies-element.is-unread.replies.replies-footer [data-post-key]
  svg.bubble-tail > use
```

`span.time` собирается в `messageRender.ts:250-320`: `.post-views` (formatNumber, 1 знак) +
иконка `channelviews`, затем `.time-post-author` (подпись автора поста, если есть,
с `<span class="time-post-author-comma">, </span>`), `i.time-edited` перед ними,
`title` тултипа получает `ViewsTooltip`/`SharesTooltip` с полными числами.

## 3. Футер комментариев `replies-element` — `19-ch-02` + `19-ch-05-computed.json`

```text
replies-element.is-unread.replies.replies-footer [data-post-key="peerId_mid"]
  div.stacked-avatars.replies-footer-avatars [style="--avatar-size"]
    div.stacked-avatars-avatar-container.is-first
      div.avatar.avatar-30.stacked-avatars-avatar
    div.stacked-avatars-avatar-container
    div.stacked-avatars-avatar-container.is-last
  span.replies-footer-text > span.i18n "8 Comments"
  span.tgico.replies-footer-icon.replies-footer-icon-next
  div.rp > div.c-ripple                     ← ripple-контейнер ПОСЛЕДНИМ ребёнком
```

Геометрия (computed, светлая тема): высота `49px` (3.0625rem), `min-width: 240px`,
`padding: 0 8px`, `border-top: 1px solid var(--border-color)`,
`border-radius: 0 0 15px` (наследует нижние углы бабла), `color: var(--primary-color)`.
Текст — `15px/18px`, `font-weight: 500`, `margin-inline-start: 8px`.
Стрелка — `position: absolute; inset-inline-end: 3px; 24px`. Стек аватарок — 30px,
`--margin-right: -.875rem`, `--border-size: 2px`. `.bubble-beside-button.forward` —
`38×38`, круг, `inset-inline-end: -46px`.

Логика (`components/chat/replies.ts`, кастомный элемент `replies-element`):

| Условие | Что рисуется |
|---|---|
| `replies.recent_repliers` есть | `StackedAvatars` (30px) слева |
| их нет | иконка `comments` (`replies-footer-icon-comments`, `margin-inline: .125rem .375rem`) |
| `replies.replies > 0` | ключ `Comments` → `%1$d Comment/Comments` |
| `replies.replies === 0` | ключ `LeaveAComment` → «Leave a comment» |
| `replies` нет вовсе (чат Replies) | ключ `ViewInChat` → «View in chat» |
| `read_max_id < max_id` | класс `is-unread` → синяя точка 8px после текста (`:after`) |

Вариант **beside** (для стикеров/emoji-big/round-видео, `type === 'beside'`):
`replies-element.bubble-beside-button` с `Icon('commentssticker')` и
`span.replies-beside-text` (число через `formatNumber`), колонка 36px, `right: -44px`,
`bottom: 47px`; баблу добавляется класс `with-beside-replies`.

Когда футер вообще есть (`bubbles.ts:7766`):

```ts
canHaveCommentReplies = peerId === REPLIES_PEER_ID || !!message.replies || !!message.grouped_id
messageWithReplies    = getMessageWithCommentReplies(message)  // у альбома — главное сообщение группы
withReplies           = !!messageWithReplies && message.mid > 0
```

`getMessageWithCommentReplies` (appMessagesManager.ts:9237) требует
`replies.pFlags.comments` и `replies.channel_id !== REPLIES_HIDDEN_CHANNEL_ID`.
Для альбома `replies` живут на **одном** сообщении группы — футер рисуется один на альбом.

Актуализация: при первом рендере `replies.ts` дёргает
`subscribeRepliesThread(peerId, mid)` + `updateMessage(..., 'replies_updated')`;
глобальный слушатель `replies_updated` (replies.ts:17) находит все
`replies-element[data-post-key="peerId_mid"]` и перерисовывает их. `subscribeRepliesThread`
— это просто `getDiscussionMessage`, который заполняет `threadsToReplies` и
`historyStorage` треда (readMaxId/maxId), т.е. счётчик и точка непрочитанного
приезжают тем же запросом, что нужен для открытия треда.

Просмотры: `IntersectionObserver` (`viewsObserverCallback`) при первом появлении бабла
во вьюпорте кладёт mid в `viewsMids`, дебаунс 1000 мс → `incrementMessageViews` →
`messages.getMessagesViews {increment: true}` → локальный `updateChannelMessageViews`.

## 4. Переход в комментарии — клик и ссылки

**Клик по футеру** (`bubbles.ts:3315`, `onBubblesClick`, поиск `findUpClassName(target, 'replies')`):

```ts
const message = await getMessageWithReplies(bubbleMessage)     // главное сообщение альбома
const replies = message.replies
getDiscussionMessage(this.peerId, message.mid).then((message) =>
  appImManager.setInnerPeer({
    peerId: replies.channel_id.toPeerId(true),   // ГРУППА обсуждения, не канал
    type: ChatType.Discussion,
    threadId: (message as MyMessage).mid         // mid зеркала поста В ГРУППЕ
  })
)
```

Отдельная ветка для чата `Replies` (`REPLIES_PEER_ID`) — там тред открывается
`openThread({peerId, lastMsgId: fwd_from.saved_from_msg_id, threadId: reply_to_top_id})`.

`messages.getDiscussionMessage` (appMessagesManager.ts:6143) отдаёт зеркало поста в группе;
клиент сохраняет `threadsToReplies[groupPeer_mid] = channelPeer_mid`, заводит
`historyStorage` треда и проставляет `readMaxId`/`readOutboxMaxId`/`maxId`.

**Ссылки.** `wrapRichText` навешивает на якоря глобальные onclick-хендлеры
(`helpers/addAnchorListener.ts`), в живом DOM это видно буквально:

| Якорь | Атрибут | Обработчик |
|---|---|---|
| внешняя ссылка с маскировкой | `a.anchor-url [onclick="showMaskedAlert(this)"]` | подтверждение перед уходом |
| `@username` | `a.mention [onclick="im(this)"]` | `openUsername` |
| `#hashtag` | `a.anchor-hashtag [onclick="searchByHashtag(this)"]` | поиск по хэштегу |

Внутренние `t.me`-ссылки разбирает `internalLinkProcessor.ts`:
`t.me/<domain>/<post>?comment=<id>` → `INTERNAL_LINK_TYPE.MESSAGE` с полями
`post/thread/comment`, приватный вариант — `t.me/c/<channel>/<post>` →
`PRIVATE_POST`. Дальше `appImManager.op()`:

- `threadId` есть → `openThread({peerId, lastMsgId, threadId})` → для не-форума
  `reloadMessage(threadId)` и `setInnerPeer({type: Discussion})`;
- `commentId` есть → `openComment({peerId, msgId, commentId})` →
  `getDiscussionMessage(канал, пост)` → `openThread({peerId: группа, lastMsgId: commentId, threadId: mid зеркала})`.

**Хэш в адресной строке**: при открытии комментариев он становится
`#-2688959007` — **id группы обсуждения без треда**. Тред в URL не кодируется,
т.е. перезагрузка страницы возвращает в группу целиком, а не в тред (проверено живьём).

Обратный переход из канала в группу целиком — пункт меню шапки `ViewDiscussion`
(`topbar.ts:496`): `getChannelFull(channel).linked_chat_id` → `setInnerPeer({peerId: linked})`.

## 5. Вид комментариев — `20-cm-01-column.json`

Колонка треда: `div.chat.tabs-tab.can-click-date.active [data-type="discussion"]`,
топбар **без `has-avatar`**.

```text
div.sidebar-header.topbar [data-floating="1"]        ← has-avatar НЕТ
  div.chat-info-container
    button.btn-icon.sidebar-close-button
      span.tgico + span.badge.badge-20.badge-primary.back-unread-badge "1"
    div.chat-info > div.person
      div.content                                     ← .person-avatar ОТСУТСТВУЕТ
        div.top > .user-title > span.i18n "1 Comment" ← заголовок = счётчик, не имя
        div.bottom > div.info.hide                    ← сабтайтл скрыт классом hide
    div.chat-utils …
```

Заголовок — `messagesCounter({key: 'Chat.Title.Comments'})` (`topbar.ts:1491`):
`%d Comment/%d Comments`, значение берётся из `historyStorage.count` треда
(до загрузки — `Loading`), для форума вычитается 1 (сообщение-родитель).

Меню ⋮ в треде (`20-cm-08-topbar-menu.json`): `Select Messages`, `Send a Gift`, `Boost Group`
— т.е. пункты пира-группы, без «Mute»/«View discussion».

**Плашка закрепа = сам пост** (`20-cm-03-pinned.json`): в Discussion `topbar.ts:1246`
вызывает `newPlate.setStaticMessage(this.chat.threadId)` — обычный
`div.pinned-container.pinned-message.is-media [data-mid=<mid зеркала>]` с
превью медиа (`.pinned-message-media-container`), заголовком `Pinned Message`
и текстом поста в сабтайтле. Кнопка `pinned-message-unpin` в разметке есть.

**Лента треда** (`20-cm-04/05/06`):

```text
div.bubbles-group.bubbles-group-first
  div.bubbles-group-avatar-container                       ← аватар канала слева
  div.bubble.channel-post.hide-name.photo.is-album.is-grouped.with-beside-button
       .is-in.can-have-tail.is-group-first.is-group-last
       [data-mid data-saved-from="-2797275107_4294969806"] ← ссылка на оригинал в канале
div.bubbles-group
  div.bubble.service.is-group-last.is-group-first [data-mid="4294972906.0001"]
    div.bubble-content > div.service-msg > span.i18n "Discussion started"
div.bubbles-group.bubbles-group-last
  div.bubbles-group-avatar-container
  div.bubble.is-in.can-have-tail… [data-reply-to-peer-id data-reply-to-mid=<mid поста>]
    div.bubble-content
      div.colored-name.name.floating-part.next-is-message [data-peer-id]
        span.peer-title
      div.message.spoilers-container
        span.translatable-message
        span.time > span.i18n + div.time-inner
      svg.bubble-tail
```

Детали, которые легко потерять:

- пост внутри треда — тот же `channel-post` (просмотры, реакции, `bubble-beside-button`),
  но **без `replies-element`**: футер комментариев внутри самого треда не рисуется;
- `data-saved-from` даёт кнопку «перейти к оригиналу» (`goto-original`, `bubbles.ts:9665`);
- сервисное «Discussion started» — **локально сгенерированное** сообщение
  (`generateThreadServiceStartMessage`, action `messageActionDiscussionStarted`),
  отсюда дробный `data-mid` (`…906.0001`) — это temp-id, сервер его не присылает;
- у комментария есть `data-reply-to-mid` = mid корня треда, но **блок ответа не рисуется**
  (ответ на корень треда скрывается);
- класс `is-thread-starter` (прячет аватар, убирает отступ) в этом канале **не появился**:
  он ставится, только если `messageWithReplies.mid === chat.threadId`, т.е. когда у зеркала
  поста в группе самого есть `replies` с комментариями.

**Инпут** (`20-cm-07-input.json`): обычный `chat-input-main`, плейсхолдер
`span.input-field-placeholder.i18n "Comment"` — ключ `Comment` выдаётся, когда
`threadId && !isForum && !peerId.isUser()` (`input.ts:2740`). Отправка идёт в группу с
`reply_to.top_msg_id = threadId`.

## 6. Правый сайдбар в комментариях — `20-cm-09-right-sidebar.json`

Клик по шапке треда открывает **профиль группы обсуждения** (не канала):

```text
div#column-right > .sidebar-content.sidebar-slider
  div.tabs-tab.sidebar-slider-item.shared-media-container.profile-container.is-collapsed.can-add-members.active
    div.sidebar-header
      button.btn-icon.sidebar-close-button > div.animated-close-icon
      div.transition.slide-fade
        div.transition-item.active > .sidebar-header__title > span.i18n "Group Info"
        div.transition-item > .sidebar-header__rows                 ← collapsed-состояние
          div.sidebar-header__title > span.peer-title [data-thread-id="4294972898"]
          div.sidebar-header__subtitle > div.transition.slide-fade  ← «25 members» / «0 gifts» / …
    div.sidebar-content > .scrollable.scrollable-y > div.profile-content
      div.profile-avatars-container.is-single …
      div.profile-content-delimiter
      div.sidebar-left-section-container … (Notifications-строка, список участников)
```

Ключевое: `chat.ts:990` — `sharedMediaTab.setPeer(peerId, threadId)`, поэтому
`peer-title` в сайдбаре несёт `data-thread-id` треда, а сам сайдбар — это
обычный `shared-media-container` группы (Group Info + участники + табы медиа).
Отдельного «сайдбара комментариев» в tweb нет.

## 7. Чтение и апдейты треда

- история: `messages.getReplies {peer: группа, msg_id: threadId}` — ветка
  `HistoryType.Thread` в `getHistoryRequest` (appMessagesManager.ts:10010);
- прочтение: `messages.readDiscussion {peer, msg_id: threadId, read_max_id}` +
  локальный `updateReadChannelDiscussionInbox` (appMessagesManager.ts:6431);
- входящие апдейты: `updateReadChannelDiscussionInbox/Outbox` → `onUpdateReadHistory`
  (threadId берётся из `top_msg_id`);
- счётчик комментариев на посте: `updateMessage(..., 'replies_updated')` +
  подписка `subscribeRepliesThread`.

---

## 8. Что у нас сейчас (гэп к tweb)

Наш клиент уже умеет часть этого, но модель другая:

| Тема | tweb | у нас |
|---|---|---|
| Футер поста | `replies-element` внутри `.bubble-content`, порядок `avatars → text → icon → rp` | React-лента — `CommentsBar.tsx`; ВАНИЛЬНАЯ (`components/chat/replies.ts`, порт `replies.ts` + `MessageRender.renderReplies`) — те же классы и порядок, `beside`-вариант ЕСТЬ, стек аватарок есть. Нет `is-unread`-точки (нужны `read_max_id`/`max_id` треда, сервер их не производит) и нет узла `.c-ripple` внутри `div.rp` (ванильного `ripple` в проекте нет); при `count === 0` пишем «Комментарии», а tweb — «Leave a comment» (ключа `LeaveAComment` не заведено) |
| Счётчик ответов в ГРУППЕ | число у времени, `setBubbleRepliesCount` (bubbles.ts:6410-6431), ветка `message.replies && isAnyGroup` (:9698) | портирован — `chat/messageTime.ts::setRepliesCount` + развилка `chat/bubbles.ts::renderMessageReplies`; в React-ленте предмета нет вовсе |
| Данные счётчика | `message.replies` + `replies_updated` + `getDiscussionMessage` | `message.replies` ВНУТРИ сообщения истории (`usecase/chat/messagescontainer.go::hydrateThreads`); отдельной актуализации (`subscribeRepliesThread`, событие `replies_updated`) нет — перерисовку объявляет `message_edit` |
| Открытие треда | `setInnerPeer({peerId: ГРУППА, type: Discussion, threadId: mid зеркала В ГРУППЕ})` | `Chat.tsx::onOpenThread({chatId: discussionChatId, rootMsgId: postId})` — пир группы совпадает, но корень треда = **id поста в канале**, а не id зеркала в группе. Ванильная лента отдаёт ключ группы СНИЗУ, из самого поста (`replies.channel_id` → `toPeerId(id, true)`, как tweb :3335), порт — `BubblesNavigation.openDiscussion`; React-лента берёт его из карточки канала (`useChatInfoCard.discussionPeerId`) |
| Шапка треда | без аватара, title = `N Comments` (счётчик из `historyStorage.count`), сабтайтл `.info.hide` | `Chat.tsx:1301` — `has-avatar`, иконка `comments`, title = статичное «Comments», сабтайтл = имя канала |
| Плашка сверху | `pinned-message` со **статическим** постом | пинов в треде нет (`!thread` гейт) |
| Лента треда | зеркало поста + сервисное «Discussion started» + комментарии как обычные групповые сообщения | только комментарии |
| Правый сайдбар | Group Info **группы обсуждения** с `data-thread-id` | инфо канала |
| Ссылки | `?comment=`/`?thread=` → `openComment`/`openThread` | не разбираются |
| Просмотры | IntersectionObserver + дебаунс 1 с + `getMessagesViews(increment)` | есть счётчик просмотров, инкремент по своей схеме |

Самое структурное расхождение — **что считается корнем треда**. В tweb корень — mid
**зеркала поста в группе обсуждения** (его отдаёт `messages.getDiscussionMessage`), и
именно он идёт в `threadId`, в `getReplies`, в `readDiscussion` и в `reply_to.top_msg_id`.
У нас корень — id поста **в канале**, а сопоставление канал↔группа живёт на бэкенде
(`/channels/{id}/posts/{postId}/comments`). Пока это внутреннее дело бэка, разница
не видна; она вылезет там, где tweb работает с тредом как с обычной историей группы:
плашка-родитель, сервисное «Discussion started», переход к оригиналу (`data-saved-from`),
ссылки `?comment=`, правый сайдбар с `data-thread-id`.

## 9. Где это делать

Ворктри: `.worktrees/channels-comments`, ветка `feat/channels-comments-tweb`
(от `main` = `ed1242a9`).

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Футер `replies-element` на посте: аватарки комментаторов, счётчик, стрелка.
- [ ] Переход в комментарии: колонка треда, шапка, закреплённый сверху пост.
- [ ] Пост в треде, сервисное сообщение «Comments», сам комментарий, инпут ответа.
- [ ] Правый сайдбар внутри треда открывается и не путается с сайдбаром канала.
- [ ] Чтение треда: счётчик комментариев уменьшается, апдейты приходят в открытый тред.
- [ ] Возврат из треда в канал сохраняет позицию ленты канала.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 20-cm-01…09, 19-ch-02-post-album.
