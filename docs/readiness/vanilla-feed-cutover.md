# Этап 7: снос React-ленты и `messagesStore` — карта перед работой

Разведка от 2026-08-26, ветка `worktree-chat-vanilla`. Документ отвечает на четыре
вопроса: **что можно удалить**, **что придётся пересадить**, **чего императивной
ленте не хватает до паритета с tweb** и **в каком порядке это делать, чтобы каждый
шаг оставлял приложение рабочим**.

Все утверждения — со ссылкой `файл:строка`. Пути относительно корня репозитория,
если не сказано иное; внутри разделов про фронт — относительно `web-client/`.

**Оговорка про номера строк в `bubbles.ts` и `VanillaFeed.tsx`.** Оба файла были
под правкой другого агента ПРЯМО ВО ВРЕМЯ разведки: `bubbles.ts` вырос с 2770 до
3169 строк, рядом появились неотслеживаемые `chat/contextMenu.ts`,
`components/avatar.ts`, `wrappers/getPeerInitials.ts`. За время работы у него
успели закрыться два пробела из первоначального списка (календарь по клику на дату,
порт `setPeer`); `createAvatar` на момент финальной сверки всё ещё заглушка
(`chat/bubbles.ts:1449-1451`), но `components/avatar.ts` уже лежит рядом —
задача #74, судя по всему, в работе. Поэтому места адресованы **именем метода**
плюс номером на момент снятия; если номер не сошёлся — искать по имени, и
перепроверять §3 перед началом работы.

Референс — tweb: `/Users/denisurevic/Documents/tweb/src/components/chat/bubbles.ts`.
Смежные документы: [`docs/tweb/bubbles.md`](../tweb/bubbles.md),
[`docs/readiness/port-divergences.md`](port-divergences.md).

---

# 1. Границы React-ленты

Развилка одна: `web-client/src/components/Chat.tsx:1410` —
`{AppConfig.vanillaFeed ? (<VanillaFeed …/>) : (<div className="bubbles">…<ChatFeed/>…</div>)}`.
Флаг читается в `web-client/src/config/app.ts:38` (`readVanillaFeed`), по умолчанию
`false` — пин `web-client/src/components/Chat.vanillaFeed.test.ts:69`.

> **ВНИМАНИЕ, ЧИТАТЕЛЮ.** Этот документ — РАЗВЕДКА, снятая до работ, и часть
> его утверждений уже опровергнута проверкой по коду. Найдено четыре ошибки:
> «удаление не доходит до вкладки-инициатора» (§11 ниже, неверно), оптимистика
> созданного опроса как пробел зеркала (неверно — бэк фанит автору тоже),
> `useVoiceQueue` как потребитель вне ленты (неверно — он часть ленты), номер
> строки :2992 у tweb (это канал `content`, а не `media_unread`). Номера строк
> в `useMessageActions.tsx` устарели целиком: адресация переведена с индекса
> ряда на номер сообщения. Сверяйся с кодом, а не с этим файлом.

## 1.1 Компоненты, у которых потребитель — ТОЛЬКО лента (можно сносить)

Проверка — обратный поиск импортов:

```
grep -rn --include='*.ts' --include='*.tsx' -E "from '[^']*(ChatFeed|MessageRow|…)'" src | grep -v '\.test\.'
```

| Файл | Единственный потребитель | Вердикт |
|---|---|---|
| `components/messages/ChatFeed.tsx` (424 стр.) | `Chat.tsx:65` | снести |
| `components/messages/MessageRow.tsx` (312) | `ChatFeed.tsx:18` | снести |
| `components/messages/MessageContent.tsx` (659) | `MessageRow.tsx:24` | снести |
| `components/messages/MessageBubbles.tsx` (10, реэкспорт) | `MessageContent.tsx:31` | снести |
| `components/messages/bubbleParts/{Time,primitives,mediaBubbles,richBubbles}.tsx` | `MessageContent.tsx:22`, `MessageRow.tsx:19`, `MessageBubbles.tsx:8-10` | снести |
| `components/messages/AlbumGrid.tsx` | `MessageContent.tsx:19` | снести |
| `components/messages/RealMediaBubble.tsx` (589) | `MessageContent.tsx:13` | снести |
| `components/messages/SecretMediaBubble.tsx` | `MessageContent.tsx:14` | снести |
| `components/messages/PollBubble.tsx` | `MessageContent.tsx:15` | снести (сначала порт, §3) |
| `components/messages/ChecklistBubble.tsx` | `MessageContent.tsx:16` | снести (сначала порт) |
| `components/messages/GiftBubble.tsx` | `MessageContent.tsx:17` | снести (сначала порт) |
| `components/messages/GiveawayBubble.tsx` | `MessageContent.tsx:18` | снести (сначала порт) |
| `components/messages/VoiceMessage.tsx` | `MessageContent.tsx:20` | снести — у ванили голос идёт `wrapDocument`→`AudioElement` (`chat/bubbles.ts:867`) |
| `components/messages/MessageReactions.tsx` | `MessageContent.tsx:21` | снести — у ванили `chat/reactions.ts` |
| `components/messages/InlineKeyboard.tsx` | `MessageRow.tsx:23` | снести (сначала порт reply-markup) |
| `components/messages/AudioPlayIcon.tsx` | `VoiceMessage.tsx:2`, `RealMediaBubble.tsx:39` | снести вместе с ними |
| `components/messages/Transcription.tsx` | `VoiceMessage.tsx:12`, `bubbleParts/mediaBubbles.tsx:9` | снести (сначала порт кнопки расшифровки) |
| `components/messages/useBlurThumb.ts` | `RealMediaBubble.tsx:24`, `AlbumGrid.tsx:13`, `bubbleParts/richBubbles.tsx:8` | снести вместе с ними |
| `components/messages/ReactionIcon.tsx`, `ReactionAroundEffect.tsx` | `MessageReactions.tsx:9-10` | снести (сначала порт, §3) |
| `components/CommentsBar.tsx` | `ChatFeed.tsx:11` | снести (сначала порт replies-футера) |
| `core/hooks/useConvMessages.ts` | `Chat.tsx:52` | снести — кэш стабильных ссылок под `React.memo` |
| `core/hooks/useDragSelect.ts` | `useChatSelection.ts:7` | снести — у ванили `chat/selection.ts` |
| `core/hooks/useChatStickyDates.ts` + `components/chatStickyDates.ts` | `Chat.tsx:12`/`useChatStickyDates.ts:20` | снести — у ванили свой `StickyIntersector` (`chat/bubbles.ts:2839`) |
| `core/hooks/useChatScroll.ts` | `Chat.tsx:51` | снести — у ванили `loadMoreHistory`/`ScrollSaver`/`scrollToBubble`. **Кроме `markRead`** — см. §3.9 |
| `core/hooks/useFeedReveal.ts` | `Chat.tsx:60` | снести — но лестница и спиннер должны переехать в ленту (§3.10) |
| `components/messages/ChatFeed.module.scss`, `MessageRow.module.scss`, `AlbumGrid.module.scss`, `RealMediaBubble.module.scss`, `bubbleParts/Time.module.scss` | те же файлы | снести |

