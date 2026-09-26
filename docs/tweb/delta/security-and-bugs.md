# Уязвимости и баги у нас — найдено разбором дельты tweb `e52b5d931` → `812502980`

Составлено 2026-09-26 по пяти частям разбора (`part-1.md` … `part-5.md`, сводка — [`README.md`](README.md)).
Всё ниже воспроизводится в НАШЕМ коде (`origin/main` = `0a1fbba4`), а не только в tweb.
Коммит tweb — где лежит исправление или описание класса ошибки. Статусы — на дату составления.

## Уязвимости

| # | Что | Где у нас | Коммит tweb | Размер | Статус |
|---|---|---|---|---|---|
| S1 | Ссылка Telegram определяется по ТЕКСТУ регэкспом без границы хоста: `https://t.me.evil.com/…` считается внутренней, теряет `target=_blank`/`noopener` и уходит во внутренний обработчик. Ветка `tg:` не заякорена, `new URL(url)` без try. Проверено вручную | `web-client/src/lib/richtext/url.ts:159` (`wrapUrl`) | fcfe06f76 | S | в работе — ветка `fix/telegram-url-host` |
| S2 | Мусорный `data-mention-id` во вставленном HTML превращается в упоминание с `user_id: 0` / нечисловым | `web-client/src/core/richtext/markdown.ts:95-97` | ed51d0c09 | S | в работе — там же |
| S3 | Service worker берёт `mime` из query и отдаёт его в `Content-Type` (подмена типа ответа → XSS). Путь живой при включённом DNP-мосте (`VITE_DNP_ENABLED`, в проде OFF) | `web-client/public/sw-stream.js:196` (`/dnp-stream/`) | 8d06fbc9c | S | в работе — там же |
| S4 | Распаковка TGS без лимита размера (zip-бомба). Долг ещё со старой базы | `web-client/src/core/stickers/tgs.ts:15`, `web-client/src/lib/lottie/lottieLoader.ts:180` | f3733adc2 (есть уже в `e52b5d931`) | S | в работе — там же |
| S5 | Мост Mini App не проверяет `e.origin` входящих `postMessage` | обработчик моста веб-приложений (уточняется в фиксе) | b59a02302 | S | в работе — там же |
| S6 | E2E-звонки: нет commitment перед показом эмодзи SAS — сервер-посредник может подобрать совпадающие эмодзи и незаметно встать между собеседниками (MITM) | `web-client/src/core/calls/callEngine.ts` | afb5587c8 (класс атаки) | M | не начато — нужна схема commit-reveal; решение за пользователем |
| S7 | Неклонируемый payload роняет `invoke` синхронно и оставляет висящую запись в `awaiting` | `web-client/src/rpc/superMessagePort.ts` | 4c5a2373a | S | не начато |
| S8 | Проверка поддельных доменов в ссылках (punycode) и нормализация протокола в `safeWindowOpen` не портированы; упираются в отсутствие исполнителя `data-anchor-action` и вендорного `convertPunycode` | `web-client/src/lib/richtext/url.ts`, открытие ссылок | 16bf5ed15 → 3501e76c9 | M | не начато — волна 2G |
| S9 | Средний клик по замаскированной ссылке открывает её без подтверждения «Открыть ссылку?» — у нас обрабатывается только `click` | обработчик замаскированных ссылок | e96e06c37 | S | не начато |

Проверено и у нас НЕ воспроизводится: XSS в чипах поиска через `innerHTML` (b0c20529a) — наш
`selectorEntity.ts` ставит подпись текстом; для паритета остаётся только `wrapEmojiText` (PORT S).

## Баги

### Лента чата

