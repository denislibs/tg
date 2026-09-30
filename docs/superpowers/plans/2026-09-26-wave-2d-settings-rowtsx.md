# Волна 2D: строки и экраны настроек на Solid `RowTsx`, 1:1 с tweb `812502980` — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development`.
> Шаги помечены чекбоксами (`- [ ]`). Перед каждой задачей — скилл `tweb-parity`.

**Цель:** все экраны настроек левой колонки и сам корень настроек — Solid-вкладки слайдера
(`scaffoldSolidJSTab`), собранные из Solid `Row` (`components/rowTsx.solid.tsx`, порт tweb
`components/rowTsx.tsx` HEAD) и `Section` (`components/section.solid.tsx`, порт
`components/section.tsx` HEAD). React-экраны `components/settings/*`, `SettingsView.tsx`,
`SettingsSubScreen.tsx`, `components/folders/{ChatFoldersSettings,FolderEditor,FolderChatsPicker}.tsx`
и React-кит `settings/kit.tsx` **удаляются**; императивный `components/row.ts` и
`components/settingSection.ts` — тоже (у tweb их нет с ef41b29db и 2556fc949).

**Решение пользователя (2026-09-26, обязательное):** React в настройках не остаётся. Каждый
экран и корень — Solid-компонент за tweb-классом вкладки (так устроена каждая вкладка tweb
`812502980`). В React-колонку (`components/Sidebar.tsx`) настройки встраиваются только тонким
мостом до отдельной программы переезда самой колонки (волна 7 спеки).

