# Оболочка попапов на Solid (tweb `812502980`): референс для порта 1:1 (волна 2C)

Снято 2026-09-27. Источники:

- tweb `/Users/denisurevic/Documents/tweb`, коммит **`812502980`** — все адреса ниже по нему,
  если не сказано «старая база» (`e52b5d931`, `/Users/denisurevic/Documents/tweb-e52b5d931`);
- наш код `web-client/` на `origin/main` = `05296593`.

Что этот док заменяет. [`popups.md`](popups.md) снят по старой базе: его **Части 1–3 и 8**
описывают класс `PopupElement` (`popups/index.ts`) и класс `PopupPeer`, которых в `812502980` нет —
их удалил 2556fc949. Части 4–7 (меню, тосты, слои, карта SCSS) там остаются в силе. Здесь —
то, что пришло на место класса, и наш путь к нему. План переноса —
[`../superpowers/plans/2026-09-27-wave-2c-popups-solid.md`](../superpowers/plans/2026-09-27-wave-2c-popups-solid.md).

Цепочка коммитов (роадмап дельты, блок 2C, [`delta/README.md`](delta/README.md); разбор —
[`delta/part-5.md`](delta/part-5.md)):

| Коммит | Что сделал с оболочкой |
|---|---|
| 3eb7a9020 (до 2556fc949) | `PopupElement.Header floating`, `Scrollable.trackEnds`, `isScrolledToStart/End` в контексте скролла, единый размер иконки в кнопке попапа (`_popup.scss:362-372`) |
| **2556fc949** | класс `PopupElement` (`popups/index.ts`, 504 стр.) и `settingSection.ts` **удалены**; ~80 попапов переписаны на `showXxxPopup()` поверх Solid `<PopupElement>` (`popups/indexTsx.tsx`); оболочка берёт на себя стыки «скролл ↔ футер/кнопки» (`hasFlowFooter`/`hasFlowButtons`, `$popup-scroll-bleed`); общий `FeatureRows`; `PopupPeer` → функция `showPeerPopup` (`popups/peer.tsx`) с `RowTsx`-строками чекбоксов |
| 6c3803343 | Premium переведён на `PopupElement.Footer`/`FooterButton` (самодельная `action-button-container` снята); образец «попап на оболочке, а не своя полоса» |
| **472e3e76b** | a11y оболочки: `role="dialog"`, `aria-modal`, `tabindex=-1`, авто-`aria-labelledby`, `focusTrap` с возвратом фокуса, Enter не перехватывает нативные контролы, `aria-label` крестика, `scrollRegion`, `onEscape(event)` + `!e.defaultPrevented` в навигации, `scroll-padding-bottom` под плавающим футером |

Промежуточные правки файла `indexTsx.tsx` (803f9599d, 237a8b38c) — косметика, на порт не влияют.

---

## 1. Что удалено и что пришло

| Было (старая база) | Стало (`812502980`) |
|---|---|
| `class PopupElement extends EventListenerBase<{close, closeAfterTimeout}>` (`popups/index.ts`) | компонент `PopupElement(props)` (`popups/indexTsx.tsx:133-465`) + статические части (`:467-822`) |
| `PopupElement.createPopup(Ctor, …args).show()` | `createPopup(() => <PopupElement …>)` (`:836-842`) — `createRoot` + `PopupControllerContext {dispose}` |
| наследник `class PopupXxx extends PopupElement` | функция `showXxxPopup(options)` в том же файле попапа; состояние — сигналы замыкания |
| события `close`/`closeAfterTimeout` | пропы `onClose` (`:280`), `onCloseAfterTimeout` (`:312`) |
| `getPopups(Ctor)` через `instanceof` | `PopupElement.getPopups(kind: symbol)` (`:818-822`); пять символов в HEAD: `STICKERS_POPUP_KIND` (`stickers.tsx:39`), `DATE_PICKER_POPUP_KIND` (`datePicker.tsx:124`), `CHAT_PREVIEW_POPUP_KIND` (`chatPreview.tsx:55`), `STARS_POPUP_KIND` (`stars.tsx:511`), `GROUP_CALL_POPUP_KIND` (`groupCall/index.tsx:119`) |
| `appendPopupTo()` + `reAppend()` на `fullscreenchange` | `<Portal mount={fullScreenElement() \|\| capturedRoot}>` (`:410`), сигнал фулскрина (`:111-117`), `capturedRoot = getOverlayRoot()` один раз (`:157`) |
| опции-флаги `title/body/scrollable/footer/withConfirm/buttons/floatingHeader` | слоты-компоненты `Header/Title/CloseButton/Body/Scrollable/Footer/FooterPlaceholder/FooterButton/Button/Buttons` (§ 3) |
| `overlayClosable` | закомментирован (`:48`); клик по подложке закрывает всегда, кроме `closable === false` (`:425-442`) |
| `class PopupPeer` (`popups/peer.ts`) | `showPeerPopup(className, options): PopupPeerHandle` (`popups/peer.tsx:74-188`) |
| `appendSolid`/`appendSolidBody` | не нужны: содержимое и есть JSX |
| `settingSection.ts` | `components/section.tsx` (Solid) — уже у нас (`section.solid.tsx`, волна 2D) |

**Гибридов больше нет.** Паттерн «класс + `appendSolid`» из § 1.7 `popups.md` в HEAD не встречается:
`createPopup(` вызывают 84 файла, классов-наследников ноль.

---

## 2. Корень `<PopupElement>` (`popups/indexTsx.tsx`)

### 2.1 Пропы (`:42-53`, `:133-142`)

