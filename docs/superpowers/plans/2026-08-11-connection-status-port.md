# Порт `ConnectionStatusComponent` из tweb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Индикатор состояния в поле поиска сайдбара работает как в tweb: настоящий конечный автомат по состоянию соединения, спиннер вместо лупы, кросс-фейд текста.

**Architecture:** В tweb это `components/connectionStatus.ts` (207 строк) — класс, который слушает события соединения и синхронизации и дёргает у `InputSearch` три метода: `setPlaceholder`, `toggleLoading`, `isLoading`. Вся анимация живёт в `InputSearch` через `SetTransition` и класс `is-connecting` на контейнере.

**Tech Stack:** TS strict, vitest + happy-dom, React 19 (как хост для императивной механики).

## Что показывает индикатор сегодня и почему это неверно

`Sidebar.tsx:213` — `placeholder={showUpdating ? t('Updating…') : t('Search')}`, где

```ts
// core/hooks/useConnectionStatusLabel.ts, целиком
const INITIAL_DELAY = 2000
return elapsed && !loaded   // loaded = chatsStore.loaded
```

То есть «Обновление…» означает **только одно**: за 2 секунды не загрузился список диалогов. К соединению отношения не имеет.

Последствия расхождения:
- сокет упал, а список поднялся из кэша → у нас «Поиск», у tweb «Ожидание сети» / «Переподключение». Пользователь не понимает, почему молчат сообщения;
- соединение живое, список медленный → у нас «Обновление…», хотя обновляться нечему;
- отсчёта до переподключения нет вовсе.

## Что уже готово (проверено, заново не делать)

- **CSS готов на 100%.** `styles/tweb/_inputSearch.scss` отличается от `tweb/src/scss/partials/_inputSearch.scss` **ровно одной строкой** — путём `@use`. Правила `.preloader-container`, `.preloader-path-new`, `.is-hiding`, окраска под `--primary-color` — все на месте.
- **Разметка прелоадера есть**: `shared/ui/Spinner` рендерит `.preloader-container.preloader-swing.is-visible.forwards > .you-spin-me-round > svg.preloader-circular > circle.preloader-path-new` — порт `preloader.ts:95-97`. У него задокументировано отступление: у tweb контейнер — оверлей (`absolute; inset:0; 54x54`), наш стоит в потоке. Для инпута это как раз нужно проверить: там `.preloader-container` позиционируется партиалом (`inset-inline-start: var(--icon-left-offset)`).
- **`SetTransition` есть** — `core/hooks/useSetTransition` (порт `singleTransition.ts`).
- **Константы tweb**: `CHANGE_STATE_DELAY = 400`, `INITIAL_DELAY = 2000`, `ANIMATION_DURATION = 250` (`connectionStatus.ts:18-20`). `INITIAL_DELAY` у нас уже скопирован верно.

## Чего не хватает (проверено по коду)

| Нужно автомату | У нас | Что делать |
|---|---|---|
| `connecting` | `ConnState = 'connecting'` | есть |
| `hadConnect` | закодирован: `'reconnecting'` = соединение уже было | есть, вывести |
| `retryAt` | `scheduleReconnect()` считает `delay` **локально и наружу не отдаёт** (`connectionManager.ts:84-88`) | опубликовать |
| `updating` | `syncEngine.isSyncing()` — геттер, **событий нет** | завести события |
| `timedOut` | нет аналога | ветка не портируется; у tweb она всё равно даёт тот же текст «Updating» |

Плюс: `RT.state` воркер рассылает, но **на витрине его не слушает никто** (грепом ноль потребителей).

> Таблица выше — состояние **до** работ. Задача 1 закрыта: `retryAt` и признак синхронизации
> публикуются, и — главное — доступны запросом через `realtime.getStatus()`. Контракт входов
> автомата описан в Задаче 3 ниже, в блоке «Входы автомата».

## Global Constraints

