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

У нас `out = meId != null && m.senderId === meId && !m.sendAs` (`core/messageToConvMsg.ts:46`)
и дальше `const out = !!m.out` (`ChatFeed.tsx:260`). Свои посты уезжают вправо, зелёными,
с тиком (`Time.tsx:141` рисует тик по `out && status`).

### 2.2 Таблица бабла

| Признак | tweb | у нас |
|---|---|---|
| сторона | всегда `is-in` у постов | ✅ (терм `!pFlags.post` в `isOurMessage` — порт `chat.ts:1379`) |
| тики статуса | нет (следствие `is-in`) | ✅ (следствие того же терма) |
| имя отправителя | `hide-name`; `needName` требует `isLikeGroup` (`bubbles.ts:9331`) | ✅ (`showName={isGroup && …}`) |
| аватар-колонка | нет; `needAvatar = isLikeGroup && !isOutMessage` (`bubbles.ts:11706`) | ✅ |
| `signature_profiles` | канал становится `isLikeGroup` → имена и аватарки возвращаются | ❌ флаг есть в карточке, в рендере не используется |
| подпись автора | `.time-post-author` из `post_author`, только при `!isLikeGroup` (`chat.ts:1419-1432`) | ❌ |
| класс `channel-post` | по `message.views` (`bubbles.ts:7672`) | 🟡 по виду чата (`bubbleClasses.ts:148`, `ctx.isChannel`). Гейт наблюдения за просмотрами в ленте уже переведён на `message.views`, как у оригинала: сервер шлёт пару `views`/`forwards` ровно у поста и всегда, минимум единица (`domain.MessageReal.PostCounters`). Сам класс на вид чата остаётся — отдельная строка |
| просмотры в `.time` | `.post-views` + иконка `channelviews`, tooltip `ViewsTooltip`/`SharesTooltip` | 🟡 счётчик есть, tooltip с пересылками нет |
| инкремент просмотров | IntersectionObserver → дебаунс 1000 мс → `getMessagesViews{increment}` (`bubbles.ts:2305-2328`, `:2129-2147`, `appMessagesManager.ts:9136-9156`) | ✅ то же: `viewsObserverCallback` ленты (одноразовое наблюдение) → дебаунс 1000 мс → `POST /channels/{id}/views` (`channelsManager.registerViews`). Ответ применяется у себя, как в оригинале; чужие просмотры приезжают кадром `views_update` (`updateChannelMessageViews`) → `messages.cacheViews` → событие `messages_views` → лента переписывает `.post-views` (порт `bubbles.ts:2094-2124`) |
| кнопка «переслать» сбоку | `.bubble-beside-button.with-hover.forward` + `with-beside-button` | 🟡 рендерится, но привязана к `channel-post`, т.е. к обсуждениям |
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

| Пункт | tweb (`chat/topbar.ts`) | у нас (`HeaderMenu.tsx`) |
|---|---|---|
| сабтайтл | «N subscribers» | ✅ |
| Search | ✅ | ✅ |
| Pinned Messages | ✅ | ❌ |
| Mute / Unmute | ✅ | ✅ |
| ViewDiscussion | `getChannelFull().linked_chat_id` → `setInnerPeer` (`topbar.ts:496`) | 🟡 пункт есть, `onClick` пустой |
| Live Stream / Voice Chat | ✅ | ✅ (`Live Stream`) |
| Select Messages | ✅ | ✅ |
| Send Gift | ✅ | 🟡 пункт есть, `onClick` пустой |
| Statistics | ✅ (`topbar.ts:662`) | ❌ в меню шапки нет (`ChannelStats` открывается из профиля) |
| Boost Channel | ✅ | ✅ |
| Translate | ✅ | ❌ в меню канала |
| Auto-delete | ✅ | ✅ |
| Report | ✅ | ✅ |
| Delete / Leave Channel | ✅ | ✅ |
| ChannelDirectMessages.Manage / ViewChats | ✅ | ❌ |

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

