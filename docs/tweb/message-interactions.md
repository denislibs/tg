# Взаимодействия с сообщением в tweb: полный референс

Снято 2026-08-16. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb`;
- наш код `web-client/` на `main`.

> Важно: локальный tweb — форк оригинала. Часть механик — форк-специфика (trackpad-swipe-reply,
> «flight»-анимации реакций, Document-PiP-обвязка `getAppWindow()/getOverlayRoot()`), это отмечено
> по месту. Все номера строк — фактическое состояние репозитория.

> Детали внутренностей попапов (PopupForward/PopupPickUser, PopupDeleteMessages, PopupPinMessage)
> и pinned-бара вынесены в отдельные исследования — где раздел неполон, стоит пометка
> «TODO: см. popups.md».

---

## 0. Карта файлов

| Путь | Роль |
|---|---|
| `src/components/chat/contextMenu.ts` | `ChatContextMenu` — контекстное меню сообщения (2347 строк) |
| `src/components/chat/input.ts` | `ChatInput` — reply/edit/forward-плашки над композером, отправка (5233 строки) |
| `src/components/chat/bubbles.ts` | `ChatBubbles` — клики по баблам, свайп-ответ, прыжки, подсветка (11812 строк) |
| `src/components/chat/selection.ts` | `AppSelection` / `ChatSelection` — режим выделения (1189 строк) |
| `src/components/chat/reactionsMenu.ts` | `ChatReactionsMenu` — панель быстрых реакций в контекстном меню |
| `src/components/chat/reactions.ts` | `ReactionsElement` (custom element `reactions-element`) — контейнер реакций бабла |
| `src/components/chat/reaction.ts` | `ReactionElement` (custom element `reaction-element`) + эффекты/анимации |
| `src/components/chat/reactionContextMenu.ts` | контекстное меню одной реакции (кто поставил) |
| `src/components/chat/chat.ts` | `Chat.sendReaction` (стр. 1457), `Chat.setMessageId` (стр. 1164) |
| `src/lib/appManagers/appReactionsManager.ts` | оптимистичное применение реакции (`sendReaction`, стр. 647) |
| `src/lib/appManagers/appMessagesManager.ts` | `canEditMessage` (5806), `canMessageBeEdited` (5773), `canDeleteMessage` (5841) |
| `src/helpers/positionMenu.ts` | позиционирование меню от точки клика / триггера |
| `src/helpers/contextMenuController.ts` | синглтон открытия/закрытия меню, mousemove-автозакрытие |
| `src/components/buttonMenu.ts` | `ButtonMenu` — рендер пунктов (`.btn-menu-item`) |
| `src/scss/partials/_button.scss` | анимация `.btn-menu` (стр. 98–240) |
| `src/components/popups/forward.ts`, `deleteMessages.ts`, `unpinMessage.ts` | попапы forward/delete/pin |

---

# 1. Контекстное меню сообщения

## 1.1 Активация — `attachTo(element)` (contextMenu.ts:246–348)

Вешается на `bubbles`-контейнер (bubbles.ts:1478 `this.chat.contextMenu.attachTo(container)`).

- **Десктоп** (стр. 316–320): `attachContextMenuListener` → правый клик → `onContextMenu`.
- **Тач** (стр. 249–315): два пути:
  - long-press по `reaction-element` (capture-фазой, стр. 254–280) → то же меню + гашение touchend;
  - **обычный тап** по баблу (стр. 282–315) открывает меню, если target не попал в
    «плохие селекторы» (стр. 289–307): `.name`, `.peer-title`, `.reply`, `.document`,
    `audio-element`, `a`, `.bubble-beside-button`, `replies-element`,
    `[data-saved-from]:not(.bubble)`, `poll-element`, `.attachment`, `.reply-markup-button`,
    `.bubble-view-button`, `.webpage`, `.bubbles-group-avatar`, `.bubble-service-button`.
- Подписка на `history_delete` (стр. 323–347): если открытое меню относится к удалённому
  сообщению (или к удалённому из selection/альбома) — `contextMenuController.close()`.

## 1.2 `onContextMenu(e)` (contextMenu.ts:350–585)

Последовательность:

1. `ChatType.Static` → выход (стр. 351).
2. Ищет `bubble-content-wrapper` → `bubble`, либо `bubbles-group-avatar` (стр. 356–360).
   Дата-бабл (`bubble-first`) без аватарки — выход (стр. 363).
3. `preventDefault` только для мыши; повторный вызов при активном меню — выход (стр. 370–374).
4. Спец-цели до общего меню:
   - `.reaction.is-paid` → `PopupStarReaction` (стр. 386–390);
   - `reaction-element` (не тег) → `openReactionContextMenu` (стр. 392–413, см. §7.6);
   - `[data-checklist-item-id]` / `[data-poll-option-idx]` — запоминаются для сабменю (стр. 415–424).
5. `prepareForMessage()` (стр. 427–518) — снимает весь стейт: `isSelectable`
   (`selection.canSelectBubble`), `isTextSelected` (=`!isSelectionEmpty()`), `isAnchorTarget`
   / `isEmailTarget` / `isUsernameTarget`, `isTag`, `mids` альбома (`chat.getMidsByMid`),
   `groupedMessages` + `mainMessage` (`getMainGroupedMessage`), `selectedMessages` (при selection),
   `noForwards` (= хоть одно из выбранных не проходит `appMessagesManager.canForward`),
   `linkToMessage` (`getUrlToMessage`, стр. 1773–1802: `https://t.me/<username>/<msgId>` либо
   `t.me/c/<chatId>/...`, с веткой thread/comment), `selectedMessagesText`
   (`getSelectedMessagesText`, стр. 1804–1851 — сортировка по дате, мета «имя, [дата]» при >1),
   `messageLanguage` (`detectLanguageForTranslation`, стр. 2284–2295).
   Клик по тегу без премиума → сразу `PopupPremium saved_tags` (стр. 443–446).
6. `init()` (стр. 1490–1771): `setButtons()` → `filterButtons()` → `ButtonMenu({buttons})`,
   `element.id='bubble-contextmenu'`, класс `contextmenu`.
7. Позиционирование: `side = bubble.is-in ? 'left' : 'right'` (стр. 550),
   `positionMenu(точка клика, element, side, menuPadding)` (стр. 553).
8. `contextMenuController.openBtnMenu(element, onClose)` (стр. 565–579): onClose обнуляет
   стейт, `cleanup()`, и через `setTimeout(destroy, 300)` удаляет DOM.

## 1.3 Фильтрация — `filterButtons` (contextMenu.ts:694–713)

- sponsored-пункты показываются только для sponsored-сообщений и наоборот (стр. 698);
- при активном selection остаются только пункты с `withSelection: true` (стр. 703);
- иначе `await button.verify()`.

## 1.4 Полный список пунктов (setButtons, contextMenu.ts:715–1315)

Порядок в массиве = порядок в меню. `withSelection` — виден в режиме выделения.