**Место в программе:** блок **2D** волны 2 дельты (`docs/tweb/delta/README.md`, «Волна 2 —
платформа»: «Строки на `RowTsx`, ef41b29db, после 2A»); по спеке Solid-миграции
(`docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 8) — волна 2 «вкладки
настроек». 2A (PR #283) уже дал плашки иконок, `_row.scss`/`_checkbox.scss` ef41b29db и
`rowFieldClasses.ts`. Соседний блок **2C** (оболочка попапов на Solid, 2556fc949) — зависимость
тех экранов, которые без своего попапа не собрать (помечены «2C»).

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит **`812502980`** (все адреса ниже — по нему,
если не сказано «старая база» = `e52b5d931`, `/Users/denisurevic/Documents/tweb-e52b5d931`).
**Разбор с адресами — [`docs/tweb/settings-rows.md`](../../tweb/settings-rows.md)** (строки,
секции, контейнер вкладки, все экраны, дампы, «у нас»). Каркас слайдера и шов с React —
[`docs/tweb/left-sidebar.md`](../../tweb/left-sidebar.md) ч. 8 § 3 (адреса tweb там по старой базе).

---

## Поправки к постановке (проверены в исходниках)

1. **`rowTsxController` экранам настроек не нужен.** `attachRowController`
   (`rowTsxController.tsx:390`) — мост для императивного кода; его единственный потребитель в
   HEAD — `DialogElement` (`lib/appDialogsManager.ts:77`, `:321`). Все вкладки
   `sidebarLeft/tabs/*` пишут JSX `<Row>`. Контроллер портируется только ради сноса `row.ts`
   (задача 29), а не ради настроек.
2. **«Отступление» тумблера — не отступление.** Шапка `components/rowFieldClasses.ts:10-18` и
   `rowTsx.solid.tsx:285-287` пишут, что у tweb тумблер носит и `row-checkbox-field`. Это было в
   803f9599d; сам ef41b29db убрал его (`git show ef41b29db -- src/components/rowTsx.tsx`: `-
   [ROW_CHECKBOX_FIELD_CLASS, ROW_CHECKBOX_FIELD_TOGGLE_CLASS]` → `+ [ROW_CHECKBOX_FIELD_TOGGLE_CLASS]`,
   HEAD `rowTsx.tsx:482-492`). Наш код совпадает с HEAD; неверна запись. Снимается задачей 0.
3. **Подпись секции вне карточки — и в HEAD, и в старой базе.** `section.tsx:112` (HEAD),
   `settingSection.ts:72-79` старой базы (`container.append(el)`). Наш React `SidebarSection`
   кладёт её внутрь (`shared/ui/SidebarSection/SidebarSection.tsx:70-71`), ссылаясь на дамп
   `15-right-12` — а в дампе подпись ребёнок `-container` (строка 29 развёрнутого текста).
   Это и есть «подпись внутри карточки» с экрана «Уведомления и звуки».
4. **«Enable Notifications» у tweb — не строка, а `Button`** `btn-primary primary
   btn-transparent`, `icon="unmute"` (`notifications.tsx:464-471`, дамп `14-left-14`: `button.
   btn-primary.primary.btn-transparent.rp`), и только пока разрешения нет. «Цветом primary с
   колокольчиком» — это она.
5. **«All Accounts» — не ручка бэкенда, а модель мультиаккаунта.** `notifyAllAccounts` у tweb
   выбирает, КАКАЯ вкладка браузера покажет уведомление (`appNotificationsManager.ts:449-475`,
   `accountNumber` у вкладки): аккаунты работают одновременно в разных вкладках. У нас одна
   активная сессия на браузер, переключение = смена токена + перезагрузка
   (`core/auth/accounts.ts:1-5`). Строка и подпись при разрешении
   (`MultiAccount.ShowNotificationsFromCaption`, `:431`) — в «Отложено» (О-1).
6. **Шапка «на плашке с линией» — это отсутствие `scrolled-start`.** `kit.SettingsScreen` ставит
   `scrollable-y-bordered` статически (`settings/kit.tsx:146`, `:159`), и правило
   `.scrollable-y-bordered:not(.scrolled-start) .sidebar-header` (`styles/tweb/_sidebar.scss:89-95`,
   tweb `_sidebar.scss:95-100`) горит всегда. Вкладки слайдера этого не знают: `sliderTab.ts:208`
   вешает `attachBorderListeners`, как tweb `sliderTab.ts:84`.
7. **Анимации нет, потому что React-экраны живут вне слайдера**: подэкран корня монтируется
   условно и снимается мгновенно (`SettingsView.tsx:337`), въезд — свой кейфрейм. Слайдер
   портирован и уже ведёт две вкладки через `settingsSliderHost` — переход даёт сама вкладка.
8. **«Язык» и «Устройства» уже Solid, но по старой базе.** `language.solid.tsx` строит список
   императивными `new Row` + `RadioFormFromRows` (у HEAD — `For` + `RadioFieldTsx`);
   `activeSessions.solid.tsx` — `Row`/`SettingSection`-классы, клик = попап завершения (у HEAD —
   отдельный экран сессии, 944b578e9).
9. **У `settings/kit.tsx` 22 потребителя ВНЕ настроек** (группа: `group/**` 11 файлов,
   `userInfo/RightsEditor.tsx`, `EditContactView.tsx`; звёзды: `stars/*` 4; премиум: `Premium{Modal,
   Checkout,Manage}.tsx`; `QrModal.tsx`, `EmojiStatusPicker.tsx`). Снос кита по решению
   пользователя требует снять и их — задача 30 (развилка, см. там). Так же вне настроек живут
   `settings/AvatarCropper.tsx` (3 потребителя), `BirthdayModal.tsx` (1), `ConfirmDialog.tsx` (6).
10. **`QuickReaction` у нас недостижим**: открыть его может только мок `SCREENS`
    (`SettingsSubScreen.tsx:17-26`), а «Общие» перехвачены раньше (`:114`). У tweb его открывают
    «Стикеры и эмодзи» (`stickersAndEmoji.tsx`, строка DoubleTap).

## Ключевой шов — вкладки над React-колонкой

Слайдер левой колонки у нас есть (`components/slider.ts`, `sliderTab.ts`, `solidJsTabs/*`), но
живёт в **своём** `.sidebar-slider` поверх React-экрана настроек (`sidebarLeft/settingsSliderHost.ts`,
заглушка вкладки №0). Отсюда правила программы:

| Этап | Кто корень | Где слайдер | Как открывается экран |
|---|---|---|---|
| сейчас … задача 27 | React `SettingsView` (слой колонки, `SidebarScreens.tsx:59`) | хост: свой `.sidebar-slider` + заглушка | React-строка корня/родителя → `getSettingsSliderHost().openTab(AppXxxTab)` |
| задача 28 | Solid `AppSettingsTab` | **колоночный** `.sidebar-slider` (`Sidebar.tsx:350`): вкладка №0 — `.item-main` React-колонки, настройки — вкладки слайдера, как `sidebarLeft/index.ts:148-150` | `Sidebar.tsx` → `slider.createTab(AppSettingsTab).open()` (тонкий мост), дальше — `tab.slider.createTab(…)` внутри Solid |

**Листья раньше родителей.** Solid-вкладка не может открыть React-экран (обратного моста нет и
не заводится, спека § 6). Поэтому экран переезжает, только когда все экраны, которые он
открывает, уже вкладки; до этого его открывает React-родитель через хост. Порядок задач ниже
выстроен так.

**Как живут React-экраны до переезда.** Как сейчас: `SettingsSubScreen`/`sub`, React-кит. Базовые
задачи 1 и 3 правят в ките только то, что общее со стилями tweb (подпись/заголовок секции и шапка
без плашки), потому что кит переживает всю волну (поправка 9). Выход/параллакс у React-экранов
не чинится — он приходит с переездом каждого экрана.

**Попапы.** Solid-вкладка вызывает только то, что уже не React: `confirmationPopup`/`PopupPeer`
(`components/popups/popupPeer.ts`), `toastNew`, `createContextMenu`. Экран, которому нужен попап,
существующий у нас только React-компонентом (премиум, звёзды, QR, выход, стикерсет, выбор
пользователя, день рождения, пасскей, свой срок автоудаления, выбор устройства, лимит), ждёт 2C —
иначе пришлось бы тянуть React в `.solid.tsx`.

**Настройки клиента.** Факт `notifications.*`/`liteMode`/… один — zustand `useSettingsStore`
(`settings.tsx:178`, 38 потребителей, включая ленту и `App.tsx`). Он не переезжает с экранами
(читают все, спека § 5: «уезжают последними»). Solid-вкладки читают и пишут его через
`stores/appSettings.solid.ts` с API tweb `useAppSettings()` (задача 4) — второй копии факта нет.

## Что у нас уже есть и переиспользуется

`components/{slider,sliderTab}.ts` (история, `createTab`/`sliceTabsUntilTab`, `attachBorderListeners`),
`components/solidJsTabs/{scaffoldSolidJSTab,superTabProvider,promiseCollector}.solid.tsx`,
`solidJsTabs/tabs.ts` (2 вкладки), `sidebarLeft/settingsSliderHost.ts`, `components/transition.ts`
(`slideNavigation`), `rowTsx.solid.tsx`/`section.solid.tsx` (старая база, доводятся задачами 0–1),
`checkboxFieldTsx.solid.tsx`, `buttonTsx.solid.tsx`, `iconTsx.solid.tsx`, `rippleElement.solid.tsx`,
`checkboxField.ts`, `radioField.ts`, `rangeSelector.ts`, `helpers/rowIconBackground.ts`,
`helpers/sessionPlatformIcon.ts`, `helpers/dom/createContextMenu.ts`, `helpers/dom/clickEvent.ts`
(`hasMouseMovedSinceDown`), `helpers/solid/{createComponentContext,subscribeExternal,subscribeOn}.ts`,
`components/popups/popupPeer.ts` (`confirmationPopup`), `components/toast`,
`components/lottieAnimation.solid.tsx`, `components/auth/MediaHeader.solid.tsx`,
`components/peerProfile.solid.tsx` (для корня), `components/dialogRow.ts` (`createChatList` — для
заблокированных), стили `styles/tweb/_row.scss`, `_checkbox.scss`, `_sidebar.scss`, `_slider.scss`,
`_leftSidebar.scss` (`.range-setting-selector` `:951`).

## Чего нет и что заводится

`helpers/dom/labelControl.ts` (8), `helpers/solid/buttonKeyDown.ts` (39), `radioFieldTsx.solid.tsx`
(49), `rangeSelectorTsx.solid.tsx` (176), `rangeSettingSelector.solid.tsx` (45),
`stores/appSettings.solid.ts`, `inlineSelect.solid.tsx` (191), `helpers/dom/sortable.ts` (302),
`settingsTabLottieAnimation.solid.tsx` (29), `space.solid.tsx` (13), `inputFieldTsx.solid.tsx` (95),
`checkboxFields.solid.tsx` (346), `colorPicker.ts` (370), `chatThemesPicker.solid.tsx` (356),
`reactionStickerPreview.solid.tsx` (20), `appSelectPeers.solid.tsx` (1453), `privacySection.solid.tsx`
(393), `rowTsxController.solid.tsx` (398), `searchWebPageRow.solid.tsx` (63) и ~40 модулей вкладок
`sidebarLeft/tabs/**.solid.tsx`.

## Global Constraints

- **Итог программы — ноль React в настройках** (решение пользователя). Удаляются
  `components/settings/*.tsx` (все 23 файла вместе со стилями и тестами), `SettingsView.tsx`,
  `SettingsSubScreen.tsx` (+ тесты), `components/folders/{ChatFoldersSettings,FolderEditor,
  FolderChatsPicker}.tsx`, `settings/kit.tsx`, `shared/ui/SidebarSection/*`. Встраивание в
  `Sidebar.tsx` — только тонкий мост (задача 28), без React-разметки настроек.
- **Источник порта — компонент tweb `812502980`, а не наш React** (спека § 6a). Наши экраны —
  только список сценариев; их расхождения (`settings-rows.md` § 8.2–8.3) в порт не переносятся:
  подпись внутри карточки, `value` вместо подписи, `Row accent` вместо `Button`, галочка вместо
  радио, свои CSS-модули, мгновенное сохранение там, где tweb пишет на закрытии.
- **Definition of Done** — спека § 9, все 14 пунктов. Особо: п. 3–4 (мутация прогнана ФАКТИЧЕСКИ,
  вывод vitest — в теле коммита), п. 5 (вкладка снимает свой Solid-остров на
  `onCloseAfterTimeout` — пин), п. 10 (стенд, числа), п. 14 (React убыл: удалён старый экран в том
  же PR, что и порт).
- **DoD 2a.** Чего нет на бэкенде — в «Отложено» с предметом и комментарий у строки с номером
  (О-n). Подгонять клиент под наш провод можно только временно и с задачей.
- **Каркас экрана = вкладка слайдера.** Каждый экран — `scaffoldSolidJSTab(Eventable)` в
  `solidJsTabs/tabs.ts` (форма — как у конструктора tweb, § 6 референса), модуль
  `sidebarLeft/tabs/<имя tweb>.solid.tsx`. Никаких собственных оболочек экрана: шапка, скроллер,
  `scrolled-start`, переход — от `SliderSuperTab`/`SidebarSlider`.
- **Врезка — последовательно, порт — параллельно.** Порт экрана пишется в НОВЫХ файлах и может
  идти параллельно. Врезка — правки общих файлов: `solidJsTabs/tabs.ts`, `SettingsView.tsx`,
  `SettingsSubScreen.tsx`, React-родитель экрана, удаление старого экрана — делается последним
  коммитом задачи и вливается по очереди (одна врезка за раз, ребейз на свежий `main`). У каждой
  задачи врезка перечислена отдельно.
- **Solid-файлы** — `*.solid.tsx` с `/** @jsxImportSource solid-js */` (маска
  `shared/solid/fileRuntime.ts`), импортов `react` нет (`shared/solid/boundary.test.ts`).
- **Никакого `git add -A` и `git stash`.** Только явные пути: рядом работают другие агенты.
- **Комментарии и коммиты — по-русски**, объяснять ПОЧЕМУ. Шапка каждого порта — `порт
  tweb/src/…` со строками; расхождения — нумерованным списком в шапке.
- **Пины — на результат**: классы и порядок узлов в DOM, `is-fake-disabled`, место подписи,
  `scrolled-start`, классы перехода, сетевой вызов на закрытии — не «функцию позвали».
- **vitest — только из `web-client/`** (`cd web-client && npx vitest run …`); полный прогон,
  `npx tsc --noEmit`, `npx oxlint --type-aware` — перед каждым коммитом.
- **Строки langpack — ключами tweb.** Нового ключа нет в `web-client/src/lang.ts` — берётся из
  tweb `src/lang.ts` дословно, переводы — в `src/i18n/dict.*.ts` (правило плана
  `2026-08-30-i18n-langpack.md`).
- **Каждая задача обновляет «у нас»** в `docs/tweb/settings-rows.md` § 8 (и адреса
  `left-sidebar.md` ч. 2, если трогала) в том же PR.

## Порядок и зависимости

```
БАЗА (параллельно, файлы не пересекаются)
  0 Row→HEAD ─┐
  1 Section→HEAD (+ SidebarSection) ─┤
  2 Поля: CheckboxFieldTsx Δ, RadioFieldTsx, RangeSettingSelector ─┤
  3 Каркас: вкладка, шапка, переход, мост (+ шапка кита) ─┤
  4 useAppSettings ─┤
  5 Контролы: InlineSelect, Sortable, LottieAnimation, Space, MediaHeader, InputFieldTsx ─┘
             │
             ▼
  6 ПИЛОТ «Уведомления и звуки» (0,1,2,3,4)
             │ (образец для остальных; дальше — пакеты)
             ▼
ПАКЕТ A — листья без 2C (порт параллельно, врезка по очереди)
  7 Данные и память + автозагрузка (0-4,5)      8 Язык→HEAD (0,1,2)
  9 Устройства→HEAD + экран сессии (0,1,3,5)    10 Горячие клавиши (0,1,5)
  11 Энергосбережение (0-4)                      12 Обои + цвет (0-4)
  14 Быстрая реакция (0,1,2)                     16 AppSelectPeers + AppAddMembersTab (0,1,2)
  18 Код-пароль (0-5)                            19 Двухэтапная проверка (0,1,5)
ПАКЕТ B — родители и экраны с 2C
  13 Общие (11,12)          15 Стикеры и эмодзи (5,14; 2C)      17 Правила приватности (16)
  20 Автоудаление (5; 2C)   21 Passkeys (5; 2C)                 22 Заблокированные (16; 2C)
  24 Папки: список + редактор (5)    25 Папки: выбор чатов + ссылка (16,24)
  26 Динамики и камера (2C) 27 Профиль (5; 2C)
  23 Хаб «Конфиденциальность» (17-22)
ФИНАЛ
  28 Корень AppSettingsTab + снос шва (7-27; 2C)
  29 DialogElement на attachRowController + renderSearchWebPageRow (0) — в любой момент после 0
  30 Потребители кита вне настроек (развилка)
  31 Снос row.ts, settingSection.ts, radioForm.ts, kit.tsx, SidebarSection (8,9,28,29,30)
```

**Что параллелится (НЕпересекающиеся файлы):**

- База 0–5 — целиком параллельно (0: `rowTsx.solid.tsx`, `rowFieldClasses.ts`, два новых хелпера;
  1: `section.solid.tsx`, `_section.scss`, `SidebarSection.tsx`; 2: `checkboxFieldTsx.solid.tsx` +
  новые; 3: `settingsSliderHost.*`, `kit.tsx`, новые тесты; 4: новый стор; 5: новые файлы +
  перенос `auth/MediaHeader.solid.tsx`).
- Пакет A — порт параллельно (у каждой задачи свой каталог `sidebarLeft/tabs/…` и свои новые
  примитивы). Врезки — очередь: 7 → 8 → 9 → 10 → 11 → 12 → 14 → 18 → 19 (порядок по готовности,
  общий файл один — `solidJsTabs/tabs.ts`, плюс `SettingsView.tsx`/`SettingsSubScreen.tsx`
  у 7, 10; `GeneralSettings.tsx` у 11, 12; `PrivacySecuritySettings.tsx` у 18, 19).
- Пакет B — 13, 15, 17, 24/25, 26, 27 параллельно между собой; 20, 21, 22 — параллельно после 2C.
- 29 — параллельно со всем, кроме 0 (но задевает программы поиска и shared media — см. задачу).

---

### Задача 0: `Row` на HEAD — `components/rowTsx.solid.tsx`

**Что делаем.** Доводим наш порт (старая база + 803f9599d/2197fee9c) до tweb `rowTsx.tsx` HEAD
(526 строк) — дословно, со всеми частями, которые перечислены в `settings-rows.md` § 1 и § 8.1:

1. `toggleAside` (`:106-113`): тумблер при подписи и без `RightContent` уезжает в `div.row-right`
   (`:254-256`), строка получает `row-grid` (`:235`); `Row.Title` не берёт его в правую часть (`:341`).
2. Вид `radioFieldRight` + `RADIO_FIELD_RIGHT_CLASS` (`:454-468`, `:338-362`,
   `row-title-right-with-control`).
3. `contextMenu`/`openContextMenuRef` (`:180-203`, `:215`, `:240`) поверх нашего `helpers/dom/createContextMenu.ts`
   (сверить сигнатуру с tweb `createContextMenu`; расхождения — в шапку).
4. `onClick` (`:205-216`): `disabled`/`aria-disabled` гасят клик, функция зовётся только без
   `hasMouseMovedSinceDown` (`helpers/dom/clickEvent.ts`).
5. a11y из 472e3e76b (`:122-164`, `:241-242`, `:260`): `role`, `tabIndex`, `aria-*`, `on:keydown`,
   `labelControl`, `buttonKeyDown`, первичная цель при вложенном контроле, `MutationObserver`.
   Заводятся `helpers/dom/labelControl.ts` (порт 8 строк) и `helpers/solid/buttonKeyDown.ts`
   (порт 39 строк, вместе с `linkKeyDown`).
6. Части: `ref`/`elementRef`/`leftRef`/`rightRef`, `rowClass`, `titleRightClass`, `titleRightRef`,
   `subtitleRightRef`, `midtitleRight`; `children` у `Row.Title` необязательны.
7. `Row.RightContent` и `Row.Media` принимают `element` (`registerExternalElement`, `:54-75`);
   пустой `RightContent` не рендерится (`:444-447`); `Row.Media.size` необязателен.
8. `style`, `createRowTitle` (экспорт, `:33-38`).

`rowFieldClasses.ts`: добавить `RADIO_FIELD_RIGHT_CLASS` (и только используемые константы);
**снять «ОТСТУПЛЕНИЕ»** из шапки и из `rowTsx.solid.tsx:285-287` — у HEAD так же (поправка 2);
та же правка — абзац «Отступление» в `docs/tweb/left-sidebar.md` ч. 8 § 3.

**Файлы:**
- Изменить: `web-client/src/components/rowTsx.solid.tsx`, `components/rowFieldClasses.ts`
- Создать: `web-client/src/helpers/dom/labelControl.ts`, `web-client/src/helpers/solid/buttonKeyDown.ts`
- Тесты: `components/rowTsx.solid.test.tsx` (дополнить), `helpers/solid/buttonKeyDown.test.ts`
- Доки: `docs/tweb/settings-rows.md` § 8.1, `docs/tweb/left-sidebar.md` ч. 8 § 3

- [ ] **Шаг 1: прочитать** `tweb/src/components/rowTsx.tsx` целиком, `rowFieldClasses.ts`,
  `helpers/dom/labelControl.ts`, `helpers/solid/buttonKeyDown.ts`, наш `rowTsx.solid.tsx`,
  потребителя `peerProfile.solid.tsx:210` (не сломать).
- [ ] **Шаг 2: падающие тесты** (по пункту на тест): (а) `<Row><Row.CheckboxFieldToggle>…
  <Row.Title/><Row.Subtitle/></Row>` → тумблер внутри `div.row-right`, у строки `row-grid`, в
  `.row-title-row` тумблера нет; (б) `RadioFieldTsx`-узел с `radio-field-right` оказывается в
  `.row-title-right`, а не слева; (в) `contextMenu` без `clickable` — клик открывает меню
  (`.btn-menu` в DOM); (г) `disabled` — `clickable` не зовётся; клик после смещения мыши — не
  зовётся; (д) кликабельная строка без поля — `role="button"`, `tabindex="0"`, Enter зовёт
  `clickable`; строка с тумблером — `input[aria-labelledby]` = id `.row-title`; (е) пустой
  `Row.RightContent` — нет `div.row-right` и нет `row-grid`; (ж) `Row.Media element={узел}` —
  узел получил `row-media row-media-small`.
- [ ] **Шаг 3: убедиться, что падают.** **Мутации:** убрать `value.toggleAside` из `row-grid` —
  (а) краснеет; убрать проверку `hasMouseMovedSinceDown` — (г) краснеет.
- [ ] **Шаг 4: реализовать** дословно; расхождения — в шапку нумерованным списком (например,
  `attachHotClassName` → `classList.add`, HMR не портирован).
- [ ] **Шаг 5:** полный прогон; `peerProfile.solid.test.tsx` зелёный без правок.

**Готово когда:** все пункты 1–8 в коде с адресами tweb в шапке; в репо нет слова
«ОТСТУПЛЕНИЕ» у тумблера (`git grep -n "ОТСТУПЛЕНИЕ" -- web-client/src/components/rowFieldClasses.ts` пуст);
`diff` сигнатур частей `Row.*` с tweb — только объявленные расхождения.

---

### Задача 1: `Section` на HEAD — `section.solid.tsx`, `_section.scss`, и React-двойник секции

**Что делаем.** (а) `section.solid.tsx` → tweb `section.tsx` HEAD (148): `captionTop` (`:90`),
`fakeGradientDelimiter` (`:100`, `generateDelimiter`), `noContent` (`:91`), экспорт `SectionName`
(`:60-71`), `appendSectionContent` + `SectionParts` (`:34-39`, `:123-146`), проброс пропов в
`SectionContent` (`:44-58`), `no-margin-bottom` — на **контейнере** (`:86`). (б)
`styles/tweb/_section.scss` → HEAD (`_section.scss:53-91`: подпись вне карточки `margin-top:
.625rem`, `:empty`, `captionTop`, `captionOld` внутри, `padding-bottom` контейнера вместо
`margin-bottom` карточки). (в) React `shared/ui/SidebarSection/SidebarSection.tsx` — на время
переезда (он же рисует ВСЕ React-экраны, в том числе групповые): подпись — соседом
`.sidebar-left-section` внутри контейнера (как `section.tsx:112`), заголовок — первым ребёнком
`.sidebar-left-section-content` с классом `sidebar-left-h2` (`:101-107`); `noMargin` — на
контейнер. Докблок про «дамп 15-right-12» переписать по факту (поправка 3).

Почему (в) здесь: стили секции общие для Solid и React, и смена модели отступов (б) без (в)
разъехалась бы на всех React-экранах сразу.

**Файлы:**
- Изменить: `web-client/src/components/section.solid.tsx`, `styles/tweb/_section.scss`,
  `shared/ui/SidebarSection/SidebarSection.tsx` (+ `.module.scss`, если правило `s.name` мешает `sidebar-left-h2`)
- Тесты: `components/section.solid.test.tsx`, `shared/ui/SidebarSection/SidebarSection.test.tsx` (создать)

- [ ] **Шаг 1: прочитать** `tweb/src/components/section.tsx`, `scss/partials/_section.scss`,
  `components/generateDelimiter.ts`, наши три файла; `node tools/tweb-parity/scss-parity.mjs _section.scss`.
- [ ] **Шаг 2: падающие тесты:** `<Section name caption>` → последний ребёнок контейнера —
  `.sidebar-left-section-caption`, не внутри `.sidebar-left-section`; `captionOld` — внутри;
  `captionTop` — первым ребёнком контейнера; `noMarginBottom` — класс на контейнере;
  `appendSectionContent` добавляет второй `-content` и бросает на `noContent`. Для
  `SidebarSection`: подпись — ребёнок `.sidebar-left-section-container`, заголовок —
  `.sidebar-left-section-content > .sidebar-left-h2.sidebar-left-section-name`.
- [ ] **Шаг 3:** падают. **Мутация:** вернуть подпись внутрь `innerContainer` — оба теста краснеют.
- [ ] **Шаг 4: реализовать**; scss — дословно с HEAD (адреса в комментарии партиала).
- [ ] **Шаг 5: стенд** — пять экранов (корень, «Уведомления», «Конфиденциальность», профиль
  канала справа, редактирование группы): подписи под карточкой, расстояние до следующей секции
  не изменилось больше чем на 1px против HEAD-вёрстки tweb (DevTools, числа — в коммит).

**Готово когда:** `scss-parity _section.scss` — только объявленные отличия;
`dom-parity 14-left-14-settings-notifications` — подписи на месте (тег/родитель); на стенде нет
ни одной подписи внутри карточки, кроме `captionOld`.

---

### Задача 2: поля строки — `CheckboxFieldTsx` Δ, `RadioFieldTsx`, `RangeSettingSelector`

**Что делаем.** (а) `checkboxFieldTsx.solid.tsx` → HEAD (61): `lockIcon`
(`setToggleLockIcon`, если есть у нашего `CheckboxField`, иначе — объявить), `ref`, эффект
`disabled` → `toggleDisability`. (б) Новый `radioFieldTsx.solid.tsx` — порт `radioFieldTsx.tsx`
(49) поверх нашего `radioField.ts` (`alignRight` → `radio-field-right`). (в) Новые
`rangeSelectorTsx.solid.tsx` (порт 176, `progress-line`) и `rangeSettingSelector.solid.tsx` (порт
45: `div.range-setting-selector > -details(-name, -value) + RangeSelector`, `labelControl`).

**Файлы:** изменить `components/checkboxFieldTsx.solid.tsx`; создать `components/radioFieldTsx.solid.tsx`,
`components/rangeSelectorTsx.solid.tsx`, `components/rangeSettingSelector.solid.tsx`; тесты рядом.

- [ ] **Шаг 1:** прочитать tweb-оригиналы и наши `checkboxField.ts`, `radioField.ts`, `rangeSelector.ts`.
- [ ] **Шаг 2: падающие тесты:** `disabled` → `input.disabled`; `RadioFieldTsx alignRight` →
  `label.radio-field.radio-field-right`; `RangeSettingSelector` рисует дерево дампа
  `14-left-14` (`div.range-setting-selector > div.range-setting-selector-details > …name + …value`
  + `div.progress-line > …__filled + input.progress-line__seek[type=range]`), `onChange` зовётся
  на скраб, `onMouseUp` — на отпускание; `input` связан с `-name` (`aria-labelledby`).
- [ ] **Шаг 3:** падают. **Мутация:** убрать `labelControl` — тест связи краснеет.
- [ ] **Шаг 4:** реализовать дословно.

**Готово когда:** дерево ползунка совпадает с дампом `14-left-14` (`dom-parity` по этому узлу).

---

### Задача 3: контейнер экрана = вкладка слайдера — шапка, переход, мост в React-колонку

**Что делаем.** Закрепляем (и чиним, если найдём расхождение) каркас, в который встают все экраны
волны: `SliderSuperTab` + `scaffoldSolidJSTab` + хост. Оба пункта пользователя — здесь:

1. **Шапка без плашки и линии у верхнего края.** Вкладка при открытии несёт `scrolled-start
   scrolled-end scrollable-y-bordered` (`sliderTab.ts:208` → `scrollable.ts:513-522`, tweb
   `sliderTab.ts:84`, `scrollable.ts:456-465`); `.sidebar-header` — `background-color:
   transparent`, `:after` с `opacity: 0` (`_sidebar.scss` tweb `:4-5`, `:75-92`). После прокрутки
   на ≥1px `scrolled-start` снимается → фон `--surface-color`, линия `opacity: 1` (tweb `:95-100`).
2. **Въезд/выезд через слайдер.** `openTab` → `SidebarSlider.selectTab` → `TransitionSlider`
   `navigation` (tweb `slider.ts:41-45`, `transition.ts:23-42`): контейнер получает `.animating`,
   приходящая вкладка — из `translate3d(W,0,0)` в 0 за `--transition-standard-in` (.3s), уходящая
   — в `-0.25W` с `brightness(80%)`; назад — `.animating.backwards`, зеркально; классы и инлайн-стили
   снимаются через 250 мс (`slider.ts:11`).
3. **Мост до переезда корня.** Хост (`settingsSliderHost.ts`) остаётся как есть: свой
   `.sidebar-slider` над React-корнем, заглушка №0. Зафиксировать в его шапке правило «листья
   раньше родителей» и порядок сноса (задача 28). Уходящей вкладкой при первом открытии служит
   прозрачная заглушка — затемнения корня в этот момент нет; это следствие шва, объявить у строки
   с номером задачи 28.
4. **Временная правка React-кита** (кит переживает волну, поправка 9): `kit.SettingsScreen`
   перестаёт ставить `scrollable-y-bordered` без слушателя — вешает на свой `div.scrollable`
   тот же `attachBorderListeners`-контракт (`scrolled-start`/`scrolled-end` по `scrollTop`),
   как `sliderTab.ts:208`. Своих правил шапки не заводить.

**Файлы:**
- Изменить: `web-client/src/components/sidebarLeft/settingsSliderHost.ts` (шапка-докблок),
  `components/settings/kit.tsx` (п. 4)
- Тесты: `components/sidebarLeft/settingsTabFrame.solid.test.tsx` (создать) — на реальной вкладке
  `AppLanguageTab` через хост; `components/settings/kit.test.tsx` (дополнить п. 4)

- [ ] **Шаг 1: прочитать** tweb `sliderTab.ts:60-120`, `slider.ts:30-140`, `transition.ts:1-60`,
  `_sidebar.scss:1-100`, `_slider.scss:170-247`, `scrollable.ts:440-470`; наши `sliderTab.ts`,
  `slider.ts`, `transition.ts`, `settingsSliderHost.ts`.
- [ ] **Шаг 2: падающие тесты** (реальный `transitionend`, стаб только геометрии — образец
  `components/appSearchSuper.scroll.test.ts:14-26`): открыть вкладку → у `.tabs-tab` есть
  `scrolled-start`; `scrollTop = 10` + событие `scroll` → `scrolled-start` снят; у контейнера во
  время перехода `.animating`, у приходящей вкладки инлайн `transform` стартует с
  `translate3d(<W>px, 0px, 0px)`, у уходящей — `translate3d(-<W/4>px…)` и `brightness(80%)`;
  «назад» → `.backwards`; через 250 мс классы сняты, у ушедшей нет `active`. Кит: у экрана кита
  при `scrollTop = 0` есть `scrolled-start`.
- [ ] **Шаг 3:** тесты вкладки — зелёные сразу (каркас уже порт) — значит, это пины; тест кита —
  падает. **Мутации (фактически):** убрать `attachBorderListeners` из `sliderTab.ts` — пин (1)
  краснеет; подменить `-width * .25` на `-width * .5` в `transition.ts` — пин (2) краснеет.
- [ ] **Шаг 4:** правка кита (п. 4); докблок хоста (п. 3).
- [ ] **Шаг 5: стенд** (`?noSharedWorker=1` во встроенном браузере; стенд — по памяти
  `messenger-verify-stack`): «Язык» — шапка у верха прозрачна, линии нет; скролл → плашка и линия;
  въезд/выезд с числами (длительность по Performance, сдвиг уходящей — из computed style).
  React-экран «Уведомления» (до пилота): шапка без плашки у верха.

**Готово когда:** пины (1)–(2) зелёные и краснеют на мутациях; на стенде у вкладки и у экрана
кита шапка без плашки у верха; числа перехода в теле коммита.

---

### Задача 4: `stores/appSettings.solid.ts` — `useAppSettings()` поверх нашего стора настроек

**Что делаем.** Порт API tweb `stores/appSettings.ts` (`useAppSettings()` → `[appSettings,
setAppSettings]`, `setAppSettingsSilent`) **без второго хранилища**: Solid-сторона читает
zustand `useSettingsStore` через `subscribeExternal` (прецедент — `stores/peers.solid.ts`) и
пишет через его `update`. Путь tweb (`setAppSettings('notifications', 'desktop', v)`) переводится
в наш плоский ключ (`notifyDesktop`) ОДНОЙ таблицей соответствий в этом файле — объявленное
расхождение до переезда самого стора (спека § 5, волна 8), с номером О-2.

Таблица заводится только на ключи, которые читают портированные вкладки (пилот: `notifications.
{desktop,push,sound,volume,sentMessageSound}`); каждая следующая задача дописывает свои строки.

**Файлы:** создать `web-client/src/stores/appSettings.solid.ts`, `stores/appSettings.solid.test.ts`.

- [ ] **Шаг 1:** прочитать tweb `stores/appSettings.ts`, `config/state.ts:115-130`, `:516-547`;
  наш `settings.tsx` (`useSettingsStore`, запись в `localStorage` в экшене, кросс-таб синхронизация).
- [ ] **Шаг 2: падающие тесты:** `setAppSettings('notifications','desktop',false)` → в zustand
  `notifyDesktop === false` и в `localStorage`; `useSettingsStore.getState().update({notifyVolume:
  .3})` → Solid-эффект видит `appSettings.notifications.volume === .3`; неизвестный путь — `throw`
  (а не молчаливый no-op).
- [ ] **Шаг 3:** падают. **Мутация:** писать в Solid-стор вместо zustand — первый тест краснеет
  (второй копии факта быть не должно).
- [ ] **Шаг 4:** реализовать. Инварианты сторов (`stores/noDuplicate*.test.ts`) зелёные без правок.

**Готово когда:** один источник правды (zustand), Solid видит изменения из React и наоборот;
тест-скан «нет второго стора настроек» — в `appSettings.solid.test.ts`.

---

### Задача 5: общие контролы экранов

**Что делаем.** Порты, у которых по нескольку потребителей в пакетах A/B (дословно, по файлу):
`inlineSelect.solid.tsx` (+ `.module.scss`) ← `sidebarLeft/tabs/passcodeLock/inlineSelect.tsx`
(191; потребители: код-пароль, хоткеи, TTL сессий); `helpers/dom/sortable.ts` ← тот же (302;
папки, стикеры); `settingsTabLottieAnimation.solid.tsx` (+ scss) ← (29; код-пароль, автоудаление,
2FA) поверх нашего `lottieAnimation.solid.tsx`; `space.solid.tsx` ← `space.tsx` (13);
`inputFieldTsx.solid.tsx` ← `inputFieldTsx.tsx` (95; профиль, 2FA, редактор папки);
`mediaHeader.solid.tsx` — **перенос** `components/auth/MediaHeader.solid.tsx` в
`components/mediaHeader.solid.tsx` (у tweb общий `components/mediaHeader.tsx`, 211) с правкой
импортов в `auth/*`, досыл недостающего (`MediaHeader` в tweb шире: сверить строки 100-211).

**Файлы:** создать перечисленное (+ тесты); изменить импорты `components/auth/**` (перенос).

- [ ] **Шаг 1:** прочитать оригиналы; для `sortable.ts` — стили `_row.scss` `.row-sortable*`
  (tweb `:325-370`) и наш `_row.scss` (нет `sortable-item-transition` — дописать из HEAD).
- [ ] **Шаг 2: падающие тесты** по контролу: `InlineSelect` — выбор пункта меняет значение и
  закрывает меню; `Sortable` — перетаскивание второй строки на первое место зовёт `onSort(1, 0)`,
  у строки `is-dragging` во время жеста; `SettingsTabLottieAnimation` — контейнер `--size`;
  `InputFieldTsx` — `maxLength` режет ввод; `MediaHeader` — тесты `auth` зелёные после переноса.
- [ ] **Шаг 3:** падают. **Мутация** для `Sortable`: убрать `whichChild` в расчёте индекса —
  тест порядка краснеет.
- [ ] **Шаг 4:** реализовать.

**Готово когда:** `git grep -n "auth/MediaHeader.solid" web-client/src` пуст; каждый контрол
покрыт тестом с прогнанной мутацией.

---

### Задача 6 (ПИЛОТ): «Уведомления и звуки» — `sidebarLeft/tabs/notifications.solid.tsx` — ✅ сделано (PR feat/w2d-notifications)

**Что делаем.** Дословный порт `tweb/src/components/sidebarLeft/tabs/notifications.tsx` (571) в
объёме, который есть у нас; вкладка `AppNotificationsTab` (`tabs.ts:77-81`: `title:
'Telegram.NotificationSettingsViewController'`, обычная форма). Полный список отличий, которые
снимает пилот (с экрана пользователя и сверки, `settings-rows.md` § 8.2):

| # | Сейчас (`settings/NotificationsSettings.tsx`) | Должно быть (tweb) |
|---|---|---|
| 1 | подпись «Give Telegram permission…» внутри карточки (`kit.Section footer`) | вне карточки: `Section caption` (`notifications.tsx:430-431`, `section.tsx:112`) |
| 2 | строки без разрешения — обычные, `checked` = `granted && …` | `NotificationRow`: `fakeDisabled={!isGranted()}` → `.is-fake-disabled` (серые `.row-row`, серый тумблер), `clickable={!isGranted() && onClick}` (`:408-417`); `NotificationCheckbox` `checked={isGranted() && props.checked}` (`:419-426`) |
| 3 | «Enable Notifications» — `Row accent` с `TgIcon unmute` | `Button text="Notifications.Enable" class="btn-primary primary btn-transparent" icon="unmute"`, только при `!isGranted()` (`:463-472`) |
| 4 | нет строки «All Accounts» и подписи при разрешении | НЕ портируется — О-1 (поправка 5); у строки `:450-462` и подписи `:431` — комментарий с номером |
| 5 | громкость — свой `Text` + `shared/ui/Slider` + CSS-модуль | `RangeSettingSelector` (`:501-520`): `textRight = floor(v*100)+'%'`, `step .01`, `onChange` (`toFixed(2)`, 0 → звук выкл.), `onMouseUp` → тест звука |
| 6 | включение звука при нулевой громкости → 0.5 захардкожено | `SETTINGS_INIT.notifications.volume` (`:489-495`) — наш дефолт из `settings.tsx` |
| 7 | имена секций `AutodownloadPrivateChats`, `ChatList.Filter.Groups/Channels` | `NotificationsPrivateChats`, `NotificationsGroups`, `NotificationsChannels` (`:548-562`) |
| 8 | типы чатов сохраняются сразу, оптимистично | `NotifySection` пишет на закрытии вкладки (`onCleanup`, `:49-73`), только если изменилось |
| 9 | заголовок экрана `AccountSettings.Notifications` | вкладка `Telegram.NotificationSettingsViewController`; строка корня остаётся `AccountSettings.Notifications` (`settings.tsx:252`) |
| 10 | экран вне слайдера (нет выезда, шапка на плашке) | вкладка слайдера (задача 3) |
| 11 | побочка `setPushEnabled` — в обработчике строки | подписчик настройки, как `uiNotificationsManager.ts:321` (`createEffect(on(() => settings.push, onPushConditionsChange))`) |

Секции `Stories`, `Reactions`, `NotificationsOther` (`:112-376`) — BLOCKED бэкендом (О-3, О-4, О-5):
у `/me/notify_settings` только `muted`/`preview` по трём типам
(`backend/internal/adapter/delivery/http/notify_handler.go:27-47`).

**Разметка** — эталон `docs/tweb/dom/dumps/14-left-14-settings-notifications.json` (с поправкой на
классы HEAD: `row-checkbox-field-toggle`, § 7 референса).

**Файлы:**
- Создать: `web-client/src/components/sidebarLeft/tabs/notifications.solid.tsx`,
  `notifications.solid.test.tsx`
- Изменить: `stores/appSettings.solid.ts` (ключи уведомлений), `client/pushSetup.ts` (подписчик
  `notifyPush` → `setPushEnabled`, п. 11), `web-client/src/lang.ts` + `i18n/dict.*.ts` (ключи п. 7, 9)
- **Врезка:** `solidJsTabs/tabs.ts` (`AppNotificationsTab`), `SettingsView.tsx` (строка
  `AccountSettings.Notifications` → `getSettingsSliderHost().openTab(AppNotificationsTab)`, как у
  «Языка» `:295-300`), `SettingsSubScreen.tsx` (снять ветку и `hasSubScreen`), удалить
  `settings/NotificationsSettings.tsx`, `.module.scss`, `.restricted.test.tsx` (сценарий
  «без Notification API → тост» переезжает в новый тест)

- [x] **Шаг 1: прочитать** `notifications.tsx` целиком, `rangeSettingSelector.tsx`,
  `config/state.ts` (`notifications`), `lib/uiNotificationsManager.ts:315-330`, `:405-430`, `:1079`;
  наши `NotificationsSettings.tsx`, `stores/notifyStore.ts`, `core/managers/notifyManager.ts`,
  `client/pushSetup.ts`, `core/audio/sounds.ts:46`.
- [x] **Шаг 2: падающие тесты** (через хост, как `activeSessions.solid.test.tsx`):
  1. `Notification.permission = 'default'`: обе строки секции `Notifications.Web` (Show, Offline) имеют
     `is-fake-disabled`, тумблеры сняты; клик по строке зовёт `Notification.requestPermission`;
     в секции есть `button.btn-primary.primary.btn-transparent` с `.tgico` и текстом ключа
     `Notifications.Enable`; подпись `Notifications.Default` — ребёнок
     `.sidebar-left-section-container`, НЕ `.sidebar-left-section`.
  2. `granted`: классов `is-fake-disabled` нет, кнопки нет, тумблер отражает `notifyDesktop`;
     переключение пишет в zustand (через задачу 4).
  3. Без Notification API: клик → `toastNew({langPackKey: 'Notifications.Restricted'})` (72c50bfef).
  4. Громкость: скраб до 0 выключает звук; `mouseup` зовёт тест звука с текущей громкостью.
  5. Типы чатов: переключили «Private Chats», закрыли вкладку → ровно один `notify.update` с
     патчем `private.muted`; не переключали → ноль вызовов.
  6. Вкладка: шапка — `Telegram.NotificationSettingsViewController`; после закрытия Solid-остров
     снят (узлов секций в DOM нет) — DoD 5.
- [x] **Шаг 3:** падают. **Мутации (фактически):** убрать `fakeDisabled` у `NotificationRow` — (1)
  краснеет; перенести запись типа из `onCleanup` в `onChange` — (5) краснеет; `captionOld` у
  секции — (1) краснеет.
- [x] **Шаг 4: реализовать** дословно: `NotificationsSection`, `SoundSection`, `SoundEffectsSection`,
  `NotifySection` ×3; `Notifications` собирает их в порядке `:543-569` (без трёх BLOCKED — у места
  комментарий с О-3…О-5). Данные типов — из `notifyStore` (единственный владелец), запись — через
  `managers.notify.update` + зеркало стора (как сейчас делает `updateType`).
- [x] **Шаг 5: врезка** (отдельный коммит, по очереди).
- [x] **Шаг 6: стенд** — сценарий пользователя: без разрешения — строки серые, подпись под
  карточкой, кнопка primary с колокольчиком; выдать разрешение — строки ожили; въезд/выезд
  вкладки; шапка без плашки у верха. `dom-parity 14-left-14-settings-notifications ours.txt` —
  расхождения только из § 7 референса и О-1. Числа — в коммит.

**Готово когда:** все 11 пунктов таблицы закрыты (кроме п. 4 — О-1 с комментарием у строки);
`git grep -n "NotificationsSettings" web-client/src` пуст; число React-`.tsx` уменьшилось на 1;
«у нас» в `settings-rows.md` § 8.2 обновлено.

---

**Итог пилота (2026-09-26) — что учесть следующим экранам:**
- Тест «ровно один раз» у строки-label в happy-dom врёт: активация label (досыл click в поле)
  идёт прямо на узле label ПО ХОДУ всплытия, до делегированного обработчика Solid на `document`,
  и `cancelEvent` строки её не отменяет. В браузере активация — после диспатча и только для
  неотменённого клика. Образец шима по спецификации — `installSpecLabelActivation` в
  `notifications.solid.test.tsx`; без него пины кликов по строкам с `clickable` показывают двойной
  вызов, которого на стенде нет.
- Проверенный на стенде «двойной clickable» (уточнение координатора, зона задачи 0) — НЕТ: в Chrome
  досланный label'ом click несёт `detail: 1` (копия исходного), `isTrusted`, `target` = поле;
  `hasMouseMovedSinceDown` гасит его по несовпадению цели с `mousedown`. Ветка `detail === 0`
  срабатывает только на синтетике (`el.click()`, клавиатура).
- `<button>` не наследовал шрифт: портирован сброс tweb `components/_global.scss:31-43` в
  `styles/index.scss` (пин — `styles/globalButtonReset.test.ts`) — `Button btn-transparent` других
  экранов теперь 16px, как у tweb.
- Новые ключи langpack попадают в русский интерфейс стенда только после пересборки бэкенда
  (`langpack.gen.json` вшит в сервер); до неё — английский нижний слой.
- Побочки настроек — подписчиками у самой настройки (`client/pushSetup.ts::watchPushConditions`),
  а не в обработчике строки.

---

## Пакет A — листья без 2C

Общая форма задачи пакета (не повторяется ниже): **Шаг 1** — прочитать оригинал(ы) и наш
React-экран как список сценариев; **Шаг 2** — падающие тесты на разметку (дамп § 7 референса) и
на момент сохранения; **Шаг 3** — падают + названные мутации прогнаны; **Шаг 4** — порт
дословно, расхождения в шапке; **Шаг 5** — врезка отдельным коммитом по очереди; **Шаг 6** —
стенд по чеклисту `settings-rows.md` «Проверка после порта» + `dom-parity` по дампу.
«Готово когда» у всех включает: старый React-файл удалён в том же PR, `git grep` по его имени
пуст, «у нас» обновлено.

### Задача 7: «Данные и память» + автозагрузка — ✅ сделано (PR feat/w2d-data-storage)

**Порт:** `dataAndStorage/index.tsx` + `storageQuota.tsx` (+ `.module.scss`) →
`sidebarLeft/tabs/dataAndStorage/{index,storageQuota}.solid.tsx`; `autoDownload/{autoDownloadTab,
peerTypeSection,photo,video,file}.tsx` → `sidebarLeft/tabs/autoDownload/*.solid.tsx`. Вкладки
`AppDataAndStorageTab` :439, `AppAutoDownload{Photo,Video,File}Tab` :421/:427/:433 — **Eventable**.
Главное (референс § 6.1): тумблер `AutoDownloadMedia` (не чекбокс), Photos/Videos/Files — `Row
disabled` + `Row.Subtitle` (`getAutoDownloadSubtitle`, `index.tsx:25-50`), сброс — `Button icon=
delete primaryTransparent` + `confirmationPopup` (`:72-81`), квота — 2 строки с `Row.RightContent`
«Clear», 4 строки `Row.Icon` (`photo_filled`/`play_filled`/`sticker_filled`/`limit_file_filled`),
`Space`, 2 × `RangeSettingSelector`, «Clear All» — `watchedCachedStorageNames` (у нас сейчас
только файлы — выяснить наши имена кэшей SW, `syncCacheSettingsToSW`); сохранение квоты — на
`destroy` (`:83-87`). Ключи — tweb (`AutoDownloadFiles`, `AutoDownloadContacts/Pm/Groups/Channels`,
`StorageQuota.*`).
**Мутации:** сохранять квоту на `onChange` — тест «запись на destroy» краснеет; `checkbox` вместо
`toggle` у первой строки — тест разметки краснеет.
**Зависимости:** 0–5. **Врезка:** `tabs.ts`, `SettingsView.tsx`, `SettingsSubScreen.tsx`; удалить
`settings/DataStorageSettings.tsx` + `.module.scss`.
**Отдельно выяснить:** строка «Cached video stream chunks» (`storageQuota.tsx:374-382`) — есть ли у
нас кэш потоковых чанков (SW `/dnp-stream/`); нет — О-6.

**Итог задачи 7 (2026-09-26) — что учесть следующим экранам:**
- О-6 выяснено: корзин потоковых чанков нет (DNP-стрим собирает SW без CacheStorage, DNP-OFF —
  токен-URL мимо кэша); `watchedCachedStorageNames` у нас = `cachedFiles`. Строки нет, у места —
  комментарий с номером.
- `useAppSettings` расширен (шапка `stores/appSettings.solid.ts`, п. 2, 6, 7): лист с `codec`
  (обратный смысл ключа — `autoDownloadNew.pFlags.disabled` ↔ `autoDownloadEnabled`), путь внутрь
  значения-объекта, запись поддерева одним `update` со слиянием верхнего уровня (как `setStore`
  Solid-стора), `SETTINGS_INIT` — представление над `DEFAULTS`. Задаче 11 (`liteMode`) и прочим —
  дописывать таблицу, форму записи не изобретать.
- Из Solid-вкладки дочерняя вкладка открывается `(tab.slider as SidebarSlider).createTab(T).open()`:
  узкий контракт `SliderSuperTabSlider` (`sliderTab.ts`) `createTab` не объявляет. Добавить его в
  контракт (и в `sliderTab.testStub.ts`) — одной правкой, когда таких вызывающих станет больше.
- `CheckboxFieldTsx stateKey` у нас нет — поля по ключу состояния пишутся `checked`/`onChange`
  через `useAppSettings` (расхождение в шапке `autoDownload/peerTypeSection.solid.tsx`).
- Шим `installSpecLabelActivation` — общий модуль `src/test/specLabelActivation.ts` (задача 8).
- Побочка `cacheTTL`/`cacheSize` → SW — подписчик `core/mediaCache.ts::watchCacheSettings`.
- Стенд не прощёлкан (эксклюзивно у другого агента): пункт чеклиста `settings-rows.md` открыт.
- Шапка `solidJsTabs/tabs.ts` («их три») устарела — не правилась ради механического слияния с
  задачами 8/10/11; поправить в сводном docs-PR.

### Задача 8: «Язык» → HEAD — ✅ сделано (PR feat/w2d-language)

**Порт:** дельта `e52b5d931 → 812502980` в `language.tsx` (референс § 8.2, отчёт сверки): список
— `createSignal` + `For` + `Row.RadioField`/`RadioFieldTsx class="disable-hover"`, `Row.Title
name` + `Row.Subtitle native_name` (`:98-154`) вместо `new Row` + `RadioFormFromRows` +
`replaceChildren`. `TranslateSection` (`:22-89`) — по-прежнему не портируется (решение #133,
записано в шапке файла); проверить, что обоснование ещё верно (перевода сообщений у нас нет).
**Файлы:** `sidebarLeft/tabs/language.solid.tsx` (+ тест). Врезки нет (вкладка уже заведена).
**Мутация:** снять `disable-hover` — тест класса краснеет. **Зависимости:** 0, 1, 2.
**Готово когда:** `git grep -n "components/row'" web-client/src/components/sidebarLeft/tabs/language.solid.tsx` пуст.

**Итог (2026-09-26):** список — дословно `:98-154` (`createSignal` + `For` + `RadioFieldTsx
class="disable-hover"`, `form` прямо в секции); `TranslateSection` не портирован — обоснование #133
сверено заново и верно (вызывающих `messages.translate` нет, `usePremium`/`pickLanguage` нет,
настройки перевода никто не читает). Сверх плана: с последним потребителем сняты
`RadioFormFromRows`/`RadioFormFromValues` (`row.ts`) и `radioForm.ts` + тест — предусловие задачи 31
«`radioForm` без потребителей» закрыто досрочно (у tweb HEAD `radioForm.ts` жив ради
`ButtonMenuSync.radioGroups`, у нас не портированных). Шим `installSpecLabelActivation` вынесен из
теста пилота в `web-client/src/test/specLabelActivation.ts` — брать оттуда. RTL-признак
(`setDocumentLangPackProperties`) не трогался: PR #291 не влит. Новых ключей нет.

### Задача 9: «Устройства» → HEAD + экран сессии (944b578e9) — ✅ сделано (PR feat/w2d-devices)

**Порт:** `activeSessions.tsx` (401) заново, JSX: `SessionRow` (`:294-323`: `Row class=
"session-row" clickable contextMenu` + `Row.Icon(getSessionPlatformIcon)` + `Row.Title titleRight`
+ `Row.Midtitle` + `Row.Subtitle`), секции `CurrentSession` (подпись `ClearOtherSessionsHelp`
только при других сессиях), `OtherSessions`, `IncompleteAttempts` (пустая — не рисуется), TTL
(`Show when={ttlDays()}` — у нас `authorization_ttl_days` всегда 0, секции не будет — порт как
есть + О-7), `Button 'btn-primary btn-transparent danger' icon=stop`, `confirmationPopup` вместо
`PopupPeer 'revoke-session'`, ошибки — `getAuthorizationErrorLangKey`, опрос раз в минуту
(`:99-112`). Клик по строке → **`AppSessionTab`** (:396, Eventable): `session.tsx` (157) +
`sessionInfoRow.tsx` (29) + `sessionDetails.module.scss` → `session.solid.tsx`,
`sessionInfoRow.solid.tsx`, `sessionDetails.module.scss`; секция `AuthSessions.View.AcceptTitle`
(`:112-143`) — BLOCKED (`changeAuthorizationSettings`, О-8): не рисуется, комментарий у места.
Переименование (`nameRight`, `:211-236`) — BLOCKED (О-9); connectedBot — SKIP (бизнес-ботов нет).
**Файлы:** `sidebarLeft/tabs/activeSessions.solid.tsx` (переписать), создать `session.solid.tsx`,
`sessionInfoRow.solid.tsx`, `sessionDetails.module.scss`; `solidJsTabs/tabs.ts` (`AppSessionTab`,
payload `{authorization, onTerminate?, onSettingsChanged?}`), `core/managers/sessionsManager.ts`
(отдавать и `authorization_ttl_days`, если сервер пришлёт — сейчас 0).
**Мутации:** клик по строке открывает попап вместо вкладки — тест «клик → AppSessionTab»
краснеет; подпись `ClearOtherSessionsHelp` без условия — тест «одна сессия → подписи нет» краснеет.
**Зависимости:** 0, 1, 3, 5 (`MediaHeader`, `InlineSelect` для TTL). **Готово когда:**
`git grep -n "components/row'\|settingSection'" web-client/src/components/sidebarLeft` пуст.

**Итог (2026-09-26):** `activeSessions.solid.tsx` переписан JSX-портом HEAD (`:48-401`):
`SessionRow` = `Row class="session-row" clickable role tabIndex contextMenu` + `Row.Icon`/`Title
titleRight`/`Midtitle`/`Subtitle`; секции `CurrentSession` (подпись и «завершить все» — только при
других), `AuthSessions.IncompleteAttempts`, `OtherSessions`; опрос раз в минуту;
`confirmationPopup` вместо `PopupPeer 'revoke-session'`; ошибки — портированный
`helpers/getAuthorizationErrorLangKey.ts`. Клик по строке → `AppSessionTab` (`tabs.ts`, payload
`{authorization, onTerminate?}` — `onSettingsChanged` не заведён, его зовёт только секция О-8):
`session.solid.tsx`, `sessionInfoRow.solid.tsx`, `sessionDetails.module.scss` (только классы
экрана устройства). Не перенесено: TTL-секция и `ttlDays` полезной нагрузки (О-7 — поэтому
`sessionsManager.ts` не менялся: отдавать нечего, сервер шлёт 0), `AcceptTitle` (О-8),
переименование/`customDeviceModel` (О-9), бизнес-бот (SKIP), `unconfirmed_authorizations_update`
(нет попапа неподтверждённого входа). Секция незавершённых входов портирована, но пуста:
бэкенд не ставит `password_pending`. Стиль строки — `.session-row` HEAD
(`_leftSidebar.scss:961-978`) вместо `.active-sessions-container`. Сверх плана: с последним
потребителем удалены `components/settingSection.ts` (+ тест) и `helpers/dom/toggleDisability.ts`
— предусловие задачи 31 «`git grep settingSection` пуст» закрыто (остались упоминания в
комментариях об адресах tweb); `row.ts` теперь нужен только `dialogRow.ts` и `appSearchSuper.ts`
(задача 29). Маркер «остров разобран» в `settingsSliderHost.test.ts` — вместо меню в `body`
(его больше нет: меню строит `createContextMenu` строки) минутный опрос: `clearInterval` его id.
Ключи tweb `AuthSessions.View.*` (6) и `AuthSessions.IncompleteAttempts(Info)` — в пять словарей
(fr без совпавшего `Application`), пины `dict.test.ts`, `langpack.gen.json`.

### Задача 10: «Горячие клавиши» — ✅ сделано (PR feat/w2d-shortcuts)

**Порт:** `keyboardShortcuts.tsx` (292) + `.module.scss` → `sidebarLeft/tabs/keyboardShortcuts.solid.tsx`;
вкладка `AppKeyboardShortcutsTab` :113. 8 секций с подписями Formatting/Messages, `ShortcutRow` =
`Row.Title titleRight=<KeyCombo> titleRightSecondary` + `Row.Subtitle` (`:69-78`), строка Send —
`InlineSelect` → `appSettings.sendShortcut` (есть ли у нас настройка отправки по Ctrl+Enter —
выяснить; нет — у строки комментарий и О-10), ключи — tweb (таблица расхождений в отчёте
сверки: `JumpToInputStart/End`, `…Action.OpenSearch`, … `LockPasscode`).
**Мутация:** `titleRight` без `titleRightSecondary` — тест класса краснеет.
**Зависимости:** 0, 1, 5. **Врезка:** `tabs.ts`, `SettingsView.tsx`, `SettingsSubScreen.tsx`; удалить
`settings/HotkeysSettings.tsx` + `.module.scss` + `.test.tsx`.

**Итог (2026-09-26).** Уточнение координатора: на вкладке — только сочетания, которые клиент
обрабатывает, без записи в «Отложено». Отсюда поправки к постановке:
- `sendShortcut` у нас нет (ни настройки, ни `isSendShortcutPressed`) — строка Send статичная
  (Enter), без `InlineSelect`; вместе с выбором ушла и подпись `Section.Messages.Caption`
  («Choose how messages are sent…» — выбирать нечего). О-10 НЕ заводится. Зависимость от 5
  (`InlineSelect`) фактически не понадобилась.
- `JumpToInputStart/End` не портируются: у tweb это каретка в поле (`chat/input.ts:3187-3200`),
  у нас Ctrl+PageUp/PageDown листает ленту (`useFeedPageHotkeys`, своей строки у tweb нет).
- Секция Other/`LockPasscode` вернётся с задачей 18, когда появится сочетание блокировки
  (`ShortcutBuilder`) — отметить там.
- Врезка тронула ещё `settingsSubScreen.reachable.test.ts` (нижние границы 7 → 6 и 3 → 4) — ту же
  строку правит каждый переезжающий экран.
- С экраном снесены 10 ключей, которые читал только он (в т.ч. ключи tweb `MediaZoomIn`/
  `MediaZoomOut`/`Undo`); числа пинов `dict.test.ts` вернулись к прежним, отпечатки — новые.
- Шапка `solidJsTabs/tabs.ts` («у нас их три…») не правилась: общий файл, строку правят все
  врезки — поправить одной правкой после очереди.

### Задача 11: «Энергосбережение» — ✅ сделано (PR feat/w2d-power-saving)

**Порт:** `components/checkboxFields.tsx` (346) → `checkboxFields.solid.tsx`; `powerSaving.tsx`
(122) → `sidebarLeft/tabs/powerSaving.solid.tsx`; вкладка `AppPowerSavingTab` :241. Две секции в
`<form>` (подпись `LiteMode.Info` вне карточки), мастер `all` = «включить энергосбережение»
(у нас смысл обратный), дерево ключей `:28-37` с аккордеоном и счётчиком, при `all` — строки
`is-fake-disabled` + тост `LiteMode.DisableAlert`, сохранение на `change` → `liteMode` через
задачу 4 (у нас `helpers/liteMode.ts` + ключи стора — сверить соответствие ключей tweb/наших;
лишних наших ключей нет в порте).
**Мутация:** не инвертировать значения — тест «выключенная анимация = включённый тумблер» краснеет.
**Зависимости:** 0–4. **Врезка:** `tabs.ts`, `GeneralSettings.tsx` (строка LiteMode →
`openTab(AppPowerSavingTab)`), `SettingsSubScreen.tsx` (`renderDedicated`); удалить `settings/PowerSaving.tsx`.

**Итог задачи 11 (2026-09-26) — поправки к постановке:**
- «При `all` — строки `is-fake-disabled`» неточно: строки получают `is-disabled`
  (`row.toggleDisability`, `pointer-events: none`), а `is-fake-disabled` — само поле
  (`input`, `powerSaving.tsx:87`); тост ловит секция, потому что строки не принимают клик.
- Мутация сформулирована наоборот: у tweb выключенная анимация (`liteMode.gif = true`) —
  СНЯТЫЙ тумблер (`checked: !value`, `:48`); пин — «выключенная анимация — тумблер снят».
- «Сверить ключи стора» оказалось переездом настройки: у нас был один флаг `reduceMotion`
  («Без анимаций» меню «Ещё»), а это tweb `liteMode.animations`. Настройка стала объектом
  `liteMode` формы tweb в zustand (`settings.tsx`, миграция в `load()`), `helpers/liteMode.ts` —
  формула оригинала `!all && !liteMode[key]`, тесты, гасившие анимации `reduceMotion: true`,
  переведены на `liteMode.all` (та же семантика «всё выключено»). Меню «Ещё» пишет
  `liteMode.animations`; пункта «Lite Mode» при `all` (`sidebarLeft/index.ts:946-954`) нет —
  вкладку из меню колонки открыть нечем до задачи 28.
- Побочки — подписчик `client/liteModeSettings.ts` (tweb `appImManager.setSettings:2738-2757`:
  `animation-level-*`, `html.no-backdrop` по `blur`, автоплей стикеров); два React-эффекта
  `App.tsx` по `reduceMotion` сняты. Стили аккордеона и `html.no-backdrop` перенесены в
  `styles/index.scss` (tweb `base.scss:1786-1872`, `:403-407`).
- `CheckboxFields` у tweb ставит `input.disabled` полю группы строкой после `createRoot`, а
  эффект поля `toggleDisability(!!props.disabled)` во вкладке (строки создаются в `onMount`,
  эффекты встают в общую очередь) его снимает. У нас — эффектом после эффекта поля
  (расхождение 5 в шапке `checkboxFields.solid.tsx`). Стенд показал второй слой того же риска:
  по выключенному полю, лежащему поверх тумблера, Chrome не шлёт click (только pointer-события) —
  щелчок по тумблеру группы пропадал. Выключенное поле строки-группы — `pointer-events: none`
  (отступление в `styles/tweb/_row.scss`); у tweb с полем, которое включил эффект, щелчок
  переключает группу дважды (нативно и сеттером) — видно на стенде тем же приёмом.
- Для императивной сборки строк понадобились `helpers/solid/wrapSolidComponent.ts`
  (`unwrapSolidElement`), `ListenerSetter.addCleanup`, `helpers/dom/dispatchEvent.ts` и пара
  `get/set checked` у `CheckboxField`.
- Для задачи 13: статус строки «Общих» уже живой (`liteMode.all` → Enabled/Disabled), читать —
  `appSettings.liteMode.all`.

### Задача 12: «Обои» и «Цвет» — ✅ сделано (PR feat/w2d-wallpapers)

**Порт:** `background.tsx` (615; вкладочная часть `:561-611` + нужные утилиты статик-класса) →
`sidebarLeft/tabs/background.solid.tsx`, `backgroundColor.tsx` (168) → `backgroundColor.solid.tsx`,
`components/colorPicker.ts` (370) → `components/colorPicker.ts`. Вкладки :167, :275. Три `Button
btn-primary btn-transparent` (`cameraadd`/`colorize`/`favourites`), тумблер Blur c `disabled`,
сетка `.search-super-content-media-grid`. Источник обоев: у tweb — `account.getWallPapers` +
кэш; у нас — локальные пресеты (`settings/ChatWallpaper.tsx`) и `themeController` из волны темы —
выяснить, что есть на бэкенде; нет ручки — сетка из нашего набора с комментарием и О-11.
**Мутация:** Blur не `disabled` для pattern-обоев — тест краснеет.
**Зависимости:** 0–4. **Врезка:** `tabs.ts`, `GeneralSettings.tsx`; удалить `settings/ChatWallpaper.tsx` + `.module.scss`.

**Итог (2026-09-26):** `background.solid.tsx` (вкладка + статическая часть `AppBackgroundTab`
с `addWallPaper`/`setBackgroundDocument` — её переиспользует выбор темы задачи 13),
`backgroundColor.solid.tsx`, `components/colorPicker.ts` + `styles/tweb/_colorPicker.scss`
(дословно), хелперы tweb `createElementFromMarkup`, `markGridCornerItem`, `requestFile`,
`hexaToHsla`. Бэкенд выяснен: ручек обоев НЕТ вовсе (ни списка, ни загрузки/сохранения
обоев) — сетка из `WALLPAPER_PRESETS` с комментарием О-11. Модель обоев осталась нашей
(zustand `wallpaper`/`customWallpaperMediaId`/`customWallpaperBlur`, рисует React
`ChatBackground.tsx`) — вкладки пишут ровно её; соответствие tweb: обои с узором ↔ пресет,
загруженные ↔ своё фото, `wallPaperNoFile` ↔ цвет. Размытие — только у своего фото
(`needBlur` tweb не размывает обои с узором), поэтому мёртвая настройка `wallpaperBlur`
(размывала градиент, чего у tweb нет) снята из `settings.tsx` и `ChatBackground.tsx`. Своё
фото сервер в выдачу не вернёт — его плитку вкладка ставит первой сама. Плитку рисует
`mountWallPaperThumb` (градиент + узор в `soft-light`, как наш фон в дневной теме; классы —
дописанные в `ChatBackground.module.scss` правила tweb `chatBackground.module.scss`), потому
что Solid `<ChatBackground>` у нас нет. Ключи — tweb (`ChatBackground`,
`ChatBackground.UploadWallpaper`, `ChatBackground.Blur`, `Appearance.Reset`,
`Appearance.Color.Hex/RGB`); самодельные `ChatBackground.Upload/Reset/Blurred` сняты.
Строка «Общих» теперь с ключом tweb `ChatBackground` (`generalSettings.tsx:67`). Не
перенесено (шапки файлов): `blendWallpaperForTinted` (нет tinted-деривации),
`highlightingColor` выбранных обоев (предмет `ChatBackground.tsx`), кольцо фокуса плитки
(a11y 472e3e76b), перекодирование PNG → JPEG (требование `account.uploadWallPaper`).

### Задача 14: «Быстрая реакция» — ✅ сделано (PR feat/w2d-quick-reaction)

**Порт:** `quickReaction.tsx` (64) → `sidebarLeft/tabs/quickReaction.solid.tsx`;
`reactionStickerPreview.tsx` (20) → `reactionStickerPreview.solid.tsx`; вкладка :195. `<form>` +
`For` по доступным реакциям: `Row havePadding` + `Row.RadioField` (`RadioFieldTsx alignRight
class="disable-hover"`) + превью; `setDefaultReaction` сразу; данные — через `promiseCollector`.
Наш экран недостижим (поправка 10) — входа до задачи 15 нет: вкладка заводится, открывается
из «Стикеров» в задаче 15 (до того — только тестом).
**Мутация:** радио слева вместо `alignRight` — тест `radio-field-right` краснеет.
**Зависимости:** 0, 1, 2. **Врезка:** `tabs.ts`; удалить `settings/QuickReaction.tsx`, мок
`SCREENS` и `renderDedicated` из `SettingsSubScreen.tsx` (мёртвые, поправка 10).

**Итог (2026-09-26):** порт дословный (`quickReaction.tsx:11-64`, `reactionStickerPreview.tsx`);
для превью заведён `components/wrappers/stickerTsx.solid.tsx` — порт `StickerTsx`
(`wrappers/sticker.ts:828-880`) отдельным модулем, т.к. наш `sticker.ts` ванильный. Каталог —
`chat/reactions.ts::getAvailableReactions` (тот же кэш на сессию, что у ленты и панели реакций;
второй копии нет). **Вход сделан сейчас, а не в задаче 15** (уточнение координатора): строка
`DoubleTapSetting` первой в первой секции React-экрана `settings/StickersSettings.tsx` →
`getSettingsSliderHost().openTab(AppQuickReactionTab)` (пин — `StickersSettings.quickReaction.test.tsx`,
уходит с экраном в задаче 15); превью справа в строке не рисуется — быстрой реакции нет, у tweb без
неё оно тоже пустое. **О-30:** нет `config.reactions_default`/`messages.setDefaultReaction`/события
`quick_reaction` — на открытии не отмечено ничего, выбор только переносит отметку (долг —
`web-client/backlogs/frontend/quick-reaction-default.md`, обновлён). Из `SettingsSubScreen.tsx` снят
мёртвый мок целиком (`SCREENS`, `NAV`, `renderDedicated`, локальные тумблеры/радио, мок-рендер) — «Общие»
держались в `hasSubScreen` ТОЛЬКО через `title in SCREENS`, теперь явной клаузой (без неё краснеет
`settingsSubScreen.reachable.test.ts`). Снят самодельный ключ `DoubleTapSettingInfo` (у tweb нет,
читатель ушёл с экраном) — пины `dict.test.ts` −1 у всех пяти, `langpack.gen.json` пересобран
(версии 8→9 — конфликт с соседними PR, пересчитать при слиянии). Задаче 15: строка `DoubleTapSetting`
уже есть — при переезде `clickable={() => tab.slider.createTab(AppQuickReactionTab).open()}` +
`ReactionStickerPreview` (пустое до О-30), React-пин снести вместе с экраном.

### Задача 16: `AppSelectPeers` + вкладка «Выбор участников» — ✅ сделано (PR feat/w2d-select-peers)

**Порт:** `components/appSelectPeers.tsx` (1453) → `appSelectPeers.solid.tsx` в объёме
потребителей волны (исключения приватности `type:'privacy'`, чаты папки `peerType:['dialogs']`,
выбор чатов ссылки `noSearch`/`multiSelect`, попап выбора пользователя 2C); `addMembers.tsx`
(167) → `sidebarLeft/tabs/addMembers.solid.tsx`, `AppAddMembersTab` :1054. Строки — наш
`dialogRow.ts` (`createChatList`/`addDialogNew`). Нереализуемые ветки (миниаппы в
`extraCategories`, боты) — в шапку с О-номерами.
**Зависимости:** 0, 1, 2. Врезки нет (потребители — задачи 17, 22, 25). Размер — L.

**Итог (2026-09-26):** `components/appSelectPeers.solid.tsx` — класс, как у tweb HEAD (не
Solid-компонент: у оригинала Solid только секции через `wrapSolidComponent`); строки —
`dialogRow.ts` (`addDialogNew`, `createChatList`; добавлен `meAsSaved`), а не
`createChatList`/`addDialogNew` «наших» строк списка чатов. Вместе с ним портированы
`selectorSearch.solid.tsx` (чип — уже бывший `selectorEntity.ts`), ванильный
`components/inputSearch.ts` (наследует `InputSearchHandle` — поведенческая половина
одна), `emptyPlaceholder.solid.tsx`, `buttonCorner.ts`, `helpers/solid/wrapSolidComponent.ts`,
`helpers/array/filterUnique.ts`; `contacts.testSelfSearch` выставлен ручкой. Вкладка —
`sidebarLeft/tabs/addMembers.solid.tsx`, `AppAddMembersTab` (заголовок-функция вместо
переопределённого `init`, `noSame`). Скоуп по папке — `setFolderId`/`onSearchChange`, которые
зовёт уже портированный `popups/pickUserFolderTabs.ts` (своего ряда нет). Курсор страницы —
индекс из зеркала `dialogIndexById` (как `useDialogListSource`), архив — `ARCHIVE_FOLDER_ID`
(−1, у tweb 1). Порт в объёме потребителей волны; без потребителя не перенесены `custom`,
режим `hidden` с меню, `setLimit`, `prependPeerIds`, `getPeerIdFromKey`, `removeBatch`,
`freezed`, участники канала; звёзды/премиум-замок — О-31 (права отправки сняты в `fix/contacts-share-pickers`), `convertPeerTypes`
(боты) — О-32, категории `extraCategories` (мини-приложения) — О-33. Сверх плана: `_selector.scss`
и `_row.scss` приведены к HEAD — полоса `.selector-row-with-checkbox`, классы
`row-with-checkbox-and-media`/`row-selection-*` (690514225) вместо снятого `.selector-square`;
React `PeerSelector` ставит те же классы строки (иначе квадратные экраны потеряли бы раскладку).
Ключ `RequestJoin.List.SearchEmpty` — в словари. Стенд не трогался: открывающих вкладку нет до
задачи 17 (проверка — там).

### Задача 18: «Код-пароль» — ✅ сделано (PR feat/w2d-passcode)

**Порт:** `passcodeLock/{mainTab,enterPasswordTab,shortcutBuilder}.tsx` (+ scss) →
`sidebarLeft/tabs/passcodeLock/*.solid.tsx`; вкладки :27 (`onOpenAfterTimeout: sliceTabsUntilTab
(AppPrivacyAndSecurityTab)` — до задачи 23 хаба-вкладки нет: срез до корня, у строки — О-12 до 23),
:48. Выключен: `SettingsTabLottieAnimation UtyanPasscode`, `btn-large "TurnOn"`, подпись
`PasscodeLock.Notice`; включён: `lockoff` «TurnOff.Title» (не danger) → `confirmationPopup`,
`key_filled` «ChangePasscode» (сначала старый код), AutoLock — `InlineSelect`, тумблер
`EnableLockShortcut` + `ShortcutBuilder`. Наши `stores/lockStore.ts` и сканы — не трогать.
**Мутация:** «TurnOff» с `color="danger"` — тест краснеет.
**Зависимости:** 0–5. **Врезка:** `tabs.ts`, `PrivacySecuritySettings.tsx` (строка Passcode →
`openTab`); удалить `settings/PasscodeLock.tsx`.

**Итог (2026-09-26):** `mainTab`/`enterPasswordTab`/`shortcutBuilder` — дословно (`.solid.tsx` +
модули scss); смена кода, как у HEAD `mainTab.tsx:199-224`, НЕ спрашивает старый код — его
спрашивает вход из «Конфиденциальности» (`privacyAndSecurity.tsx:193-210`), так и врезано.
Сверх плана (без них экран неполон): порт `components/passwordInputField.ts`,
`components/quizHint.ts` + `_quizHint.scss` (подсказки «код задан/изменён/отключён»), сочетание
блокировки — настройки `passcodeLockShortcut(Enabled)`, `helpers/shortcutListener.ts`,
`core/hooks/useLockScreenShortcut.ts` (вызов в `App.tsx`; без слушателя тумблер был бы мёртвым).
Новые ключи tweb: `PasscodeLock.{Notice,Next,Disabled,EnableLockShortcut,LockShortcutDescription}`,
`MinutesShort`; сняты без читателей `PasscodeLock.ForgotNotice`, `PasscodeLock.AutoLock.Caption`,
`Unit.Minutes.Abbr`, `Common.Next`. О-12 — срез `onOpenAfterTimeout` до корня хоста и подсказка
после выключения в слое хоста (`tab.slider.sidebarEl`) — снимаются задачей 23.
**Открыто:** секция `Other/LockPasscode` «Горячих клавиш» (заметка задачи 10) — сочетание теперь
есть, но `keyboardShortcuts.solid.tsx` в `main` ещё нет (PR #295); вернуть tweb
`keyboardShortcuts.tsx:250-277` (`[...lockShortcut, 'L']` из `appSettings.passcode.*`) после
слияния обоих. `canCloseOnPeerChange` у `quizHint` и `appImManager.isShiftLockShortcut` — без
потребителей у нас (подсказки опросов и «печать → композер» не портированы).
**Безопасность (вне объёма задачи, не чинилось):** модель tweb 65c6ea8f8/«Encrypt the stores» к
нам не относится буквально — ключа, выведенного из кода, у нас нет вовсе (код не шифрует
хранилища), поэтому и в `localStorage` он не лежит. Но код-пароль — только запор интерфейса:
`session_token` и список аккаунтов с токенами лежат открытым текстом в IndexedDB `msgr/kv`
(`core/auth/tokenStore.ts`, `core/auth/accounts.ts`), корзина медиа `cachedFiles` при включении
кода не чистится и пишется дальше (`core/files/cacheStorage.ts`, шапка: шифрование не
портировано). У tweb под кодом ключи авторизации лежат только в `localStorage__encrypted`
(`AccountController.updateStorageForLegacy(null)`), шифруемые корзины чистятся и шифруются. Нужна
отдельная задача: шифрование хранилищ под кодом (порт `lib/passcode/*` + `EncryptionKeyStore` с
ключом ТОЛЬКО в памяти/`window.sessionStorage` на время переключения, как 65c6ea8f8).

### Задача 19: «Двухэтапная проверка» (мастер 2FA) — ✅ сделано (PR feat/w2d-2fa)

**Порт:** `2fa/{index,enterPassword,reEnterPassword,hint,email,emailConfirmation,passwordSet}.tsx`
+ `forgotPasswordLink.ts` → `sidebarLeft/tabs/2fa/*.solid.tsx`; вкладки :891-989. `captionOld` на
главной и на почте (дамп `14-left-34`), кнопки `Button`, `PasswordMonkey`/`TrackingMonkey`
(наш React `PasswordMonkey.tsx` — порт на Solid в этой задаче или найти Solid-вариант в
`auth/cards/PasswordCard.solid.tsx`), попапы `popup-disable-password`/`popup-skip-email` —
`PopupPeer` (есть). **BLOCKED:** код подтверждения почты и «Забыли пароль» (`authManager.ts:
118-122`, `:468-475` — нет unconfirmed pattern) — шаги `emailConfirmation`/`forgotPasswordLink`
не заводятся, О-13.
**Мутация:** `captionOld` снят на главной — тест места подписи краснеет.
**Зависимости:** 0, 1, 5. **Врезка:** `tabs.ts`, `PrivacySecuritySettings.tsx`; удалить
`settings/TwoStepVerification.tsx` + `.module.scss`.

**Итог (2026-09-26):** шесть вкладок `AppTwoStepVerification{,EnterPassword,ReEnterPassword,Hint,
Email,Set}Tab` (`sidebarLeft/tabs/2fa/*.solid.tsx`) — дословно по tweb; врезка — строка
React-«Конфиденциальности» по состоянию пароля (`privacyAndSecurity.tsx:257-271`). Сверх плана
пришлось завести первых потребителей: `components/passwordInputField.ts`,
`components/monkeys/{password,tracking}.ts` (классы tweb; React `PasswordMonkey.tsx` остался у
`PasscodeLockScreen.tsx`, а не у 2FA — решение плана «портировать или найти в `PasswordCard`» снято:
в `PasswordCard.solid.tsx` обезьянка — заглушка), `components/wrappers/stickerEmoji.ts`,
`lib/richtext/matchEmail.ts`, `helpers/dom/canFocus.ts`, ассет `LoveLetter` (+PNG фолбэка, пин
состава статики 11 → 12), стиль `.popup-disable-password/.popup-skip-email`. Пароль — через
`/me/password` (SRP у сервера нет, пароль телом внутри TLS, в журнал не пишется). Попапы —
`PopupPeer` (2C не понадобилась). Ловушки: (1) `sliceTabsUntilTab(AppSettingsTab)` без вкладки
корня — срез до корня хоста (`2fa/sliceTabsUntilSettings.ts`), финал закрывается на
«Конфиденциальность»; (2) React-экран под хостом переживает мастер — хост получил
`onTabsEmpty`, экран перечитывает состояние; (3) `TwoStepVerification.module.scss` не удалён —
его импортирует `settings/PasscodeLock.tsx` (удалит задача 18); (4) у хоста `removeTabFromHistory`
посреди мастера на миг опустошает стек — `onTabsEmpty` срабатывает и там (безвредно).
Сняты 7 наших ключей без tweb-аналога, читавшихся только React-мастером. О-13 расширен:
«Skip» не снимает почту.

## Пакет B — родители и экраны с 2C

### Задача 13: «Общие» — ✅ сделано (PR feat/w2d-general)

**Порт:** `generalSettings.tsx` (359) → `sidebarLeft/tabs/generalSettings.solid.tsx`;
`components/chatThemesPicker.tsx` (356) → `chatThemesPicker.solid.tsx` (наш React
`components/ChatThemesPicker.tsx` — только сценарии; его другие потребители — проверить, снос по
правилу «последний потребитель»). Секции `Settings` (`RangeSettingSelector` 12–20, ChatBackground
→ :167, Increase Contrast, LiteMode c живым Enabled/Disabled → :241), `ColorTheme` (5 радио
`settings.theme` + акцент для tinted), `DistanceUnitsTitle` — нет геолокации → не рисуется
(условие оригинала), `General.TimeFormat` (подпись — живое время `eachMinute`).
**Мутация:** max 24 вместо 20 — тест краснеет. **Зависимости:** 11, 12.
**Врезка:** `tabs.ts`, `SettingsView.tsx`, `SettingsSubScreen.tsx`; удалить `settings/GeneralSettings.tsx` + `.module.scss`.

**Итог (2026-09-27):** `sidebarLeft/tabs/generalSettings.solid.tsx` — секции `Settings`/`ColorTheme`/
`General.TimeFormat` дословно по tweb; настройки через мост (`messagesTextSize` → `textSize`, `theme` →
`themeChoice` — значения совпадают один в один, `timeFormat` — `codec` h12/h23 ↔ 12h/24h); статус
«Энергосбережения» — эффект по `liteMode.all`; хелперы tweb `eachMinute`/`eachTimeout`; ключи tweb
`ThemeDay`/`ThemeTinted`/`AutoNightSystemDefault` вместо самодельных `Theme.Light/System/Tinted` (у
React-экрана `ThemeLight` стоял на `day`, а у tweb `light` = «Day»). **`chatThemesPicker.solid.tsx` НЕ
заведён — О-38:** плитка у tweb пишет облачную тему в `settings.themes[]` текущей базы
(`applyNewTheme`: акцент, цвета исходящих, обои темы), у нас нет ни `account.getThemes`, ни этой модели
(тема = пресет + одни обои, О-11), ни глобальной акцент-деривации, ни пресетов акцента — выбору некуда
писать; четыре карточки React-экрана (по пресету) были нашей выдумкой и не перенесены. Increase Contrast —
О-37 (a11y 472e3e76b не портирован). `DistanceUnitsSection` не портирован: у tweb
`IS_GEOLOCATION_SUPPORTED = … && false`. Наш React `components/ChatThemesPicker.tsx` остаётся — это попап
темы одного чата (`useChatPopups`), к порту не относится. Сверх плана: прижатие `textSize` > 20 на чтении
(`settings.tsx::load`, React пускал до 24); подпись времени — `Intl.DateTimeFormat` (скан
`noBrowserLocaleDates` запрещает `toLocale*String`). Порог выделенных подэкранов в
`settingsSubScreen.reachable.test.ts` 5 → 4, веток корня 4 → 5.

### Задача 15: «Стикеры и эмодзи» (2C)

**Порт:** `stickersAndEmoji.tsx` (270) → `sidebarLeft/tabs/stickersAndEmoji.solid.tsx`; вкладка
:202. DoubleTap → `AppQuickReactionTab` (задача 14), SuggestStickers (`contextMenu` строки), Loop,
секции `Emoji`, `DynamicPackOrder`, установленные наборы — `row-sortable` + `Row.Media` + `Sortable`
→ `reorderStickerSets` (есть ли у нас ручка порядка — выяснить; нет — О-14); клик по набору →
`showStickersPopup` — **2C**.
**Зависимости:** 5, 14, 2C. **Врезка:** `tabs.ts`, `SettingsView.tsx`, `SettingsSubScreen.tsx`;
удалить `settings/StickersSettings.tsx`.

### Задача 17: `PrivacySection` + вкладки правил приватности — ✅ сделано (PR feat/w2d-privacy-rules)

**Порт:** `components/privacySection.tsx` (393) → `privacySection.solid.tsx`; `privacy/*.tsx` →
`sidebarLeft/tabs/privacy/*.solid.tsx` для наших 12 ключей (`privacyManager.ts:8-20`); вкладки
:301-367 — **Eventable**, сохранение на `destroy` (`privacySection.tsx:271`, `:279-344`).
**Главное для пользователя — «Н..»:** строка исключения — `Row.Icon` + `Row.Title` + **`Row.Subtitle`
со счётчиком** (`:214-216`, `generateStr` `:381-392`), без `titleRight`. Радио — `Row.RadioField`,
подпись секции меняется `replaceCaption` и прячется `hide`. `AppPrivacyMessagesTab` (:59) —
`messages/*` в объёме нашего бэкенда (`privacyKeyMessages` — наш конструктор, платных сообщений
нет — О-15). Gifts/SavedMusic/P2P — ключей нет (О-16). Исключения только пользователи (О-17).
Если до этой задачи далеко — горячий фикс в React допустим отдельным коммитом: `value` →
`sublabel` в `settings/PrivacyRule.tsx:162`, `:170` и `PrivacySecuritySettings.tsx:115-133`
(кит уже умеет подпись).
**Мутации:** счётчик в `titleRight` — тест «заголовок исключения не сжат / подпись под ним»
краснеет; сохранение на `onChange` — тест «запись на destroy» краснеет.
**Зависимости:** 16. **Врезка:** `tabs.ts`, `PrivacySecuritySettings.tsx`; удалить
`settings/PrivacyRule.tsx`, `PrivacyUserPicker.tsx` (если у `BlockedUsers` его уже нет — иначе в 22).

**Итог (2026-09-27):** `components/privacySection.solid.tsx` — класс, как у tweb (секции через
`wrapSolidComponent`, запись на `destroy`); вкладки `sidebarLeft/tabs/privacy/{privacyTab,about,
addToGroups,birthday,calls,forwardMessages,lastSeen,phoneNumber,profilePhoto,voices,readTime}.solid.tsx`
и `messages/tab.solid.tsx`; объявления — один блок в конце `tabs.ts`, все eventable. «Н..» снято:
счётчик — `Row.Subtitle` (`generateStr` → `Users`). Исключения — `AppAddMembersTab` `type: 'privacy'`
с `filterPeerTypeBy: ['isUser']` (О-17); tweb не делает списки взаимоисключающими — наш React делал,
в порт не перенесено (сервер: Deny перекрывает Allow). Правило пишется на закрытии БЕЗУСЛОВНО, как
tweb. Кэш правил — `stores/privacyStore.ts` (роль кэша `appPrivacyManager`), запись — `managers.privacy.
setRule` + зеркало ответа в стор (хаб перерисовывается), при ошибке — `loadPrivacy`. Поправки к
постановке: (1) `AppPrivacyMessagesTab` «в объёме бэкенда» — не `messages/*`: наш `messages` — обычное
правило из трёх значений с исключениями, поэтому вкладка — `PrivacySection`, форма eventable (у tweb
обычная), подпись — наш `Privacy.MessagesCustomHelp`; (2) ключ `read_time` своей вкладки у tweb не
имеет (у оригинала — тумблер `hide_read_marks` на «Был в сети») — заведена НАША `AppPrivacyReadTimeTab`,
чтобы не терять серверное правило; судьба строки — задача 23; (3) новые «Отложено»: О-34 (премиум-гейты),
О-35 («публичное фото»), О-36 (ссылка `t.me/+номер` в подписи) — сверить номера с параллельными PR.
Врезка: строки правил React-«Конфиденциальности» → `getSettingsSliderHost().openTab(AppPrivacy…Tab)`
(заголовки и значения строк не трогались — зона задачи 23), `settings/PrivacyRule.tsx` (+ тест) удалён;
`PrivacyUserPicker.tsx` ОСТАЛСЯ — его импортирует `BlockedUsers.tsx`, снос в задаче 22. Ключи: +11 tweb
(`PrivacyExceptions`, `PrivacyMessages`, `Privacy.Bio`, `WhoCanAddMe`, `Privacy.Birthday(Caption)`,
`PrivacySettingsController.{Forwards.CustomHelp,LastSeenDescription,ProfilePhoto.CustomHelp}`,
`PrivacyVoiceMessagesInfo`, `Users`), сняты 13 без читателей (подписи прежнего экрана и давно мёртвые
`Privacy.*Choose`/`PrivacyPhoneInfo2`/…). Стенд не трогался.

### Задача 20: «Автоудаление» (2C)

**Порт:** `autoDeleteMessages/{index,options}.tsx` + `customTimePopup/*` →
`sidebarLeft/tabs/autoDeleteMessages/*.solid.tsx`; вкладка :148. SaveButton в шапке (Portal),
подтверждение при закрытии, `Space` + `SettingsTabLottieAnimation UtyanDisappear`, радио сроков с
вставкой своего значения по порядку, `tools` «SetOtherTime» → `showAutoDeleteMessagesCustomTimePopup`
— **2C**. **Зависимости:** 5, 2C. **Врезка:** `tabs.ts`, `PrivacySecuritySettings.tsx`; удалить
`settings/AutoDeleteMessages.tsx`.

### Задача 21: «Passkeys» (2C)

**Порт:** `passkeys.tsx` (131) + `.module.scss` → `sidebarLeft/tabs/passkeys.solid.tsx`; вкладка
:137. `MediaHeader` со стикером `key`, строки с `contextMenu` удаления → `confirmationPopup`,
`Button primaryTransparent icon=add`, самозакрытие без WebAuthn; интро — `showPasskeyPopup`
(`popups/passkey.tsx`) — **2C**, наш `PasskeyIntroPopup.tsx` удаляется там.
**Зависимости:** 5, 2C. **Врезка:** `tabs.ts`, `PrivacySecuritySettings.tsx`; удалить
`settings/Passkeys.tsx`, `PasskeyIntroPopup.tsx` + `.module.scss`.

### Задача 22: «Заблокированные» (2C)

**Порт:** `blockedUsers.tsx` (169) → `sidebarLeft/tabs/blockedUsers.solid.tsx`; вкладка :252
(`onOpenAfterTimeout: scrollable.onScroll()`). Подпись `BlockedUsersInfo` НАД карточкой (`:61`,
дамп `16b`), чатлист `createChatList` c `chatlist-chat-abitbigger`, подзаголовок
телефон/@username/статус, FAB `ButtonCorner add` → `showPickUserPopup` — **2C** (на
`AppSelectPeers` задачи 16), меню «Unblock» (`lockoff`), подгрузка по 50, `peer_block`.
**Зависимости:** 16, 2C. **Врезка:** `tabs.ts`, `PrivacySecuritySettings.tsx`; удалить
`settings/BlockedUsers.tsx`, `PrivacyUserPicker.tsx`.

### Задача 23: хаб «Конфиденциальность и безопасность»

**Порт:** `privacyAndSecurity.tsx` (700) → `sidebarLeft/tabs/privacyAndSecurity.solid.tsx`; вкладка
:659 (Eventable). Первая секция `noDelimiter` + подпись `SessionsInfo`; у всех строк значение —
`Row.Subtitle` (`:216-306`); Passcode при включённом коде — сначала `AppPasscodeEnterPasswordTab`
(`:193-210`); 2FA — ветвление на три вкладки; Passkeys — скрыта без ключей и WebAuthn. Не
рисуются (BLOCKED, О-18): web sessions (`:223-237`), login email (`:277-288`), секции
NewChats/Sensitive/Payments. Наши лишние строки «Сессии» и «Удаление аккаунта» — удалить или
обосновать у строки (у tweb удаление аккаунта — не здесь; найти, где оно у нас нужно продукту).
Снимает О-12 задачи 18.
**Зависимости:** 17–22. **Врезка:** `tabs.ts`, `SettingsView.tsx`, `SettingsSubScreen.tsx`;
удалить `settings/PrivacySecuritySettings.tsx`, `settings/ConfirmDialog.tsx` — если потребителей
вне настроек не осталось (см. задачу 30).

### Задача 24: «Папки» — список и редактор — ✅ сделано (PR feat/w2d-folders)

**Порт:** `chatFolders.tsx` (433) → `sidebarLeft/tabs/chatFolders.solid.tsx`; `editFolder.tsx`
(733) + `editFolderInput/*` → `editFolder.solid.tsx`; вкладки :815, :833 (`getInitArgs`, lottie
`Folders_1/2`). Список: заставка + `div.caption` + `Button btn-control` вне секций, `Filters`
(`row-sortable`, `Sortable` → `updateDialogFiltersOrder` — ручки нет, О-19), `FilterRecommended`
(BLOCKED, О-20 — секция не рисуется), `FiltersView` (радио `tabsInSidebar`). Редактор: галка ↔
меню ⋮ «FilterMenuDelete» по наличию изменений, поле имени `maxLength 12` (бэкенд
`domain/folder.go:9`; эмодзи — О по плану папок № 11), категории — `folder-category-button`
(в т. ч. `bots`; **чинить** `foldersManager.ts:57-68`, который шлёт `bots: false` и теряет флаг),
`exclude_archived` — нет на проводе (О-21), ссылки — `Row` + `Row.Media`, лимиты — 2C + О-22.
Открывается ещё из меню папки (`helpers/dom/createFolderContextMenu.ts`, колбэки `Sidebar.tsx`).
**Зависимости:** 5. **Врезка:** `tabs.ts`, `SettingsView.tsx`, `SettingsSubScreen.tsx`,
`Sidebar.tsx` (колбэки меню папки → `openTab`); удалить `folders/ChatFoldersSettings.tsx`,
`FolderEditor.tsx`.

**Итог (2026-09-27):** `chatFolders.solid.tsx`, `editFolder.solid.tsx` (+ `editFolderInput` —
поле `InputFieldTsx` без `InputFieldEmoji`, О-28), `editFolderShared.ts` (+ `getEditFolderInitArgs`,
`FOLDER_PFLAGS`), вкладки `AppChatFoldersTab`/`AppEditFolderTab`/`AppIncludedChatsTab` одним блоком
в конце `tabs.ts`. Поправки к постановке:
- **Выбор чатов (`includedChats`) взят из задачи 25**: без него «Add Chats»/«Remove Chats»
  мертвы (Solid-вкладка не открывает React-`FolderChatsPicker`). В 25 остаётся `sharedFolder` +
  `inviteLink`; `FolderChatsPicker.tsx` снесён здесь.
- Бэкенд сверен: О-19 (нет ручки порядка — нет `Sortable`, ручки строки и строки «Все чаты»),
  О-20, О-21 (нет `exclude_archived` — нет кнопок Archived в редакторе и выборе), О-22 (лимиты не
  отдаются; отказ сервера `folders limit reached` — существующий тост с ключом tweb `LimitReached`
  вместо `showLimitPopup`, попап 2C не трогался). `bots` на бэкенде есть — категория портирована.
- `foldersManager.ts` чинился шире плана: кроме `bots` провод слал/читал `include_chats`/
  `exclude_chats`, а бэкенд с 8c84b326 — `include_peers`/`exclude_peers`: списки чатов папок не
  сохранялись и приходили пустыми. Пины — `foldersManager.test.ts`.
- Меню папки и кнопка колонки папок открывают вкладки хостом слайдера НАД КОЛОНКОЙ
  (`Sidebar.tsx::openColumnTab`), а не через экран настроек: у tweb это `appSidebarLeft.createTab`,
  «назад» возвращает к чатам. Deep-open настроек (`settingsSub`/`initialSub`) снят как мёртвый.
- Ссылки: список/создание/копирование/удаление есть; клик по строке и отказ «нечем делиться» —
  до `AppSharedFolderTab` задачи 25 (последний — тостом нашего `Folder.Share.Empty`).
- Порт партиала `_usernames.scss` (строки ссылок); `mountSolidComponent` в `wrapSolidComponent.ts`.
- Заставки папок — `div.sticker-container` с `loadAnimationFromURLManually`; отказ загрузки не
  валит открытие вкладки (статичный кадр). React-пин `Folders_1` в `lottieStickerBox.test.tsx` снят.
- `SettingsView.navLayer.test.tsx` переведён на под-экран «Стикеры и эмодзи» (задача 15, 2C) —
  при её переезде перевести снова.
- ~~Не сделано (вне объёма, отмечено): правило папки для `bots` в `core/folderFilter.ts::matchesFolder`
  (у нашей `FolderMatchable` нет `isBot`) — папка «только боты» сохраняется, но список её пуст.~~
  Закрыто веткой `fix/folder-filter-bots`: `FolderMatchable.isBot` из `pFlags.bot` карточки пира
  (tweb `filters.ts:258-261`), заодно исключение упоминаний в `excludeMuted` (`:240`).

### Задача 25: «Папки» — выбор чатов и ссылка — ✅ сделано (PR feat/w2d-shared-folder)

**Порт:** `includedChats.tsx` (252) → `includedChats.solid.tsx` (вкладка :615, заголовок по `type`)
на `AppSelectPeers`; `sharedFolder.tsx` (306) + `inviteLink.ts` → `sharedFolder.solid.tsx`,
`inviteLink.ts` (вкладка :626, Eventable) — выбор чатов ссылки требует `editExportedInvite`
(BLOCKED, О-23): до ручки вкладка ссылки только показывает/копирует/удаляет ссылку.
**Зависимости:** 16, 24. **Врезка:** `tabs.ts`, `editFolder.solid.tsx`; удалить
`folders/FolderChatsPicker.tsx`. (`FolderInvitePopup.tsx` — попап, 2C.)

**Итог (2026-09-27):** выбор чатов папки и снос `FolderChatsPicker.tsx` ушли в задачу 24; здесь —
`sidebarLeft/tabs/sharedFolder.solid.tsx`, `inviteLink.ts` (класс-виджет), `helpers/dom/shake.ts`,
вкладка `AppSharedFolderTab` (Eventable, событие `delete`) одним блоком в конце `tabs.ts`, партиал
`_inviteLink.scss` и `.cant-select` (tweb `base.scss:1869`), ассет `Folders_Shared.json` (tweb
дословно) + PNG-фолбэк генератором `generate-tgs-thumbnails.mjs`. Поправки к постановке:
- Бэкенд сверен: у ссылок папки есть `POST/GET /me/folders/{id}/invites`, `DELETE
  /me/folder_invites/{slug}`, превью и вступление — ручки правки (`editExportedInvite`) нет, О-23
  в силе. Список чатов вкладка рисует, как оригинал (выбранные — чаты ссылки), но выбор не
  меняется: строки выбора «трясутся» (`shake`), галки «Save», события `edit` и подтверждения на
  закрытии нет. Расшариваемы только публичные группы/каналы (`usecase/folders.shareableChats`) —
  `canSelectPeer` = `isPublic`, права `invite_links` не учитываются.
- Редактор папки (`editFolder.solid.tsx`) открывает вкладку, как tweb `openChatlistInvite`: клик
  по строке ссылки, новая ссылка (`.finally` → строка), отказ `ErrNoShareable` — вкладка без
  ссылки (`SharedFolder.NoChats`). Наш тост `Folder.Share.Empty` снят вместе с ключом;
  `inviteUrl` переехал в `editFolderShared.ts`.
- Кнопки «Share Link» под ссылкой нет: `shareUrlToPeers` — попап над `pickUser`/`forward` (2C,
  задачи 16/24 плана 2C); ветка по умолчанию `InviteLink` не портирована (расхождение 1 в шапке).
- Ключи tweb +13 всем пяти словарям; `langpack.gen.json` пересчитан (версия 20).

### Задача 26: «Динамики и камера» (2C)

**Порт:** `speakersAndCamera.tsx` (121) + `call/{callDeviceSettings,microphoneLevelMeter,
cameraSection}.tsx` → Solid; вкладка :181. Имена секций `CallSettings.OutputSection/InputSection`,
`CallDeviceRow` → `showOutputDevicePopup` (`rtmp/outputDevicePopup.tsx`) — **2C**; AcceptCalls —
BLOCKED (`changeAuthorizationSettings`, О-8): секции нет, у нас сейчас локальный `acceptCalls` —
снять вместе с экраном (мёртвая опция), если его не читает звонковый код; иначе — оставить
чтение, обосновать.
**Зависимости:** 2C. **Врезка:** `tabs.ts`, `SettingsView.tsx`, `SettingsSubScreen.tsx`; удалить
`settings/SpeakersCamera.tsx` + `.module.scss`.

### Задача 27: «Редактировать профиль» (2C)

**Порт:** `editProfile.tsx` (436) → `sidebarLeft/tabs/editProfile.solid.tsx` (вкладка :93,
`noSame`, префетч `getEditProfileInitArgs`); `avatarEdit.ts` (417) + `editPeer.ts` (123) → классы
(крошилка аватара у tweb — медиаредактор `getFileAndOpenEditor`; наш редактор — React
`MediaEditor.tsx`, волна 4: шаг 1 задачи — найти императивный вход в него без React-импорта во
вкладке; нет — О-24 и временно без видео-аватара); поля `InputFieldTsx` (лимиты 70/64/`bioMaxLength`),
строка дня рождения только без даты → `showBirthdayPopup` (**2C**), `UsernameSection`,
`UsernamesSection`, личный канал → `showPickUserPopup` (**2C**, ручка `updatePersonalChannel` —
выяснить; нет — О-25), ChatAutomation — SKIP.
**Зависимости:** 5, 2C. **Врезка:** `tabs.ts`, `SettingsView.tsx`; удалить `settings/EditProfile.tsx`
+ `.module.scss`; `AvatarCropper.tsx`, `BirthdayModal.tsx` — по задаче 30.

## Финал

### Задача 28: корень настроек `AppSettingsTab` и снос шва — ✅ сделано (PR feat/2d-28-settings-root-tab)

**Порт:** `settings.tsx` (451) → `sidebarLeft/tabs/settings.solid.tsx`; вкладка :188. Шапка: ⋮ с
`edit` → `AppEditProfileTab`, `qr` → `showMyQrCodePopup`, `logout` (danger) → `showLogOutPopup`
(**2C**); кнопка поиска — нет поиска по настройкам (34f417d12, волна 4) → не рисуется, О-26;
`PeerProfile` (`peerProfile.solid.tsx`, `isDialog: false`, `setCollapsedOn`) вместо нашей карточки;
секция `div.profile-buttons` — 7 строк `makeSubTabConfig` (ключи tweb: `AccountSettings.PrivacyAndSecurity`,
`AccountSettings.Filters`) + Devices (`titleRight` счётчик, перечитывание на `destroy`) + Language +
Shortcuts; Premium-секция — `showPremiumPopup`/`showStarsPopup`/`showSendGiftPicker` (**2C**), гейт
`premiumBlocked`. Наши лишние строки «Ночной режим», карточка контактов, `EmojiStatus.Set`,
`PremiumManage` — у tweb их в корне нет: удалить (продуктовый вопрос — вынести пользователю
до задачи, ответ — в коммит).
> **Заметка:** состав строк корня уже выровнен PR `fix/settings-root-items` — «Ночной режим»,
> `EmojiStatus.Set` и подзаголовок Premium сняты, «Мои звёзды» добавлены, вход в выбор статуса —
> кнопка `.sidebar-emoji-status` в шапке колонки; порт переносит этот состав (пин
> `SettingsView.rootItems.test.tsx`) и остаток — карточку контактов, `PremiumManage`, ключи tweb.

**Снос шва** (`settings-rows.md` § «Ключевой шов»): слайдер переезжает на колоночный
`.sidebar-slider` (`Sidebar.tsx:350`), вкладка №0 — `.item-main` React-колонки (узлом владеет
React, вкладками — слайдер; правило шва § 7 спеки); `Sidebar.tsx` открывает корень
`slider.createTab(AppSettingsTab).open()` (порт `sidebarLeft/index.ts:765`, `:841`); признак
`has-open-tabs` пишет слайдер (`onTabsCountChange` → `onSomethingOpenInsideChange` →
`setOpenTabsLeftSidebar`, `index.ts:547-569`, `:652`), React-запись
`Sidebar.tsx:228` для настроек снимается (писатель один). Удаляются: `SettingsView.tsx` (+ тесты,
`.module.scss`), `SettingsSubScreen.tsx` (+ `settingsSubScreen.reachable.test.ts`), ветка
`'settings'` в `SidebarScreens.tsx`, заглушка и `destroy()` хоста, `settingsSliderHost.module.scss`
(хост сводится к доступу к колоночному слайдеру или исчезает — как `appSidebarLeft` в tweb).
**Мутации:** оставить React-запись `has-open-tabs` — тест «один писатель» краснеет; убрать
`onCloseAfterTimeout → dispose` — пин «остров снят» краснеет.
**Зависимости:** 7–27, 2C. **Готово когда:** `git grep -n "SettingsView\|SettingsSubScreen" web-client/src` пуст;
корень на стенде: въезд из колонки, «назад» в чатлист с переходом, Esc; числа в коммит.

**Итог (2026-09-30).** Взята раньше своих зависимостей 15/20–23/26/27 и 2C: колоночный слайдер —
предусловие этапа 0а волны 7 (`2026-09-30-wave-7-shell-sidebars.md`). Поэтому два временных моста
вместо ожидания:
- **React-экраны вкладками** (`sidebarLeft/reactScreenTab.tsx`): «Конфиденциальность» (23),
  «Стикеры и эмодзи» (15), «Динамики и камера» (26), «Редактировать профиль» (27) объявлены в
  `solidJsTabs/tabs.ts` классами tweb (`AppPrivacyAndSecurityTab`, `AppStickersAndEmojiTab`,
  `AppSpeakersAndCameraTab`, `AppEditProfileTab`) на `scaffoldReactScreenTab` — содержимое
  React-корень кита, въезд/выход/Esc — от слайдера. Задача порта меняет одну форму объявления и
  удаляет React-экран. Это обратный мост, которого план не заводил (правило «листья раньше
  родителей»): он временный, с номером у каждой строки;
- **React-попапы** (`sidebarLeft/settingsPopups.tsx`): `showPremiumPopup`/`showStarsPopup`/
  `showMyQrCodePopup`/`showLogOutPopup`/`showSendGiftPicker` именами tweb поверх `popupStore`,
  ВРЕМЕННО до 2C-18/19/17/13/20. Выход — без подтверждения (как пункт бургера, до 2C-13), подарок
  — без выбора получателя (до 2C-20, как и до переезда).

Шов снят: `sidebarLeft/columnSlider.ts` — `SidebarSlider` на `#column-left` (`'left'`, вкладка
№0 — `.item-main`, `item-secondary` у вкладок по tweb `index.ts:1743-1753`); `Sidebar.tsx`
заводит его слоем раскладки и снимает на размонтировании, `has-open-tabs` пишет по
`onTabsCountChange`. Открыть вкладку из React-колонки — `getColumnSlider().createTab(AppXxxTab)
.open(…)` (изнутри вкладки — `tab.slider.createTab`). Удалены `SettingsView.tsx` (+ scss, 3 теста),
`SettingsSubScreen.tsx` (+ тест), ветка `'settings'` `SidebarScreens.tsx`, хост со слоем и
заглушкой (`settingsSliderHost.module.scss`, `onTabsEmpty`, wiring-тест), `2fa/sliceTabsUntilSettings.ts`
(мастер режет `sliceTabsUntilTab(AppSettingsTab)` дословно), срез О-12 у код-пароля (до
`AppPrivacyAndSecurityTab` дословно). Продуктовый пункт «всё к tweb»: карточка телефона/имени
снята (их показывает `PeerProfile`), экран `PremiumManage` снят вместе с
`usePremiumSubscription`, `premium.getSubscription`/`cancelSubscription` и 10 ключами
(ручки `/me/premium/subscription`, `/me/premium/cancel` на бэкенде остались без клиента);
«Ночной режим» и `EmojiStatus.Set` сняты раньше (`fix/settings-root-items`). Ключи строк —
tweb `AccountSettings.PrivacyAndSecurity`/`AccountSettings.Filters`. Новые «Отложено» — О-41, О-42.

### Задача 29: `DialogElement` на `attachRowController`, строка ссылок — `renderSearchWebPageRow` — ✅ сделано (PR feat/w2d-dialog-row)

**Порт:** `rowTsxController.tsx` (398) → `components/rowTsxController.solid.tsx`
(`attachRowController`, `createRowSortableIcon`); `components/dialogRow.ts:145` — `class
DialogElement` перестаёт наследовать `Row` и вызывает `attachRowController(this, {…})`, как
`appDialogsManager.ts:321`; строка ссылки shared media — `searchWebPageRow.tsx` (63) →
`searchWebPageRow.solid.tsx`, вызов из `appSearchSuper.ts` как tweb `:1398`.
**Координация:** `dialogRow.ts`/`appSearchSuper.ts` — зона программ глобального поиска и shared
media; брать задачу, когда в них нет открытых веток (сверить `git log`), и прогнать их тесты целиком.
**Мутация:** не ставить дескрипторы на прототип — `DialogElement.title` `undefined`, тесты
`dialogRow.test.ts` краснеют. **Зависимости:** 0.

**Итог (2026-09-27):** `components/rowTsxController.solid.tsx` — порт в объёме `DialogElement`
(опции и части, которые читает строка и её потребители `sortedUserList.ts`/`appSelectPeers.solid.tsx`;
непортированное перечислено в шапке: `icon`, `*LangKey`, поля-чекбоксы, `navigationTab`,
`buttonRight`/`rightContent`, `contextMenu`, `ensure*`, `toggleDisability`, `makeSortable`,
`createRowSortableIcon` — у tweb их тоже никто, кроме `DialogElement`, не передаёт, а сортируемая
иконка нужна только главному списку, который у нас React). `DialogElement` — `interface … extends
RowTsxController` + `attachRowController(this, {…, middleware})`, `destroy()` зовёт `dispose()`
(HEAD `:493-497`). Порядок детей строки теперь HEAD (`rowTsx.tsx:247-257`: заголовок → подпись →
медиа, `no-wrap` на обеих частях строки заголовка) — дампы `15-right-*` сняты со старой базы; вид
держит `_row.scss` (`order`/грид). `searchWebPageRow.solid.tsx` — дословно, `onclick` →
`data-anchor-action` (расхождение 23 `appSearchSuper.ts`). **`row.ts` удалён целиком** (+ `row.test.ts`,
осиротевший `setRowIconBackground`); тесты i18n (`i18nContract`, `langPack.live`) переведены на
`attachRowController`/`Button`; предусловие задачи 31 по `row.ts` закрыто. Граница «контроллер
импортирует только `dialogRow.ts`» — пин (порт tweb `rowTsxSafeMigrations.test.ts`). Главный список
чатов (`ChatListItem.tsx`, виртуальный список) строку не использует — его не задевает; создание
строки поиска/участников в happy-dom: 300 строк ≈ 59 → 146 мс (один `createRoot` + `Row` на строку,
как у tweb).

### Задача 30: потребители кита и общих React-файлов `settings/` вне настроек (развилка)

По решению пользователя `settings/kit.tsx` удаляется; у него 22 потребителя вне настроек
(поправка 9), у `AvatarCropper`/`BirthdayModal`/`ConfirmDialog` — 3/1/6. Что делает задача:

| Потребитель | Куда | Можно в 2D? |
|---|---|---|
| `ConfirmDialog` в `useChatPopups`, `MediaEditor`, `group/screens/{InviteLinkScreens,DiscussionScreen}`, `PinnedMessagesScreen` | прямой `confirmationPopup` (он и есть у tweb) — React-вызывающий зовёт функцию | **да**, S |
| `AvatarCropper` в `NewGroupFlow`, `EditContactView`, `GroupEditFlow` | класс `AvatarEdit` задачи 27 через `useImperativeIsland` | да, после 27 |
| `BirthdayModal` в `EditContactView` | `showBirthdayPopup` | после 2C |
| кит в `group/**` (11), `userInfo/RightsEditor.tsx`, `EditContactView.tsx` | вкладки правой колонки tweb `sidebarRight/tabs/*` (`editChat`, `chatType`, `chatReactions`, `groupPermissions`, `chatMembers`, `userPermissions`, `editContact`, …) на тех же примитивах 0–2 | **развилка**: отдельная волна правой колонки (спека § 8, волна 2 — «и правой панели») или расширение 2D |
| кит/`usePopupTransition` в `Premium*`, `QrModal`, `EmojiStatusPicker`, `stars/*` | попапы 2C (`premium`, `myQrCode`, `emojiStatusPicker`, `stars`, `sendGift`, …) | после 2C |

**Решение принято пользователем 2026-09-26 — вариант «отдельная волна»:** первые две строки
(`ConfirmDialog`, `AvatarCropper`) — в 2D, групповые экраны и прочие вкладки правой колонки —
отдельной волной правой колонки, попапы — 2C; кит
**не переносится** в другое место (это была бы вторая копия под новым именем, DoD 14), а задача 31
ждёт, пока `git grep -n "settings/kit" web-client/src` не опустеет.

### Задача 31: снос `row.ts`, `settingSection.ts`, `radioForm.ts`, `kit.tsx`, `SidebarSection`

**Предусловия:** `git grep -nE "components/row'|@components/row\b" web-client/src` пуст (задачи 8,
9, 29); `git grep -n "settingSection" web-client/src` пуст (9); `RadioFormFromRows`/`radioForm` без
потребителей (8); `git grep -n "settings/kit\|SidebarSection" web-client/src` пуст (28, 30).
**Удалить:** `components/row.ts` + `row.test.ts`, `components/settingSection.ts` + тест,
`components/radioForm.ts` (+ тест, если без потребителей), `components/settings/` целиком,
`shared/ui/SidebarSection/`. Докблоки, ссылающиеся на них (`rowTsx.solid.tsx`, `section.solid.tsx`,
`buttonTsx.solid.tsx` «второй Button/Row»), — переписать.
**Готово когда:** `git grep -lE "from 'react'" -- 'web-client/src/components/settings/*'` — каталога
нет; число React-`.tsx` уменьшилось на размер волны (см. DoD).

---

## Отложено — с предметом, а не «потом посмотрим» (DoD 13)

| № | Что | Почему отложено | Что разблокирует |
|---|---|---|---|
| О-1 | Строка «All Accounts» и подпись `MultiAccount.ShowNotificationsFromCaption` (`notifications.tsx:431`, `:450-462`) | мультиаккаунт у нас — одна сессия на браузер с перезагрузкой (`core/auth/accounts.ts:1-5`); у tweb — аккаунты во вкладках (`accountNumber`, `appNotificationsManager.ts:449-475`) | уведомления с неактивных аккаунтов; модель «аккаунт на вкладку» — отдельная программа |
| О-2 | `useAppSettings` переводит пути tweb в плоские ключи zustand | стор настроек читают 38 потребителей, включая ленту (спека § 5 — уезжает последним) | стор настроек на Solid с формой `StateSettings` tweb |
| О-3 | Секция «Stories» уведомлений (`:112-235`) | нет `stories_muted`/`stories_hide_sender` в `/me/notify_settings` (`notify_handler.go:27-47`) | уведомления о новых историях |
| О-4 | Секция «Reactions» (`:237-347`) | нет `account.get/setReactionsNotifySettings` | уведомления о реакциях |
| О-5 | «Contact joined» (`:349-377`) | нет `get/setContactSignUpNotification` | уведомление о новом контакте |
| О-6 | «Cached video stream chunks» (`storageQuota.tsx:374-382`) и их доля в «Clear All» | корзин потоковых чанков у нас нет (выяснено задачей 7): DNP-стрим собирает SW из Noise-канала без CacheStorage (`public/sw.js`, `/dnp-stream/`), DNP-OFF — токен-URL мимо кэша | кэш потоковых чанков видео (HLS/стрим в CacheStorage) |
| О-7 | TTL сессий (`activeSessions.tsx:238-292`, `:392`) | `authorization_ttl_days` всегда 0, нет `setAuthorizationTTL` (`backend/internal/domain/mtaccount.go:105-122`) | автозавершение неактивных сессий |
| О-8 | `changeAuthorizationSettings` — AcceptSecretChats/AcceptIncomingCalls (`session.tsx:112-143`, `speakersAndCamera.tsx`) | нет ручки и колонок | запрет звонков/секретных чатов на устройстве |
| О-9 | Переименование устройства (`activeSessions.tsx:211-236`) | сервер подставляет имя из UA (`backend/internal/usecase/auth/auth.go:291-294`) | своё имя устройства |
| О-10 | Строка Send с `InlineSelect` (если нет настройки отправки) | выяснить в задаче 10 | Ctrl+Enter для отправки |
| О-11 | Серверные обои (`account.getWallPapers`, `uploadWallPaper`, `saveWallPaper`; `background.tsx:404-416`, `:546-554`) | ручек обоев на бэкенде нет вовсе (выяснено задачей 12): сетка — клиентские `WALLPAPER_PRESETS`, своё фото — общая `/media/upload` + `customWallpaperMediaId`, список загруженных обоев не хранится | сетка обоев 1:1, обои по темам, загруженные обои в выдаче |
| ~~О-12~~ | ~~`sliceTabsUntilTab(AppPrivacyAndSecurityTab)` у код-пароля~~ | **снято задачей 28**: класс `AppPrivacyAndSecurityTab` есть (мост до 23), срез дословный | — |
| О-13 | Подтверждение почты 2FA кодом (`2fa/emailConfirmation.tsx`, ветка `EMAIL_UNCONFIRMED` в `email.tsx:74-83` и `privacyAndSecurity.tsx:261-268`), «Забыли пароль» (`forgotPasswordLink.ts`), снятие почты пропуском («Skip» шлёт `email: ''`) | нет unconfirmed pattern (`authManager.ts:118-122`, `:468-475`); пустая почта у `POST /me/password` = «оставить прежнюю» (`usecase/auth/password.go::SetPassword`) | восстановление пароля, снятие почты |
| О-14 | Порядок стикерсетов (`reorderStickerSets`) | выяснить в задаче 15 | сортировка наборов |
| О-15 | Платные сообщения (`privacy/messages/paidSettingsSection.tsx`) | `privacyKeyMessages` — наш конструктор, звёзд за сообщения нет | «кто может писать» 1:1 |
| О-16 | Правила Gifts, SavedMusic, P2P | ключей нет (`backend/internal/domain/privacy.go:9-20`) | три вкладки правил |
| О-17 | Исключения-чаты в правилах | `PrivacyRuleWire` без участников чатов (`privacyManager.ts:33-40`) | исключения «участники чата» |
| О-18 | Web sessions, Login email, NewChats/ArchiveAndMute, Sensitive, Payments | нет `webAuthorizations`, login email, `globalPrivacySettings`, `contentSettings`, очистки платёжных данных | хаб приватности целиком |
| О-19 | Порядок папок (`updateDialogFiltersOrder`) | поле `pos` есть, ручки перестановки нет | перетаскивание папок |
| О-20 | Рекомендованные папки | нет `getSuggestedDialogFilters` | секция FilterRecommended |
| О-21 | `exclude_archived`, закреплённые в папке | нет на проводе | категории редактора 1:1 |
| О-22 | Лимиты `folders`/`folderPeers`/`chatlistInvites` + `PopupLimit` | бэкенд не отдаёт лимиты (`MaxFoldersPerUser = 10` зашит, `domain/folder.go:12`); попап — 2C. До них отказ сервера по числу папок — тост `LimitReached` (задача 24) | апселл лимитов |
| О-23 | Выбор чатов ссылки папки (`editExportedInvite`): галка «Save», событие `edit`, подтверждение на закрытии (`sharedFolder.tsx:86-89`, `:103-112`, `:258-272`) | нет ручки правки ссылки (есть создание/список/отзыв — `router.go`, `/me/folders/{id}/invites`); вкладка ссылки рисует чаты ссылки, выбор «трясётся» (задача 25) | shared folder 1:1 |
| О-24 | Видео-аватар и крошилка через медиаредактор | редактор — React (`MediaEditor.tsx`), волна 4 | `AvatarEdit` 1:1 |
| О-25 | Личный канал в профиле | выяснить в задаче 27 (`updatePersonalChannel`) | секция PersonalChannel |
| О-26 | Поиск по настройкам и меню шапки из 34f417d12 (`SliderSuperTab.shown`, NavigationItem `settings-search`, `tg://settings/…`) | волна 4 дельты; нужен индекс вкладок, который строится после переезда всех вкладок | поиск по настройкам |
| О-27 | Попап настроек при свёрнутой колонке (`SettingsSliderPopup`, `createTab`-override `sidebarLeft/index.ts:1730-1741`) | предмет появился задачей 28 (колоночный слайдер `columnSlider.ts`), порт не сделан — вкладка открывается в развёрнутой колонке (`has-open-tabs` раскрывает свёрнутую) | настройки поверх чата на узкой колонке |
| ~~О-29~~ | ~~Модель отступов `MediaHeader` HEAD (`gap: .5rem`) и под неё `authFlow`~~ | **снято** (ветка `fix/w2d-mediaheader-rtl-overlay`): `mediaHeader.module.scss` дословно с HEAD, `auth/AuthFlow.module.scss` `.qrContainer`, карточки входа — `h1` и `class="secondary"`; отступы экрана входа = tweb HEAD, замеры — `docs/tweb/dom/auth.md` §8.4 | — |
| О-30 | Быстрая реакция: отметка на открытии (`getQuickReaction`, `quickReaction.tsx:22-30`), запись выбора (`setDefaultReaction`, `:48-51`), превью в строке «Стикеров» и перезапрос по `quick_reaction` (`stickersAndEmoji.tsx:30-35`, `:108-110`), подъём быстрой реакции в панели/ховере (`unshiftQuickReaction`) | нет `config.reactions_default`, `messages.setDefaultReaction`, события `quick_reaction` — ни на бэке, ни на проводе (`web-client/backlogs/frontend/quick-reaction-default.md`) | поле «быстрая реакция» у пользователя + ручка чтения/записи |
| О-31 | ~~Права отправки в селекторе пиров: `chatRightsActions`/`filterByRights`~~ — **снято** (ветка `fix/contacts-share-pickers`): фильтр `core/peers/filterByRights.ts` (порт `filterByRights` :827-834 + `canSendToUser` + `resolveChatRightsActions` из `popups/forward.tsx`), опция `chatRightsActions` в `appSelectPeers.solid.tsx` (диалоги :782-787, выдача поиска :878-883) и в React `ForwardPicker`; бэкенд отдаёт `creator`/`admin_rights`/`default_banned_rights` в векторе `chats` списка диалогов (`DialogRecord.ToChannel`). **Остаток**: звёзды за сообщение (`starsAmountByPeer`, бейдж), замок премиума (`OnlyPremiumCanMessage`), `appSelectPeers.tsx:321-365`, `:443-457` | нет `getRequirementToContact` и платы звёздами за личное сообщение | звёзды за личное сообщение + требование премиума |
| О-32 | `AppSelectPeers.convertPeerTypes` и типы `isBot`/`isRegularUser`/`isBroadcast` (`appSelectPeers.tsx:606-618`) | зовёт только `requestPeer` ботов (`keyboardButtonRequestPeer`) — кнопок ботов нет | выбор пира по кнопке бота |
| О-33 | Категории в выборе участников (`extraCategories`, «мини-приложения» в исключениях приватности, `addMembers.tsx:98-136`, `privacySection.tsx:204-209`) | нет мини-приложений и такого правила приватности | исключение «мини-приложения» |
| О-34 | Премиум-гейты правил приватности: замок голосовых (`premiumOnly`/`premiumCaption`/`premiumError`, `privacy/voices.tsx:18-22`, `privacySection.tsx:112-132`, `:254-282`), кнопка «Premium: last seen» (`privacy/lastSeen.tsx:75-84`), «Контакты и Premium» и замки в «Сообщениях» (`privacy/messages/optionsSection.tsx`) | сервер не требует премиум ни для одного правила и не пропускает Premium при «Мои контакты»; попап премиума — React (2C) | премиум-проверки правил на сервере + Solid `showPremiumPopup` |
| О-35 | «Публичное фото» профиля (`privacy/profilePhoto.tsx:19-156`) | нет `fallback_photo` в модели и на проводе, нет загрузки/снятия запасного фото | секция PublicPhoto |
| О-36 | Ссылка `t.me/+<номер>` в подписи «Номера телефона» (`privacy/phoneNumber.tsx:19-30`, `PrivacyPhoneInfo4`, `anchorCopy`) | публичной ссылки на чат по номеру у нас нет | подпись номера 1:1 |
| О-37 | Increase Contrast в «Общих» (`generalSettings.tsx:69-75`): настройка `increaseContrast`, класс `html.high-contrast`, прижатие контраста цветов и `*-button-color` (`themeController.ts:228-231`, `:332`, `:576-599`), `scss/partials/_accessibility.scss` | часть a11y-коммита 472e3e76b, у нас не портирована деривация контраста — тумблер ничего бы не менял (сверить номер с параллельными ветками) | режим повышенного контраста |
| О-38 | Карусель облачных тем `ChatThemesPicker` и ряд акцентов `AccentPickerRow` в «Общих» (`generalSettings.tsx:158-176`, `:194-267`, `components/chatThemesPicker.tsx`) | нет `account.getThemes` на бэкенде и модели `settings.themes[]` (облачная тема/акцент-пресет на базу: `accent_color`, `message_colors`, обои — `applyNewTheme`/`applyAccentPreset`/`resetActiveTheme`); глобальной акцент-деривации нет (`deriveChatThemeVars` — только колонка чата с темой), пресетов акцента `getAccentPresetsForBase` нет (сверить номер с параллельными ветками) | тема приложения из облачных тем и акцентов, обои по темам (вместе с О-11) |
| О-39 | Тема чата у фона (`chat/bubbles/chatBackground.solid.tsx`): встроенная `ChatTheme` (`chatThemes.ts`) вместо облачной `Theme` из `appState.accountThemes` (`chat.ts:517-523`, `chatBackground.tsx:141-157`); публикует её оболочка (`App.tsx` по `useShellTheme`), а не инстанс `Chat.publishBackground` (`chat.ts:380-433`) — поэтому нет `deferReveal`/`revealPreparedBackground` (флип обоев в одном кадре с монтированием баблов, `chat.ts:436-592`), `onCachedStatus` и подсветки в контейнер чата (`:421-433`) | у ленты нет инстанса `Chat` (его роль исполняет React `Chat.tsx`), облачных тем нет (О-38) (сверить номер с параллельными ветками) | `Chat` классом (волна 8 Solid-миграции) + облачные темы |
| О-40 | Файл обоев фона (`core/chat/chatBackgroundStore.ts`): без корзины `cachedBackgrounds`, общих object URL и SW-скоупа `backgrounds` (`lib/chatBackgroundStore.ts:40-148`); своё фото — обычное медиа (`cachedMediaUrl`/`ensureMediaUrl`), под замком без адреса в зеркале — обои темы | серверных обоев нет (О-11), медиа-конвейер без ключа недоступен (сверить номер с параллельными ветками) | серверные обои (вместе с О-11) |
| О-41 | Гейт `premiumBlocked` Premium-секции корня (`settings.tsx:314-318`, `apiManagerProxy.isPremiumPurchaseBlocked()`) | источника «покупка Premium запрещена» у нас нет — секция видна всегда (задача 28, расхождение 5 шапки `settings.solid.tsx`) | запрет покупки Premium (регион/платформа) |
| О-42 | Строка TON (`useStars(true)`, `hasTonTransactions`, `settings.tsx:430-437`) и бизнес-бот в счётчике «Устройств» (`getConnectedBot`, `chat_automation_update`, `:279-298`) | нет баланса/транзакций TON и подключённых бизнес-ботов на бэкенде (задача 28, расхождения 5–6) | TON-звёзды; бизнес-боты |

## Оценка объёма

| Задача | Строк оригинала | Размер |
|---|---|---|
| 0 Row | ~250 дельты из 526 + 47 | M |
| 1 Section + scss + SidebarSection | ~60 + ~40 | S |
| 2 Поля | 61 + 49 + 176 + 45 | M |
| 3 Каркас (пины, кит, стенд) | — | M (риск) |
| 4 useAppSettings | ~50 | S |
| 5 Контролы | 191 + 302 + 29 + 13 + 95 + перенос 211 | L |
| 6 Пилот | ~330 из 571 | M |
| 7 Данные и память | ~600 | L |
| 8 Язык | ~60 дельты | S |
| 9 Устройства + сессия | 401 + 157 + 29 | L |
| 10 Хоткеи | 292 | M |
| 11 Энергосбережение | 346 + 122 | M |
| 12 Обои + цвет | ~250 + 168 + 370 | L |
| 13 Общие | 359 + 356 | L |
| 14 Быстрая реакция | 64 + 20 | S |
| 15 Стикеры | 270 | M |
| 16 AppSelectPeers | ~900 из 1453 + 167 | **L+** |
| 17 Правила приватности | 393 + ~500 | L |
| 18 Код-пароль | ~600 | L |
| 19 2FA | ~900 | L |
| 20 Автоудаление | ~300 | M |
| 21 Passkeys | 131 | S |
| 22 Заблокированные | 169 | M |
| 23 Хаб приватности | ~450 из 700 | L |
| 24 Папки: список + редактор | 433 + 733 | L |
| 25 Папки: чаты + ссылка | 252 + 306 + 132 | L |
| 26 Динамики | 121 + ~400 | M |
| 27 Профиль | 436 + 540 | L |
| 28 Корень + шов | 451 + шов | **L** (риск) |
| 29 DialogElement + ссылки | 398 + 63 | M |
| 30 Потребители вне настроек | — | M…L (по развилке) |
| 31 Снос | — | S |

## DoD программы (перед мержем задачи 28 и финальной 31)

Спека § 9, пункты 9–14, плюс предметно:

- [ ] `vite build` живой; `vitest run`, `tsc --noEmit`, `oxlint --type-aware` зелёные из `web-client/`.
- [ ] **Ноль React в настройках:** каталога `web-client/src/components/settings/` нет;
  `git grep -lE "from 'react'" -- 'web-client/src/components/sidebarLeft/tabs/*'` пуст;
  `git grep -n "SettingsView\|SettingsSubScreen\|settings/kit\|SidebarSection" web-client/src` пуст
  (последнее — после задачи 30; до неё пункт открыт и назван, а не засчитан).
- [ ] **React убыл:** число `.tsx` с `from 'react'` (на 2026-09-26 — 186 без тестов) уменьшилось на
  число удалённых экранов (29 файлов настроек/папок + кит + `SidebarSection`); новых React-файлов нет.
- [ ] Стенд: чеклист `docs/tweb/settings-rows.md` «Проверка после порта» прощёлкан на каждом
  экране; числа перехода и шапки — в коммитах задач 3 и 28.
- [ ] `dom-parity` по дампам § 7 референса — расхождения только объявленные.
- [ ] `node tools/tweb-parity/ownership-audit.mjs` — новых находок в `Sidebar.tsx` нет (мост задачи 28).
- [ ] `components/row.ts`, `settingSection.ts` удалены; `git grep -n "ОТСТУПЛЕНИЕ" -- web-client/src/components/rowFieldClasses.ts` пуст.
- [ ] Секции «у нас» в `docs/tweb/settings-rows.md` § 8 и `left-sidebar.md` ч. 8 § 3 обновлены в
  тех же PR; адреса tweb в `left-sidebar.md` ч. 2, которые трогали задачи, — по `812502980`.