| Проп | Эффект |
|---|---|
| `class`, `containerClass`, `containerProps` | класс подложки `.popup`, класс и атрибуты `.popup-container`; `ref` из `containerProps` вызывается из своего (`:406`, `:446-449`) |
| `show?: boolean` | реактивный показ: `true` → `show()`, `false` при показанном → `hide()`, оба через `doubleRaf` (`:370-382`). Без пропа — `doubleRaf().then(show)` сразу (`:383-389`): переход играет, только если браузер успел нарисовать скрытое состояние |
| `closable` | в контекст (`:357`); клик по подложке запрещает только `closable === false` (`:433`) |
| `onClose`, `onCloseAfterTimeout` | первым делом в `destroy()` (`:280`) и последним в 250-мс таймере (`:312`) |
| `isConfirmationNeededOnClose` | в `onPop`: truthy/Promise → запись не снимается (`return false`), `destroy()` после резолва (`:189-199`) |
| `confirmShortcutIsSendShortcut` | Enter-подтверждение по настройке отправки (`isSendShortcutPressed`, `:254`) |
| `withoutOverlay` | класс `no-overlay`, без `overlayCounter`, без паузы анимаций, без `focusTrap`, без `aria-modal`, без снятия фокуса (`:160`, `:205-213`, `:228`, `:292`, `:308`, `:451`) |
| `btnConfirmOnEnter?: Accessor<HTMLElement>` | внешняя кнопка «по Enter» (`:322-326`); иначе её ставит `Button confirm` (§ 3) |
| `old` | класс `old` → `--popup-background-color: var(--surface-color)` (`_popup.scss:395-397`) |
| `kind?: symbol` | идентичность для `getPopups` |
| `animationGroup` | своя группа анимаций — исключается из паузы на показе (`:141`, `:212`) |
| `managers` | иначе `PopupElement.MANAGERS` (`:153`), который ставит `appDialogsManager.ts:980` |

### 2.2 Контекст `PopupContext` (`:57-98`, значение `:328-362`)

`register(kind, el)`/`registerButton(props, el)` — слоты регистрируются в сторе и снимаются
`onCleanup` (`:168-178`); `shown`/`show`/`hide`/`destroy`/`destroyed`; `middlewareHelper` и
`lateMiddlewareHelper`; `navigationItem`; `scrollableRef` (реактивно: шапка рисуется раньше
скролла, `:74-77`); флаги стыков `hasFloatingHeader`/`hasFlowFooter`/`hasFlowButtons` (§ 4);
`btnConfirmOnEnter`; `element`/`container`; `kind`; `old`. `usePopupContext()` (`:105`);
`useSnitchedPopupContext()` (`:119-129`) — достать контекст наружу рендером пустого компонента
(потребители: `createPoll`, `call/settingsPopup` — у нас нет).

### 2.3 Жизненный цикл

**`show()`** (`:180-262`):

1. стоп, если уже показан или разрушен; запомнить `previouslyFocusedEl` = активный элемент
   документа `capturedRoot` (`:181-184`);
2. `setShown(true)` → класс `active`;
3. `NavigationItem {type: 'popup', noBlurOnPop: true, onPop}` → `appNavigationController.pushItem`
   (`:186-203`); `onPop` зовёт `destroy()` (с вето `isConfirmationNeededOnClose`);
4. без `withoutOverlay`: `previouslyFocusedEl.blur()`, `overlayCounter.isOverlayActive = true`,
   `animationIntersector.checkAnimations2(true, props.animationGroup)` (`:205-213`);
5. `setTimeout(0)`: если узел `active` — авто-`aria-labelledby` у `.popup-container` по
   `.popup-title, [data-popup-title], h1, h2` (`:220-226`); без `withoutOverlay` —
   `createFocusTrap(container, () => верхний в POPUPS)` + `activate(previouslyFocusedEl)`
   (`:228-234`); `keydown` на `body` активного окна через `bindActiveWindowListener`, снимается
   `middlewareHelper` (`:237-260`, § 5).

**`hide()`** (`:264-274`) — не закрывает сам: `appNavigationController.backByItem(navItem)`, и
крестик, Esc, клик вне и системный «назад» сходятся в `onPop`. Без записи — сразу `destroy()`.

**`destroy()`** (`:276-314`) — порядок существенен:

1. `focusTrap.deactivate()` (возврат фокуса), `props.onClose()`;
2. `hiding` + `destroyed` + `!shown` — узел играет выход;
3. через **250 мс**: снять `hiding`; `middlewareHelper.destroy()`; `controllerContext.dispose()`
   (снимает весь Solid-корень попапа, «call it here for the content»); `MarkupTooltip.hide()`;
   `overlayCounter.isOverlayActive = false`; `appNavigationController.removeItem(navItem)`;
   убрать из `POPUPS`; `onFullScreenChange()`; `lateMiddlewareHelper.destroy()`;
   `checkAnimations2(false)`; `props.onCloseAfterTimeout()`.

Отличие от старого класса: DOM-узел не удаляется руками — его снимает `dispose()` корня
(`Portal` умирает вместе с ним). Раньше — `element.remove()` + `closeAfterTimeout`.

**Стек** — `PopupElement.POPUPS: PopupContextValue[]` (`:468`): пуш при создании компонента
(`:365`), снятие `onCleanup` и в таймере `destroy` (`:366-368`, `:302`). Верхний попап нужен
двум вещам: Enter-подтверждению (`:241`) и `focusTrap` (`:231`).

### 2.4 Разметка и клик вне (`:408-464`)

```
<Portal mount={fullScreenElement() || capturedRoot}>
div.popup.<class>[.night][.no-overlay][.active][.hiding][.old]      ← onMouseDown/onClick (клик вне)
  └ div.popup-container.z-depth-1.<containerClass>[role=dialog][aria-modal=true][tabindex=-1]
      └ {children}: слоты в том порядке, в каком их написал попап
```