| # | Иконка | Текст | onClick | verify (суть) | Стр. |
|---|---|---|---|---|---|
| 0 | — | poll-ограничения (стат. текст) | noop | опрос с `subscribers_only`/`countries_iso2`, не закрыт | 860–873, 2119–2152 |
| 1 | checks | «views/read» (localName `views`, ЛС) | попап `PopupToggleReadDate` если приватность | `peerId.isUser() && canViewMessageReadParticipants` | 875–887 |
| 2 | more | сабменю пункта чеклиста | createChecklistItemSubmenu | `checklistItem !== undefined` | 888–896, 1317–1386 |
| 3 | more | сабменю варианта опроса | createPollAnswerSubmenu | `pollAnswer !== undefined` | 896–908, 1388–1432 |
| 4 | send2 | MessageScheduleSend | onSendScheduledClick | `type===Scheduled && !is_outgoing` | 908–913 |
| 5 | send2 | Selection.SendNow | onSendScheduledClick | Scheduled + выбрано + кнопка не disabled | 913–922 |
| 6 | schedule | MessageScheduleEditTime | `input.scheduleSending` → `editMessage({scheduleDate})` | `type===Scheduled` | 922–938 |
| 7 | message_quote | **Quote** | onQuoteClick | `!is_outgoing && messageInput && message.message && isTextSelected && !isTextFromMultipleMessagesSelected && (!peerTranslation.enabled() \|\| out) && (bubbles.canForward(msg) \|\| chat.canSend())` + выделение не рвёт `date`-маркап | 938–954 |
| 8 | reply | **Reply** | onReplyClick | `!isLegacy && !is_outgoing && messageInput && type!==Scheduled && (canForward \|\| canSend)` | 954–965 |
| 9 | bubblereply | ViewReplies [n] | `appImManager.openThread` | не в треде, `replies` без `comments` | 965–981 |
| 10 | bubblereply | ViewAllReplies | openThread по `reply_to_top_id` | не в треде, нет `replies`, есть `reply_to_top_id` | 981–997 |
| 11 | favourites/gifs | AddToFavorites / SaveToGIFs | onFaveStickerClick(false) | стикер/gif ещё не в избранном (кэш проверяется) | 997–1002, 844–857 |
| 12 | crossstar/crossgif | DeleteFromFavorites / RemoveGif | onFaveStickerClick(true) | уже в избранном | 1002–1007 |
| 13 | edit | **Edit** | onEditClick | `canEditMessage(msg,'text') && messageInput` (или своя suggested_post) | 1007–1014 |
| 14 | plusround | ChecklistAddTasks | onAddTaskClick | todo-медиа, `out \|\| others_can_append` | 1014–1024 |
| 15 | factcheck | Add/EditFactCheck | onEditFactCheckClick | `canUpdateFactCheck` | 1024–1029 |
| 16 | copy | **Copy** | onCopyClick | `!noForwards && message.message && !isTextSelected` (и не «копия текста ссылки») | 1029–1037 |
| 17 | copy | Chat.CopySelectedText | onCopyClick | `!noForwards && message.message && isTextSelected` | 1037–1042 |
| 18 | search | Chat.SearchSelected | `chat.initSearch({query: selection})` | `message.message && isTextSelected` | 1042–1050 |
| 19 | copy | Selection.Copy (withSel) | onCopyClick | выбран + `!noForwards` + хоть одно выбранное с текстом | 1050–1073 |
| 20 | copy | CopyLink / Copy.Email (withSel) | onCopyAnchorLinkClick | `isAnchorTarget` | 1073–1079 |
| 21 | copy | Copy.Username (withSel) | copy(textContent) | `isUsernameTarget` (`a.mention`) | 1079–1087 |
| 22 | copy | Copy.Hashtag (withSel) | copy(textContent) | `anchor-hashtag` | 1087–1095 |
| 23 | premium_translate | **TranslateMessage** | `openTranslatePopup` (для выделения — квот, для опроса — весь текст) | `!!messageLanguage` (язык определён и переводим) | 1095–1127 |
| 24 | link | CopyMessageLink1 | onCopyLinkClick (тост LinkCopied/…PrivateInfo) | `!isLegacy && isChannel && !isMonoforum && !is_outgoing` | 1127–1132 |
| 25 | pin | **Pin** | onPinClick → `PopupPinMessage(peerId, mid)` | `!isLegacy && !isMonoforum && !is_outgoing && !messageService && !pinned && canPinMessage && type!==Scheduled && !frozen` | 1132–1144 |
| 26 | unpin | **Unpin** | onUnpinClick → `PopupPinMessage(..., true)` | `pinned && canPinMessage && !frozen` | 1144–1151 |
| 27 | download | **Download** | `ChatContextMenu.onDownloadClick` → `appDownloadManager.downloadToDisc` | `canDownload` (см. §1.6) | 1151–1156 |
| 28 | checkretract | Chat.Poll.Unvote | `appPollsManager.sendVote(msg, [])` | голосовал, опрос не закрыт, `!revoting_disabled` | 1156–1167 |
| 29 | stop | Chat.Poll.Stop | `appPollsManager.stopPoll` | `canEditMessage(msg,'poll')` и опрос открыт | 1167–1179 |
| 30 | statistics | ViewStatistics | таб `AppStatisticsTab` в правой колонке | broadcast + `canViewStatistics` | 1179–1184, 2108–2117 |
| 31 | statistics | PollStats.View | тот же таб, режим 'poll' | `canViewPollStatistics` и не п.30 | 1184–1189 |
| 32 | forward | **Forward** | onForwardClick | `!noForwards && type!==Scheduled && (!is_outgoing \|\| SERVICE_PEER) && !messageService` | 1189–1197 |
| 33 | forward | Selection.Forward (withSel) | клик по кнопке selection-плашки | выбран + кнопка не disabled | 1197–1206 |
| 34 | download | Selection.Download (withSel) | onDownloadClick(selectedMessages) | среди выбранных есть скачиваемое | 1206–1212 |
| 35 | flag | ReportChat (withSel) | `showMessageReport` | `!out && message && !is_outgoing && isChannel` | 1212–1230 |
| 36 | select | **Select** (withSel) | `selection.toggleByElement(grouped-item \|\| bubble)` | не service, не выбран, `isSelectable` | 1230–1237 |
| 37 | select | Selection.Clear (withSel) | `selection.cancelSelection()` | выбран | 1237–1244 |
| 38 | — | «кто реагировал/прочитал» (localName `views`, группы) | `PopupReactedList` | не user-peer, есть recent_reactions или read participants | 1244–1260 |
| 39 | rotate_right | Resend | handleRepay (платные сообщения) | есть `repayRequest` | 1260–1265 |
| 40 | delete | **Delete** (danger; с TTL-подписью через `ContextMenuDeleteOptionText`) | onDeleteClick → `PopupDeleteMessages` | `canDeleteMessage` | 1265–1281 |
| 41 | delete | Selection.Delete (withSel, danger) | клик по кнопке selection-плашки | выбран + не disabled | 1281–1291 |
| 42 | … | sponsored-блок (What/About/Hide/Report/Remove ads, sponsor_info) | — | только sponsored | 107–183, 1292–1302 |
| 43 | — | «Message contains emoji pack(s)» (localName `emojis`) | `showStickersPopup(inputs)` | в сообщении есть кастомные эмодзи | 1303–1314, 1697–1749 |