| # | Что | Где у нас | Коммит tweb | Размер |
|---|---|---|---|---|
| B1 | Зависший рендерер спойлера навсегда блокирует открытие чата | `web-client/src/components/dotRendererCore.ts:191` (`mediaWorkerReady`, `processBatch`) | 293cb4509 | S |
| B2 | Одна ошибка внутри callback `fastRaf` роняет все остальные callback'и кадра | `fastRaf` | 12fbb8506 | S |
| B3 | Две галочки на одном сообщении | `web-client/src/components/chat/messageTime.ts:171` | 127188295 | S |
| B4 | В полностью прочитанном чате все баблы считаются непрочитанными и получают лишние read-observer'ы — гейт смотрит не на курсор прочтения | `web-client/src/components/chat/bubbles.ts:1886-1899` | 79d6a8f95 | S |
| B5 | Кнопка «вниз» и повторный клик по открытому чату ведут в конец, а не к первому непрочитанному (нужны `read_inbox_max_id`/`unread_count` в `BubblesManagers.dialogs` — общий с B4) | `bubbles.ts` | ce37ebeb3 | M |
| B6 | «Удалённый аккаунт печатает…» — печатающего нет в зеркале пиров, а его всё равно называют | typing-лейбл | 50da390c6 | S |
| B7 | Кружок не играет во время аплоада | `web-client/src/components/wrappers/video.ts` | 173f3c6dc | S |

### Профиль и shared media

| # | Что | Где у нас | Коммит tweb | Размер |
|---|---|---|---|---|
| B8 | Бесконечная догрузка в профиле: после каждой загрузки снова зовётся `checkForTriggers`, а у вкладки `savedDialogs` флаг `loaded` не ставится никогда (`canLoadMediaTab` всегда true). В Избранном с короткой вкладкой «Чаты» — цикл запросов | `web-client/src/components/appSearchSuper.ts:1921-1932`, `:1622-1642` | fb18166dc (`ScrollableRefiller`) | M |
| B9 | Вкладка, которой не было при открытии профиля, не появляется до переоткрытия: `setCounter` не трогает `hide`, а `sharedMediaHistories.ts` не считает сообщения для скрытой вкладки | `appSearchSuper.ts:911`, `web-client/src/core/sharedMediaHistories.ts` | ca1416807 | M |
| B10 | `horizontalMenu.selectTarget` читает `children[prevId]` у пропавшей предыдущей вкладки (удаление последней папки / вкладки) | `web-client/src/components/horizontalMenu.ts:195` | guard из 1ca7cb99e | S |
| B11 | `animationIntersector`: проверка «элемент вне DOM» стоит ниже выхода по `locked` — видео-аватарки не освобождаются; у нас обходной `releaseVideoAvatars` | `web-client/src/components/animationIntersector.ts:355`, `peerProfileAvatars.ts:1219-1240` | 88ee036f1 → c1c10b8c6 | M |
| B12 | Наше «расхождение 2» в `sharedMediaHistories.ts` в tweb исправлено (`idx !== -1`) — снять пометку и выровнять | `sharedMediaHistories.ts` | (часть 1) | S |

### Анимации, скролл, память

| # | Что | Где у нас | Коммит tweb | Размер |
|---|---|---|---|---|
| B13 | `animationIntersector` обрабатывает только первый item элемента, `unobserve` безусловный, плеер ещё не вставленного элемента отбирается сразу. Проявление: обезьянка на экране входа (`AuthCardsHost mode="outin"` + `TrackingMonkey`) может пропадать | `animationIntersector.ts` | cab52547f | S |
| B14 | Утечка в `Scrollable`: каждый экземпляр вешает свой `window.resize` и подписку на heavy-animation | `web-client/src/components/scrollable.ts:186-211` | ffd925068 (`WeakRefSet` + общий слушатель) | M |
| B15 | Аватарки держат ресурсы после ухода из DOM | аватарки | e19e8831d | S |
| B16 | Попап гасит мидлварь до окончания анимации скрытия | попапы | 1a5b40d8b | S |
| B17 | Нет гарда для mid без сообщения в загрузчике медиавьювера | `web-client/src/components/mediaViewer/listLoader.ts` | c934ddd1e | S |

