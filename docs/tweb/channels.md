# tweb: полный функционал канала vs наш клиент

Снято 2026-08-15. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb` (`e52b5d931`);
- живой DOM `web.telegram.org/k` через Chrome — свой канал (владелец, 2 подписчика)
  и подписной канал 19 458 подписчиков;
- наш код `web-client/` и `backend/` на `main` (`61c76d3f`).

Дополняет `comments.md` (там — комментарии и треды,
здесь — весь остальной канал).

Легенда: **✅** есть 1:1 · **🟡** есть, но расходится · **❌** нет.

---

## 1. Что вообще делает канал каналом

Три предиката (`lib/appManagers/appPeersManager.ts:109-139`) — от них питается всё остальное:

```ts
isBroadcast(peerId)  = isChannel(peerId) && !isMegagroup(peerId)
isAnyGroup(peerId)   = !peerId.isUser() && !isBroadcast(peerId)
isLikeGroup(peerId)  = isAnyGroup(peerId) || peer.pFlags.signature_profiles
```

`Chat` кэширует их в `isBroadcast / isAnyGroup / isMegagroup / isLikeGroup` (`chat.ts:143-147, 908-946`)
и дальше все ветки рендера спрашивают именно эти поля, а не тип пира напрямую.

У нас эквивалента нет: везде инлайн `chat.type === 'channel'` / `chat.type === 'group'`
(`Chat.tsx:183-184`), а `signature_profiles` в рендере не участвует вовсе.

## 2. Лента: бабл поста

### 2.1 Сторона бабла — корень расхождения

```ts
// chat.ts:1374
isOurMessage(message) {
  if (this.isMegagroup) return !!message.pFlags.out;
  if (message.fromId === rootScope.myId && !message.pFlags.post) return true;
  if (message.fwd_from?.pFlags?.saved_out) return true;
  return false;
}
// chat.ts:1392
isOutMessage(message) {
  const fwdFrom = message.fwd_from;
  return !!(this.isOurMessage(message) && (!fwdFrom || this.peerId !== myId || this.threadId));
}
```

У поста канала стоит `pFlags.post` → `isOurMessage === false` → `bubbles.ts:9669` вешает `is-in`.
**Даже владелец видит свои посты слева, входящим баблом, без тиков.** Подтверждено живьём
на своём канале (плейсхолдер `Broadcast`, значит право постинга есть):

```text
div.bubbles-group                                    ← нет bubbles-group-avatar-container
  div.bubble.channel-post.with-beside-button.hide-name.is-in.can-have-tail
                         .is-group-first.is-group-last
    div.bubble-content-wrapper > div.bubble-content
      div.message.spoilers-container
        span.translatable-message
        span.time                                    ← НЕТ .time-sending-status
          span.post-views {2}
          span.tgico.time-icon.time-part.time-icon-views
          span.i18n {23:45}
          div.time-inner (дубль для floating-варианта)
        span.clearfix
      div.bubble-beside-button.with-hover.forward > span.tgico
      svg > use                                      ← хвост