- **1:1 с tweb.** Автомат, тексты, пороги, длительности — из исходника, не из головы. Перед тем как написать ветку — открой `tweb/src/components/connectionStatus.ts:143-178` и сверь.
- **Механика императивная, хост — React.** Как в Этапе 2.1: класс владеет своим DOM, компонент его монтирует и уничтожает. Не переписывай автомат на хуки — это будет наша интерпретация, а не порт.
- **Норма проводки** (`web-client/CLAUDE.md`, раздел «Тесты»): каждая строка проводки — либо краснеющий тест, либо пометка комментарием прямо у неё.
- Существующие тесты — без правок. Потребовалась правка — стоп, BLOCKED.
- Комментарии по-русски; ссылки на строки tweb приветствуются.
- Команды из `web-client/`: `npm test`, `npm run typecheck`, `npx oxlint <файлы>`, `npm run build`.
  `npm run lint` выходит с кодом 1 и на чистом main — ворота: не добавлять НОВЫХ находок.
- **Git-гигиена:** только точечный `git add <файлы>` + `git commit`. Запрещены `git reset`, `git rebase`, `git commit --amend`, `git checkout`/`restore`, `git stash`, `git add -A`/`.`, `git commit -a`.
- Коммиты на русском с трейлерами:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UJM3i1Gj8Lfz2REQDrCiLX
  ```

---

### Task 1: Сигнал состояния — `retryAt` и события синхронизации

Без этого автомат нечем кормить.

**Files:**
- Modify: `web-client/src/core/realtime/connectionManager.ts`
- Modify: `web-client/src/core/realtime/syncEngine.ts`
- Modify: `web-client/src/core/workerCore.ts`, `web-client/src/lib/rootScope.ts`
- Test: соответствующие

- [ ] **Step 1: `retryAt`.** `scheduleReconnect()` (`connectionManager.ts:84-88`) считает `delay` и забывает его. Публиковать вместе с состоянием: `Date.now() + delay`. Форму выбери сам — расширить payload `RT.state` или отдельное поле; главное, чтобы витрина могла отрисовать обратный отсчёт.

- [ ] **Step 2: события синхронизации.** У `syncEngine` есть `isSyncing()`, но нет событий. Завести аналоги tweb `state_synchronizing` / `state_synchronized` — воркер публикует их в начале и в конце catch-up.

- [ ] **Step 3: Тесты.** Реконнект публикует `retryAt` в будущем; catch-up публикует «начал» и «закончил» ровно по разу. Докажи укус мутациями.

- [ ] **Step 4: Commit** — `feat(realtime): retryAt и события синхронизации в сигнале состояния`

---

### Task 2: `InputSearch` учится показывать загрузку

**Files:**
- Modify: `web-client/src/shared/ui/InputSearch/InputSearch.tsx`
- Test: `web-client/src/shared/ui/InputSearch/InputSearch.test.tsx` (создать)

Эталон — `tweb/src/components/inputSearch.ts:143-195`:

```ts
public isLoading() { return this.container.classList.contains('is-connecting') }