## 1.2 Живёт в `components/messages/`, но лентой НЕ является — НЕ трогать

| Файл | Кто ещё пользуется |
|---|---|
| `components/messages/ChatDialogs.tsx` (`ForwardPicker`/`ContactPicker`/`DiscardVoiceDialog`) | `StoryViewer.tsx:18`, `core/hooks/useChatPopups.tsx:32`, `Composer.tsx:58` |
| `components/messages/SendMediaPopup.tsx` | `Chat.tsx:103` (композер, не лента) |
| `components/messages/MessageSpoilerOverlay.tsx` | `components/RichText.tsx:7` — а `RichText` живёт в 13 местах (`ScheduledView`, `SuggestedPostsView`, `SuggestPostPopup`, `StickersHelper`, `mediaViewer/appMediaViewer.ts`, `auth/emailPattern.tsx` …) |
| `components/messages/videoPlayback.ts` | `components/audio.ts:58`, `components/mediaProgressLine.ts:21`, `components/wrappers/video.ts:130`, `lib/mediaPlayer/index.ts:60` |
| `components/messages/bubbleClasses.ts` | **`components/chat/bubbles.ts:88`** — общий вычислитель модификаторов бабла у обеих лент. Остаётся вместе с типом `ConvMsg` |
| `components/messages/StackedAvatars.tsx` | `CommentsBar.tsx:2` и `MessageReactions.tsx:11` — оба ленточные, но сам компонент это порт tweb `components/stackedAvatars.ts`; уходит только вместе с портом чипов и футера |
| `components/messages/EmptyChatGreeting.tsx`, `SimilarChannels.tsx` | `Chat.tsx:68,69` — рендерит их **`Chat`, а не `ChatFeed`**; в tweb владелец обоих — `bubbles.ts` (`tweb bubbles.ts:7083` SimilarChannels, `tweb bubbles.ts:10516/10849` `renderEmptyPlaceholder('greeting')`). Значит это **порт**, а не снос |

## 1.3 Что из «общего» лента тянет и обязано остаться

`core/messageToConvMsg.ts` (`bubbles.ts:84` использует `messageToConvMsg` для
`classesFor` и `setSendingStatus`), тип `ConvMsg` (`data.ts:10`), `core/draftReply.ts`
(`draftReplyState`/`convMsgReplyState` — плашка ответа над композером),
`components/StickerMedia.tsx` (полтора десятка потребителей вне ленты —
`port-divergences.md:22-28`), `core/dom/ladder.ts` (`EmptyChatGreeting.tsx:8`).

---

# 2. Карта потребителей `messagesStore` и оконной read-model

## 2.1 Цифры

```
$ grep -rln "messagesStore" web-client/src | wc -l
28
$ grep -rln "useMessagesStore" web-client/src | grep -v '\.test\.' | wc -l
12
```

Из 12 нетестовых: сам стор + 11 файлов, из которых `core/hooks/useChatScroll.ts`
упоминает стор **только в комментарии** (`useChatScroll.ts:387`), реального импорта
там нет. Итого **10 живых потребителей**.

## 2.2 Ключевой критерий

Зеркало `core/history/messagesMirror.ts` наполняется РОВНО из двух точек:

* `putMirrorPage` — страница `messages.getHistory`, зовёт её сама лента
  (`chat/bubbles.ts:1871`);
* `applyOpsToMirror` — операции воркера `RT.messageOp`, единственный вызыватель —
  `client/realtime/storeProjection.ts:115`.

Всё, что правит окно **мимо операций**, в зеркале отсутствует по построению — об
этом прямо сказано в шапке `core/history/messagesMirror.ts:21-24`. Ниже это отмечено
колонкой «в зеркале».

## 2.3 Писатели стора (в порядке опасности)