Спец-наборы вместо общего меню:

- **ChatType.Logs** (стр. 716–736): только Copy + DownloadMedia.
- **Тег-реакция** (Saved Messages, стр. 738–795): FilterByTag / Rename (попап с `InputField`,
  maxLength 12) / RemoveTag (повторный `sendReaction` снимает) / «пак эмодзи».
- **Аватар группы** (стр. 797–835): SendMessage / OpenGroup2 / OpenChannel2 / Mention
  (`input.mentionUser`) / Search (`initSearch({filterPeerId})`).

Особые пункты `views`/`emojis` дособираются в `init()`:

- ЛС (стр. 1506–1543): иконка `checks`, шиммер-лоадер → `getOutboxReadDate` → «время прочтения»;
  при `YOUR_PRIVACY_RESTRICTED` — «Read … show when» (клик → `PopupToggleReadDate`).
- Группы (стр. 1543–1644): `getMessageReactionsListAndReadParticipants` → «Reacted N/M» или
  «MessageSeen N» + `StackedAvatars` (до 3, размер 22px); клик открывает `PopupReactedList`.
- `emojis` (стр. 1697–1749): `hr`-разделитель, «Message contains emoji pack(s)» / название сета.

## 1.5 Сабменю (форк использует `createSubmenuTrigger`)

- Чеклист-пункт (стр. 1317–1386): дата выполнения / Check-Uncheck (`updateTodo`) / Copy /
  Edit (`showChecklistPopup`) / Delete item (через `editMessage` с новым `inputMediaTodo`).
- Вариант опроса (стр. 1388–1432): ReplyToOption (reply c `replyToPollOption`) / CopyOption /
  CopyOptionLink (`?option=`); при открытом меню вариант подсвечивается —
  `highlightPollAnswer` (стр. 670–681).

## 1.6 Download — `canDownload` (contextMenu.ts:1434–1480)

`canSaveMessageMedia` + фото или любой документ; на десктопе требуется, чтобы правый клик был
именно по медиа (`.document`, `.audio`, `.media-sticker-wrapper`, `.media-photo`, `.media-video`,
стр. 1466–1472); на таче target не нужен. Сенситив-медиа со спойлером не скачивается (1474–1477).

## 1.7 Позиционирование и анимация

- `positionMenu(e, elem, side, padding)` — `src/helpers/positionMenu.ts:189–313`: меню ставится
  от `pageX/pageY`; `side` — сторона раскрытия ('left' у входящих, 'right' у исходящих, на
  мобилке инвертировано, RTL учтён, стр. 218–219); если не влезает — фолбэк в `center` +
  прижатие к краю; в конце вешает класс `bottom-left|bottom-right|center-...` (стр. 302–307) —
  он задаёт `transform-origin`.
- Появление — чистый CSS `_button.scss:98–240`: `.btn-menu` в покое
  `opacity:0; transform: scale(.8); visibility:hidden`, при `.active` —
  `opacity:1; scale3d(1,1,1)`; transition `var(--btn-menu-transition)`; на мобилке класс
  `was-open` оставляет scale=1 (анимируется только opacity).
- `contextMenuController.openBtnMenu` (`helpers/contextMenuController.ts:134–151`): добавляет
  `active was-open`, родителю — `menu-open`; на десктопе `mousemove`-слежка (стр. 39–70):
  увёл мышь дальше 100px от меню (40px для сабменю) — меню закрывается.
- Панель реакций пристраивается в `appendReactionsMenu` (contextMenu.ts:2229–2282): на десктопе
  пункты оборачиваются во внутренний `.btn-menu-items`, панель — сиблинг сверху
  (`element.has-items-wrapper`); ширина меню подгоняется, чтобы последняя видимая реакция
  обрезалась на 0.65 (стр. 2243–2250). `menuPadding` под панель — `getReactionsMenuPadding`
  (стр. 2192–2218: размер контейнера 36+8, слева 56 (+32 на таче), справа 40).

---

# 2. Reply-флоу

## 2.1 Типы и стейт

`ChatInputReplyTo = Pick<MessageSendingParams, 'replyToMsgId'|'replyToQuote'|'replyToPollOption'|'replyToStoryId'|'replyToPeerId'|'replyToMonoforumPeerId'>` (input.ts:194). Хранится полями `ChatInput` (стр. 286–288), собирается `getReplyTo()` (стр. 3937–3944), применяется `setReplyTo()` (стр. 4734–4743).

## 2.2 Вход в reply

| Путь | Код |
|---|---|
| Контекстное меню «Reply» | `onReplyClick` (contextMenu.ts:1861–1872): `getChatInputReplyToFromMessage(message)` → если `!chat.canSend()` — `createReplyPicker` (реплай в другой чат), иначе `input.initMessageReply(replyTo)` |
| Даблклик по баблу (десктоп) | bubbles.ts:1498–1542 (см. §9.3) |
| Свайп на таче / трекпаде | bubbles.ts:1543–1572 / 1713+ (см. §9) |
| «Quote» из меню | `onQuoteClick` (contextMenu.ts:2067–2106, см. §2.5) |
| Reply на вариант опроса | `onReplyToPollOptionClick` (contextMenu.ts:1874–1886) |

`getChatInputReplyToFromMessage` (input.ts:4581–4596): `{replyToMsgId: message.mid}` + quote +
`replyToMonoforumPeerId` для монофорумов.

## 2.3 `initMessageReply(replyTo)` (input.ts:4598–4671)

1. `deepEqual(getReplyTo(), replyTo)` → повторный reply на то же — no-op (стр. 4599).
2. Достаёт message (`getMessageByPeer`); если его нет — плашка «Loading» +
   `reloadMessage` с повторным рендером (стр. 4615–4632).
3. Заголовок: `PeerTitle` от `message.fromId`, обёрнутый в i18n `ReplyTo`/`ReplyToQuote`
   (стр. 4636–4643); для poll-option — `Chat.Poll.ReplyToOption`.
4. `setTopInfo({type:'reply', title, message, setColorPeerId: fromId, quote})` → плашка;
   `setReplyTo(replyTo)`.
5. Меню плашки (стр. 4665–4668): `replyInAnother` скрыт если `!bubbles.canForward(message)`,
   `doNotReply`/`doNotQuote` взаимоисключающие (по наличию quote); на десктопе меню — ховер
   (`DropdownHover`, `createReplyLineHover`, стр. 4699–4714), на таче — по клику
   (`openReplyLineMenuTouch`, стр. 4722–4732).

## 2.4 Плашка над композером — `setTopInfo` (input.ts:4831–4914)