public toggleLoading(loading: boolean) {
  const another = this.arrowBack ? this.clearBtn : this.searchIcon;
  // ...создать statusPreloader один раз, добавить 'is-visible','will-animate'
  if (loading && !preloader.parentElement) this.container.append(preloader)
  preloader.classList.toggle('is-hiding', !loading)
  another.classList.toggle('is-hiding', loading || …)
  SetTransition({ element: this.container, className: 'is-connecting',
                  forwards: loading, duration: ANIMATION_DURATION,
                  onTransitionEnd: loading ? undefined : () => preloader.remove() })
}
```

и `setPlaceholder` (`:175-195`) — кросс-фейд: старый узел получает `is-hiding` через `SetTransition` и удаляется по окончании, новый добавляется.

- [ ] **Step 1: Прочитать исходник** обоих методов целиком, включая `setPlaceholder`.

- [ ] **Step 2: Реализовать** три возможности на нашем `InputSearch`: показ/скрытие спиннера с классом `is-connecting` на контейнере, сокрытие лупы через `is-hiding`, кросс-фейд плейсхолдера. Спиннер — существующий `shared/ui/Spinner`; проверь, что он позиционируется партиалом правильно (там `.preloader-container` получает `inset-inline-start: var(--icon-left-offset)`), и если наше отступление про «в потоке вместо оверлея» мешает — скажи, это законный результат.

- [ ] **Step 3: Тесты.** Классы появляются и снимаются; спиннер удаляется из DOM по окончании анимации; смена плейсхолдера не оставляет два узла.

- [ ] **Step 4: Commit** — `feat(ui): InputSearch умеет показывать загрузку — порт tweb inputSearch.ts:143-195`

---

### Task 3: Автомат `ConnectionStatusComponent`

**Files:**
- Create: `web-client/src/components/connectionStatus.ts`
- Modify: `web-client/src/components/Sidebar.tsx`
- Delete: `web-client/src/core/hooks/useConnectionStatusLabel.ts` (заменяется целиком)
- Test: `web-client/src/components/connectionStatus.test.ts` (создать)

Эталон — `tweb/src/components/connectionStatus.ts:143-178`. Ветки автомата **дословно**:

| Условие | Текст |
|---|---|
| `connecting` + `timedOut` | `Updating` |
| `connecting` + `hadConnect` + `retryAt` | `ConnectionStatus.ReconnectInPlain` (с обратным отсчётом) |
| `connecting` + `hadConnect` | `ConnectionStatus.Reconnecting` |
| `connecting` | `ConnectionStatus.Waiting` |
| `updating` | `Updating` |
| иначе | `Search` |

Плюс механика показа (`:185-205`): если индикатор **уже** виден — применить сразу; если нет — отложить на `CHANGE_STATE_DELAY = 400` мс, чтобы не мигать на коротких разрывах. Это важная часть, не потеряй её.

#### Входы автомата: только pull, никогда payload события (итог Задачи 1)

Задача 1 сдана в **pull-модели, 1:1 с tweb** — это не деталь реализации, а контракт, от которого зависит корректность автомата:

- Единственный источник правды — `realtime.getStatus()` → `{ state, retryAt, syncing }` (RPC в воркер, `core/realtime/realtime.ts`). Читает живые значения на каждый вызов.
- События `RT.state`, `RT.stateSynchronizing`, `RT.stateSynchronized` — **только уведомления** «что-то изменилось, дёрни pull». Их payload читать запрещено. Эталон: `connectionStatus.ts:47-51` — на `connection_status_change` tweb игнорирует payload и зовёт `getConnectionStatus()`.
- Причина, по которой это обязательно: `SuperMessagePort` не буферизует кадры, а `smp.on(...)` вешается из эффекта **после** первого рендера. Вкладка, смонтировавшаяся после единственного перехода в `'reconnecting'` (backoff до 30 с), не увидит ни одного события. Без pull она останется с «Поиск» вместо отсчёта.
- Пропущенное уведомление не страшно: следующее всё равно дёрнет актуальный pull. Страшно только полное отсутствие уведомлений — от этого спасает стартовый pull ниже.

- [ ] **Step 1: Прочитать исходник целиком** (207 строк) и выписать, что из него не портируется и почему: `singleInstance`, `TEST_DBLCLICK`, `HAVE_RECONNECT_BUTTON`, `forceGetDifference`, кнопка `force-reconnect`.

- [ ] **Step 2: Реализовать автомат** на наших входах, читая их **только** через `realtime.getStatus()` (см. блок выше).

  Три пункта, каждый — исправление ошибки, найденной в ходе Задачи 1. Не «упростить» обратно:

  1. **Стартовый pull по `INITIAL_DELAY = 2000`** — порт `connectionStatus.ts:66-69` (`setFirstConnectionTimeout = setTimeout(setConnectionStatus, INITIAL_DELAY)`). Задача 1 сознательно его не делала: без живого потребителя таймер был бы непокрытым мёртвым кодом, а его единственное осмысленное место — здесь. Таймер заводится при монтировании и **отменяется первым же** из трёх уведомлений. Без него вкладка, не поймавшая ни одного события, останется без значения навсегда.
  2. **`hadConnect` — липкий флаг на самом компоненте, НЕ вывод из `ConnState`.** Соблазн «`'reconnecting'` означает, что соединение уже было» неверен: при протухшем токене в середине сессии состояние уходит в `'offline'`, и вывод из `ConnState` даст «Ожидание сети» вместо «Переподключение». Флаг взводится один раз при первом `'ready'` и больше не гаснет.
  3. **Не дедуплицировать `RT.state` по значению.** Одинаковое состояние подряд — не шум: `retryAt` между двумя `'reconnecting'` разный (см. `connectionManager.ts`, комментарий про несклеенность `retryAt`, эталон `tcpObfuscated.ts:111-123` + `:175`). Свернув повторы, потеряешь обновление отсчёта.

  Ветка `timedOut` не портируется — у нас нет такого состояния; отметь комментарием, что она даёт тот же текст, что `updating`.

- [ ] **Step 3: Подключить к сайдбару**, удалить `useConnectionStatusLabel` и его использование.

- [ ] **Step 4: Тексты.** Добавить в `i18n/dict.ru.ts` недостающие ключи, взяв формулировки из `tweb/src/lang.ts` (ищи `ConnectionStatus.*`). Не переводи сам — возьми, как в оригинале.

- [ ] **Step 5: Тесты.** По одной проверке на каждую ветку автомата + отдельно:
  - короткий разрыв (< 400 мс) не показывает индикатор; длинный — показывает;
  - **иммунность к потере уведомлений**: воркер сменил состояние **до** того, как компонент смонтировался и подписался, ни одного `RT.*` не пришло — стартовый pull по `INITIAL_DELAY` всё равно даёт верный текст. Это главное, что стоит запинить: именно эту дыру закрывала pull-модель Задачи 1;
  - первое уведомление отменяет стартовый таймер (двойного применения нет);
  - `hadConnect` липкий: `ready` → `offline` даёт «Переподключение», а не «Ожидание сети».

- [ ] **Step 6: Commit** — `feat(sidebar): порт ConnectionStatusComponent — автомат состояния соединения в поиске`

---

### Task 4: Документ и ревизия

- [ ] **Step 1.** В `web-client/CLAUDE.md` — строка о том, что индикатор в поиске отражает состояние соединения, а не загрузку списка, и где живёт автомат.
- [ ] **Step 2.** Проверить, что `RT.state` теперь имеет потребителя и что в проекте не осталось второго места, выводящего «идёт загрузка» независимо.

  **Адрес уже известен, найден при сверке Задачи 2:** `components/conversation/TopbarSearch.tsx:292` вешает тот же класс `is-connecting` на свой инлайновый `.input-search` по собственному условию `everLoaded && s.loading`. Это второй независимый вывод «идёт загрузка», выведенный из своего источника. Разбери его: свести к автомату, оставить как есть с обоснованием (у него другая семантика — загрузка результатов поиска по чату, а не состояние соединения) или удалить. Любой исход законен, но обоснуй по коду.

  **Заодно зафиксируй факт, найденный в Задаче 2 и опровергший мою предпосылку:** CSS-правила для `.is-connecting` не существует ни у нас, ни в tweb — единственное правило с этим классом (`_chatPinned.scss:971`) относится к топбару звонка. То есть `is-connecting` на поле поиска — **чистый флаг** для `isLoading()`, визуального эффекта у него нет; видимостью управляют `.is-hiding` и `.preloader-container`. Не ждать от него анимации и не «чинить» его отсутствие в стилях.
- [ ] **Step 3: Commit** — `docs(claude): индикатор в поиске — состояние соединения`

---

## Self-Review

- Порядок продиктован зависимостью: без сигнала (Задача 1) автомат нечем кормить, без методов `InputSearch` (Задача 2) ему нечем показывать.
- Задача 2 сознательно допускает исход «наше отступление про оверлей мешает»: тогда это честный результат, а не повод подгонять CSS вслепую.
- **Вне объёма:** кнопка принудительного переподключения (`HAVE_RECONNECT_BUTTON = false` и в tweb), `singleInstance` (у нас нет многоинстансной блокировки), полный порт preloader-подсистемы под медиа.