Клик вне (`:422-442`): игнор, если цель внутри `.popup-container` или отсоединена; стоп при
`closable === false`; **mousedown внутри + mouseup снаружи не закрывает** (`mouseDownTarget`).
`night` — снимок `overlayCounter.isDarkOverlayActive` на момент создания (`:161`).

---

## 3. Слоты (`:471-816`)

| Слот | Разметка | Детали |
|---|---|---|
| `Header` (`:471-500`) | `div.popup-header[.is-floating][.scrolled-start]` (+ `div.popup-header-background` при `floating`) | `floating` → `setHasFloatingHeader`; `scrolled-start`, пока скролл у верха (`scrollableRef.isScrolledToStart ?? true`); `ref` |
| `Title` (`:502-526`) | `div.popup-title[dir=auto]` | `title`: ключ → `i18n`, узел — как есть; иначе `children`; пустой не рисуется |
| `CloseButton` (`:528-554`) | `button.btn-icon.popup-close[aria-label=Close]` > `IconTsx close` \| `div.animated-close-icon[.state-back]` | `canGoBack && onBackClick` → колбэк, иначе `hide()` |
| `Body` (`:556-567`) | `div.popup-body` | `ref` для императивного содержимого |
| `Scrollable` (`:574-630`) | `Scrollable` (`scrollable2.tsx`) с классом `popup-scrollable` | регистрирует `scrollableRef`; `trackEnds` при плавающей шапке или футере в потоке; `withBorders` по стыкам (§ 4); фокусируемость по содержимому (§ 5) |
| `Footer` (`:632-665`) | `div.popup-footer.popup-footer-abitlarger[.popup-footer-floating][.popup-footer-sticky][.popup-footer-shaded][.scrolled-end]` | в потоке (`!floating && !sticky`) → `setHasFlowFooter(true)`, класс `popup-footer-shaded`; `scrolled-end` по `isScrolledToEnd ?? true` |
| `FooterPlaceholder` (`:672-676`) | `div.popup-footer-placeholder` | распорка высотой `--popup-footer-height` в конце скролла под плавающим футером |
| `FooterButton` (`:678-698`) | `Button` + `popup-footer-button btn-primary` + по `color`: `btn-color-primary` \| `btn-transparent primary text-bold` (secondary) \| `btn-primary-transparent danger` | `noDefaultClass` |
| `Button` (`:700-799`) | `buttonTsx` с `popup-button btn` + `danger`/`primary` | промис колбэка → `disabled` + `pending` (`preloader` поверх, `pendingLangKey` вместо подписи); `false`/reject — попап остаётся, иначе `hide()`; `confirm` → `setBtnConfirmOnEnter(ref)`; клик по разрушенному игнор (`:726`) |
| `Buttons` (`:801-816`) | `div.popup-buttons[.is-vertical-layout]` | `setHasFlowButtons(true)` |
| `addCancelButton` (`:824-834`) | — | дописывает `{langKey: 'Cancel', isCancel: true}` |

Порядок детей = порядок в DOM: оболочка ничего не переставляет. Типовая шапка:
`<Header><CloseButton/><Title/></Header>`.

---

## 4. Стыки: скролл ↔ шапка, футер, кнопки (2556fc949, 3eb7a9020)

Оболочка сама решает, кто рисует линию на стыке:

| Стык | Кто рисует | Где |
|---|---|---|
| шапка в потоке над скроллом | верхняя граница скролла (`withBorders` `top`) | `indexTsx.tsx:581-585` |
| плавающая шапка | своя подложка `.popup-header-background` + заголовок проявляются при уходе скролла от верха | `_popup.scss:151-185` |
| ряд кнопок `Buttons` под скроллом | нижняя граница скролла (`bottom`) | `:583` |
| футер в потоке | сам футер: `border-top` + фон, пока `:not(.scrolled-end)` | `_popup.scss:249-264` |
| плавающий футер | градиент (`popup-footer-floating`), распорка `FooterPlaceholder`, `scroll-padding-bottom` | `_popup.scss:315-335`, `:243-245` |

Нужное от скролла — `scrollable2.tsx`: проп `trackEnds` (следить за концами без рамки),
`isScrolledToStart/isScrolledToEnd` в `ScrollableContextValue` (3eb7a9020), `tabIndex` (472e3e76b).
После показа оболочка пересчитывает концы (`onSizeChange` через `doubleRaf`, `:394-401`): попап
раскладывается скрытым, и без пересчёта линия футера ошибается на пару пикселей.

SCSS HEAD (`_popup.scss`), которых не было у нас (**перенесены 2C-4**: `diff` с HEAD — одна строка `@use`):

- `:211-216` — `.popup-container > .popup-scrollable` — `position: relative; flex: 1 1 auto; min-height: 0`;
- `:221-227` — тело внутри скролла заполняет скролл и ничего не режет;
- `:234-237` — `.popup-scrollable:has(+ .popup-footer-shaded)` — `$popup-scroll-bleed: 5px`
  (`_popupVariables.scss:6-9`): тень последней карточки не обрезается краем скролла;
- `:243-245` — `scroll-padding-bottom` под плавающим футером (472e3e76b);
- `:249-264` — `.popup-footer-shaded`;
- `:266-273` — **хвост из 2D**: `.popup-body:has(+ .popup-footer)`, `.popup-scrollable:has(+ .popup-footer)`
  → у последней `.sidebar-left-section-container` `padding-bottom: 0` (`settings-rows.md` § 8.1);
- `:362-372` — `font-size: 1.25rem` у обеих иконок кнопки, симметричные отступы (3eb7a9020);
- 69a759cbc снял `.popup:not(.old) .popup-close` и `.popup.old .popup-header .btn-icon` — у нас
  они ещё стоят (`scss-parity` видит их как «только у нас»).

---