| Строка | tweb | у нас (`GroupEditFlow`) |
|---|---|---|
| аватар · название · описание | ✅ | ✅ |
| Channel Type (публичный/приватный, username, ссылка) | ✅ | ✅ |
| Invite Links | ✅ | ✅ |
| Subscribe Requests | ✅ (`SubscribeRequests`) | 🟡 API есть, отдельного экрана заявок канала не видно |
| Reactions | ✅ | ✅ |
| Direct Messages (монофорум) | ✅ (`ChannelDirectMessages.*`) | ❌ |
| Discussion | ✅ | ✅ |
| Recent Actions (админ-лог) | ✅ — таб `adminRecentActions` **или** отдельный тип чата `ChatType.Logs` | ❌ полностью |
| Administrators | ✅ | ✅ |
| Subscribers | ✅ | ✅ |
| Removed Users | ✅ | ✅ |
| Channel Autotranslation | ✅, гейт по `channel_autotranslation_level_min`, иначе тост со ссылкой на буст (`editChat.tsx:594-637`) | ❌ |
| Sign Messages + Show Profiles | ✅ (`editChat.tsx:640-676`) | 🟡 тумблеры есть, на рендер ленты не влияют |
| Delete Channel | ✅ | ✅ |

`Channel Type` внутри (`chatType.tsx`): приватная ссылка + Revoke, публичный username,
**Restrict Saving Content** (`noforwards`, `chatType.tsx:326-343`).
У нас (`ChatTypeScreen.tsx`) — тип, ссылка, Revoke; **`noforwards` ❌**.

## 7. Права админа

tweb различает набор прав broadcast vs megagroup и умеет кастомный «титул» админа.
У нас `RIGHTS` — один захардкоженный список из 8 бит с русскими подписями
(`core/hooks/useGroupInfo.ts:11-20`), одинаковый для группы и канала, без rank.

## 8. Буст, статистика, розыгрыши

| Что | tweb | у нас |
|---|---|---|
| Boosts | полноценный таб: уровень, прогресс до следующего, список бустеров, предоплаченные розыгрыши, «boost via gifts» | 🟡 `BoostPopup` |
| Statistics канала | ✅ | ✅ `ChannelStats` |
| Statistics поста | ✅ (`ViewStatistics` в контекстном меню) | ✅ `PostStats` |
| Statistics истории | ✅ | ✅ `StoryStats` |
| Giveaway | ✅ (`boostsViaGifts`, prepaid) | 🟡 `CreateGiveawayPopup` |

## 9. Сводка расхождений по важности

**Блокеры визуального паритета (видно на скриншотах):**

1. ~~Сторона бабла: свои посты справа вместо слева.~~ **ЗАКРЫТО** вместе с
   портом `isOurMessage` (заявка 17 в `readiness/port-divergences.md`): терм
   `!pFlags.post` вернулся, свои посты уехали влево. Заодно временный бабл
   рождается с `pFlags.post` (порт `generateFlags`) — иначе он стоял бы справа
   до эха и прыгал влево на подтверждении.
2. ~~Тики статуса на посте.~~ **ЗАКРЫТО** — следствие того же терма.
3. `channel-post` привязан к обсуждениям, а не к `views`.
4. Плейсхолдер композера `Message` вместо `Broadcast`.

**Функционально отсутствует:**

5. `signature_profiles` → `isLikeGroup` (имена и аватарки в канале) и `.time-post-author`.
6. Recent Actions (админ-лог) — ни таба, ни `ChatType.Logs`.
7. Channel Direct Messages (монофорум) — включая левый слот плашки и пункты шапки.
8. Channel Autotranslation с гейтом по уровню буста.
9. `noforwards` (запрет сохранения контента).
10. Мёртвые пункты меню шапки: `View discussion`, `Send a Gift`; нет `Statistics`,
    `Pinned Messages`, `Translate`.
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