DOM создаётся в `constructReplyElements` (стр. 624–672): `.reply-wrapper.rows-wrapper-row` →
`.reply-wrapper-content` [`iconBtn`, `wrapReply(...)`, `cancelBtn (close reply-cancel)`].
Механика `setTopInfo`:

- `type: 'reply' | 'edit' | 'forward' | 'suggested' | 'webpage'`; для не-webpage —
  `clearHelper(type, true)` + `helperType/helperFunc` (стр. 4850–4854);
- иконка слева = имя типа (`reply`/`edit`/`forward`, для webpage — `link`) (стр. 4867);
- контент — `wrapReply({title, subtitle, message, quote})` — тот же рендерер, что reply-заголовок
  в бабле; цвет полоски — `setPeerColorToElement(fromId)` (стр. 4878);
- контейнеру чата ставится класс `is-helper-active` + транзишен `is-toggling-helper` 150мс
  (`t()`, стр. 4797–4808) — композер «подрастает»;
- на десктопе пушится navigation item `input-helper` → Esc/Back вызывает `onHelperCancel`
  (стр. 4893–4901).

Меню reply-плашки (стр. 640–667): `ShowMessage` (`message_jump`), `ReplyToAnotherChat`
(`replace` → `changeReplyRecipient`, стр. 3907–3924), `DoNotReply`/`DoNotQuote` (danger).

Клик по плашке — `onHelperClick` (стр. 3859–3880): для reply —
`chat.setMessageId({lastMsgId: replyToMsgId})` — **прыжок к оригиналу**; для edit — к
редактируемому; для forward на таче — открывает меню плашки.

## 2.5 Reply с квотом («Quote»)

- verify пункта — см. §1.4 п.7 (текст выделен, в пределах одного сообщения).
- `onQuoteClick` (contextMenu.ts:2067–2106): `getRichSelection(target)` → `{text, entities, offset}`;
  обрезка по `appConfig.quote_length_max` (дефолт 1024) с фиксом entities (стр. 2072–2089);
  далее тот же `initMessageReply` с `replyToQuote = {text, entities, offset}`.
- В плашке рендерится сам текст квота (`quote` параметр `wrapReply`), заголовок «Reply to quote».
- При отправке (`sendMessage` → `sendText`) уходит `reply_to_msg_id` + `quote_text/quote_entities/quote_offset` (input.ts:2098–2107).

## 2.6 Reply в треде / reply-picker

- В треде reply работает так же — `chat.threadId` уходит в `getMessageSendingParams`; сообщения
  треда сами по себе replyTo top-сообщения.
- Если писать в чат нельзя (`!chat.canSend()`) — `createReplyPicker` (input.ts:3926–3935):
  `showReplyPickerPopup` (выбор чата) → `setInnerPeer` → `initMessageReply` уже в новом чате.

## 2.7 Отмена — `onHelperCancel` (input.ts:3756–3857) и `clearHelper` (4745–4795)

- reply: `saveDraftDebounced()` → `clearHelper()` — плашка убирается, `is-helper-active`
  снимается (если не будет следующего хелпера), navigation item удаляется.
- Автоотмена: удаление сообщения, на которое отвечаем — `history_delete` →
  `clearHelper('reply')` (стр. 1614–1615).
- webpage-хелпер при отмене восстанавливает предыдущий хелпер через `helperFunc` (стр. 3761–3778).

## 2.8 Клик по reply-заголовку бабла → прыжок к оригиналу

bubbles.ts `onBubblesClick`, стр. 3520–3616:

1. `isReplyClick = target.closest('.reply, .bubble.service.is-reply')` (стр. 3523).
2. Спец-случаи: reply на стори → `createStoriesViewerWithPeer` (3541–3550);
   `reply_to_msg_deleted` → тост `DeletedMessageToast` (3552–3555); нет `reply_to_msg_id`
   (приватный quote/reply) → тост `QuotePrivate`/`ReplyPrivate` (3557–3561).
3. В дискуссии реплай на channel_post мапится на пересланный пост (3569–3584).
4. `this.followStack.push(bubbleFullMid)` (3586) — запоминаем, откуда прыгнули.
5. `setInnerPeer({peerId: replyToPeerId, lastMsgId: replyToMid, threadId, ...})` (3605–3613) →
   скролл к сообщению + `highlightBubble`.

Подсветка — `highlightBubble` (bubbles.ts:4765–4778): класс `is-highlighted` на 2000мс
(с рестартом через reflow). Возврат — кнопка go-down (стр. 3853–3895): пока `followStack`
непуст, кнопка возвращает по стеку (`followStack.pop()` → `setMessageId({lastMsgId})`),
иначе скроллит вниз.

---

# 3. Edit-флоу

## 3.1 Какие сообщения можно редактировать

`canMessageBeEdited` (appMessagesManager.ts:5773–5804): не `is_outgoing`; media только из
`messageMediaPhoto | Document | WebPage | ToDo` (+ `Poll` для kind='poll'); нельзя
`fwd_from`, `via_bot_id`, сообщения ботов; documents — нельзя стикер и round-видео.

`canEditMessage` (5806–5839): свои Saved Messages — всегда можно; канал — право
`edit_messages`; иначе `pFlags.out` (+ для групп send_plain/send_media); ограничение по
времени `config.edit_time_limit` (кроме каналов и опросов).

## 3.2 Вход — `onEditClick` (contextMenu.ts:1898–1914)

- todo-сообщение → `showChecklistPopup({editMessage})`;
- suggested post → `input.initSuggestPostChange(mid)`;
- иначе `input.initMessageEditing(isTargetAGroupedItem ? mid : message.mid)` — для альбома
  редактируется именно тот элемент, по которому кликнули (текст берётся у сообщения с текстом,
  `getMessageWithText`, стр. 1482–1484).

## 3.3 `initMessageEditing(mid)` (input.ts:4388–4423)

1. `wrapDraftText(message.message, {entities: totalEntities})` — маркдаун-разметка обратно
   в инпут.
2. Если инпут был заблокирован (нельзя писать) — временно `contentEditable='true'` +
   смена плейсхолдера, с restore-колбэком (стр. 4393–4404, 4777–4780).
3. `setTopInfo({type:'edit', title: i18n('AccDescrEditing'), subtitle: wrapMessageForReply(message), input})` —
   плашка «Editing» + текст сообщения кладётся в инпут (через `setInputValue`, каретка в конец).
4. `editMsgId = mid`, `editMessage = message`.
5. `inputState.isEditing = true` (setTopInfo, стр. 4856–4859); иконка кнопки отправки меняется
   на `edit`/галочку (стр. 3989).

## 3.4 Media edit (форк: медиа-редактор)

- `editMediaWithEditor` (input.ts:5010–5080): берёт «живой» элемент медиа из бабла
  (`tryGetEditMediaElementFromChat`, стр. 4977–5008 — `.media-video`/`.media-photo`, только если
  виден во вьюпорте), скачивает блоб с прогрессом на attach-кнопке (`watchDownloadProgress`,
  5082–5137), открывает `openMediaEditorFromMedia`; результат заворачивается в
  `PopupNewMedia(..., editResult)` — т.е. замена медиа идёт через попап нового медиа.