## 5. Клавиатура и скринридер (472e3e76b)

| Что | Где |
|---|---|
| `role="dialog"`, `aria-modal="true"` (кроме `withoutOverlay`), `tabindex=-1` у `.popup-container` | `indexTsx.tsx:450-452` |
| авто-`aria-labelledby` на первый `.popup-title, [data-popup-title], h1, h2` (id `popup-title-tsx-N`), если у контейнера нет своего `aria-label(ledby)` | `:131`, `:220-226` |
| `focusTrap`: Tab/Shift+Tab по кругу внутри, фокус возвращается туда, откуда открыли; живёт только у верхнего попапа | `:228-234`, `:279`; `helpers/dom/focusTrap.ts:61-184` (`getFocusableElements` `:23-50`, стек ловушек на документ `:54`, `activate` `:130`, `deactivate` `:145`) |
| фокус снимается с открывшего элемента (не `blurActiveElement()`), навигация не блюрит на закрытии (`noBlurOnPop`) | `:183-184`, `:188`, `:205` |
| Enter-подтверждение не срабатывает на `defaultPrevented`/IME/автоповторе, на нативных контролах (`isKeyboardControl`), в раскрытом комбобоксе, в `textarea`/`contenteditable` (без send-шортката) | `:237-258`; `helpers/dom/isKeyboardControl.ts:4-9` |
| `keydown` вешается на `body` АКТИВНОГО окна | `:260`; `helpers/appWindow.ts:83-122` |
| `aria-label` у крестика | `:547` |
| скролл — вкладка фокуса только если внутри нечего фокусировать; тогда `role=region` + имя из заголовка; пересчёт по `MutationObserver` | `:587-607`; `helpers/dom/scrollRegion.ts:27-44` |
| Esc: `onEscape(event)`, пропуск `defaultPrevented` | `appNavigationController.ts:17`, `:219` |

Тесты-свипы tweb (`test:focus`, axe, песочница `?popups=1`) — тулинг, не переносим; их
инварианты — в чеклисте ниже.

---

## 6. `showPeerPopup` и `confirmationPopup`

`showPeerPopup(className, options): PopupPeerHandle` (`popups/peer.tsx:74-188`):

- опции (`:28-57`) — `PopupOptions` + `peerId`/`threadId`/`avatar`, `title`/`titleLangKey(+Args)`/
  `noTitle`/`noHeader`, `body`, `description`/`descriptionRaw`/`descriptionLangKey(+Args)`,
  `buttons: PopupPeerButton[]` (`onlyWithCheckbox` — кнопка активна при отмеченном чекбоксе),
  `checkboxes`, `inputField`, `content`/`contentBefore` (JSX под/над описанием), `deferShow`,
  `scrollable`;
- разметка (`:161-183`): `<PopupElement class="popup-peer <className>" containerClass="have-checkbox"? closable old>`
  → `Header` (аватар 32 `AvatarNewTsx` `:190-202` или свой `avatar`; `Title`) → содержимое в
  `Body`/`Scrollable`/как есть → `Buttons` (`is-vertical-layout` при ≥3, `:105`);
- содержимое (`:137-159`): `contentBefore` → `p.popup-description` (`:60-69`) → `inputField` →
  чекбоксы строками `RowTsx.popup-peer-checkbox-row` + `RowTsx.CheckboxField` + `CheckboxFieldTsx`
  (`:144-156`, с ef41b29db) → `content`;
- Enter — у единственной не-cancel кнопки пары (`:100`); кнопка поля ввода дизейблится, пока поле
  невалидно (`:92-96`, `:102`, `:125`); колбэк читается в момент клика (`:129`);
- `handle = {show, hide}` (`:187`) — сигнал `show` (`deferShow` держит попап до готовности содержимого).

`confirmationPopup(options)` (`components/confirmationPopup.ts:17-46`) — промис поверх
`showPeerPopup('popup-confirmation …')`: резолв — кнопкой (`boolean` при одном чекбоксе, массив
при нескольких), реджект — отменой (`'canceled'`) или закрытием (`'closed'` через
`onCloseAfterTimeout`), причина — при `rejectWithReason`; `onPopup(handle)`.

---

## 7. Формы `showXxxPopup` в каталоге

| Форма | Образец |
|---|---|
| показ сразу | `showAutoDeleteMessagesCustomTimePopup` (`sidebarLeft/tabs/autoDeleteMessages/customTimePopup/index.tsx:15-41`) |
| показ после готовности содержимого (`show={show()}`) | `showFeatureDetailsPopup` — по `onReady` стикера (`popups/featureDetails.tsx:29-80`); `showOutputDevicePopup` — после `enumerateDevices` (`rtmp/outputDevicePopup.tsx:110-118`); `showMyQrCodePopup` — после первого кадра канваса (`popups/myQrCode.tsx:968-1007`) |
| ручка наружу `{show, hide}` / `hide` | `showPeerPopup`, `showStickersPopup` (`stickers.tsx:49-51`), `showFeatureDetailsPopup` (возвращает `close`) |
| синглтон по `kind` | `stickers.tsx:398`, `datePicker.tsx`, `stars.tsx`, `chatPreview.tsx` |
| над `showPeerPopup` | `showLogOutPopup` (`logOut.ts:4-15`), `showLimitPopup` (`limit.ts:68-138`), `showMutePopup` (`mute.ts:32`) |
| над `showFeatureDetailsPopup` + `FeatureRows` | `showPasskeyPopup` (`passkey.tsx:33-67`); `components/featureRows.tsx:18-30` + `featureRows.module.scss` |
| над `showPickUserPopup` | `showSendGiftPicker` (`sendGiftPicker.ts:11-23`), `showSharingPickerPopup`/`showContactPickerPopup` (`pickUser.tsx:779-856`) |

---

