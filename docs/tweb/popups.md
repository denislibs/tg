# Попапы и меню в tweb: референс для порта 1:1

Снято 2026-08-16. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb`;
- наш код `web-client/` на `main`.

> Важно: локальный tweb — форк оригинала; часть попапов переписана на Solid.js
> (`indexTsx.tsx`, `.tsx`-попапы), но императивное ядро `PopupElement` осталось основой.

Структура документа:

1. Ядро: `PopupElement` (конструктор, DOM, стек, показ/закрытие, навигация).
2. Полный каталог `src/components/popups/*`.
3. Типовые confirm-диалоги: `PopupPeer` и `confirmationPopup`.
4. Меню: `ButtonMenu` / `ButtonMenuToggle` / `contextMenuController` / `positionMenu`.
5. Тосты и тултипы.
6. Слои: попапы ↔ медиавьювер ↔ меню (z-index, `appNavigationController`, `overlayCounter`).
7. Карта SCSS.
8. Наш клиент: структурные расхождения.

---

# Часть 1. Ядро — `PopupElement` (`src/components/popups/index.ts`)

## 1.1 Опции конструктора

`constructor(className: string, options: PopupOptions = {})` (index.ts:119). `PopupOptions` (index.ts:39–55):

| Опция | Тип | Эффект |
|---|---|---|
| `closable` | boolean | кнопка-крестик `.popup-close` в начале хедера (index.ts:155–178) |
| `onBackClick` | `() => void \| false` | вместо иконки close вставляется `div.animated-close-icon`; клик при классе `state-back` вызывает колбэк, иначе `hide()` (index.ts:161–177) |
| `isConfirmationNeededOnClose` | `() => boolean\|Promise` | перехват закрытия: если вернул truthy/Promise — попап не закрывается сразу, а ждёт confirm (используется в `onPop`, index.ts:339–348) |
| `overlayClosable` | boolean | клик по подложке (вне `.popup-container`) закрывает (index.ts:185–193) |
| `withConfirm` | `LangPackKey \| true` | кнопка `.btn-primary.btn-color-primary` в конце хедера → `this.btnConfirm` (index.ts:195–203) |
| `body` | boolean | создаётся `div.popup-body` (index.ts:206–210) |
| `scrollable` | boolean | `new Scrollable(this.body)`; если `body` нет — `scrollable.container` вставляется после хедера (index.ts:212–227) |
| `floatingHeader` | boolean | хедер absolute + `div.popup-header-background`, тень/фон появляются при скролле (снятие `.scrolled-start`) (index.ts:216–222) |
| `footer` | boolean | `div.popup-footer` в body/container (index.ts:229–237) |
| `withFooterConfirm` | boolean | `btnConfirm` переносится в футер (index.ts:234–236) |
| `buttons` | `PopupButton[]` | ряд кнопок `.popup-buttons` (см. 1.3) |
| `title` | `boolean \| LangPackKey \| Node` | `div.popup-title` в хедере (index.ts:136–145) |
| `confirmShortcutIsSendShortcut` | boolean | Enter-обработчик проверяет send-шорткат (Ctrl+Enter/Enter по настройке) вместо голого Enter (index.ts:382) |
| `withoutOverlay` | boolean | класс `no-overlay`, не инкрементирует `overlayCounter` (index.ts:180–183, 363–366) |
| `old` | boolean | класс `old` — старый вид (фон `--surface-color`, серые иконки; _popup.scss:329–337) |

`PopupButton` (index.ts:26–37): `text | langKey(+langArgs)`, `callback(e)` (может вернуть `Promise`/`false`), `isDanger`, `isCancel`, `noRipple`, `iconLeft/iconRight`.

## 1.2 DOM-структура

```
div.popup.<className>[.night][.no-overlay][.old]     → this.element (сама подложка, position:fixed)
  └ div.popup-container.z-depth-1                    → this.container
      ├ div.popup-header                             → this.header
      │   ├ [button.btn-icon.popup-close]            → this.btnClose (closable)
      │   │    └ Icon('close') | div.animated-close-icon
      │   ├ [div.popup-header-background]            (floatingHeader)
      │   ├ [div.popup-title]                        → this.title
      │   └ [button.btn-primary.btn-color-primary]   → this.btnConfirm (withConfirm)
      ├ [div.popup-body]                             → this.body
      │   └ [div.scrollable.scrollable-y]            → this.scrollable (scrollable)
      │   └ [div.popup-footer]                       → this.footer
      └ [div.popup-buttons[.is-vertical-layout]]     → this.buttonsEl
```

Нюансы:

- `this.element.className = 'popup' + className` — className попапа живёт на подложке (index.ts:122).
- Класс `night` вешается, если на момент создания `overlayCounter.isDarkOverlayActive` (открыт медиавьювер/сториз) — попап поверх тёмного оверлея рисуется в ночной теме (index.ts:129–132).
- Наследование: `PopupElement extends EventListenerBase<{close, closeAfterTimeout}>` — жизненный цикл через события (index.ts:72–77).
- Внутри — свои `middlewareHelper` (уничтожается в `destroy`) и `lateMiddlewareHelper` (после таймаута анимации), `listenerSetter` для авточистки слушателей (index.ts:109–113, 148–150).
- `this.managers = PopupElement.MANAGERS` — статически инжектится в `appDialogsManager.ts:710`.

## 1.3 `setButtons` (index.ts:247–320)

- Каждая кнопка: `button.popup-button.btn` + `danger|primary`, ripple (если не `noRipple`), иконка слева/справа (`.with-icon`).
- `callback` может вернуть Promise: на время ожидания кнопка дизейблится (`toggleDisability`), `false`/reject — попап не закрывается; иначе после колбэка всегда `this.hide()` (index.ts:282–302).
- Если ровно 2 кнопки и нет `btnConfirm` — не-cancel кнопка становится `btnConfirmOnEnter` (index.ts:307–312).
- ≥3 кнопок → `.is-vertical-layout` (колонка) (index.ts:314–316).
- Хелпер `addCancelButton(buttons)` — дописывает `{langKey: 'Cancel', isCancel: true}`, если cancel-кнопки нет (index.ts:484–494).

## 1.4 Стек, показ и закрытие

**Стек**: `private static POPUPS: PopupElement[]` — пуш в конструкторе (index.ts:244), удаление в `destroy` (index.ts:433). `PopupElement.getPopups(ctor)` — поиск живых попапов класса (index.ts:474–476). `PopupElement.createPopup(ctor, ...args)` — просто `new ctor(...args)` (обход циклических импортов + единая точка создания; index.ts:478–481). Показ вызывается вручную: `PopupElement.createPopup(...).show()` (многие попапы делают `this.show()` сами в конце конструктора/init).

**Куда монтируется**: `appendPopupTo() = getFullScreenElement() || getOverlayRoot()` (index.ts:64) — фулскрин-элемент, иначе `document.body` активного окна (обычного или Document-PiP; `helpers/appWindow.ts:33`). На `fullscreenchange` все попапы переносятся `PopupElement.reAppend()` (index.ts:66–70, 463–472).

**`show(animate = true)`** (index.ts:330–389):

1. `navigationItem = {type: 'popup', onPop: () => this.destroy()}` (с перехватом `isConfirmationNeededOnClose`) → `appNavigationController.pushItem` — Esc и «назад» браузера идут через навигацию.
2. `blurActiveElement()` — спрятать мобильную клавиатуру.
3. append + принудительный reflow (`void this.element.offsetWidth`) + класс `active` → CSS-анимация.
4. Если не `withoutOverlay`: `overlayCounter.isOverlayActive = true` и `animationIntersector.checkAnimations2(true)` — стикеры/гифки под попапом ставятся на паузу.
5. Через `setTimeout(0)` вешается keydown на `document.body`: Enter (или send-шорткат) кликает `btnConfirmOnEnter`, но только если этот попап — верхний в `POPUPS` (index.ts:370–387).

**`hide()`** (index.ts:391–402) — не закрывает напрямую, а `appNavigationController.backByItem(navigationItem)`: снятие элемента навигации вызывает `onPop` → `destroy()`. Так «крестик», Esc, click-outside и системный back сходятся в одну точку.

**`destroy()`** (index.ts:413–449):

- `dispatchEvent('close')`; классы: `+hiding`, `−active`; `listenerSetter.removeAll()`; `middlewareHelper.destroy()`; `MarkupTooltip.hide()`.
- `overlayCounter.isOverlayActive = false`; снятие navigationItem; удаление из `POPUPS`; `reAppend()` остальных.
- Через **250 мс** (время CSS-анимации): `element.remove()`, `dispatchEvent('closeAfterTimeout')`, `cleanup()`, `scrollable.destroy()`, `lateMiddlewareHelper.destroy()`, `checkAnimations2(false)` — анимации размораживаются.

`hideWithCallback(cb)` — подписка на `closeAfterTimeout` + `hide()` (index.ts:404–407). `forceHide() = destroy()` — минуя навигацию (index.ts:409–411).

**Solid-мосты**: `appendSolid(cb)` рендерит JSX в div внутри scrollable/body, `appendSolidBody(cb)` — прямо в body; dispose на `closeAfterTimeout` (index.ts:451–461).

## 1.5 Анимация (`_popup.scss`)

- `.popup`: `position: fixed; inset: 0; z-index: 4; background: rgba(0,0,0,.3); opacity: 0; visibility: hidden;` transition `opacity var(--popup-transition-time), visibility 0s .15s` (_popup.scss:23–43). Переменные: `--popup-transition-time: .15s`, `--popup-transition-function: cubic-bezier(.4,0,.2,1)` (base.scss:70–72).
- `.popup-container`: `transform: translate3d(var(--translateX), 3rem, 0)` — контейнер стартует смещённым на 3rem вниз; `.popup.active .popup-container { transform: translate3d(var(--translateX), 0, 0) }` — «всплытие» + fade подложки (_popup.scss:55–69, 86–88).
- `.hiding` держит контейнер на месте (без обратного сдвига), исчезает только opacity; JS удаляет ноду через 250 мс.
- `body.animation-level-0 &` — все transition отключаются (_popup.scss:51–53, 100–102).
- Размеры — через CSS-переменные `--popup-width/height/min/max-*`, `--popup-border-radius: 2.5rem`, `--popup-background-color` — каждый конкретный попап задаёт их на своём классе (напр. `.popup-new-media { --popup-width: 420px }`).

## 1.6 Esc / click-outside / браузерный back

- **Esc** обрабатывает не попап, а `appNavigationController.onKeyDown` (appNavigationController.ts:216–223): берётся верхний `NavigationItem`, проверяются `escapeHandlers` и `item.onEscape`, затем `back(item.type)`.
- **Back браузера**: `popstate`/Navigation API → `_onPopState` → `navigations.pop()` → `handleItem` → `onPop` попапа (appNavigationController.ts:174–214). Если `onPop` вернул `false` (confirm-on-close), item вставляется обратно (appNavigationController.ts:290–304).
- **Click-outside** — собственный слушатель попапа при `overlayClosable` (index.ts:185–193): игнорирует клики внутри `.popup-container` и по отсоединённым нодам.

## 1.7 Вторая реализация: Solid `indexTsx.tsx`

В форке существуют **две параллельные базы** попапов, и это принципиально для порта.
`src/components/popups/indexTsx.tsx:115` — не обёртка над классом, а **независимая
реализация того же попапа на SolidJS**: `const PopupElement = (props) => JSX`.

| Отличие | Класс `index.ts` | Solid `indexTsx.tsx` |
|---|---|---|
| Монтирование | `appendPopupTo()` + ручной append | `<Portal mount={fullScreenElement() \|\| capturedRoot}>` (`capturedRoot` фиксируется один раз, чтобы попап не «перепрыгнул» из Document-PiP окна) |
| `overlayClosable` | опция | **закомментирована** — клик по подложке работает всегда при `closable !== false`; защита: mousedown внутри + mouseup снаружи не закрывает |
| Идентификация | `getPopups(ctor)` через `instanceof` | `getPopups(kind: symbol)` |
| Слоты | поля `header/title/body/footer` | подкомпоненты `PopupElement.Header/Title/CloseButton/Body/Scrollable/Footer/FooterPlaceholder/FooterButton/Button/Buttons`, регистрируются через `context.register(kind, el)` |
| Контекст | — | `PopupContext` / `usePopupContext()` (`indexTsx.tsx:88-89`): `{register, registerButton, store, buttons, shown, show, hide, destroy, destroyed, managers, middlewareHelper, lateMiddlewareHelper, navigationItem, scrollableRef, withoutOverlay, night, btnConfirmOnEnter, closable, element, kind, old}` |
| Создание | `PopupElement.createPopup(Ctor, ...args)` | `createPopup(callback)` (`indexTsx.tsx:634`) — оборачивает в `createRoot` + `PopupControllerContext`, `dispose` зовётся на `destroy` |

`PopupElement.Footer` умеет `floating`/`sticky`; `FooterButton` — `color: 'primary'|'secondary'|'danger'`;
`Button` с пропом `confirm` сам регистрируется как «кнопка по Enter».
`useSnitchedPopupContext()` (`indexTsx.tsx:103`) — хак получения контекста снаружи через рендер
пустого компонента внутри дерева.

**Три паттерна, встречающихся в каталоге:**

1. **Классовый**: `extends PopupElement` → `super(className, options)` → async `construct()` → `this.show()` в конце.
2. **Solid**: `showXxxPopup(...)` → `createPopup(() => <PopupElement …>)`, состояние показа — `createSignal(false)` + `show={show()}` (позволяет отложить показ до загрузки данных).
3. **Гибрид**: класс + `this.appendSolid(...)` / `appendSolidBody(...)` (`toggleReadDate.tsx`, `ageVerification.tsx`) либо локальный `createRoot` + `Portal` (`newMedia.ts`, `stars.tsx`, `reassignBoost.tsx`).

Прочие соглашения: `kind: symbol` вместо `instanceof` (`STICKERS_POPUP_KIND`, `CHAT_PREVIEW_POPUP_KIND`,
`DATE_PICKER_POPUP_KIND`); `HotReloadGuard` обязателен для попапов из воркер-независимых модулей
(`createPoll`, `translate`, `aiEditorPopup`, `createBot`, `pollLink`); `old: true` — легаси-вид.

---

# Часть 2. Каталог `src/components/popups/*`

## 2.1 Ключевые попапы (разобраны подробно)

### `newMedia.ts` — `PopupNewMedia` (2027 строк, самый большой)

`extends PopupElement` (`:113`), super (`:158`): `'popup-send-photo popup-new-media'`,
`{closable, withConfirm: true, confirmShortcutIsSendShortcut: true, body, title, scrollable}`.
`btnConfirm` затем **удаляется из хедера** (`:337`) и переезжает в `InputFieldMessage`.

- Конструктор `(chat, inputFiles, willAttachType, ignoreInputValue?, gifDocument?)`; вариант `{file, editResult}` из медиаредактора кладётся в `pendingEditResults: WeakMap`. Проверка `'file' in inputFile` вместо `instanceof File` — cross-realm (Document PiP).
- **`iterate(cb)` (`:1841`) — центральный алгоритм альбомов**: если `!willAttach.group` или есть gif (и не платное медиа) — каждый файл отдельным сообщением; иначе жадно набираются пачки **до 10**, разрыв при смене «аудио/не-аудио» либо `shouldCompress` (медиа vs документ). Используется и в рендере, и в отправке, и в `messagesCount()`.
- `attachFiles()` (`:1867`): рендер → `mediaContainer.replaceChildren()` → **только потом** уничтожение старых `middlewareHelper` (иначе `createVideo` очистит `src` у ещё видимых элементов); пачка >1 и сжимаемая → `div.popup-item-album` + `prepareAlbum({maxWidth: 384, minWidth: 100, spacing: 2})`.
- `send(force)` (`:835`): проверки конверсий, длины подписи, slow-mode, матрицы прав (`send_photos/videos/gifs/audios/docs`) с тостом + `shake(body)`; `prepareStarsForPayment(totalMessages)`; если подпись есть, а пачка не покрывает все файлы — подпись уходит отдельным `sendText` и обнуляется; далее `sendGrouped` либо `editMessageMedia`.
- Меню (`ButtonMenuToggle`, ~13 пунктов с `verify`): Add, AsMedia, SendAsFile(s), Group/UngroupMedia, Enable/DisablePhotoSpoiler, CaptionAbove/Below, PaidMedia.
- `onKeyDown` (`:815`) вешается на `getOverlayRoot()`: набор текста при фокусе вне инпута переводит фокус в подпись + `placeCaretAtEnd`.
- Конверсии gif→video / mov ждут `openAnimationDeferred` (resolve по `transitionend` или `pause(400)`), чтобы не дёргать анимацию открытия.
- Статик `PopupNewMedia.canSend({peerId, onlyVisible, threadId})`; модульный `getCurrentNewMediaPopup()`.

### `forward.tsx` — `showForwardPopup` (класса нет)

`showForwardPopup(peerIdMids?, _onSelect?, noTopics?, onClose?)` (`:93`) — тонкий слой над `showPickUserPopup`.

- `resolveChatRightsActions(peerIdMids)` (`:28`) выводит нужные `ChatRights` по медиа каждого сообщения (`send_photos/videos/gifs/roundvideos/stickers/voices/audios/docs/games/embed_links/send_inline/send_plain`, fallback `send_plain`) — picker сам отфильтрует чаты, куда переслать нельзя.
- Опции picker'а: `peerType: ['dialogs','contacts']`, **`multiSelect: 'hidden'`** (чекбоксы включаются через контекст-меню «SelectChat»), `placeholder: ShareModal.Search.ForwardPlaceholder`, `titleLangKey: ShareWith`, `useTopics: !noTopics`, `showTopPeers`.
- **Ключевое решение «открыть чат vs отправить из попапа»** (`:315-318`): `openChat = chosen.length === 1 && !finalizingThroughButton && !isSavedMessagesNoText`. Открытие → `setInnerPeer` + `input.initMessagesForward(peerIdMids)`; иначе → `ChatInput.sendMessageWithForward({...})` прямо из попапа.
- **Опций «скрыть отправителя / подписи» в попапе НЕТ** — они живут в меню reply-line над инпутом: `input.ts:674-767` `constructForwardElements()` (radioGroup `author`: `Chat.Alert.Forward.Action.Show1/Hide1`; radioGroup `caption`: `ShowCaption/HideCaption`; `Chat.Alert.Forward.Action.Another` → смена получателя). Флаги уходят в `forwardMessages` только из `ChatInput.sendMessage` (`input.ts:4232-4241`), из попапа `forwardParams` не передаётся.
- Менеджер: `appMessagesManager.forwardMessages` (`:3967`) → `forwardMessagesInner` (`:3721`); `dropCaptions ⇒ dropAuthor = true` (`:3756`); лимит пачки `config.forwarded_count_max`, остаток рекурсивно.
- `starsState` (Solid-стор): `totalStars = Σ starsAmountByPeer.get(peerId) * totalMessages`; SendMenu — Silent / Schedule / Send-when-online (последний требует ровно 1 не-бот пользователя с видимым статусом).
- Тосты: `FwdMessageToSavedMessages` / `FwdMessage(s)To` (до 3 имён), иначе `FwdMessagesToChats`; неудачные адресаты снимаются `selector.removeBatch(...)` + `throw` (попап не закрывается).

### `pickUser.tsx` — `showPickUserPopup` и семейство

`showPickUserPopup(options)` (`:104`), Solid, `class="popup-forward"`. Возвращает handle
`{get selector, hide(), finalize()}`.

- Опции (`:46`) = параметры `AppSelectPeers` + `titleLangKey, initial, prependPeerIds, useTopics, footerButtonProps, footer(ctx), autoHeight, showTopPeers, btnConfirmOnEnter, containerProps, onSelect(chosen), onClose`.
- Показывается только после `onFirstRender` селектора (`show={show()}`).
- **Форумы/топики**: клик по форуму при `useTopics` создаёт второй `AppSelectPeers` (`createForumSelector`) с `peerType: ['custom']` и `getMoreCustom` из `dialogsStorage.getDialogs({filterId: peerId})`; строки — `wrapTopicRow` (`:65`); пушится свой `NavigationItem`, `onBackClick` переносит выбор обратно.
- **Папки**: `createFolderTabs` (`:325`) — Solid-`FoldersTabs`, позиционируется по `observeResize` секции поиска, `isFilterIdAvailable` → `showLimitPopup('folders')`.
- `finalize()` защищён флагом `busy`; при одиночном выборе вызывается автоматически из `onSingleSelect`.
- Мультивыбор живёт в `appSelectPeers.ts`: `selected: Set` (`:64`), режим `'enabled'|'hidden'|'disabled'` (`:88`), `starsAmountByPeer` (`:134`), контекст-меню «SelectChat»/«Deselect» в режиме `hidden` (`:456-478`), `setLimit` (`:601`), `removeBatch` (`:1303`).
- Производные: `showPickUser2Popup` (`:626`, промис), `showPickUser3Popup` (`:673`), `showSharingPickerPopup` (`:697`, дефолт `footerButtonProps: {langKey: 'Send'}`), `showSharingPicker2Popup` (`:726`), `showReplyPickerPopup` (`:744`), `showContactPickerPopup` (`:752`).

### `deleteMessages.ts` — `PopupDeleteMessages` (обычный класс, не наследник)

`(peerId, mids, type: ChatType, onConfirm?, threadId?)` → `construct()`. Строит `PopupPeer` с классом `popup-delete-chat`.

- Для `ChatType.Scheduled` сообщения берутся `getScheduledMessageByPeer` (отдельное хранилище), иначе `getMessageByPeer`.
- **Модерация мегагруппы**: если мегагруппа и ни одно сообщение не `pFlags.out` — грузятся админы (`channelParticipantsAdmins`, limit 100); автор не админ → открывается `PopupDeleteMegagroupMessages` (чекбоксы report / delete-all / delete-reactions / ban).
- Матрица чекбокса «удалить у всех»:

| Ветка | Условие | Чекбокс | Описание |
|---|---|---|---|
| Saved / Scheduled / бот | `peerId === myId \|\| Scheduled \|\| isBot` | нет | — |
| Личка, все revoke-able | `canRevoke.length === mids.length` (без `messageMediaDice`) | `DeleteMessagesOptionAlso [имя]` | — |
| Личка, ни одного | `canRevoke.length === 0` | нет | `…OnlyMe` |
| Личка, часть | `0 < canRevoke < all` | `DeleteMessagesOption` | `AreYouSureDeleteFewMessagesMixed` |
| Legacy-группа | право `delete_messages` или свои | `DeleteForAll` / `DeleteMessagesOption` | `DeleteMessagesTextGroup` |
| Канал/супергруппа | — | нет, кнопка форсит `revoke = true` | активный `messageMediaGiveaway` → `BoostingGiveawayDeleteMsg*` |

- Callback умеет **разбить удаление на два вызова** (`deleteMessages(canRevoke, true)` + `deleteMessages(rest, false)`), когда revoke возможен не для всех.
- Менеджер: `deleteMessages` (`appMessagesManager.ts:6348`) — сплит по каналам, лимит `forwarded_count_max`, для канала без прав фильтрует только `pFlags.out`; `channels.deleteMessages` идёт **без** `revoke`.

### `unpinMessage.ts` — `PopupPinMessage`

`(peerId, mid, unpin?, onConfirm?)`, тоже поверх `PopupPeer('popup-delete-chat')`.
`canUnpin = appPeersManager.canPinMessage(peerId)`.

| Ветка | Title / Description | Чекбокс | Вызов |
|---|---|---|---|
| Unpin all + canUnpin | `Popup.Unpin.AllTitle` / `Chat.UnpinAllMessagesConfirmation [count]` | нет | `unpinAllMessages` |
| Unpin all, нет прав | `Popup.Unpin.HideTitle` / `HideDescription` | нет | `hidePinnedMessages` (локальный state + `peer_pinned_hidden`) |
| Unpin one | `UnpinMessageAlertTitle` / `Chat.Confirm.Unpin` | нет | `updatePinnedMessage(unpin: true)` |
| Pin в канале | `PinMessageAlertChannel` | нет | `silent = true` |
| Pin в группе | `PinMessageAlert` | **`PinNotify`**, `checked: true` | `silent = !checked` |
| Pin в личке | `PinMessageAlertChat` | **`PinAlsoFor [имя]`**, `checked: true` | `pm_oneside = !checked` |
| Pin в Saved | `PinMessageAlertChat` | нет | голый вызов |

Callback обёрнут в `setTimeout(300)` — костыль: `document.elementFromPoint` вернёт закрывающийся попап.

### `payment.ts` — `PopupPayment`

`extends PopupElement<{finish: (result) => void}>` (`:181`), super `'popup-payment'`,
`{closable, overlayClosable, body, scrollable, title: true}`.
`hide()` переопределён: **сначала `dispatchEvent('finish', this.result)`**, потом `super.hide()` —
вызывающая сторона всегда узнаёт исход (`'cancelled' | 'paid'`).
Статик **`PopupPayment.create(options)`** (`:959`) — фабрика: грузит форму/чек и выбирает конструктор
(`PopupStarsPay`, если `noPaymentForm || transaction || giftAction || *Stars`, иначе `PopupPayment`).
Спутники: `paymentCard.ts` (scrollable условный — `SUPPORTED_NATIVE_PROVIDERS`, иначе iframe),
`paymentCardConfirmation.ts`, `paymentShipping.ts`, `paymentShippingMethods.ts`,
`paymentMethods.tsx` (результат через `deferredPromise`), `paymentVerification.ts`, `starsPay.tsx`.

### `stickers.tsx` — `showStickersPopup`

`(stickerSetInput | [], isEmojisInitial?, chatInput?)` (`:40`), `STICKERS_POPUP_KIND` (`:36`).
`animationGroup='STICKERS-POPUP'` специально исключает контент из «глушилки» анимаций при открытии.
Поддерживает несколько наборов сразу; эмодзи-наборы через `wrapCustomEmoji`, стикеры — `wrapSticker`
с `LazyLoadQueue`. `deferredCloseCallbacks` откладывает клики по caption-медиа до конца анимации закрытия.
Футер: `FooterButton` с `color = isLoaded() ? (isAdd() ? 'primary' : 'danger') : 'secondary'`.

### `avatar.ts` — `PopupAvatar`

super `('popup-avatar', {closable: true})` — минимум опций. Внутри **скрытый `<input type="file">`**;
попап открывается методом `open(postCanvas, onCrop)`, который просто делает `input.click()`;
`show()` вызывается уже в `image.onload`. Кроп — `resizeableImage` из `@lib/cropper`, `btnConfirm`
пересоздаётся круглой FAB. Наружу отдаётся **ленивая функция загрузки**: `onCrop(() => appDownloadManager.upload(blob))`.

### `reactedList.ts` — `PopupReactedList`

super `'popup-reacted-list'`, `{closable, overlayClosable, body}`. Строит **фейковый message**
(`mid: 0`) с копией `reactions` и обнулённым `chosen_order`, рендерит `ReactionsElement`
в `ReactionLayoutType.Block` — **это и есть табы**; `btnClose` перекладывается внутрь него.
Две «фейковые реакции»: `'reactions'` (сумма) и `'checks'` (прочитавшие, `getMessageReadParticipants`).
На каждый таб — свой `Scrollable` + `ScrollableLoader` с курсором `nextOffset`.

### `webApp.ts` — `PopupWebApp`

Единственный попап, передающий в super **оба** делегирующих колбэка:
`onBackClick: () => this.webApp.onBackClick()` и `isConfirmationNeededOnClose`.
Из-за `onBackClick` `btnClose` получает `animated-close-icon`. `WebApp` получает наружу
DOM-узлы попапа (`header, title, body, forceHide, onBackStatus`); `destroy()` сначала
уничтожает `webApp`, потом `super.destroy()`.

## 2.2 Наследники `PopupPeer` (тонкие обёртки)

| Файл | Класс | Особенности |
|---|---|---|
| `sendNow.ts` | `PopupSendNow` (`:3`) | «Отправить отложенное сейчас»; **хардкод английских строк** мимо i18n; `show()` в конструкторе |
| `mute.ts` | `PopupMute` (`:29`) | `RadioFormFromValues` с 1ч/4ч/8ч/1д/3д/Forever (`-1 → MUTE_UNTIL`) |
| `sponsored.ts` | `PopupSponsored` (`:5`) | «Что такое спонсорские сообщения»; переносит `description` в `scrollable` |
| `boost.ts` | `PopupBoost` (`:24`) | **сносит `btnClose` и весь `header`**; `description: true` (пустой, наполняется вручную); `LimitLine` с уровнями, динамический `setButtons`; ошибки `PREMIUM_ACCOUNT_REQUIRED`/`FLOOD_WAIT_*` через `confirmationPopup`; нет слотов → `PopupReassignBoost` |
| `limit.ts` | внутр. `class P` (`:59`) + `showLimitPopup(type, popupRef?)` (`:116`) | таблица лимитов `pin/folders/folderPeers/chatlistInvites/savedPin/channels`; `LimitLine` вставляется через `description.before(...)`; `popupRef` отдаёт инстанс наружу |
| `joinChatInvite.ts` | `PopupJoinChatInvite` (`:101`) | превью инвайта по хешу; статик `.import(hash)` |
| `reassignBoost.tsx` | `PopupReassignBoost` (`:28`) | сносит header, тело рисует `createRoot` (Solid) |
| `deleteDialog.ts` | `PopupDeleteDialog` (`:8`) | switch по `peerType`: channel / monoforum / chat / saved / savedDialog / megagroup; два колбэка `callbackLeave` и `callbackDelete` |
| `simpleConfirmation.ts` | `SimpleConfirmationPopup` (`:8`) | наследует `PopupElement` напрямую и вручную копирует `.popup-description` — в комментарии объяснено: `PopupPeer`/`confirmationPopup` дают рекурсивные импорты (использовался в `loginPage`) |
| `logOut.ts` | `showLogOutPopup()` (`:4`) | 3 строки: `confirmationPopup(...).then(logOut)` |

## 2.3 Остальной каталог (сводно)

| Файл | Экспорт | Назначение / особенность |
|---|---|---|
| `aboutAd.tsx` | `showAboutAdPopup` | → `showFeatureDetailsPopup`, только конфиг |
| `addBotToChat.ts` | `showAddBotToChat` (`:61`) | confirm + picker; `mergeBotAdminRights`, `openUserPermissionsTab` |
| `ageVerification.tsx` | `AgeVerificationPopup` (`:10`) | гибрид: `appendSolidBody` |
| `birthday.tsx` | `showBirthdayPopup` (`:52`) | + `saveMyBirthday`, `suggestUserBirthday` |
| `boostsViaGifts.tsx` | `PopupBoostsViaGifts` (`:66`) | самый «полный» набор опций super |
| `buyResaleGift.tsx` | `PopupBuyResaleGift` (`:19`) | на close диспатчит `finish: false` |
| `channelsTooMuch.tsx` | `showChannelsTooMuchPopup` (`:28`) | **дорисовывает `AppSelectPeers` внутрь чужого попапа** через `popupRef` (`@ts-ignore`) |
| `chatPreview.tsx` | `showChatPreviewPopup` (`:61`) | `withoutOverlay={!isMobile}` — peek чата без затемнения на десктопе |
| `checklist.tsx` | `showChecklistPopup` (`:32`) | переиспользует стили `popup-new-media` |
| `chooseGiftPopup.tsx` / `chooseStoryPopup.tsx` | `PopupChooseGift` / `PopupChooseStory` | мульти-выбор через событие `finish` |
| `convertToGigagroup.ts` | `showConvertToGigagroupPopup` | **две последовательные конфирмации** |
| `createBot/` | `showCreateBotPopup` + `CreateBotPopup` | мастер создания бота |
| `createContact.tsx` | `showCreateContactPopup` (`:12`) | `closable={false}`; внутри legacy-`InputField`/`EditPeer` в Solid-обёртке |
| `createPoll/` (11 файлов) | `openCreatePollPopup` (`index.tsx:257`) | конструктор опросов целиком на Solid: `storeContext.ts`, `utils.ts` (`canSubmitPoll`, `hasMeaningfulChanges`, `getFinalPayload`), `pollOptionsSectionContent`, `pollSettingsSectionContent`, `mediaAttachment` (981 стр.), `stickersDropdown`, `useCreatePollLimits`. Закрытие с подтверждением только при `hasMeaningfulChanges` |
| `datePicker.tsx` | `showDatePickerPopup` (`:140`), `DATE_PICKER_POPUP_KIND` | ручная виртуализация месяцев по `scrollTop`; порт мульти-выбора диапазона (`.in-range`, `.range-edge-*`); `DayMediaThumb` — превью медиа в ячейке |
| `scheduleSendingPopup.tsx` | `showScheduleSendingPopup` (`:49`) | **обёртка над datePicker** + premium-gated «Repeat» + «Send when online» |
| `deleteMegagroupMessages.tsx` | `PopupDeleteMegagroupMessages` (`:65`) | чекбоксы report/delete/deleteReactions/ban |
| `emailSetup.tsx` | `showEmailSetupPopup` (`:275`) | 2 шага, `isConfirmationNeededOnClose` |
| `featureDetails.tsx` | `showFeatureDetailsPopup` (`:36`) | **универсальный «фича-попап»** (стикер + строки + caption + кнопки); показ только после `Sticker onReady`. База для `aboutAd`, `noForwards`, `frozen`, `passkey`, `storiesStealthMode` |
| `frozen.tsx` / `noForwards.tsx` / `passkey.tsx` / `storiesStealthMode.tsx` | `show*Popup` | конфиги над `featureDetails` |
| `giftLink.tsx` | `PopupGiftLink` (`:26`) | + статик `applyGiftCode` |
| `giftPremium.ts` | `PopupGiftPremium` (`:15`) | скидка считается от **самого короткого** тарифа: `round((1 - amount/shortest) * 100)` |
| `makePaid.tsx` | `PopupMakePaid` (`:53`) | + `InputStarsField` |
| `myQrCode.tsx` | `showMyQrCodePopup` (`:989`) | 1028 строк: генератор QR + темы |
| `password.tsx` | `passwordPopup` (`:9`) | `PopupPeer` + `PasswordInputField`; обработка `PASSWORD_HASH_INVALID`, `FLOOD_WAIT_*` |
| `pickCountry.ts` | `showPickCountryPopup` (`:22`) | picker с `peerType: ['custom']` и эмодзи-флагами |
| `pollLink/` | `openPollLinkEditorPopup` / `openPollLinkPreviewPopup` | **два попапа в одном файле** |
| `premium.ts` | `PopupPremium` (`:37`) + статик `.show()` | табы `PromoSlideTab` ↔ `FeatureSlideTab` через `TransitionSlider('navigation')`; `filterOrder` выкидывает нереализованные фичи |
| `reportAd.tsx` | `showReportAdPopup` (`:47`) + 5 обёрток | **первый запрос делается ДО создания попапа**; терминальный ответ → попап не открывается вовсе |
| `requestPeer.ts` | `selectRequestPeers` (`:18`) | обработка `keyboardButtonRequestPeer` |
| `sellStarGift.tsx` / `sendGift.tsx` / `starGift*.tsx` (6 файлов) | | подарки; `sendGift.tsx` (1220 стр.) — редкий `onBackClick` в классовом попапе |
| `shareUrl.ts` | `shareUrlToPeers` (`:38`) | **последовательный** цикл по пирам (иначе конфликт `prepareStarsForPayment`) |
| `sharedFolderInvite.ts` | `PopupSharedFolderInvite` (`:17`) | инвайт в общую папку |
| `stars.tsx` | `PopupStars` (`:341`) | + библиотека Solid-примитивов звёзд (`StarsBalance`, `StarsAmount`, `StarsChange`…) |
| `starReaction.tsx` | `PopupStarReaction` (`:35`) | звёздная реакция |
| `starsRating.tsx` | `showStarsRatingPopup` (`:31`) | **без `show`** — Solid-база показывает через `setTimeout(0)` |
| `toggleReadDate.tsx` | `PopupToggleReadDate` (`:14`) | гибрид `appendSolid`; два экземпляра `wrapPeerTitle` (нужны два DOM-узла) |
| `transferStarGift.tsx` | `transferStarGift` (`:197`) | передача подарка + `FloatingStarsBalance` |
| `translate/` (3 файла) | `openTranslatePopup` (`index.tsx:46`) | `previewCard` (Original/Result), `deferredCloseCallbacks` |
| `aiEditorPopup/` (11 файлов) | `openAiEditorPopup` (`:69`) | табы Translate/Style/Fix, кэш ответов `cachedComposedMessages`, пользовательские «тона» |
| `webAppEmojiStatusAccess.tsx` / `webAppLocationAccess.tsx` / `webAppPreparedMessage.tsx` | `PopupWebApp*` | разрешения web-app; общий паттерн `finish`-события |

---

# Часть 3. `PopupPeer` и `confirmationPopup`

## 3.1 `PopupPeer` (`popups/peer.ts:32`)

`PopupPeerOptions` (`:16`) = `Omit<PopupOptions,'buttons'|'title'>` + `peerId, threadId, title,
titleLangKey(+Args), noTitle, description | descriptionRaw | descriptionLangKey(+Args),
buttons: PopupPeerButton[], checkboxes: PopupPeerCheckboxOptions[], inputField: InputField, old`.

В `super()` уходит `'popup-peer' + className`, `overlayClosable: true`, **разворот `...options`**
(любой `PopupOptions` пробрасывается), принудительно `title: true` и `buttons: addCancelButton(...)`.

- **Аватар**: при `peerId` — `avatarNew({size: 32, isDialog: true})` префиксом в хедер (поддержан saved-dialog).
- **Description**: `<p class="popup-description">`, приоритет `descriptionLangKey` → `description` (через `setInnerHTML`) → `descriptionRaw` (`wrapEmojiText`). Поле `protected` — им пользуются наследники (`boost.ts` перезаписывает, `limit.ts` вставляет `before`, `sponsored.ts` переносит в scrollable). Особый случай `description: true` — пустой `<p>` для наполнения наследником.
- **Checkboxes**: класс `have-checkbox`; каждый — `CheckboxField({withRipple: true})`; **все `button.callback` оборачиваются**, чтобы вторым аргументом получить `Set<LangPackKey>` отмеченных (`PopupPeerButtonCallbackCheckboxes`). `button.onlyWithCheckbox` привязывает `disabled` к конкретному чекбоксу.
- **inputField**: первая не-cancel кнопка дизейблится по `isValid()`; `show()` переопределён — фокусит инпут.

## 3.2 `confirmationPopup` (`components/confirmationPopup.ts:17`)

`PopupConfirmationOptions = PopupPeerOptions & {button, checkbox?, inputField?, rejectWithReason?, className?, onPopup?}`.
Возвращаемый тип **условный**: массив `checkboxes` → `Promise<boolean[]>`; один `checkbox` → `Promise<boolean>`;
иначе `Promise<void>`.

Механика: подменяет `button.callback` на `resolve` (маппит `Set` отмеченных в массив булей),
`addCancelButton` + подмена cancel-колбэка на `reject`; `rejectWithReason` → reject получает
`'canceled' | 'closed'`. Строит `PopupElement.createPopup(PopupPeer, classNames('popup-confirmation', className), options)`,
вешает `closeAfterTimeout → reject` и показывает.

---

# Часть 4. Меню

## 4.1 `ButtonMenuItem` / `ButtonMenu` (`components/buttonMenu.ts`)

`ButtonMenuItemOptions` (`:28-61`): `id, icon, iconElement, emptyIcon, iconDoc, avatarInfo, danger, new,
className, text(+textArgs), regularText, onClick, checkForClose, element, textElement, options,
checkboxField, noCheckboxClickListener, keepOpen, separator, separatorDown, multiline, secondary,
loadPromise, waitForAnimation, radioGroup, inner, dispose, onOpen, onClose`.
Верифицируемый вариант — `ButtonMenuItemOptionsVerifiable = ... & {verify?: () => boolean | Promise<boolean>}` (`:63`).

`ButtonMenuItem()` (`:67-221`):

- Класс: `btn-menu-item rp-overflow` + хвост `icon` после первого слова (то есть `icon: "delete danger-cls"` кладёт `danger-cls` в className пункта) + `danger`.
- Ripple **только на мобиле** (`:89-91`).
- Иконка: `iconElement` / `Icon(name)` / `emptyIcon` (пустой span для выравнивания) / `iconDoc` (кастомная иконка attach-бота) / `avatarInfo` (Solid `createRoot`, `dispose` пишется в опции).
- **Логика клика** (`:154-188`): клик по пункту неактивного меню игнорируется; `checkForClose() === false` отменяет закрытие; `keepOpen = !!checkboxField || options.keepOpen`; иначе `contextMenuController.close()`.
- Бейдж «New» (`:147-152`), разделители `<hr>` (`separator` вверх / `separatorDown` вниз), `secondary` (принудительно `multiline`).

`ButtonMenuSync` / `ButtonMenu` (`:223-285`): контейнер `div.btn-menu`; radio-группы оборачиваются
в `RadioForm` (первый элемент группы заменяется на `<hr>`); асинхронный дефолтный экспорт
ждёт все `loadPromise`.

## 4.2 `ButtonMenuToggle` (`components/buttonMenuToggle.ts`)

`ButtonMenuToggleHandler` (`:16-54`): класс `menu-open` на самом триггере = признак открытости;
`hasMouseMovedSinceDown` отсекает драг; `callbackify` поддерживает синхронный и промисный `onOpen`.

`ButtonMenuToggle(...)` (`:62-189`), `onOpen` пошагово (`:113-165`):

1. `tempId` — защита от гонок (проверяется после каждого await).
2. Если ещё идёт `closeTimeout` и элемент в DOM — старое меню переиспользуется.
3. `filterButtonMenuItems(buttons)` (`:56`) — `verify`; пустой результат → меню не открывается.
4. `ButtonMenu({buttons: filtered, listenerSetter})`.
5. Направление: класс `direction`; для `bottom-center` считается `--parent-half-width`.
6. **Монтирование**: `appendTo ?? (fullScreenElement?.contains(button) ? fullScreenElement : getOverlayRoot())`.
7. `positionMenuTrigger(button, element, direction, padding ?? {top: 8, bottom: 8})`, затем `doubleRaf()`.

`onClose` (`:169-185`) — отложенная очистка через **300 мс**: `listenerSetter.removeAll()`,
`button.dispose?.()`, обнуление `element`, удаление узла. Хак `canDeleteTextElementsOnClose` —
у пунктов без готового `textElement` он удаляется, чтобы перевод перестроился.

`ButtonMenuDirection` (`:60`): `bottom-left | bottom-right | bottom-center | top-left | top-right`
(в SCSS дополнительно `top-center`, `center-left`, `center-right`).

## 4.3 Вложенные меню (`components/createSubmenuTrigger.ts`)

`createSubmenuTrigger(options, createSubmenu, direction = 'right-start')`.
Триггер — **hover (`mouseenter`)**, не клик; `level: 2`; `offset: [-5, -5]`.
`onClose` уничтожает middleware и на 200 мс блокирует повторное открытие (`isDisabled`),
чтобы hover не открыл меню, пока оно закрывается.
Метка пересоздаётся геттером `regularText` каждый раз (`submenu-label` + `Icon('arrowhead')`) — комментарий `// * fix langpack`.
Потребители: `chat/contextMenu.ts:888,896`, `dialogsContextMenu.ts:143`, `chat/topbar.ts:438`,
`sidebarLeft/index.ts:665,673`, `stories/profileList.tsx:158`, `stargifts/stargiftsGrid.tsx:95`.

`attachFloatingButtonMenu` (`components/floatingButtonMenu.ts:19-84`): `triggerBcr` снимается **до** await,
после `createMenu()` проверяется актуальность, затем `getOverlayRoot().append` →
`positionFloatingMenu` → `doubleRaf` → `contextMenuController.addAdditionalMenu(menu, element, level, onClose)`.

## 4.4 `contextMenuController` (`helpers/contextMenuController.ts`)

`class ContextMenuController extends OverlayClickHandler` — синглтон (`:179`), конструктор
`super('menu', true)` (navigationType `'menu'`, с оверлеем); на `mediaSizes 'resize'` закрывает меню.

`openBtnMenu(element, onClose?, triggerElement?)` (`:133-151`): класс `night` при тёмном оверлее,
`super.open(element)`, классы **`active` + `was-open`** на меню и **`menu-open`** на триггере,
а на десктопе — `mousemove` слушатель.

`close(e?)` (`:92-125`): снимает `active`/`menu-open`, закрывает все `additionalMenus`,
снимает `night` отложенно (400 мс), `super.close()`.

**Закрытие по уходу мыши** — `onMouseMove` (`:40-71`): считает расстояние курсора до bounding-box;
корневое меню закрывается при **≥ 100 px**, подменю — при **≥ 40 px** (и от `triggerElement` тоже 40).

`addAdditionalMenu(element, triggerElement, level, onClose?)` (`:153-176`) — стек подменю:
`closeMenusByLevel(level)`, затем `active`/`was-open`; закрытие удаляет узел через `pause(400)`.

База `OverlayClickHandler` (`helpers/overlayClickHandler.ts`): `realmDocument/realmWindow`
переопределяются по `element.ownerDocument` (Document PiP); `open()` пушит `NavigationItem`
(кроме iOS Safari), создаёт `div.btn-menu-overlay` **перед** элементом меню, слушает `contextmenu`
(`once`) и `CLICK_EVENT_NAME`; `close()` снимает всё и `appNavigationController.removeByType`.

Точка входа контекстных меню — `helpers/dom/createContextMenu.ts`: `open()` (`:48-99`) ставит
`menu-open` на таргет, `positionMenu(e, element)`, `openBtnMenu(...)` с cleanup через 300 мс;
`init()` (`:121-153`) фильтрует по `verify`, добавляет класс `contextmenu`, монтирует в `getOverlayRoot()`.

**Клавиатурной навигации по пунктам (стрелки/Enter) в меню НЕТ** — проверено grep'ом; единственная
клавиатурная обработка — Escape через `appNavigationController`.

## 4.5 `positionMenu` (`helpers/positionMenu.ts`)

Константы (`:7-32`): `PADDING_* = 8`, `DEFAULT_MENU_WINDOW_MARGIN = 16`;
типы `FloatingMenuSide/Alignment/Direction`, `OPPOSITE_SIDE`.

**`positionMenu(e, elem, side?, additionalPadding?)`** (`:189-313`) — позиционирование **у курсора**:

- touch нормализуется, используются `pageX/pageY`;
- ширина берётся с внутреннего `.btn-menu-items` (или первого видимого пункта) + `offsetLeft * 2`;
- сторона по умолчанию: RTL → `left`/`right`, мобила инвертирует (`// * side mean the OPEN side`);
- кандидаты `x: {left, right}`, `y: {top, bottom}` + «промежуточные» значения; проверка помещаемости;
- **flip/fallback**: если сторона не влезает, ставится промежуточная и сторона помечается `center`;
- **transform-origin классами**: старые снимаются регуляркой `/(top|center|bottom)-(left|center|right)/g`, новый — `bottom-right | bottom-left | bottom-center | center-*` с учётом RTL.

**`positionMenuTrigger(trigger, menu, direction, padding?)`** (`:315-339`) — относительно кнопки;
осторожно с именами: `directionX` фактически вертикальная часть (`bottom`/`top`), `directionY` — горизонтальная.

**`positionFloatingMenu(...)`** (`:63-144`) — для подменю: flip через `canFitSide`, `clamp` по
поперечной оси, inline `transform-origin` в угол/грань, ближайшую к триггеру; возвращает
фактический `${side}-${alignment}`.

## 4.6 Анимация меню (SCSS)

- `$btn-menu-z-index: 4` (`_button.scss:3`), подменю — `z-index + 1` (`:107-109`).
- Переменные меню (`:98-106`): `--btn-menu-padding: .25rem`, `--transform-extra`, `--transform-origin-x/y`.
- **Ключевое** (`:125-139`): `visibility: hidden; opacity: 0; transform: var(--transform-extra) scale(.8);` с transition `var(--btn-menu-transition)`; открытое (`:206-213`) — `scale3d(1,1,1)` (комментарий: `scale3d` (NOT scale) фиксит прыжок текста).
- **Время — 200 мс**: `--btn-menu-transition: .2s cubic-bezier(.4, 0, .2, 1)` (`base.scss:61`). JS-очистка использует 300 мс (`buttonMenuToggle.ts:184`, `createContextMenu.ts:95`) и 400 мс (`contextMenuController.ts:110,164`).
- Направления и `transform-origin` — `_button.scss:228-277`; RTL-переменные `--transform-origin-inline-start/end` (`base.scss:44-45`, своп `:51-52`).
- Пункт: `height: 2rem`, `--icon-size: 1.25rem`, нажатие `transform: scale(.96)` (`:330-332`), hover через `hover-background-effect()` (+`red` для danger).
- Оверлей `.btn-menu-overlay` (`:589-607`): `position: fixed !important`, расширен на `±100vw / ±100vh`.
- Мобильный вид `&-old, .is-mobile &` (`:160-204`): без blur, высота пункта 3rem, `border-radius: 0`, `transform: none !important`.

---

# Часть 5. Тосты и тултипы

## 5.1 `toast.ts` (66 строк) — глобальный singleton-тост

DOM создаётся **один раз на модуль** (`:6-11`): `div.toasts-container` + `div.toast`.
Оверлей-хендлер `new OverlayClickHandler('toast')` — **без оверлея** (значит `capture: true` в слушателях).

```ts
toast(content, onClose?, duration = 3000)   // :32-56
hideToast()                                  // :20-30 — снимает is-visible, удаляет узел через 200 мс
toastNew({langPackKey, langPackArguments, onClose, duration})  // :58-65
```

**Очереди нет** — тост один: новый вызов делает `x.close()` + `replaceContent` и вытесняет предыдущий.
SCSS — `base.scss:741-751` (`.toasts-container`: fixed, `z-index: 5`, `pointer-events: none`)
и `:754-781` (`.toast`: `rgba(0,0,0,.66)`, `backdrop-filter: blur(25px)`, `opacity` 0→1
через `--transition-standard-in` = .3s).

## 5.2 `tooltip.tsx` — `showTooltip`

Модульное состояние (`:10-11`): `KEEP_TOOLTIP = true`, общий `tooltipOverlayClickHandler`
(`navigationType === undefined` → в навигацию ничего не пушится; оверлей есть).

Опции (`:12-55`): `element` (якорь), `container` (ограничитель ширины), `vertical: 'top'|'bottom'`,
`textElement`, `subtitleElement`, `rightElement`, `paddingX`, `offsetY`, `centerVertically`,
`icon`, `auto`, `mountOn`, `relative`, `absolute`, `lighter`, `useOverlay`.

Позиционирование (`:56-95`): центрирование по якорю с `clamp` в границах контейнера,
вертикальный отступ 12 px, «клювик» (19 px) компенсируется CSS-переменной `--notch-offset`.
DOM (`:98-121`): `div.tooltip.tooltip-{vertical}` > `.tooltip-background` + `.tooltip-notch` +
`.tooltip-text` (+`.tooltip-subtitle`) + `.tooltip-right`.

Появление — `SetTransition('is-visible', 200 мс, useRafs: 2)` (`:123-133`).
**Автозакрытия по умолчанию НЕТ**: `const timeout = KEEP_TOOLTIP && !auto ? 0 : setTimeout(close, 3000)`
(`:164`) — тултип живёт до клика по оверлею.

SCSS `_tooltip.scss`: `.mounted { transform: scale(0.9) }` → `.is-visible.forwards { transform: scale(1) }`,
`-notch` через `clip-path: url(#tooltip-notch-clip)`.

## 5.3 `chat/chatToast.tsx` — тост под шапкой чата

Это **не** `toast.ts`, а обёртка над тултипом: `showTooltip({element: chat.container,
mountOn: chat.container, relative: true, vertical: 'top', class: 'chat-toast chat-toast--{slide|fade}'})`.
Одновременно живёт только один (`current?.hide()`), скрывается на `peer_changed` при `closeOnPeerChange`.
SCSS `_chatToast.scss`: `top: var(--chat-padding-top)`, нотч скрыт, `--slide` выезжает из-под топбара
(`translate(-50%, calc(-100% - 10px))`).

## 5.4 `chat/markupTooltip.ts` — панель форматирования

Класс-синглтон (`:24-51`), `static DISPLAY_MARKUP_PARTLY = false`.
Методы: `show()` (`:402`), `hide()` (`:277`), `showLinkEditor()` (`:221`), `showDatePicker()` (`:188`),
`getActiveMarkupButton()` (`:299`), `handleSelection()` (`:518`), `canFormatInput()` (`:514`).
Пушит `NavigationItem` типа `'markup'`; SCSS `_chatMarkupTooltip.scss` (`--layer-transition` = .2s).

## 5.5 Краткая карта потоков

1. **Меню по кнопке**: `ButtonMenuToggle` → клик → `filterButtonMenuItems` (verify) → `ButtonMenu` → монтирование в overlay-root → `positionMenuTrigger` → `openBtnMenu` → `active` (scale .8→1 за 200 мс) + `menu-open`.
2. **Контекстное меню**: `createContextMenu` → `attachContextMenuListener` → `ButtonMenu` → `positionMenu(e, el)` у курсора → `openBtnMenu`.
3. **Подменю**: `createSubmenuTrigger` → `attachFloatingButtonMenu` (mouseenter) → `positionFloatingMenu` → `addAdditionalMenu(level 2)`.
4. **Закрытие меню**: клик по документу/оверлею, `contextmenu`, Esc через навигацию, уход мыши >100/40 px, ресайз.
5. **Тост**: singleton, 3000 мс показ / 200 мс скрытие.
6. **Тултип**: Portal + `SetTransition` 200 мс, по умолчанию без автозакрытия.

## 5.6 Чем меню принципиально отличается от попапа (сводка для порта)

| | Попап | Меню |
|---|---|---|
| Контроллер | `PopupElement` (свой стек `POPUPS`) | `contextMenuController` (синглтон: одно корневое меню + стек подменю) |
| Тип навигации | `'popup'` | `'menu'` |
| Подложка | сам `.popup` затемняет (`rgba(0,0,0,.3)`) | прозрачный `.btn-menu-overlay` либо capture-слушатели |
| `overlayCounter` | инкрементирует (кроме `withoutOverlay`) | **не трогает** — анимации под меню не глушатся |
| Анимация | fade + `translateY(3rem)`, 150 мс | `scale(.8) → scale3d(1,1,1)` от угла, 200 мс |
| Удаление из DOM | через 250 мс после `destroy` | 300 мс (`ButtonMenuToggle`) / 400 мс (подменю) |
| Закрытие мышью | клик по подложке при `overlayClosable` | клик вне + **увод курсора** (100 / 40 px) |
| Позиционирование | центр экрана через flex | `positionMenu` (курсор) / `positionMenuTrigger` (кнопка) / `positionFloatingMenu` (подменю) |

---

# Часть 6. Слои: попапы ↔ медиавьювер ↔ меню

## 6.1 z-index (все — сиблинги в `body`, при равном z-index побеждает поздний в DOM)

| Слой | z-index | Где |
|---|---|---|
| `.popup` | 4 | _popup.scss:29 |
| `.contextmenu` (обёртка `.btn-menu` у курсора) | 4 !important | base.scss:645–651 |
| медиавьювер `.overlays` (фон) | 4 | mediaViewer.scss:738–745 |
| `.toasts-container` | 5 | base.scss:740–747 |
| passcode lock screen | `--passcode-lock-screen-z-index: 100000` | base.scss:222 |

Попап, открытый поверх медиавьювера, оказывается выше него именно за счёт порядка append в body.

## 6.2 `overlayCounter` (`helpers/overlayCounter.ts`)

Счётчики, не флаги: `overlaysActive` и `hasDarkOverlays` (overlayCounter.ts:7–8). `isOverlayActive = true` — инкремент, `false` — декремент; событие `change`. `isDarkOverlayActive` ставят медиавьювер (`mediaViewer/base.ts:1032`), сториз (`stories/viewer.tsx:3320`), fullscreen-видео (`wrappers/video.ts:876`), медиаредактор.

Сосуществование:

- попап, созданный при активном тёмном оверлее, получает класс `night` (index.ts:129–132);
- медиавьювер игнорирует клавиатуру, когда `overlayCounter.overlaysActive > 1` (то есть поверх него попап/меню с оверлеем) — `mediaViewer/base.ts:1134, 1163`;
- `contextMenuController` не закрывает меню по `change`, если активен тёмный оверлей (contextMenuController.ts:128);
- по `change(true)` глобально стопаются фоновые анимации (`animationIntersector`).

## 6.3 `appNavigationController` — единый стек «того, что закрывается по back/Esc»

`NavigationItem.type` (appNavigationController.ts:10–15): `'left' | 'right' | 'im' | 'chat' | 'popup' | 'media' | 'menu' | 'esg' | 'multiselect' | 'input-helper' | 'autocomplete-helper' | 'markup' | 'global-search' | 'voice' | 'mobile-search' | 'filters' | 'global-search-focus' | 'toast' | 'dropdown' | 'forum' | 'stories' | 'stories-focus' | 'topbar-search' | 'settings-popup' | 'monoforum' | 'inline-message-input'`.

- Попапы пушат `type: 'popup'`, медиавьювер — `'media'` (mediaViewer/base.ts:2432–2447), меню — `'menu'`, тосты с undo — `'toast'`.
- Каждый `pushItem` без `noHistory` делает `history.pushState` — браузерный back закрывает верхний оверлей, а не уходит со страницы (appNavigationController.ts:368–384).
- `onPop(canAnimate)` возвращает `false` → элемент возвращается в стек (отмена закрытия).
- `item.onEscape` — доп. вето на Esc; `registerEscapeHandler` — глобальные вето (например, пока идёт ввод).

---

# Часть 7. Карта SCSS

Точка входа — `src/scss/partials/popups/` (подключается из style.scss). Общие:

| Файл | Что стилизует |
|---|---|
| `popups/_popup.scss` | база `.popup` / `.popup-container/-header/-title/-close/-body/-footer/-buttons/-button/-description`, анимация active/hiding, `.old`, floating header |
| `popups/_popupVariables.scss` | `$popup-footer-button-size: 44px`, `$popup-footer-padding: .5rem`, abitlarger: 48px/1rem |
| base.scss:70–72 | `--popup-transition-function`, `--popup-transition-time: .15s` |

Попапо-специфичные партиалы (класс попапа → файл): `_peer.scss` (`.popup-peer` — confirm-диалоги), `_confirmation.scss`, `_mediaAttacher.scss` (`.popup-new-media` / `.popup-send-photo`), `_forward.scss`, `_stickers.scss`, `_datePicker.scss`, `_mute.scss`, `_reactedList.scss`, `_limit.scss` + `_accountsLimit.scss`, `_giftPremium.scss`, `_giftLink.scss`, `_premium.scss`, `_boost.scss`, `_boostsViaGifts.scss`, `_stars.scss`, `_starGiftInfo.scss`, `_starGiftUpgrade.scss`, `_toggleReadDate.scss`, `_payment*.scss` (5 файлов), `_webApp.scss`, `_sponsored.scss`, `_reportAd.scss`, `_createContact.scss`, `_editAvatar.scss`, `_joinChatInvite.scss`, `_chatlistInvite.scss`, `_chatPreview.scss`, `_instanceDeactivated.scss`, `_makePaid.scss`, `_deleteMegagroupMessages.scss`, `_call.scss`, `_groupCall.scss`, `_conferenceCall.scss`.

Новые Solid-попапы несут собственные CSS-модули рядом с кодом (`popups/*.module.scss`: ageVerification, birthday, checklist, sendGift, myQrCode и т.д.).

Смежные: `partials/_button.scss:98+` (`.btn-menu` — меню), base.scss:645 (`.contextmenu`), base.scss:740 (`.toasts-container`), `partials/_tooltip.scss`, `partials/_chatToast.scss`, `partials/_chatMarkupTooltip.scss`, `components/mediaViewer/mediaViewer.scss:738` (`.overlays`).

---

# Часть 8. Наш клиент (`web-client/`): структурные расхождения

## 8.1 Карта наших файлов

| Путь | Роль |
|---|---|
| `src/stores/popupStore.ts:45` | `usePopupStore` (zustand): `PopupEntry {id, render, closing, kind}`, `openPopup`/`closePopup`/`clearPopups` |
| `src/components/PopupHost.tsx:6` | единственная точка рендера стека (смонтирован в `App.tsx:286`) |
| `src/core/hooks/useChatPopups.tsx:81` | фасад открытия ~20 попапов колонки чата |
| `src/shared/ui/Popup/Popup.tsx:83` | центрированная модалка — порт `PopupElement` (`PopupFooterButton` — :68); z-index 4090 |
| `src/shared/ui/ConfirmPopup/ConfirmPopup.tsx` | порт `PopupPeer` (кнопки/чекбоксы/danger); z-index 4090 |
| `src/components/settings/ConfirmDialog.tsx:20` | второй confirm (настройки), z-index 1400 |
| `src/components/settings/kit.tsx:162` | `usePopupTransition(open)` — третья копия механики `active`/`hiding` |
| `src/shared/ui/Menu/Menu.tsx:55` | `Menu` (портал + свой бэкдроп + `.btn-menu.active`), `cornerFrom` :21 |
| `src/core/navigation/navigationStack.ts:42` | `pushLayer`/`removeLayer` — LIFO под браузерный back (владелец `popstate`) |
| `src/core/hotkeys.ts:11` | `pushEsc` — отдельный LIFO для Esc |
| `src/core/hooks/useGlobalToast.ts:12` | тост: событие `rootScope('ui:toast')`, автоскрытие 4 c, рендер в `GlobalOverlays.tsx:54–66` |
| `src/helpers/positionMenu.ts:27` | порт `positionMenuTrigger` — используется только vanilla-медиавьювером (`mediaViewer/appMediaViewer.ts:350`) |
| `src/styles/tweb/popups/_popup.scss` | портированная база `.popup` (`active`/`hiding`, переменные) |

## 8.2 Главные расхождения с tweb

1. **Нет единого `appNavigationController`.** Вместо одного LIFO — два независимых: `navigationStack` (только `popstate`) и `escStack` в `hotkeys.ts` (только Esc). Регистрируются порознь и не всеми: `Popup` — оба; `ConfirmPopup` — nav-слой + собственный capture-keydown мимо `escStack`; `Menu`, `ConfirmDialog`, `usePopupTransition`-попапы — ни одного. Итог: часть модалок не закрывается по Esc/Back, порядок закрытия при смешении типов может разъехаться.
2. **Нет `overlayCounter`.** Ничего не глушит анимации под открытым попапом, нет общего признака «есть открытый оверлей» (в `hotkeys.ts:60–62` вместо этого эвристика `setTimeout` + `defaultPrevented`).
3. **Нет базового класса `PopupElement`.** `popupStore` — лишь реестр render-функций; общий хедер/футер/кнопки/`withoutOverlay`/Enter-confirm отсутствуют. Механика `active`/`hiding` продублирована минимум трижды (`Popup.tsx:107–143`, `ConfirmPopup.tsx`, `kit.tsx:162–192` + урезанная в `GlobalOverlays`), с разными деталями (transitionend vs таймер 300 мс).
4. **Императивный стек покрывает меньшинство.** 29 вызовов `openPopup` против ~20 state-driven попапов (`ChatMsgActionPopups.tsx` — осознанно мимо стора, `GlobalOverlays.tsx`, `Chat.tsx:1621` `SendMediaPopup`) и vanilla-медиавьювера. Плюс `Chat.tsx:339` сносит все попапы `clearPopups()` при анмаунте колонки.
5. **Стек не задаёт порядок наложения.** В tweb у всех оверлеев `z-index: 4` и порядок append решает всё; у нас — ручные числа 500…9999 по всему дереву (4090 Popup, 4200 MediaEditor «выше Popup и его меню», 2000/2001 Menu, 3100 меню в StoryViewer через проп и т.п.).
6. **Нет `contextMenuController`/общего `positionMenu` для React-меню.** Каждый вызывающий сам меряет клик и решает флип по захардкоженным габаритам (`MW=256, MH=440` в `useMessageActions.tsx:136`; `MW=220, MH=320` в `ChatListItem.tsx:85`); закрытие по клику вне — собственный `.backdrop` у каждого меню вместо документ-контроллера.
7. **Тост — не порт `toast.ts`.** Один слот `toast: string|null` в `GlobalOverlays`, без очереди/`toastsContainer`; API — строка через `rootScope('ui:toast')` (17 мест). Классы `.toast.is-visible` и снятие через 200 мс воспроизведены.
8. **`kind` — суррогат синглтонов tweb.** Механизм повторного открытия того же «сорта» есть (`popupStore.ts:51–54`), но применён лишь к 3 попапам (DatePicker, StickerSet, RightSearch); остальные при повторных открытиях копятся стопкой.

Вывод для порта: недостающие «несущие стены» — единый навигационный стек (Esc+Back в одном месте), `overlayCounter`, базовый попап-компонент с одной реализацией `active`/`hiding` и общий контроллер меню с `positionMenu` по фактическим размерам.

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Esc и системный «назад» закрывают верхний слой в любой комбинации попап + меню + медиавьювер + поиск.
- [ ] Клик вне закрывает меню; попап закрывается кликом по оверлею и не закрывается при `withoutOverlay`.
- [ ] Анимация появления: попап — из центра, меню — `scale(.8)` от своего угла за 200 мс.
- [ ] Меню у правого и нижнего края экрана флипается, а не обрезается.
- [ ] Enter подтверждает попап с кнопкой-подтверждением; отказ реджектит промис `confirmationPopup`.
- [ ] Под открытым попапом анимации на паузе, оверлей затемняет и не мигает при смене попапов.
- [ ] Тост появляется и уходит сам; тултип позиционируется относительно якоря.
- [ ] Два попапа подряд: закрытие верхнего не закрывает нижний.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 06-delete-popup, 06-forward-popup, 17-popup-00…06, 05-context-menu.