- Видео редактируется только до `MAX_EDITABLE_VIDEO_SIZE` (стр. 5181).

## 3.5 Подтверждение / отправка

- `sendMessage()` ветка `editMsgId` (input.ts:4272–4292): `getRichValueWithCaret` →
  `appMessagesManager.editMessage(message, value, {entities, noWebPage, webPage, ...})` →
  `onMessageSent()`. Если текст пуст и медиа нет — вместо сохранения открывается
  **PopupDeleteMessages** (стр. 4290).
- Отмена (`onHelperCancel`, стр. 3780–3850): собирается «оригинальный драфт» из сообщения
  и сравнивается с текущим содержимым инпута (`draftsAreEqual`, с фильтрацией не-markdown
  entities); если отличаются — попап `discard-editing` («Alert.Confirm.Discard» /
  `Chat.Edit.Cancel.Text`); иначе тихий `clearHelper` (который на edit также `clearInput()`,
  стр. 4746–4748).
- Удаление редактируемого сообщения извне → `history_delete` → отмена редактирования
  (стр. 1610–1616).

---

# 4. Forward-флоу

## 4.1 Точки входа

- Пункт меню Forward — `onForwardClick` (contextMenu.ts:2023–2033): не в selection —
  `showForwardPopup({[peerId]: mids})` (альбом целиком, либо один элемент, если клик был по
  grouped-item); в selection — клик по кнопке плашки.
- Кнопка-«беседка» рядом с баблом (`.bubble-beside-button.forward`) — bubbles.ts:3511–3518:
  `showForwardPopup({[peerId]: getMidsByMessage(message)})`.
- Selection-плашка (selection.ts:1108–1118): собирает `{[fromPeerId]: mids[]}` по всем
  выбранным peer'ам.

## 4.2 Попап выбора получателя

`showForwardPopup` → `PopupForward` (наследник `PopupPickUser`) — множественный выбор чатов,
поле комментария. **TODO: см. popups.md** (внутренности
PopupForward/PopupPickUser: селектор, чипы, поле «добавить комментарий», кнопка Send).

После выбора получателя открывается чат получателя и вызывается
`input.initMessagesForward(fromPeerIdsMids)`.

## 4.3 Плашка forward — `initMessagesForward` (input.ts:4462–4579)

- Считает авторов (`smth: Set<'P'+peerId | 'N'+fwdName>`) и число сообщений с подписями
  (стр. 4469–4494).
- Заголовок: `Chat.Accessory.Forward [n]` либо `Chat.Accessory.Hidden [n]` (если скрываем
  автора); субтитр: для 1 сообщения/целого альбома — `имена: текст` (`wrapMessageForReply`),
  иначе «From: имена» (до 2 имён полностью, дальше `AndOther [n]`) (стр. 4517–4558).
- `setTopInfo({type:'forward'})`, `this.forwarding = fromPeerIdsMids`.

## 4.4 Опции «переслать без имени/подписей»

Меню плашки — `constructForwardElements` (input.ts:674–767), радиогруппы:

| Пункт | Радиогруппа | Действие |
|---|---|---|
| Show sender / Hide sender | `author` | live-обновляет заголовок плашки (стр. 726–740); запоминается в `forwardWasDroppingAuthor` |
| Show caption / Hide caption | `caption` | hide caption форсит hide sender (стр. 744–755); форма скрыта, если подписей нет (стр. 4508–4515) |
| Forward to another chat | — | `changeForwardRecipient` (стр. 3882–3905): свернуть хелпер → снова `showForwardPopup`, при отмене — восстановить плашку через `helperFunc` |
| Do not forward (danger) | — | `onHelperCancel` |

## 4.5 Отправка

`sendMessage` → `ChatInput.sendMessageWithForward` (вызов input.ts:4233–4251) с
`forwardParams: {dropAuthor: hideSender.checked, dropCaptions: isDroppingCaptions()}` →
`appMessagesManager.forwardMessages`. Текст в инпуте (если есть) уходит отдельным сообщением
перед пересылкой.

---

# 5. Pin-флоу

## 5.1 Из контекстного меню

- Pin: `PopupElement.createPopup(PopupPinMessage, peerId, mid)` (contextMenu.ts:1994–1996).
- Unpin: `PopupPinMessage(peerId, mid, true)` (стр. 1998–2000).
- verify-условия — §1.4 п.25–26 (`canPinMessage` = права `pin_messages`; в ЛС можно всегда).

## 5.2 Попап `PopupPinMessage` (`src/components/popups/unpinMessage.ts`)

Ветки pin / unpin / unpin-all, чекбоксы «Notify all members» (silent) и «Pin for me and X»
(oneSide) — **TODO: см. popups.md**.

## 5.3 Pinned bar в топбаре и экран Pinned Messages

`src/components/chat/pinnedMessage.tsx` (`ChatPinnedMessage` + `PinnedContainer`/
`replyContainer.ts`, сегментная полоска `pinnedMessageBorder.ts`), экран `ChatType.Pinned`
с кнопкой «Unpin all» вместо композера — **TODO: см. popups.md**
(раздел pinned). Опорные факты из уже прочитанного: дата-бабл/сервисные пины исключаются из
selection (`canSelectBubble`); клик по `.time` на десктопе не пинит, а тогглит selection
(bubbles.ts:3118–3121); в `ChatType.Pinned` отключены dblclick-reply и свайп-reply
(bubbles.ts:1500, 1548).

---

# 6. Delete-флоу

## 6.1 Точки входа

- Меню Delete → `onDeleteClick` (contextMenu.ts:2043–2061):
  `PopupDeleteMessages(peerId, isTargetAGroupedItem ? [mid] : getMidsByMid(mid), chat.type)` —
  альбом удаляется целиком, если клик не по конкретному элементу.
- Selection-плашка (selection.ts:1085–1096): `PopupDeleteMessages(peerId, getSelectedMids(), type, onConfirm→cancelSelection)`.
- Пустой текст при edit (input.ts:4290) — тоже `PopupDeleteMessages`.

## 6.2 Право удаления

`canDeleteMessage` (appMessagesManager.ts:5841–5848): ЛС — всегда; свои (`out`); legacy-группа —
всегда; иначе право `delete_messages`; недоставленные (`is_outgoing`) — только с ошибкой.

## 6.3 Попап

`PopupDeleteMessages` (`src/components/popups/deleteMessages.ts`): текст «Delete N messages»,
чекбокс «удалить у всех / у X» (revoke), особые ветки для каналов (без чекбокса, всегда revoke),
scheduled и т.д. — **TODO: см. popups.md**. Пункт меню Delete
показывает TTL-подпись через `ContextMenuDeleteOptionText` (contextMenu.ts:1266–1278).

---

# 7. Реакции

## 7.1 Слои