## 8. Каталог: что нужно нам (по потребителям)

Строки — HEAD. «2D» — задача плана `2026-09-26-wave-2d-settings-rowtsx.md`, которая ждёт попап.

| Попап tweb | Файл (строк) | Оболочка | Кто зовёт в tweb | Ждёт у нас |
|---|---|---|---|---|
| `showPeerPopup` / `confirmationPopup` | `popups/peer.tsx` (214), `confirmationPopup.ts` (46) | § 6 | ~98 файлов | все мосты `ConfirmDialog`, `popupPeer.ts` |
| `showLogOutPopup` | `popups/logOut.ts` (15) | над `confirmationPopup` | `settings.tsx:115` | 2D-28 |
| `showMutePopup` | `popups/mute.ts` (77) | над `showPeerPopup` + `RadioFormTsx` | меню чата, чатлист | наш `popupMute.ts` |
| `showFeatureDetailsPopup` + `FeatureRows` | `popups/featureDetails.tsx` (80) + `.module.scss` (29), `featureRows.tsx` (30) + `.module.scss` (17) | `Header floating` + `MediaHeader` + `Footer` | passkey, toggleReadDate и др. | 2D-21 (через passkey) |
| `showPasskeyPopup` | `popups/passkey.tsx` (67) | над featureDetails | `passkeys.tsx:103`, `privacyAndSecurity.tsx:298` | 2D-21, 2D-23 |
| `showAutoDeleteMessagesCustomTimePopup` | `…/customTimePopup/{index,content}.tsx` (41+52) + `verticalOptionWheel.tsx` (300) | `old`, `Buttons` | `autoDeleteMessages/index.tsx:77` | 2D-20 |
| `showOutputDevicePopup` | `rtmp/outputDevicePopup.tsx` (143) + `.scss` | `Scrollable` + `FooterPlaceholder` + `Footer floating` | `call/callDeviceSettings.tsx:73` | 2D-26 |
| `showStickersPopup` | `popups/stickers.tsx` (409) | `kind`, `Scrollable`, `Footer floating={isLoaded()}` | `stickersAndEmoji.tsx:188`, чат, эмодзи | 2D-15 |
| `showPickUserPopup` (+ `showSendGiftPicker`) | `popups/pickUser.tsx` (856) | `AppSelectPeers` + `TransitionSlider` форумов | `blockedUsers.tsx:68`, `editProfile.tsx:214`, пересылка | 2D-22, 2D-27, 2D-28 |
| `showBirthdayPopup` | `popups/birthday.tsx` (307) + `.module.scss` | `old`, `Header floating`, `Footer` | `editProfile.tsx:328`, профиль, подсказка | 2D-27, 2D-30 |
| `showMyQrCodePopup` | `popups/myQrCode.tsx` (1007) + `.module.scss` | своя шапка-канвас | `settings.tsx:110`, профиль | 2D-28, 2D-30 |
| `showLimitPopup` | `popups/limit.ts` (138) | над `showPeerPopup` + `LimitLine` | папки, пины, каналы | 2D-24/25 (О-22) |
| `showPremiumPopup` | `popups/premium.tsx` (342) | `Header`/`Body`/`Footer` (6c3803343) | `settings.tsx:421`, лимиты | 2D-28, 2D-30 |
| `showStarsPopup` | `popups/stars.tsx` (998) | `kind`, `Header floating` | `settings.tsx:426` | 2D-28, 2D-30 |
| `showSendGiftPicker` → `showSendGiftPopup` | `sendGiftPicker.ts` (23), `sendGift.tsx` (1227) | над pickUser | `settings.tsx:441` | 2D-28 |
| `showSharedFolderInvitePopup` | `popups/sharedFolderInvite.tsx` (256) | `popup-forward`, `AppSelectPeers`, `Footer` | ссылка `t.me/addlist` | 2D-25 |
| `showDeleteMessagesPopup` | `popups/deleteMessages.ts` (197) | над `showPeerPopup` | контекст-меню, выделение | наш `DeleteMessageDialog` |
| `showDatePickerPopup` | `popups/datePicker.tsx` (970) | `kind` | календарь чата | наш `DatePickerPopup` |
| `showForwardPopup` | `popups/forward.tsx` (443) | над pickUser | пересылка | наш `ForwardPicker` |

`emojiStatusPicker.tsx` — **не попап**: это `EmoticonsDropdown` у кнопки (`sidebarLeft/emojiStatusPicker.tsx:1-120`),
к оболочке 2C не относится (зона композера/эмодзи).

---

## 9. У нас (`origin/main` = `05296593`)

### 9.1 Карта наших файлов

**Vanilla-порт удалённого класса** (волна 1 Solid-программы, план `2026-08-29-solid-wave-1.md`):

| Путь (строк) | Роль |
|---|---|
| `components/popups/popupElement.ts` (424) | порт класса `PopupElement` старой базы: `constructor(className, options)`, `setButtons` (:258), `show` (:313), `hide` → `backByItem` (:361), `forceHide` (:374), `destroy` (:378, 250 мс), `createPopup(Ctor)` (:421), стек `POPUPS` (:156), `overlayCounter` (:335, :400). Монтирует в `document.body` (:331). Не портировано (докблок :7-50): `isConfirmationNeededOnClose`, `old`/`night`, `withoutOverlay`, `getPopups`/`reAppend`, `scrollable`/`floatingHeader`, `confirmShortcutIsSendShortcut`, `footer`, `MarkupTooltip` |
| `components/popups/popupPeer.ts` (309) | порт класса `PopupPeer` + `confirmationPopup` (:249, промис; наши расширения `zIndex`, `getPopup`) |
| `components/popups/popupMute.ts` (111) + `.module.scss` | `PopupMute extends PopupPeer` (порт `mute.ts` старой базы) |
| `components/popups/pickUserFolderTabs.ts` (159) | кусок `pickUser.tsx:325-424` для React-`ForwardPicker` |
| `components/settings/ConfirmDialog.tsx` (84) | React-мост к `confirmationPopup` (11 JSX-вызовов в 6 файлах), снимает попап `forceHide()` на размонтировании |
| тесты | `popupElement.test.ts` (171), `popupPeer.test.ts` (303), `popupMute.test.ts` (86), `settings/ConfirmDialog.test.tsx` (94), `core/hooks/useChatPopups.mutePopupCleanup.test.tsx` (108) |

