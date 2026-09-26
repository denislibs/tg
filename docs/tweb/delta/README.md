# Дельта tweb `e52b5d931` → `812502980`: карта и роадмап переноса

2026-09-26 пользователь обновил исходники tweb (`/Users/denisurevic/Documents/tweb`) с `e52b5d931`
(2026-07-26) до `812502980`: 257 коммитов без мержей, 3182 файла, +185 тыс. строк. Весь `docs/tweb/`,
все планы и всё уже портированное сделаны по `e52b5d931`. Неподвижная копия старой базы лежит в
`/Users/denisurevic/Documents/tweb-e52b5d931` — ею пользуются задачи, начатые по старым планам.

Разбор по коммитам — пять файлов, в каждом таблица «коммит → подсистема → суть для нас → что у нас →
действие → размер → пересечение с программой» и сводка части:
[`part-1.md`](part-1.md) · [`part-2.md`](part-2.md) · [`part-3.md`](part-3.md) ·
[`part-4.md`](part-4.md) · [`part-5.md`](part-5.md). Списки коммитов — `commits-part-N.txt`.
«У нас» сверено по `origin/main` = `0a1fbba4` и веткам идущих программ.

## Итог

| Действие | Коммитов | Смысл |
|---|---|---|
| PORT | 100 | переносить |
| DOC | 24 | поведение у нас не меняется, устарели адреса или описание в доке |
| SKIP | 113 | не переносим: звонки и E2E-конференции, Stars/Gram, Communities, реклама, сборки tweb (`Build`), тест-инфраструктура и песочница попапов, своя модель пинов |
| BLOCKED | 20 | применимо, но нет ручки бэкенда (список ниже) |

## Роадмап по волнам

Правило для всех волн: база tweb — `812502980`; каждая задача переводит использованный раздел
`docs/tweb/*.md` на новые адреса в том же изменении.

### Волна 0 — безопасность (у нас те же дыры)

| Что | Коммит tweb | Размер | Статус |
|---|---|---|---|
| Ссылка Telegram определяется по разобранному хосту, а не по тексту (`t.me.evil.com`) | fcfe06f76 | S | в работе, ветка `fix/telegram-url-host` |
| Упоминание из вставленного HTML — только с числовым `user_id` | ed51d0c09 | S | там же |
| SW `/dnp-stream/` берёт `Content-Type` из query | 8d06fbc9c | S | там же |
| Распаковка TGS без лимита (zip-бомба; долг ещё с f3733adc2) | — | S | там же |
| Мост Mini App не проверяет `e.origin` | b59a02302 | S | там же |
| SAS звонков без commitment: посредник подбирает эмодзи (`core/calls/callEngine.ts`) | afb5587c8 (класс атаки) | M | не начато, нужен commit-reveal |
| Неклонируемый payload роняет `invoke` и оставляет запись в `awaiting` (`rpc/superMessagePort.ts`) | 4c5a2373a | S | не начато |

### Волна 1 — надёжность: баги, которые у нас есть уже сейчас (независимые, параллельно)

- **Лента** (`bubbles.ts`, `dotRenderer*`, `fastRaf`, `messageTime`):
  293cb4509 (зависший рендерер спойлера навсегда блокирует открытие чата) · 12fbb8506 (ошибка
  в одном callback `fastRaf` роняет остальные) · 127188295 (две галочки на сообщении) ·
  79d6a8f95 → ce37ebeb3 (гейт «не прочитан» по курсору; «вниз» — к первому непрочитанному;
  `BubblesManagers.dialogs` расширить один раз) · 50da390c6 (не «Удалённый аккаунт печатает»).
  Сделано вместе с 173f3c6dc (кружок во время аплоада) — ветка `fix/w1-feed`, статусы B1–B7 в
  [`security-and-bugs.md`](security-and-bugs.md).
- **Скроллер и shared media** (`scrollable.ts`, `appSearchSuper.ts`, `sharedMediaHistories.ts`):
  ffd925068 (общий слушатель `Scrollable` через `WeakRefSet` вместо своего на экземпляр) →
  fb18166dc (`ScrollableRefiller`: бесконечная догрузка, `savedDialogs` без `loaded`) ·
  ca1416807 (вкладки появляются и исчезают со счётчиком, M) · guard `selectTarget` в
  `horizontalMenu` из 1ca7cb99e.
- **Анимации и память**: cab52547f (`animationIntersector`: только первый item, безусловный
  `unobserve`) · 88ee036f1 → c1c10b8c6 (reclaim видео; затем снести наш `releaseVideoAvatars`) ·
  e19e8831d · 1a5b40d8b · c934ddd1e.
- **Язык и время**: d3bf83c2b → f252a5e53 → 00c1e1a86 (итоговое `formatTimeString`) ·
  1ddddac9e (ASCII-литерал эмодзи-регэкспа до обновления vite/rolldown).
- **Одиночные S** (по таблицам частей): 41d9adb14, b85527091, eedb2b74e, 5b1636d61, 6ce2cafba,
  1faad1d59, 7a52f3631, 7082e1a18, 72c50bfef, 2488f2cf0, 08d07c2b4, 3d524908e, 0e57f604d,
  e934b9039, 173f3c6dc, 8f6b3800c, 325ed0e15, e9428f2a9, e96e06c37, 6af482b82, 469b191f0 + 9909f2b1a.

### Волна 2 — платформа (фундамент, до новых фич)