| Слой | Файл | Суть |
|---|---|---|
| Быстрая панель в контекстном меню | `reactionsMenu.ts` | 7 реакций + кнопка «ещё» |
| Полный пикер | `reactionsMenu.ts` `onMoreClick` (стр. 384–493) | `EmojiTab` + `EmoticonsDropdown` |
| Отображение на бабле | `reactions.ts` (`reactions-element`) | список `reaction-element` |
| Одна реакция | `reaction.ts` | счётчик/аватарки/is-chosen/эффекты |
| Оптимистика | `appReactionsManager.sendReaction` (стр. 647) | локальный апдейт до API |
| Меню реакции | `reactionContextMenu.ts` | кто поставил, паки, удаление чужих |

## 7.2 Быстрая панель (`ChatReactionsMenu`)

- Создаётся в `ChatContextMenu.init` (contextMenu.ts:1646–1695) если: не Logs, есть message
  (или service с `reactions_are_possible`), не selection, не `is_outgoing`, не scheduled,
  не local, и меню открыто не по реакции. Для Saved Messages панель работает в режиме тегов
  (`isTags`, стр. 1660).
- Константы (reactionsMenu.ts:39–48): `REACTIONS_MAX_LENGTH = 7`, `REACTION_SIZE = 28`,
  контейнер 40px (28+2×6).
- Источник — `getAvailableReactionsByMessage` (стр. 230–260); `chatReactionsNone` → панели нет;
  не-`chatReactionsAll` или достигнут `reactions_uniq_max` → `noPacks/noSearch` у пикера.
- Каждая реакция — два lottie: `appear_animation` (проигрывается при открытии) и
  `select_animation` (по ховеру, `onMouseMove`, стр. 724–749); без анимаций — `static_icon`.
- Клик (стр. 159–172) → `onFinish(reaction)` → в contextMenu.ts:1669–1687: закрыть меню;
  `reactionPaid` → `PopupStarReaction`; тег без премиума → `PopupPremium`; иначе
  `chat.sendReaction({message: reactionsMessage, reaction})` (для альбома — реакция вешается
  на первое сообщение группы, `getGroupsFirstMessage`, стр. 1661–1663).
- Кнопка «ещё» (стр. 184–192) → `onMoreClick`: полноценный `EmojiTab`
  (`noRegularEmoji`, mainSets = топ+рекент реакции; кастом-эмодзи с замком для не-премиума через
  `freeCustomEmoji`) в `EmoticonsDropdown` с позицией от панели
  (`getReactionsOpenPosition`, contextMenu.ts:2220–2227). Выбор в пикере тоже резолвится в
  `onFinish` через deferred (стр. 485–490).
- Появление панели: класс `is-visible` ставится после первого рендера/после открытия меню
  (`appendReactionsMenu.onAfterInit`, contextMenu.ts:2270–2281) — CSS-анимация.

## 7.3 Клик по реакции на бабле

bubbles.ts:3245–3279: клик по `reaction-element` → `cancelEvent`; `is-inactive` игнор;
тег в Saved Messages → премиум-гейт → `initSearch({reaction})`; иначе
`chat.sendReaction({message: reactionsElement.getContext(), reaction})` — т.е. **клик тогглит
реакцию** (снятие происходит в оптимистике менеджера).

**Даблклик быстрый-реакцией не является**: dblclick на десктопе — это reply (§9.3).

## 7.4 Оптимистичное применение — `appReactionsManager.sendReaction` (647–966)

1. Копирует `message.reactions` (стр. 732).
2. Снимает лишние chosen: повторная реакция → unset; превышение лимита `reactions` (1/3 у
   премиума) → вытесняется самая старая chosen (стр. 733–752, `unsetReactionCount` 691–716
   декрементит count, чистит recent_reactions, удаляет нулевые).
3. Добавляет новую: `++count`, `chosen_order`, `recent_reactions.unshift(me)` (максимум 3)
   (стр. 754–856); для Saved Messages первый results ставит `reactions_as_tags` (стр. 767–769).
4. Пересортировка по count + порядку доступных реакций; paid всегда первая (стр. 861–878).
5. `apiUpdatesManager.processLocalUpdate({_: 'updateMessageReactions', ..., local: true})`
   (стр. 894–900) — **UI обновляется сразу**, ререндер идёт обычным путём событий
   `messages_reactions`.
6. Затем `messages.sendReaction` с полным списком chosen (стр. 947–951); при
   `REACTION_INVALID` — откат локальным повтором (стр. 952–960). Paid — отдельная ветка
   `messages.sendPaidReaction` с random_id (стр. 930–944) и 5-секундным undo-окном
   (`chat.sendReaction`, chat.ts:1457–1554: `PENDING_PAID_REACTIONS`, тултип с отменой,
   `PopupStars` при нехватке звёзд).

## 7.5 Рендер и анимации — `ReactionsElement.render` (reactions.ts:259–429)

- Типы раскладки (reaction.ts:37–52): `inline` (14px, в ЛС поверх текста), `block` (22px,
  плашки под сообщением), `tag`. Счётчик показывается от `REACTIONS_DISPLAY_COUNTER_AT`
  (inline ≥2, block ≥4), до этого — стек аватарок (`renderAvatars`, reaction.ts:1060+,
  только если `can_see_list`).
- Диф по имеющимся `reaction-element` (reactions.ts:291–356): удаление/переиспользование/
  создание, позиционирование `positionElementByIndex`; кастом-эмодзи рендерятся общим
  `CustomEmojiRendererElement` (канвас на весь контейнер, стр. 376–418).
- `setIsChosen` (reaction.ts:1086–1097): класс `is-chosen` через `SetTransition` 300мс —
  CSS-анимация заливки.
- `update(context, changedResults)` вызывается из bubbles по `messages_reactions`;
  изменённые реакции получают `fireAroundAnimation` (reactions.ts:431–446, задержка 150мс если
  «unread» реакция): around-эффект (лотти вокруг иконки, 80px для block) + масштаб-эффект
  иконки. Механика «flight» (снапшот кликнутой иконки летит из меню к баблу,
  `stashFlightSource`, reaction.ts:555–602; прогрев generic-эффекта 604–713) — **форк-специфика**,
  в оригинале — только around/center анимации.
- Пейд-реакция: локальный каунтер и класс `effect-active` пока идёт undo-окно
  (reactions.ts:362–374); пустая paid-кнопка (count 0) добавляется на посты каналов
  (`shouldAddEmptyPaidReaction`, стр. 234–257).

## 7.6 Контекстное меню реакции (`reactionContextMenu.ts`)

Открывается из `ChatContextMenu.onContextMenu` по правому клику/лонгтапу на реакции
(contextMenu.ts:392–413; условие: кастом-эмодзи, или `can_see_list`, или ЛС) через
`openReactionContextMenu` (стр. 587–668): позиционируется `positionFloatingMenu` от рамки
реакции (`top-start|end`, offset 8). Содержимое (reactionContextMenu.ts:73–295): до 6
реагировавших (аватар + имя + время; клик — открыть профиль), «ShowAllReactions» →
`PopupReactedList`, «пак» для кастом-эмодзи, удаление чужой реакции админом (крестик на
ховере / long-press на таче, `deleteParticipantReaction`).

