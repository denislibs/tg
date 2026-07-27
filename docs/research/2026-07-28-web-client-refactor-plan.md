# План рефакторинга web-client (2026-07-28)

Инкрементальное приведение фронтенда к архитектуре, которая **уже задокументирована**
в [`web-client/CLAUDE.md`](../../web-client/CLAUDE.md). Цель — не менять архитектуру и не
переписывать с нуля, а убрать дрейф, дубли и свалки, из-за которых код тяжело читать.

> **Принцип:** каждый пункт — отдельный PR, поведение не меняется (кроме явно
> отмеченных), после каждого PR проходят `npm run typecheck`, `npm test`, `npm run build`.
> Порядок — от самого безопасного (компилятор проверит) к самому объёмному.

---

## Краткая сводка проблем (по данным аудита)

| # | Проблема | Где | Масштаб |
|---|---|---|---|
| P1 | Типы `Managers` написаны руками и дублируют менеджеры | `client/bootstrap.ts` | 300+ строк ручного дубля |
| P2 | Одно realtime-событие описано в 3 местах | `worker.ts` `onFrame` + `dispatchOther`, `realtimeBridge.ts` | ~55 + 8 + ~40 веток |
| P3 | `dispatchOther` угадывает тип события по наличию поля | `worker.ts:93-105` | хрупко, тихие мисроуты |
| P4 | Маппинг сырьё→модель дублируется инлайном | `realtimeBridge.ts:68`, `:243` | литерал на ~40 полей ×2 |
| P5 | Сторы ходят в сеть (нарушение инварианта) | `audioStore`, `starsStore`, `liveShareStore` | 3 стора |
| P6 | 5 Zustand-сторов лежат вне `stores/` | `settings.tsx`, `core/pip.ts`, `core/pwa.ts`, `core/webapp.ts`, `i18n/index.tsx` | конвенция сломана |
| P7 | Коллизия имён: два `superMessagePort.ts` | `rpc/` (85) и `lib/` (712) | путаница |
| P8 | Остатки старой архитектуры не удалены | `stores/chatsCache.ts` рядом с `core/store/persist.ts` | мёртвый код |
| P9 | 4 свалки утилит без правила «что куда» | `helpers/`, `core/*.ts`, `lib/`, `shared/lib/` | ~80 файлов |
| P10 | 161 компонент плоско в корне `components/` | `components/` | миграция в фича-папки брошена |
| P11 | God-компоненты (БЛ + сеть + UI в одном файле) | ConversationView, Composer, UserInfoPanel, GroupEditFlow, MediaEditor | 1300–1660 строк |
| P12 | UI лезет в кишки напрямую (нет фасада) | `components/` → `core/` ×128, `stores/` ×58 | высокая связность |
| P13 | 3 источника типов одного сообщения | `protocol/frames`, `core/models`, `data.ts` | ручные конвертеры |

---

## Очередь PR-ов

### PR-1 — Вывести типы `Managers` из менеджеров *(риск: низкий)*

**Проблема (P1).** `interface Managers` в `client/bootstrap.ts` (строки 33–…, 300+ строк)
руками повторяет сигнатуры всех менеджеров. Меняешь метод в `messagesManager` — надо
не забыть поправить и `bootstrap.ts`. Компилятор про рассинхрон молчит, пока не вызовешь.

**Что сделать.**
- Заменить ручной `interface Managers` на вывод из фактических фабрик:
  ```ts
  type Managers = {
    messages: ReturnType<typeof newMessagesManager>
    chats: ReturnType<typeof newChatsManager>
    // … по строке на менеджер
  }
  ```
  либо собрать реестр один раз и вывести тип из него.
- Убедиться, что фабрики `new*Manager` возвращают конкретные объекты (а не `unknown`),
  чтобы `ReturnType` дал полезный тип.
- В `worker.ts` реестр `registerManagers({...})` типизировать тем же типом, чтобы
  UI-сторона и worker-сторона гарантированно совпадали.

**Файлы.** `client/bootstrap.ts`, `core/worker.ts`, при необходимости — сигнатуры
возвратов в `core/managers/*Manager.ts`.