| Блок | Коммиты | Размер | Зависимости |
|---|---|---|---|
| 2A **Иконки и строки** (видно во всём приложении) | 2197fee9c (шрифт tgico с HEAD, карта, переименования `*_filled`) → dae12932f → 12eeb9b1c → 944b578e9; стили `_row.scss`/`_checkbox.scss` из ef41b29db и 803f9599d | M | — |
| 2B **Примитивы `Tabs`** | 7d50b5dfe (`MenuShell`/`MenuInner`/`MenuIconTab`, `MenuTab.ripple`, ряд `AppSearchSuper` на `Tabs.MenuScrollable`, `nav` → `div`) → `attachTabList` из 472e3e76b | M | после шва папок |
| 2C **Оболочка попапов на Solid** | 2556fc949 (класс `PopupElement` удалён, `showXxxPopup()`) → 6c3803343 → a11y попапов из 472e3e76b | L | программа Solid; наш `popupElement.ts` — порт удалённого класса |
| 2D **Строки на `RowTsx`** | ef41b29db (`row.ts` → `rowTsxController`) | L | шаг программы Solid, после 2A |
| 2E **Жизненный цикл object URL** | 15de983de + 85f27ea3c | L | медиа-модель |
| 2F **Подсветка найденного и прыжок** | f57dbcec3 (`textHighlight.ts`, `::highlight`) → 5db7cfb6f → 0138e970d; рядом 3f974c341 (`dialog-subtitle-parts`) | L | задевает задачу 7 поиска |
| 2G **Ссылки и хэштеги** | исполнитель `data-anchor-action` (`openInternalLink`) + вендорный `convertPunycode` → 16bf5ed15 → 3501e76c9; b6d3b059c → a5a90e719 | M | после волны 0 |

### Волна 3 — дельта в идущие программы

- **Папки** (после шва, задача 6): дельта `appDialogsManager.ts` — 0af53a342, b9d75a088,
  95933b11f (адреса), a11y и `mousedown` из 472e3e76b; счётчик форума 695f3c027 → отложенная 16.
- **Поиск** (после задачи 12): порт класса `DialogsContextMenu` → 6722c7a6e (меню диалогов в
  группах, «Удалить из недавних», `removeRecentSearch` к задаче 5); b0c20529a (`wrapEmojiText` в
  чипе); a037b577c — журнал звонков в `requestHistory` (только если берём вкладку Calls).
- **Shared media**: задача 14 — сразу по новому tweb (`toggleByElement` из 79b9c44c1/d064fdb85,
  «Копировать» из 508acd4f5, 8ff1ea1e7); 4c678d0ab (sticky-дата, M); шапка
  553143f1e → 757728898 → 06cdebc76 — после ручек бэкенда.
- **Чатлист**: 108d3f301 (reveal пачкой) · выделение 60a83a6f1 → ee6f7f9c2 → d34f95ef5
  (перетаскивание пинов BLOCKED) · Clear History d8f489525.

### Волна 4 — фичи

Аудио на Solid-строке 803f9599d → 176ec033c (L) · спойлеры на канвасе 4184843ff (M) ·
тоны эмодзи 16de60dc5 → 1d98f721f → 31620b1e9 · копирование медиа 508acd4f5 ·
drag-выделение альбомов 79b9c44c1 → d064fdb85 · бабл звонка 237a8b38c → 662d9bf0f и вкладка
Calls a037b577c · плашка видеочата e12782571 · настройки историй 690514225 · поиск по
настройкам 34f417d12 · chat tips edb62a49e → f25b80852 → f9e064dfe (после поиска з.12) ·
tlottie d5c66a010 → 7707295af · уведомления после difference 1dc32d889 · GIF-поиск b185aadfb.

## BLOCKED: чего не хватает бэкенду (отдельная программа)

| Ручка / поле | Коммиты tweb |
|---|---|
| `PeerSettings` у пира (плашка действий, скрытие ссылок от незнакомых) | 79455907b, f73102ec0, 36bf1a75b, 119c82769, часть 39edaf1f4 |
| Фильтры `photos`/`videos` в `MediaHistory` и `SearchCounters` | 553143f1e |
| `main_tab` профиля, `setMainProfileTab` | 1577b3231 |
| `reorderPinnedDialogs` / топики / saved | часть 60a83a6f1 |
| Замена медиа в `editMessage` | (часть 5) |
| `sentCodeType`, `resendCode` | 0d3d49555, b2b794a1b |
| Архив стикерсетов; `unconfirmed` у сессий; погода и музыка в историях | (часть 5) |
| Guard-боты | 088d69006, 6619fdb57 |
| Пины по `top_msg_id` | 1d0e37337 |
| `channels.setStickers` | 1ca7cb99e |
| `updateNewStoryReaction` владельцу | e532dd4b3 |
| Заявки в chatFull + `chat_requests` | 558c0f72a |
| История фото группы/канала | 908d0d0d6 |
| Ephemeral-сообщения | 2117883fd |
| Revoke в Clear History, очистка канала; удаление журнала звонков | части d8f489525, a037b577c |

## Отдельные решения

- **TL, Layer 229** (8197da758): все `keyboardButtonXxx` сведены в `keyboardButton {style, text, type}`.
  Наша схема и `core/markup/replyMarkup.ts` на слое 227 — решить, на каком слое фиксируемся
  (`docs/readiness/tl-program.md`).
- **Доки.** Устарели адреса почти во всех: `bubbles`, `chat-feed`, `composer`,
  `message-interactions`, `media`, `popups` (Части 1–3 и 8 — целиком), `right-sidebar`,
  `left-sidebar`, `global-search`, `shared-media`, `folders-tabs`, `state-and-layout`. Переводим
  на `812502980` по мере переноса подсистемы, а не одним проходом: иначе доки разойдутся с кодом,
  который ещё портирован по старой базе.