---

# 8. Selection-режим

## 8.1 База — `AppSelection` (selection.ts:51–580)

- Стейт: `selectedMids: Map<PeerId, Set<mid>>`, `isSelecting` (стр. 54–55).
- **Вход на таче** (стр. 117–157): long-press по баблу (`attachContextMenuListener`) →
  `toggleByElement`; body получает `no-select`, первый touchend гасится.
- **Вход мышью** (стр. 163–306): mousedown по баблу + движение → drag-выделение;
  `processElement` (стр. 196–252) тогглит новые баблы, добирая пропущенные через
  `getElementsBetween` (стр. 308–336 — все `.bubble:not(.is-multiple-documents), .grouped-item`
  между первым и текущим); реальный тоггл начинается со второго бабла (стр. 240–247);
  выделение текста браузера отменяется.
- `toggleSelection` (стр. 423–473): переключение режима; `listenElement.no-select`;
  событие `toggle`; navigation item (`multiselect-…`) → Back/Esc = `cancelSelection`.
- Чекбоксы: `toggleElementCheckbox` (стр. 346–378) — `CheckboxField({round:true})`
  препендится в бабл; снятие — `SetTransition 'is-selected'` 200мс.
- `updateContainer` (стр. 385–403): по всем выбранным — `cantForwardDeleteMids` → дизейбл
  кнопок плашки.
- Явного числового лимита нет: старый лимит `forwarded_count_max` закомментирован
  (стр. 526–543); фактический предел — дизейбл Forward при непересылаемых.

## 8.2 `ChatSelection` (selection.ts:764–1189)

- `canSelectBubble` (стр. 999–1006): не `service`, не `is-outgoing`, не `is-error`,
  не `bubble-first`, не `avoid-selection`.
- Альбомы: выбор group-контейнера = выбор всех элементов; чекбокс контейнера отражает
  «все выбраны» (стр. 900–976).
- Вход из меню: пункт Select → `toggleByElement` (contextMenu.ts:2035–2037); также клик по
  `.time` бабла на десктопе (bubbles.ts:3118–3121). В режиме selection любой клик по баблу
  тогглит выбор (bubbles.ts:3156–3172).
- **Панель действий** — плашка вместо композера, `onToggleSelection` (стр. 1008–1136):
  `chatInput` и контейнер получают класс `is-selecting` (SetTransition 200мс), создаётся
  `.chat-input-wrapper.selection-wrapper` → `ChatInputPlate`:
  - слева `delete` (danger) → `PopupDeleteMessages` (стр. 1085–1096);
  - в центре «N messages» — клик снимает выделение (стр. 1080–1082);
  - справа `forward` → `showForwardPopup` (стр. 1108–1118), для Scheduled — `send2` →
    `PopupSendNow` (стр. 1100–1106).
  - Отдельный report-режим (enterReportSelection, стр. 833–845): слева «close», в центре
    «Report N Messages».
- Счётчик/дизейбл — `onUpdateContainer` (стр. 1138–1157).
- Выход: центр-кнопка, Esc/Back, пункт Clear selection, удаление всех выбранных.

---

# 9. Свайп-ответ и даблклик

## 9.1 Тач-свайп (bubbles.ts:1543–1572)

`handleHorizontalSwipe` на контейнере: `verifyTouchTarget` — не Pinned, не selection,
`chat.canSend()`, бабл не `service`/`is-sending`. Общий визуальный контроллер
`createReplySwipeController` (стр. 1586–1706):

- `MAX = 64` px, порог ответа `replyAfter = 48` (0.75×MAX);
- на первом движении — класс `is-gesturing-reply` (SetTransition 250мс) на бабл и групповую
  аватарку + иконка `reply_filled.bubble-gesture-reply-icon` в бабл (стр. 1616–1635);
- движение: `translateX(-min(64, xDiff))` баблу и аватарке; opacity иконки = xDiff/48;
  при пороге иконке ставится `is-visible` (стр. 1637–1657); контекстное меню отменяется
  (`cancelContextMenuOpening`);
- отпускание (`reset`, стр. 1659–1703): снятие классов/transform, фейд иконки (`is-hiding`);
  если порог был достигнут — `initMessageReply(getChatInputReplyToFromMessage(message))`.

## 9.2 Трекпад-свайп (форк) — `attachReplyWheelSwipe` (bubbles.ts:1713+)

Двухпальцевый горизонтальный wheel-свайп: тот же контроллер; ось фиксируется на жест,
масштаб 0.25, конец жеста — по 75мс тишины или эвристике инерции.

## 9.3 Даблклик = reply (десктоп, bubbles.ts:1497–1542)

Не в Pinned/Logs, не в selection, `canSendPlain`; игнор по `attachment|audio|document|contact|
time|code-header-button|reaction|bubble-beside-button|poll-message-content`; цель — сам бабл
или пустое место (выделение текста не мешает, если оно схлопнулось/пустое); не `is-outgoing`
→ `initMessageReply`.

---

# 10. Клик по частям бабла — `onBubblesClick` (bubbles.ts:3014–3627)

Порядок проверок (существенно — первый матч выигрывает):

| Цель | Действие | Стр. |
|---|---|---|
| `user-avatar` вне бабла (групповая аватарка) | `setInnerPeer(peerId)`; скрытый аккаунт → тост `HidAccount` | 3031–3052 |
| дата-бабл | попап-календарь (`showDatePickerPopup`), в ЛС — с multi-select «Clear History» | 3058–3110 |
| `time-effect` (эффект сообщения) | проиграть эффект | 3112–3116 |
| `.time` (десктоп) | `selection.toggleByElement(bubble)` | 3118–3121 |
| дайс/эмодзи-слот | тултип с «отправить такой же» | 3123–3153 |
| режим selection | `cancelEvent` + toggle выбора | 3156–3172 |
| `.contact` | открыть peer / скопировать телефон | 3174–3190 |
| `.bubble-call` | `callUser` | 3192–3196 |
| `.is-buy` (инвойс) | `PopupPayment` | 3198–3234 |
| `.media-spoiler-container` | раскрыть спойлер | 3236–3243 |
| `reaction-element` | тоггл реакции / поиск по тегу (§7.3) | 3245–3279 |
| `[data-sticker-emoji]` (большие эмодзи) | анимация/эмодзи-пак (`showStickersPopup`) | 3281–3305 |
| `quote-like-collapsable` | развернуть/свернуть квот (`onQuoteClick` из bubbleParts) | 3307–3313 |
| `.replies` (кнопка комментариев) | открыть тред: `openThread` / `setInnerPeer(type: Discussion, threadId: discussionMsg.mid)` | 3315–3343 |
| **via-бот** (`.is-via .peer-title`) | подставить `@bot ` в драфт (`setDraft`) | 3346–3358 |
| **имя / аватар / forwarded-from** (`peer-title`, avatar, `[data-saved-from]`, `[data-follow]`) | `data-saved-from` → прыжок к оригиналу (`setInnerPeer({peerId, lastMsgId})`), receipt/game — свои попапы; иначе открыть peer; `NULL_PEER_ID` → тост `HidAccount` | 3360–3420 |
| стикер (`bubble.sticker` + `.attachment`) | `showStickersPopup(stickerSetInput)` | 3432–3442 |
| стикер в варианте опроса | showStickersPopup | 3444–3456 |
| **медиа** | `checkTargetForMediaViewer(target, e)` (стр. 3641+) → медиавьювер; `cancelClickOrNextIfNotClick` | 3479–3482 |
| **webpage** (`.webpage`) | `dispatchWebPageClick` — обработчик из `wrapUrl` (см. `getWebPageActionOnClick.ts`: синтезируется `<a safe>` и зовётся `window[onclick]`) | 3484–3497 |
| `.goto-original` (плашка «переслано из» на канале) | `setInnerPeer` по `bubble.dataset.savedFrom` | 3502–3510 |
| `.forward` (beside-кнопка) | `showForwardPopup` (весь альбом) | 3511–3518 |
| **reply-заголовок** (`.reply`) | прыжок к оригиналу + followStack (§2.8) | 3520–3616 |
| service `messageActionBoostApply` | `PopupBoost` | 3619–3626 |