**Проверка.** `npm run typecheck` — любое расхождение сигнатур теперь ошибка сборки.
Удалено ~300 строк.

**Не делать.** Пока не трогаем `payload: unknown` в транспорте — это отдельный PR-9.

---

### PR-2 — Один `fromNewMessageEvt()` в слое моделей *(риск: низкий)*

**Проблема (P4).** В `realtimeBridge.ts:68` вызов `mapMessage({...})` с ручным литералом
на ~40 полей, перечисляющим все поля `evt`. Тот же литерал продублирован для
`paidMediaUnlock` (`:243`). Забыл поле в одном месте — рассинхрон рендера.

**Что сделать.**
- Вынести маппинг `NewMessageEvt → Message` в `core/models` одной функцией
  `fromNewMessageEvt(evt: NewMessageEvt): Message`.
- Переиспользовать её в: `RT.newMessage`, `RT.paidMediaUnlock`, и везде, где сейчас
  собирают `Message` из проводного кадра.
- Инъекцию непроводных полей (`secretMedia`, `secret`) оставить у вызывающего или
  параметром функции — но литерал полей должен существовать в одном месте.

**Файлы.** `core/models.ts`, `client/realtimeBridge.ts`.

**Проверка.** `npm test` (тесты `messagesStore.*`, `messageToConvMsg`), ручной прогон:
входящее сообщение, разблокировка платного медиа.

---

### PR-3 — Единый реестр realtime-событий *(риск: средний, самый большой выигрыш)*

**Проблема (P2, P3).** Чтобы добавить один realtime-тип, надо синхронно править три места:
- `worker.ts` `onFrame` — ~55 веток `else if` (WS-строка → `broadcast(RT.x)`);
- `worker.ts` `dispatchOther` — 8 веток, **угадывающих тип по наличию поля** (`'total' in o`
  → star-реакция) — хрупко, любое пересечение полей = тихий мисроут;
- `realtimeBridge.ts` — ~40 обработчиков `smp.on(RT.x)` (→ мутация стора).

**Что сделать.**
1. Создать `core/realtime/eventTable.ts` — единственный источник правды о событиях:
   ```ts
   export const RT_EVENTS = {
     new_message: {
       rt: RT.newMessage,
       cache: (mgr, p) => mgr.messages.cacheLive(p),   // опционально, worker-side
       apply: (s, p) => s.messages.applyIncoming(fromNewMessageEvt(p)),
     },
     edit_message: { rt: RT.editMessage, cache: (m,p)=>m.messages.cacheEdit(p),
                     apply: (s,p) => s.messages.applyEdit(p) },
     reaction:     { rt: RT.reaction, apply: (s,p) => s.messages.applyReaction(p) },
     // … по строке на событие
   } as const
   ```
2. `worker.ts` `onFrame` схлопнуть к таблице:
   ```ts
   const e = RT_EVENTS[type]
   if (e) { e.cache?.(managers, payload); broadcast(e.rt, payload) }
   ```
3. `realtimeBridge.ts` — цикл вместо 40 обработчиков:
   ```ts
   for (const e of Object.values(RT_EVENTS)) smp.on(e.rt, (p) => e.apply(stores, p))
   ```
4. Удалить `dispatchOther`: `/sync` должен возвращать `type` события явно и идти через
   ту же таблицу. Если бэк пока не отдаёт `type` — временный маппер по `type`, но **без
   угадывания по полям**.

**Особые случаи оставить штучными** (их мало, они не 1:1 со стором):
- typing-таймеры (`TYPING_TTL`, `typingTimers`) — `realtimeBridge.ts:30, 148-163`;
- звук на `ack` (`playMessageSent`) — `:216-222`;
- дебаунс рефетча диалогов (`scheduleChatsReload`) — `:36`;
- эффекты сообщений (`playEmojiEffect`) — `:77`;
- secret-handshake ветвления (`:252-278`).

Их можно оформить как поле `after?: (stores, p) => void` в таблице либо оставить рядом.

**Файлы.** новый `core/realtime/eventTable.ts`, `core/worker.ts`, `client/realtimeBridge.ts`,
возможно `core/realtime/syncEngine.ts` (отдача `type`).

