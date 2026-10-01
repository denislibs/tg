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
| `components/chatThemesPicker.tsx` | 356 | лента тем | generalSettings (у нас нет — О-38) |
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
| ~~`components/row.ts`~~ | удалённый в HEAD `row.ts` | **удалён задачей 29** | вместе с тестом; последние потребители переведены как у HEAD: `DialogElement` (`dialogRow.ts`) — `attachRowController(this, {…})` (`appDialogsManager.ts:321`), строка ссылки shared media — `renderSearchWebPageRow` (`appSearchSuper.ts:1398`); с ним снят осиротевший `setRowIconBackground` (`helpers/rowIconBackground.ts`, у tweb ушёл в ef41b29db). Тесты i18n, собиравшие подписи через `new Row`, — на `attachRowController`/`Button` |
| `components/rowTsxController.solid.tsx` | `rowTsxController.tsx` HEAD (задача 29) | **есть** (объём `DialogElement`) | в шапке: портированы опции и части, которые читает строка чатлиста и её потребители (`title`/`subtitle`/`titleRightSecondary`/`subtitleRight`, `clickable: true`, `havePadding`/`noRipple`/`noWrap`/`asLink`, `middleware`; части `container`/`title*`/`subtitle*`/`media`, `applyMediaElement`, `dispose`); НЕ портированы `icon`, `*LangKey`, поля-чекбоксы, `navigationTab`, `buttonRight`/`rightContent`, `contextMenu`, `asLabel`, `listenerSetter`, строковый контент, функция в `clickable`/`freezed`, `ensure*`, `toggleDisability`/`makeSortable`, `createRowSortableIcon` (главный список у нас React). Граница «контроллер импортирует только `dialogRow.ts`» — пин (порт `rowTsxSafeMigrations.test.ts`) |
| `components/searchWebPageRow.solid.tsx` | `searchWebPageRow.tsx` HEAD (задача 29) | **есть** | `link.onClick` (inline `onclick`) → `link.action` в `data-anchor-action` (расхождение 23 `appSearchSuper.ts`) |
| `components/section.solid.tsx` | `section.tsx` HEAD (задача 1) | **есть** | в шапке: `caption` без голой строки (`Exclude<JSX.Element, string>`), сообщение `appendSectionContent` без `unwrapSolidElement` (хелпера нет). `generateDelimiter` — `components/generateDelimiter.ts`, стиль `.gradient-delimiter` — `styles/index.scss` (tweb `base.scss:1391`) |
| `styles/tweb/_section.scss` | `_section.scss` HEAD (задача 1) | **есть** | `scss-parity` 18/18. Парный хунк 2556fc949 в `_chatlist.scss` (`.chatlist-bottom .sidebar-left-section-container { padding-bottom: 0 }`) перенесён; хунк `_popup.scss:266-273` (`:has(+ footer)`) — за 2C |
| `shared/ui/SidebarSection/SidebarSection.tsx` | React-двойник `section.tsx` (до задачи 31) | **есть** (разметка) | только `title`/`caption` — единственный потребитель `kit.Section` других опций не передаёт; подпись — сосед карточки, заголовок — `.sidebar-left-h2` первым в `-content` |
| `styles/tweb/_row.scss` | `_row.scss` ef41b29db | **почти** | после 2A: нет `row-midtitle-row`, `sortable-item-transition`, классов выделения (60a83a6f1, ee6f7f9c2); классы ведущего чекбокса 690514225 (`row-with-checkbox-and-media`, `row-selection-media`, `row-selection-checkbox`, `row-selection-radio`) — есть (задача 16, пин `styles/selectorRowSelection.test.ts`); `padding-block` строки `.4375rem` против `.375rem` |
| ~~`components/settingSection.ts`~~ | удалённый `settingSection.ts` | **удалён задачей 9** | вместе с последним потребителем (`activeSessions.solid.tsx`); с ним — `helpers/dom/toggleDisability.ts` (тоже без потребителей) |
| `components/checkboxFieldTsx.solid.tsx` | `checkboxFieldTsx.tsx` | **почти** | нет `lockIcon`, `ref`, эффекта `disabled` |
| `components/checkboxFields.solid.tsx` | `checkboxFields.tsx` HEAD (задача 11) | **есть** (объём «Энергосбережения») | без круглой формы (`round`, шеврон `accordion-right-button`), ограничений (`asRestrictions`/`restrictionText`), `description`/`middleware`/`onAnyChange`/`onExpand` — их вызывающие (права группы, `chatAutomation`, `deleteMegagroupMessages`) не портированы; `disabled` поля группы — эффектом после эффекта поля (у tweb во вкладке его снимает `toggleDisability` поля), а само выключенное поле — `pointer-events: none` (`_row.scss`): по нему Chrome не шлёт click, и щелчок по тумблеру пропадал (стенд). Стили аккордеона — `styles/index.scss` (tweb `base.scss:1786-1872` без круглой формы), `html.no-backdrop` (`base.scss:403-407`) |
| `helpers/liteMode.ts` + `client/liteModeSettings.ts` | `helpers/liteMode.ts`, `appImManager.setSettings:2738-2757` | **есть** (задача 11) | формула `!all && !liteMode[key]` по объекту `liteMode` в zustand; `isReducedMotion` (системный `prefers-reduced-motion`) не портирован. Подписчик — классы `animation-level-*`, `no-backdrop`, автоплей/зацикливание стикеров |
| `components/buttonTsx.solid.tsx`, `iconTsx.solid.tsx`, `rippleElement.solid.tsx` | те же | есть | — |
| `components/mediaHeader.solid.tsx` + `.module.scss` | `mediaHeader.tsx`/`.module.scss` HEAD (задача 5) | **есть (HEAD)** | модель отступов HEAD (`gap: .5rem` у блока, части без вертикальных полей) — перенесена вместе с `auth/AuthFlow.module.scss` (`.qrContainer`) и разметкой карточек входа (`h1`, `class="secondary"`), О-29 снята; замеры — `dom/auth.md` §8.4. Отличия: `lottieLoader` по умолчанию, `onPromise` гасит `NO_WASM` |
| `helpers/dom/sortable.ts`, `sortableRun.ts`, `sidebarLeft/tabs/passcodeLock/inlineSelect.solid.tsx` | те же HEAD (задача 5) | **есть (HEAD)** | корень оверлеев — `getOverlayRoot()` из `helpers/appWindow.ts` (порт `appWindow.ts:33-35`; активное окно — всегда вкладка, выноса клиента в Document PiP нет, переключатели окна не заведены): курсор жеста и глотание клика после перестановки (`sortable.ts:98`, `:252`). `InlineSelect` монтирует список `<Portal>` без `mount` — как у tweb (`inlineSelect.tsx:144`), то есть в `document.body` |
| `components/quizHint.ts` (+ `styles/tweb/_quizHint.scss`) | тот же | есть (задача 18) | `quizHint` без `canCloseOnPeerChange`/`peer_changed` — вернётся с подсказками опросов; `shortcutListener` слушает `window`, а не активное окно (нет Document PiP) |
| `components/radioField.ts` | класс | есть | Solid-обёртка — `radioFieldTsx.solid.tsx` (задача 2). `radioForm.ts` удалён задачей 8: последний потребитель был `RadioFormFromRows` «Языка»; у tweb HEAD файл жив ради `ButtonMenuSync` `radioGroups` (`buttonMenu.ts:263`, `:295-319`), у нас не портированных (шапка `buttonMenu.ts`) — вернётся с ними дословно |
| `components/rangeSelector.ts`, `rangeSelectorTsx.solid.tsx`, `rangeSettingSelector.solid.tsx` | класс `RangeSelector`, `rangeSelectorTsx.tsx`, `rangeSettingSelector.tsx` HEAD (задача 2) | **есть (HEAD)** | RTL портирован: горизонтальная ось зеркалится по `I18n.getIsRTL()` (`rangeSelector.ts:164-166`, `rangeSelectorTsx.tsx:110-112`); флаг ставит старт (`client/boot.ts`, tweb `index.ts:391-400`) только для `ar` — в списке языков сервера его нет. Стили `.range-setting-selector` — `_leftSidebar.scss:951` |
| `components/colorPicker.ts` (+ `styles/tweb/_colorPicker.scss`) | `colorPicker.ts` + `_colorPicker.scss` | **есть (HEAD)** (задача 12) | дословно; хелперы при нём — `helpers/createElementFromMarkup.ts`, `helpers/dom/markGridCornerItem.ts`, `helpers/files/requestFile.ts`, `hexaToHsla` в `shared/lib/color.ts` |
| `components/{slider,sliderTab}.ts`, `solidJsTabs/*` | те же | есть | реестр `tabs.ts` — вкладки дописываются экранами волны 2D (в т.ч. экран сессии `AppSessionTab`, задача 9, и `AppQuickReactionTab`, задача 14); `shown`/`resetShown` (34f417d12) нет |
| `components/sidebarLeft/columnSlider.ts` | `index.ts:118-152`, `:652-654`, `:1743-1753` | **колоночный слайдер** (задача 28) | `SidebarSlider` на разметке `#column-left` (`navigationType: 'left'`, вкладка №0 — `.item-main` React-колонки, вкладки встают её соседями с `item-secondary`); заводит и снимает `Sidebar.tsx` (слой раскладки), открывающая сторона — `getColumnSlider()` (роль синглтона `appSidebarLeft`, ВРЕМЕННО до 2-1 волны 7). `has-open-tabs` — отражение `hasTabsInNavigation()` через `onTabsCountChange`, писатель один. Хоста, заглушки, своего слоя и `settingsSliderHost.module.scss` больше нет; `destroy()` — ВРЕМЕННО до Э4-1 (колонка React'овая). Переопределение `createTab` для свёрнутой колонки — О-27. Пины — `columnSlider.test.ts`, `Sidebar.settingsTab.test.tsx`, каркас — `settingsTabFrame.solid.test.tsx` |
| `components/appSelectPeers.solid.tsx` | `appSelectPeers.tsx` | **есть (HEAD, задача 16)** | класс, как у tweb; с ним `selectorSearch.solid.tsx` (поле + чипы, чип — `selectorEntity.ts`), ванильный `inputSearch.ts` (наследует `InputSearchHandle`), `emptyPlaceholder.solid.tsx`, `helpers/solid/wrapSolidComponent.ts`. В объёме потребителей 2D (приватность, чаты папки, ссылка папки, попап выбора пользователя 2C); не портированы участники канала, права отправки/звёзды/премиум-замок (О-31), `custom`, режим `hidden`, `setLimit`, `prependPeerIds`, `getPeerIdFromKey`, `convertPeerTypes` (О-32) — шапка файла. `_selector.scss` приведён к HEAD: полоса `.selector-row-with-checkbox`, `.selector-square` снят (690514225), React `PeerSelector` ставит те же классы строки |
| `components/passwordInputField.ts` | `passwordInputField.ts` | **есть** (задача 19) | дословно: ловушки `input.stealthy`, «глазок» `span.toggle-visible`; карточка входа `auth/cards/PasswordCard.solid.tsx` строит ту же разметку своим JSX |
| `components/monkeys/password.ts`, `monkeys/tracking.ts` | `monkeys/password.ts`, `monkeys/tracking.ts` | **есть** (задача 19) | классы оригинала; у `tracking` — только ветка `InputField` (поле кода — Solid `auth/TrackingMonkey.solid.tsx`, арифметика кадра берётся оттуда). React-двойник `components/PasswordMonkey.tsx` остался у экрана блокировки пасскода |
| `components/wrappers/stickerEmoji.ts` | `wrappers/stickerEmoji.ts` | **есть** (задача 19) | документ — `core/animatedEmoji.ts::getAnimatedEmoji` вместо `appStickersManager`; вход нашего `wrapSticker` — `mediaId` + плоские поля документа |
| `stores/appSettings.solid.ts` | `stores/appSettings.ts` (`useAppSettings`) | **мост** (задача 4) | без своего стора: чтение — `subscribeExternal` над zustand `useSettingsStore`, запись — его `update`; путь tweb → плоский ключ таблицей `APP_SETTINGS_KEYS` (О-2), пока `notifications.*`, `passcode.*` (задача 18) и `liteMode` (лист-объект, задача 11); путь вне таблицы — `throw`; `setAppSettingsSilent` не портирован (вызывающий — только гидрация). Уведомления по типам — `stores/notifyStore.ts` |

### 8.2. Экраны: карта наших файлов

| Наш файл | Аналог tweb | Статус | Главное расхождение |
|---|---|---|---|
| `sidebarLeft/tabs/settings.solid.tsx` | `settings.tsx` | **Solid, HEAD** (задача 28) | `AppSettingsTab` на колоночном слайдере, открывает пункт «Settings» бургера (`closeTabsBefore` → `createTab`, tweb `index.ts:759-767`). Дословно: ⋮ `edit`/`qr`/`logout` (danger), `settings-container`, свой `PeerProfile` (`isDialog: false`, сворачивание — по вкладке; шапка — наш класс `PeerProfileAvatars` снаружи + Solid-порт `useCollapsable`), `div.profile-buttons` — 7 × `makeSubTabConfig` (ключи tweb `AccountSettings.PrivacyAndSecurity`/`AccountSettings.Filters`) + «Устройства» (счётчик `titleRight`, fire-and-forget, перечитывание на `destroy`) + «Язык» + «Горячие клавиши», Premium-секция. Сняты по tweb: карточка телефона/имени (их показывает `PeerProfile`), экран `PremiumManage` (Premium — всегда попап). Расхождения (шапка файла): нет поиска (О-26), попапы — мосты к React до 2C-13/17/18/19/20 (`settingsPopups.tsx`; выход без подтверждения, подарок без выбора получателя), «Конфиденциальность»/«Динамики»/«Профиль» — React-экраны на мосту `scaffoldReactScreenTab` (до 2D-23/26/27; «Стикеры» — Solid с задачи 15), нет `premiumBlocked` (О-41), TON и бизнес-бота (О-42). Пины — `settings.solid.test.tsx` |
| `sidebarLeft/reactScreenTab.tsx` | — (мост) | **ВРЕМЕННО** до 2D-23/26/27 | React-экран кита вкладкой колоночного слайдера: классы вкладок tweb (`AppPrivacyAndSecurityTab`, `AppSpeakersAndCameraTab`, `AppEditProfileTab`) в `solidJsTabs/tabs.ts`, содержимое — React-корень экрана (`InSliderContext` глушит свой въезд кита, `z-index` кита замкнут хостом `isolation: isolate`); вкладка размонтирует корень на `onCloseAfterTimeout`. Задача порта меняет форму объявления на `scaffoldSolidJSTab`. Пины — `reactScreenTab.wiring.test.tsx`. React-роутер `SettingsSubScreen.tsx` снесён |
| `sidebarLeft/tabs/notifications.solid.tsx` | `notifications.tsx` | **Solid, HEAD** (пилот 2D, задача 6) | вкладка `AppNotificationsTab` на колоночном слайдере; подпись вне карточки, `NotificationRow` с `fakeDisabled`/`clickable` без разрешения, `Button btn-primary primary btn-transparent` c `unmute`, `RangeSettingSelector`, типы чатов пишутся на закрытии. Расхождения (шапка файла): нет «All Accounts» и подписи `MultiAccount.ShowNotificationsFromCaption` (О-1), секций Stories/Reactions/Other (О-3…О-5); отказ в разрешении даёт тост (у tweb `throw 1` в onFulfilled — необработанный reject); типы чатов — `stores/notifyStore.ts` вместо `appNotificationsManager`; побочка push — подписчик `client/pushSetup.ts::watchPushConditions` (tweb `uiNotificationsManager.ts:320-322`). DOM против `14-left-14`: отличия только `span.checkbox-field` + `row-checkbox-field-toggle` (HEAD, § 7), строки All Accounts (О-1); `item-secondary` у вкладки есть с задачи 28 (колоночный слайдер). React `settings/NotificationsSettings.tsx` снесён |
| `sidebarLeft/tabs/dataAndStorage/{index,storageQuota}.solid.tsx`, `autoDownload/*.solid.tsx` | `dataAndStorage/*`, `autoDownload/*` | **Solid, HEAD** (задача 7 плана 2D) | вкладки `AppDataAndStorageTab`, `AppAutoDownload{Photo,Video,File}Tab` (eventable) на колоночном слайдере; тумблер `AutoDownloadMedia`, Photos/Videos/Files — `Row disabled` + подпись (`getAutoDownloadSubtitle`, ключи `AutoDownload*`) и открывают вкладки слайдера; сброс — `Button icon=delete primaryTransparent` через `confirmationPopup`; квота — «Clear» в `row-right` (CSS-модуль tweb), 4 × `Row.Icon`, 2 × `RangeSettingSelector`, «Clear All» — `Button`; срок/предел кэша пишутся на `destroy`; вкладки автозагрузки — тумблеры `Autodownload*`, предел файла — локальный `RangeSettingSelector` tweb с дебаунсом. Расхождения (шапки файлов): нет строки «Cached video stream chunks» (О-6 — корзин потоковых чанков нет, «Clear All» чистит `cachedFiles`); подсчёт/очистка — `core/mediaCache.ts`, а не `CacheStorageController`/`apiManagerProxy`; `formatBytes` — строкой (`Unit.*`), не узлом `FileSize.*`; `stateKey` поля → `checked`/`onChange` через `useAppSettings` (`autoDownloadNew.pFlags.disabled` ↔ `autoDownloadEnabled` — `codec`); побочка квоты → SW — подписчик `core/mediaCache.ts::watchCacheSettings`. React `settings/DataStorageSettings.tsx` снесён |
| `settings/PrivacySecuritySettings.tsx` | `privacyAndSecurity.tsx` | React на мосту `AppPrivacyAndSecurityTab` (до 2D-23) | строка 2FA открывает вкладки `2fa/*` слайдером своей вкладки, конец мастера срезает экран до `AppSettingsTab` — перечитывания `onTabsEmpty` больше нет (задачи 19, 28); строки правил открывают вкладки `privacy/*` так же (задача 17), строка автоудаления — `AppMessagesAutoDeleteTab` с периодом и `onSaved` (задача 20); значения `value` вместо `Row.Subtitle` (`:115-133`); лишние «Сессии» и «Удаление аккаунта»; нет web sessions, login email, секций NewChats/Sensitive/Payments |
| `components/privacySection.solid.tsx` + `sidebarLeft/tabs/privacy/*.solid.tsx` | `privacySection.tsx` + `privacy/*` | **Solid, HEAD** (задача 17) | 11 eventable-вкладок по нашим 12 ключам (`phoneNumber` — два правила), запись на `destroy`; строка исключения — `Row.Icon` + `Row.Title` + `Row.Subtitle` со счётчиком («Н…» снято), радио `Row.RadioField` `disable-hover`, подпись `replaceCaption`/`hide`, исключения — `AppAddMembersTab` `type: 'privacy'`. Открывают строки React-«Конфиденциальности» на колоночном слайдере. Расхождения (шапки файлов): кэш правил — `stores/privacyStore.ts`, только пользователи (О-17), без мини-приложений (О-33), без премиум-замка/кнопки/«Контакты и Premium» (О-34), без «публичного фото» (О-35), подпись номера без ссылки `t.me/+…` (О-36), без P2P/Gifts/SavedMusic (О-16), «Сообщения» — `PrivacySection` по нашему правилу (О-15), своя вкладка `readTime` вместо `hide_read_marks` (О-18). React `settings/PrivacyRule.tsx` снесён. Пины — `privacy/privacy.solid.test.tsx`, `settings/PrivacySecuritySettings.privacyRules.test.tsx` |
| `sidebarLeft/tabs/addMembers.solid.tsx` | `addMembers.tsx` | **Solid, HEAD** (задача 16) | вкладка `AppAddMembersTab` (заголовок из нагрузки, `noSame`), селектор прямо в `.sidebar-content`, угловая «Далее» `btn-corner`; потребителей пока нет — открывать будут исключения приватности (задача 17). Не портированы категории (`extraCategories`, мини-приложения — О-33), участники канала, `peerLoader`, лимит; у `ButtonCorner` нет `ariaLabel` |
| `settings/PrivacyUserPicker.tsx` | `addMembers.tsx` + `appSelectPeers.tsx` | React | `PeerSelector` вместо `AppSelectPeers`; правила приватности на `AppAddMembersTab` (задача 17), остался единственный потребитель — `BlockedUsers.tsx`, снос — с задачей 22 |
| `settings/BlockedUsers.tsx` | `blockedUsers.tsx` | React | `EntryRow` с × вместо чатлиста и меню; нет FAB; подпись снизу внутри |
| `settings/PasscodeLock.tsx` | `passcodeLock/*` | React | шаги в одном компоненте; «выключить» — `danger`; нет `InlineSelect`, сочетания |
| `sidebarLeft/tabs/2fa/*.solid.tsx` | `2fa/{index,enterPassword,reEnterPassword,hint,email,passwordSet}.tsx` | **Solid, HEAD** (задача 19) | шесть вкладок `AppTwoStepVerification*Tab` на колоночном слайдере; входит строка React-«Конфиденциальности» по состоянию пароля (`privacyAndSecurity.tsx:257-271`). Заставки `wrapStickerEmoji` 🔐/💡/🥳 и лотти `LoveLetter`, подпись главной и финала внутри карточки (`captionOld`), `Button btn-primary btn-transparent`, обезьянки `PasswordMonkey`/`TrackingMonkey`, попапы `popup-disable-password`/`popup-skip-email` (`PopupPeer`). Расхождения (шапки файлов): `PasswordState` (`/me/password`) вместо `AccountPassword`, SRP нет — `verifyPassword`/`setPassword`/`removePassword`; нет `emailConfirmation`, `ForgotPasswordLink`, ветки `EMAIL_UNCONFIRMED`, «Skip» не снимает почту (О-13); `sliceTabsUntilTab(AppSettingsTab, tab)` дословно (с задачи 28: финал закрывается в корень настроек). Пины — `2fa/twoStepVerification.solid.test.tsx`. React `settings/TwoStepVerification.tsx` снесён |
| `sidebarLeft/tabs/passcodeLock/{mainTab,enterPasswordTab,shortcutBuilder}.solid.tsx` | `passcodeLock/*` | **Solid, HEAD** (задача 18) | вкладки `AppPasscodeLockTab`/`AppPasscodeEnterPasswordTab` на колоночном слайдере, открывает строка `PasscodeLock.Item.Title` React-экрана конфиденциальности (при включённом коде — сначала ввод текущего, `privacyAndSecurity.tsx:193-210`). Без кода: `SettingsTabLottieAnimation`, `.MainDescription`, `button.btn-primary.btn-color-primary.btn-large`, подпись `PasscodeLock.Notice` вне карточки (дамп `14-left-16c`); с кодом: «Turn Passcode Off» — обычная строка `lockoff` (danger — только кнопка `confirmationPopup`), «Change passcode» `key_filled`, AutoLock — `InlineSelect`, тумблер сочетания + `ShortcutBuilder` (слушатель — `core/hooks/useLockScreenShortcut.ts`). Расхождения (шапки файлов): настройки — мост `useAppSettings` без `createResource`; действия — `core/passcode.ts::passcodeActions` (у нас код не шифрует хранилища, а стирает и запирает офлайн-стор); срез `onOpenAfterTimeout` — дословно до `AppPrivacyAndSecurityTab` (с задачи 28, О-12 снято); `quizHint` без закрытия по смене чата. Секции `Other/LockPasscode` в «Горячих клавишах» нет — возвращается после слияния задачи 10. React `settings/PasscodeLock.tsx` снесён. Пины — `mainTab.solid.test.tsx`, проводка — `reactScreenTab.wiring.test.tsx` |
| `sidebarLeft/tabs/autoDeleteMessages/{index.solid.tsx,options.ts,customTimePopup/*}` | `autoDeleteMessages/*` | **Solid, HEAD** (задача 20; попап — задача 11 плана 2C) | вкладка `AppMessagesAutoDeleteTab` (`{period, onSaved}`), открывает строка React-«Конфиденциальности» с текущим периодом (замороженная до ответа `/me/auto_delete`), `onSaved` обновляет подпись строки. `Space` 1rem + `SettingsTabLottieAnimation UtyanDisappear` + `Space` 2rem, секция `AutoDeleteMessages.SectionTitle` с подписью вне карточки, радио `Row.RadioField` Off/1 день/1 неделя/1 месяц, свой срок встаёт строкой по порядку (±10% к срокам барабана, иначе `formatDuration`), «Set other time» — `Row.Icon tools` → попап `auto-delete-messages-custom-time-popup` (`old`, барабан `VerticalOptionWheel` Never + 16 сроков, Save/Cancel). Запись — только галочкой `SaveButton` в шапке (`Portal`) или «Save» подтверждения `UnsavedChanges` на закрытии (`useIsConfirmationNeededOnClose`: Discard — без записи, крестик/Esc — вкладка остаётся). Расхождения (шапки файлов): `privacy.setAutoDelete` (`PUT /me/auto_delete`) вместо `appPrivacyManager`, нет `allTimeOptionsForAutoDeleteIcon` (иконки автоудаления в шапке чата у нас нет). Прежние 30-дневные месяцы читаются как «k месяцев». React `settings/AutoDeleteMessages.tsx` снесён. Пины — `autoDeleteMessages.solid.test.tsx`, проводка — `settings/PrivacySecuritySettings.autoDelete.test.tsx` |
| `sidebarLeft/tabs/passkeys.solid.tsx` (+ `.module.scss`), `popups/passkey.ts` | `passkeys.tsx`, `popups/passkey.tsx` (`createPasskey`) | **Solid, HEAD** (задача 21) | вкладка `AppPasskeysTab` на колоночном слайдере (payload `{passkeys, setPasskeys}` — Solid-стор открывающего; тип — предметный `Passkey` из `layer.d.ts`, `authManager` отдаёт его вместо своего `PasskeyInfo`). Одна секция: `MediaHeader` (стикер `key` 100px, `Passkey.Subtitle`), `div.items` со строками (`key_filled`, `Row.Title.text-bold`, `Row.Subtitle` «Created … • used …» через `formatDate({withTime})`; меню `Delete` danger → `confirmationPopup` `Passkey.Deletion.*` → `is-disabled` до ответа → строка снята из стора) и `Button primaryTransparent icon=add` `Privacy.Passkey.Create` (по WebAuthn и лимиту), подпись `Privacy.Passkeys.Caption` вне карточки со ссылкой (`helpers/dom/anchorCallback.ts`) на интро-попап; без ключей и WebAuthn вкладка закрывается сама. Расхождения (шапка файла): нет эмодзи менеджера паролей `software_emoji_id` (О-50), лимит — константа 10 вместо `appConfig.passkeys_account_passkeys_max` (О-51), WebAuthn — наш `core/webauthnBrowser.ts` без `parseCreationOptionsFromJSON`. Интро-попап `showPasskeyPopup` — мост к React `settings/PasskeyIntroPopup.tsx` до 2C-10 (`settingsPopups.tsx`), создание в нём — тот же `createPasskey`. React `settings/Passkeys.tsx` снесён. Пины — `passkeys.solid.test.tsx`, `popups/passkey.test.ts`, проводка хаба — `reactScreenTab.wiring.test.tsx` |
| `sidebarLeft/tabs/generalSettings.solid.tsx` | `generalSettings.tsx` | **Solid, HEAD** (задача 13) | вкладка `AppGeneralSettingsTab` из строки корня; секции `Settings` (`RangeSettingSelector` 12–20 → `textSize`, строки «Обои» `appearance_filled` → `AppChatBackgroundTab`, «Энергосбережение» `sputnik_filled` → `AppPowerSavingTab` с живым `titleRightSecondary` по `liteMode.all`), `ColorTheme` (пять радио `settings.theme` = наш `themeChoice`, ключи tweb `ThemeDay/ThemeNight/ThemeLight/ThemeTinted/AutoNightSystemDefault`), `General.TimeFormat` (радио h12/h23 ↔ `timeFormat` 12h/24h через `codec` моста, подпись — живое время `eachMinute`). Расхождения (шапка файла, таблица модели темы tweb ↔ у нас): нет карусели `ChatThemesPicker` и ряда акцентов (О-38 — нет облачных тем и модели `settings.themes[]`), тумблера Increase Contrast (О-37 — a11y 472e3e76b), `DistanceUnitsSection` (у tweb не рисуется никогда), прогрева серверных обоев (О-11); форма радио без `margin-top`. Прежние размеры текста 21–24 прижимаются к 20 в `settings.tsx::load`. React `settings/GeneralSettings.tsx` снесён; React `components/ChatThemesPicker.tsx` остаётся — это попап темы ОДНОГО чата (`useChatPopups`), не порт `chatThemesPicker.tsx`. Пины — `generalSettings.solid.test.tsx`, проводка — `settings.solid.test.tsx` |
| `sidebarLeft/tabs/stickersAndEmoji.solid.tsx`, `wrappers/stickerSetThumb.ts` | `stickersAndEmoji.tsx` + `wrappers/stickerSetThumb.ts` | **Solid, HEAD** (задача 15) | вкладка `AppStickersAndEmojiTab` из строки корня; секции императивно в `onMount` (компонент — `null`), класс `stickers-emoji-container`. Без имени → подпись `LoopAnimatedStickersInfo` вне карточки: «Quick Reaction» (`havePadding`, → `AppQuickReactionTab`, превью `row-media-small` пустое — О-30), «Suggest Stickers» (`lamp_filled`, `titleRight` вторичный, контекст-меню `listenForClick` из трёх пунктов → `stickersSuggest`), «Loop» (`flip`, тумблер `loopStickers`); `Emoji`: «Suggest Emoji» (тумблер `emojiSuggest`); `Telegram.InstalledStickerPacksController` → `StickersBotInfo`: строки наборов в своём `appendSectionContent` (Title — `wrapEmojiText`, Subtitle `Stickers`, `Row.Media` с обложкой 36×36), клик → `showStickersPopup({id})` (мост к React `StickerSetModal` до 2C-15), `stickers_installed`/`stickers_deleted` дописывают/снимают строку. Не портировано: «Large Emoji» (О-45 — лента не рисует больших эмодзи), «Dynamic Pack Order» (О-43), `Sortable`/`row-sortable`/`stickers_order` (О-14 — ручки порядка нет); «All Sets» = «My Sets» (О-44). Читатели настроек — гейты композера (`Composer.tsx::checkStickerSuggest`, `useComposerAutocomplete::checkEmojiAutocomplete`). DOM против `14-left-19`: без строк/секции О-43/О-45, строки наборов без `row-sortable` и `row-sortable-icon`. React `settings/StickersSettings.tsx` снесён. Пины — `stickersAndEmoji.solid.test.tsx`, `Composer.suggestSettings.test.tsx` |
| `sidebarLeft/tabs/background.solid.tsx`, `backgroundColor.solid.tsx` | `background.tsx` + `backgroundColor.tsx` | **Solid, HEAD** (задача 12) | вкладки `AppChatBackgroundTab`/`AppBackgroundColorTab`; плитка сетки — тот же Solid-`<ChatBackground>`, что рисует фон чата (`components/chat/bubbles/chatBackground.solid.tsx`, тема `day`, размер плитки — `background.tsx:105-127`), своё фото плитке отдаёт `core/chat/chatBackgroundStore.ts`, отгрузка сеет его локальным файлом (`:405-415`, `:434-439`). Сетка — клиентские `WALLPAPER_PRESETS`, обои одни на все темы (О-11), без `LazyLoadQueue` (12 плиток), подсветка выбранных обоев в тему не пишется (нет `settings.themes[]`, О-38) — её выводит сам фон. React `settings/ChatWallpaper.tsx` снесён |
| `settings/PowerSaving.tsx` | `powerSaving.tsx` | React | мастер-тумблер с обратным смыслом; плоский список; ничего не сохраняет |
| `sidebarLeft/tabs/powerSaving.solid.tsx` | `powerSaving.tsx` | **Solid, HEAD** (задача 11) | вкладка `AppPowerSavingTab` из строки «Общих» (статус справа — живой по `liteMode.all`); две секции в `form`, подпись `LiteMode.Info` вне карточки, дерево ключей `:28-37` на `CheckboxFields` (группы-аккордеоны со счётчиком `N/M`, вложенные — чекбоксы); при `all` строки `is-disabled`, поля `is-fake-disabled`, тост `LiteMode.DisableAlert`; запись на `change` формы, `all` — через 200 мс. Настройка — объект `liteMode` формы tweb в zustand (`settings.tsx`; прежний `reduceMotion` = `liteMode.animations`, миграция в `load()`), побочки — подписчик `client/liteModeSettings.ts` (tweb `appImManager.setSettings:2738-2757`). Расхождения (шапка файла): запись сливается с прежним объектом (как Solid-стор оригинала). React `settings/PowerSaving.tsx` снесён |
| `settings/SpeakersCamera.tsx` | `speakersAndCamera.tsx` + `call/*` | React | свои имена секций, свой попап выбора; AcceptCalls в локальных настройках |
| `sidebarLeft/tabs/keyboardShortcuts.solid.tsx` (+ `.module.scss`) | `keyboardShortcuts.tsx` | **Solid, HEAD** (задача 10) | вкладка `AppKeyboardShortcutsTab` на колоночном слайдере; `ShortcutRow` = `Row.Title titleRight=<KeyCombo> titleRightSecondary` + `Row.Subtitle`, `KeyAlternatives` у Redo, `KEY_LABELS`/`IS_APPLE` и CSS-модуль дословно, ключи tweb. Состав — только сочетания, которые клиент обрабатывает (решение пользователя, без «Отложено»): Send — статичная строка Enter без `InlineSelect` и без подписи `Section.Messages.Caption` (нет `appSettings.sendShortcut`/`isSendShortcutPressed`), нет `JumpToInputStart/End` (композер не двигает каретку по PageUp/PageDown) и секции Other/`LockPasscode` (сочетания блокировки нет до задачи 18). React `settings/HotkeysSettings.tsx` снесён |
| `settings/EditProfile.tsx` | `editProfile.tsx` | React | своя вёрстка без `Section`; нет Usernames/PersonalChannel/ChatAutomation |
| `settings/AvatarCropper.tsx` | `avatarEdit.ts` (+ медиаредактор) | React | также у `NewGroupFlow`, `EditContactView`, `GroupEditFlow` |
| `settings/BirthdayModal.tsx` | `popups/birthday.tsx` | React | также у `EditContactView` |
| `settings/ConfirmDialog.tsx` | `confirmationPopup` | мост | тонкая обёртка над `popups/popupPeer.ts`; также у `useChatPopups`, `MediaEditor`, групповых экранов, `PinnedMessagesScreen` |
| `settings/kit.tsx` (478) | `row.ts` + `settingSection.ts` + `sliderTab.ts` (React-двойник) | React | см. § 8.3; **22 потребителя вне настроек** (группы, звёзды, премиум, `EditContactView`, `RightsEditor`, `QrModal`, `EmojiStatusPicker`) |
| `sidebarLeft/tabs/chatFolders.solid.tsx`, `editFolder.solid.tsx`, `includedChats.solid.tsx`, `editFolderShared.ts` | `chatFolders.tsx`, `editFolder.tsx` + `editFolderInput`, `includedChats.tsx`, `editFolderShared.ts` | **Solid, HEAD** (задача 24; `includedChats` — кусок задачи 25) | вкладки `AppChatFoldersTab`/`AppEditFolderTab` (`getInitArgs`, `deleteFolder` на конструкторе)/`AppIncludedChatsTab`; открывают строка корня на колоночном слайдере и меню папки/кнопка колонки папок — колоночным слайдером (`Sidebar.tsx::openColumnTab`, «назад» — к чатам). Список: заставка + `div.caption` + `btn-control` вне секций, `Filters` (строки `For` по `appState.folders`, подпись «All Bots»/«N chats and N groups» по зеркалу диалогов), `FiltersView` (радио `tabsInSidebar`). Редактор: галка ↔ ⋮ «Delete Folder», поле 12, категории `folder-category-button` с `bots`, чаты (до 4 + «Show N More»), ссылки `Row.usernames-username` + меню копировать/удалить (партиал `_usernames.scss` портирован). Нет: перетаскивания (О-19), рекомендованных (О-20), Archived/закреплённых (О-21), лимитов и `PopupLimit` (О-22 — тост `LimitReached`); вкладка ссылки — строка ниже (задача 25). React `ChatFoldersSettings`/`FolderEditor`/`FolderChatsPicker` удалены; провод `foldersManager.ts` починен (`bots`, `include_peers`/`exclude_peers`) |
| `sidebarLeft/tabs/sharedFolder.solid.tsx`, `inviteLink.ts`, `helpers/dom/shake.ts` | `sharedFolder.tsx`, `inviteLink.ts`, `helpers/dom/shake.ts` | **Solid, HEAD** (задача 25) | вкладка `AppSharedFolderTab` (Eventable, событие `delete`), открывает редактор папки (`openChatlistInvite`): клик по строке ссылки, новая ссылка (`.finally` → строка), отказ `ErrNoShareable` — вкладка без ссылки (`SharedFolder.NoChats`, вместо нашего тоста `Folder.Share.Empty`, снят). Разметка оригинала: заставка `Folders_Shared` (ассет tweb + PNG-фолбэк), `div.caption`, `Section «InviteLink»` > `InviteLink` (плашка `middle-ellipsis-element` + ⋮ «Copy Link»/«Delete Link»), селектор `AppSelectPeers` (`noSearch`, заголовок «N chats selected», подпись `SharedFolder.Edit.Subtitle`, строки по рейтингу, `cant-select` + подписи `SharedFolder.Cant.*`, тост + `shake`). Партиал `_inviteLink.scss` и `.cant-select` (base.scss) портированы. Нет: выбора чатов ссылки — галки, `editExportedInvite`, события `edit`, подтверждения на закрытии (О-23: строки выбора «трясутся»), кнопки «Share Link» (`shareUrlToPeers` — попап 2C); расшариваемы только публичные группы/каналы (`shareableChats`), `hasRights(invite_links)` не учитывается |
| `sidebarLeft/tabs/language.solid.tsx` | `language.tsx` | **Solid, HEAD** (задача 8) | список — `createSignal` + `For` + `Row.RadioField`/`RadioFieldTsx class="disable-hover"` + `Row.Title`/`Row.Subtitle` в `form` (`:98-154`), без `row.ts`. Расхождения (шапка файла): нет `TranslateSection` (#133 — обоснование сверено 2026-09-26: у `messages.translate` нет вызывающих, нет `usePremium`/`pickLanguage`, настройки перевода никто не читает); `langpack.getLanguages` через `managers.langPack` (кэш в менеджере); мёртвые `langs2`/`concat`/дедуп/`webLangCodes` не перенесены; `console.error('no language row')` снят — язык не из списка не отмечает ни одной строки. DOM против `14-left-22` (дамп старой базы): вместо `div > form` — `form` прямо в `-content`, у радио `span.radio-field.row-radio-field.disable-hover` (HEAD, § 7), у строки есть `.row-title` с именем (у старой базы имя — подпись радио). Пины — `language.solid.test.tsx` |
| `sidebarLeft/tabs/activeSessions.solid.tsx` | `activeSessions.tsx` | **Solid, HEAD** (задача 9) | JSX `Row class="session-row" clickable contextMenu` + `Row.Icon`/`Title titleRight`/`Midtitle`/`Subtitle`; клик → `AppSessionTab`, «Terminate» — контекстным меню строки (`danger`) и с экрана сессии через `confirmationPopup`; подпись `ClearOtherSessionsHelp` и кнопка — только при других сессиях; секция `AuthSessions.IncompleteAttempts` (`password_pending`, бэкенд флаг пока не ставит); опрос `sessions.list()` раз в минуту; ошибки — `getAuthorizationErrorLangKey`. Не перенесено (шапка файла): TTL (О-7), переименование устройства и `customDeviceModel` (О-9), бизнес-бот, подписка на `unconfirmed_authorizations_update`. Стиль строки — `.session-row` (tweb `_leftSidebar.scss:961-978`) вместо `.active-sessions-container` старой базы. Пины — `activeSessions.solid.test.tsx` |
| `sidebarLeft/tabs/session.solid.tsx`, `sessionInfoRow.solid.tsx`, `sessionDetails.module.scss` | `session.tsx`, `sessionInfoRow.tsx`, `sessionDetails.module.scss` (944b578e9) | **Solid, HEAD** (задача 9) | вкладка `AppSessionTab` (payload `{authorization, onTerminate?}`): `MediaHeader` (иконка платформы на плашке реестра, 100px), секция `Info` (Application/System/Location — `titleRightSecondary`, прочерк при пустом) + подпись `AuthSessions.View.LocationInfo` при известном месте, кнопка `AuthSessions.View.TerminateSession` при `onTerminate`, закрытие по успеху. Нет секции `AuthSessions.View.AcceptTitle` и `onSettingsChanged` (О-8); из модуля стилей — только классы экрана устройства (бизнес-бота нет). Пины — `session.solid.test.tsx` |

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
5. ~~**Нет перехода назад и параллакса.**~~ Снято задачей 28: корень — вкладка колоночного
   слайдера, оставшиеся React-экраны — его вкладки на мосту `scaffoldReactScreenTab`: въезд,
   выезд и параллакс у всех даёт `SidebarSlider` (пины — `settingsTabFrame.solid.test.tsx`,
   `Sidebar.settingsTab.test.tsx`). Вложенные саб-экраны кита внутри React-экрана (заблокированные,
   автоудаление, ключи доступа) по-прежнему едут переходом кита, а Esc закрывает вкладку целиком.
6. **Значение справа вместо подписи** (`value` → `row-title-right`), отсюда «Н..».
7. **Кнопки-действия — строки** (`Row accent/danger`), у tweb — `Button btn-primary btn-transparent`.
8. **Радио — галочка** (`Row selected`, отступление `kit.tsx:318-327`) или свой `RadioRow`.
9. **Свои CSS-модули** на месте портированных глобальных стилей (громкость, темы, сетки). Строки хоткеев
   сняты задачей 10: CSS-модуль там у самого tweb (`keyboardShortcuts.module.scss`), перенесён дословно.
10. **Момент сохранения**: у нас сразу, у tweb часть — на закрытии вкладки. «Уведомления» (задача 6)
    уже пишут типы чатов на закрытии (`NotifySection`, пин — `notifications.solid.test.tsx`),
    «Данные и память» (задача 7) — срок и предел кэша на `destroy` (`dataAndStorage.solid.test.tsx`).

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
- [ ] «Данные и память» (задача 7): первая строка — тумблер; выключили — Photos/Videos/Files
      серые и не открываются; «Photos» въезжает вкладкой с четырьмя тумблерами; сброс серый на
      дефолтах; «Clear» справа в строке «Cached files»; сдвинули срок кэша, закрыли вкладку —
      значение сохранилось. Пины — `dataAndStorage.solid.test.tsx`, `autoDownload.solid.test.tsx`;
      стенд — не прощёлкан (эксклюзивно у другого агента в момент задачи).
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