---

# 11. У нас (web-client) — главные расхождения

> Ниже — краткий срез. Полный аудит нашего клиента по всем 10 пунктам —
> **TODO: см. popups.md** (или отдельный аудит-док).

Что есть (файлы):

| Область | Наш файл | Комментарий |
|---|---|---|
| Контекстное меню | `src/components/conversation/MessageContextMenu.tsx` (182 строки) | декларативный список `MenuItem {label, ...}` с i18n `t(label)`; на порядок меньше пунктов, чем в tweb (нет Quote/translate/statistics/fact-check/фаворитов/тегов/views-строки) |
| Композер/плашки | `src/components/Composer.tsx` (756 строк) | reply/edit-плашка живёт внутри композера, а не отдельным `rows-wrapper` с ховер-меню (`ShowMessage`/`ReplyToAnotherChat`/`DoNotReply` отсутствуют) |
| Реакции | `src/components/messages/MessageReactions.tsx` (171 строка) | нет `ChatReactionsMenu`-панели с lottie appear/select, нет around-эффектов и стека аватарок; кастом-эмодзи-реакций нет |
| Бабл/клики | `src/components/messages/MessageRow.tsx`, `MessageContent.tsx` | роутинг кликов размазан по React-обработчикам, нет единого делегата уровня контейнера как `onBubblesClick` |
| Медиавьювер | `src/components/mediaViewer/appMediaViewer.ts`, `base.ts` | порт tweb (программа «tweb media model») |

Ключевые структурные расхождения с tweb, которые надо закрыть при порте 1:1:

1. **Меню**: в tweb — один делегат на контейнере (`attachTo`), verify-модель с async-фильтрацией,
   спец-наборы (тег/аватар/logs/sponsored), сабменю чеклиста/опроса, строка views/read с
   аватарками, панель реакций внутри меню, позиционирование `positionMenu` + CSS scale(.8)→1
   от `transform-origin`. У нас — статичный список пунктов у конкретного сообщения.
2. **Reply**: у нас нет reply-с-квотом, reply-in-another-chat, poll-option-reply, прыжка со
   стеком возврата (`followStack`) и подсветки `is-highlighted` (2с).
3. **Edit**: нет попапа discard-editing при отмене с изменённым текстом, нет media-edit,
   нет «пустой текст при edit → попап удаления».
4. **Forward**: нет плашки forward над композером и радиогрупп hide sender/caption.
5. **Selection**: режим целиком отсутствует (drag-выделение мышью, long-press, чекбоксы,
   плашка delete/count/forward вместо композера).
6. **Свайп-ответ** на таче отсутствует (порог 48px, MAX 64px, иконка `reply_filled`).
7. **Реакции**: у нас нет оптимистики уровня менеджера с локальным
   `updateMessageReactions` + откатом по `REACTION_INVALID`, нет тегов Saved Messages и
   paid-реакций (последние нам и не нужны).

---

## Приложение: последовательности вызовов (шпаргалка)

```
Правый клик по баблу
  ChatContextMenu.onContextMenu (contextMenu.ts:350)
    prepareForMessage (427) → init (1490) → setButtons (715) → filterButtons (694)
    → ButtonMenu → [ChatReactionsMenu.init (reactionsMenu.ts:288)]
    → appendReactionsMenu (2229) → positionMenu (positionMenu.ts:189)
    → contextMenuController.openBtnMenu (contextMenuController.ts:134)

Reply
  onReplyClick (1861) → input.getChatInputReplyToFromMessage (input.ts:4581)
    → input.initMessageReply (4598) → setTopInfo('reply') (4831) → setReplyTo (4734)
  отправка: sendMessage (4221) → sendText({reply_to_msg_id, quote_*}) (2098)
  отмена: onHelperCancel (3756) → clearHelper (4745)

Edit
  onEditClick (1898) → initMessageEditing (4388) → setTopInfo('edit') + setInputValue
  подтверждение: sendMessage (4272ff) → appMessagesManager.editMessage
  отмена: onHelperCancel (3780ff) → [PopupPeer 'discard-editing'] → clearHelper

Forward
  onForwardClick (2023) → showForwardPopup → (в чате получателя) initMessagesForward (4462)
    → setTopInfo('forward') → sendMessage → sendMessageWithForward({dropAuthor, dropCaptions})

Реакция
  клик по reaction-element (bubbles.ts:3245) / панель (reactionsMenu.ts:159)
    → chat.sendReaction (chat.ts:1457)
    → appReactionsManager.sendReaction (647): локальный updateMessageReactions (894)
      → messages.sendReaction (948) → [REACTION_INVALID → откат (952)]
  рендер: ReactionsElement.update/render (reactions.ts:229/259)
    → ReactionElement.setIsChosen (reaction.ts:1086) / fireAroundAnimation (1099)

Прыжок к оригиналу reply
  onBubblesClick (3014) → isReplyClick (3523) → followStack.push (3586)
    → setInnerPeer({lastMsgId}) (3605) → scrollToBubble + highlightBubble (4765)
  возврат: go-down → followStack.pop → setMessageId (3853–3895)
```

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Контекст-меню на своём, чужом, медийном и сервисном сообщении: наборы пунктов отличаются по `verify`.
- [ ] Reply обычный и с квотой; отмена крестиком и по Esc.
- [ ] Редактирование текста и медиа; выход из режима правки не оставляет плашку.
- [ ] Forward: выбор получателя, опции «без имени» и «без подписи».
- [ ] Pin / unpin, удаление для себя и для всех.
- [ ] Множественное выделение: счётчик, действия над выделенным, выход из режима.
- [ ] Свайп-ответ на тач-устройстве.
- [ ] Реакции: панель в меню, установка, снятие, длинный тап.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 05-context-menu, 17-popup-01-forward-share, 17-popup-03-delete-message.