**Проверка.** `npm test`; ручной сквозной прогон каждого класса событий (сообщение,
edit/delete, реакция, read, typing, pin, draft, story, call). После PR добавление
события = **1 строка в таблице**.

---

### PR-4 — Убрать сеть из сторов *(риск: низкий)*

**Проблема (P5).** Нарушение инварианта «Store = чистое состояние»:
- `stores/audioStore.ts` зовёт `startClient().managers.media.contentUrl(...)`;
- `stores/starsStore.ts`, `stores/liveShareStore.ts` импортируют `Managers` из `client/bootstrap`.

**Что сделать.**
- Перенести сетевые вызовы в соответствующие хуки `core/hooks/use*` (command-путь) или
  в тонкий action-хелпер, который вызывает `managers` и потом пишет в стор.
- Стор оставить чистым: только состояние + синхронные редьюсеры.
- Проверить, что компоненты, дергавшие эти сторовые методы, переключены на хук.

**Файлы.** `stores/audioStore.ts`, `stores/starsStore.ts`, `stores/liveShareStore.ts`,
их потребители, при необходимости новые/существующие хуки в `core/hooks/`.

**Проверка.** `npm test`; ручной прогон: воспроизведение аудио, экран звёзд, live-share.

---

### PR-5 — Собрать «дикие» сторы в `stores/` *(риск: низкий)*

**Проблема (P6).** 5 `create()` живут вне `stores/`: `src/settings.tsx`, `core/pip.ts`,
`core/pwa.ts`, `core/webapp.ts`, `i18n/index.tsx`. «Где искать состояние» перестаёт быть
однозначным.

**Что сделать.**
- Переместить чистые сторы в `stores/` (`settingsStore.ts`, `pipStore.ts`, `pwaStore.ts`,
  `webappStore.ts`). Если файл смешивает стор с React-провайдером (`settings.tsx`,
  `i18n/index.tsx`) — разделить: стор в `stores/`, провайдер/хуки рядом с потребителем.
- Обновить импорты (можно кодмодом/поиском по проекту).

**Файлы.** перечисленные 5 + все импортёры.

**Проверка.** `npm run typecheck`, `npm test`. Строго механический PR.

---

### PR-6 — Снять коллизию имён `superMessagePort` *(риск: низкий)*

**Проблема (P7).** Два файла с одинаковым именем и разным назначением:
- `rpc/superMessagePort.ts` (85) — настоящий RPC main↔worker;
- `lib/superMessagePort.ts` (712, `@ts-nocheck`) — вендор из tweb 1:1 для lottie/customEmoji.

**Что сделать.**
- Переименовать вендорный в отражающее назначение имя, напр.
  `lib/lottie/twebMessagePort.ts` (оставить `@ts-nocheck` и пометку «вендор из tweb, не править»).
- Обновить 4 импортёра.

**Файлы.** `lib/superMessagePort.ts` → новое имя + импортёры (lottie/customEmoji-воркеры).

**Проверка.** `npm run build` (воркеры собираются отдельными чанками — проверить сборку
lottie/customEmoji). Ручной прогон: анимированный стикер, кастом-эмодзи.

---

### PR-7 — Удалить мёртвый `chatsCache` *(риск: низкий, требует проверки)*

**Проблема (P8).** `stores/chatsCache.ts` (59 строк) — остаток старого кэша «последние 100
диалогов без сообщений». Его заменил нормализованный `core/store/persist.ts` (сам себя
так и описывает в комментарии).

**Что сделать.**
- Найти всех импортёров `chatsCache` (`grep -rl chatsCache src`).
- Убедиться, что `persist` покрывает их сценарии (dialogs/users/messages/meta).
- Переключить оставшихся потребителей на `persist`, удалить `chatsCache.ts` и тест.

**Файлы.** `stores/chatsCache.ts`, импортёры.

**Проверка.** `npm test`; ручной прогон офлайн-старта (persist-гидрация) и смены аккаунта
(scope-очистка).

---

### PR-8 — Схлопнуть свалки утилит *(риск: низкий, объёмный по числу файлов)*