### Чатлист, меню, ссылки

| # | Что | Где у нас | Коммит tweb | Размер |
|---|---|---|---|---|
| B18 | Бейдж «@» показывается вместе с числом при любых непрочитанных упоминаниях (расходимся и со старым tweb) | `web-client/src/components/ChatListItem.tsx:234-239` | 08d07c2b4 | S |
| B19 | «Пожаловаться» в личке показывается у всех, а должно только у ботов | меню чата | 2488f2cf0 | S |
| B20 | Для внутренних ссылок (`data-anchor-action`) нет исполнителя (`openInternalLink`): подтверждение «Открыть ссылку?» у замаскированных ссылок и поиск по хэштегу не срабатывают | обработка кликов по ссылкам | предусловие для 16bf5ed15, b6d3b059c, a5a90e719 | M |
| B21 | Шапка `contextMenu.ts` утверждает, что копирования медиа в tweb нет, а в `lang.ts` самодельный ключ `MediaViewer.Context.CopyMedia` вместо `MediaViewer.Context.Copy` | `web-client/src/components/chat/contextMenu.ts`, `lang.ts` | 508acd4f5 | S |

### Язык, время, оформление

| # | Что | Где у нас | Коммит tweb | Размер |
|---|---|---|---|---|
| B22 | AM/PM не учитывается для zh/ja/ko/tr/es; `formatTimeString` без мемо, нет отката языка при сбое загрузки пакета | `web-client/src/lib/langPack.ts:466` | d3bf83c2b → f252a5e53 → 00c1e1a86 | S |
| B23 | Переход темы не учитывает DPR | анимация смены темы | 7082e1a18 | S |
| B24 | При поиске по тегам резерв под плашки должен быть 0 | поиск по тегам | 6ce2cafba | S |
| B25 | Эмодзи-регэксп содержит одиночные суррогаты: после сборки в tweb пропадали big emoji. Наш билд пока цел (rolldown 1.1.5, 0 символов U+FFFD), но сломается при обновлении vite/rolldown — профилактика | `web-client/src/lib/richtext/emojiRegex.ts` | 1ddddac9e | S |
| B26 | Коды иконок tgico устарели (например `quote`: у нас `ea43`, у tweb `ea05`) — любая иконка из нового tweb встанет не тем глифом | `web-client/src/core/tgico-icons.ts`, шрифт | 2197fee9c, dae12932f | M (волна 2A) |

### Уведомления

| # | Что | Где у нас | Коммит tweb | Размер |
|---|---|---|---|---|
| B27 | Мы глушим уведомления на весь catch-up, а tweb придерживает их только до прихода difference, который мог бы их отменить | уведомления | 1dc32d889 | M |

## Известные у нас баги вне дельты (найдены раньше, не закрыты)

| # | Что | Где | Откуда |
|---|---|---|---|
| K1 | Бэкенд отвечает 404 на `/chats/{id}/search_counters` у черновика личного чата | backend | стенд shared media, 2026-09-07 |
| K2 | «Удалить только у себя» не выкидывает сообщение из `/chats/{id}/media` | backend | там же |
| K3 | После перезагрузки страницы шапки цитат подписаны «Удалённый аккаунт», хотя авторы баблов подписаны верно | лента | там же |
| K4 | Флейк `wsClient.test.ts` «кадры до загрузки кодека»: `vi.waitFor` ждёт 1 с, динамический `import('./tlFrames')` под нагрузкой не укладывается | `web-client/src/core/net/wsClient.test.ts:93` | 2026-09-26 |

## Порядок

Волна 0 — S1–S5 (в работе одним PR), затем S7, S9; S6 — отдельной задачей по решению пользователя;
S8 — вместе с B20 (волна 2G). Волна 1 — все B-пункты размера S и M, кроме B26 (идёт с иконками, 2A)
и B20 (2G). Подробный роадмап — [`README.md`](README.md).
