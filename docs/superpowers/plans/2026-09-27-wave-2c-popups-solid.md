# Волна 2C: оболочка попапов на Solid, 1:1 с tweb `812502980` — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development`.
> Шаги помечены чекбоксами (`- [ ]`). Перед каждой задачей — скилл `tweb-parity`.

**Цель:** у попапов одна оболочка — Solid-компонент `<PopupElement>` со слотами и функция
`createPopup` (порт tweb `components/popups/indexTsx.tsx` HEAD), а каждый попап —
функция `showXxxPopup(options)`, как у tweb после 2556fc949. Vanilla-порт удалённого класса
(`components/popups/popupElement.ts`, `popupPeer.ts`, `popupMute.ts`) **удаляется**. В первую
очередь переезжают попапы, которых ждут экраны волны 2D (стикерсет, свой срок автоудаления,
пасскей, выбор пользователя, устройство вывода, день рождения, QR, выход, премиум/звёзды/подарок,
приглашение в папку); затем — прочие React-попапы, у которых в tweb есть пара.

**Место в программе.** Блок **2C** волны 2 дельты (`docs/tweb/delta/README.md`, «Волна 2 — платформа»):
2556fc949 (класс `PopupElement` удалён, `showXxxPopup()`) → 6c3803343 → a11y попапов из 472e3e76b.
По спеке Solid-миграции (`docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 8) — волна 1
«Попапы»; спека писалась, когда у tweb база была классом («база — класс, содержимое — Solid»,
§ 8 строка волны 1). С 2556fc949 класса нет — поправка 1 ниже.

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит **`812502980`** (все адреса — по нему, если
не сказано «старая база» = `e52b5d931`). **Разбор с адресами — [`docs/tweb/popups-solid.md`](../../tweb/popups-solid.md)**
(оболочка, слоты, стыки, a11y, `showPeerPopup`, каталог, «у нас», чеклист). Меню, тосты и слои —
[`docs/tweb/popups.md`](../../tweb/popups.md) Части 4–7.

**Соседи.** План 2D (`2026-09-26-wave-2d-settings-rowtsx.md`): задачи 15, 20, 21, 22, 23, 25, 26,
27, 28, 30 ждут попапы отсюда (таблица «Что разблокирует 2D»). Параллельно идут задачи 2D 13, 17,
24, 29 — их файлы (`generalSettings`, `chatThemesPicker`, `privacySection`, `privacy/*`,
`chatFolders`/`editFolder`, `dialogRow.ts`, `appSearchSuper.ts`) эта волна не трогает.

---

## Поправки к постановке (проверены в исходниках)

1. **Опора — компонент, а не класс.** Спека § 8 (волна 1) и докблок `popupElement.ts:1-5`
   держатся за класс `PopupElement` старой базы. В `812502980` его нет: `popups/index.ts` удалён
   2556fc949, `createPopup(` зовут 84 файла, наследников `PopupElement` ноль
   (`popups-solid.md` § 1). Порт любого попапа HEAD поверх нашего класса — перевод, а не копия
   (§ 6a спеки запрещает). Поэтому база переписывается файлом `indexTsx.tsx`, а класс сносится
   (задача 9), когда съедут его 20 вызывающих.
2. **`showXxxPopup` зовётся из React напрямую, без острова.** Попап сам себе корень:
   `createPopup` = `createRoot` + `<Portal>` в `getOverlayRoot()` (`indexTsx.tsx:836-842`, `:410`).
   Для React-вызывающего это обычная функция — как сейчас `confirmationPopup`. Правило
   `web-client/CLAUDE.md` «острова на крупных границах» не нарушается: острова нет, узел не
   вставляется в React-дерево. Правило шва остаётся: React-владелец, который может умереть
   раньше попапа, снимает его ручкой (`handle.hide()`), как сейчас `ConfirmDialog` зовёт `forceHide()`.
3. **У нас ЕСТЬ вынос клиента в Document PiP** (`core/pip.ts:49-106`, `enterAppPip`: `#root`
   переезжает в окно PiP; React-попапы уже порталят туда через `usePortalContainer`,
   `core/pip.ts:18-21`). Докблок `helpers/appWindow.ts:5-13` («выноса клиента у нас нет») неверен.
   Оболочка монтируется в `getOverlayRoot()` (`indexTsx.tsx:157`) — без писателя активного окна
   попап из PiP открылся бы в фоновой вкладке. Отсюда задача 3.
4. **`emojiStatusPicker` — не попап.** План 2D (задача 30, строка «кит в `EmojiStatusPicker`»)
   относит его к 2C. У tweb это `EmoticonsDropdown` у кнопки (`sidebarLeft/emojiStatusPicker.tsx:1-120`),
   оболочки `PopupElement` там нет. В 2C не входит — О-14 (решение пользователя, см. отчёт).
5. **Выход из аккаунта у tweb — только из ⋮ настроек** (`sidebarLeft/tabs/settings.tsx:115` →
   `showLogOutPopup`), в бургере пункта нет (`sidebarLeft/index.ts` — ни одного `LogOut`). Наш
   `MainMenu.tsx:242` выходит сразу, без подтверждения. Задача 13 ставит подтверждение; судьба
   пункта бургера — вопрос пользователю.
6. **Лимит-попап недостижим на нашем бэкенде.** `showLimitPopup` (`limit.ts:68-138`) читает
   `apiManager.getAppConfig()` и `getLimit(type, premium)`; ручек нет, лимиты зашиты
   (`backend/internal/domain/folder.go:12` `MaxFoldersPerUser = 10`,
   `usecase/chat/dialog_flags.go:15` `maxPinnedDialogs = 5`, комментарий `usecase/chat/reaction.go:16`).
   Это уже О-22 плана 2D; здесь — О-4, задачи нет.

## Ключевой шов — четыре механики сейчас, одна в конце

| Механика | Где | Судьба в 2C |
|---|---|---|
| vanilla-класс (`popupElement.ts`/`popupPeer.ts`/`popupMute.ts`) | 20 вызывающих (`popups-solid.md` § 9.1) | переводятся на `showPeerPopup`/`confirmationPopup`/`showMutePopup`/`showDeleteMessagesPopup` (задачи 6–8), класс удаляется (задача 9) |
| `shared/ui/Popup` (+ `popupStore`/`PopupHost`) | 27 файлов | попапы с парой в tweb переезжают (пакеты B, C); остаток без пары — О-17 (уходит со своими волнами) |
| `usePopupTransition` (`settings/kit.tsx:204`) | 9 файлов | 8 переезжают в пакете B; `EmojiStatusPicker` — О-14; сам хук умирает с китом (2D-31) |
| свои порталы (`ReactedUsersPopup`, `WebAppModal`, QR-вход, …) | см. § 9.2 референса | `ReactedUsersPopup` — задача 25; прочие — О-16, О-17 |

## Что у нас уже есть и переиспользуется

`core/navigation/appNavigationController.ts` (порт; `pushItem`/`backByItem`/`removeItem`),
`helpers/overlayCounter.ts` (1:1), `helpers/dom/fullScreen.ts` (`addFullScreenListener`,
`getFullScreenElement`), `helpers/middleware.ts` (`getMiddleware`), `helpers/array/indexOfAndSplice`,
`helpers/dom/findUpClassName`, `helpers/dom/cancelEvent`, `helpers/dom/clickEvent.ts`
(`simulateClickEvent`), `helpers/schedulers.ts` (`doubleRaf`), `components/animationIntersector.ts`
(`checkAnimations2(blurred, exceptGroup)` `:373`), `components/scrollable2.solid.tsx`,
`components/buttonTsx.solid.tsx`, `components/iconTsx.solid.tsx`, `components/putPreloader.ts`,
`components/rowTsx.solid.tsx` (`Row.Icon noBackground` `:452`), `components/section.solid.tsx`,
`components/radioFieldTsx.solid.tsx`, `components/checkboxFieldTsx.solid.tsx`,
`components/inputFieldTsx.solid.tsx`, `components/inputField.ts`, `components/mediaHeader.solid.tsx`
(`Sticker onReady` `:91`), `components/appSelectPeers.solid.tsx` (2D-16), `components/foldersTabs.solid.tsx`,
`components/tabs.solid.tsx`, `components/transition.ts` (`TransitionSlider`), `components/lottieAnimation.solid.tsx`,
`components/wrappers/sticker.ts`, `core/lazyLoadQueue.ts`, `shared/solid/mountSolid.solid.tsx`
(образец `ErrorBoundary`), `stores/appSettings.solid.ts` (`useAppSettings`, 2D-4), стили
`styles/tweb/popups/{_popup,_popupVariables,_peer,_confirmation,_forward,_stickers,_datePicker,_premium}.scss`.

## Чего нет и что заводится

`components/popups/indexTsx.solid.tsx` (885), `helpers/dom/focusTrap.ts` (184),
`helpers/dom/scrollRegion.ts` (44), `helpers/dom/isKeyboardControl.ts` (19),
`components/popups/peer.solid.tsx` (214), `components/confirmationPopup.ts` (46),
`components/radioFormTsx.solid.tsx` (46), `components/popups/mute.ts` (77),
`components/popups/deleteMessages.ts` (197), `components/featureRows.solid.tsx` (30),
`components/popups/featureDetails.solid.tsx` (80), `components/popups/passkey.ts` (67),
`components/verticalOptionWheel.solid.tsx` (300), `sidebarLeft/tabs/autoDeleteMessages/{options.ts,customTimePopup/*}`,
`components/rtmp/outputDevicePopup.solid.tsx` (143), `components/popups/logOut.ts` (15),
`components/popups/birthday.solid.tsx` (307), `components/buttonMenuSelect.solid.tsx` (330),
`components/popups/stickers.solid.tsx` (409), `components/popups/pickUser.solid.tsx` (856),
`components/popups/myQrCode.solid.tsx` (1007), `components/popups/premium.solid.tsx` (342) +
`components/premium/*`, `components/popups/stars.solid.tsx` (998), `components/popups/sendGift*.{ts,solid.tsx}`,
`components/popups/sharedFolderInvite.solid.tsx` (256), партиалы `_mute`, `_reactedList`,
`_createContact`, `_chatlistInvite`, `_stars` и CSS-модули попапов.

## Global Constraints

- **Источник порта — файл tweb `812502980`, а не наш React** (спека § 6a). Наши React-попапы —
  только список сценариев; их вёрстка, классы и тайминги в порт не переносятся.
- **Одна оболочка.** Новый попап пишется только на `<PopupElement>` из `indexTsx.solid.tsx`.
  Ни `shared/ui/Popup`, ни `usePopupTransition`, ни свой портал в коде этой волны не появляются;
  каждая задача пакетов B/C удаляет свой React-попап в том же PR (DoD 14).
- **Definition of Done** — спека § 9, все 14 пунктов. Особо: п. 3–4 (мутация прогнана ФАКТИЧЕСКИ,
  вывод vitest — в теле коммита), п. 5 (после закрытия в DOM нет `.popup`, Solid-корень снят —
  пин на каждый попап), п. 10 (стенд, числа), п. 14.
- **DoD 2a.** Чего нет на бэкенде — в «Отложено» с номером и комментарий у строки (`// О-n 2C`).
  Подгонка под наш провод — только временно и с номером.
- **Имена файлов — имена tweb** + `.solid.tsx` для JSX (`indexTsx.solid.tsx`, `peer.solid.tsx`,
  `pickUser.solid.tsx`); чистый TS без JSX — `.ts`, как у оригинала (`logOut.ts`, `mute.ts`,
  `limit.ts`). Каталог — `components/popups/`, как у tweb; попап вкладки — рядом с вкладкой
  (`sidebarLeft/tabs/autoDeleteMessages/customTimePopup/`), как у tweb.
- **Solid-файлы** — прагма `/** @jsxImportSource solid-js */`, импортов `react` нет
  (`shared/solid/boundary.test.ts`).
- **Врезка — последовательно, порт — параллельно.** Порт пишется в НОВЫХ файлах. Врезка —
  правки общих файлов (`styles/tweb/_index.scss`, `src/lang.ts` + `i18n/dict.*.ts`,
  `core/hooks/useChatPopups.tsx`, `components/shell/GlobalOverlays.tsx`,
  `components/messages/ChatDialogs.tsx`, `components/SettingsView.tsx`, React-вызывающий,
  удаление старого попапа) — последний коммит задачи, по очереди, ребейз на свежий `main`.
- **Никакого `git add -A` и `git stash`.** Только явные пути: рядом работают другие агенты.
- **Комментарии и коммиты — по-русски**, объяснять ПОЧЕМУ. Шапка порта — `порт tweb/src/…:строки`;
  расхождения — нумерованным списком в шапке.
- **Пины — на результат**: классы и порядок узлов, `active`/`hiding` и снятие узла через 250 мс,
  запись навигации (Esc/Back закрывают), `overlayCounter`, фокус, сетевой вызов по кнопке —
  не «функцию позвали».
- **vitest — только из `web-client/`** (`cd web-client && npx vitest run …`); полный прогон,
  `npx tsc --noEmit`, `npx oxlint --type-aware` — перед каждым коммитом.
- **Строки langpack — ключами tweb** (правило плана `2026-08-30-i18n-langpack.md`): нет ключа в
  `web-client/src/lang.ts` — берётся из tweb `src/lang.ts` дословно, переводы — `src/i18n/dict.*.ts`.
- **Каждая задача обновляет «у нас»** в `docs/tweb/popups-solid.md` § 9 в том же PR.

## Порядок и зависимости

```
ПАКЕТ 0 — БАЗА (1–4 параллельно, файлы не пересекаются)
  1 scrollable2 → HEAD ─┐
  2 focusTrap, scrollRegion, isKeyboardControl, навигация Δ ─┤
  3 активное окно: appWindow → HEAD + писатель в core/pip.ts ─┤
  4 _popup.scss, _popupVariables.scss → HEAD ─┘
                 │
                 ▼
  5 ОБОЛОЧКА indexTsx.solid.tsx (1–4)
                 │
                 ▼
ПАКЕТ A — vanilla-слой на оболочку и снос класса
  6 showPeerPopup + confirmationPopup (5)
  7 showMutePopup (6)            8 showDeleteMessagesPopup (6)
  9 снос popupElement.ts / popupPeer.ts (6, 7, 8)
ПАКЕТ B — попапы, которых ждёт 2D (порт параллельно после 5/6, врезка по очереди)
  10 FeatureRows + featureDetails + passkey (5)        → 2D-21, 2D-23
  11 свой срок автоудаления + VerticalOptionWheel (5)   → 2D-20
  12 устройство вывода (5)                              → 2D-26
  13 выход (6)                                          → 2D-28
  14 день рождения + ButtonMenuSelect (5)               → 2D-27, 2D-30
  15 стикерсет (5)                                      → 2D-15
  16 выбор пользователя (5; 2D-16 ✅)                   → 2D-22, 2D-28 (через 20)
  17 мой QR (5; 2D-13)                                  → 2D-28, 2D-30
  18 премиум (5, 10)                                    → 2D-28, 2D-30   (развилка О-5)
  19 звёзды (5)                                         → 2D-28, 2D-30   (развилка О-6)
  20 подарок: выбор получателя + отправка (16, 19)      → 2D-28, 2D-30
  21 приглашение в папку (5; 2D-16 ✅)                  → 2D-25
  22 снос мёртвых попапов (—)                           — в любой момент
ПАКЕТ C — прочие React-попапы с парой в tweb (после 5/6, в любом порядке)
  23 календарь + отложенная отправка   24 пересылка (16)   25 кто отреагировал
  26 новый контакт   27 жалоба   28 опрос + чек-лист   29 режим инкогнито историй
  30 буст + розыгрыш
ФИНАЛ
  31 итог волны: инварианты, док, остаток (все)
```

**Что параллелится (непересекающиеся файлы):**

- База 1–4 — целиком (1: `scrollable2.solid.tsx`; 2: три новых хелпера + две строки
  `appNavigationController.ts`; 3: `helpers/appWindow.ts`, `core/pip.ts`; 4: два партиала + при
  необходимости `_button.scss`).
- Пакет A: 7 и 8 — параллельно после 6; 9 — последним.
- Пакет B: 10–16, 19, 21 — порт параллельно после 5 (13 — после 6); 17 — после 2D-13
  (`chatThemesPicker.solid.tsx`); 18 — после 10 (`FeatureRows` в «Историях» премиума); 20 — после
  16 и 19. Врезки — очередь по готовности; общие файлы: `_index.scss`, `lang.ts`/`dict.*`,
  `SettingsView.tsx` (17, 18, 19), `useChatPopups.tsx` (16, 20), `GlobalOverlays.tsx` (21).
- Пакет C — параллельно между собой; врезки в `useChatPopups.tsx`/`Chat.tsx`/`ChatDialogs.tsx` —
  по очереди.

## Что разблокирует 2D

| Задача 2D | Ждёт попап | Задача 2C | Примечание |
|---|---|---|---|
| 15 «Стикеры и эмодзи» | `showStickersPopup` | 15 | архив/порядок — О-8 (= 2D О-14) |
| 20 «Автоудаление» | `showAutoDeleteMessagesCustomTimePopup` | 11 | `options.ts` (общий список сроков) заводит 2C-11, вкладка 2D-20 его импортирует |
| 21 «Passkeys» | `showPasskeyPopup` | 10 | `confirmationPopup` удаления — уже есть; после 6 — HEAD-версия |
| 22 «Заблокированные» | `showPickUserPopup` | 16 | |
| 23 хаб «Конфиденциальность» | `showPasskeyPopup` (`privacyAndSecurity.tsx:298`) | 10 | |
| 24 «Папки»: лимиты | `showLimitPopup` | — | BLOCKED: О-4 (= 2D О-22) |
| 25 «Папки»: ссылка | `showSharedFolderInvitePopup` | 21 | снос `FolderInvitePopup.tsx`; обновления/выход — О-11 |
| 26 «Динамики и камера» | `showOutputDevicePopup` | 12 | |
| 27 «Профиль» | `showBirthdayPopup`; `showPickUserPopup` личного канала | 14; 16 | личный канал BLOCKED — О-9 (= 2D О-25) |
| 28 корень настроек | `showMyQrCodePopup`, `showLogOutPopup`, `showPremiumPopup`, `showStarsPopup`, `showSendGiftPicker` | 17, 13, 18, 19, 20 | по развилкам О-5/О-6 строки премиума/звёзд либо на адаптере, либо не рисуются |
| 30 потребители кита | `BirthdayModal` в `EditContactView`; `Premium*`, `QrModal`, `stars/*` | 14; 18, 17, 19, 20 | `EmojiStatusPicker` — не 2C (О-14) |

**Порядок, в котором 2C выгоднее отдавать 2D:** 5 → 6 → {10, 11, 12, 13, 14, 15, 16, 21}
(каждый снимает один экран 2D: 21/23, 20, 26, 28, 27, 15, 22, 25) → 17 → 19 → 20 → 18.

---

## Пакет 0 — база

### Задача 1: `scrollable2.solid.tsx` → HEAD

**Что делаем.** Доводим наш Solid-скролл до `tweb/src/components/scrollable2.tsx` HEAD (393) — три
правки, которые нужны оболочке:

1. `trackEnds?: boolean` (3eb7a9020, `:53-58`): `checkEnds` подписан при `withBorders || trackEnds`
   (`onScrollCallbacks`, `:228-231`; `tracksEnds` `:275`), рамок при этом нет;
2. `isScrolledToStart`/`isScrolledToEnd` — поля `ScrollableContextValue` (`:36-37`) и геттеры значения (`:320-325`);
3. `tabIndex?: number` (472e3e76b, `:48`, `:345`) на корневом `div`.

**Файлы:** изменить `web-client/src/components/scrollable2.solid.tsx` (`ScrollableContextValue` `:81-91`,
пропы `:95-110`, `onScrollCallbacks` `:274`, `value` `:325-345`); тест `components/scrollable2.solid.test.tsx` (дополнить).

- [ ] **Шаг 1: прочитать** `git -C /Users/denisurevic/Documents/tweb show 3eb7a9020 -- src/components/scrollable2.tsx`,
  `git … show 472e3e76b -- src/components/scrollable2.tsx`, наш файл.
- [ ] **Шаг 2: падающие тесты:** (а) `<Scrollable trackEnds contextRef={r}>` с контентом выше
  контейнера (стаб `scrollHeight`/`clientHeight`, образец — существующие тесты файла):
  `r.isScrolledToStart === true`, `scrollTop = 10` + `scroll` → `false`, класса `scrolled-start`
  на узле **нет** (рамки нет); (б) без `trackEnds` и `withBorders` — `isScrolledToStart` остаётся
  `true` после скролла (не следим); (в) `tabIndex={0}` → `div.scrollable[tabindex="0"]`.
- [ ] **Шаг 3:** падают. **Мутация:** убрать `props.trackEnds` из `onScrollCallbacks` — (а) краснеет.
- [ ] **Шаг 4:** реализовать дословно; адреса tweb — в шапку.
- [ ] **Шаг 5:** полный прогон; потребители `scrollable2` (`git grep -n "scrollable2" web-client/src`) зелёные без правок.

**Готово когда:** `diff` пропов и контекста с HEAD — только объявленные расхождения шапки файла.

---

### Задача 2: a11y-примитивы — `focusTrap`, `scrollRegion`, `isKeyboardControl`; навигация Δ 472e3e76b

**Что делаем.**

1. `helpers/dom/focusTrap.ts` — порт `tweb/src/helpers/dom/focusTrap.ts` (184) дословно:
   `getFocusableElements` (`:23-50`), стек ловушек на документ (`:54`), `createFocusTrap(element, isActive)`
   (`:61-184`) с `activate(restoreTo, initialFocus)`/`deactivate(restoreFocus)`, переезд между окнами
   через `onAppWindowChange` (задача 3 — импорт появится после неё; до влития 3 — зависимость
   по порядку врезки, не по порту).
2. `helpers/dom/scrollRegion.ts` — `updateScrollRegionFocusable` (`:27-44`) дословно.
3. `helpers/dom/isKeyboardControl.ts` — `isKeyboardControl` (`:4-9`) и `shouldPreserveKeyboardFocus`
   (`:11-19`) — второй только если найдётся потребитель в этой волне; иначе не портировать (DoD 6).
   Нужен наш `helpers/dom/isTargetAnInput` — проверить, есть ли; нет — порт вместе с функцией.
4. `core/navigation/appNavigationController.ts`: `onEscape?: (event: KeyboardEvent) => boolean` (`:101`)
   и в `onKeyDown` (`:297`) — `!e.defaultPrevented` и `item.onEscape(e)` (tweb `:17`, `:219`).

**Файлы:** создать `web-client/src/helpers/dom/{focusTrap,scrollRegion,isKeyboardControl}.ts` + тесты
рядом; изменить `core/navigation/appNavigationController.ts` (+ `appNavigationController.test.ts`).

- [ ] **Шаг 1: прочитать** три оригинала и `git … show 472e3e76b -- src/components/appNavigationController.ts`.
- [ ] **Шаг 2: падающие тесты:** `focusTrap` — контейнер с тремя кнопками: `activate()` фокусирует
  первую; Tab на последней → первая; Shift+Tab на первой → последняя; фокус снаружи (`focusin`) →
  возвращается внутрь; `deactivate()` → фокус на `restoreTo`; две ловушки стопкой — активна только
  верхняя, после `deactivate` верхней фокус уходит в нижнюю; скрытая (`hidden`) и `disabled`
  кнопки пропускаются; из группы радио — только отмеченная. `scrollRegion` — контейнер с кнопкой →
  без `tabindex`/`role`; с текстом → `tabindex=0`, `role=region`, `aria-label` = переданное имя.
  `isKeyboardControl` — `button`, `[role=link]`, `input[type=checkbox]` → `true`; `input[type=text]`,
  `div` → `false`. Навигация: Esc с `preventDefault()` до контроллера — запись НЕ снимается;
  `onEscape` получает событие.
- [ ] **Шаг 3:** падают. **Мутации:** убрать `wasTopmost &&` из восстановления фокуса — тест стопки
  краснеет; убрать `!e.defaultPrevented` — тест навигации краснеет.
- [ ] **Шаг 4:** реализовать дословно.

**Готово когда:** три файла совпадают с оригиналом с точностью до объявленных расхождений
(`diff` в теле коммита); существующие тесты навигации зелёные.

---

### Задача 3: активное окно — `helpers/appWindow.ts` → HEAD и писатель в `core/pip.ts`

**Что делаем.** Поправка 3: вынос клиента в PiP у нас есть, значит нужен и писатель активного окна.

1. `helpers/appWindow.ts` → tweb `helpers/appWindow.ts` (122) в объёме потребителей волны:
   `setAppWindow(win)` (`:37-55`), `onAppWindowChange(cb)` (`:57-60`, потребитель — `focusTrap`),
   `bindActiveWindowListener` (`:83-122`, потребитель — оболочка), `getOverlayRoot` (`:33-35`).
   `getAppWindow` (`:23-25`) и `onBeforeAppWindowChange` (`:66-69`) — только если найдётся
   потребитель (у tweb их читают метрики и снимок скролла чата; у нас — выяснить `git grep`);
   нет — не портировать, записать в шапку. Докблок `:1-14` переписать по факту.
2. `core/pip.ts`: `enterAppPip` зовёт `setAppWindow(pip)` сразу после переноса `#root` (`:78-80`),
   `restore` — `setAppWindow(window)` (`:98-103`). Писатель один — модуль PiP, как у tweb
   (`setAppWindow` зовёт только вынос клиента).
3. Факт «активное окно» не должен жить дважды: `usePipStore.win` читают React-порталы
   (`usePortalContainer`), `activeWindow` — vanilla/Solid. Оба пишет один и тот же код
   (`enterAppPip`/`restore`) в одном месте — объявить у строки, что это ОДИН писатель двух
   читательских форм до ухода React-порталов (О-17).

**Файлы:** изменить `web-client/src/helpers/appWindow.ts`, `helpers/appWindow.test.ts`, `core/pip.ts`;
тест `core/pip.test.ts` (создать, если нет).

- [ ] **Шаг 1: прочитать** tweb `helpers/appWindow.ts` целиком, наш `core/pip.ts`, потребителей
  `getOverlayRoot` (`git grep -n "getOverlayRoot" web-client/src`: `helpers/dom/sortable.ts:20`,
  свой метод в `mediaViewer/base.ts`).
- [ ] **Шаг 2: падающие тесты:** `setAppWindow(fakeWin)` → `getOverlayRoot() === fakeWin.document.body`;
  `onAppWindowChange` получает `(next, prev)`; `bindActiveWindowListener(w => w.document.body,
  'keydown', fn)` — после `setAppWindow` слушатель переехал (событие на старом body не доходит, на
  новом — доходит), диспоузер снимает; повторный `setAppWindow` тем же окном — слушатели не зовутся.
  PiP: `enterAppPip` со стабом `documentPictureInPicture.requestWindow` → `getOverlayRoot()` — body
  окна PiP; событие `pagehide` → снова `document.body`.
- [ ] **Шаг 3:** падают. **Мутация:** убрать `setAppWindow(window)` из `restore` — тест возврата краснеет.
- [ ] **Шаг 4:** реализовать.

**Готово когда:** `getOverlayRoot()` следует за PiP; докблок `appWindow.ts` не утверждает, что выноса нет.

---

### Задача 4: `_popup.scss` и `_popupVariables.scss` → HEAD

**Что делаем.** Дословно с HEAD (`popups-solid.md` § 4):

- `_popupVariables.scss:6-9` — `$popup-scroll-bleed: 5px`;
- `_popup.scss:19-23` (комментарий), `:211-216`, `:221-227`, `:234-237`, `:243-245`, `:249-264`,
  **`:266-273` — хвост из 2D** (`settings-rows.md` § 8.1: «хунк `_popup.scss:266-273` — за 2C»);
- иконки кнопки `:362-372` (3eb7a9020);
- снять наши `.popup:not(.old) .popup-close` (`:129-132` у нас) и `.popup.old .popup-header .btn-icon`
  (`:331-336`) и `color` в `.popup-header .btn-icon` (`:188`) — 69a759cbc убрал их, перенеся цвет
  иконок-кнопок в `_button.scss`. **Сначала** проверить, что хунк 69a759cbc в `_button.scss` у нас
  есть (`git -C /Users/denisurevic/Documents/tweb show 69a759cbc --stat`); нет — перенести его в той
  же задаче, иначе крестики старых попапов посереют.

**Файлы:** изменить `web-client/src/styles/tweb/popups/_popup.scss`, `_popupVariables.scss`,
при необходимости `styles/tweb/_button.scss`.

- [ ] **Шаг 1:** `diff /Users/denisurevic/Documents/tweb/src/scss/partials/popups/_popup.scss web-client/src/styles/tweb/popups/_popup.scss`
  (у `scss-parity.mjs` слепое пятно: блоки с `:has(…)` он не видит — сейчас печатает «0 нет у нас»).
- [ ] **Шаг 2:** перенести; единственное законное отличие — `@use "../../foundation"` вместо `"../../shared"`.
- [ ] **Шаг 3:** `diff` → только строка `@use`; `node tools/tweb-parity/scss-parity.mjs _popup.scss` → 0/0.
- [ ] **Шаг 4: стенд:** подтверждение «Завершить сеанс» (`activeSessions`), mute-попап чата,
  удаление сообщения — крестик и кнопки того же цвета, что до правки (computed `color` — в коммит).

**Готово когда:** `diff` с HEAD — одна строка `@use`.

---

### Задача 5: оболочка — `components/popups/indexTsx.solid.tsx`

**Что делаем.** Дословный порт `tweb/src/components/popups/indexTsx.tsx` (885): `PopupElement`
(`:133-465`) со всеми пропами (`popups-solid.md` § 2.1), контекстом (`:57-98`), жизненным циклом
(§ 2.3), разметкой и кликом вне (§ 2.4), a11y (§ 5); слоты `Header`, `Title`, `CloseButton`,
`Body`, `Scrollable`, `Footer`, `FooterPlaceholder`, `FooterButton`, `Button`, `Buttons`
(`:471-816`); `getPopups(kind)`, `addCancelButton`, `createPopup`, `PopupContext`,
`usePopupContext`, типы `PopupButton`/`PopupOptions`/`PopupContextValue`.
`useSnitchedPopupContext` (`:119-129`) — нет потребителя до задачи 28 → портирует задача 28.

Объявленные расхождения (в шапку, номер у строки):

1. `createPopup` оборачивает корень в `ErrorBoundary` — по той же причине, что `mountSolid`
   (`shared/solid/mountSolid.solid.tsx`, докблок «ErrorBoundary вшит в мост»; спека § 6): у tweb форк
   Solid логирует ошибку, наш сток бросает. Fallback — пусто, попап гаснет, навигация/счётчик
   снимаются в `onCleanup` корня.
2. `PopupElement.MANAGERS` — наш тип `Managers` (`client/bootstrap.ts:18`); присваивается там, где
   клиент получает менеджеры (шаг 1 — найти точку `startClient()`; у tweb — `appDialogsManager.ts:980`).
3. `confirmShortcutIsSendShortcut` — проп принимается, ветка `isSendShortcutPressed` не портируется:
   настройки `sendShortcut` у нас нет (`sidebarLeft/tabs/keyboardShortcuts.solid.tsx:20-23`) — О-1.
4. `MarkupTooltip.getInstance().hide()` (`:290`) — наш тултип React (`components/MarkupTooltip.tsx`),
   синглтона нет — О-2.
5. `zIndex` — **наше временное расширение** (проп → инлайн `z-index` у `.popup`), только ради
   подтверждения поверх `MediaEditor` (`z-index: 4200`); снимается с О-3.

**Файлы:** создать `web-client/src/components/popups/indexTsx.solid.tsx`,
`components/popups/indexTsx.solid.test.tsx`; врезка — присвоение `MANAGERS` (один файл загрузки).

- [ ] **Шаг 1: прочитать** `indexTsx.tsx` целиком, `git … show 2556fc949 -- src/components/popups/indexTsx.tsx`,
  `git … show 472e3e76b -- src/components/popups/indexTsx.tsx`, `popups-solid.md` § 2–5.
- [ ] **Шаг 2: падающие тесты** (реальный `appNavigationController`, фейковые таймеры для 250 мс,
  `doubleRaf` — через `vi.advanceTimersByTime`/стаб rAF; образец обвязки — `popupElement.test.ts`):
  1. `createPopup(() => <PopupElement class="x" closable><PopupElement.Header><PopupElement.CloseButton/><PopupElement.Title title="AppName"/></PopupElement.Header><PopupElement.Body>b</PopupElement.Body></PopupElement>)`
     → в `document.body` дерево `div.popup.x > div.popup-container.z-depth-1[role=dialog][aria-modal=true][tabindex=-1] > div.popup-header > (button.btn-icon.popup-close[aria-label] + div.popup-title) + div.popup-body`;
     после двух кадров — `active`;
  2. Esc → `hiding`, без `active`; через 250 мс узла нет, `overlayCounter.isOverlayActive === false`,
     записи навигации нет; `onClose` позван сразу, `onCloseAfterTimeout` — через 250 мс;
  3. клик по подложке закрывает; mousedown в контейнере + click по подложке — НЕ закрывает;
     `closable={false}` — клик по подложке не закрывает, Esc — закрывает;
  4. `isConfirmationNeededOnClose: () => promise` — Esc не закрывает, резолв — закрывает;
  5. два попапа: Enter жмёт `Button confirm` только верхнего; Enter на сфокусированной `button`
     отмены — отмена, не подтверждение; Enter в `input` — подтверждение;
  6. `Button callback={() => promise}` — пока висит, `disabled`; reject → снова активна, попап
     открыт; resolve → закрыт;
  7. фокус: открыли кнопкой X → фокус внутри контейнера; Tab по кругу; закрыли → фокус на X;
     `aria-labelledby` контейнера = id `.popup-title`;
  8. `withoutOverlay` → `no-overlay`, `overlayCounter` не тронут, `aria-modal` нет;
  9. `show={s()}` — пока `false`, класса `active` нет; `setS(true)` → `active`;
  10. стыки: `Header` + `Scrollable` + `Footer` в потоке → у скролла класс верхней рамки, у футера
      `popup-footer-shaded`; при скролле не у низа — у футера нет `scrolled-end`; `Footer floating`
      → `popup-footer-floating`, `hasFlowFooter` ложен;
  11. `getPopups(KIND)` видит открытый, после закрытия — нет;
  12. компонент содержимого бросает — остальные попапы и приложение живы, запись навигации и
      счётчик сняты (расхождение 1).
- [ ] **Шаг 3:** падают. **Мутации (фактически):** убрать `mouseDownTarget`-проверку — (3) краснеет;
  убрать проверку «верхний в `POPUPS`» в `handleKeydown` — (5) краснеет; убрать
  `controllerContext.dispose()` — (2) «узла нет» краснеет.
- [ ] **Шаг 4: реализовать** дословно.
- [ ] **Шаг 5:** полный прогон; `shared/solid/boundary.test.ts` зелёный.

**Готово когда:** все 12 пинов зелёные и три мутации красят свои; `diff` с оригиналом — только
расхождения 1–5.

---

## Пакет A — vanilla-слой на оболочку и снос класса

### Задача 6: `showPeerPopup` и `confirmationPopup` → HEAD; перевод вызывающих

**Порт:** `popups/peer.tsx` (214) → `components/popups/peer.solid.tsx` (`showPeerPopup`,
`PopupPeerOptions`, `PopupPeerButton`, `PopupPeerCheckboxOptions`, `PopupPeerHandle`); чекбоксы —
`RowTsx.popup-peer-checkbox-row` + `CheckboxFieldTsx` (`:144-156`); аватар — наш Solid-аватар
(найти, чем рисует `peerProfile.solid.tsx`; у tweb `AvatarNewTsx size={32}` `:190-202`).
`components/confirmationPopup.ts` (46) — дословно (`rejectWithReason`, `onPopup(handle)`, массив
чекбоксов). `_peer.scss` → HEAD (наш лишний блок `.checkbox-field` `:49-61` снимается: строки
чекбоксов теперь `RowTsx`).

**Перевод вызывающих** (список — `popups-solid.md` § 9.1):
- `confirmationPopup` из `popupPeer.ts` → `components/confirmationPopup.ts`: `Composer.tsx:267`,
  `auth/cards/PasswordCard.solid.tsx:98, :150, :159`, `emoji/StickersTab.tsx:309`,
  `sidebarLeft/globalSearch.ts:593`, `tabs/activeSessions.solid.tsx:101, :134`,
  `tabs/dataAndStorage/index.solid.tsx:100`, `tabs/dataAndStorage/storageQuota.solid.tsx:247`,
  `tabs/editFolderShared.ts:36`, `tabs/passcodeLock/mainTab.solid.tsx:212`;
- `createPopup(PopupPeer, …)` → `showPeerPopup(className, …)`: `2fa/email.solid.tsx:118`
  (tweb `2fa/email.tsx:90`), `2fa/index.solid.tsx:69` (tweb `2fa/index.tsx:28`),
  `lib/richtext/maskedAnchor.ts:48` (tweb `internalLinkProcessor.ts:102`, `appImManager.ts:1458`);
- мост `settings/ConfirmDialog.tsx`: `getPopup`/`forceHide` → `onPopup(handle)`/`handle.hide()`;
  `zIndex` → расширение оболочки (задача 5, п. 5). Снос моста — задача 30 плана 2D (строка 1),
  не здесь.

**Пины:** `confirmationPopup({titleLangKey, descriptionLangKey, button})` — дерево
`div.popup.popup-peer.popup-confirmation.old > .popup-container > .popup-header > .popup-title` +
`p.popup-description` + `.popup-buttons > button.popup-button.btn.primary`×2 (порядок
`row-reverse`); кнопка — резолв; «Отмена» — реджект; Esc/клик вне — реджект (`'closed'` при
`rejectWithReason`) после 250 мс; с `checkbox` — резолв `true/false`; три кнопки →
`is-vertical-layout`; `inputField` невалиден → кнопка `disabled`. Мост: размонтирование
`ConfirmDialog` до исхода → узла нет.
**Мутация:** убрать `onCloseAfterTimeout`-реджект — пин «Esc реджектит» краснеет.
**Зависимости:** 5. **Врезка:** 13 вызывающих файлов + `ConfirmDialog.tsx` + `_peer.scss` — одним
коммитом; `popupPeer.ts` ещё жив (его держат 7, 8).

### Задача 7: `showMutePopup`

**Порт:** `popups/mute.ts` (77) → `components/popups/mute.ts` над `showPeerPopup`;
`components/radioFormTsx.tsx` (46) → `radioFormTsx.solid.tsx`; `_mute.scss` (5) — партиал вместо
нашего `popupMute.module.scss`. `communities/communityAvatarElement` (`:6`) — сообществ нет, ветка
не портируется (объявить). Действие — наш `onMute` вызывающих → у tweb `appMessagesManager.mutePeer`;
у нас ручка `POST /chats/{peerID}/mute {muted, until}` (`groupsManager.ts:335-336`) — звать её из
попапа, как оригинал, если менеджер это позволяет; иначе — колбэк с номером О.
**Врезка:** `ChatListItem.tsx:84`, `core/hooks/useChatPopups.tsx:129-131` (ручка вместо `forceHide`),
тест `useChatPopups.mutePopupCleanup.test.tsx` — перевести на ручку; удалить `popupMute.ts`,
`.module.scss`, `popupMute.test.ts`.
**Пины:** радио сроков tweb (`MUTE_UNTIL`), клик «Mute» шлёт срок; снятие чата-владельца до закрытия → узла нет.
**Мутация:** не звать `hide` в уборке `useChatPopups` — пин снятия краснеет. **Зависимости:** 6.

### Задача 8: `showDeleteMessagesPopup`

**Порт:** `popups/deleteMessages.ts` (197) → `components/popups/deleteMessages.ts` над
`showPeerPopup` (чекбокс «удалить у всех», тексты по типу чата). Удаление — наш
`messagesManager.deleteMessage(peerId, msgId, revoke)` (`core/managers/messagesManager.ts:910`);
пакетной ручки нет (`DELETE /chats/{p}/messages/{seq}?revoke=`, `router.go:183`) — цикл по id в
менеджере объявить у строки (не в попапе).
**Врезка:** `messages/ChatDialogs.tsx:64-…` (`openDeleteMessageDialog`) → `showDeleteMessagesPopup`;
вызывающий `conversation/ChatMsgActionPopups.tsx:47-68`; тесты `ChatDialogs.test.tsx`,
`ChatMsgActionPopups.test.tsx` — перевести. Дамп: `06-delete-popup`, `17-popup-03-delete-message`.
**Мутация:** `revoke` не пробрасывается — пин «удалить у всех» краснеет. **Зависимости:** 6.

### Задача 9: снос vanilla-класса

**Предусловия:** `git grep -n "popups/popupElement\|popups/popupPeer\|popupMute" web-client/src` —
только сами файлы и их тесты. **Удалить:** `components/popups/popupElement.ts` +
`popupElement.test.ts`, `popupPeer.ts` + `popupPeer.test.ts`. Докблоки, ссылающиеся на них
(`slider.ts:26`, `sliderTab.ts`, `helpers/dom/clickEvent.ts`, `wrappers/mediaSpoiler.ts` — сверить
`git grep`), переписать. `docs/tweb/popups.md` Часть 8 — отсылка в `popups-solid.md` § 9.
**Зависимости:** 6, 7, 8. **Готово когда:** `git grep -n "createPopup(Popup" web-client/src` пуст.

---

## Пакет B — попапы, которых ждёт 2D

Общая форма задачи пакета (не повторяется ниже): **Шаг 1** — прочитать оригинал(ы) и наш React-попап
как список сценариев; **Шаг 2** — падающие тесты на разметку (дамп, если есть) и на действие
кнопки (сетевой вызов менеджера); **Шаг 3** — падают + названная мутация прогнана; **Шаг 4** —
порт дословно, расхождения в шапке; **Шаг 5** — врезка отдельным коммитом по очереди (React-вызывающие
зовут функцию; старый попап удалён); **Шаг 6** — стенд по чеклисту `popups-solid.md`, числа в коммит.
Пин владельца (после закрытия узла нет, `overlayCounter` = 0) — в каждой задаче.

### Задача 10: `FeatureRows`, `showFeatureDetailsPopup`, `showPasskeyPopup` → 2D-21, 2D-23

**Порт:** `components/featureRows.tsx` (30) + `.module.scss` (17) → `featureRows.solid.tsx` (на
`Row.Icon noBackground`); `popups/featureDetails.tsx` (80) + `.module.scss` (29) →
`popups/featureDetails.solid.tsx` (показ по `MediaHeader.Sticker onReady`, `Header floating`,
`Footer` с `FooterButton`, возвращает `close`); `popups/passkey.tsx` (67) → `popups/passkey.ts`
(`createPasskey` + `showPasskeyPopup(onCreation)`). WebAuthn — наши ручки есть
(`/me/passkeys/begin|finish`, `router.go:122-123`; `authManager.ts:486-496`); `getInputPasskeyCredential`
у tweb → наш формат запроса менеджера (объявить у строки). `IS_WEB_AUTHN_SUPPORTED` — наш флаг среды
(найти; нет — порт `environment/webAuthn`).
**Дамп:** `14-left-35-passkeys-popup`. **Мутация:** `Create` не ждёт `createPasskey` — пин «при ошибке
попап остаётся» краснеет. **Врезка:** `settings/PrivacySecuritySettings.tsx:264` → `showPasskeyPopup`;
удалить `settings/PasskeyIntroPopup.tsx` (+ `.module.scss`). **Зависимости:** 5.

### Задача 11: свой срок автоудаления → 2D-20

**Порт:** `components/verticalOptionWheel.tsx` (300) + `.module.scss` (61) → `verticalOptionWheel.solid.tsx`;
`sidebarLeft/tabs/autoDeleteMessages/options.ts` (порт файла целиком — его импортирует и вкладка
2D-20) ; `customTimePopup/{index.tsx,content.tsx,styles.module.scss}` (41 + 52 + 3) →
`sidebarLeft/tabs/autoDeleteMessages/customTimePopup/{index,content}.solid.tsx`: `PopupElement
class="auto-delete-messages-custom-time-popup" closable old`, `Buttons` Save/Cancel. `defineSolidElement`
+ `HotReloadGuard` у tweb — HMR-обвязка; у нас содержимое — обычный Solid-компонент (расхождение 1).
Бэкенд принимает любой срок 0…366 суток (`usecase/chat/autodelete.go:13,23,34`) — список сроков
tweb подходит без подгонки.
**Врезка:** `settings/AutoDeleteMessages.tsx:81-85` (встроенный `Popup`) → вызов
`showAutoDeleteMessagesCustomTimePopup`; сам экран удалит 2D-20. **Мутация:** `Save` отдаёт
начальный срок вместо выбранного — пин краснеет. **Зависимости:** 5.

### Задача 12: устройство вывода → 2D-26

**Порт:** `rtmp/outputDevicePopup.tsx` (143) + `.scss` (3) → `components/rtmp/outputDevicePopup.solid.tsx`:
показ после `enumerateDevices`, `devicechange`, «Default», `onStaleCurrentId`, `Scrollable` +
`Section noMarginBottom` + `Row.RadioField`/`RadioFieldTsx` + `FooterPlaceholder` + `Footer floating`.
Чисто клиентская функция (бэкенду нечего).
**Врезка:** `settings/SpeakersCamera.tsx:159`, `:177` — `DevicePicker` снять, звать функцию.
**Мутация:** `onPick` получает `currentId` вместо выбранного — пин краснеет. **Зависимости:** 5.

### Задача 13: выход → 2D-28

**Порт:** `popups/logOut.ts` (15) → `components/popups/logOut.ts` над `confirmationPopup`
(`LogOut`, `LogOut.Description`, `isDanger`). Действие — у tweb `apiManager.logOut()`; у нас выход
делает `useAuthGate.logout` → `authManager.logout()` (`core/managers/authManager.ts:573-575`,
`POST /auth/logout`): звать менеджер, если он отдаёт полный выход (переключение на другой аккаунт
— его логика), иначе колбэк вызывающего — объявить.
**Врезка:** `MainMenu.tsx:242` — подтверждение перед выходом (поправка 5; пункт бургера у tweb
отсутствует — вопрос пользователю, до ответа пункт остаётся). **Мутация:** выход без ожидания
промиса — пин «Отмена не разлогинивает» краснеет. **Зависимости:** 6.

### Задача 14: день рождения → 2D-27, 2D-30

**Порт:** `popups/birthday.tsx` (307) + `.module.scss` (59) → `popups/birthday.solid.tsx`;
`components/buttonMenuSelect.tsx` (330) → `buttonMenuSelect.solid.tsx` (выбор месяца, `:11`);
`PeerTitleTsx` (`:20`, 49 строк) — у нас `components/chat/peerTitle.ts`: найти Solid-обёртку или
портировать `peerTitleTsx.tsx`. Приватность — `getPrivacy('inputPrivacyKeyBirthday')` → наш ключ
`privacyKeyBirthday` (`privacyManager.ts:78`); ссылка «кто видит» → `AppPrivacyBirthdayTab` — вкладка
из 2D-17 (до неё ссылка не рисуется, номер О-13). Сохранение — `PATCH /me {birthday}`
(`profile_handler.go:116`, `profileManager.ts:46-47`). Ветки `suggestForPeer`/`fromSuggestion` — О-13.
**Врезка:** `EditContactView.tsx:173`, `settings/EditProfile.tsx:288` → `showBirthdayPopup`; удалить
`settings/BirthdayModal.tsx`. **Мутация:** год не обнуляет дни февраля — пин 29.02 краснеет.
**Зависимости:** 5.

### Задача 15: стикерсет → 2D-15

**Порт:** `popups/stickers.tsx` (409) → `popups/stickers.solid.tsx` (`STICKERS_POPUP_KIND`,
`ANIMATION_GROUP`, набор/несколько наборов, эмодзи-наборы, ⋮ «копировать ссылку»/«архив», кнопка
«Добавить/Удалить N стикеров» в `Footer floating={isLoaded()}`, контекст-меню стикера, просмотр по
долгому нажатию). Опоры у нас: `wrappers/sticker.ts`, `core/lazyLoadQueue.ts`,
`buttonMenuToggle.ts`, `helpers/clipboard.ts`, `stickers/useStickerViewer.ts` (React — шаг 1: найти
императивный вход; нет — просмотр по долгому нажатию объявить с номером), `emoticonsDropdown` —
React (отправка стикера в композер: через событие/`chatInput`-ручку, как делает наш
`StickerSetModal`). Бэкенд: `GET /sticker-sets/{slug}`, `/id/{setID}`, `install`/`uninstall`
(`router.go:284-287`); архив (a66af93f6) и порядок — О-8. `_stickers.scss` → HEAD.
**Врезка:** `Chat.tsx:1067`, `rightSidebar/StickersSearchTab.tsx:30` (импорт) и его JSX, `openStickerSetModal`
(`StickerSetModal.tsx:387`) → `showStickersPopup`; удалить `stickers/StickerSetModal.tsx` + тест.
**Мутация:** второй вызов не находит открытый по `kind` — пин «один попап набора» краснеет.
**Зависимости:** 5.

### Задача 16: выбор пользователя → 2D-22, 2D-28 (через 20)

**Порт:** `popups/pickUser.tsx` (856) → `popups/pickUser.solid.tsx` на `appSelectPeers.solid.tsx`
(2D-16): `showPickUserPopup(options)` (`:111`), `multiSelect`, `Footer`/`footerButtonProps`,
`initial`, `showTopPeers` + ряд папок (перенести сюда наш `pickUserFolderTabs.ts` — это его кусок
`:325-424`), `showContactPickerPopup` (`:838`). Форумы/топики (`useTopics`, `TransitionSlider`,
`wrapTopicRow` `:66-109`) — если форумы у нас есть в селекторе, портировать; нет — объявить.
`showLimitPopup('folders')` (`:31`) — О-4. `showSharingPickerPopup`/`showReplyPickerPopup` — нет
потребителя → не портировать.
**Врезка:** `ChatDialogs.tsx:304` `ContactPicker` (`useChatPopups.tsx:248`) → `showContactPickerPopup`;
удалить `ContactPicker`. `ForwardPicker` — задача 24.
**Мутация:** `onSelect` с одним выбором не закрывает попап — пин краснеет. **Зависимости:** 5.

### Задача 17: мой QR → 2D-28, 2D-30

**Порт:** `popups/myQrCode.tsx` (1007) + `.module.scss` (66) → `popups/myQrCode.solid.tsx`
(`showMyQrCodePopup(peerId, {url})`, показ после первого кадра канваса, темы через
`chatThemesPicker.solid.tsx` 2D-13, копирование/шаринг). QR — наш `qr-code-styling`
(`components/auth/QrCode.solid.tsx:88`), `helpers/qrCode/{paintQrCode,copyQrCode}` у tweb — порт
в объёме. Ссылка: у tweb `https://t.me/<username>` (`helpers/qrCode/paintQrCode.ts:105-110`), у нас
публичная страница `${origin}/@username` (`router.go:86-87`) — О-10; ветка `t.me/contact/<token>`
(`myQrCode.tsx:86-97`, `exportContactToken`) — ручки нет, О-10.
**Врезка:** `SettingsView.tsx:372`, `UserInfoPanel.tsx:743` → вызов; удалить `QrModal.tsx` + тест.
**Мутация:** показ до `onWallpaperReady` — пин «нет `active` до первого кадра» краснеет.
**Зависимости:** 5, 2D-13.

### Задача 18: премиум → 2D-28, 2D-30 (развилка О-5)

**Порт:** `popups/premium.tsx` (342) с 6c3803343 (`Footer`/`FooterButton`, `--popup-background-color`
полосы, защита от повторного клика) + `premium/{promoSlideTab,featureSlideTab,featuresConfig,
featuresCarousel,limitsFeature,premiumStickersCarousel,upgradedStoriesFeature}` (~1270) +
`_premium.scss` → HEAD. **BLOCKED частично:** `help.getPremiumPromo` (видео, порядок фич),
`PremiumSubscriptionOption` (цены), оплата-инвойс (`payment*.tsx`) — ручек нет (планы зашиты:
`backend/internal/domain/premium.go:27`, `core/premium/plans.ts:18-20`; оплата моковая
`POST /me/premium/checkout`, `router.go:108`). Развилка О-5 — решает пользователь:
(а) порт с временным адаптером опций из `plans.ts` и нашим мок-чекаутом; (б) задача ждёт бэкенд,
2D-28 рисует строку Premium без попапа.
**Врезка (вариант а):** `Sidebar.tsx:177`, `SettingsView.tsx:362` → `showPremiumPopup`; удалить
`PremiumModal.tsx` (+ тест, `.module.scss`); `PremiumCheckout.tsx`/`PremiumManage.tsx` — по ответу
на О-5. **Зависимости:** 5, 10.

### Задача 19: звёзды → 2D-28, 2D-30 (развилка О-6)

**Порт:** `popups/stars.tsx` (998) + `_stars.scss` (603) → `popups/stars.solid.tsx`
(`STARS_POPUP_KIND`, баланс, история транзакций, пополнение). Бэкенд: баланс, история,
пополнение на произвольную сумму (`/stars/balance|transactions|topup`, `router.go:241-243`;
`starsManager.ts:113-123`); **нет** вариантов пополнения (`getStarsTopupOptions`), подписок, TON
(`showStarsPopup({ton: true})`) — О-6. Развилка как у 18.
**Врезка:** `SettingsView.tsx:368`, `stars/SendGiftPopup.tsx:154` → вызов; удалить `stars/StarsPopup.tsx`.
**Зависимости:** 5.

### Задача 20: подарок — выбор получателя и отправка → 2D-28, 2D-30

**Порт:** `popups/sendGiftPicker.ts` (23) над `showPickUserPopup`; `popups/sendGift.tsx` (1227) +
`.module.scss` (490) → `popups/sendGift.solid.tsx` в объёме бэкенда: каталог и отправка
(`/gifts/catalog`, `/gifts/send`, `router.go:245-246`; `starsManager.ts:130-137`). Подарок премиума
другому (`giftPremium.tsx`) — О-7.
**Врезка:** `useChatPopups.tsx:105` → `showSendGiftPopup({peerId})`; удалить `stars/SendGiftPopup.tsx`.
**Зависимости:** 16, 19.

### Задача 21: приглашение в папку → 2D-25

**Порт:** `popups/sharedFolderInvite.tsx` (256) + `_chatlistInvite.scss` (114) →
`popups/sharedFolderInvite.solid.tsx` (`popup-forward`, `Tabs`, `AppSelectPeers`, `Footer`).
Бэкенд: превью и вступление (`GET /folder_invites/{slug}`, `POST …/join {peer_ids}`,
`router.go:155-156`; `foldersManager.ts:133-137`); режимы «обновления» и «выйти из папки»
(`getChatlistUpdates`, `leaveChatlist`) — О-11; лимиты — О-4.
**Врезка:** `GlobalOverlays.tsx:121` → вызов по ссылке; удалить `folders/FolderInvitePopup.tsx`.
**Мутация:** `join` без выбранных id — пин краснеет. **Зависимости:** 5, 2D-16 (✅).

### Задача 22: снос мёртвых попапов

`stars/GiftInfoPopup.tsx` (131) — открывателя нет (единственный импорт — `dateLabels.form.test.tsx:31`;
кейс теста — снять вместе); `ChatPicker` (`messages/ChatDialogs.tsx:355`) — 0 вызовов. Перед
удалением — `git grep` ещё раз. Упоминания в докблоках `shared/ui/DomNode.tsx:53`,
`DomNode.test.tsx:9` — поправить. **Зависимости:** нет.

---

## Пакет C — прочие React-попапы с парой в tweb

Та же общая форма. Не блокируют 2D; берутся по готовности после 5/6.

| № | Попап tweb | Заменяет у нас | Бэкенд | Врезка / удалить |
|---|---|---|---|---|
| 23 | `datePicker.tsx` (970, `DATE_PICKER_POPUP_KIND`) + `scheduleSendingPopup.tsx` (157); `_datePicker.scss` → HEAD | `DatePickerPopup.tsx` (513), `SchedulePopup.tsx` (40) | `/chats/{peerID}/scheduled*` (`router.go:223-227`) | `Chat.tsx:727`, `useChatHeaderSearch.ts:209`, `Composer.tsx:741`, `ScheduledView.tsx:99`, `SuggestedPostsView.tsx:99`; дамп `17-popup-06-date-picker` |
| 24 | `forward.tsx` (443) над `pickUser` | `ForwardPicker` (`ChatDialogs.tsx:169`), `pickUserFolderTabs.ts` (переезжает в 16) | есть | `ChatMsgActionPopups.tsx:93`, `StoryViewer.tsx:607`; права отправки — 2D О-31; дамп `06-forward-popup`, `17-popup-01-forward-share`. Зависит от 16 |
| 25 | `reactedList.tsx` (377) + `_reactedList.scss` (78) | `ReactedUsersPopup` (`ChatDialogs.tsx:438`, свой портал) | `GET …/reactions/users` (`router.go:269`) | `ChatMsgActionPopups.tsx:88` |
| 26 | `createContact.tsx` (121) + `_createContact.scss` (42) | `NewContactPopup.tsx` (100) | `POST /contacts` (`router.go:435`) | `ContactsView.tsx:113` |
| 27 | `reportAd.tsx` — `showMessageReport`/`showPeerReport` (`:360-393`) | `ReportPopup.tsx` (91) + `reportStore` | `POST /report` с фиксированными причинами (`domain/report.go:18-22`); дерево вариантов с сервера (`messages.report` → `ReportResult`) — О-12 | `GlobalOverlays.tsx:131`, `HeaderMenu.tsx:105`, `peerProfile.solid.tsx:1239`, `useMessageActions` |
| 28 | `createPoll/*` (~2180, `useSnitchedPopupContext` — портировать здесь) + `checklist.tsx` (338) | `CreatePollPopup.tsx` (142), `CreateChecklistPopup.tsx` (104) | `/chats/{peerID}/polls`, `/checklists` (`router.go:201`, `:231`); медиа в опросе (`mediaAttachment.tsx`) — сверить с проводом | `useChatPopups.tsx:218`, `:232` |
| 29 | `storiesStealthMode.tsx` (79) | `StealthModePopup.tsx` (111) | `/stories/stealth*` (`router.go:407-408`) | `StoryViewer.tsx:603` |
| 30 | `boost.tsx` (298) + `boostsViaGifts.tsx` (783) | `BoostPopup.tsx` (73), `CreateGiveawayPopup.tsx` (94) | бусты и розыгрыши (`router.go:235-239`); оплата розыгрыша премиумом — О-5 | `useChatPopups.tsx:190`, `:198` |

---

## Финал

### Задача 31: итог волны

- `git grep -n "popups/popupElement\|popups/popupPeer\|popupMute" web-client/src` пуст;
- `git grep -ln "usePopupTransition" web-client/src` — только `settings/kit.tsx` и `EmojiStatusPicker.tsx` (О-14);
- `git grep -ln "shared/ui/Popup" web-client/src` — только файлы из О-17 (список — в «у нас» референса);
- `docs/tweb/popups-solid.md` § 9 — «у нас» по факту; `popups.md` Части 1–3, 8 — пометка «заменено `popups-solid.md`»;
- `docs/tweb/settings-rows.md` § 8.1 — хвост `_popup.scss:266-273` снят (задача 4);
- таблица «Что разблокирует 2D» в плане 2D (задача 30) — сверить со сделанным.

---

## Отложено — с предметом (DoD 13)

| № | Что | Почему отложено | Что разблокирует |
|---|---|---|---|
| О-1 | `confirmShortcutIsSendShortcut` → `isSendShortcutPressed` (`indexTsx.tsx:254`, `helpers/dom/isSendShortcutPressed.ts`) | нет настройки `sendShortcut` (`keyboardShortcuts.solid.tsx:20-23`; 2D О-10) | Ctrl+Enter для подтверждения попапов с полем ввода |
| О-2 | `MarkupTooltip.getInstance().hide()` при закрытии (`indexTsx.tsx:290`) | наш тултип — React (`components/MarkupTooltip.tsx`) | порт тултипа разметки с композером |
| О-3 | расширение `zIndex` оболочки | `MediaEditor` на `z-index: 4200` («выше Popup и его меню»); у tweb у всех слоёв `4` | медиаредактор на порядке DOM (волна 4) |
| О-4 | `showLimitPopup` + `LimitLine` (`components/limit.ts`, 190) + `_limit.scss`; вызовы из `pickUser`, папок, пинов | нет `getAppConfig`/`getLimit`, лимиты зашиты (`domain/folder.go:12`, `usecase/chat/dialog_flags.go:15`); = 2D О-22 | апселл лимитов |
| О-5 | премиум: `help.getPremiumPromo`, `PremiumSubscriptionOption`, оплата (`payment*.tsx`), премиум-розыгрыш | ручек нет, планы зашиты (`domain/premium.go:27`, `core/premium/plans.ts:18-20`), оплата моковая | премиум 1:1; **развилка задачи 18 — решение пользователя** |
| О-6 | звёзды: варианты пополнения, подписки, TON | нет `getStarsTopupOptions`, подписок; topup — произвольная сумма | звёзды 1:1; развилка задачи 19 |
| О-7 | подарок премиума другому (`giftPremium.tsx`) | ручки нет | ветка премиума в отправке подарка |
| О-8 | архив и порядок стикерсетов (a66af93f6, `reorderStickerSets`) | ручек нет; = 2D О-14 | пункт ⋮ «В архив», сортировка |
| О-9 | личный канал из профиля (`editProfile.tsx:214` → `showPickUserPopup`) | нет `updatePersonalChannel`; = 2D О-25 | секция PersonalChannel |
| О-10 | QR: ссылка `t.me/<username>` и `t.me/contact/<token>` (`myQrCode.tsx:86-97`) | у нас публичная страница `${origin}/@username`, нет `exportContactToken` | QR без username |
| О-11 | приглашение в папку: обновления и выход (`getChatlistUpdates`, `leaveChatlist`) | ручек нет | `sharedFolderInvite` во всех режимах |
| О-12 | жалоба: дерево вариантов с сервера (`ReportResult`) | фиксированные причины (`domain/report.go:18-22`) | жалобы 1:1 |
| О-13 | день рождения: `suggestForPeer`/`fromSuggestion`, ссылка на `AppPrivacyBirthdayTab` до 2D-17 | нет подсказки дня рождения и дней рождения контактов; вкладка правила — 2D-17 | подсказки дней рождения |
| О-14 | `EmojiStatusPicker.tsx` (на `usePopupTransition`) | у tweb это `EmoticonsDropdown` (`sidebarLeft/emojiStatusPicker.tsx`), не попап; наш дропдаун эмодзи — React; статус на бэке — строка без списков (`PUT /me/emoji_status`) | снос кита (2D-31) — **решение пользователя**, куда относить |
| О-15 | `showNewMediaPopup` (`newMedia.tsx`, 2328) вместо `SendMediaPopup.tsx` | живёт внутри React-медиаредактора | программа медиаредактора (волна 4) |
| О-16 | `showWebAppPopup` / `components/webApp.tsx` вместо `WebAppModal.tsx` | мини-приложения — своя подсистема (мост `postEvent`, инвойсы) | программа мини-приложений |
| О-17 | остаток `shared/ui/Popup`/`popupStore`/`PopupHost`: `LocationPicker`, `TopicsPanel` (у tweb — вкладка `editTopic`), `FactCheckEditor`, `KeyVerificationPopup`, `ChatThemesPicker`-попап, `PinnedMessagesScreen`/`ScheduledView`/`SuggestedPostsView` (у tweb — типы чата), `PostStats`/`StoryStats` (вкладки), подтверждения `StoryViewer.tsx:586`, `PasscodeLockScreen.tsx:93`, QR-входа `GlobalOverlays.tsx:96-117` | у tweb это не попапы или их пара — другой механизм; переезжают со своими волнами (колонка чата, истории, экран блокировки) | снос `shared/ui/Popup`, `popupStore`, `PopupHost`, второй формы факта «активное окно» (задача 3) |

## Оценка объёма

| Задача | Строк оригинала | Размер |
|---|---|---|
| 1 scrollable2 | ~30 | S |
| 2 a11y-примитивы + навигация | 184 + 44 + 19 + 2 | M |
| 3 активное окно + PiP | ~70 | S |
| 4 SCSS | ~70 | S |
| 5 оболочка | 885 | **L** (риск) |
| 6 peer + confirmation + 15 вызывающих | 214 + 46 | M |
| 7 mute | 77 + 46 | S |
| 8 удаление сообщений | 197 | M |
| 9 снос класса | — | S |
| 10 featureRows + featureDetails + passkey | 30 + 80 + 67 | S |
| 11 свой срок | 300 + 93 + options | M |
| 12 устройство | 143 | S |
| 13 выход | 15 | S |
| 14 день рождения | 307 + 330 + 49 | M |
| 15 стикерсет | 409 | L |
| 16 выбор пользователя | ~600 из 856 | L |
| 17 QR | 1007 | L |
| 18 премиум | 342 + ~1270 | L (развилка) |
| 19 звёзды | 998 + 603 | L (развилка) |
| 20 подарок | 23 + ~800 из 1227 | L |
| 21 приглашение в папку | 256 + 114 | M |
| 22 мёртвые | — | S |
| 23–30 пакет C | ~6700 | по строке: 23 L, 24 M, 25 M, 26 S, 27 M, 28 L, 29 S, 30 L |
| 31 итог | — | S |

## DoD программы (перед мержем задачи 31)

Спека § 9, пункты 9–14, плюс предметно:

- [ ] `vite build` живой; `vitest run`, `tsc --noEmit`, `oxlint --type-aware` зелёные из `web-client/`.
- [ ] Vanilla-класса нет: `components/popups/popupElement.ts`, `popupPeer.ts`, `popupMute.ts` удалены.
- [ ] Каждый попап волны — `showXxxPopup` на `indexTsx.solid.tsx`; `git grep -ln "from 'react'" -- 'web-client/src/components/popups/*'` пуст.
- [ ] **React убыл:** число `.tsx` с `from 'react'` без тестов (на 2026-09-27 — 179) уменьшилось на
  число удалённых попапов пакетов B/C; новых React-файлов нет.
- [ ] Стенд: чеклист `docs/tweb/popups-solid.md` «Проверка после порта» — на подтверждении, mute,
  удалении, пасскее, стикерсете, выборе пользователя; числа — в коммитах задач 5 и 6.
- [ ] `dom-parity` по дампам: `06-delete-popup`, `06-forward-popup`, `17-popup-01-forward-share`,
  `17-popup-03-delete-message`, `17-popup-06-date-picker`, `14-left-24-premium-popup`,
  `14-left-33-auto-delete`, `14-left-35-passkeys-popup` — расхождения только объявленные.
- [ ] `diff` `_popup.scss`/`_popupVariables.scss` с HEAD — только `@use`.
- [ ] «У нас» в `popups-solid.md` § 9 обновлено в каждом PR.