**Проблема (P9).** Четыре корзины «прочего» без правила: `helpers/` (23), loose `core/*.ts`
(46), `lib/` (13, вендор-подсистемы), `shared/lib/` (2). Дубли: `helpers/dom/` и `core/dom/`;
`helpers/schedulers.ts` и `helpers/schedulers/pause.ts` рядом.

**Что сделать.**
- Зафиксировать правило (в `web-client/CLAUDE.md`):
  - `shared/lib/` — **все чистые переиспользуемые утилиты** (по подтемам: `time/`, `format/`,
    `dom/`, `array/`, `object/`);
  - `lib/` — только толстые вендор-подсистемы (`lottie/`, `customEmoji/`, вендор-порт);
  - `helpers/` — **упразднить**, содержимое разнести в `shared/lib/*`;
  - loose `core/*.ts`-утилиты (dayLabel, friendlyTime, fmtViews, safeUrl, …) → `shared/lib/*`;
    в `core/` оставить только доменное (managers, realtime, store, models, hooks, net).
- Убрать дубли DOM-хелперов и schedulers (свести к одному).
- Добавить недостающие алиасы `@core @stores @shared @rpc` в `tsconfig.json` и `vite.config.ts`,
  чтобы импорты стали единообразными.

**Файлы.** `helpers/*`, часть `core/*.ts`, `shared/lib/*`, `tsconfig.json`, `vite.config.ts`.
Делать пачками по подтеме (отдельные коммиты внутри PR: time, dom, array, …).

**Проверка.** `npm run typecheck`, `npm run lint`, `npm test` после каждой пачки.

---

### PR-9 — Типобезопасная граница RPC *(риск: средний)*

**Проблема (P13 + слабая типизация границы).** Транспорт гоняет `payload: unknown`;
`managersProxy` примет любой `name/method` без проверки. Три источника типов сообщения
(`protocol/frames.NewMessage` → `core/models.Message` → `data.ConvMsg`) с ручными
конвертерами.

**Что сделать.**
- Свести типы сообщения к **одному** каноническому (`core/models.Message`); `frames`
  оставить только для проводного формата (DTO границы), `data.ConvMsg` — либо упразднить,
  либо явно пометить как view-модель и строить одним конвертером `toConvMsg`.
- На границе RPC (`rpc/superMessagePort` / `managersProxy`) добавить типовую обёртку так,
  чтобы `managers.messages.sendMessage` проверялся по типу `Managers` (после PR-1 тип уже
  выведен) — Proxy можно оставить в рантайме, но фасад типизировать строго.
- Опционально: рантайм-проверка `name/method` существует в реестре (сейчас кидает ошибку
  уже при вызове — можно оставить).

**Файлы.** `core/models.ts`, `src/data.ts`, `protocol/frames.ts`, `rpc/managersProxy.ts`,
конвертеры `messageToConvMsg.ts`, `dialogToChat.ts`.

**Проверка.** `npm run typecheck`, `npm test` (конвертеры, стор сообщений).

---

### PR-10 — Разложить `components/` по фичам *(риск: низкий, объёмный)*

**Проблема (P10).** 161 `.tsx` плоско в корне `components/`; рядом уже есть фича-папки
(`messages/` 42, `settings/` 43, `conversation/` 18, `mediaEditor/` 18, …) — миграция
брошена на полпути.

**Что сделать.**
- Довести до конца feature-slice структуру: каждый экран/фича — своя папка со всем своим
  (UI + локальный `.module.scss` + при необходимости локальный хук).
- Разнести 161 корневой файл по фичам: `chatList/`, `sidebar/`, `stories/`, `calls/`,
  `premium/`, `stars/`, `contacts/`, `settings/`, `search/`, `emoji/` и т.д.
- Оставить `shared/ui/` как есть — это эталон (примитивы дизайн-системы с барелами).
- Двигать файлами (не переписывать), правки импортов — кодмодом.

**Файлы.** массовое перемещение внутри `components/` + импорты.

**Проверка.** `npm run typecheck`, `npm test`, `npm run build`. Делать пачками по фиче,
чтобы ревью был обозримым.

---

### PR-11 — Ввести фасад доступа к данным *(риск: средний)*