Прямые вызовы vanilla-попапов (кроме моста): `createPopup(PopupMute)` — `ChatListItem.tsx:84`,
`useChatPopups.tsx:129`; `createPopup(PopupPeer, …)` — `messages/ChatDialogs.tsx:86` (удаление с
чекбоксами), `sidebarLeft/tabs/2fa/email.solid.tsx:118`, `2fa/index.solid.tsx:69`,
`lib/richtext/maskedAnchor.ts:48`; `confirmationPopup` — `Composer.tsx:267`,
`auth/cards/PasswordCard.solid.tsx:98, :150, :159`, `emoji/StickersTab.tsx:309`,
`sidebarLeft/globalSearch.ts:593`, `tabs/activeSessions.solid.tsx:101, :134`,
`tabs/dataAndStorage/index.solid.tsx:100`, `tabs/dataAndStorage/storageQuota.solid.tsx:247`,
`tabs/editFolderShared.ts:36`, `tabs/passcodeLock/mainTab.solid.tsx:212`.

**React-механика** (три реализации `active`/`hiding`):

| Путь (строк) | Роль | Потребители |
|---|---|---|
| `shared/ui/Popup/Popup.tsx` (163) + `.module.scss` | React-копия разметки `.popup`; `active`/`hiding` на rAF, выход по `transitionend` (фолбэк 300 мс); портал в `usePortalContainer()` (`core/pip.ts:18-21`); Esc/Back — `useNavLayer(open, onClose, 'popup')` (:92); `z-index: 4090` (`.module.scss:14`); `PopupFooterButton` (:67) | 27 файлов |
| `stores/popupStore.ts` (73) + `components/PopupHost.tsx` (23) | zustand-стек render-функций, `kind` — синглтон; хост в `App.tsx:300` | `openPopup`: `useChatPopups.tsx` (21), `Chat.tsx:726`, `Sidebar.tsx:176`, `GifsSearchTab.tsx:64`, `StickersSearchTab.tsx:313`, `StickerSetModal.tsx:388`, `useChatHeaderSearch.ts:209`; `clearPopups` — `Chat.tsx:361` |
| `components/settings/kit.tsx:204` `usePopupTransition(open)` | `{mounted, cls}`, свой портал и разметка у каждого; **ни навигации, ни `overlayCounter`** — Esc/Back такие попапы не закрывают | `EmojiStatusPicker`, `PremiumCheckout`, `PremiumModal`, `QrModal`, `settings/BirthdayModal`, `settings/PasskeyIntroPopup`, `stars/{GiftInfo,SendGift,Stars}Popup` |
| `core/hooks/useNavLayer.ts` (32) | `pushItem`/`removeItem` из React | `'popup'` — только `Popup.tsx:92` |
| `components/shell/GlobalOverlays.tsx` (137) | глобальный слой: `FolderInvitePopup` (:121), `WebAppModal` (:128), `ReportPopup` (:131), самописное QR-подтверждение входа (:96-117) | — |
| `core/hooks/useChatPopups.tsx` (330) | фасад попапов колонки чата | `Chat.tsx` |

**Общая инфраструктура:**