| # | Файл:строка | Что пишет | В зеркале? |
|---|---|---|---|
| 1 | `client/realtime/storeProjection.ts:115` | `applyOps` — вставка/замена/удаление/патч | **ДА** (та же строка зовёт `applyOpsToMirror`) |
| 2 | `client/realtime/storeProjection.ts:166` | `applyEdit` из сырого кадра `RT.editMessage` | **НЕТ** — правка текста/сущностей/`reply_markup` до ванильной ленты не доходит вовсе. Причина названа в `core/managers/messagesManager.ts:774-784`: `cacheEdit` не переведён на операции |
| 3 | `client/realtime/storeProjection.ts:168` | `applyGeoLive` | **НЕТ**; `messagesManager.ts:792-797` — `cacheGeoLive` вообще мёртвый код, применяет только сырой кадр |
| 4 | `client/realtime/storeProjection.ts:259` | `applyReaction` (абсолютный агрегат `RT.reaction`) | **НЕТ** — сознательно, `core/managers/messages/reactionMethods.ts:136-166` |
| 5 | `core/hooks/useMessageActions.tsx:470,499` | `applyReactionOptimistic` — своя реакция до сети | **НЕТ**. У ванили свой путь: `chat/bubbles.ts::toggleReaction` (:1650) зовёт `managers.messages.react/unreact`, а те (`reactionMethods.ts:231,242`) двигают только SSOT воркера и **никаких ops не публикуют** |
| 6 | `components/stars/StarReactionPopup.tsx:73` | `applyStarReaction` | **НЕТ** |
| 7 | `core/hooks/useChannelExtras.ts:72` | `patchViews` — просмотры поста канала | **НЕТ** (задача #75) |
| 8 | `core/hooks/useMessageActions.tsx:557,566` | `applyFactCheck` — оптимистика set/remove | **НЕТ** (WS-кадр — да: `messagesManager.ts:832` `cacheFactCheck` → patch) |
| 9 | `core/hooks/useMessageActions.tsx:694`, `components/messages/PollBubble.tsx:59` | `setPollMedia` — ОТВЕТ ручки голосования (несёт мой `chosen`) | **НЕТ** (WS `poll_update` — да: `core/managers/messages/pollMethods.ts:54`) |
| 10 | `components/messages/ChecklistBubble.tsx:61,71` | `setChecklistMedia` — ответ ручки отметки | **НЕТ** |
| 11 | `core/hooks/useMessageActions.tsx` | `applyDelete` после успеха REST | ~~НЕТ у вкладки-инициатора~~ — **УТВЕРЖДЕНИЕ БЫЛО НЕВЕРНЫМ.** Веер владельца источник НЕ исключает: `core/realtime/workerScope.ts::broadcast` → `lib/rootScope.ts:258-264`, исключает только `receiveFrom`. Врал КОММЕНТАРИЙ у метода (`messagesManager.ts`), а не код; комментарий исправлен, поведение закреплено тестом «deleteMessage() убирает сообщение из зеркала ТОЙ ЖЕ вкладки» |
| 12 | `core/hooks/useChatPopups.tsx:197,219,231` | `applyIncoming` — только что созданные розыгрыш/опрос/чек-лист | **НЕТ** |
| 13 | `core/hooks/useScheduledMessages.ts:45` | `applyIncoming` — «отправить запланированное сейчас» | **НЕТ** |
| 14 | `core/hooks/useMessageWindow.ts:80,95,117,140,148` | `setWindow`/`prepend`/`append` — страницы истории | эквивалент есть (`putMirrorPage`), но **зовёт его лента сама** |

**Вывод.** Строки 2–13 — это ТРИНАДЦАТЬ фактов, которых в зеркале нет. Каждый из них
сегодня либо уже не работает под флагом `VITE_VANILLA_FEED=1`, либо перестанет
работать в момент удаления стора. Самые заметные: **правка сообщения**, **любые
реакции**, **удаление своего сообщения из своей же вкладки**.

## 2.4 Читатели окна (`win` из `useMessageWindow`)

`win` заводится ОДИН раз — `Chat.tsx:300`. Производная `winV` (`Chat.tsx:304-330`)
вставляет клиентскую сервис-плашку «Обсуждение началось» в тред комментариев.
Производная `msgs` (`Chat.tsx:349`, `useConvMessages`) — вью-модель `ConvMsg[]`.

| Потребитель | Что берёт | Рисует ли ленту | Есть ли факт в зеркале |
|---|---|---|---|
| `Chat.tsx:354-361` `feedMsgs/feedWinMsgs` | фильтр «Избранного» по тегу-реакции | да | реакции — НЕТ (§2.3 #4) |
| `Chat.tsx:376` → `core/hooks/useVoiceQueue.ts:46,61,68,76` | очередь голосовых/кружков для глобального плеера | нет | окно — да; **но сам механизм лишний**, см. §3.12 |
| `Chat.tsx:485` | первый непрочитанный входящий → `unreadDividerSeq` | да | у ванили свой `setUnreadDelimiter` (`chat/bubbles.ts:2438`) |
| `Chat.tsx:512` → `core/hooks/useChatScroll.ts:196,224,248,269,368,392,399,449,504,562,574,649,662,679` | пагинация, scroll-restore, jump, «вниз», **markRead** | да | окно — да; `markRead` — §3.9 |
| `Chat.tsx:557` | `win.reloadNewest()` после «Очистить историю» | да | у ванили нет метода перезагрузки окна — §3.11 |
| `Chat.tsx:603` `useChatSend({… win …})` | **НИЧЕГО.** Проп объявлен (`core/hooks/useChatSend.ts:78`), но не деструктурируется и не используется: `grep -nE "\bwin\b" core/hooks/useChatSend.ts` даёт ровно одну строку — 78 | нет | мёртвый проп, удалять сразу |
| `Chat.tsx:619-624` | восстановление reply-плашки из черновика: `draftReplyState(msgs, draftReplyToId, …)` | нет | зеркало + `messageToConvMsg` дадут то же |
| `Chat.tsx:675` → `core/hooks/useMessageActions.tsx:149,167,293,463,515` | контекстное меню: сырое сообщение по индексу, права «удалить у всех», реакции | нет | зеркало даст сообщение; реакции — НЕТ |
| `Chat.tsx:682` → `core/hooks/useFeedReveal.ts:38,50,58` | спиннер первой загрузки + арминг лестницы | да | флагов `loading`/`loadedFromCache` в зеркале **НЕТ** |
| `Chat.tsx:763` → `core/hooks/useChannelExtras.ts:46,66` | id постов для REST-запросов комментариев и просмотров | нет | зеркало даст id |
| `Chat.tsx:867` | `collectLightboxItems({ msgs: winV.msgs … })` — список медиа для вьювера | нет | у ванили свой сбор из зеркала (`chat/bubbles.ts:1679`) |
| `Chat.tsx:1010` | `findReplyKeyboardRows(msgs)` — reply-клавиатура над композером | нет | требует `reply_markup`, а он приезжает правкой (§2.3 #2) |
| `Chat.tsx:1012,1014` | `botStart`/`emptyGreeting` по `msgs.length === 0` | нет | зеркало даст длину, но не «загружено ли окно» |
| `Chat.tsx:1139` `onFeedReply` | **уже используется императивной лентой**: `VanillaFeed.initMessageReply` → `draftReplyState(msgs, mid, …)` | нет | зеркало + `messageToConvMsg` |
| `Chat.tsx:1172-1181` `onComposerEditLast` | ↑ на пустом инпуте — правка своего последнего | нет | зеркало |
| `Chat.tsx:1185-1193` `onComposerReplyPrev` | Ctrl/Cmd+↑ — ответ на последнее | нет | зеркало |

## 2.5 Потребитель, которого никто не ждал

**`components/userInfo/SharedMedia.tsx:160`**

```ts
const winLen = useMessagesStore((st) => (chatId != null ? st.byKey[String(chatId)]?.msgs.length ?? 0 : 0))
useEffect(() => { genRef.current++; loadingRef.current.clear(); setByFilter({}) }, [winLen])
```

Панель «Общие медиа» в профиле использует **длину окна открытого чата как сигнал
инвалидации** своих вкладок: пришло новое сообщение — сбросить кэш и перезагрузить
активный таб. Это единственный ЧИТАТЕЛЬ `byKey` вне ленты, и он не связан с
рисованием баблов вообще. После удаления стора `byKey` останется пустым, эффект
никогда не сработает, и свежеотправленное фото/голосовое перестанет появляться в
общих медиа без переоткрытия панели — **молча, без ошибки**.

Пересадка: подписаться на `rootScope` `history_append`/`history_delete`
(`core/history/messagesMirror.ts:139,159`) с фильтром по `peerId`.

---

# 3. Пробелы паритета: что React-лента умеет, а императивная — нет

Метод: пройден каскад `MessageContent.tsx:307-655` (все ветки по `m.type`) и
`MessageRow.tsx`, каждая ветка проверена в `chat/bubbles.ts` (`renderMessage`,
`renderMedia`, `renderReply`, `renderDocumentMedia`, `renderStickerMedia`). Якорь —
tweb, не React-версия.

## 3.1 Уже заведённые задачи — перепроверены, адреса уточнены

| Задача | Место | Состояние на 2026-08-26 |
|---|---|---|
| #74 аватар автора серии | `chat/bubbles.ts:1445` `createAvatar` возвращает `document.createElement('div')` | заглушка жива; гейт `isAvatarNeeded` тоже не заведён (`chat/bubbles.ts:1069-1073`) |
| #75 `isBroadcast`, просмотры, футер комментариев | `VanillaFeed.tsx:29` (`isBroadcast?: boolean`) проп есть, `Chat.tsx:1411` его **не передаёт**; `STUB_CTX.isChannel = false` (`chat/bubbles.ts:341`) ⇒ классы `channel-post`/`with-beside-button` (`bubbleClasses.ts:145`) не ставятся НИКОГДА | подтверждено |
| #71 счётчик комментариев | `message.replies` никто не заполняет; у нас это REST-обход `useChannelExtras.ts:44-58` + `CommentsBar` | подтверждено. В tweb — `RepliesElement` внутри бабла (`tweb bubbles.ts:32,1005`) |
| #72 ховер-реакция | в `chat/bubbles.ts` нет ни `quick-reaction`, ни `setHoverVisible`; React-версия — `MessageRow.tsx:126-129` | подтверждено |
| #73 права «нельзя переслать/удалить» | `VanillaFeed.tsx:122` передаёт `{ messages: {} }` вместо менеджера прав; `chat/selection.ts:120` | подтверждено |

## 3.2 Типы контента, которых у ванили нет вовсе

`renderMedia` (`chat/bubbles.ts:684`) знает ровно пять веток: стикер, видео/gif/кружок,
документ, фото, альбом. `renderMessage` (`chat/bubbles.ts:947`) добавляет текст, reply,
время, реакции, имя. Всё остальное из `MessageContent.tsx` — пробел:

| Что | Где в React | Где в tweb |
|---|---|---|
| Превью ссылки (webpage) | `MessageContent.tsx:498` `WebPagePreview` | `tweb bubbles.ts:8069-8377`, `docs/tweb/bubbles.md:389` |
| «Проверка фактов» | `MessageContent.tsx:501` `FactCheckBox` | — |
| Опрос | `MessageContent.tsx:547` `PollBubble` | `tweb bubbles.ts:8757-8838` |
| Чек-лист | `MessageContent.tsx:559` `ChecklistBubble` | там же |
| Подарок | `MessageContent.tsx:530` `GiftBubble` | сервисный solid-компонент |
| Розыгрыш | `MessageContent.tsx:539` `GiveawayBubble` | `tweb bubbles.ts:9146-9172` |
| Гео / live-гео | `MessageContent.tsx:514` `GeoBubble` | `tweb bubbles.ts:9045-9099` |
| Контакт | `MessageContent.tsx:516` `ContactBubble` | `tweb bubbles.ts:8706-8755` |
| Звонок | `MessageContent.tsx:523` `CallBubble` | `tweb bubbles.ts:8651-8704` |
| Big-emoji / анимированные эмодзи | `MessageContent.tsx:510` `BigEmojiBubble`; `STUB_CTX.bigEmojiCount = 0` (`chat/bubbles.ts:344`) ⇒ классы `emoji-big`/`can-have-big-emoji` не ставятся | `tweb bubbles.ts:7357-7538` |
| Секретное медиа (E2E) | `MessageContent.tsx:455` `SecretMediaBubble` | — (наша подсистема) |
| Платное медиа + разблокировка | `MessageContent.tsx:485-489` (`paidMedia`, `onUnlockPaid`) | `tweb bubbles.ts:8840-9043` |
| Inline reply-markup (клавиатура под баблом) | `MessageRow.tsx:23` `InlineKeyboard` + `getInlineMarkupRows` | `docs/tweb/bubbles.md:560` |
| Кнопка расшифровки голосового | `Transcription.tsx` через `VoiceMessage.tsx:12` | — |
| Кнопка сбоку поста канала «переслать» | `MessageRow` + `feedFns.forwardMsg` (`MessageRow.tsx:74`) | `docs/tweb/bubbles.md:288` `.bubble-beside-button` |

## 3.3 Сервисные сообщения — ЗАКРЫТО (2026-08-26)

`components/chat/serviceMessage.ts` **уже содержит** порт экшен-бабла:
`createServiceBubble` (`serviceMessage.ts:149`) и `wrapMessageActionText`
(`serviceMessage.ts:116`). Но `bubbles.ts` импортирует оттуда **только**
`createDateBubble` (`chat/bubbles.ts:98`):

```
$ grep -rn "createServiceBubble\|wrapMessageActionText" web-client/src
# вне serviceMessage.ts и его теста — НОЛЬ вызывающих
```

Разведка подтвердилась: до правки `renderMessage` не различал
`message`/`messageService` вовсе, и всякая пилюля рисовалась пустым обычным
баблом (мутационная проверка показывала `bubble is-in is-group-first
is-group-last` с одним лишь временем внутри).

**Сделано:** развилка в `renderMessage` (порт tweb :6708-6712 → :7293-7301) →
`renderServiceMessage` → `createServiceBubble`; превью закреплённого лента
разрешает сама по `reply_to` (`wrapMessageForReply`, порт
`messageActionTextNewUnsafe.ts:400-419`). Роль tweb `SERVICE_AS_REGULAR` играет
`getMessageKind`: звонок (`call`) и подарок (`gift`) по ветке пилюли не идут.
Правка пилюли (`onMessageEdit`) пересобирает фразу, а не стирает класс `service`.
Тесты — `components/chat/bubbles.service.test.ts`.

**Осталось долгом:** `messageActionStarGift` — бэкенд его производит, фразы у
`serviceMsgSegs` для него нет, своего бабла в ванильной ленте тоже нет (пустой
обычный бабл, как и было); медиа сервисного бабла (`wrapServiceMediaBubble`:
аватар нового фото чата, кнопка «Установить фото» у `suggest_photo`) не
портировано — см. шапку `serviceMessage.ts`.

Отдельно: клиентская плашка «Обсуждение началось» собирается в `Chat.tsx:304-330`
(`messageActionDiscussionStarted`, порт tweb `generateThreadServiceStartMessage`) —
она вставляется в `winV`, то есть **в зеркало не попадает вообще**.

## 3.4 Шапка пересылки

Не портирована, и это записано прямо в коде: `chat/bubbles.ts:1012-1019` — «НЕ
портирована ветка ПЕРЕСЫЛКИ (:9410-9497)». При этом `bubbleClasses.ts:141` уже
ставит `forwarded`/`must-have-name`, т.е. класс без содержимого.
React-версия: `MessageContent.tsx:585-593`.

## 3.5 Реакции — путь обновления оборван

Чипы рисуются (`chat/reactions.ts` → `chat/bubbles.ts::renderMessage`), клик
работает (`chat/bubbles.ts:1650`), но **никакое изменение агрегата до ленты не
доезжает**: сервер шлёт `RT.reaction` → только стор (`storeProjection.ts:259`), а
`react/unreact` воркера (`reactionMethods.ts:231,242`) правят SSOT без публикации
операций. Значит в ванильной ленте реакция не появляется ни своя, ни чужая, пока
чат не переоткрыт. Причина, по которой реакции не перевели на операции, расписана в
`reactionMethods.ts:136-166` — это структурное решение, а не забывчивость: его
придётся пересматривать.

Также отсутствуют:
* аватары реагировавших в чипе (`MessageReactions.tsx:11` → `StackedAvatars`, порт
  tweb `stackedAvatars.ts`);
* эффект вокруг чипа (`ReactionAroundEffect.tsx`, порт tweb `fireAroundAnimation`);
* попап «кто отреагировал» (`useMessageActions.tsx:518`) и ⭐-реакция
  (`StarReactionPopup.tsx`).

## 3.6 Что ставит React, а `STUB_CTX` ванили гасит

`chat/bubbles.ts:338-346`:

```ts
const STUB_CTX = { firstInGroup: true, lastInGroup: true, isChannel: false,
                   isHighlighted: false, isFirstUnread: false,
                   bigEmojiCount: 0, animatedSticker: false }
```

`isChannel: false` → нет `channel-post`/`with-beside-button` (`bubbleClasses.ts:145`).
`bigEmojiCount: 0` → нет `emoji-big`/`can-have-big-emoji`/`sticker`
(`bubbleClasses.ts:123`). `animatedSticker` компенсируется в
`renderStickerMedia` (`chat/bubbles.ts:905`), `isHighlighted`/`isFirstUnread` — в
`highlightBubble` (`chat/bubbles.ts:2662`) и `setUnreadDelimiter`
(`chat/bubbles.ts:2438`); остальные два — реальные дыры.

## 3.7 Контекстное меню

`components/chat/contextMenu.ts` существует (неотслеживаемый файл — работа идёт
прямо сейчас), но в ленту ещё не подключён: `chat/bubbles.ts:1472-1473` —
«Не портировано КОНТЕКСТНОЕ МЕНЮ — в tweb его вешает первая же строка тела
(`this.chat.contextMenu.attachTo(container)`, :1478); поведения ещё нет». Под
флагом сегодня меню сообщения недоступно.

## 3.8 Клик по дате-разделителю — ЗАКРЫТО во время разведки

На момент начала разведки это был пробел; параллельный агент его закрыл прямо в
ходе работы. Сейчас: `ChatContext.navigation.openDatePicker`
(`chat/bubbles.ts:191`), клик по дата-баблу (`chat/bubbles.ts:1574`),
`onDatePick` (`chat/bubbles.ts:2256`), проводка попапа —
`VanillaFeed.tsx:60,114-116`. Осталось только: `Chat.tsx:1411` должен передать
`onOpenDatePicker` (сегодня не передаёт — тот же класс пропуска, что и
`isBroadcast`, §3.1/#75).

## 3.9 Отметка о прочтении — ЗАКРЫТО (2026-08-26)

`markRead` зовётся только из `core/hooks/useChatScroll.ts:233,651,665`. В
`chat/bubbles.ts` его нет вовсе (`grep -n markRead` → пусто), а `BubblesManagers`
(`chat/bubbles.ts:257`) вообще не содержит `realtime.markRead`.

Адреса разведки перепроверены и верны: `tweb bubbles.ts:2978`
(`readHistory({peerId, maxId, threadId, monoforumThreadId})` внутри `readUnreaded`),
`:2992` (`readMessages` — ВТОРОЙ канал, mention/unread-reaction, а не media_unread)
и `:5752` (`onScrolledAllDown`).

**Сделано:** в `bubbles.ts` портирован наблюдатель за непрочитанными —
`unreadedObserverCallback` (:2289-2295), `onUnreadedInViewport` (:2914-2926),
`readUnreaded` (:2941-3012), `setUnreadObserver` (:6433-6443) и точки постановки
в `renderMessage` (:7291-7307 и :7638-7640 — у поста канала наблюдается ВРЕМЯ, а
не бабл). Ручка — та же `realtime.markRead`, второго пути отметки не заведено;
эффекты `useChatScroll` под флагом выключены гейтом `OWNS_READ_MARKER` (иначе
грубая отметка забивала бы точную). Гейт фокуса — `idleController.getFocusPromise()`
(порт tweb :71-73, у нас его не было). Тесты — `components/chat/bubbles.read.test.ts`
и `core/hooks/useChatScroll.vanillaFeedGate.test.tsx`.

**Не портировано:** канал `'content'` (:2297-2303, :2979-2992) — упоминаний и
непрочитанных реакций в модели нет, а `media_unread` ведёт плеер
(`core/mediaRead.ts`); `unreadedChat`-снимок (:2928-2939) — пир ленты не
меняется никогда; `onScrolledAllDown` (:5746-5760) — его условие
`!this.unreaded.size` у нас недостижимо (без `pFlags.unread` наблюдается
каждый бабл), и порт был бы мёртвым кодом.

## 3.10 Лестница появления и спиннер первой загрузки

`Chat.tsx:704-721` (`animateLadder` из `core/dom/ladder.ts`) + `useFeedReveal.ts`.
В шапке порта прямо сказано, что лестница вне объёма: `chat/bubbles.ts:45-47` —
«Вне порта осталось то, у чего нет предмета: … лесенка (`canAnimateLadder`)».
В tweb это `animateAsLadder` внутри `bubbles.ts`.

## 3.11 Прочее окружение, которое сегодня держит `Chat.tsx`

* Плейсхолдер пустого чата и «Похожие каналы» (`Chat.tsx:1456-1466`) — в tweb оба
  принадлежат ленте (`tweb bubbles.ts:7083`, `tweb bubbles.ts:10849`).
* Сдвиг фона-градиента на новом сообщении (`Chat.tsx:740-755`,
  `core/chat/activeGradient.ts`).
* Перезагрузка окна после «Очистить историю» (`Chat.tsx:557` `win.reloadNewest()`).
  `setPeer` **портирован** (`chat/bubbles.ts:2047`, без ветки смены пира —
  `chat/bubbles.ts:33-38`), есть и `setMessageId` (`chat/bubbles.ts:2251`), но
  наружу, в `ChatContext`, ни один из них не выведен: `VanillaFeed.tsx:146`
  зовёт `setPeer()` только на маунте. Хосту нужен способ сказать ленте
  «перечитай окно» — иначе после очистки истории лента останется со старыми
  баблами.
* Панель «липких дат»: `has-sticky-dates`/`is-scrolling` **уже портированы**
  (`chat/bubbles.ts:2509`, `chat/bubbles.ts:2425`) — дубли в `Chat.tsx:1207-1231`
  уйдут вместе с React-веткой.

## 3.12 Наша самодеятельность — портировать НЕ надо

Помечено, чтобы при сносе это не «спасали».

1. **`core/hooks/useVoiceQueue.ts`** — строит очередь голосовых/кружков из
   `win.msgs` (`useVoiceQueue.ts:46,61`) и кладёт её в `audioStore`. В tweb очереди
   из модели истории нет: соседей ищет сам `AudioElement` по DOM —
   `tweb components/audio.ts:458` (`findMediaTargets`) и `:825`. Ванильная ветка уже
   идёт правильным путём: `renderDocumentMedia` → `wrapDocument`
   (`chat/bubbles.ts:867`) → `AudioElement` (`components/wrappers/document.ts:51`),
   а `components/audio.ts:398-410` уже ищет соседей внутри `.bubbles-inner`.
   Витрина плеера не пострадает: `audioStore` пишет
   `core/audio/mediaPlaybackController.ts:21`.
2. **`useChannelExtras` REST-обходы** (`useChannelExtras.ts:44-77`) — комментарии и
   просмотры добираются отдельными ручками и патчатся в окно. В tweb это **поля
   самого сообщения**: `message.views` рисует `tweb messageRender.ts:273-280`,
   комментарии — `RepliesElement` (`tweb bubbles.ts:32`). Правильный порт —
   довезти `views`/`replies` в сообщении (задачи #71/#75), а не переносить обходы.
3. **`useConvMessages` кэш стабильных ссылок** (`useConvMessages.ts:105-140`) —
   существует исключительно ради `React.memo` у `MessageRow`. Предмета вне React нет.
4. **Синтетический `ConvMsg` альбома** (`ChatFeed.tsx:151-189`, пре-пасс `albumRuns`)
   — `docs/tweb/bubbles.md:743` называет это расхождением; у ванили альбом уже
   собирается по `grouped_id` как в tweb (`chat/bubbles.ts:727-741`).
5. **`stickyDateKey` пропом** (`ChatFeed.tsx:88`) — `docs/tweb/bubbles.md:753`:
   в tweb класс `is-sticky` ставится императивно из `StickyIntersector`. У ванили
   уже так (`chat/bubbles.ts:2839`).
6. **`.bubbles-group` только для входящих серий в группах** (`ChatFeed.tsx:317`) —
   `docs/tweb/bubbles.md:738-741`: в tweb в группу попадает каждая серия.

---

# 4. Порядок сноса

Правило: после каждого шага должны проходить `npx vite build` и `npx vitest run`
(из `web-client/`), и стенд должен открываться с `VITE_VANILLA_FEED=1`.

## Шаг 0 — закрыть источник фактов (СТРОГО ПЕРВЫМ, распараллеливается)

Пока эти факты не едут операциями, снос стора — потеря функциональности. Каждый
подпункт трогает свой файл менеджера, поэтому их можно вести параллельно, но
`storeProjection.ts` правится последним и один раз.

* 0.1 `edit_message` → `patch`. Препятствий по данным нет: `messagesManager.ts:774-779`
  сам говорит, что их не осталось.
* 0.2 Реакции (обычные + ⭐ + оптимистика) → операции. Самый тяжёлый пункт:
  `reactionMethods.ts:136-166` объясняет, почему это не сделали, и требует нового
  типа операции либо переноса `mergeReactions` в общий `messageOps`.
* 0.3 `geo_live_update` → операция (`messagesManager.ts:792-797`).
* 0.4 Просмотры и комментарии: довезти `views`/`replies` в сообщении (#71/#75) —
  снимает пункты 7 и часть задач §3.12.2.
* 0.5 Оптимистика factcheck / голосования / чек-листа: результат ручки публиковать
  операцией из воркера, а не из хука.
* 0.6 `deleteMessage`: рассылать remove-op **и себе** (`messagesManager.ts:533-534`),
  убрать `applyDelete` из `useMessageActions.tsx:307`.
* 0.7 Созданные из попапов опрос/чек-лист/розыгрыш и «отправить запланированное
  сейчас»: вместо `applyIncoming` — insert-операция из воркера
  (`useChatPopups.tsx:197,219,231`, `useScheduledMessages.ts:45`).
* 0.8 `SharedMedia.tsx:160`: перевести инвалидацию на `rootScope`-события зеркала.

Проверяемость: после шага 0 обе копии окна обязаны совпадать — расширить
`client/realtime/storeProjection.mirror.test.ts` (сейчас 5 тестов) новыми фактами.

## Шаг 1 — паритет ленты

Всё внутри `bubbles.ts` идёт **по очереди** (один файл, живой конфликт правок), но
сами врапперы (poll, geo, contact, call, webpage, giveaway, gift, big-emoji,
secret, paid) пишутся **параллельно** отдельными модулями в `components/wrappers/`
и подключаются по одному.

Порядок по риску «молча сломается»:
1. ~~сервисные баблы (§3.3)~~ — СДЕЛАНО;
2. ~~`markRead` в ленту (§3.9)~~ — СДЕЛАНО;
3. `isBroadcast` + `channel-post` + просмотры + replies-футер (#75/#71);
4. аватар серии (#74);
5. шапка пересылки (§3.4);
6. reply-markup (inline-клавиатура) и beside-кнопка;
7. остальные типы контента (§3.2) — каждый своим срезом с тестом;
8. ховер-реакция (#72), права выделения (#73), клик по дате (§3.8);
9. лестница + спиннер (§3.10), greeting + SimilarChannels (§3.11);
10. контекстное меню (§3.7) — идёт прямо сейчас отдельной работой.

## Шаг 2 — пересадить НЕленточных потребителей окна на зеркало

Можно вести параллельно с шагом 1: ни один из этих файлов не `bubbles.ts`.

* `draftReplyState`/`convMsgReplyState` (`Chat.tsx:622,1139,1188`) — читать
  `mirrorWindow(winKey(peerId, threadRootId))` и гонять через `messageToConvMsg`;
* `onComposerEditLast`/`onComposerReplyPrev` (`Chat.tsx:1172,1185`) — то же;
* `findReplyKeyboardRows` (`Chat.tsx:1010`) — то же (зависит от 0.1);
* `botStart`/`emptyGreeting` (`Chat.tsx:1012,1014`) — «окно пустое» из зеркала;
* `useMessageActions` (`useMessageActions.tsx:149,167,293,463,515`) — заменить
  `win.msgs` на `mirrorWindow`;
* `useChannelExtras` (`useChannelExtras.ts:46,66`) — id из зеркала (или снять
  целиком после 0.4);
* `useChatSend`: удалить мёртвый проп `win` (`useChatSend.ts:78`, `Chat.tsx:603`) —
  это можно сделать **прямо сейчас**, независимо от всего остального;
* `useVoiceQueue` — снять целиком (§3.12.1), проверив, что `NowPlayingBar`
  по-прежнему получает трек от `mediaPlaybackController`.

## Шаг 3 — переключить умолчание

`config/app.ts:38` → `vanillaFeed: true` по умолчанию. Прогнать чек-лист
`docs/tweb/bubbles.md:762-776` на стенде. React-ветка ещё в коде — откат одной
переменной.

## Шаг 4 — удалить React-ветку

Одним коммитом: `Chat.tsx:1410-1467` (весь `else`), импорты `Chat.tsx:65,68,69`,
файлы из §1.1 и их SCSS-модули. Здесь же уходят `useChatScroll`,
`useChatStickyDates`, `chatStickyDates.ts`, `useDragSelect`, `useFeedReveal`,
`useConvMessages`; `useChatSelection` схлопывается до `useState` под `SelectionBar`.

Обязателен только после шагов 1–3: до них удаление ветки — потеря поведения.

## Шаг 5 — удалить окно и стор

`core/hooks/useMessageWindow.ts` и `stores/messagesStore.ts`. `winKey` уже живёт в
зеркале (`core/history/messagesMirror.ts:37`), стор его лишь реэкспортирует
(`messagesStore.ts:24`) — реэкспорт уходит вместе с файлом, импорты
`@stores/messagesStore` в `messagesManager.ts` и `VanillaFeed.tsx:14` уже смотрят
на зеркало.

## Шаг 6 — убрать флаг

`config/app.ts:38`, `readVanillaFeed`, `components/Chat.vanillaFeed.test.ts` (6
тестов — они пинят ровно развилку и умирают вместе с ней).

## Что нельзя вести параллельно и почему

* **0 → 1**: пункт 1.2 (`markRead`) и рендер реакций зависят от того, каким путём
  факт доезжает до ленты.
* **1 → 3 → 4**: переключать умолчание до паритета — значит отдать пользователю
  ленту без сервисных сообщений и реакций; удалять React-ветку до переключения —
  значит остаться без пути отката.
* **2 → 5**: пока хоть один потребитель читает `win`, стор жив.
* **Внутри 1**: все правки в `bubbles.ts` — строго по очереди.

---

# 5. Судьба тестов

Команды подсчёта (из `web-client/`):

```
$ grep -rlc --include='*.test.ts' --include='*.test.tsx' -E "^\s*(it|test)\(" src | wc -l
444                      # всего тестовых файлов в проекте
$ grep -rhE "^\s*(it|test)\(" src/components/messages | wc -l
121                      # тестов в каталоге messages/ (25 файлов)
$ grep -rhE "^\s*(it|test)\(" src/stores/messagesStore.*.test.ts | wc -l
28                       # тестов стора (6 файлов)
$ grep -rhE "^\s*(it|test)\(" src/components/chat/bubbles*.test.ts src/components/chat/VanillaFeed.test.tsx | wc -l
130                      # тестов императивной ленты (10 файлов) — уже есть
```

## 5.1 Умирают вместе со снесённым (проверяли реализацию, у которой нет преемника)

| Файл | Тестов | Почему умирает |
|---|---|---|
| `core/hooks/useMessageWindow.test.ts` | 8 | хук исчезает целиком |
| `core/hooks/useConvMessages.test.tsx` | 2 | проверяют кэш стабильных ссылок под `React.memo` |
| `core/hooks/useChatScroll.test.tsx` | 10 | скролл-машина заменена `bubbles.ts` (`bubbles.scroll.test.ts`, 16 тестов) |
| `core/hooks/useChatScroll.positions.test.tsx` | 5 | там же |
| `core/hooks/useChatScroll.instanceGate.test.tsx` | 6 | гейт «активный инстанс» — свойство React-стека |
| `core/hooks/useChatScroll.hiddenAtBottomGate.test.tsx` | 2 | там же |
| `core/hooks/useChatStickyDates.test.tsx` | 4 | у ванили `StickyIntersector` |
| `components/chatStickyDates.test.ts` | 12 | помощник React-хука |
| `core/hooks/useChatSelection.instanceGate.test.tsx` | 2 | выделение у ванили (`chat/selection.test.ts`) |
| `components/Chat.vanillaFeed.test.ts` | 6 | пин самой развилки — умирает на шаге 6 |
| `components/messages/*` — рендер-тесты React-баблов: `AlbumGrid.model`(2), `MessageContent.commentsBox`(2), `MessageContent.mediaModel`(4), `MessageContent.voice`(1), `RealMediaBubble.blur`(3)/`fitted`(4)/`upload`(5)/`videoObserver`(2), `VoiceMessage`(2), `bigemoji.render`(5), `quickReaction`(7), `reactionChip`(13), `stickerAnimatedClass`(3), `stickerBubbleOpen`(7), `InlineKeyboard`(4), `bubbleParts/webPagePreview`(8) | **72** | все монтируют React-компоненты, которых не станет |

**Итого умирает: 129 тестов в 25 файлах.**

Важно: «умирает файл» ≠ «умирает проверка». Для 72 тестов из `messages/` предмет
остаётся (спойлер медиа, блюр-подложка, отмена аплоада, наблюдатель видео,
big-emoji, ховер-реакция, чипы реакций, размеры альбома, клавиатура) — они должны
быть **переписаны** на императивные врапперы одновременно с портом соответствующего
типа контента (§3.2), а не просто удалены. Удалять их можно только вместе с
появлением равнозначного теста в `components/chat/*` или `components/wrappers/*`.

## 5.2 Переписать / переселить (проверяли поведение, которое остаётся)

| Файл | Тестов | Куда |
|---|---|---|
| `stores/messagesStore.reactions.test.ts` | 9 | **эталон семантики слияния реакций** — так он объявлен в `core/managers/messages/reactionMethods.ts:164-166` («не менять, только сверяться»). При шаге 0.2 переезжает туда, где окажется `mergeReactions`, ни один кейс не теряется |
| `stores/messagesStore.dedup.test.ts` | 4 | дедуп уже живёт в `core/realtime/messageOps.ts` (`messageOps.test.ts`, 16) — сверить покрытие и слить |
| `stores/messagesStore.threadRouting.test.ts` | 5 | маршрутизация по ключам окна — переезжает в `messagesMirror.test.ts` (сейчас 25) |
| `stores/messagesStore.patchViews.test.ts` | 4 | вместе с 0.4 |
| `stores/messagesStore.starReaction.test.ts` | 3 | вместе с 0.2 |
| `stores/messagesStore.paidMedia.test.ts` | 3 | путь уже операционный (`messagesManager.ts::cachePaidUnlock`) — переписать на ops |
| `client/realtime/storeProjection.mirror.test.ts` | 5 | **расширить**, а не удалять: после шага 0 это главный пин «обе копии сходятся», а после шага 5 — «зеркало получает всё» |
| `client/realtime/storeProjection.messageOps.test.ts` | 5 | снять ветку стора, оставить ветку зеркала |
| `client/realtime/storeProjection.pending.test.ts` | 8 | то же |
| `core/hooks/useMessageActions.reactionEffect.test.tsx` | 3 | эффект вокруг чипа переезжает в ванильные реакции (§3.5) |
| `components/messages/StackedAvatars.test.tsx`(5), `ReactionIcon.test.tsx`(4), `ReactionAroundEffect.test.tsx`(4) | 13 | предмет остаётся (порты tweb `stackedAvatars.ts` / `fireAroundAnimation`) — переписать на императивные узлы |

**Итого к переписыванию/переселению: 66 тестов в 11 файлах.**

## 5.3 Не трогать

`components/messages/bubbleClasses.test.ts` (17) — общий вычислитель, живой у ванили
(`chat/bubbles.ts:88`). `components/messages/videoPlayback.test.ts` (6),
`MessageSpoilerOverlay.legacy.test.tsx` (2), `ChatDialogs.test.tsx` (2),
`ForwardPicker.test.tsx` (5), `SendMediaPopup.spoiler.test.tsx` (4) — не лента (§1.2).
Итого 36 тестов в каталоге `messages/` переживают снос без изменений.

Проверка арифметики каталога: 121 = 72 (умирают) + 13 (переписать) + 36 (остаются).

## 5.4 Что придётся ДОБАВИТЬ

* пин «сервисное сообщение рисуется экшен-баблом, а не пустым» (§3.3);
* пин «`markRead` зовёт лента» (§3.9) — сейчас его нет нигде;
* пин «удаление своего сообщения убирает бабл в СВОЕЙ вкладке» (§2.3 #11);
* пин `SharedMedia` «новое сообщение инвалидирует табы» (§2.5) — сейчас механизм
  не покрыт ничем;
* пин «`isBroadcast` доезжает от `Chat.tsx` до `ChatBubbles`» (#75) — сегодня проп
  просто не передаётся и это ничем не ловится.


---

## Приложение. Точный удаляемый набор (пересчитано)

Снято автоматическим обходом импортов: для каждого модуля `components/messages/`
искались импортёры ВНЕ этой папки (тесты исключены). Скан, который делался
глазами, ошибался — первая его версия молча искала пути с расширением и нашла
один потребитель вместо десяти. Числа ниже получены разбором всех строк
`from '...'` в `src`.

**Модули с потребителем вне ленты — сносить нельзя (10 из 28):**

| Модуль | Кто держит | Что это значит |
|---|---|---|
| `bubbleClasses` | `components/chat/bubbles.ts` | общий вычислитель модификаторов бабла, им пользуется ИМПЕРАТИВНАЯ лента |
| `videoPlayback` | `components/audio.ts`, `mediaProgressLine.ts`, `wrappers/video.ts`, `lib/mediaPlayer/index.ts` | подсистема плеера, к ленте отношения не имеет |
| `MessageSpoilerOverlay` | `components/RichText.tsx` | спойлер текста, нужен везде, где есть rich-text |
| `ChatDialogs` | `StoryViewer.tsx`, `conversation/ChatMsgActionPopups.tsx`, `core/hooks/useChatPopups.tsx` | пикер чатов, лежит в папке ленты по историческим причинам |
| `SendMediaPopup`, `TranslatePopup`, `StackedAvatars` | `Chat.tsx`, `ChatMsgActionPopups.tsx`, `CommentsBar.tsx` | попапы и мелкие узлы окружения |
| `EmptyChatGreeting`, `SimilarChannels` | `Chat.tsx` | **это ПОРТ, а не снос**: в tweb владелец обоих — `bubbles.ts` |
| `ChatFeed` | `Chat.tsx` | сама лента, единственный импортёр |

**Модули только ленты — удаляются вместе с ней (18 из 28):**
`AlbumGrid`, `AudioPlayIcon`, `ChecklistBubble`, `GiftBubble`, `GiveawayBubble`,
`InlineKeyboard`, `MessageBubbles`, `MessageContent`, `MessageReactions`,
`MessageRow`, `PollBubble`, `ReactionAroundEffect`, `ReactionIcon`,
`RealMediaBubble`, `SecretMediaBubble`, `Transcription`, `VoiceMessage`,
`useBlurThumb`.

**Важное следствие.** У `ChatFeed` ровно ОДИН настоящий импортёр — `Chat.tsx`.
Упоминания `messages/ChatFeed` в `components/chat/bubbles.ts`,
`serviceMessage.ts`, `bubbleGroups.ts` — это ссылки в комментариях на адрес
разметки, а не импорты; поиск по подстроке их считает, поиск по `from '...'` —
нет. При сносе они станут ссылками в никуда, и их надо переписать, а не
оставить.
