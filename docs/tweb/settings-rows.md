# Строки и экраны настроек tweb: `RowTsx`, `Section`, вкладки левой колонки

Снято 2026-09-26 по исходникам tweb **`812502980`** (`/Users/denisurevic/Documents/tweb`); где
сказано «старая база» — `e52b5d931` (`/Users/denisurevic/Documents/tweb-e52b5d931`), по ней
портировано всё, что у нас уже есть. Solid у tweb — форк (`src/vendor/solid`, см.
`docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 6), у нас стоковый.

Этот док — референс волны **2D** (`delta/README.md`, «Волна 2»): строки на Solid `RowTsx`
(ef41b29db «Migrate legacy rows to Solid RowTsx», 183 файла) и экраны настроек левой колонки
на них. План — [`../superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`](../superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md).
Не дублирует: каркас слайдера и дерево вкладок — [`left-sidebar.md`](left-sidebar.md) ч. 2
и ч. 8 § 3 (адреса там по старой базе); попапы — [`popups.md`](popups.md) (класс
`PopupElement` удалён в 2556fc949, это волна 2C).

**Главное — семь пунктов.**

1. В tweb `812502980` **нет** `components/row.ts` и `components/settingSection.ts`: строки —
   Solid `Row` (`components/rowTsx.tsx`), секции — Solid `Section` (`components/section.tsx`).
   Императивный остаток — `attachRowController` (`components/rowTsxController.tsx`), им живёт
   только строка чатлиста `DialogElement` (`lib/appDialogsManager.ts:321`).
2. Подпись секции (`caption`) по умолчанию лежит **ВНЕ карточки** — ребёнком
   `.sidebar-left-section-container` после `.sidebar-left-section` (`section.tsx:112`).
   Внутрь её кладёт только `captionOld` (`:109`), над карточку — `captionTop` (`:90`). Так было и
   в старой базе (`settingSection.ts:72-79` старой базы: `container.append(el)`).
3. Все экраны настроек — **Solid-компоненты** за `scaffoldSolidJSTab(Eventable)`
   (`solidJsTabs/tabs.ts`), классический `SliderSuperTab` остался один — `changeLoginEmail.tsx`.
4. Тумблер строки — `Row.CheckboxFieldToggle` с `CheckboxFieldTsx toggle`; класс поля —
   **только** `row-checkbox-field-toggle` (ef41b29db снял с тумблера `row-checkbox-field`,
   `rowTsx.tsx:482-492`).
5. «Неактивная» строка без выключения клика — `fakeDisabled` → `.is-fake-disabled`
   (`rowTsx.tsx:233`; стиль `_row.scss:30-38`: `.row-row` полупрозрачный, тумблер серый).
6. Шапка вкладки у верхнего края **прозрачна и без линии**; фон `--surface-color` и линия
   `--border-color` появляются только при прокрутке, когда со вкладки снят `scrolled-start`
   (`_sidebar.scss:75-100` + `Scrollable.attachBorderListeners`, `scrollable.ts:456-465`).
7. Вкладка въезжает переходом `navigation` слайдера: новая — из `translate3d(W,0,0)` в 0,
   прежняя — в `-0.25W` с `brightness(80%)`; назад — наоборот (`transition.ts:23-42`,
   `_slider.scss:231-247`, `--transition-standard-in` = `.3s`, уборка через 250 мс, `slider.ts:11`).

---

## 1. `Row` — `src/components/rowTsx.tsx` (526 строк)

Составной компонент на `createComponentContext` (`helpers/solid/createComponentContext.ts`):
дети (`Row.Title`, `Row.Subtitle`, …) **регистрируют** свой узел в сторе контекста, а
раскладывает их родитель в фиксированном порядке (`:246-256`), не в порядке написания.

### 1.1. Корень `Row` (`:77-261`)

| Проп | Что делает | Адрес |
|---|---|---|
| `clickable: true \| (e) => void` | делает строку кликабельной; функция зовётся, только если мышь не уехала после `mousedown` (`hasMouseMovedSinceDown`) и строка не `disabled`/`aria-disabled` | `:205-216` |
| `contextMenu` | `createContextMenu({...contextMenu, listenTo: container})`; без `clickable` клик открывает это меню (`openContextMenu?.(event)`) — так сделаны строки-«селекты» | `:180-203`, `:215` |
| `color: 'primary' \| 'danger'` | меняет только hover: `hover-primary-effect` / `hover-danger-effect` | `:232` |
| `disabled` | `.is-disabled` (`pointer-events: none`, `--disabled-opacity`) + `aria-disabled` | `:233`, `_row.scss:25-28` |
| `fakeDisabled` | `.is-fake-disabled`: выглядит выключенной, клик остаётся (им запрашивают разрешение/апселл) | `:234`, `_row.scss:30-38` |
| `as: 'a' \| 'label' \| 'div'` | тег; по умолчанию `label`, если в строке есть поле (checkbox/toggle/radio), иначе `div` | `:221` |
| `havePadding`, `noRipple`, `noWrap`, `class`, `classList`, `style`, `ref` | как в старом `row.ts` | `:166-172`, `:224-240` |
| `role`, `tabIndex`, `aria-*`, `on:keydown` | a11y из 472e3e76b: кликабельная строка без поля получает `role="button"`, `tabindex=0`, Enter/Space через `buttonKeyDown` | `:122-164`, `:241-242` |

Классы корня (`:224-240`): `row`, `no-subtitle` (нет `Row.Subtitle`), `no-wrap`,
`row-with-icon` (есть `Row.Icon`), `row-with-padding` (иконка / checkbox / radio / media или
`havePadding`), `row-clickable hover-[primary-|danger-]effect` (кликабельна), `is-disabled`,
`is-fake-disabled`, `row-grid` (есть `Row.RightContent` **или** тумблер «в сторону»),
`with-midtitle`. Ripple — `RippleElement` (`components/rippleElement.tsx`), `c-ripple` первым
ребёнком.

Порядок детей в DOM (`:246-256`): `title` → `midtitle` → `subtitle` → `icon` →
`checkboxField | radioField` → `rightContent` → (`div.row-right` с тумблером, если
`toggleAside`) → `media`.

**`toggleAside`** (`:106-113`): тумблер при подписи (`Row.Subtitle`) и без своего
`RightContent` уходит из строки заголовка в правую колонку (`div.row-right`, строка получает
`row-grid`) — иначе он висел бы над серединой строки. Этого нет в старой базе.

**Доступность** (`:126-164`, `onMount` `:260`): `labelControl` связывает `input` поля с
`.row-title` (`helpers/dom/labelControl.ts`); если в строке есть вложенный контрол (кнопка
справа), «первичной целью» становится сам `.row-title` (`role=button`, `tabindex`); наблюдатель
`MutationObserver` пересчитывает это при смене детей.

### 1.2. Части строки

| Подкомпонент | Разметка | Пропы | Адрес |
|---|---|---|---|
| `Row.Title` | `div.row-title` или, если есть правая часть, `div.row-row.row-title-row > div.row-title + div.row-title.row-title-right[.row-title-right-secondary]` | `titleRight`, `titleRightSecondary`, `class`, `rowClass`, `titleRightClass`, `ref`, `titleRightRef` | `:328-365` |
| — правая часть заголовка | `titleRight` **плюс** контрол: `radioFieldRight` или тумблер (если не `toggleAside`); оба сразу → класс `row-title-right-with-control` | — | `:338-362` |
| `Row.Midtitle` | `div.row-midtitle` / `div.row-row.row-midtitle-row` | `midtitleRight`, `ref` | `:367-380` |
| `Row.Subtitle` | `div.row-subtitle` / `div.row-row.row-subtitle-row > … + .row-subtitle-right` | `subtitleRight`, `class`, `ref`, `subtitleRightRef` | `:382-399` |
| `Row.Icon` | `span.row-icon.row-icon-colored[style=background-image: <градиент>] > span.tgico.row-icon-icon` | `icon`, `class`, `noBackground` (без плашки) | `:401-420` |
| `Row.RightContent` | `div.row-right` (пустой не рендерится — иначе занял бы колонку грида) | JSX-дети **или** `element` (готовый узел) | `:427-448` |
| `Row.CheckboxField` | поле-чекбокс слева, класс `row-checkbox-field` | дети — `CheckboxFieldTsx` | `:470-474` |
| `Row.RadioField` | поле-радио слева, `row-radio-field`; радио с классом `radio-field-right` регистрируется как `radioFieldRight` и уезжает в правую часть заголовка | дети — `RadioFieldTsx` | `:454-480` |
| `Row.CheckboxFieldToggle` | тумблер в `row-title-right` (или в `div.row-right` при `toggleAside`), класс **только** `row-checkbox-field-toggle` | дети — `CheckboxFieldTsx toggle` | `:482-492` |
| `Row.Media` | `div.row-media[.row-media-<size>]` | `size` (`small/medium/big/abitbigger/bigger/40`), дети **или** `element` | `:503-524` |

`registerRowField` (`:454-468`) метит поле классом из `components/rowFieldClasses.ts` —
`_row.scss` целится в эти классы, а не в любой `.checkbox-field` внутри строки (803f9599d).

### 1.3. Варианты строк настроек (как собирают экраны)

| Вариант | Сборка в tweb | Пример |
|---|---|---|
| Навигация с иконкой-плашкой | `<Row clickable={…}><Row.Icon icon="…"/><Row.Title>…</Row.Title></Row>` | корень настроек, `settings.tsx` |
| Навигация со значением справа | `<Row.Title titleRight={…} titleRightSecondary>` | «Auto-delete messages → 1 week» |
| Навигация со значением **подписью** | `<Row.Icon/><Row.Title>…</Row.Title><Row.Subtitle>{значение}</Row.Subtitle>` — значение НЕ в `titleRight`: длинное значение справа съело бы заголовок (`_row.scss:222-226`: правая часть `flex: 0 0 auto`). В DOM у `RowTsx` заголовок идёт раньше подписи (`:246-248`), в живых дампах (старый `row.ts`) — наоборот; видимый порядок один: строка — колонка flex, подпись `order: 1` (`_row.scss:159-164`) | `privacyAndSecurity.tsx:216-306`, исключения `privacySection.tsx:214-216` |
| Тумблер | `<Row><Row.CheckboxFieldToggle><CheckboxFieldTsx toggle …/></Row.CheckboxFieldToggle><Row.Title>…</Row.Title></Row>` | `notifications.tsx:90-104` |
| Тумблер-заглушка без разрешения | то же + `fakeDisabled` + `clickable={onClick}`, `checked={isGranted() && …}` | `notifications.tsx:408-426` |
| Чекбокс слева | `Row.CheckboxField` + `CheckboxFieldTsx` без `toggle` | автозагрузка |
| Радио-группа | `RadioFormTsx`/`RadioFieldTsx` в `Row.RadioField` | язык, формат времени |
| Радио справа | `RadioFieldTsx` с классом `radio-field-right` | quick reaction (дамп `14-left-36`) |
| «Селект» с меню | `<Row contextMenu={{buttons}}>` + `titleRight` текущего значения | «Reactions from …», `notifications.tsx:303-318` |
| Кнопка-действие (primary/danger) | **не `Row`**: `Button` (`components/buttonTsx.tsx`) `class="btn-primary primary btn-transparent"` + `icon` (`danger` — вместо `primary`) | «Enable Notifications» `notifications.tsx:464-471`; «Terminate all» |
| Ползунок | **не `Row`**: `RangeSettingSelector` (`components/rangeSettingSelector.tsx`, 45) поверх `rangeSelectorTsx.tsx` | громкость, размер текста |

---

## 2. `attachRowController` — `src/components/rowTsxController.tsx` (398 строк)

Мост для **императивного** кода: монтирует тот же Solid `Row` в `createRoot` и отдаёт объект с
узлами и методами старого класса `Row`. Экспорт — только `attachRowController(target, options)`
(`:390-398`) и `createRowSortableIcon` (`:61-63`); объект строки ставится на прототип цели
(`installRowControllerDescriptors`, `:364-388`), поэтому `class DialogElement` получает
`container`/`title`/`subtitle`/`media`/… как свои поля. Сам докблок говорит прямо: «the remaining
imperative dialog-row controller» (`:96`).

| Опция (`RowTsxOptions`, `:23-58`) | Во что превращается |
|---|---|
| `title`/`titleLangKey`, `subtitle`/`subtitleLangKey`, `titleRight(Secondary)`, `subtitleRight` | `Row.Title`/`Row.Subtitle` (строка → `htmlToDocumentFragment`) |
| `icon`, `iconClasses` | `Row.Icon` |
| `checkboxField`/`checkboxFieldOptions` | `Row.CheckboxField` или `Row.CheckboxFieldToggle` (по классу `checkbox-field-toggle`, `:109`) |
| `navigationTab` | `clickable` = `slider.createTab(ctor).open(args)` + перечитать `getInitArgs` на `destroyAfter` (`:113-139`) |
| `buttonRight(LangKey)`, `rightContent`, `rightTextContent` | `Row.RightContent` (`:141-152`) |
| `asLink`/`asLabel`, `contextMenu`, `havePadding`, `noRipple`, `noWrap` | пропы корня |
| `middleware` / `listenerSetter` | кто гасит `createRoot` (`:342-346`) |
| `withCheckboxSubtitle` + `checkboxKeys` | подпись «Enabled/Disabled» по чекбоксу (`:348-359`) |

Методы: `createMedia`/`applyMediaElement`, `ensureSubtitle`/`ensureMidtitle`,
`toggleDisability`/`disableWithPromise`, `makeSortable`/`toggleSorting`, `dispose`.

**Для настроек контроллер не нужен**: ни одна вкладка `sidebarLeft/tabs/*` его не импортирует
(`grep attachRowController src` → только `appDialogsManager.ts`). Экраны пишут JSX `Row`.

---

## 3. `Section` — `src/components/section.tsx` (148 строк)

Заменил `settingSection.ts` (удалён в 2556fc949). Разметка:

```
div.sidebar-left-section-container[.no-margin-bottom]          (:84-113)
  [div.sidebar-left-section-content.sidebar-left-section-caption]   ← captionTop (:90)
  div.sidebar-left-section[.no-shadow][.no-delimiter]            (:92-110)  (нет при noContent)
    [delimiter]                                                   ← fakeGradientDelimiter (:100)
    div.sidebar-left-section-content                              (:101-108)
      [div.sidebar-left-h2.sidebar-left-section-name > … + div.sidebar-left-section-name-right]
      …дети…
    [div.sidebar-left-section-content.sidebar-left-section-caption]  ← captionOld (:109)
  [div.sidebar-left-section-content.sidebar-left-section-caption]   ← ПО УМОЛЧАНИЮ (:112)
```

| Опция | Смысл | Адрес |
|---|---|---|
| `name` (+`nameArgs`, `nameRight`, `nameRef`) | заголовок карточки `SectionName` (экспортирован отдельно — им же делят алфавитный список контактов) | `:60-71`, `:102-107` |
| `caption` (+`captionArgs`, `captionRef`) | подпись; ключ или JSX | `:73-80` |
| `captionOld` | подпись **внутри** карточки | `:109` |
| `captionTop` | подпись **над** карточкой | `:90` |
| `noDelimiter`, `noShadow`, `innerClass` | классы внутренней карточки | `:93-98` |
| `fakeGradientDelimiter` | градиентная полоса над карточкой вместо линии | `:100` |
| `noMarginBottom` | на **контейнере** (`:86`): у HEAD отступ до следующей секции — `padding-bottom` контейнера (`_section.scss:84-91`), а не `margin` карточки | — |
| `noContent` | только подпись, без карточки | `:91` |
| `contentProps` | пропы/`ref` контент-блока | `:101` |

`appendSectionContent(section)` (`:123-146`) — второй контент-блок в той же карточке для
императивного кода; `SectionParts` (`:34-39`) — тип частей для передачи наружу.

**Стили** `scss/partials/_section.scss`: с ef41b29db/2556fc949 интервалы переехали —
у подписи вне карточки `margin-top: .625rem` (`:54-55`), пустая подпись места не занимает
(`:63-65`), `captionTop` (`:69-72`), подпись `captionOld` (`:76-79`), отступ после секции —
`padding-bottom` контейнера (`:84-91`).

---

## 4. Вкладки: `scaffoldSolidJSTab` и реестр `solidJsTabs/tabs.ts`

`scaffoldSolidJSTab({title, getComponentModule, onOpenAfterTimeout?, onClose?, onCloseAfterTimeout?})`
(`solidJsTabs/scaffoldSolidJSTab.tsx:26-76`) возвращает класс `extends SliderSuperTab`: `init(payload)`
ставит заголовок, лениво грузит модуль, рендерит `<PromiseCollector><SuperTabProvider self={this}><Component/>`
в `div` внутри `this.scrollable`, ждёт `promiseCollectorHelper.await()` (вкладка не въезжает
пустой); `dispose` — в `onCloseAfterTimeout` до `super`. `scaffoldSolidJSTabEventable`
(`:98-142`) — то же поверх `SliderSuperTabEventable` (сохранение на `destroy`). Изнутри вкладки —
`useSuperTab()` (`superTabProvider.tsx:24-25`) → `[tab, allTabs]`.

Изменения каркаса после старой базы: `SliderSuperTab.shown`/`resetShown()` (34f417d12,
`sliderTab.ts:43-54`) и `updateScrollRegionFocusable` (472e3e76b, `sliderTab.ts:111`).

### 4.1. Контейнер экрана: разметка, шапка, переход

Разметка вкладки (`sliderTab.ts` `_constructor`, `:60-90`; дамп `14-left-14:1-9`):

```
div.tabs-container[data-animation="navigation"]  (= .sidebar-slider колонки)
  div.tabs-tab.sidebar-slider-item[.active][.scrolled-start][.scrolled-end].scrollable-y-bordered
    div.sidebar-header > button.btn-icon.sidebar-close-button + div.sidebar-header__title
    div.sidebar-content > div.scrollable.scrollable-y > div (корень Solid) > секции
```

| Что | Правило tweb | Адрес |
|---|---|---|
| Фон шапки у верхнего края | `background-color: transparent` | `_sidebar.scss:4-5` |
| Линия под шапкой | `:after` 1px `--border-color`, `opacity: 0` | `_sidebar.scss:75-92` |
| При прокрутке | `.scrollable-y-bordered:not(.scrolled-start) .sidebar-header` → фон `--surface-color`, линия `opacity: 1` (переход `--transition-standard-in`) | `_sidebar.scss:95-100` |
| Кто ставит классы | `this.scrollable.attachBorderListeners(this.container)` — сразу `scrolled-start scrolled-end scrollable-y-bordered`, дальше переключает по `scrollPosition` | `sliderTab.ts:84`, `scrollable.ts:456-465` |
| Переход | `TransitionSlider({type: 'navigation', transitionTime: 250})` на `.sidebar-slider` | `slider.ts:41-45`, `slider.ts:11` |
| Кадр перехода | приходящая: `translate3d(W,0,0)` → 0; уходящая: `translate3d(-0.25W,0,0)` + `brightness(80%)`; `toRight=false` (назад) — зеркально | `transition.ts:23-42` |
| Классы на контейнере | `.animating` (+ `.backwards` при возврате); у вкладок `transition: transform/filter var(--transition-standard-in \| -out)` | `_slider.scss:231-247` |
| Первая вкладка | без анимации (`animateFirst: false`) | `transition.ts:41` |

---

## 5. Примитивы вокруг строк (что импортируют экраны настроек)

| Компонент tweb | Строк | Что это | Потребители в `sidebarLeft/tabs` |
|---|---|---|---|
| `components/checkboxFieldTsx.tsx` | 61 | Solid-обёртка над классом `CheckboxField`: `checked`/`signal`/`onChange`, `toggle`, `lockIcon`, `disabled`, `ref` | 14 файлов |
| `components/radioFieldTsx.tsx` | 49 | Solid-радио; `alignRight` → `radio-field-right` | 7 |
| `components/radioFormTsx.tsx` | 46 | форма радио по значению | вне настроек (`chatType.tsx`) |
| `components/rangeSettingSelector.tsx` | 45 | `div.range-setting-selector` (имя/значение + `RangeSelectorTsx`, `labelControl`) | notifications, generalSettings, storageQuota |
| `components/rangeSelectorTsx.tsx` | 176 | Solid-ползунок `progress-line` | через `RangeSettingSelector` |
| `components/buttonTsx.tsx` | 131 | Solid-кнопка; `primaryTransparent`, `primaryFilled`, `icon` | 23 |
| `sidebarLeft/tabs/passcodeLock/inlineSelect.tsx` | 191 | выпадающий выбор в `Row.RightContent` | passcode, keyboardShortcuts, activeSessions (TTL) |
| `components/checkboxFields.tsx` | 346 | дерево тумблеров/чекбоксов с аккордеоном и счётчиком | powerSaving |
| `components/settingsTabLottieAnimation.tsx` | 29 | лотти-заставка вкладки | passcode, autoDelete, 2fa |
| `components/mediaHeader.tsx` | 211 | «стикер → заголовок → подзаголовок» | session, passkeys |
| `components/space.tsx` | 13 | вертикальный отступ | storageQuota, autoDelete |
| `components/inputFieldTsx.tsx` | 95 | Solid-поле ввода | editProfile, 2fa |
| `helpers/dom/sortable.ts` | 302 | перетаскивание строк `.row-sortable` | chatFolders, stickersAndEmoji |
| `components/privacySection.tsx` | 393 | секция правила приватности + исключения (Solid с ef41b29db) | 11 вкладок `privacy/*` |
| `components/appSelectPeers.tsx` | 1453 | выбор пиров (поиск, чипсы, секции) | addMembers, includedChats, sharedFolder, `popups/pickUser.tsx` |
| `components/chatThemesPicker.tsx` | 356 | лента тем | generalSettings |
| `components/colorPicker.ts` | 370 | выбор цвета | backgroundColor |

---

## 6. Экраны настроек левой колонки (tweb `812502980`)

Все — `scaffoldSolidJSTab` из `solidJsTabs/tabs.ts`; «E» — `scaffoldSolidJSTabEventable`
(сохранение на `destroy`). Адрес конструктора — строка `export const` в `tabs.ts`.
Корень открывает подэкраны через `makeSubTabConfig` (`settings.tsx:251-258`) и строки
`:391-446`.

### 6.1. Корень и прямые подэкраны

| Экран | Файл (`sidebarLeft/tabs/…`) | Конструктор | Секции (name → caption), главное | Попапы / BLOCKED у нас |
|---|---|---|---|---|
| Настройки | `settings.tsx` (451) | `AppSettingsTab` :188 | шапка: поиск + ⋮ (edit / qr / logout, `:97-117`); `renderPeerProfile` (`:364-370`); секция без имени `div.profile-buttons` — 7 строк `makeSubTabConfig` + Devices (`titleRight` = счётчик) + Language (`LanguageName`) + Shortcuts (`:391-418`); Premium-секция (`:419-446`) | `showMyQrCodePopup`, `showLogOutPopup`, `showPremiumPopup`, `showStarsPopup`, `showSendGiftPicker` (2C); поиск по настройкам — 34f417d12 |
| Уведомления | `notifications.tsx` (571) | `AppNotificationsTab` :77 | `Notifications.Web` → `MultiAccount.ShowNotificationsFromCaption` / `Notifications.Default` (`:430-431`); `Notifications.Sound.Section` → `…Sound.Caption`; `Notifications.Sound.Effects`; `NotificationsPrivateChats` / `NotificationsGroups` / `NotificationsChannels`; `Stories`; `Reactions`; `NotificationsOther` | Stories/Reactions/Other — BLOCKED (нет полей на `/me/notify_settings`); `All Accounts` — нет модели (см. § 8.3) |
| Данные и память | `dataAndStorage/index.tsx` + `storageQuota.tsx` | `AppDataAndStorageTab` :439 (E) | `AutomaticMediaDownload` → `AutoDownloadAudioInfo`: тумблер + Photos/Videos/Files (`Row disabled` + подпись) + `Button` сброса; `StorageQuota.Title` → `…Caption`: строки с `Row.RightContent` «Clear», 4 строки с `Row.Icon`, 2 × `RangeSettingSelector`, `Button` «Clear All» | `confirmationPopup` (есть) |
| — автозагрузка | `autoDownload/{photo,video,file}.tsx`, `peerTypeSection.tsx` | :421 / :427 / :433 (E) | `AutoDownload*Title`: 4 тумблера типов пиров; у файлов — свой ползунок размера | — |
| Конфиденциальность | `privacyAndSecurity.tsx` (700) | `AppPrivacyAndSecurityTab` :659 (E) | без имени, `noDelimiter` → `SessionsInfo`: Blocked / Web sessions / Auto-delete / Passcode / 2FA / Login email / Passkeys — у всех значение `Row.Subtitle`; `PrivacyTitle` → `Privacy.MessagesCaption`: 12 правил (Title + Subtitle); `NewChatsFromNonContacts`; `Privacy.SensitiveContent`; `PrivacyPayments`; `FilterChats` (черновики) | web sessions, login email, globalPrivacy, contentSettings, payments — BLOCKED |
| Общие | `generalSettings.tsx` (359) | `AppGeneralSettingsTab` :160 | `Settings`: `RangeSettingSelector` 12–20, ChatBackground, тумблер Increase Contrast, LiteMode; `ColorTheme`: `ChatThemesPicker` + 5 радио + акцент; `DistanceUnitsTitle` (при геолокации); `General.TimeFormat` | — |
| Папки | `chatFolders.tsx` (433) | `AppChatFoldersTab` :815 | заставка + `div.caption` + `Button btn-control` вне секций; `Filters` (sortable); `FilterRecommended`; `FiltersView` (радио) | `showLimitPopup` (2C); рекомендованные, порядок — BLOCKED |
| Стикеры и эмодзи | `stickersAndEmoji.tsx` (270) | `AppStickersAndEmojiTab` :202 | без имени → `LoopAnimatedStickersInfo`: DoubleTap, SuggestStickers (`contextMenu`), Loop; `Emoji`; `DynamicPackOrder`; `Telegram.InstalledStickerPacksController` (sortable) | `showStickersPopup` (2C) |
| Динамики и камера | `speakersAndCamera.tsx` (121) | `AppSpeakersAndCameraTab` :181 | `CallSettings.OutputSection`, `…InputSection` (+ `MicrophoneLevelMeter`), `CallCameraSection`, AcceptCalls (→ `…AcceptCalls.Caption`) | `showOutputDevicePopup` (2C); AcceptCalls — BLOCKED (`changeAuthorizationSettings`) |
| Устройства | `activeSessions.tsx` (401) | `AppActiveSessionsTab` :379 (E) | `CurrentSession` (+ `nameRight` переименования) → `ClearOtherSessionsHelp` только при других сессиях; `AuthSessions.IncompleteAttempts`; `OtherSessions`; TTL (только при `ttlDays`) | TTL, unconfirmed, rename, connectedBot — BLOCKED/SKIP |
| — сессия | `session.tsx` (157), `sessionInfoRow.tsx`, `sessionDetails.module.scss` | `AppSessionTab` :396 (E) | `MediaHeader`; `Info` (Application/System/Location) → `…LocationInfo`; `AuthSessions.View.AcceptTitle`; кнопка Terminate | Accept* — BLOCKED |
| Язык | `language.tsx` (176) | `AppLanguageTab` :174 | `TranslateMessages` (тумблеры, `fakeDisabled` у премиум-строки); список `Row.RadioField` + `Row.Subtitle` | перевод — у нас снят осознанно (#133) |
| Горячие клавиши | `keyboardShortcuts.tsx` (292) | `AppKeyboardShortcutsTab` :113 | 8 секций; строка = `Row.Title titleRight=<KeyCombo> titleRightSecondary` + `Row.Subtitle`; Send — `InlineSelect` | — |
| Профиль | `editProfile.tsx` (436) | `AppEditProfileTab` :93 | `AvatarEdit`; поля `InputFieldTsx` → `Bio.Description`; `EditAccount.Username`; `UsernamesSection`; `EditProfile.PersonalChannel.Title`; `ChatAutomation.Title` | `showBirthdayPopup`, `showPickUserPopup` (2C); коллекционные имена, бизнес-боты — BLOCKED/SKIP |

### 6.2. Вложенные

| Экран | Файл | Конструктор | Кто открывает |
|---|---|---|---|
| Энергосбережение | `powerSaving.tsx` (122) | `AppPowerSavingTab` :241 | Общие |
| Обои / Цвет | `background.tsx` (615) / `backgroundColor.tsx` (168) | `AppChatBackgroundTab` :167 / `AppBackgroundColorTab` :275 | Общие / Обои |
| Быстрая реакция | `quickReaction.tsx` (64) | `AppQuickReactionTab` :195 | Стикеры |
| Правила приватности | `privacy/*.tsx` на `privacySection.tsx` | :301-367 (E), `AppPrivacyMessagesTab` :59 | Конфиденциальность |
| Заблокированные | `blockedUsers.tsx` (169) | `AppBlockedUsersTab` :252 | Конфиденциальность |
| Код-пароль | `passcodeLock/{mainTab,enterPasswordTab}.tsx` | :27 / :48 | Конфиденциальность |
| 2FA (8 шагов) | `2fa/*.tsx` | :891-989 | Конфиденциальность |
| Автоудаление | `autoDeleteMessages/index.tsx` | `AppMessagesAutoDeleteTab` :148 | Конфиденциальность |
| Passkeys | `passkeys.tsx` (131) | `AppPasskeysTab` :137 | Конфиденциальность |
| Веб-сессии | `activeWebSessions.tsx` (120) | :412 (E) | Конфиденциальность |
| Смена почты | `changeLoginEmail.tsx` — классические `SliderSuperTab` | — | Конфиденциальность |
| Редактор папки / Чаты папки / Ссылка | `editFolder.tsx` (733) / `includedChats.tsx` (252) / `sharedFolder.tsx` (306) | :833 / :615 / :626 (E) | Папки, меню папки |
| Выбор участников | `addMembers.tsx` (167) на `appSelectPeers.tsx` | `AppAddMembersTab` :1054 | исключения приватности и др. |

Особенности, которые легко потерять при порте:

- **Сохранение на закрытии.** `NotifySection` пишет настройки типа чата в `onCleanup`
  (`notifications.tsx:49-73`), правила приватности — на `destroy` (`privacySection.tsx:271`,
  `:279-344`), квота — в `save()` на `destroy` (`dataAndStorage/index.tsx:83-87`). Истории и
  реакции пишут сразу (`:112-121` — почему).
- **Строка без разрешения.** `NotificationRow` = `fakeDisabled={!isGranted()}` +
  `clickable={!isGranted() && onClick}`, чекбокс `checked={isGranted() && …}`
  (`notifications.tsx:408-426`); «Enable Notifications» — `Button` `btn-primary primary
  btn-transparent` с `icon="unmute"`, только пока разрешения нет (`:464-471`).
- **Кнопки-действия — не строки.** Сброс автозагрузки, «Terminate all», «Clear All»,
  «Upload Wallpaper», 2FA-действия — `Button btn-primary btn-transparent [danger]`.
- **Подпись 2FA и почты — внутри карточки** (`captionOld`: `2fa/index.tsx`, `2fa/email.tsx`;
  дамп `14-left-34`), у заблокированных — над карточкой (дамп `14-left-16b`).

---

## 7. Живые дампы

Сняты 2026-08-12 с боевого `web.telegram.org/k` ([`dom/left-sidebar.md`](dom/left-sidebar.md)
§ настройки, `:191-244`). Это **другая сборка**, чем `812502980`: у полей нет
`row-checkbox-field(-toggle)`, у иконок нет плашки `row-icon-colored`, в «Данных и памяти»
первая строка — квадратный чекбокс, а не тумблер, и подпись строки стоит в DOM раньше
заголовка (старый `row.ts`). **Классы — по исходникам HEAD, место узлов (подпись вне карточки,
заголовок внутри `-content`, кнопки вне строк) — по дампам.**

| Дамп | Экран |
|---|---|
| `08-settings-root`, `14-left-13-settings-root` | корень |
| `14-left-14-settings-notifications` | уведомления (эталон пилота) |
| `14-left-15-…data-storage`, `14-left-15b-…autodownload-photo` | данные и память |
| `08-privacy`, `14-left-16-…privacy`, `…16b-blocked-users`, `…16c-passcode`, `…16d-privacy-rule` | конфиденциальность |
| `08-general-settings`, `14-left-17-…general`, `…17b-wallpaper`, `…17c-power-saving` | общие |
| `14-left-18-…folders`, `…18b-folder-edit` | папки |
| `14-left-19-…stickers-emoji`, `14-left-36-quick-reaction` | стикеры |
| `14-left-20-…speakers-camera`, `14-left-21-…devices`, `14-left-22-…language`, `14-left-23-…shortcuts` | остальные |
| `14-left-25-…edit-profile`, `14-left-26-…header-menu` | профиль, меню шапки |
| `14-left-33-auto-delete`, `14-left-34-two-step-verification`, `14-left-35-passkeys-popup` | подэкраны приватности |

---

## 8. У нас (`web-client/src`, `origin/main` = `fea33856`)

### 8.1. Примитивы строк и секций

| Наш файл | Порт чего | Статус против HEAD | Расхождения |
|---|---|---|---|
| `components/rowTsx.solid.tsx` (312) | `rowTsx.tsx` старой базы + 803f9599d/2197fee9c | **иначе** | нет: `toggleAside` и `div.row-right` для тумблера; вид поля `radioFieldRight` и константы `RADIO_FIELD_RIGHT_CLASS`; `contextMenu`/`openContextMenuRef`; a11y-блока (`role`, `tabIndex`, `labelControl`, `buttonKeyDown`, `MutationObserver`); проверки `disabled`/`hasMouseMovedSinceDown` в `onClick`; `ref`/`rowClass`/`titleRightClass`/`titleRightRef` у частей; `midtitleRight`; `element`-форм `RightContent`/`Media`; пустой `RightContent` не должен занимать колонку; `style`. Шапка файла (`:21-31`) говорит, что `createContextMenu` в репо нет, — **устарело**: `helpers/dom/createContextMenu.ts` есть |
| `components/rowFieldClasses.ts` (24) | `rowFieldClasses.ts` | **есть** (значения совпадают) | «ОТСТУПЛЕНИЕ» в шапке (`:10-18`) — **не отступление**: у HEAD тумблер тоже носит только `row-checkbox-field-toggle` (ef41b29db, `rowTsx.tsx:482-492`); та же неверная запись — `rowTsx.solid.tsx:285-287`, `left-sidebar.md` ч. 8 § 3. Нет `RADIO_FIELD_RIGHT_CLASS` и классов выделения |
| `components/row.ts` (488) | удалённый в HEAD `row.ts` | **нет в HEAD** | потребители: `dialogRow.ts:145` (`class DialogElement extends Row`; у HEAD — `attachRowController`), `appSearchSuper.ts:1532` (строка ссылки; у HEAD — `renderSearchWebPageRow`, `searchWebPageRow.tsx`), `sidebarLeft/tabs/activeSessions.solid.tsx:61` (`language.solid.tsx` снят задачей 8 вместе с `RadioFormFromRows`/`RadioFormFromValues`) |
| `components/section.solid.tsx` | `section.tsx` HEAD (задача 1) | **есть** | в шапке: `caption` без голой строки (`Exclude<JSX.Element, string>`), сообщение `appendSectionContent` без `unwrapSolidElement` (хелпера нет). `generateDelimiter` — `components/generateDelimiter.ts`, стиль `.gradient-delimiter` — `styles/index.scss` (tweb `base.scss:1391`) |
| `styles/tweb/_section.scss` | `_section.scss` HEAD (задача 1) | **есть** | `scss-parity` 18/18. Парный хунк 2556fc949 в `_chatlist.scss` (`.chatlist-bottom .sidebar-left-section-container { padding-bottom: 0 }`) перенесён; хунк `_popup.scss:266-273` (`:has(+ footer)`) — за 2C |
| `shared/ui/SidebarSection/SidebarSection.tsx` | React-двойник `section.tsx` (до задачи 31) | **есть** (разметка) | только `title`/`caption` — единственный потребитель `kit.Section` других опций не передаёт; подпись — сосед карточки, заголовок — `.sidebar-left-h2` первым в `-content` |
| `styles/tweb/_row.scss` | `_row.scss` ef41b29db | **почти** | после 2A: нет `row-midtitle-row`, `sortable-item-transition`, классов выделения (60a83a6f1, ee6f7f9c2); `padding-block` строки `.4375rem` против `.375rem` |
| `components/settingSection.ts` (179) | удалённый `settingSection.ts` | **нет в HEAD** | единственный потребитель — `activeSessions.solid.tsx:35` |
| `components/checkboxFieldTsx.solid.tsx` | `checkboxFieldTsx.tsx` | **почти** | нет `lockIcon`, `ref`, эффекта `disabled` |
| `components/buttonTsx.solid.tsx`, `iconTsx.solid.tsx`, `rippleElement.solid.tsx` | те же | есть | — |
| `components/passwordInputField.ts`, `components/quizHint.ts` (+ `styles/tweb/_quizHint.scss`) | те же | есть (задача 18) | `quizHint` без `canCloseOnPeerChange`/`peer_changed` — вернётся с подсказками опросов; `shortcutListener` слушает `window`, а не активное окно (нет Document PiP) |
| `components/radioField.ts` | класс | есть | Solid-обёртка — `radioFieldTsx.solid.tsx` (задача 2). `radioForm.ts` удалён задачей 8: последний потребитель был `RadioFormFromRows` «Языка»; у tweb HEAD файл жив ради `ButtonMenuSync` `radioGroups` (`buttonMenu.ts:263`, `:295-319`), у нас не портированных (шапка `buttonMenu.ts`) — вернётся с ними дословно |
| `components/rangeSelector.ts` | класс `RangeSelector` | есть | `rangeSelectorTsx`/`RangeSettingSelector` нет (стили `.range-setting-selector` есть — `_leftSidebar.scss:951`) |
| `components/{slider,sliderTab}.ts`, `solidJsTabs/*` | те же | есть | реестр `tabs.ts` — две вкладки (Устройства, Язык); `shown`/`resetShown` (34f417d12) нет |
| `components/sidebarLeft/settingsSliderHost.ts` | `index.ts:140-148` + `settingsSliderPopup.ts` | шов (задача 3 — каркас закреплён) | свой `.sidebar-slider` поверх React-экрана, заглушка вкладки №0 (первое открытие — без затемнения корня, до задачи 28); тип навигации `'settings-popup'`, как у `settingsSliderPopup` (`'left'` заняли React-слои корня); перекрытие фона вкладки в `--surface-color` снято. Пины каркаса — `settingsTabFrame.solid.test.tsx` |
| `stores/appSettings.solid.ts` | `stores/appSettings.ts` (`useAppSettings`) | **мост** (задача 4) | без своего стора: чтение — `subscribeExternal` над zustand `useSettingsStore`, запись — его `update`; путь tweb → плоский ключ таблицей `APP_SETTINGS_KEYS` (О-2), пока `notifications.*` и `passcode.*` (задача 18); путь вне таблицы — `throw`; `setAppSettingsSilent` не портирован (вызывающий — только гидрация). Уведомления по типам — `stores/notifyStore.ts` |

### 8.2. Экраны: карта наших файлов

| Наш файл | Аналог tweb | Статус | Главное расхождение |
|---|---|---|---|
| `components/SettingsView.tsx` (361) | `settings.tsx` | React | своя карточка профиля вместо `PeerProfile`; лишние «Ночной режим», карточка контактов, `EmojiStatus.Set`; ключи `PrivacySettings`, `ChatList.Filter.List.Title`; ⋮ без обработчика; нет поиска/выхода; Premium-секция иначе |
| `components/SettingsSubScreen.tsx` (171) | — (роутер) | React | мок `SCREENS` мёртв: `General` перехвачен раньше (`:114`), `renderDedicated` недостижим → `QuickReaction` недостижим |
| `sidebarLeft/tabs/notifications.solid.tsx` | `notifications.tsx` | **Solid, HEAD** (пилот 2D, задача 6) | вкладка `AppNotificationsTab` через хост; подпись вне карточки, `NotificationRow` с `fakeDisabled`/`clickable` без разрешения, `Button btn-primary primary btn-transparent` c `unmute`, `RangeSettingSelector`, типы чатов пишутся на закрытии. Расхождения (шапка файла): нет «All Accounts» и подписи `MultiAccount.ShowNotificationsFromCaption` (О-1), секций Stories/Reactions/Other (О-3…О-5); отказ в разрешении даёт тост (у tweb `throw 1` в onFulfilled — необработанный reject); типы чатов — `stores/notifyStore.ts` вместо `appNotificationsManager`; побочка push — подписчик `client/pushSetup.ts::watchPushConditions` (tweb `uiNotificationsManager.ts:320-322`). DOM против `14-left-14`: отличия только `span.checkbox-field` + `row-checkbox-field-toggle` (HEAD, § 7), нет `item-secondary` у вкладки (шов хоста, задача 28) и строки All Accounts (О-1). React `settings/NotificationsSettings.tsx` снесён |
| `settings/DataStorageSettings.tsx` | `dataAndStorage/*`, `autoDownload/*` | React | подэкраны `sub` вместо вкладок; чекбоксы вместо тумблеров; `Row accent` вместо `Button`; нет строки stream chunks; «Clear All» чистит только файлы; мгновенное сохранение |
| `settings/PrivacySecuritySettings.tsx` | `privacyAndSecurity.tsx` | React | значения `value` вместо `Row.Subtitle` (`:115-133`); лишние «Сессии» и «Удаление аккаунта»; нет web sessions, login email, секций NewChats/Sensitive/Payments |
| `settings/PrivacyRule.tsx` | `privacySection.tsx` + `privacy/*` | React | **«Н..»**: счётчик исключения в `value` → `row-title-right` (`:162`, `:170`), правая часть не сжимается (`_row.scss:230-233`), и русский заголовок съедается; у tweb это `Row.Subtitle` (`privacySection.tsx:214-216`). Радио — галочкой; мгновенное сохранение; исключения только пользователи |
| `settings/PrivacyUserPicker.tsx` | `addMembers.tsx` + `appSelectPeers.tsx` | React | `PeerSelector` вместо `AppSelectPeers` |
| `settings/BlockedUsers.tsx` | `blockedUsers.tsx` | React | `EntryRow` с × вместо чатлиста и меню; нет FAB; подпись снизу внутри |
| `sidebarLeft/tabs/passcodeLock/{mainTab,enterPasswordTab,shortcutBuilder}.solid.tsx` | `passcodeLock/*` | **Solid, HEAD** (задача 18) | вкладки `AppPasscodeLockTab`/`AppPasscodeEnterPasswordTab` через хост, открывает строка `PasscodeLock.Item.Title` React-экрана конфиденциальности (при включённом коде — сначала ввод текущего, `privacyAndSecurity.tsx:193-210`). Без кода: `SettingsTabLottieAnimation`, `.MainDescription`, `button.btn-primary.btn-color-primary.btn-large`, подпись `PasscodeLock.Notice` вне карточки (дамп `14-left-16c`); с кодом: «Turn Passcode Off» — обычная строка `lockoff` (danger — только кнопка `confirmationPopup`), «Change passcode» `key_filled`, AutoLock — `InlineSelect`, тумблер сочетания + `ShortcutBuilder` (слушатель — `core/hooks/useLockScreenShortcut.ts`). Расхождения (шапки файлов): настройки — мост `useAppSettings` без `createResource`; действия — `core/passcode.ts::passcodeActions` (у нас код не шифрует хранилища, а стирает и запирает офлайн-стор); срез `onOpenAfterTimeout` и подсказка после выключения — до корня/в слое хоста (О-12, до задачи 23); `quizHint` без закрытия по смене чата. Секции `Other/LockPasscode` в «Горячих клавишах» нет — возвращается после слияния задачи 10. React `settings/PasscodeLock.tsx` снесён. Пины — `mainTab.solid.test.tsx`, проводка — `settingsSliderHost.wiring.test.tsx` |
| `settings/TwoStepVerification.tsx` | `2fa/*` | React | сжатый мастер; нет подтверждения почты кодом (BLOCKED) |
| `settings/AutoDeleteMessages.tsx` | `autoDeleteMessages/*` | React | галочки вместо радио; свой попап; сохранение сразу |
| `settings/Passkeys.tsx`, `PasskeyIntroPopup.tsx` | `passkeys.tsx`, `popups/passkey.tsx` | React | нет `MediaHeader`, меню удаления; попап не на `.popup-*` |
| `settings/GeneralSettings.tsx` | `generalSettings.tsx` | React | свой ползунок до 24; фейковые карточки тем; свои радио; нет Increase Contrast |
| `settings/ChatWallpaper.tsx` | `background.tsx` + `backgroundColor.tsx` | React | `Row accent` вместо кнопок; `<input type=color>` вместо вкладки цвета; локальные пресеты |
| `settings/PowerSaving.tsx` | `powerSaving.tsx` | React | мастер-тумблер с обратным смыслом; плоский список; ничего не сохраняет |
| `settings/QuickReaction.tsx` | `quickReaction.tsx` | React | недостижим; сетка эмодзи вместо радио-строк; не сохраняет |
| `settings/StickersSettings.tsx` | `stickersAndEmoji.tsx` | React | нет DoubleTap, Suggest, Emoji, DynamicPackOrder, сортировки; выдуманные секции |
| `settings/SpeakersCamera.tsx` | `speakersAndCamera.tsx` + `call/*` | React | свои имена секций, свой попап выбора; AcceptCalls в локальных настройках |
| `settings/HotkeysSettings.tsx` | `keyboardShortcuts.tsx` | React | свои `div.row`; 10+ ключей расходятся; нет `InlineSelect` |
| `settings/EditProfile.tsx` | `editProfile.tsx` | React | своя вёрстка без `Section`; нет Usernames/PersonalChannel/ChatAutomation |
| `settings/AvatarCropper.tsx` | `avatarEdit.ts` (+ медиаредактор) | React | также у `NewGroupFlow`, `EditContactView`, `GroupEditFlow` |
| `settings/BirthdayModal.tsx` | `popups/birthday.tsx` | React | также у `EditContactView` |
| `settings/ConfirmDialog.tsx` | `confirmationPopup` | мост | тонкая обёртка над `popups/popupPeer.ts`; также у `useChatPopups`, `MediaEditor`, групповых экранов, `PinnedMessagesScreen` |
| `settings/kit.tsx` (478) | `row.ts` + `settingSection.ts` + `sliderTab.ts` (React-двойник) | React | см. § 8.3; **22 потребителя вне настроек** (группы, звёзды, премиум, `EditContactView`, `RightsEditor`, `QrModal`, `EmojiStatusPicker`) |
| `folders/ChatFoldersSettings.tsx`, `FolderEditor.tsx`, `FolderChatsPicker.tsx` | `chatFolders.tsx`, `editFolder.tsx`, `includedChats.tsx` | React | нет сортировки, меню «удалить», `bots`/`exclude_archived`; имя до 24 символов (бэкенд — 12, `domain/folder.go:9`); `foldersManager.ts:57-68` шлёт `bots: false` и теряет флаг |
| `sidebarLeft/tabs/language.solid.tsx` | `language.tsx` | **Solid, HEAD** (задача 8) | список — `createSignal` + `For` + `Row.RadioField`/`RadioFieldTsx class="disable-hover"` + `Row.Title`/`Row.Subtitle` в `form` (`:98-154`), без `row.ts`. Расхождения (шапка файла): нет `TranslateSection` (#133 — обоснование сверено 2026-09-26: у `messages.translate` нет вызывающих, нет `usePremium`/`pickLanguage`, настройки перевода никто не читает); `langpack.getLanguages` через `managers.langPack` (кэш в менеджере); мёртвые `langs2`/`concat`/дедуп/`webLangCodes` не перенесены; `console.error('no language row')` снят — язык не из списка не отмечает ни одной строки. DOM против `14-left-22` (дамп старой базы): вместо `div > form` — `form` прямо в `-content`, у радио `span.radio-field.row-radio-field.disable-hover` (HEAD, § 7), у строки есть `.row-title` с именем (у старой базы имя — подпись радио). Пины — `language.solid.test.tsx` |
| `sidebarLeft/tabs/activeSessions.solid.tsx` | `activeSessions.tsx` | **Solid, старая база** | императивные `Row`/`SettingSection`; клик — попап завершения, а не экран сессии; нет `session.tsx` |

### 8.3. Сквозные расхождения (все React-экраны)

1. ~~Подпись внутри карточки~~ — **снято задачей 1**: `SidebarSection` кладёт подпись соседом
   карточки в контейнер (`section.tsx:112`, дамп `15-right-12`). Ручная разметка вне кита
   осталась: `group/GroupEditFlow.tsx` (подпись под полями имени/описания — внутри карточки,
   в дампе `15-right-12` снаружи) и `group/screens/InviteLinkScreens.tsx` — геометрия у них та
   же, что до смены модели (правило `captionOld`), `DiscussionScreen.tsx` переведён на форму
   `noContent`.
2. ~~Заголовок вне контент-блока и без `sidebar-left-h2`~~ — **снято задачей 1**: первым
   ребёнком `.sidebar-left-section-content` (`section.tsx:101-107`).
3. **Имена пропов** `kit.Section`: `caption` — заголовок, `footer` — подпись (`kit.tsx:209-232`).
4. ~~**Шапка на плашке с линией всегда.**~~ Снято задачей 3: `kit.SettingsScreen` ведёт
   `scrolled-start`/`scrolled-end` тем же `Scrollable.attachBorderListeners`, что вкладка слайдера,
   обёртка саба `scrollable-y-bordered` не несёт (пины — `settings/kit.test.tsx`). Там же снят
   двойной щелчок тумблера кита (активация label досылала второй `click`).
5. **Нет перехода назад и параллакса.** Подэкран корня монтируется условно
   (`SettingsView.tsx:337` `{sub && …}`) и снимается мгновенно; въезд — свой кейфрейм/`entering`
   (`SettingsView.module.scss:16-20`, `kit.tsx:80-91`) без уходящей вкладки. Слайдер при этом
   портирован (`components/slider.ts`) и уже ведёт «Устройства» и «Язык» через
   `settingsSliderHost`; переход вкладок закреплён пинами задачи 3
   (`settingsTabFrame.solid.test.tsx`). У React-экранов выход приходит с переездом каждого.
6. **Значение справа вместо подписи** (`value` → `row-title-right`), отсюда «Н..».
7. **Кнопки-действия — строки** (`Row accent/danger`), у tweb — `Button btn-primary btn-transparent`.
8. **Радио — галочка** (`Row selected`, отступление `kit.tsx:318-327`) или свой `RadioRow`.
9. **Свои CSS-модули** на месте портированных глобальных стилей (громкость, темы, сетки, строки хоткеев).
10. **Момент сохранения**: у нас сразу, у tweb часть — на закрытии вкладки. «Уведомления» (задача 6)
    уже пишут типы чатов на закрытии (`NotifySection`, пин — `notifications.solid.test.tsx`).

### 8.3.1. Модель «All Accounts»

Итог задачи 6: строка и подпись не портированы (О-1 плана 2D), у места — комментарий с номером
(`notifications.solid.tsx`, расхождение 1 шапки).

`notifyAllAccounts` у tweb фильтрует, **какая вкладка браузера** покажет уведомление
(`appNotificationsManager.ts:449-475`, `appTabsManager.getTabs()` по `accountNumber`): несколько
аккаунтов живут одновременно в разных вкладках. У нас мультиаккаунт — одна активная сессия на
браузер, переключение = смена токена и перезагрузка (`core/auth/accounts.ts:1-5`), `accountNumber`
у вкладки нет. Строке нечего переключать — это не ручка бэкенда, а модель клиента.

### 8.4. Адреса в других доках, которые устарели

- `left-sidebar.md` ч. 2 — адреса `solidJsTabs/tabs.ts` и `settings.tsx` по старой базе (например,
  `AppNotificationsTab` там `:71-75`, в HEAD — `:77-81`).

---

## Проверка после порта

Прощёлкать на стенде до слова «готово».

- [ ] Корень → любой подэкран: вкладка въезжает справа, корень уходит влево на четверть с
      затемнением; «назад» (кнопка, Esc, жест) — обратный сдвиг; `.animating`/`.backwards` на
      `.tabs-container` видны в DevTools и снимаются через ~250 мс.
- [ ] У верхнего края шапка без плашки и без линии; прокрутили на 1px — фон `--surface-color` и
      линия появились; вернулись — пропали.
- [ ] Подписи секций — под карточкой, вне её фона (кроме 2FA/почты — внутри, заблокированных — над).
- [ ] Заголовок секции — внутри `.sidebar-left-section-content`, класс `sidebar-left-h2`.
- [x] «Уведомления» (задача 6): без разрешения ДВЕ строки серые (`is-fake-disabled`, третья —
      «All Accounts» — О-1), клик по ним и «Enable Notifications» просит разрешение ровно раз;
      с разрешением — строки обычные, подписи нет (`MultiAccount.ShowNotificationsFromCaption` —
      О-1).
- [ ] Исключения приватности: «Никогда не показывать» читается целиком, счётчик — строкой ниже.
- [ ] Тумблер в строке с подписью стоит в правой колонке (`div.row-right`, `row-grid`).
- [ ] Строки с меню (`contextMenu`) открывают меню по клику и правому клику, Enter/Space с
      клавиатуры жмут кликабельную строку.
- [ ] Сохранение на закрытии: поменяли тип уведомлений / правило приватности, закрыли вкладку —
      значение на сервере (перезагрузка страницы показывает новое). Типы уведомлений — проверено
      задачей 6 на стенде.

Машинная сверка: `node tools/tweb-parity/dom-parity.mjs 14-left-14-settings-notifications ours.txt`
(и прочие дампы § 7) — ожидаемые отличия только в классах, перечисленных в § 7;
`node tools/tweb-parity/scss-parity.mjs _section.scss`, `… _row.scss`.