| Путь | Состояние |
|---|---|
| `core/navigation/appNavigationController.ts` (611) | порт; `onEscape?: () => boolean` (:101), в `onKeyDown` нет `!e.defaultPrevented` (:297) — дельта 472e3e76b не перенесена |
| `helpers/overlayCounter.ts` (41) | порт 1:1; `isOverlayActive` пишет только `popupElement.ts`; React-попапы счётчик не трогают |
| `helpers/appWindow.ts` (106) | **2C-3 ✅** порт HEAD `:18-122`: `getOverlayRoot`, `setAppWindow`, `onAppWindowChange`, `bindActiveWindowListener`; `getAppWindow`/`onBeforeAppWindowChange` — нет читателя (метрики в выносе окно не меняют), расхождение 1 в шапке. Писатель один — `core/pip.ts` `enterAppPip` (окно ДО переноса `#root`, как `clientPip.tsx:62`/`:118`) рядом с `usePipStore.win` (вторая читательская форма — для React-порталов, до О-17); там же, по `clientPip.tsx:76-83` и `:104-120`, делегаты Solid на документ PiP и возврат временных корней во вкладку (React-порталы — `flushSync` стора до сбора). Esc навигации следует за окном (`appNavigationController.ts` — `bindActiveWindowListener`, tweb `:79`). Не переведены на активное окно (у tweb — через `appWindow`): `focusTrap.ts` (переезд ловушки, tweb `:135-137`, `:146-147` — после влития #313), `mediaViewer/base.ts:1351` (свой `document.body`), `clickEvent.ts`, `contextMenu.ts`, `overlayClickHandler.ts` и др. — их шапки ещё пишут «выноса нет» |
| `components/scrollable2.solid.tsx` (411) | порт до 3eb7a9020: нет `trackEnds`, `isScrolledToStart/End` в `ScrollableContextValue` (:81-91), `tabIndex` |
| `helpers/dom/focusTrap.ts`, `scrollRegion.ts`, `isKeyboardControl.ts`, `isSendShortcutPressed.ts` | **нет** (`sendShortcut` в настройках тоже нет — `keyboardShortcuts.solid.tsx:20-23`) |
| `components/MarkupTooltip.tsx` | React, синглтона `getInstance().hide()` нет |
| `components/buttonTsx.solid.tsx`, `iconTsx.solid.tsx`, `rowTsx.solid.tsx` (`Row.Icon noBackground` :452), `section.solid.tsx`, `radioFieldTsx.solid.tsx`, `checkboxFieldTsx.solid.tsx`, `mediaHeader.solid.tsx` (`Sticker onReady` :91), `appSelectPeers.solid.tsx`, `putPreloader.ts`, `animationIntersector.ts` (`checkAnimations2(blurred, exceptGroup)` :373) | есть — строительный материал оболочки и попапов |
| `styles/tweb/popups/` | `_popup` (429) и `_popupVariables` (9) — **HEAD 1:1 (2C-4)**, вместе с 69a759cbc (`.btn-icon` — `--primary-text-color`, `_button`/`_animatedIcon`/`_chat`/`_profile`; крестики React-`Popup`/`PremiumModal` без инлайн-цвета); остальные партиалы: `_peer`, `_confirmation`, `_forward`, `_stickers`, `_datePicker`, `_premium` (`_index.scss:83-89`); нет `_mute`, `_limit`, `_stars`, `_reactedList`, `_webApp`, `_payment*`, `_boost*`, `_createContact`, `_chatlistInvite`, … |

### 9.2 React-попапы и их пара в tweb

Механика: **RP** — `shared/ui/Popup`; **PT** — `usePopupTransition`; **PS** — через `popupStore`;
**V** — vanilla `popupElement.ts`; **own** — свой портал без `.popup`.

| Наш (строк) | Механика | Кто открывает | Пара в tweb |
|---|---|---|---|
| `stickers/StickerSetModal.tsx` (400) | RP+PS | `Chat.tsx:1067`, `StickersSearchTab.tsx:30` (импорт) | `showStickersPopup` |
| `settings/AutoDeleteMessages.tsx:85` (свой срок) | RP | сам экран | `showAutoDeleteMessagesCustomTimePopup` |
| `settings/PasskeyIntroPopup.tsx` (116) | PT | `PrivacySecuritySettings.tsx:264` | `showPasskeyPopup` |
| `settings/SpeakersCamera.tsx:177` `DevicePicker` | RP | `:159` | `showOutputDevicePopup` |
| `settings/BirthdayModal.tsx` (87) | PT, без портала | `EditContactView.tsx:173`, `settings/EditProfile.tsx:288` | `showBirthdayPopup` |
| `messages/ChatDialogs.tsx:304` `ContactPicker` | RP+PS | `useChatPopups.tsx:248` | `showContactPickerPopup` |
| `settings/PrivacyUserPicker.tsx` (99) | экран, не попап | `BlockedUsers.tsx:61`, `PrivacyRule.tsx:127` | `showPickUserPopup` (`blockedUsers.tsx:68`); в правилах — `AppAddMembersTab` (2D-16/17) |
| `messages/ChatDialogs.tsx:169` `ForwardPicker` (+ `pickUserFolderTabs.ts`) | RP | `ChatMsgActionPopups.tsx:93`, `StoryViewer.tsx:607` | `showForwardPopup` |
| `messages/ChatDialogs.tsx:64` `openDeleteMessageDialog` | V | `ChatMsgActionPopups.tsx:49` | `showDeleteMessagesPopup` |
| `ChatDialogs.tsx:438` `ReactedUsersPopup` | own | `ChatMsgActionPopups.tsx:88` | `showReactedListPopup` |
| `ChatDialogs.tsx:355` `ChatPicker` | RP | **никто** (мёртвый) | — |
| mute | V `PopupMute` | `useChatPopups.tsx:129`, `ChatListItem.tsx:84` | `showMutePopup` |
| `QrModal.tsx` (388) | PT | `SettingsView.tsx:372`, `UserInfoPanel.tsx:743` | `showMyQrCodePopup` |
| `folders/FolderInvitePopup.tsx` (122) | RP | `GlobalOverlays.tsx:121` | `showSharedFolderInvitePopup` |
| `PremiumModal.tsx` (320), `PremiumCheckout.tsx` (169) | PT | `Sidebar.tsx:177`, `SettingsView.tsx:362`; `PremiumModal.tsx:311` | `showPremiumPopup`; оплата — `payment*.tsx` |
| `stars/StarsPopup.tsx` (80) | PT | `SettingsView.tsx:368`, `stars/SendGiftPopup.tsx:154` | `showStarsPopup` |
| `stars/SendGiftPopup.tsx` (158) | PT+PS | `useChatPopups.tsx:105` | `showSendGiftPicker` → `showSendGiftPopup` |
| `stars/GiftInfoPopup.tsx` (131) | PT | **никто** (только тест `dateLabels.form.test.tsx:31`) | `showStarGiftInfoPopup` |
| `DatePickerPopup.tsx` (513), `SchedulePopup.tsx` (40) | RP+PS | `Chat.tsx:727`, `useChatHeaderSearch.ts:209`; `Composer.tsx:741`, `ScheduledView.tsx:99`, `SuggestedPostsView.tsx:99` | `showDatePickerPopup`, `showScheduleSendingPopup` |
| `ReportPopup.tsx` (91) | RP | `GlobalOverlays.tsx:131` (цель — `reportStore`) | `showMessageReport`/`showPeerReport` (`reportAd.tsx:360-393`) |
| `CreatePollPopup.tsx` (142), `CreateChecklistPopup.tsx` (104) | RP+PS | `useChatPopups.tsx:218`, `:232` | `createPoll/`, `showChecklistPopup` |
| `NewContactPopup.tsx` (100) | RP | `ContactsView.tsx:113` | `showCreateContactPopup` |
| `StealthModePopup.tsx` (111) | RP | `StoryViewer.tsx:603` | `showStoriesStealthModePopup` |
| `BoostPopup.tsx` (73), `CreateGiveawayPopup.tsx` (94) | RP+PS | `useChatPopups.tsx:190`, `:198` | `showBoostPopup`, `showBoostsViaGiftsPopup` |
| `StreamSettingsPopup.tsx` (112), `SuggestPostPopup.tsx` (85) | RP+PS | `useChatPopups.tsx:194`, `:210` | `rtmp/adminPopup.tsx`, `chat/suggestPostPopup/index.tsx` |
| `webapp/WebAppModal.tsx` (469) | own | `GlobalOverlays.tsx:128` | `showWebAppPopup` |
| `messages/SendMediaPopup.tsx` (429) | RP (в `MediaEditor`) | `Chat.tsx:1523` | `showNewMediaPopup` (2328) |
| `EmojiStatusPicker.tsx` (78) | PT | `SidebarEmojiStatusButton.tsx:38` | не попап: `EmoticonsDropdown` (§ 8) |
| без пары-попапа у tweb: `LocationPicker.tsx`, `TopicsPanel.tsx:521` (у tweb — вкладка `editTopic`), `FactCheckEditor.tsx`, `secret/KeyVerificationPopup.tsx`, `ChatThemesPicker.tsx` (попап), `conversation/PinnedMessagesScreen.tsx` (у tweb — тип чата), `ScheduledView`/`SuggestedPostsView` (тип чата), `PostStats`/`StoryStats` (вкладки), `AvatarCropper.tsx` (медиаредактор), подтверждения `StoryViewer.tsx:586`, `PasscodeLockScreen.tsx:93`, QR-входа `GlobalOverlays.tsx:96-117` | RP / own | — | — |

Выхода с подтверждением нет: `MainMenu.tsx:242` → `onLogout` сразу (у tweb пункта в бургере нет,
выход — ⋮ настроек `settings.tsx:115` → `showLogOutPopup`). Лимит-попапа нет (пин-лимит — тост
`ChatListItem.tsx:120`).

### 9.3 Главные расхождения с `812502980`

1. **Опора ушла из референса.** Наша база — порт класса, которого у tweb нет; все новые попапы
   tweb написаны на `<PopupElement>`-компоненте. Порт любого попапа HEAD поверх `popupElement.ts`
   — перевод, а не копия.
2. **Четыре механики вместо одной**: vanilla-класс, `shared/ui/Popup`, `usePopupTransition`, свои
   порталы. Esc/Back закрывают только первые две; `overlayCounter` видит только первую; анимации
   под PT/own-попапами не глушатся.
3. **Нет a11y оболочки** (§ 5): ни `role="dialog"`, ни `focusTrap`, ни возврата фокуса.
4. **Нет стыков скролла и футера** (§ 4): SCSS `:211-273` перенесён (2C-4), `scrollable2` — задача 1;
   рисовать стыки некому, пока нет оболочки (задача 5).
5. **`z-index: 4090` у `shared/ui/Popup`** против `4` у tweb (`_popup.scss:34`): порядок решает DOM.
6. ~~**Корень оверлеев не следует за окном PiP**~~ — снято 2C-3: `getOverlayRoot()` следует за
   `enterAppPip`. Остаток — потребители, ещё не переведённые на активное окно (§ 9.1, строка `appWindow.ts`).
7. **`PopupPeer` — класс с `checkboxField.label`**, у tweb — `RowTsx`-строки чекбоксов (ef41b29db).

## Проверка после порта

Прощёлкать на стенде (`?noSharedWorker=1` во встроенном браузере), прежде чем говорить «готово»:

- [ ] Попап открывается с «всплытием» контейнера на 3rem и фейдом подложки за `--popup-transition-time`
  (.15s); при `body.animation-level-0` — мгновенно.
- [ ] Esc, крестик, клик по подложке и системный «назад» закрывают верхний попап одинаково (одна
  запись навигации); mousedown внутри + mouseup снаружи не закрывает; `closable={false}` — клик вне
  не закрывает.
- [ ] Два попапа подряд: Esc закрывает только верхний; Enter подтверждает только верхний.
- [ ] Tab/Shift+Tab ходят по кругу внутри попапа; после закрытия фокус возвращается на кнопку,
  которой открыли. У контейнера `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → id
  заголовка; у крестика `aria-label`.
- [ ] Enter на кнопке «Отмена» жмёт отмену, а не подтверждение; Enter в поле ввода подтверждает.
- [ ] Под открытым попапом стикеры/гифки ленты стоят; после закрытия идут; стикеры внутри попапа
  (набор стикеров) играют.
- [ ] Длинный список в попапе с футером: у футера линия и фон, пока под ним есть контент; у низа —
  прозрачен, тень последней карточки видна (`$popup-scroll-bleed`).
- [ ] В режиме «Картинка в картинке» (вынос клиента) попап открывается в окне PiP.
- [ ] В DOM после закрытия (250 мс) нет `.popup`; Solid-корень снят (пин владельца).

Машинная сверка разметки: `tools/tweb-parity/snapshot-dom.js` → `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Дампы: `06-delete-popup`, `06-forward-popup`, `17-popup-01-forward-share`, `17-popup-03-delete-message`,
`17-popup-06-date-picker`, `14-left-24-premium-popup`, `14-left-33-auto-delete`,
`14-left-35-passkeys-popup`. Стили — `node tools/tweb-parity/scss-parity.mjs _popup.scss` (после 2C-4 — «0 / 0»; скрипт не видит
`:has(…)`-блоков — их сверять `diff`'ом файла: отличие от HEAD — только `@use`).