**Проблема (P12).** Компоненты импортируют `core/` в 128 файлах, `stores/` в 58, `lib/` в 53.
UI знает про доменные модели, персист, внутренности воркера — любая перекладка `core/`
ломает пол-UI.

**Что сделать.**
- Ввести тонкий фасад (напр. `core/api` или `app/`), через который UI получает данные и
  команды: `useMessages()`, `useChat(id)`, `api.messages.send(...)`.
- Правило: компонент **не** импортирует `core/managers/*` и `stores/*` напрямую — только
  фасад/фича-хуки. `useManagers` (DI) остаётся, но прячется за фасадом.
- Перевести на фасад сначала 2–3 самые толстые фичи (messages, conversation) как образец,
  дальше по одной.

**Файлы.** новый слой фасада + постепенный перевод фич.

**Проверка.** `npm run typecheck`, `npm test`. Метрика успеха: число прямых импортов
`core/` из `components/` падает с 128 к единицам.

---

### PR-12 — Разобрать God-компоненты *(риск: средний, поэтапно)*

**Проблема (P11).** Толстые вью совмещают рендер + локальный стейт + вызовы managers +
работу со сторами:
- `mediaEditor/MediaEditor.tsx` — 1660
- `ConversationView.tsx` — 1563
- `Composer.tsx` — 1394
- `UserInfoPanel.tsx` — 1364
- `group/GroupEditFlow.tsx` — 1268
- `messages/MessageRow.tsx` — 724

**Что сделать (по одному компоненту за PR).**
- Вынести presentation logic в `core/hooks/useX*` (как уже сделаны
  `useChatSelection`/`useChatInfoCard`/`usePinnedBar`).
- Разделить на контейнер (данные/действия) + презентационные подкомпоненты (чистый рендер).
- **Осознанно оставить** известное исключение: `ConversationView` слушает `RT.newMessage`
  ради read-marker (зафиксировано в `CLAUDE.md`) — не ломать, но по возможности сузить.

**Файлы.** по одному God-компоненту за PR + новые хуки/подкомпоненты.

**Проверка.** `npm test`, ручной прогон соответствующего экрана. Приоритет:
`ConversationView` и `Composer` (центральные, максимум связности).

---

## Порядок и зависимости

```
PR-1 (типы Managers)  ──┐
PR-2 (fromNewMessageEvt)─┼─► PR-3 (таблица событий)  ── самый большой выигрыш
                         │
PR-4 (сеть из сторов)    │   независимы, можно параллельно
PR-5 (дикие сторы)       │
PR-6 (переименование)    │
PR-7 (удалить chatsCache)│
PR-8 (свалки утилит)     │
                         └─► PR-9 (типы границы RPC)  ── после PR-1
PR-10 (фича-папки)  ──► PR-11 (фасад)  ──► PR-12 (God-компоненты)
```

**Рекомендованный старт:** PR-1 → PR-2 → PR-3 (ядро «непонятности» — поток данных),
затем дешёвая гигиена PR-4…PR-8, дальше крупные структурные PR-10…PR-12.

## Что НЕ делаем

- **Не переписываем с нуля.** Архитектура уже правильная (однонаправленный поток, CQRS
  де-факто: command-путь `View→hook→managers` и read-путь `server→bridge→store→view`
  разделены). Rewrite сожжёт краевую логику (typing TTL, optimistic reconcile, secret
  media, cross-tab echo, paid unlock) и месяцы без фич.
- **Не тащим Clean Architecture-церемонии** (entities/usecases/ports) на тонкий фронт —
  толстый домен живёт на Go-бэке; `managers` уже играют роль адаптеров.
- **Не возвращаем MUI**, не меняем стек — только форма кода, не технологии.

## Definition of Done (общее для всех PR)

- `npm run typecheck` — чисто (TS7 native, strict).
- `npm test` — зелёные.
- `npm run lint` — без новых нарушений (oxlint typeAware).
- `npm run build` — собирается (включая worker-чанки).
- Поведение не изменилось (кроме явно отмеченного); проверено ручным прогоном затронутых экранов.
- Обновлён `web-client/CLAUDE.md`, если менялись инварианты/конвенции размещения.