```

У нас сторона бабла считается тем же порядком: `isOurMessage`/`isOutMessage`
(`core/models.ts:458`, зовёт лента — `components/chat/bubbles.ts::isOutMessage`),
и терм `!pFlags.post` в них стоит. Свои посты идут слева, входящим баблом, без тиков.

### 2.2 Таблица бабла

| Признак | tweb | у нас |
|---|---|---|
| сторона | всегда `is-in` у постов | ✅ (терм `!pFlags.post` в `isOurMessage` — порт `chat.ts:1379`) |
| тики статуса | нет (следствие `is-in`) | ✅ (следствие того же терма) |
| имя отправителя | `hide-name`; `needName` требует `isLikeGroup` (`bubbles.ts:9331`) | ✅ (`showName={isGroup && …}`) |
| аватар-колонка | нет; `needAvatar = isLikeGroup && !isOutMessage` (`bubbles.ts:11706`) | ✅ |
| `signature_profiles` | канал становится `isLikeGroup` → имена и аватарки возвращаются | ❌ флаг есть в карточке, в рендере не используется |
| подпись автора | `.time-post-author` из `post_author`, только при `!isLikeGroup` (`chat.ts:1419-1432`) | ❌ поля `post_author` нет на проводе вовсе — долг `web-client/backlogs/frontend/post-author-signature.md` |
| класс `channel-post` | по `message.views` (`bubbles.ts:7672-7673`) | ✅ тот же гейт — `bubbleClasses.ts` (`if (m.views)`), зовёт его ванильная лента. Признака «открыт канал» в контексте вычислителя больше нет вовсе: сервер шлёт пару `views`/`forwards` ровно у поста и всегда, минимум единица (`domain.MessageReal.PostCounters`), поэтому вид чата спрашивать незачем. Пин — `chat/bubbles.channelPost.test.ts` |
| просмотры в `.time` | `.post-views` + иконка `channelviews`, tooltip `ViewsTooltip`/`SharesTooltip` | 🟡 счётчик есть, tooltip с просмотрами/пересылками нет — долг `web-client/backlogs/frontend/post-time-tooltips.md` |
| инкремент просмотров | IntersectionObserver → дебаунс 1000 мс → `getMessagesViews{increment}` (`bubbles.ts:2305-2328`, `:2129-2147`, `appMessagesManager.ts:9136-9156`) | ✅ то же: `viewsObserverCallback` ленты (одноразовое наблюдение) → дебаунс 1000 мс → `POST /channels/{id}/views` (`channelsManager.registerViews`). Ответ применяется у себя, как в оригинале; чужие просмотры приезжают кадром `views_update` (`updateChannelMessageViews`) → `messages.cacheViews` → событие `messages_views` → лента переписывает `.post-views` (порт `bubbles.ts:2094-2124`) |
| кнопка «переслать» сбоку | `.bubble-beside-button.with-hover.forward` + `with-beside-button` (`bubbles.ts:7675-7681`), клик → `showForwardPopup` (`bubbles.ts:3511-3517`) | ✅ узел, классы и гейт те же (`chat/bubbles.ts`, блок поста канала); клик уходит в тот же попап пересылки, что пункт меню (`navigation.showForward` → `menuPopups.showForward`). Из условия оригинала не портирован только терм `chat.type !== ChatType.Pinned` — ленты закреплённых у нас нет как понятия |
| футер комментариев | `replies-element` при `replies.pFlags.comments` (`appMessagesManager.ts:9237-9247`) | ✅ тот же гейт — `getMessageWithCommentReplies` в `chat/bubbles.ts`; узел строит `chat/replies.ts`. Счётчик живится кадром `replies_update` (`updateChannelMessageReplies`) → `messages.cacheReplies` → событие `replies_updated` → `setRepliesElementCount` (порт `replies.ts:17-22`, `bubbles.ts:1137-1142`) |
| группировка постов | общее правило `canItemsBeGrouped`, `newGroupDiff = 121 c` (`bubbleGroups.ts:360,578`) | не проверял на совпадение порога |
| рекламные посты | `is-sponsored`, `topbarSponsored`, меню «About this ad / Report / Remove ads» | ❌ рекламы нет как подсистемы |

## 3. Композер и низ экрана

| Что | tweb | у нас |
|---|---|---|
| плейсхолдер | `Comment` в треде → `ChannelBroadcast` («Broadcast») в канале → иначе `Message` (`input.ts:2735-2746`) | ❌ всегда `Message` (`Composer.tsx:530`) |
| ряд `chat-input-control` | одна строка кнопок, видимость классом `hide`: Subscribe/Join · Mute/Unmute · Open Chat · Frozen · Premium-only · Unpin all (`input.ts:2448-2500`) | 🟡 `ChatInputControl` есть, набор кнопок и порядок расходятся |
| «Subscribe» vs «Join» | `Chat.Subscribe` для broadcast, `ChannelJoin`/`ChannelJoinRequest` для групп | 🟡 разделения нет |
| левый слот плашки | «написать в direct» при `channel.linked_monoforum_id` | ❌ фичи нет (в коде помечено «фичи нет») |
| правый слот плашки | подарок, только для broadcast | ✅ |
| кнопка вниз | `.bubbles-go-down.is-broadcast` (`input.ts:2397`) | ❌ класса нет |
| тихая отправка | `Chat.Send.WithoutSound` в send-меню | ✅ |
| отложенная отправка | `Chat.Send.ScheduledMessage` / `SetReminder` / `SendWhenOnline` | ✅ |
| send-as | создаётся для `ChatType.Chat`/`Discussion`, набор пиров с сервера (`input.ts:2291-2325`) | 🟡 включён только для групп (`Chat.tsx:544`) |
| предложка постов | `suggestPostPopup` | ✅ `SuggestPostPopup` + `SuggestedPostsView` |

## 4. Шапка чата

| Пункт | tweb (`chat/topbar.ts`) | у нас (`components/chat/topbar.ts`, П-5 волны 7) |
|---|---|---|
| сабтайтл | «N subscribers» | ✅ |
| Search | ✅ | ✅ лупа `btnSearch` + пункт на мобильном (`chat.initSearch`) |
| Pinned Messages | ✅ | плашка закрепа — `pinnedMessage.solid.tsx` (П-5 «закреп») |
| Mute / Unmute | ✅ | ✅ (`PopupMute`, `groups.setMute`) |
| ViewDiscussion | `getChannelFull().linked_chat_id` → `setInnerPeer` (`topbar.ts:514-527`) | ✅ (`chat.fullPeer().linked_chat_id`) |
| Live Stream / Voice Chat | ✅ | пункты — после влития П-4 (Б-88 плана волны 7); плашки видеочата/эфира — ✅ (`topbarPlates.ts`) |
| Select Messages | ✅ | ✅ |
| Send Gift | ✅ | ❌ Б-85 (`showSendGiftPopup` — заглушка до 2C-20) |
| Statistics | ✅ (`topbar.ts:682-689`) | ✅ `AppStatisticsTab` (`sidebarRight/tabs/statistics.solid.tsx`), verify — `canViewStatistics` (`core/chatFullCache.ts`) |
| Boost Channel | ✅ | ❌ Б-85 (`openBoosts` не портирован) |
| Translate | ✅ | ❌ Б-85 (перевода нет) |
| Auto-delete | ✅ (подменю) | ✅ (подменю `createAutoDeleteSubmenu`, иконка срока `autoDeleteIcon.ts`) |
| Report | ✅ | ✅ (`ReportPopup` острова оверлеев через `reportStore`) |
| Delete / Leave Channel | ✅ | ✅ (`popups/deleteDialog.ts`, текст — `getDeleteButtonText`) |
| ChannelDirectMessages.Manage / ViewChats | ✅ | ❌ Б-85 (монофорума нет, О-4) |

## 5. Профиль канала (правый сайдбар)

tweb: `sharedMediaTab` + `peerProfile`. Табы (`sharedMedia.tsx:449-462, 604-646`):
`savedDialogs · stories · members · media · gifts · saved · files · links · music · voice · groups · similar`.

| Таб/строка | tweb | у нас |
|---|---|---|
| Info / Link / QR / Notifications | ✅ | ✅ |
| Media / Files / Links / Music / Voice | ✅ | ✅ |
| Stories | ✅ | 🟡 истории есть, канальные не проверял |
| Gifts (подарки канала) | ✅ | 🟡 `stargifts` есть, привязка к каналу не проверял |
| Similar channels | ✅ таб в профиле | 🟡 `SimilarChannels` показывается в ленте, не табом профиля |
| Members/Subscribers | ✅ | ✅ |

## 6. Редактирование канала (`sidebarRight/tabs/editChat.tsx`)

Порядок строк для broadcast, как в исходнике:

| Строка | tweb | у нас (`editChat.solid.tsx`) |
|---|---|---|
| аватар · название · описание | ✅ | ✅ (сеть — по угловой галочке, как у tweb) |
| Channel Type (публичный/приватный, username, ссылка) | ✅ | ✅ |
| Invite Links | ✅ | ✅ |
| Subscribe Requests | ✅ (`SubscribeRequests`) | ❌ скрыта до П-1 (Б-41) |
| Reactions | ✅ | ❌ скрыта до П-1 (Б-39) |
| Direct Messages (монофорум) | ✅ (`ChannelDirectMessages.*`) | ❌ нет предмета (Б-105) |
| Discussion | ✅ | ❌ скрыта до П-1 (Б-40) |
| Recent Actions (админ-лог) | ✅ — таб `adminRecentActions` **или** отдельный тип чата `ChatType.Logs` | ❌ нет предмета (Б-105) |
| Administrators | ✅ | ❌ скрыта до П-1 (Б-41) |
| Subscribers | ✅ | ❌ скрыта до П-1 (Б-41) |
| Removed Users | ✅ | ❌ скрыта до П-1 (Б-41) |
| Channel Autotranslation | ✅, гейт по `channel_autotranslation_level_min`, иначе тост со ссылкой на буст (`editChat.tsx:875-893`) | ❌ нет бэкенда (Б-106) |
| Sign Messages + Show Profiles | ✅ (`editChat.tsx:895-922`) | 🟡 тумблеры есть, на рендер ленты не влияют |
| Delete Channel | ✅ | ✅ (попап `popups/deleteDialog.ts`) |

Вкладка — `AppEditChatTab` (`web-client/src/components/sidebarRight/tabs/editChat.solid.tsx`,
задача 0б-1 волны 7, шаг К-5): порт `editChat.tsx` 812502980, у группы ещё «Разрешения»,
тумблер тем (`setForum`) и «История чата»; права строк — `hasRights` с действиями
`change_type`/`toggle_forum`/`change_permissions` (`core/peers/rights.ts`). Расхождения — шапка файла.

`Channel Type` внутри (`chatType.tsx`, 812502980): радио приватный/публичный, приватная
ссылка + Revoke (попап `revoke-link`), публичный username (`UsernameInputField`, голова `t.me/`)
с `UsernamesSection`, секция вступления (join to send / заявки / бот-привратник
`guard_bot_id`), **Restrict Saving Content** (`noforwards`, `chatType.tsx:374-407`); всё
сохраняет угловая кнопка (`:231-266`), снятие имени — через подтверждение
`ChannelVisibility.Confirm.MakePrivate.*` (`:214-229`).
У нас — порт вкладкой `AppChatTypeTab` (`web-client/src/components/sidebarRight/tabs/chatType.solid.tsx`,
задача 0б-2 волны 7): тип, ссылка, Revoke, поле имени, угловая «Сохранить», подтверждение — 1:1.
Занятость имени — ручкой чата `GET /chats/{id}/username/available` (`groups.checkUsername`,
порт `channels.checkUsername`; имена пользователей и чатов — одно пространство).
Нет на бэкенде (шапка вкладки): вступление и бот-привратник (О-15), **`noforwards` ❌** (О-16),
коллекция имён `usernames` и покупка имени (О-17). Открывает её вкладка «Изменить»
(`editChat.solid.tsx`) родным `createTab(AppChatTypeTab).open(…)`; React-экран
`ChatTypeScreen.tsx` снесён.

`Invite Links` (`chatInviteLinks.tsx` + `chatInviteLink.tsx` + `editChatInviteLink.tsx`,
общее — `chatInviteLinkShared.ts`, 812502980): заставка `UtyanLinks`, основная ссылка
виджетом `ChatInviteLink` (⋮ «Копировать / Поделиться / Изменить / Отозвать / Удалить»,
кнопка «Поделиться» — или «Удалить» у отозванной, «Возобновить» у неактивной),
дополнительные строками `UsernameRow` с кольцом остатка срока/лимита (тик раз в секунду),
ссылки других админов (`getAdminsWithInvites`), отозванные с «Удалить все»; одна ссылка —
кто создал, «сможет вступить N», заявки по ссылке, вступившие селектором; редактор — имя,
подписка за звёзды и одобрение (только канал), срок и лимит ступенями; сеть — по угловой галке.
У нас — порт тремя вкладками `AppChatInviteLinksTab`/`AppChatInviteLinkTab`/
`AppEditChatInviteLinkTab` (`web-client/src/components/sidebarRight/tabs/chatInviteLink*.solid.tsx`,
задача 0б-3 волны 7): разметка, меню, кольцо, сеть по галке — 1:1; адрес ссылки — публичный
`t.me/+<хеш>` нашего хоста (`core/publicLink.ts`, ручки `appChatInvitesManager` в
`groupsManager.ts` переводят серверный путь `/join/<хеш>`); «Поделиться» — React-мост
`popups/shareUrl.bridge.ts` (ВРЕМЕННО до 2C-24), календарь срока —
`popups/datePicker.bridge.ts` (ВРЕМЕННО до 2C-23). Нет на бэкенде (шапки вкладок):
постоянная ссылка `exported_invite`/`permanent`/`…Replaced` (О-120, аналог — самая старая
ссылка без параметров, общий с вкладкой типа `getChatInviteLink`), ссылки других админов
(О-121), заявки по ссылке (О-122), подписки за звёзды (О-123), страницы и поиск вступивших
(О-124). Карточки создателей и вступивших сервер теперь кладёт в вектор `users` ответов
(`group_handler.go::ListInvites`/`InviteImporters`). Открывает список вкладка «Изменить»
(`editChat.solid.tsx`); React-экран `InviteLinkScreens.tsx` снесён.
QR из этих вкладок tweb не открывает.

## 7. Права админа

tweb различает набор прав broadcast vs megagroup и умеет кастомный «титул» админа.
У нас `RIGHTS` — один захардкоженный список из 8 бит с русскими подписями
(`core/hooks/useGroupInfo.ts:11-20`), одинаковый для группы и канала, без rank.
Набор tweb уже портирован классом `ChatAdministratorRights`
(`web-client/src/components/sidebarRight/tabs/groupPermissions/sharedPermissions.ts`, задача 0б-6
волны 7: строки группы и канала, «Управление сообщениями» с вложенными, `canEdit`/`canGrant`,
`takeOut`) в объёме восьми прав бэкенда (О-115); `RIGHTS` снимает вкладка прав участника (0б-7).

Права группы по умолчанию (`groupPermissions.tsx`) — вкладка `AppGroupPermissionsTab`
(`sidebarRight/tabs/groupPermissions/groupPermissions.solid.tsx`, 0б-6): пять запретов
(`ChatPermissions`, строки-ограничения `checkbox-field-toggle-restriction`, замок у публичной группы),
плата за сообщения (`chargeForMessasgesSection` + `StarRangeInput`), медленный режим
(`RangeStepsSelector`), исключения — ограниченные участники с подписью «чего нельзя». Сеть — по
галочке/«Save» на закрытии; права и медленный режим — один `PUT /chats/{id}/permissions`.
Нет у бэкенда: вложенные медиа-запреты и `manage_topics` (О-115), «не ограничивать бустеров» (О-116),
гигагруппа (О-117), подпись комиссии цены (О-119); переходы из исключений — 0б-7 (О-118).

## 8. Буст, статистика, розыгрыши

| Что | tweb | у нас |
|---|---|---|
| Boosts | полноценный таб: уровень, прогресс до следующего, список бустеров, предоплаченные розыгрыши, «boost via gifts» | 🟡 `BoostPopup` |
| Statistics канала и группы | ✅ (`sidebarRight/tabs/statistics.tsx`, графики `lib/tchart`) | ✅ `AppStatisticsTab` + порт `lib/tchart`; бэкенд — `stats.broadcastStats`/`megagroupStats` (`domain/mtstats.go`); без данных — Б-123, Б-124 |
| Statistics поста | ✅ (`ViewStatistics` в контекстном меню) | ✅ `AppStatisticsTab` режима поста (`stats.messageStats`); публичных пересылок нет — Б-121 |
| Statistics истории | ✅ (режим `storyId` той же вкладки) | 🟡 React `StoryStats` вьювера историй (волна 4), во вкладке — Б-122 |
| Giveaway | ✅ (`boostsViaGifts`, prepaid) | 🟡 `CreateGiveawayPopup` |

## 9. Сводка расхождений по важности

**Блокеры визуального паритета (видно на скриншотах):**

1. ~~Сторона бабла: свои посты справа вместо слева.~~ **ЗАКРЫТО** вместе с
   портом `isOurMessage` (заявка 17 в `readiness/port-divergences.md`): терм
   `!pFlags.post` вернулся, свои посты уехали влево. Заодно временный бабл
   рождается с `pFlags.post` (порт `generateFlags`) — иначе он стоял бы справа
   до эха и прыгал влево на подтверждении.
2. ~~Тики статуса на посте.~~ **ЗАКРЫТО** — следствие того же терма.
3. ~~`channel-post` привязан к виду чата, а не к `views`.~~ **ЗАКРЫТО** — гейт
   переведён на `message.views` (`bubbleClasses.ts`), вместе с ним появились
   `with-beside-button` и сама кнопка «переслать» сбоку: прежде ванильная лента
   звала вычислитель классов со стабом, где признак канала стоял захардкоженным
   `false`, и ни один бабл признаков поста не получал вовсе.
4. Плейсхолдер композера `Message` вместо `Broadcast`.

**Функционально отсутствует:**

5. `signature_profiles` → `isLikeGroup` (имена и аватарки в канале) и `.time-post-author`.
6. Recent Actions (админ-лог) — ни таба, ни `ChatType.Logs`.
7. Channel Direct Messages (монофорум) — включая левый слот плашки и пункты шапки.
8. Channel Autotranslation с гейтом по уровню буста.
9. `noforwards` (запрет сохранения контента).
10. Мёртвые пункты меню шапки: `View discussion`, `Send a Gift`; нет
    `Pinned Messages`, `Translate` (`Statistics` портирован, П-1).
11. Права админа: нет разделения broadcast/megagroup и кастомного титула.
12. Инкремент просмотров по видимости бабла (у нас — по прочитанному seq).
13. Similar channels табом профиля (у нас — полосой в ленте).
14. Реклама (sponsored) — подсистемы нет; вероятно, вне скоупа.

## 10. Что НЕ входит

- Комментарии и треды — отдельная программа, см. доку от 2026-08-13 и ворктри `channels-comments`.
- Цвет пира / emoji-статус / обои канала: в tweb **редактирования нет**, только рендер, —
  расхождения по ним не считаем.

## 11. Уровень проверки

Проверено чтением исходников tweb и нашего кода плюс живым DOM канала. Детально
**не** проверялись: инвайт-ссылки, экран реакций, содержимое статистики, канальные
истории и подарки канала — по ним статус в таблицах помечен как «не проверял».

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Пост канала: подпись автора, просмотры, репосты, реакции, кнопка комментариев.
- [ ] Шапка канала: название, число подписчиков, кнопки Subscribe / Mute.
- [ ] Низ экрана для неподписанного и подписанного (композер против кнопки).
- [ ] Профиль канала: секции, табы, ссылки.
- [ ] Редактирование канала: тип, пригласительные ссылки, реакции, админы, подписчики, удалённые.
- [ ] Права админа: набор переключателей и их сохранение.
- [ ] Буст и статистика открываются со стилями и графиками.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 19-ch-01…05, 20-channel-01-post-formatted, 15-right-01…09.
