# Фронтовый паритет с tweb — аудит СТИЛЕЙ И АНИМАЦИЙ

**Дата:** 2026-08-07
**Задача:** зафиксировать расхождения нашего фронта (`web-client/`) с tweb по **дизайн-токенам, темизации, стилям компонентов и анимациям**, как рабочий бэклог для доведения до «1:1 из tweb».
**Метод:** 5 параллельных разведок по SCSS/анимационным поверхностям; чтение обеих кодовых баз.
**Парный документ:** [функциональный паритет](./2026-08-07-frontend-tweb-parity-audit.md).

**Базовые пути:**
- Наш фронт: `/Users/denisurevic/Documents/messenger-denis/web-client/src/`
- Референс tweb: `/Users/denisurevic/Documents/tweb/src/`

**Легенда:** **(A)** нет вовсе · **(B)** есть, но значения/механизм иначе · **(C)** отсебятина (в tweb такого нет).
**FM** = реализовано на **framer-motion** там, где в tweb чистый CSS.

> `file:line` — снимок на дату аудита; проверять по контексту.

---

## Оглавление
1. [Дизайн-система / токены / темизация](#1-дизайн-система--токены--темизация)
2. [Пузыри / лента: стили и анимации](#2-пузыри--лента-стили-и-анимации)
3. [Глобальные переходы / навигация / ripple](#3-глобальные-переходы--навигация--ripple)
4. [UI-кит (базовые компоненты)](#4-ui-кит-базовые-компоненты)
5. [Медиа-вьюер / сторис / звонки: анимации](#5-медиа-вьюер--сторис--звонки-анимации)
6. [Сквозные проблемы](#6-сквозные-проблемы)
7. [Приоритеты](#7-приоритеты)

---

## 1. Дизайн-система / токены / темизация

Наши: `styles/{_tokens,_variables,_foundation,_functions,_mixins}.scss`, `index.scss`, `theme.ts`, `components/peerColor.ts`, `core/dialogToChat.ts`.
tweb: `scss/{base,variables,style,fonts}.scss`, `scss/components/{_normalize,_typography}.scss`, `scss/partials/_scrollable.scss`, `scss/mixins/_splitColor.scss`, `helpers/themeController.ts`, `config/themePresets.ts`, `lib/appManagers/utils/peers/getPeerColorById.ts`.

### Ключевой архитектурный вывод (B, глобально)
- **tweb** — двухслойная система: (1) семантические цвета (`--primary-color`, `--surface-color`, `--danger-color`, `--secondary-text-color`, `--background-color`, `--border-color`…) **инжектятся в рантайме JS** через `themeController.ts` из `colorMap`, а из них миксином `splitColor` порождаются производные `--light-*`/`--dark-*`/`--light-filled-*`/`*-rgb`; (2) не-цветовые токены (шкалы шрифтов/line-height/transitions/avatar-colors) статически в `:root` (`base.scss`).
- **клон** — один плоский статический набор `--tg-*` в `_tokens.scss`. Нет производных, нет `-rgb`, нет `--light-*/--dark-*`, нет рантайм-инъекции. `_functions/_variables/_mixins.scss` — порт tweb, но **эмитят 0 CSS**.
- **Переключатель темы:** tweb — CSS-класс `.night` на `<html>` + scope `.chat`; темы `day/night/light/tinted`. Клон — атрибут `data-theme` со значениями `classic/day/night/dark` (`_tokens.scss:74,87,136`).

### Цветовая палитра
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Семантические имена токенов | нет `--primary/secondary/surface/danger/border/background-color`; свой словарь `--tg-*` | `themeController.ts` colorMap |
| A | Danger/error токен | нет `--tg-danger/error/red` (grep 0) | `--danger-color` day `#df3f40` / night `#ff595a` + `--light/dark-danger-color` |
| A | Производные `--light-*/--dark-*/*-rgb` | нет (система `splitColor`) | `mixins/_splitColor.scss` |
| B | accent/primary | `classic #7d63e8` (фиолет), `day #3390ec`, `night #8774e1`, `dark #5ea7e8` | `day #3390ec`, `night #8774E1` |
| B | primary-text | `--tg-textPrimary #1c1c1e` / `#fff` | `#000000` / `#ffffff` |
| B | secondary-text | `--tg-textSecondary #82868d` / `#aaaaaa` | `#707579` / `#aaaaaa` |
| B | green | `--tg-green #4dcd5e` / `#61d36b` | `#70b768` / `#5CC85E` |
| B | link | `--tg-link #5b51d8` (classic) / `#8774e1` | `#00488f` / `#8774E1` |
| C | Тема `classic` (фиолет accent `#7d63e8`, appBg `#e7ddf5`, bubbleOut `#ede9fc`) | есть | в tweb нет; дефолт светлой = `day`-blue |
| C | Тема `dark` (near-black `#0e0e0e`, accent `#5ea7e8`) | есть | не совпадает ни с `night`, ни с `tinted` |
| C | Токены `--tg-composeShadow/searchCardShadow/plateShadow/skelBase/skelHi/accentGradient` | свои | у tweb `--skeleton-color`/`--menu-box-shadow` |

### Peer-colors
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B/C | Палитра | `peerColor.ts PEER_COLORS = ['#e17076','#7bc862','#65aadd','#a695e7','#ee7aae','#6ec9cb','#faa774']` (старая палитра) | `DialogColorsFg = ['#CC5049','#D67722','#955CDB','#40A920','#309EBA','#368AD1','#C7508B']` (`getPeerColorById.ts:5`) |
| B | Хэш выбора | хэш строки-имени `%7` | `abs(peerId)%7` / `getPeerColorIndexById` (маппинг) |
| A | Серверная система `--peer-N` градиентов | нет | `getPeerColorById.ts:90-146` |
| ✓ | Avatar-градиенты | **1:1** (`dialogToChat.ts:10-16` = tweb `base.scss:168-176`) | совпадают |

### Типографика
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Токен шрифта | нет; `body{font-family:Roboto,…}` захардкожено (`index.scss:52`), lazy `@fontsource/roboto` | `--font-regular/--font-monospace/--font-rounded` (`base.scss:126-128`), self-hosted woff2 |
| A | Шкалы размеров/line-height | нет; хардкод в компонентах | `--font-size-10…24`, `--line-height-11…24`, `--messages-text-size:16px`, `--messages-line-height:1.3125` (`base.scss:95-115`) |
| A/C | Weights | нет токена; грузится Roboto **700** | `--font-weight-bold:500` (bold = 500!) → риск, что наш bold тяжелее |
| A | Базовый typography-reset | нет глобального line-height | `html{line-height:1.5}`, `strong{font-weight:500}` |

### Радиусы / отступы / геометрия
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| ✓ | SCSS-константы радиусов | `_variables.scss` == tweb `variables.scss` (`$border-radius:12px`, `-medium:16px`, `-big:24px`, `$button:16px`, bubble 15/5) | совпадают |
| B | Но: константы мертвы | «эмитит 0 CSS» (`index.scss:3`); радиусы хардкодятся в компонентах | tweb раздаёт через CSS-var `--chat-input-border-radius:24px` и т.п. |
| C | Chat-input геометрия | одна `--chat-plate-height:48px` | `--chat-input-height:3rem`, `--chat-bubbles-padding`, `--plates-gap`, `--message-*-size` (`base.scss:145-165`) |

### Прочее
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| C | Z-index | раздутая шкала: 500/1200/1300/1400/1500/2100/3000/4000/4090/4100/4101/4200/5000/9999 (MUI-наследие), нет единого токена | плоская 0…6, спецвысокие единичны (999/10000/100000) |
| A/B | Скроллбары | нет `--scrollbar-color`; дублируется по компонентам (`ChatList.module.scss:9-21`, `Sidebar.module.scss:94-102`), цвет из `--tg-textFaint` | централизованно `.scrollable` + `--scrollbar-color` (day `rgba(0,0,0,.2)`) (`_scrollable.scss`), `.no-scrollbar` |
| A/B | CSS reset | normalize.css нет; универсальный `*{box-sizing:border-box}` (`index.scss:59-61`); нет `-webkit-tap-highlight-color`/`text-size-adjust`/`is-ios`-фиксов/глоб. `user-select:none` | normalize.css v7; box-sizing точечный `content-box`; глоб. tap-highlight/text-size-adjust/user-select (`base.scss:389-583`) |
| ✓ | rem-база | `html{font-size:16px}` (`index.scss:17`) | `16px` (`base.scss:427`) — совпадает |
| B | Единицы | смесь px/rem (`--chat-plate-height:48px`) | почти всё в rem |

---

## 2. Пузыри / лента: стили и анимации

Наши: `components/messages/{MessageRow,ChatFeed,MessageBubbles,AlbumGrid}.module.scss`, `bubbleParts/primitives.tsx`, `MessageContent.tsx`, `components/animations/bubbleAnimations.tsx`, `RichText.module.scss`.
tweb: `scss/partials/{_chatBubble,_chat,_chatVariables,_transition,_reaction}.scss`, `base.scss`, `components/chat/bubbles.ts`.

### Форма пузыря
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| ✓ | Радиусы big/med + порядок корнеров | `BUBBLE_R_BIG=15/MED=5`, `bubbleRadius()` (`primitives.tsx:71-80`) | `$bubble-border-radius-big:15/-medium:5` (`_chatBubble.scss:3354-3518`) — 1:1 |
| ✓ | Хвост (tail) | SVG 11×20, offset −8.4px, `translateY(1px)`, цвет бабла (`primitives.tsx:87-108`) | 11×20, `-8.4px`, `translateY(1px) scaleX(-reflect)`, `z-index:-2` (`_chatBubble.scss:2089-2106`) — 1:1 |
| B | Сквош последнего угла | `last=0` всегда | только при `.can-have-tail`; иначе сохраняет `big` (`_chatBubble.scss:3392,3515`) |

### Цвета / тени / фон
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | **Тень пузыря** | нет ни у `.textBubble`/`.mediaInner`/`.fileBubble` — баблы плоские | `.bubble-content{box-shadow:0 1px 2px 0 rgba(16,35,47,.15)}` (`_chatBubble.scss:365`) |
| C | Палитра out-бабла | `#ede9fc` (лаванда) / `#353246` dark | `--message-out-background-color` (day — зеленоватый) |
| B | Фон пилюли даты/сервиса | статичный `--message-highlighting-color` = `rgba(0,0,0,.24)`/`rgba(255,255,255,.16)` | динамически тинтуется от обоев |
| ✓ | Обои под баблами | `ChatBackground.tsx` (@twallpaper) | аналог |

### Отступы / ширина
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| ✓ | Отступы в группе / между | 2px / 6px (`--row-mb:.125rem`, `[data-last].375rem`) | `$bubble-margin:2px/-big:6px` — совпадает |
| B | Ширина текст-бабла | `min(420px, 80%)` (`MessageRow.module.scss:229`) | `--max-width:85%` без px-кэпа |
| B | Ширина медиа | `min(340px, 82%)` (`:92-133`) | `min(420px,100%)`, альбом `min(451px,100%)` (`_chatBubble.scss:890-914`) |

### Sticky-аватар
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Позиция/привязка | `bottom:72px` хардкод, без transition (`ChatFeed.module.scss:105-119`) | `bottom:calc(--chat-padding-bottom + …)`, `transition:bottom .25s` — следует за высотой композера (`_chatBubble.scss:48-55`) |

### Анимации ленты
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B/FM | Появление бабла | FM `scale .8→1 + opacity, .3s cubic-bezier(.4,0,.2,1)` (`bubbleAnimations.tsx:102-137`) | CSS-класс `zoom-fade`, `--bubble-transition-in .3s cubic-bezier(.4,0,.2,1)` (`_chatBubble.scss:3210-3224`) |
| B | transform-origin появления | bottom-corner (`MessageRow.module.scss:19,34`) | left/right-**center** (`_chatBubble.scss:3362,3476`) |
| B | Ladder-стаггер | 30мс/шаг, кэп 12 (`ChatFeed.tsx:213`) | 40мс/шаг (10мс дозагрузка) (`bubbles.ts:10364`) |
| B/A | **Живые/оптимистичные баблы не анимируются** | ladder только для первой пачки; live-append мгновенно (`ChatFeed.tsx:211-213`) | `animateAsLadder` и для нового бабла (`bubbles.ts:10912`) — grow всегда |
| B/FM | Highlight-flash перехода | FM opacity `[0,.5,.5,0]`, 2s, цвет accent-30% (`MessageRow.tsx:207-215`) | `@keyframes bubbleSelected` пик 25%=1, 2s linear, цвет `--message-highlighting-color` (`_chatBubble.scss:6-18`) |
| B/A | Sticky-дата fade | только `transition:top .22s`, без затухания (`ChatFeed.module.scss:16-24`) | real/fake-механизм `opacity .3s` при `.is-sticky` (`_chatBubble.scss:479-531`) |

### Реакции
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| ✓ | Геометрия чипа + transition подложки | 30px/radius30/pad8, `::before scale(0)→1 opacity .3s`, счётчик 15/700/18 (`MessageRow.module.scss:354-440`) | `_reaction.scss:81-217` — совпадает |
| A | «Around»-эффект активации | нет | `.reaction-sticker-activate` лотти (`_reaction.scss:34-39`) |
| B | Платная ⭐-реакция | `linear-gradient(#ffaa00,#ffcd3a)`, нет burst | `--chosen #FFBC2E` сплошной, `effect-active scale3d(1.5)` + shadow (`_reaction.scss:165-206`) |

### Прочее
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Спойлер | CSS `filter:blur(5px)` + reveal по клику (`RichText.tsx:84-91`) | анимированные частицы-точки через worker-canvas (`dotRenderer.ts`) + reveal от точки клика |
| B | Unread-разделитель | `margin-bottom:12px` (коммент «tweb $bubble-overflow-big» неверен), фон `--tg-bubble`, lh30px (`ChatFeed.module.scss:129-143`) | `margin-bottom:$bubble-overflow-big≈3px`, фон `--surface-color`, lh2.1 (`_chatBubble.scss:238-258`) |
| B | Slide бабла при выделении | `translateX(34px)`, симметрично .3s (`MessageRow.module.scss:73-88`) | `translateX(2.5rem=40px)`, .3s/.25s (`_chat.scss:1181-1204`) |
| A | Аватар при выделении | не двигается | `translate3d(40px) scale3d(.76)` (`_chat.scss:1201-1203`) |
| B | Позиция чекбокса выделения | по центру высоты (`MessageRow.module.scss:64-70`) | у низа бабла + `box-shadow:0 0 3px rgba(0,0,0,.4)` (`_chatBubble.scss:306-337`) |
| B/FM | Selection-band заливка | FM opacity 0→1 .2s, accent-30% (`MessageRow.tsx:216-224`) | `@keyframes fade-in-opacity .2s` + backwards на снятие, `--message-highlighting-color` (`_chatBubble.scss:268-282`) |

---

## 3. Глобальные переходы / навигация / ripple

Наши: `motion.ts`, `config/transitions.ts`, `components/shell/ShellLayout.tsx`, `UserInfoPanel.tsx`, `shared/ui/Tabs/TabSlide.tsx`, `shared/ui/Popup/Popup.tsx`, `shared/ui/Menu/Menu.tsx`, `shared/ui/Ripple/*`, `shared/ui/Button/Button.tsx`, `core/navigation/navigationStack.ts`, `helpers/liteMode.ts`, `App.tsx`.
tweb: `components/{transition,slider,ripple,appNavigationController}.ts`, `config/transitions.ts`, `scss/base.scss`, `scss/partials/{_transition,_slider,_ripple,_rightSidebar,popups/_popup}.scss`, `helpers/liteMode.ts`.

**Общий вывод:** тайминги/изинги вынесены в `motion.ts` и совпадают (`cubic-bezier(.4,0,.2,1)`, 300ms in / 250ms out, popup .15s). Popup и Menu — почти 1:1. Но механика и особенно **ripple** и **reduce-motion гейт** расходятся.

| # | Кат | Тема | У нас | В tweb |
|---|-----|------|-------|--------|
| 1 | B | Механизм | framer-motion (JS-интерполяция на main-thread), ~80 файлов; тайминги в `motion.ts` | кастомный `TransitionSlider` — CSS-классы `.active/.from/.to` + чистый CSS/keyframes, JS слушает `transitionend` (`transition.ts`) |
| 2 | C+B | Открытие чата (mobile) | слайд `x:0→-100%`/`100%→0`, **0.26s** обе стороны, без параллакса/затемнения (`ShellLayout.tsx`) | `slideNavigation` с параллаксом `-width*0.25` + `brightness(80%)`, .3s/.25s |
| 3 | B | Правая панель (desktop) | анимируем **`width:0→404px`+opacity** (reflow!), in/out 0.3 (`UserInfoPanel.tsx`) | `transform:translate3d` фикс-ширины + встречный сдвиг чата, .3s/.25s (`_rightSidebar.scss`) |
| 4 | B | Табы | `0.3s cubic-bezier(.4,0,.2,1)` (`TabSlide.tsx`) | `0.2s ease-in-out` (`--tabs-transition`, `base.scss:60`) + анимир. подложка активного таба |
| 5 | A✓ | Попапы/меню | Popup y48/opacity **.15s**; Menu scale.8 **.2s** | **1:1** (48px=3rem, `--popup-transition-time .15s`, `--btn-menu-transition .2s`) |
| 6 | **B+C** | **Ripple** | логика 1:1 (`useRipple.tsx`), но импортируется в **4 местах** (`ChatListItem`, `IconButton`); **Button без ripple**; **нет liteMode/reduce-motion гейта**; нет mobile-профиля (.4s/scale.27); только ЛКМ | `ripple(...)` в **51 месте** (все `.btn/.row/.btn-menu-item`); гейт `liteMode.isAvailable('animations')`; mobile `--ripple-duration:.4s/start-scale:.27`; ЛКМ+ПКМ |
| 7 | B | Навстек/back | урезанный LIFO поверх `popstate` (`navigationStack.ts`) | полноценный `appNavigationController` (Navigation API, ~30 типов слоёв, onEscape, swipe-back Safari) |
| 8 | B | reduce-motion гейт | гасит **только framer** (`MotionConfig`, `App.tsx:181`); `data-reduce-motion` на `<html>` **без единого CSS-правила**; `liteMode.ts` портирован, но почти не подключён → CSS/ripple/keyframes играют всегда | двойной гейт: JS `liteMode.isAvailable` (63 файла) + CSS `body.animation-level-0` (`transition:none!important`) |

---

## 4. UI-кит (базовые компоненты)

Наши: `shared/ui/{Button,IconButton,Checkbox,Slider,Spinner,Badge,Avatar,Menu,Popup,Ripple}/*`, `components/{TgSwitch,Preloader,RadialProgress,VerifiedBadge,PremiumBadge,DialogSkeleton}.tsx`, `components/settings/{kit,ConfirmDialog}.*`, `components/shell/GlobalOverlays.tsx`.
tweb: `scss/partials/{_button,_checkbox,_row,_avatar,_badge,_preloader,_tooltip,_chatToast,_ckin}.scss`, `scss/partials/popups/_popup.scss`, `components/{preloader,rangeSelector}.ts`.

### Кнопки
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Высота | `min-height:50px` | `$button-height:3rem(48px)` |
| B | Радиус | `12px` | `$button-border-radius:16px` |
| B | Uppercase | lowercase (опция) | `.btn-primary` всегда uppercase |
| B | Шрифт | `15px/600` жёстко | наследуется, `font-weight-bold(500)` |
| C | Hover | `filter:brightness(1.05)` | фон → `--dark-primary-color` |
| B | Disabled | `opacity:0.4` | `--disabled-opacity:.3` |
| B | Transition | `.15s` | `.25s cubic-bezier(.4,0,.2,1)` |
| A | Варианты `.btn-transparent`/`.btn-primary-transparent` | нет | есть |
| A | Ripple на кнопке | нет | есть |

**IconButton:** совпадает форма (круг/pad .5rem); (B) hover-цвет `--tg-hover` (rgba(0,0,0,.035)) vs tweb `--light-secondary-text-color` (плотнее); (C) `size="small"` pad.3125rem — «MUI parity», в tweb нет.

### TgSwitch / чекбоксы / радио
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| ✓ | TgSwitch размеры | трек 31×14, thumb 20, offset 3 | совпадает |
| B | TgSwitch анимация | свойство **`left`**, `.14s cubic-bezier(.22,.75,.7,1.3)` | **`transform`**, `.1s`, `padding 0 .25rem` (bounce-запас) |
| B | TgSwitch цвета | thumb `--tg-sidebarBg`, on `--tg-accent`(фиолет), off `#c4c9cc` | thumb `--surface-color`, on `--primary-color`(синий), off `--secondary-color` |
| A | TgSwitch restriction (красный+лок) | нет | `.checkbox-field-toggle-restriction` |
| B | Чекбокс | `size18`, border **1.5px**, radius 31%, галочка FM pathLength | round `24px`/квадрат `20px`, border **2px**, radius 5px, галочка `stroke-dasharray`, `stroke-width 3.75` |
| C/A | Радио | статичный глиф `radioon/radiooff` **без анимации** | CSS `::after scale(0)→scale(1) .1s`, кольцо 22px |

### Row / меню / тултипы
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Row высота | `padding:9px 12px`, без min-height | `min-height:3.5rem(56px)`, варианты 48/72px |
| B | Row иконка | в потоке, gap16, 24px | абсолютная (`inset-inline-start:1rem`), текст `padding-inline-start:4.5rem` |
| A | Row ripple | нет (только CSS hover) | `.row-clickable` реальный ripple |
| B | Row радиус clickable | `12px` всегда | `16px`, только не-мобилки |
| C | Тень меню | `0 12px 44px rgba(80,60,160,.2)` (крупная фиолетовая) | `--menu-box-shadow:0 0 10px rgba(0,0,0,.15)` |
| B | Фон меню | `rgba(255,255,255,.82)` blur50 | `rgba(surface-rgb,.85)` blur50 |
| ✓ | Menu появление | scale.8 .2s cubic-bezier(.4,0,.2,1) | `--btn-menu-transition` — совпадает (у нас нет transform-origin по якорю) |
| B | danger-пункт | `color:#ff595a` (текст) | `hover-background-effect(red)` (фон при hover) |
| A | Разделители `hr` в меню | нет | `.btn-menu hr{opacity:.6}` |
| A | subtitle/badge/submenu в пункте | нет (icon/label/right/danger) | есть |
| A | Общий Tooltip-компонент | нет; спец-реализации в Composer/MarkupTooltip | `.tooltip` (pad `.5625rem 1rem`, 15px, `rgba(29,29,29,.74)` blur25, radius15, нотч 19×8, scale.9→1 .2s) |

### Бейджи / аватары
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| ✓ | Unread-счётчик | size22/pad7/radius half/15px/#fff — **1:1** | совпадает |
| B | Unread цвет | `--tg-badge` фиолет, muted `--tg-textFaint` | `badge-primary`(синий)/`badge-gray` |
| A | Размерные варианты бейджа 18/20/24 | один размер | `.badge-18/-20/-24` |
| B | Verified | `#3aa0e3` жёстко | `fill:var(--primary-color)` (за темой) |
| B | Premium | `#a45ee6` | `--premium-color:#9275ff` |
| ✓ | Avatar форма/градиенты hex | круг; `GRADIENTS` == tweb hex | совпадает |
| B | Avatar инициалы | `size*0.42`, 600, без uppercase | `1.25rem/multiplier`, bold, uppercase |
| B | Avatar online-точка | `size*0.26`, зелёная `#4dcd5e` фикс | фикс 14×14, `border 2px surface`, цвет `--primary-color` |
| B | Avatar peer-индекс | `abs(id)%7` | `getPeerColorIndexById` (маппинг) |
| C | Вторая палитра пира `peerColor.ts` | плоские цвета по хешу имени | в tweb нет — только градиенты по id |
| C | Saved/service-иконки | инлайновый SVG | глиф иконочного шрифта + saved-градиент |
| C | Именованные размеры `AVATAR_SIZE` | своя семантика xs/sm/md/lg/dialog/profile | числовые классы `.avatar-16…162` |

### Слайдеры / лоадеры / тосты
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| C | Slider механизм | нативный `input[type=range]` | div `.progress-line` (`__filled`+`__seek`) |
| B | Slider thumb | 18×18 | `--thumb-size:12px` (плеер 13) |
| A | Slider focus-scale | нет | `scale(1.125) .125s` |
| B | Slider трек радиус | 2px | 4px |
| C | Spinner | border-кольцо `.7s` (калька MUI) | в tweb нет; везде SVG `preloader-circular` `1s` |
| ✓ | Preloader (SVG) | дуга 75% round `rotate 1s` | `stroke-dasharray:93.6375,124.85`, `rotate 1s` — совпадает |
| ✓ | RadialProgress | `viewBox 27 27 54 54`, `dash=max(5,progress*TOTAL)` | ровно формула `preloader.ts:310` |
| B | RadialProgress stroke/крутёж | `2.5`, нет close/download внутри | `2`, диск `rgba(0,0,0,.3)` + `rotate 2s` + кнопки |
| B/C | Скелетоны | `linear-gradient` shimmer 1.4s, токены `--tg-skelBase/Hi` (свои) | `_shimmer.scss` (своя механика) |
| B | Тост позиция | `fixed; top16; left50%` (центр сверху окна) | под топбаром чата (`top:var(--chat-padding-top)`, absolute в `#column-center`) |
| C | Тост вид | pad10/20, radius14, `rgba(0,0,0,.78)` blur8, shadow `0 6px 24px` | `.tooltip`: radius15, `rgba(29,29,29,.74)` blur25, shadow `0 2px 16px`, нотч |
| A | Actions/ссылки в тосте | только текст | `a{underline}` + action-кнопка справа |

**Popup/ConfirmDialog:** (B) Popup card `border-radius:24px` vs tweb `--popup-border-radius:2.5rem(40px)`; слайд снизу тайминг совпадает. ConfirmDialog — карточка 360px/radius16/scale.92→1 .2s vs tweb тот же `.popup` (radius 24-40, слайд снизу, без scale).

---

## 5. Медиа-вьюер / сторис / звонки: анимации

Наши: `components/messages/MediaLightbox.{tsx,module.scss}`, `VideoControls.module.scss`, `StoryViewer.{tsx,module.scss}`, `CallScreen/GroupCallScreen/LivestreamScreen.{tsx,module.scss}`, `RealMediaBubble.tsx`, `LottieSticker.tsx`, `core/effects/emojiEffects.ts`.
tweb: `components/mediaViewer/*.scss`, `components/stories/viewer.{tsx,module.scss}`, `scss/partials/{_ckin,_call}.scss`, `helpers/gradientRenderer.ts`, `components/chat/stickerAnimation.ts`.

### Медиа-вьюер
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| ✓ | **Open-from-thumbnail morph** | добросовестный порт `setMoverToTarget` (`MediaLightbox.tsx:226-268`), `OPEN_MS=200`, контр-скейл аспектера, эллиптический радиус | `--open-duration:.2s` (`mediaViewer.scss:280-436`) — совпадает |
| C | Backdrop | `rgba(0,0,0,0.92)` | `rgba(0,0,0,.88)` |
| B | Переход между медиа | fade `opacity 0→1 0.15s` на месте (`MediaLightbox.tsx:453-466`) | slide-карусель `transform .35s ease` (`--move-duration`, `mediaViewer.scss:374`) |
| C | Зум | framer-spring `{stiffness260,damping30}` | JS+CSS transform (не spring) |
| B/C | Прогресс-линия видео | трек 4px, thumb 12px `.15s` (`VideoControls.module.scss:49-93`) | трек 2px→5px (SVG clip-path), thumb 5→17px `.1s` (`mediaViewer.scss:1053-1139`) |
| C | Буфер видео | слой `rgba(255,255,255,.55)` | `opacity:.3` (`_ckin.scss:379`) |
| A | current-time tooltip + speed-drag | нет | `mediaViewer.scss:911-1117` |

### Сторис
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Появление вьювера | overlay opacity + карточка scale .9→1 .25s (`StoryViewer.tsx:117-132`), без морфа | морф из rect кружка + полёт аватара, `250ms cubic-bezier(.4,0,.6,1)` (`viewer.tsx:3200-3257`) |
| B | Прогресс-бары | **жёстко 5s** `storyFill` linear (`StoryViewer.module.scss:72-81`) | `--progress` из JS, привязан к длительности видео (`viewer.tsx:247,1256`) |
| C | Сегменты | h2px, gap3, без тени | h.125rem + `box-shadow 0 0 3px rgba(0,0,0,.2)` (`viewer.module.scss:220-243`) |
| A/B | Переход между группами | мгновенная смена индекса, соседних нет | **3D-cube** `rotateY(90deg)` `--transition-time:.3s` + peeking-соседи `scale .33` (`viewer.module.scss:31-76`) |
| C | Blur-фон | сплошной `bg` инлайном | `#000` + shadow-градиенты (`viewer.module.scss:459`) |

### Blur-preview / стикеры
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B/C | LQIP медиа в ленте | base64-JPEG bg + **shimmer-полоса** `mediaShimmer 1.25s`; img без opacity-fade (`RealMediaBubble.tsx:97-198`) | opacity-fade blur→полное `transition opacity` (`mediaViewer.scss:321-356`) — shimmer у tweb нет |
| B/A | Lottie appear/loop | `LottieSticker.tsx` — только заглушки, `needFadeIn` не портирован | `wrapSticker` с `needFadeIn`/`onFirstFrame` |
| C | Эмодзи-эффекты | свои 2D-canvas частицы (`emojiEffects.ts`), ~1.2-1.8s | реальный TGS-эффект-стикер + `vibrate(100)` (`stickerAnimation.ts:133`) |

### Звонки
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | **Фон-градиент** | CSS `linear-gradient` 4 хардкод-цвета + framer `backgroundPosition` дрейф 16s linear (`CallScreen.module.scss:16-21`) | **`ChatBackgroundGradientRenderer`** — процедурный iOS-swirl на canvas (swirl-трансформация + 8 точек), 3-canvas кроссфейд `opacity .6s`, easeOutQuad-морф (`gradientRenderer.ts`, `_call.scss:72-102`). В клон **не перенесён** |
| C | Появление/сворачивание экрана | framer scale 1.04→1 opacity 0.3s (`CallScreen.tsx:100-106`) | popup/layer-механика `--transition-standard-in`, контент fade |
| A/B | Mic-кнопка | swap двух статичных иконок (`CallScreen.tsx:202-206`) | анимир. Lottie `GroupCallMicrophoneIconMini` морф muted↔unmuted (`call/index.ts:426-556`) |
| C | Group/Livestream градиент | плоский CSS `linear-gradient` хардкод (`GroupCallScreen.module.scss:137`) | те же canvas-градиенты |

---

## 6. Сквозные проблемы

1. **Акцент по умолчанию — фиолетовый** (`_tokens.scss:13 --tg-accent:#7d63e8` в дефолтной `classic`), в tweb дефолт светлой темы — **синий `#3390ec`**. Это красит ВЕСЬ кит: кнопки, тумблер-on, чекбокс/радио-fill, бейджи, verified, реакции, highlight. (Синий у нас вынесен в отдельную тему `[data-theme='day']`.)
2. **framer-motion вместо CSS** — появление баблов, highlight-flash, selection-band, переходы панелей/табов/попапов, call-фон, зум-вьювера. JS-интерполяция на main-thread вместо композитора; часть таймингов асимметрии in/out потеряна (.3/.3 вместо .3/.25).
3. **reduce-motion / powerSaving гейт неполный** — гасит только framer; CSS-анимации (ripple, `storyFill`, `mediaShimmer`, call-дрейф, все SCSS-transitions) играют всегда. `data-reduce-motion` на `<html>` без единого CSS-правила; `liteMode.ts` портирован, но не подключён.
4. **Ripple почти не разведён** — логика 1:1, но охват 4 файла vs 51 в tweb (Button/строки настроек/пункты меню/ряды — без ripple), нет liteMode-гейта и mobile-профиля.
5. **Нет производных цветовых токенов** (`--light-*/--dark-*/*-rgb`) и семантических имён — любой скопированный из tweb SCSS, полагающийся на `rgba(var(--primary-color-rgb),.4)` или `var(--light-primary-color)`, не заработает.
6. **Собственные крупные цветные тени** (меню `0 12px 44px rgba(80,60,160,.2)`, compose) вместо нейтральных компактных tweb.
7. **Раздутая z-index-шкала** (до 9999) — наследие MUI, рассинхрон с плоской 0…6 tweb.
8. **Хардкод значений вместо токенов** — размеры/радиусы/высоты в компонентах, при том что SCSS-константы-порт «эмитят 0 CSS».

---

## 7. Приоритеты

**Дёшево + заметно (быстрые визуальные победы):**
- Тень пузыря `box-shadow:0 1px 2px rgba(16,35,47,.15)` (§2 A).
- Ширины медиа 340→420 / текст 80%+420px → 85% (§2 B).
- Unread-разделитель: `margin-bottom` 12px→3px, фон surface (§2 B).
- Нейтрализовать тени меню/компоуза под tweb (§6.6).
- Тост: перенести под топбар + оформить как `.tooltip` (§4).
- Кнопки: высота 48/радиус 16/uppercase/disabled .3/hover через фон (§4).
- Слайдер thumb 18→12 + focus-scale (§4).

**Системные (отдельные спеки, крупный эффект):**
- **Ripple повсеместно** + liteMode-гейт + mobile-профиль (§3.6) — самое заметное тактильно.
- **reduce-motion сквозной гейт** — CSS-правило на `[data-reduce-motion]`/`animation-level-0`, подключить `liteMode` к анимациям (§3.8, §5.7).
- **Call-градиент** — портировать `ChatBackgroundGradientRenderer` (iOS-swirl canvas + 3-canvas кроссфейд) вместо CSS linear-дрейфа (§5).
- **Живые баблы** — включить grow-появление для optimistic/incoming (§2 B/A).
- **Правая панель на десктопе** — `transform` вместо анимации `width` + встречный сдвиг чата (§3.3).
- **Токен-система** — ввести семантические имена + производные `--light-*/--dark-*/*-rgb` (или отказаться от копирования tweb-SCSS) (§1).

**Средние:**
- Сторис: морф из ряда + полёт аватара + 3D-cube между группами + прогресс по длительности видео (§5).
- transform-origin появления бабла (bottom→center), ladder 30→40мс (§2 B).
- Спойлер: частицы-точки вместо blur (§2 B).
- Mic-кнопка звонка: lottie-морф (§5 A/B).
- Медиа-вьюер: slide-карусель между медиа вместо fade (§5 B).
- Sticky-дата fade + sticky-аватар привязка к композеру и slide/scale при выделении (§2 B/A).
- Чекбокс/радио: border 2px, анимация галочки/точки как tweb (§4 B/A).
- Единая z-index-система; централизованный скроллбар + normalize (§1, §6.7).
- Дефолтный акцент → синий (или явно принять фиолетовую тему как продуктовое решение) (§6.1).

---

*Аудит на 2026-08-07. Хорошо портированы: радиусы/хвост/отступы пузырей, геометрия реакц-чипа, unread-бейдж, Preloader/RadialProgress (SVG), open-from-thumbnail вьювера, avatar-градиенты-hex. Сильнее всего расходятся: токен-система (плоская vs двухслойная рантайм), call-градиент, reduce-motion гейт, ripple-охват, сторис-переходы.*
