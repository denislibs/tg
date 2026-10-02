# Волна 7, этап 4: точка входа и ядро `AppImManager` — детальный план

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development` (или
> `superpowers:executing-plans`). Шаги помечены чекбоксами (`- [ ]`). Перед каждой задачей —
> скилл `tweb-parity` (`.claude/skills/tweb-parity/SKILL.md`): док → исходник tweb → код.
> Общие правила программы (Global Constraints, мосты чтения, DoD спеки § 9) — в
> [`2026-09-30-wave-7-shell-sidebars.md`](2026-09-30-wave-7-shell-sidebars.md). Здесь они не
> повторяются, только уточняются для этапа.

**Цель этапа.** Корень клиента перестаёт быть React. Три колонки статично лежат в `index.html`
(tweb `index.html:87-116`). `src/index.ts` делает старт и развилку `mountAuthFlow` / `bootstrapIm`
(tweb `src/index.ts:417-675`, `pages/bootstrapIm.ts:21-70`). Центральный владелец — класс
`AppImManager` (`lib/appImManager.ts`, 1:1 с tweb): вкладки колонок (`selectTab`), стек чатов
(`chats[]`, `chatsContainer`), хэш, фон и тема, подписки `construct`. Инстанс чата до этапа 6 —
`ChatFacade` над React-островом `Chat.tsx`. В конце этапа удалены `main.tsx`, `App.tsx`,
`#root`, `ChatsContainer.tsx`, `chatStackStore`, `navigationStore`, `chatHistory.ts` и хуки шелла.
React остаётся только островами (таблица в § «Порядок снятия React-корня»).

**Что этот файл меняет в плане программы.** Ничего из состава задач 4-1…4-7, их границ, фасада
`ChatFacade` и ворот (план программы, раздел «Этап 4», `:1192-1263`). Уточнения, которые трогают
состав, вынесены в вопросы пользователю (§ «Вопросы пользователю»). Без ответа на них задачи
идут по рекомендации.

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит **`812502980`**. Наш код —
`web-client/src/`, срез **`d0f64d5b`** (2026-10-02). Адреса `App.tsx` в плане программы взяты со
среза `e5d7f44e` и уехали. Ниже везде адреса нового среза.

**Номера «Отложено» этапа:** О-125…О-139 (заняты О-125…О-131, свободны О-132…О-139 для
исполнителей задач).

---

## 0. Состояние «на входе» этапа 4

### 0.1 Что в `main` на `d0f64d5b`

| Этап | Сделано | В работе (ворктри) | Не начато |
|---|---|---|---|
| 0а | 0а-1…0а-5 | — | — |
| 0б | 0б-0, 0б-2, 0б-10, 0б-11 | 0б-3 (`w7-0b-3`), 0б-6 (`w7-0b-6`) | 0б-1, 0б-4, 0б-5, 0б-7, 0б-8, 0б-9 |
| 1 | 1-1, 1-2 (#366), 1-3, 1-4 | 1-7 (`w7-1-7`) | 1-5, 1-6, 1-8 |
| 2 | 2-2 (#358) | 2-1 (`w7-2-1`), 2-4 (`w7-2-4`), 2-5 (`w7-2-5`) | 2-3, 2-6, 2-7, 2-8, 2-9 |
| 3 | — | — | 3-1, 3-2 |

### 0.2 Предусловия этапа (обязательны до старта 4-1)

Этап 4 стартует, когда ни одна колонка не рисуется React (план программы, «Почему этот порядок»,
`:272-277`). По задачам это значит:

1. **Весь этап 2, включая 2-9.** `components/Sidebar.tsx` удалён, `components/sidebarLeft/index.ts`
   экспортирует синглтон `appSidebarLeft`. Узел `#column-left` с разметкой tweb `index.html:91-107`
   рисует `App.tsx` статичной разметкой, а `appSidebarLeft` создаётся из `useLayoutEffect` шелла с
   пометкой `// ВРЕМЕННО до Э4-1` (план, этап 2, «Узел», `:974-978`). Модуль
   `sidebarLeft/columnSlider.ts` снят задачей 2-1 (сейчас у него 13 строк `ВРЕМЕННО до 2-1` и две
   `ВРЕМЕННО до Э4-1`, `columnSlider.ts:31`, `:88`).
2. **Этап 1 целиком (1-5…1-8).** Особенно 1-5: строка «Архив» сейчас — React-остров с
   `createRoot` из `react-dom/client` (`components/autonomousDialogList/dialogs.ts:56`, `:378`,
   `ВРЕМЕННО до 1-5`). Ворота 4-7 требуют, чтобы `react-dom/client` остался только у разрешённых
   островов.
3. **Весь этап 0б и этап 3 (3-1, 3-2).** `UserInfoPanel.tsx`, `reactProfileTab.ts`,
   `useRightColumnShown.ts` удалены. Вкладка общих медиа живёт у инстанса чата: её создаёт хук
   `useChatSharedMediaTab` в `Chat.tsx` (`// ВРЕМЕННО до Э6`, план, 3-2 (а), `:1162-1166`).
   `replaceSharedMediaTab` пока зовёт сам `Chat.tsx` (сейчас `Chat.tsx:384`, `:394`).
4. **NAV-01…NAV-06 в каталоге e2e** (их добавляет 3-2, план `:336-349`).
5. **В-6 = «А»** (решение пользователя: по всем открытым вопросам плана — вариант А). P0-набор
   Playwright влит в `main` и гоняется автоматически. Сейчас каталога в `main` нет
   (`docs/testing/` отсутствует, набор — на ветке `origin/docs/e2e-scenarios-plan`). Без этого
   ворота этапа 4 проверяются вручную, и это записывается в PR как риск.
6. **2C-21 и 2C-27** (`FolderInvitePopup`, `ReportPopup` уходят из `GlobalOverlays`, план
   `:152-154`). Если они не успели, оба остаются в острове оверлеев 4-7 с пометкой
   `// ВРЕМЕННО до 2C-21` / `2C-27`. Ворота от этого не меняются.

### 0.3 Где этот план опирается на ещё не сделанное

| Опора | Кто делает | Что предполагает план | Если окажется иначе |
|---|---|---|---|
| Синглтон `appSidebarLeft` создаётся из React-хоста | 2-1, 2-9 | 4-1 переносит создание «при импорте» (tweb `sidebarLeft/index.ts:1798`) и снимает его `destroy()` | 4-1 сверяет фактическое API 2-1 по коду; шаги «снять `destroy`» применяются к тому, что 2-1 оставил |
| `appDialogsManager.start(host, chatsContainer, hooks)` зовётся из React-хоста колонки | сейчас `Sidebar.tsx:328`, после 2-9 — `App.tsx` | 4-1 приводит владельца к форме tweb: синглтон на `#chatlist-container`, `start()` без аргументов (`appDialogsManager.ts:847-998`) | Если 2-1 уже свёл аргументы — 4-1 делает только снос `destroy()` |
| `selectProfileTab` в `chatHistory.ts:504` — единственный срез `selectTab` | 0б-0 | 4-2 заменяет его настоящим `appImManager.selectTab` | — |
| `useChatSharedMediaTab` создаёт вкладку у инстанса | 3-2 | 4-3 отдаёт её фасаду (`facade.sharedMediaTab`), и `replaceSharedMediaTab` зовёт класс (`appImManager.ts:3277`), а не `Chat.tsx` | Если 3-2 положил вкладку иначе, 4-3 сводит её к полю фасада |
| Вьювер историй открывается функцией | 2-6 (`// ВРЕМЕННО до 5-7`) | хост `StoryViewer` к 4-7 уже не в дереве шелла: сейчас его рисует `useSidebarStories.tsx:89`, хук уходит в 2-6 | Если хост остался в `App.tsx`, 4-7 переносит его в остров оверлеев |

### 0.4 Что из нашего кода уже есть и переиспользуется

- `core/navigation/appNavigationController.ts` (614) — порт контроллера. Нет `reload`, `close`,
  `focus`, `navigateToUrl` (шапка `:54`). `reload` понадобится в 4-1 (выход, кнопка обновления).
- `lib/appImManager.ts` (202) — **уже существует** как модуль функций: `getTypingElement`,
  `getPeerTyping` (срез задачи 1-4, шапка `:1-21`). Задача 4-2 кладёт класс в этот же файл.
  Функции остаются функциями модуля до 5-3 (шапка их так и объявляет).
- `core/chat/chatPositions.ts` (57) — порт `chatPositions` (`appImManager.ts:236-238`), а
  `ChatBubbles.saveChatPosition` (`bubbles.ts:6354`) — порт `saveChatPosition`. В 4-5 оба переходят
  в класс.
- `core/dom/mediaSizes.ts` (315): `isMobile` `:130`, `isFloatingLeftSidebar` `:131`, `activeScreen`
  `:134`, события `changeScreen`/`resize`.
- `helpers/eventListenerBase.ts`, `helpers/idleController.ts`, `helpers/liteMode.ts`,
  `core/dom/heavyAnimation.ts`, `helpers/dom/blurActiveElement.ts` — всё, что нужно `selectTab`.
  `disableTransition` у нас нет (`chatHistory.ts:499` объявляет это), и 4-2 его портирует
  (`helpers/dom/disableTransition.ts` tweb).
- `shared/solid/mountSolid.solid.tsx` (164) — образец для `shared/react/mountReact.tsx`.
  Каталога `shared/react/` пока нет.
- `core/hooks/useImperativeIsland.ts` (177) — мост «класс внутри React». Здесь он не нужен:
  направление обратное (React внутри класса).
- `core/hooks/useClassEvent.ts` **не заведён** (0б-0 «Сделано»: потребителя не было). Первый
  потребитель — остров инстанса в 4-3.
- `client/boot.ts` (307): `bootstrap()` `:100`, `waitForUnlock` `:134-150`, состояние и лангпак
  `:193-209`, тема/фон `:218-227`, `bootstrapHash` `:261`, `setBootData` `:279`.

---

## 1. Задачи этапа

Порядок и зависимости — как в плане программы (`:259-262`):

```
4-1 index.html + src/index.ts + bootstrapIm ──► 4-2 AppImManager: каркас, selectTab, колонки
    ──► 4-3 стек чатов + ChatFacade ──► { 4-4 хэш · 4-5 фон/тема/позиции · 4-6 подписки construct }
    ──► 4-7 снос main.tsx/App.tsx, остров оверлеев
```

4-4, 4-5 и 4-6 пишутся параллельно (порт в новых методах), а врезаются в `lib/appImManager.ts`
по одной, после ребейза. Все задачи — отдельные PR от `main`, без стеков.

**Общие для всех задач этапа шаги** (в каждой задаче ниже они подразумеваются):
- Шаг 0: E2E-ворота «до» на `main` (раздел 2), результат — в PR.
- Перед коммитом: полный `vitest run --maxWorkers=3` под `heavy.lock`, `npx tsc --noEmit`,
  `npx oxlint --type-aware` по изменённым. `realtimeBridge` флакает ~1 из 10 — перепроверять
  изолированно.
- Мутации прогоняются фактически, реальный вывод vitest — в теле коммита (DoD 3-4).
- Число `.tsx` с `from 'react'` без тестов (на `d0f64d5b` — **146**) уменьшается на число
  удалённых файлов, список — в PR (DoD 14).
- Каждая задача обновляет «у нас» в `docs/tweb/state-and-layout.md` § 5, § 6 и в
  `docs/tweb/app-architecture.md` § 9.1.

---

### Задача 4-1: `index.html` + `src/index.ts` + `pages/bootstrapIm.ts`

**Порт:**
- tweb `index.html:87-116`: `a#skip-to-content.sr-only.sr-only-focusable[hidden]` `:87`,
  `.sidebar-left-overlay` `:88`, `#page-chats.whole.page-chats[style="display: none;"]` `:89`,
  `#main-columns.tabs-container[data-animation=navigation]` `:90`, `#column-left` с вкладкой №0
  `:91-107`, `#column-center.tabs-tab.main-column[role=main][tabindex=-1]` `:109`,
  `#column-right` `:110-112`, `#stories-viewer` `:115`, `<script src="src/index.ts">` `:116`.
  SVG-спрайт: `#svg-defs` (`#logo`, `#check`, `#checkbox-cross`) из `components/SvgDefs.tsx` (23)
  переезжает в `index.html` рядом с уже лежащим там спрайтом (`index.html:45-55`), как у tweb
  (`index.html:45-85`, `#svg-defs` `:46`).
- tweb `src/index.ts:417-675` поверх нашего `client/boot.ts`. Наш `bootstrap()` уже несёт шаги
  `:442-534` (менеджеры, `preventCrossTabDynamicImportDeadlock` `:451`, `waitForUnlock` `:453-468`,
  состояние `:478`, лангпак `:510`, тема и фон `:534`, `:567-568`). Новое — развилка `:613-673`:
  неавторизован → `mountAuthFlow` (`:640-641`), иначе `fadeInWhenFontsReady(#main-columns)`
  (вызов `:645-646`, функция `:551-560`) и `bootstrapIm()`; анимация входа `should_animate_main` →
  `main-screen-enter`/`main-screen-entering` (`:650-669`).
- tweb `pages/bootstrapIm.ts:21-70`: идемпотентность `:9`, `:22-23`; показ `#page-chats` `:27-28`;
  `blurActiveElement` `:30`; `appDialogsManager.start()` `:51`; `doubleRaf` → снятие
  `has-auth-pages` `:60-61`; `disposeActiveAuthFlow` через 1 с `:65-67`.
  `pushToState('authState')` `:25` у нас нет (REST-авторизация без `AuthState`, шапка
  `mountAuthFlow.solid.tsx:21-29`), рекордер и полифил `:32-46` — не наши (рекордер нативный,
  `core/audio/nativeVoiceRecorder.ts`).
- tweb `pages/mountAuthFlow.tsx:28`, `:62` — модульный `activeDispose` и
  `disposeActiveAuthFlow()`. Наш `mountAuthFlow.solid.tsx` объявляет их отсутствие расхождением
  (`:43-54`) именно до появления второго вызывающего. Второй вызывающий — `bootstrapIm`, и
  расхождение снимается.
- **Выход = перезагрузка**, как у tweb: `rootScope 'logging_out'` → `onLoggedOut`
  (`lib/apiManagerProxy.ts:619-634`, `:676-704`) → `appNavigationController.reload(url)`
  (`components/appNavigationController.ts:499-511`; `close`/`focus`/`navigateToUrl` — `:513-537`). Наш `useAuthGate.onLoggingOut` сбрасывает
  состояние в памяти и размонтирует шелл (`useAuthGate.ts`, `resetAccountStateInMemory`). Со
  статичными колонками и вечными синглтонами размонтировать нечего. Вопрос **В4-1**.
- Вход: `AuthCardsHost` по успеху зовёт `bootstrapIm()` (tweb `pages/AuthCardsHost.tsx:105`).
  Сейчас наш `onComplete` приходит пропом из `App.tsx` (`AuthCardsHost.solid.tsx:66`, `:163`,
  `:210`).
- **Вечные синглтоны** (поправка 13 плана, `:123-126`): `appSidebarRight` создаётся при импорте
  (tweb `sidebarRight/index.ts:141-143`), `appSidebarLeft` — тоже (`sidebarLeft/index.ts:1798`),
  `appDialogsManager` — синглтон на `#chatlist-container` (`appDialogsManager.ts:3064`, `:765`).
- **Вынос клиента в окно PiP** — у tweb переносится `#page-chats` и прочие узлы верхнего уровня
  `body` (`components/clientPip.tsx:18-21`, `:48`, `:64-89`). Наш `core/pip.ts` переносит `#root`
  (`:62`, `:87-89`, `:118`), а колонки после 4-1 стоят вне `#root`.

**Временное (с номерами):**
- `#root` остаётся в `index.html` до 4-7. В нём живёт урезанный React-шелл (хуки, оверлеи,
  центр). Его монтирует `bootstrapIm` вызовом `mountReactShell()` из `main.tsx` —
  `// ВРЕМЕННО до Э4-7`.
- Центр до 4-3 — React `ChatsContainer` порталом в статичный `#column-center` —
  `// ВРЕМЕННО до Э4-3`.
- `appImManager.construct` в `appDialogsManager.start` до 4-2 не зовётся, строки нет.

**Файлы:**
- Создать: `web-client/src/index.ts` (~180, порт `index.ts:417-675` поверх `boot.ts`),
  `web-client/src/pages/bootstrapIm.ts` (~60), `web-client/src/index.test.ts`,
  `web-client/src/pages/bootstrapIm.test.ts`, `web-client/src/indexHtml.test.ts` (разметка
  каркаса).
- Изменить: `web-client/index.html` (63 → ~110: каркас, `#svg-defs`, `script src="/src/index.ts"`);
  `client/boot.ts` (отдаёт `hasToken` для развилки; `bootstrapHash` `:261` остаётся до 4-4);
  `main.tsx` (39 → ~25: `mountReactShell(managers)` без `bootstrap()`); `App.tsx` (325 → ~230: нет
  разметки колонок `:187-198`, нет `ThemedApp`-ветки `authed` `:214-264`, нет `mountAuthFlow`
  `:247-251`, нет снятия `has-auth-pages` `:71-73`, нет `createAppSidebarRight` `:59-63`, нет
  `useShellEnterAnimation` `:75`); `components/auth/mountAuthFlow.solid.tsx` (114: модульный
  `activeDispose`, `disposeActiveAuthFlow`, без своей записи `has-auth-pages` `:102`, `:112`);
  `components/auth/AuthCardsHost.solid.tsx` (успех → `bootstrapIm()`);
  `core/navigation/appNavigationController.ts` (+`reload`, `close`, `focus`, `navigateToUrl` —
  tweb `:499-537`; шапка `:54` сокращается); `components/sidebarRight/index.ts` (202 → ~175:
  синглтон при импорте, нет `createAppSidebarRight`, `destroy`, полей `onChangeScreen`/
  `disposeColumnResize`; снимаются `ВРЕМЕННО до Э4-1` `:19`, `:55`, `:181`, `:193`);
  `components/sidebarLeft/index.ts` (то же для `appSidebarLeft`); `components/slider.ts`
  (снять `destroy` `:155-170`); `lib/appDialogsManager.ts` (2026: синглтон, `start()` без
  аргументов, нет `destroy()`; снимаются расхождения 1, 2, 7, 17, 18 шапки `:34-115`);
  `core/pip.ts` (переносится `#page-chats` и узлы верхнего уровня `body`, как
  `clientPip.tsx:48-89`).
- Удалить: `core/hooks/useAuthGate.ts` (203) + `useAuthGate.test.tsx` (310 → пины в
  `index.test.ts`); `core/hooks/useShellEnterAnimation.ts` (42); `components/SvgDefs.tsx` (23);
  `App.authMount.test.ts` (123 → пины в `index.test.ts`).
- Тесты, которые переезжают: `client/boot.order.test.ts` (173), `boot.passcodeLock.test.ts` (115),
  `boot.firstPage.test.tsx` (314) — на `index.ts`; `sidebarRight/index.test.ts` (265) — без
  `createAppSidebarRight`/`destroy`, через `vi.resetModules()` и свежий DOM из `index.html`.

- [ ] **Шаг 1: прочитать** tweb `index.html:41-118`, `src/index.ts:417-675`, `pages/bootstrapIm.ts`,
  `pages/mountAuthFlow.tsx`, `pages/AuthCardsHost.tsx:90-110`, `lib/apiManagerProxy.ts:619-704`,
  `components/appNavigationController.ts:499-537`, `components/clientPip.tsx`;
  `docs/tweb/app-architecture.md` § 1.1–1.5; наш `client/boot.ts`, `useAuthGate.ts`,
  `mountAuthFlow.solid.tsx`, `App.tsx:48-264`, `core/pip.ts`.
- [ ] **Шаг 2: падающие тесты.**
  - `indexHtml.test.ts` (парсит `web-client/index.html` в happy-dom): (а) порядок и классы узлов —
    ровно tweb `index.html:87-116`: `#skip-to-content[hidden]`, `.sidebar-left-overlay`,
    `#page-chats` с `display: none`, внутри `#main-columns > #column-left, #column-center,
    #column-right`; у `#column-center` — `role=main`, `tabindex=-1`; у `#column-left` вкладка №0
    `.tabs-tab.sidebar-slider-item.item-main.active` с `#chatlist-container > #folders-container`
    и `#search-container`; (б) `#svg-defs` содержит `#logo`, `#check`, `#checkbox-cross`;
    (в) `<script type=module src="/src/index.ts">`.
  - `index.test.ts` (реальный `boot.ts`, фейковый транспорт `startClient`): (г) нет токена →
    `mountAuthFlow` вызван один раз, `#page-chats` скрыт, `appDialogsManager.start` не вызван;
    (д) токен есть → `bootstrapIm`, `mountAuthFlow` не вызван; (е) порядок
    `waitForUnlock` → `loadState` → лангпак → развилка (перенос пинов `boot.order.test.ts`;
    AUTH-08 «без сетевых запросов до ввода»); (ж) `RT.loggingOut` → `persist.clearAll()` и
    `appNavigationController.reload` (стек навигации пуст, `location.reload` вызван один раз),
    ни один синглтон не уничтожается; (з) `migrateTo` → `saveEncryptionKeyForHandoff`, потом
    `reload` (перенос из `useAuthGate.test.tsx`); (и) анимация входа: ключ `ANIMATE_MAIN_KEY` →
    `#page-chats.main-screen-enter`, через `doubleRaf` + 200 мс класса нет (tweb `:650-669`).
  - `bootstrapIm.test.ts` (фейковые таймеры): (к) `#page-chats` виден, `appDialogsManager.start`
    вызван один раз; (л) `has-auth-pages` снимается **после** `doubleRaf`, не синхронно
    (`bootstrapIm.ts:52-61`); (м) повторный вызов — no-op; (н) `disposeActiveAuthFlow` — ровно
    через 1000 мс, auth-хост `#auth-flow-root` ушёл из DOM.
  - `sidebarRight/index.test.ts`: (о) импорт модуля на DOM из `index.html` →
    `appSidebarRight.sidebarEl === #column-right`; скан: `git grep -n "createAppSidebarRight\|destroyColumnSlider\|ВРЕМЕННО до Э4-1" web-client/src` пуст.
  - `core/pip.test.ts`: (п) `enterAppPip` переносит `#page-chats` и оверлеи верхнего уровня, на
    месте — заглушка; возврат кладёт их обратно в прежнем порядке.
- [ ] **Шаг 3: убедиться, что падают.** **Мутации (фактически):** снять `await doubleRaf()` перед
  снятием `has-auth-pages` → (л) краснеет; убрать флаг `bootstrapped` → (м) краснеет
  (`start` дважды); на `loggingOut` оставить прежний сброс в памяти без `reload` → (ж) краснеет;
  поставить лангпак до `waitForUnlock` → (е) краснеет.
- [ ] **Шаг 4: реализовать** дословно. Шапки: `порт tweb/src/index.ts:417-675`,
  `порт tweb/src/pages/bootstrapIm.ts:1-70`. Расхождения нумерованным списком в шапке
  `index.ts`: нет `AuthState` и `pushToState` (REST); `singleInstance` (`:487-494`, О-128),
  `checkLastActiveAccountFromTMe`/`telegramMeWebManager` (О-129), test-режим `tgWebAuthTest` и
  `cancelWebTokenAuthorization` (`:578-605`, О-129); `?popups=1`-песочница — не наша.
- [ ] **Шаг 5: врезка** (последний коммит, после ребейза): `index.html`, `main.tsx`, `App.tsx`,
  снос `useAuthGate`/`useShellEnterAnimation`/`SvgDefs`.
- [ ] **Шаг 6: стенд** (`https://web.telegram.localhost`): AUTH-01, AUTH-02, AUTH-12 (выход —
  перезагрузка, экран входа, `persist` пуст), AUTH-08 (замок до запросов), P0-01…P0-10; F5 на
  открытом чате. Числа «было/стало»: время до первого кадра списка (Performance, `bootstrapIm`),
  число узлов `#main-columns` до монтирования React.

**Готово когда:** `web-client/index.html` содержит каркас tweb; `git grep -n "useAuthGate\|useShellEnterAnimation\|SvgDefs\|createAppSidebarRight" web-client/src` пуст; `has-auth-pages` пишут только `index.html`, `bootstrapIm.ts` и `mountAuthFlow.solid.tsx`
(скан); выход перезагружает страницу.
**Оценка:** **4 дня** (план программы — 3; +1 за выход через `reload`, вечные синглтоны и PiP).
**Зависимости:** этапы 2, 3 целиком (§ 0.2).
**Риски.** (1) Тесты, которые сейчас поднимают и сносят колонки многократно
(`createAppSidebarRight` — 4 файла, `createColumnSlider`/`destroyColumnSlider` — 5,
`appDialogsManager.testkit`/`new AppDialogsManager` — 12), переводятся на `vi.resetModules()` +
свежий DOM. Это главная часть объёма задачи. (2) Порядок `boot.ts` ↔ `index.ts` фиксирован (риск 3
плана программы). (3) Выход через перезагрузку меняет видимое поведение (кадр белого экрана) —
это поведение tweb (6a).

---

### Задача 4-2: класс `AppImManager` — каркас, `selectTab`, колонки

**Порт** (`lib/appImManager.ts`, к модулю функций `:1-202` добавляется класс):
- A. Типы: `ChatSavedPosition` `:163-180`, `ChatSetPeerOptions` `:182-202`,
  `ChatSetInnerPeerOptions` `:204-207`, `APP_TABS` `:209-213`. `JoinChatFlow`,
  `JoinConference*`, `CallSwitchCancelledError` (`:215-250`) — с их подсистемами (5-5, 5-6).
- B. Поля и события `:252-302`: `EventListenerBase<{chat_changing, peer_changed, peer_changing,
  tab_changing, premium_toggle}>`, `columnEl = #column-center` `:259`, `chatsContainer`,
  `appChatBackground`, `offline`, `updateStatusInterval`, `tabId`, `chats`, `prevTab`, геттеры
  `myId` `:296`, `chat` `:300`. Синглтон при импорте `:3989-3991`.
- `construct(managers)` — в объёме этой задачи: `selectTab(APP_TABS.CHATLIST)` `:347`,
  `attachSkipToContent` + `setStaticLandmarkLabels` `:349-352`, `idleController` `:354-362`,
  `mediaSizes` `changeScreen` `:458-467` (обе колонки открыты → `appSidebarRight.toggleSidebar(false)`,
  `updateColumnAccessibility`), `useHeavyAnimationCheck` → `animationIntersector` `:436-442`.
- J (часть): `selectTab` `:3137-3197` (`disableTransition` при `animate === false`,
  `is-left-column-shown`, `overrideHash` `:3146`, `tab_changing`, тяжёлая анимация
  `(isMobile ? 250 : 200) + 100` `:3164`, `updateColumnAccessibility`, `blurActiveElement`,
  `appSidebarRight.hide()` на мобильном PROFILE → ниже `:3174-3176`, запись `im` `:3178-3188`),
  `setStaticLandmarkLabels`/`updateColumnAccessibility` `:3199-3208`, `updateStatus`/`goOffline`
  `:3210-3217`.
- `appDialogsManager.start` зовёт `appImManager.construct(managers)` (tweb `appDialogsManager.ts:988`),
  после `appSidebarLeft`/`appSidebarRight.construct` (`:983-984`).

**Временное (с номерами):**
- До 4-3 стек чатов — `chatStackStore`, выбор — `navigationStore`. `selectTab` зовёт мост в
  `core/navigation/chatHistory.ts`: подписка на `navigationStore.selectedId` →
  `appImManager.selectTab(selectedId ? CHAT : CHATLIST)` — `// ВРЕМЕННО до Э4-3`. `onPop` записи
  `im` зовёт `closeChatLevel()` вместо `setPeer({}, canAnimate)` — `// ВРЕМЕННО до Э4-3`.
- `overrideHash` в `selectTab` до 4-4 зовёт `syncChatHash()` (`chatHistory.ts:75`) —
  `// ВРЕМЕННО до Э4-4`.
- `updateStatus`/`goOffline` — **О-125**: ручки `account.updateStatus` на бэкенде нет, присутствие
  ведётся по WS-соединению (`backend/internal/adapter/realtime/redis/presencestore.go:36-37`,
  `SetOffline`), а `presence_handler.go` отдаёт только чтение. Методы портируются с телом
  `// О-125 волна 7`, `idleController` пишет `offline`.

**Файлы:**
- Изменить: `lib/appImManager.ts` (202 → ~420: класс, синглтон, шапка с расхождениями);
  `lib/appDialogsManager.ts` (вызов `construct`); `components/sidebarRight/index.ts:165`
  (`selectProfileTab(animate)` → `appImManager.selectTab(active ? APP_TABS.CHAT : APP_TABS.PROFILE, animate)`,
  tweb `:125`; снимается `ВРЕМЕННО до Э4-2` `:32`, `:165`); `core/navigation/chatHistory.ts` (518:
  `selectProfileTab` `:504-518` и `pushImRecordIfNeeded` `:302-323` удаляются — запись `im` ставит
  `selectTab`; мост выше); `App.tsx` (нет `useLeftColumnShown` `:86`, тяжёлой анимации
  `:132-144`, `useMediaQuery` `:98` — ширину читает `mediaSizes`).
- Создать: `helpers/dom/disableTransition.ts` (порт tweb, ~15), `lib/appImManager.test.ts`.
- Удалить: `core/hooks/useLeftColumnShown.ts` (24) + тест (39); `shared/lib/useMediaQuery.ts`, если
  других потребителей нет (проверить `git grep useMediaQuery`).

- [ ] **Шаг 1: прочитать** tweb `appImManager.ts:160-360`, `:436-477`, `:3127-3218`;
  `docs/tweb/state-and-layout.md` § 6 (колонки, брейкпоинты), `app-architecture.md` § 6.1, § 8.5;
  наш `chatHistory.ts:128-323`, `:486-518`, `App.tsx:84-144`.
- [ ] **Шаг 2: падающие тесты** (`lib/appImManager.test.ts`, DOM из `index.html`, реальный
  `appNavigationController`, `mediaSizes` по ширине — приём `chatHistory.test.ts:24-30`):
  (а) `construct` → `body.is-left-column-shown`, `tabId === CHATLIST`, записи `im` нет,
  `tab_changing` не диспатчится (`prevTabId === undefined`); (б) `selectTab(CHAT)` → класс снят,
  одна запись `im`, `tab_changing(1)`; второй `selectTab(CHAT)` записей не добавляет;
  (в) `selectTab(PROFILE)` при записи `im` — вторая не добавляется (`:3179`); (г) мобильный экран
  (600): после `selectTab(CHAT)` `#column-left.inert`, `#column-center` не `inert`; на 1280 оба
  не `inert`; (д) мобильный, PROFILE → CHAT зовёт `appSidebarRight.hide()`; (е) 700 + анимации →
  `dispatchHeavyAnimationEvent` с 300 мс, мобильный — 350 мс, 1280 — нет; (ж) `animate === false`
  → `disableTransition` на трёх колонках; (з) `changeScreen` при обеих открытых колонках →
  `appSidebarRight.toggleSidebar(false)`; (и) Back на записи `im` возвращает CHATLIST;
  (к) скан «один писатель `is-left-column-shown`»: `git grep -n "is-left-column-shown"` с
  `classList` вне `lib/appImManager.ts` пуст (в CSS и комментариях — можно).
- [ ] **Шаг 3: мутации (фактически):** снять проверку `findItemByType('im')` `:3179` → (в)
  краснеет; не звать `updateColumnAccessibility` из `selectTab` → (г) краснеет; оставить
  `useLeftColumnShown` писателем → (к) краснеет.
- [ ] **Шаг 4: реализовать** дословно. Шапка класса — `порт tweb/src/lib/appImManager.ts` с
  перечнем блоков (A–M) и того, какая задача какой блок переносит.
- [ ] **Шаг 5: врезка:** `appDialogsManager.start`, `sidebarRight/index.ts`, `chatHistory.ts`,
  `App.tsx`, снос `useLeftColumnShown`.
- [ ] **Шаг 6: стенд:** P0-02, NAV-01 (Back → список, Forward → чат), NAV-03 (профиль на мобильном),
  переход список ↔ чат на 375/700/1280 без «въезда» на первом кадре; кадры перехода (Performance)
  до/после в коммит.

**Готово когда:** писатель `is-left-column-shown` — только `AppImManager.selectTab`;
`git grep -n "ВРЕМЕННО до Э4-2\|selectProfileTab\|useLeftColumnShown" web-client/src` пуст.
**Оценка:** 2,5 дня. **Зависимости:** 4-1.
**Риски.** Две записи `im`: сейчас её ставит `pushImRecordIfNeeded`, после задачи — `selectTab`.
Обе живут не дольше одного коммита (пин (б)).

---

### Задача 4-3: стек чатов + `ChatFacade`

**Порт:**
- J: `createNewChat` `:3219-3231`, `spliceChats` `:3233-3290` (`peer_changing`, `chat_changing`,
  `removeByType('chat', true)` на `spliced.length - 1` `:3249-3253`, снятие средних контейнеров
  `:3256-3260`, `chatsSelectTab`, `publishBackground` назад `:3267-3269`, `peer_changed`,
  закрытие `AppPrivateSearchTab` `:3274-3275`, `replaceSharedMediaTab(chatTo.sharedMediaTab)`
  `:3277`, `beforeDestroy` и `destroy` через `250 + 100` мс `:3280-3289`), `setPeer`
  `:3292-3390` (без `min`-пиров `:3297-3317` — у нас их нет), `setInnerPeer` `:3392-3434`
  (переиспользование `existingIndex`, «первый неинициализированный», `crossfade-forwards`),
  `openScheduled` `:3436`, `toggleViewAsMessages` `:3443` (О-88 — флага нет на бэкенде),
  `isSamePeer` `:3809-3816`, `chatsSelectTab` `:2766-2805` (запись `chat` через `spliceItems`).
- C (часть): `.chats-container.tabs-container[data-animation=navigation]` `:368-375`,
  `createNewChat()` + `chatsSelectTab(this.chat)` `:381-382` — **`chats[0]` существует всегда**, с
  пустым пиром; вызов `appDialogsManager` → `peer_changed` (tweb `appDialogsManager.ts:1178`).
- `ChatType` — порт `components/chat/chatType.ts` (enum tweb, значения совпадают со строками
  `chatStackStore.ts:10`).
- **`ChatFacade`** (`components/chat/chatFacade.ts`) — члены «нужны с 4-3» из таблицы плана
  программы (`:1220-1227`): `container` (`.chat.tabs-tab`, как `chat.ts:254-256`), `peerId`,
  `threadId`, `monoforumThreadId`, `type`, `inited`, `sharedMediaTab`, `appImManager`,
  `setPeer(options) → {cached, promise}` (семантика `inited` — `chat.ts:1035-1046`), `beforeDestroy`,
  `destroy`. `bubbles` и `selection` — ссылки на настоящие классы, которые создаёт `VanillaFeed`
  (`VanillaFeed.tsx`); отдаются фасаду, когда остров их создал.
- **Остров инстанса**: `shared/react/mountReact.tsx` (зеркало `mountSolid.solid.tsx`: обязательный
  `ErrorBoundary`, `ManagersProvider`, возвращает `unmount`), `ChatIsland` внутри
  (`ChatInstanceProvider` + `<Chat chat={…} thread={…} onBack={…}>`). Активность инстанса остров
  читает через `core/hooks/useClassEvent.ts` (`useSyncExternalStore` поверх
  `appImManager.addEventListener('chat_changing' | 'peer_changed')` + геттер `appImManager.chat`,
  мост чтения п. 4 плана, `:172-177`).

**Временное (с номерами):**
- Каждый член `ChatFacade`, файл `chatFacade.ts`, `mountReact.tsx`, `ChatIsland` — `// ВРЕМЕННО до Э6`.
- Мета треда (`ChatInstanceDesc.thread`: заголовок, подзаголовок, цвет иконки, `topicId`, `kind`,
  `chatStackStore.ts:12-33`) — у tweb её читают `Chat`/`ChatTopbar` из менеджеров. До 6-2 фасад
  несёт её полем `thread` из опций `setInnerPeer` — `// ВРЕМЕННО до Э6-2`.
- Черновик «пир без диалога» (`navigationStore.draftPeer`, `selectChat('draft:<id>')`,
  `openPeer.ts:36-44`, `useNavigationActions.onChatCreated`) — у tweb такого понятия нет: пир
  открывается `setPeer({peerId})`, карточка берётся из зеркала. Вопрос **В4-2**. По рекомендации
  «А»: сущность для `Chat.tsx` строит `resolveChatEntity` из списка или из `cachedPeer`
  (`core/peerCache.ts:62`), `draft:` и `draftPeer` удаляются.
- Вызывающие из соседних задач, у которых настоящий метод придёт позже: `useAppHotkeys.ts`
  (`selectChat` `:38`, `:49` → `appImManager.setInnerPeer`, `appImManager.chat.peerId`) —
  `// ВРЕМЕННО до 5-1`; `useDeepLinks.ts` (`selectChat` `:152`, `syncChatHash` `:12`) —
  `// ВРЕМЕННО до 5-4`; SW-сообщение `open-chat` (`useChatNavigation.ts:16-26`) переходит в
  `client/uiNotifications.ts` вызовом `appImManager.setInnerPeer` (у tweb — клик уведомления,
  `uiNotificationsManager`) — без пометки.

**Файлы:**
- Создать: `components/chat/chatFacade.ts` (~220), `components/chat/chatType.ts` (~15),
  `shared/react/mountReact.tsx` (~90), `core/hooks/useClassEvent.ts` (~30),
  `components/chat/chatIsland.tsx` (~60); тесты `lib/appImManager.chats.test.ts` (перенос
  `chatHistory.test.ts` 670 + `ChatsContainer.test.tsx` 325), `chatFacade.test.ts`,
  `shared/react/mountReact.test.tsx`, `useClassEvent.test.ts`.
- Изменить: `lib/appImManager.ts` (~420 → ~700); `lib/appDialogsManager.ts` (`:946` подписка на
  `navigationStore` → `appImManager.addEventListener('peer_changed')`, tweb `:1178`; `:1290`
  выбранный пир → `appImManager.chat.peerId`; `:1578` `openPeer` → `appImManager.setInnerPeer`/
  `setPeer`, как tweb `:2094`); `components/Chat.tsx` (1617: нет `useChatStackStore` `:30`, `:184`
  → `appImManager.setInnerPeer`; `backChatLevel`/`closeChatLevel` `:31`, `:180`, `:585` →
  `appNavigationController.back(…)` и `appImManager.setPeer({isDeleting: true})`;
  `replaceSharedMediaTab` `:384`, `:394` снимается — его зовёт класс; мост
  `emoticonsSearchBridge` `:109`, `:1114-1116` снимается; `useChatsStore.setActiveChat` `:352-356`
  снимается — активный пир читают из `appImManager.chat`);
  `client/uiNotifications.ts:37` и `client/realtime/soundSubscriber.ts:34` (`activePeerId` →
  `appImManager.chat.peerId`); `stores/chatsStore.ts` (нет `activePeerId`/`setActiveChat`
  `:28`, `:54`, `:109`, `:162`); `components/sidebarRight/tabs/{stickers,gifs}.solid.tsx`
  (импорт настоящего `appImManager`, `:63`, `:35`); `components/solidJsTabs/tabs.ts:668`
  (строка комментария); вкладки, которые зовут `openPeer` (`sidebarLeft/tabs/{calls,newChannel,
  newGroup}.solid.tsx`, `sidebarRight/savedDialogsTab.solid.tsx`, `searchGroup.solid.tsx`) и
  `toolsMenu.ts:133` («Избранное» → `appImManager.setPeer({peerId: myId})`), `deleteDialog.ts:37-38`;
  `App.tsx` (нет `chatArea` `:159-171`, `resolveChat` `:157`, `useChatNavigation` `:82`,
  `startChatHistory` `:91`, `backToList` `:111`); `core/chatEntity.ts` (тип дескриптора — из
  фасада); `core/chat/chatInstanceContext.tsx` (значение даёт остров).
- Удалить: `components/chat/ChatsContainer.tsx` (166) + тест (325); `stores/chatStackStore.ts`
  (197); `stores/navigationStore.ts` (43); `core/navigation/chatHistory.ts` (518) + тест (670 →
  перенос); `core/hooks/useChatNavigation.ts` (35); `core/hooks/useNavigationActions.ts` (94) +
  тест (155 → перенос); `core/navigation/openPeer.ts` (46) + тест (37);
  `core/navigation/startSecretChat.ts` (23) — вызов переходит к `appImManager.setInnerPeer`
  (Отступление В7-1, вход скрыт флагом); `sidebarRight/tabs/emoticonsSearchBridge.ts`.
  Импортёры `chatStackStore` (11 без тестов) и `navigationStore` (12 без тестов) на `d0f64d5b` —
  после этапов 2–3 часть уйдёт с `Sidebar.tsx`; задача сносит всех оставшихся.

- [ ] **Шаг 1: прочитать** tweb `appImManager.ts:252-302`, `:364-382`, `:2766-2805`, `:3219-3452`,
  `:3809-3816`, `chat.ts:233-273`, `:837-883`, `:1035-1080`; `docs/tweb/state-and-layout.md` § 5
  (навигация), `app-architecture.md` § 7а; наш `chatStackStore.ts`, `navigationStore.ts`,
  `chatHistory.ts` (весь), `ChatsContainer.tsx`, `chatEntity.ts`, `Chat.tsx:160-400`, `:575-590`.
- [ ] **Шаг 2: перенос пинов до кода** (риск 1 плана программы). `chatHistory.test.ts` (21 тест)
  и `ChatsContainer.test.tsx` (13) переписываются на `appImManager` **до** реализации и падают на
  отсутствии методов. Поимённое соответствие «старый тест → новый» — в теле коммита.
- [ ] **Шаг 3: новые падающие тесты** (`appImManager.chats.test.ts`, DOM из `index.html`,
  фейковые таймеры, `mountReact` с подменой `Chat.tsx` на пустую заглушку — проверяется
  класс, не лента):
  (а) после `construct` в `chatsContainer` ровно один `.chat.tabs-tab`, `chats.length === 1`,
  `chat.peerId === 0`, React-корней 0 (остров не монтируется до первого пира);
  (б) `setInnerPeer({peerId: A})` → тот же инстанс (он не `inited`), один корень, `peer_changed(A)`,
  `selectTab(CHAT)`;
  (в) `setInnerPeer` треда поверх A → второй инстанс, запись `chat`, `chat_changing({from, to})`;
  Esc → `setPeer({})` → `spliceChats(1)` → через 350 мс второго контейнера нет, его корень
  размонтирован (счётчик живых корней `mountReact` = 1);
  (г) три треда поверх A, затем `setPeer({peerId: B})` → `spliceChats(0, false, false, spliced)`:
  `removeByType('chat', true)` снят `spliced.length - 1` раз, в навигации нет висящих `chat`,
  `chats.length === 1`, `chat.peerId === B`;
  (д) `setInnerPeer({peerId: A})`, когда A уже ниже в стеке → `existingIndex`, верх срезается, нового
  инстанса нет;
  (е) `setPeer({peerId: A})` при открытом A на 700 и `is-left-column-shown` → только
  `selectTab(CHAT)`, `chat.setPeer` не вызван (`:3365-3368`);
  (ж) мобильный, `setPeer({})` → `chat.setPeer` не вызван, инстанс жив (`:3370`), таб CHATLIST;
  (з) `setPeer({isDeleting: true})` → `selectTab(CHATLIST)`, потом `chat.setPeer({})`;
  (и) `spliceChats` зовёт `appSidebarRight.replaceSharedMediaTab(chatTo.sharedMediaTab)` ровно
  раз; в `#column-right` одна вкладка общих медиа;
  (к) после открытия и закрытия трёх чатов — ноль лишних `.chat.tabs-tab` в DOM, ноль живых
  React-корней сверх активного, ноль лишних `.tabs-tab` в `#column-right` (риск 1 этапа 3).
  `chatFacade.test.ts`: (л) `setPeer({peerId})` отдаёт `{cached, promise}`; первый вызов монтирует
  корень, второй с другим пиром — перерисовывает, не перемонтирует; (м) `setPeer({})` →
  `inited === undefined` (`chat.ts:1037-1038`); (н) `destroy()` — корень размонтирован, контейнер
  вне DOM, `sharedMediaTab` уничтожена.
  `mountReact.test.tsx`: (о) ошибка рендера ловится `ErrorBoundary`, корень не валит соседей;
  (п) `unmount` снимает DOM и подписки `useClassEvent`.
  Скан: (р) `git grep -n "chatStackStore\|navigationStore\|chatHistory\|openPeer'\|draft:" web-client/src` пуст.
- [ ] **Шаг 4: мутации (фактически):** не звать `chat.destroy()` в таймере `spliceChats` → (к)
  краснеет; снять цикл `removeByType('chat', true)` → (г) краснеет (висящие записи, второй Esc
  бьёт мимо — NAV-02); убрать ветку `existingIndex` → (д) краснеет (дубль инстанса); монтировать
  остров в конструкторе фасада → (а) краснеет.
- [ ] **Шаг 5: реализовать** дословно. Шапка `chatFacade.ts` — таблица «член фасада → строка
  `chat.ts` → кто читает в `appImManager`», каждый член с `// ВРЕМЕННО до Э6`.
- [ ] **Шаг 6: врезка** (одна, последняя): `Chat.tsx`, `App.tsx`, `appDialogsManager.ts`, вкладки,
  снос сторов и хуков.
- [ ] **Шаг 7: стенд:** P0-01…P0-10, NAV-01, NAV-02, NAV-03, DM-01, GR-15 (форум); переход
  A → тред → Esc → Esc; переключение A ↔ B при открытой правой колонке без мигания. Числа:
  память стека из 5 чатов до/после (Heap snapshot: число `HTMLDivElement.chat` и React-корней),
  время открытия чата из списка.

**Готово когда:** `ChatsContainer.tsx`, `chatStackStore.ts`, `navigationStore.ts`,
`chatHistory.ts`, `openPeer.ts`, `useChatNavigation.ts`, `useNavigationActions.ts` удалены;
`git grep -n "ВРЕМЕННО до Э4-3" web-client/src` пуст (сейчас 14 строк в 10 файлах: `Chat.tsx`,
`Sidebar.tsx`, `newChannel.solid.tsx`, `toolsMenu.ts`, `emoticonsSearchBridge.ts`,
`stickers.solid.tsx`, `gifs.solid.tsx`, `tabs.ts` и два теста); пины (к) зелёные.
**Оценка:** **7 дней** (план программы — 6, риск). +1 за черновик пира (В4-2) и перенос 34 пинов.
**Зависимости:** 4-2.
**Риски.** (1) Самое опасное место программы (риск 1 плана). Пины переносятся первым коммитом.
(2) N React-корней вместо одного — замер памяти обязателен; `StrictMode` — в каждом острове
(как сейчас в `main.tsx:33`). (3) Пустой `chats[0]` у tweb существует всегда, а наш `Chat.tsx`
без пира не рисуется. Остров монтируется лениво, на первом `setPeer` с пиром, и не
размонтируется на `setPeer({})` (пин (а), (м)). (4) `useChatsStore.activePeerId` — второй факт
«открытого чата» (правило «Владение фактами»). Снимается здесь же, иначе два писателя.

---

### Задача 4-4: хэш-роутинг

**Порт:** G: `overrideHash` `:3127-3135` (`@username` из `getPeerActiveUsernames`, иначе id),
`openUrl` `:1897-1910`, `onHashChange` `:1912-1918`, `onHashChangeUnsafe` `:1920-2031` (`tgaddr`
`:1934-1938`; голый фрагмент — только `@имя` или peerId, иначе выход `:1943-1951`; `#/im?p=` с
`post`/`message`/`thread` `:1954-1963`; `@` → `openUsername` `:1965-1972`; peerId → `op` `:1974-2026`;
`story` → `openStoriesForPeer` — мост к 5-7), `open` `:2050`, `op` `:2062-2157` (без community
`:1982-2001` — О-5, без botforum — О-3, migrated — нет у нас), `openUsername` `:2165-2184`,
`openThread` `:2186-2210`, `openComment` `:2212-2225`; подписка
`appNavigationController.onHashChange = this.onHashChange` `:384`; первое применение
`this.onHashChange(true)` `:998`; `overrideHash(peerId)` на `peer_changed` `:835-843`.

**Временное:** `story` → вызов нашего вьювера функцией — `// ВРЕМЕННО до 5-7` (тот же мост, что 2-6);
`call` (`params.call`, `:2020`) → `// ВРЕМЕННО до 5-5`.

**Файлы:**
- Изменить: `lib/appImManager.ts` (~700 → ~900); `client/boot.ts` (нет `bootstrapHash` `:28`, `:261`);
  `lib/appDialogsManager.ts:150` (адрес чата — `appImManager.overrideHash`); `core/messageLink.ts`
  (`parseNavHash` переиспользуется или уходит — по коду); `useDeepLinks.ts` (`syncChatHash` →
  `appImManager`, `// ВРЕМЕННО до 5-4`).
- Удалить: `core/hooks/useUrlSync.ts` (185) + `useUrlSync.applyHash.test.ts` (244, 13 тестов →
  `appImManager.hash.test.ts`).

- [ ] **Шаг 1: прочитать** tweb `appImManager.ts:1897-2225`, `:3127-3135`, `:835-843`, `:998`;
  наш `useUrlSync.ts`, `chatHistory.ts:30-76` (правила хэша уже перенесены туда в 4-3);
  `docs/tweb/state-and-layout.md` § 5.
- [ ] **Шаг 2: падающие тесты** (`appImManager.hash.test.ts`): (а) `#@durov` на старте →
  `openUsername` → один резолв → `setPeer`; отказ резолва → тост, а не вечный лоадер
  (`useUrlSync.ts:36-56`); (б) `#123` → `op` → `setPeer({peerId: 123})`; (в)
  `#/im?p=@x&post=5` → `lastMsgId = 5`; `thread=7` → `threadId`; (г) `#column-center` (ссылка
  `#skip-to-content`) — ничего не открывается, запросов нет (сторож NaN в адресе);
  (д) `?tgaddr=…` → `openUrl`, хэш очищен `replaceState`; (е) `peer_changed(B)` → хэш `#@b`, если у B
  есть имя, иначе `#<id>`; `selectTab(CHATLIST)` → хэш пуст; (ж) смена чата не создаёт запись
  истории (перенос пина `chatHistory.test.ts`, «ОСТАТОК #108»); (з) F5 на `#@username` и
  `#<peerId>` открывает тот же чат (NAV-05 юнитом).
- [ ] **Шаг 3: мутации:** снять проверку `p[0] !== '@' && !p.isPeerId()` → (г) краснеет; писать
  хэш `pushState` вместо `overrideHash` → (ж) краснеет.
- [ ] **Шаг 4: реализовать; Шаг 5: врезка; Шаг 6: стенд:** NAV-01, NAV-05, P0-02, CH-02
  (подписка по ссылке), GR-10 (вступление по ссылке — через `useDeepLinks` до 5-4).

**Готово когда:** `git grep -n "useUrlSync\|bootstrapHash\|hashForChat\|syncChatHash" web-client/src` пуст (кроме
мостов `ВРЕМЕННО до 5-4`). **Оценка:** 3 дня. **Зависимости:** 4-3.

---

### Задача 4-5: фон, тема, позиции, настройки

**Порт:** I: `setCurrentBackground` `:2607-2627`, `setBackground` `:2629-2638`, `saveChatPosition`
`:2640-2678`, `getChatSavedPosition` `:2680-2688`, `applyCurrentTheme` `:2690-2713`, `setSettings`
`:2715-2762` (`--messages-text-size`, `animation-level-*`, `no-backdrop`, `chatsSelectTabDebounced`
с `topbar.pinnedMessage.setCorrectIndex(0)` и `setQueueId`, `animationIntersector.setLoop/
setAutoplay`, `setTimeFormat`); из `construct` — предкэш обоев `:334-345`,
`appChatBackground.attach(document.body)` `:364-365`, `themeController.AppBackgroundTab`/
`appChatBackground` `:444-445`, `applyCurrentTheme({noSetTheme: true})` `:447-455`,
`settings_updated` → `setSettings` `:385-386`, `theme_changed` с проверкой
`this.chat?.currentTheme || currentWallPaper` `:494-504`, позиция на `peer_changing` `:479-492`.
Члены фасада «нужны с 4-5» (`savedReaction`, `currentTheme`, `currentWallPaper`,
`preferredBackgroundTransition`, `publishBackground`, `bubbles.*` для позиции,
`topbar.pinnedMessage`).

**Временное:**
- `ChatFacade.publishBackground()` считает тему своего пира (`cachedPeerTheme`,
  `core/chatFullCache.ts`; сейчас это делает `useShellTheme.ts`) и зовёт
  `appChatBackground.setBackground` — `// ВРЕМЕННО до Э6` (у tweb — `chat.ts:378-433`). Так
  снимается 2D О-39 в части «публикует оболочка» (`chatBackground.solid.tsx:24-29`).
- `ChatFacade.topbar.pinnedMessage` — подфасад над `PinnedBar.tsx`/`usePinnedBar.ts` (до 6-3) —
  `// ВРЕМЕННО до Э6-3`.
- Переключение дня/ночи из бургера: `themeController.switchTheme(undefined, coords)` (tweb
  `sidebarLeft/index.ts:919-928`). Наш `useThemeToggle.ts` (34) уходит, переключатель — функция
  `core/theme/themeController.ts` поверх `switchThemeWithTransition`; снимаются
  `ВРЕМЕННО до Э4-5` в `toolsMenu.ts:35`, `:137` (и в `Sidebar.tsx:293`, если строка пережила 2-9).

**Файлы:**
- Изменить: `lib/appImManager.ts` (~900 → ~1100); `components/chat/chatFacade.ts` (+члены 4-5);
  `components/chat/bubbles.ts:6354` (`saveChatPosition` → класс; `ChatBubbles` отдаёт
  `getRenderedLength`, `getViewportSlice`, `sliceViewport`, `getRenderedHistory`, `scrollable`,
  `lazyLoadQueue` — сверить, что все уже публичные); `core/chat/chatPositions.ts` (поле класса
  `chatPositions` `:291-293` или остаётся модулем — по владельцу факта: один писатель);
  `core/theme/themeController.ts` (+`switchTheme`); `client/liteModeSettings.ts` (51 → в
  `setSettings`); `App.tsx` (нет `useShellTheme` `:218`, `setBackground` `:227-231`,
  `useThemeToggle` `:217`, `watchLiteModeSettings` `:284`); `toolsMenu.ts`.
- Удалить: `core/hooks/useShellTheme.ts` (43), `core/hooks/useThemeToggle.ts` (34) + тест (132),
  `App.chatBackground.test.ts` (55 → пины в `appImManager.theme.test.ts`), `client/liteModeSettings.ts`
  (если целиком ушёл в `setSettings`).

- [ ] **Шаг 1: прочитать** tweb `appImManager.ts:2607-2762`, `:334-345`, `:436-504`,
  `chat.ts:372-433` (что `publishBackground` делает у оригинала), `helpers/themeController.ts:354`;
  наш `chatBackground.solid.tsx` шапка, `liteModeSettings.ts`, `chatPositions.ts`,
  `bubbles.ts:6340-6400`.
- [ ] **Шаг 2: падающие тесты** (`appImManager.theme.test.ts`, `appImManager.positions.test.ts`):
  (а) `setSettings` ставит `--messages-text-size`, `animation-level-0/2`, `no-backdrop` по
  `liteMode` (перенос пинов `liteModeSettings`); (б) `theme_changed` при теме у активного чата
  глобальный фон не трогает, без темы — `applyCurrentTheme({broadcastEvent: true})`;
  (в) возврат из треда в чат с темой → `publishBackground('crossfade-backwards')` (`:3267-3269`);
  (г) `saveChatPosition`: внизу ленты позиции нет; прокрученный — `mids` + `top`; только закреп —
  `{pinnedMessages}` (перенос `chatPositions.test.ts`); (д) позиция пишется на `peer_changing`
  ровно раз после `peer_changed` (`{once: true}`, `:479-490`); (е) переключатель темы из бургера
  меняет `themeChoice` и зовёт переход с координатами.
- [ ] **Шаг 3: мутации:** снять `if(this.chat?.currentTheme || this.chat?.currentWallPaper) return`
  → (б) краснеет; подписаться на `peer_changing` без `{once: true}` → (д) краснеет (две записи).
- [ ] **Шаг 4–6: реализовать, врезка, стенд:** P0-01…P0-10; смена темы день/ночь (кнопка бургера и
  настройки), чат с темой → назад к списку → фон приложения; F5 в чате с темой; позиция ленты при
  возврате в чат. Числа: кадры перехода темы.

**Готово когда:** `git grep -n "useShellTheme\|useThemeToggle\|watchLiteModeSettings\|ВРЕМЕННО до Э4-5" web-client/src` пуст.
**Оценка:** 2 дня. **Зависимости:** 4-3.

---

### Задача 4-6: подписки `construct`

**Порт** (C, кроме уже перенесённого в 4-2…4-5):
- `internalLinkProcessor.construct` `:326` — нет (5-4); `uiNotificationsManager.constructAndStartAll`
  `:328` и `notificationBuild` `:805-822` — на наш `client/uiNotifications.ts` (проверка «чат открыт
  и окно активно» — `appImManager.chat.peerId`/`threadId` + `idleController.isIdle`);
  `appMediaPlaybackController.construct` `:330` — по коду (`lib/mediaPlayer`).
- `premium_toggle` → `body.is-premium` + событие класса `:388-397`, `:434`.
- `:494-628` — таблица «событие tweb → наш источник» (шаг 1 составляет её по
  `core/realtime/events.ts::RT` и `lib/rootScope.ts`): `theme_changed` (4-5); `choosing_sticker`
  `:506` → 5-3; `peer_title_edit` `:510`; `peer_typings` `:516` → `chatsStore.typing` (5-3);
  `message_error` (медленный режим) `:551-565` → `RT.messageError`; `ephemeral_send_error`/
  `ephemeral_send_blocked` `:567-586` — эфемерного режима нет (О-13), строки не портируются, О-130;
  `file_speed_limited` `:587-601` — нет предмета, О-130; `service_notification` `:607-612`,
  `payment_sent` `:614-628` — по наличию кадра, иначе О-130.
- `useLockScreenShortcut()` `:630` — модуль остаётся, зовёт класс, а не шелл.
- `window.onSpoilerClick`/`onFormattedDateClick` `:632-752` — у нас `lib/spoiler/spoilerReveal.ts`
  (шапка: порт `:511`) и даты — по коду; задача сводит вызывающих к классу.
- Hover-to-play стикеров, тосты `sticker_updated`/`gif_updated` `:756-803`.
- `peer_changed` → `pushRecentlyClosedChat` `:824-833` (О-126), `has-chat` + очистка
  `emojiAnimationContainer` (`components/wrappers/stickerAnimation.ts:42`) `:835-843`;
  `updateTabState('chatPeerIds')` — О-127.
- Звук отправки `message_sent` `:857-877` (подписка `:861`) — по коду (`client/realtime/soundSubscriber.ts`).
- `singleInstance.activateInstance` `:951` — О-128; Chromium-хак холстов `:959-987` — порт
  (клиентский); `telegramMeWebManager` `:953-957`, `:988-989` — О-129; `savedReactionTags`
  `:992-994` — по коду.
- Финал `:998-1004`: `attachKeydownListener` (5-1), `attachCopyListener` (5-1),
  `handleAutologinDomains`/`handlePeerColors`/`checkForShare` (5-6), `init` (5-2) — строки-вызовы
  появляются с задачами этапа 5.
- `core/hooks/useAppBootstrap.ts` (109): загрузки и подписки старта переходят в `bootstrapIm`/
  `appDialogsManager.start` (у tweb они там и в `onStateLoaded`, `appDialogsManager.ts:997`):
  `loadChats`/`loadPresence`/`loadStories`/`loadNotifySettings`/`loadFolders`/`loadPrivacy`/
  `loadStars`, `primeMediaToken`, `watchCacheSettings`, `startRealtime`, `initAppBadge`,
  `startPresenceDegradation`, `watchPushConditions`, предзагрузка реакций через 7,5 с.
- `core/hooks/useGlobalToast.ts` (32): событие `ui:toast` → `toastNew` (у tweb тосты только так).
  Тост вступления в `GlobalOverlays.tsx` (`joinToast`) и подтверждение QR — на `toastNew` и
  `confirmationPopup` (план программы `:152-154`).
- `useAutoLock` (32): у tweb автоблокировка живёт в воркере (`lib/mainWorker/useAutoLock.ts`).
  Переносится функцией `startAutoLock()` из класса, перенос в воркер — О-131.

**Файлы:**
- Изменить: `lib/appImManager.ts` (~1100 → ~1350); `pages/bootstrapIm.ts`/`lib/appDialogsManager.ts`
  (старт); `client/uiNotifications.ts`; `components/shell/GlobalOverlays.tsx` (нет тоста и QR —
  131 → ~60); `core/hooks/useAutoLock.ts`, `useLockScreenShortcut.ts` (функции, а не хуки);
  `App.tsx` (нет `useAppBootstrap` `:74`, `useAutoLock` `:76`, `useLockScreenShortcut` `:77`,
  `useGlobalToast` `:79`).
- Удалить: `core/hooks/useAppBootstrap.ts` (109) + 2 теста (148 + 82 → `bootstrapIm.test.ts`,
  `appImManager.construct.test.ts`); `core/hooks/useGlobalToast.ts` (32); стили `joinToast`/`qr*` в
  `App.module.scss` (если без потребителей).

- [ ] **Шаг 1: прочитать** tweb `appImManager.ts:324-1018` целиком; составить таблицу «подписка →
  наш источник → задача» и положить её в шапку класса.
- [ ] **Шаг 2: падающие тесты** (`appImManager.construct.test.ts`): (а) `peer_changed(A)` →
  `body.has-chat`; `peer_changed(0)` → снят; `emojiAnimationContainer` пуст; (б) уведомление о
  сообщении в открытом чате при активном окне не строится, при `idle` — строится (перенос пина
  `uiNotifications` на `activePeerId`); (в) `premium_toggle(true)` → `body.is-premium` и событие
  класса один раз; повтор того же значения — без события; (г) `ui:toast` → `toastNew` (узел
  `.toast` tweb), без React-состояния; (д) `useLockScreenShortcut` подписан один раз на жизнь
  страницы; (е) старт: `startRealtime` вызван один раз, загрузки — после `appDialogsManager.start`
  (перенос `useAppBootstrap.dialogsGate.test.tsx`), реакции — через 7,5 с
  (`reactionsPreload.test.tsx`).
- [ ] **Шаг 3: мутации:** не снимать `has-chat` на пустом пире → (а) краснеет; проверять только
  `peerId` без `threadId` → (б) краснеет на треде.
- [ ] **Шаг 4–6: реализовать, врезка, стенд:** P0-01…P0-10, AUTH-08, AUTH-10, AUTH-11; уведомление
  при свёрнутом окне и тишина в открытом чате; тосты (стикер в избранное, ошибка медленного режима).

**Готово когда:** `git grep -n "useAppBootstrap\|useGlobalToast\|activePeerId" web-client/src` пуст;
таблица подписок в шапке класса, у каждой строки — задача или О-n.
**Оценка:** **3,5 дня** (план программы — 3; +0,5 за таблицу подписок и перенос старта).
**Зависимости:** 4-3.

---

### Задача 4-7: снос `main.tsx`/`App.tsx`, остров оверлеев

**Порт:** корневой вход — только `src/index.ts`. Кнопка обновления — `updateBtn`/`hasUpdate`
левой колонки (tweb `sidebarLeft/index.ts:142-143`, `:213-227`, `:374`, `:1557`; клик →
`appNavigationController.reload()` `:224`) вместо пилюли `App.tsx:294-316`. `pingBackend`
(`App.tsx:271-273`), `startVersionCheck` (`:276-278`) — в `index.ts`. Бейдж `api:` (`App.tsx:317-322`,
`App.module.scss`) — dev-отладка, у tweb нет; удаляется (её роль — `ConnectionStatusComponent`,
tweb `appDialogsManager.ts:990`). `loadFonts`/`setRootClasses` (`main.tsx:15`, `:19`) — в
`index.ts` (tweb `:428`, `:645`).

**Остров оверлеев.** `#react-overlays` в `body` (статично в `index.html` после `#stories-viewer`),
один корень через `mountReact`, монтирует `bootstrapIm`. Содержимое: `GlobalOverlays`
(`GroupCallScreen`, `LivestreamScreen`, `CallOverlay`, `WebAppModal`; `FolderInvitePopup` и
`ReportPopup` — если 2C-21/2C-27 не успели), `PopupHost`, и хуки, чей класс придёт позже:
`useDeepLinks` (`// ВРЕМЕННО до 5-4`), `useAppHotkeys` (`// ВРЕМЕННО до 5-1`), `useChatList`
(имена чатов для экранов звонка, `GlobalOverlays.tsx:66-71`). Шапка острова перечисляет каждый
член с задачей, которая его снимает.

**Файлы:**
- Создать: `components/shell/overlaysIsland.tsx` (~60), тест.
- Изменить: `index.html` (нет `#root` и `<script src=/src/main.tsx>`, есть `#react-overlays`);
  `src/index.ts`; `pages/bootstrapIm.ts` (монтирование острова); `components/sidebarLeft/index.ts`
  (`updateBtn`); `stores/updateStore.ts` (13 — читает класс); `styles/index.scss:14`, `:172`
  (правила `#root`).
- Удалить: `main.tsx` (39), `App.tsx` (325), `App.module.scss` (134; стили, которые ещё нужны
  острову, переезжают к нему), `App.*.test.ts` (оставшиеся — пины на `index.ts`).

- [ ] **Шаг 1: прочитать** tweb `sidebarLeft/index.ts:142-143`, `:205-230`, `:365-380`, `:1550-1560`;
  наш `App.tsx` (весь, что от него осталось после 4-1…4-6), `GlobalOverlays.tsx`, `PopupHost.tsx`.
- [ ] **Шаг 2: падающие тесты:** (а) `indexHtml.test.ts`: нет `#root`, есть `#react-overlays`;
  (б) скан `react-dom/client`: импорт только в `shared/react/mountReact.tsx` и
  `components/mediaViewer/base.ts` (волна 4) — `git grep -n "react-dom/client" web-client/src`
  (ворота плана программы `:1255-1257` сформулированы через `createRoot`, но это имя есть и у
  `solid-js` — 28 файлов без тестов; скан идёт по импорту `react-dom/client`); (в) `updateBtn`: после
  события «доступна новая сборка» снят `is-hidden`, клик → `appNavigationController.reload`;
  (г) остров: ровно один React-корень на странице без открытых чатов.
- [ ] **Шаг 3: мутации:** оставить `main.tsx` в `index.html` → (а) краснеет; добавить
  `react-dom/client` в любой файл вне списка → (б) краснеет.
- [ ] **Шаг 4–6: реализовать, врезка, стенд:** ворота этапа целиком (раздел 2).

**Готово когда:** нет `main.tsx`, `App.tsx`, `#root`; `vite build` живой; число
`.tsx` с `from 'react'` уменьшилось на удалённые файлы этапа (список в PR).
**Оценка:** 2 дня. **Зависимости:** 4-4, 4-5, 4-6.

---

## 2. E2E-ворота этапа 4

Из плана программы (`:332`, `:1255-1257`), без изменений:

| Когда | P0 (зелёные до и после) | P1 (регресс блокирует) |
|---|---|---|
| каждая задача 4-x | P0-01…P0-10 | — |
| 4-1 | AUTH-01, AUTH-02, AUTH-12 | AUTH-08, AUTH-10, AUTH-11 |
| 4-2, 4-3 | NAV-01, NAV-02, NAV-03 | — |
| 4-4 | NAV-05 | CH-02, GR-10 |
| 4-7 (ворота этапа) | AUTH-01, AUTH-02, AUTH-12, P0-01…P0-10, NAV-01…NAV-06 | AUTH-08, AUTH-10, AUTH-11, CH-02, GR-10 |

Сторожа на каждом шаге (`e2e-scenarios.md:9-28`): ошибка в консоли, ответ 4xx/5xx, `NaN`/`undefined`/
`null` в адресе запроса, вечный лоадер, необработанный reject в воркере. Стенд —
`https://web.telegram.localhost` (вход разрешён только на `.localhost`), проект `msgrverify`, под
`stand.lock`. Без Chrome DevTools MCP — headless Chrome по CDP; в PR явно: чем проверено и что
глазами не смотрено.

---

## 3. Порядок снятия React-корня и что остаётся островами

### 3.1 По шагам

| После | `#root` | Что React ещё рисует в шелле | Что уже класс |
|---|---|---|---|
| вход в этап (2-9, 3-2) | `main.tsx` → `App.tsx`: каркас колонок статичной разметкой, `ThemedApp` (`useAuthGate`, `mountAuthFlow`), `Shell` (хуки, центр, оверлеи) | центр, оверлеи, хуки шелла, развилка входа | обе колонки (`appSidebarLeft`, `appSidebarRight`), список |
| 4-1 | есть, монтирует `bootstrapIm` | центр порталом в статичный `#column-center`, оверлеи, хуки шелла | каркас (`index.html`), развилка входа (`index.ts`), `bootstrapIm`, вечные синглтоны |
| 4-2 | = | = минус `useLeftColumnShown`, тяжёлая анимация перехода | `AppImManager`: `selectTab`, колонки, запись `im` |
| 4-3 | = | оверлеи, хуки шелла; **центра в дереве шелла нет** | стек чатов; инстанс = `ChatFacade` + свой React-корень |
| 4-4, 4-5, 4-6 | = | оверлеи, `useDeepLinks`, `useAppHotkeys`, `useChatList` | хэш, фон/тема/позиции, подписки, старт |
| 4-7 | **нет** | — | всё, кроме островов ниже |

### 3.2 Острова после этапа 4

Таблица плана программы (`:142-150`) подтверждается кодом и уточняется:

| Остров | Хост | Корень | Кто снимает |
|---|---|---|---|
| Инстанс чата (`Chat.tsx` целиком, внутри — `Composer.tsx`, `EmojiDropdown`, `NowPlayingBar`) | `ChatFacade.container` (`.chat.tabs-tab`) | `mountReact`, по одному на инстанс | Э6 (композер — Э7 за `ChatInputFacade`) |
| Оверлеи: `GroupCallScreen`, `LivestreamScreen`, `CallOverlay`, `WebAppModal`, `PopupHost`; хуки `useDeepLinks`, `useAppHotkeys`, `useChatList` | `#react-overlays` | `mountReact`, один | хуки — 5-4, 5-1; экраны звонков и вебапп — их программы; `PopupHost` — 2C |
| `FolderInvitePopup`, `ReportPopup` | там же | — | 2C-21, 2C-27 (если не успели раньше) |
| `StoryViewer`, `MediaEditor` | хост задаёт 2-6 (сейчас `useSidebarStories.tsx:69`, `:89`) и `SendMediaPopup.tsx:414` | свой | волна 4 |
| Медиавьювер: автор и подпись | `mediaViewer/base.ts:1380`, `:1415` (`react-dom/client` `:53`) | свой | волна 4 |
| Порталы React-попапов внутри островов (`createPortal` — 30 файлов: `PremiumModal`, `StarsPopup`, `QrModal`, `shared/ui/Popup`, `shared/ui/Menu`, …) | `body` | корень острова-владельца | 2C |

Обратного моста (React внутри Solid) этап не заводит. `mountReact` — мост «React внутри класса»,
его направление разрешено спекой § 6 до волны 8.

---

## 4. Временные пометки этапа

### 4.1 Которые этап снимает (`git grep -n "ВРЕМЕННО до Э4"` на `d0f64d5b`)

| Пометка | Где сейчас | Кто снимает |
|---|---|---|
| `ВРЕМЕННО до Э4-1` | `App.tsx:53`, `sidebarRight/index.ts:19`, `:55`, `:181`, `:193`, `slider.ts:155`, `columnSlider.ts:31`, `:88` (уйдёт с 2-1), + то, что поставят 2-1…2-9 у `appSidebarLeft`/`App.tsx` | 4-1 |
| `ВРЕМЕННО до Э4-2` | `sidebarRight/index.ts:32`, `:165`, `chatHistory.ts:486` | 4-2 |
| `ВРЕМЕННО до Э4-3` | `Chat.tsx:1114`, `Sidebar.tsx:283` (уйдёт с 2-9), `newChannel.solid.tsx:26`, `:95`, `toolsMenu.ts:29`, `:133`, `emoticonsSearchBridge.ts:2`, `stickers.solid.tsx:42`, `:63`, `gifs.solid.tsx:22`, `:35`, `tabs.ts:668`, тесты `stickers`/`gifs` | 4-3 |
| `ВРЕМЕННО до Э4-5` | `Sidebar.tsx:293` (уйдёт с 2-9), `toolsMenu.ts:35`, `:137` | 4-5 |

### 4.2 Которые этап ставит

| Пометка | Ставит | Снимает | Где |
|---|---|---|---|
| `ВРЕМЕННО до Э4-7` | 4-1 | 4-7 | `main.tsx::mountReactShell`, `#root` в `index.html` |
| `ВРЕМЕННО до Э4-3` | 4-1, 4-2 | 4-3 | портал `ChatsContainer` в `#column-center`; мост `navigationStore` → `selectTab`; `onPop` записи `im` → `closeChatLevel` |
| `ВРЕМЕННО до Э4-4` | 4-2 | 4-4 | `overrideHash` в `selectTab` → `syncChatHash` |
| `ВРЕМЕННО до Э6` | 4-3, 4-5 | Э6 (6-1) | `chatFacade.ts` (каждый член), `mountReact.tsx` (для инстанса), `chatIsland.tsx`, `ChatFacade.publishBackground` |
| `ВРЕМЕННО до Э6-2` | 4-3 | 6-2 | `ChatFacade.thread` (мета треда для шапки) |
| `ВРЕМЕННО до Э6-3` | 4-5 | 6-3 | `ChatFacade.topbar.pinnedMessage` |
| `ВРЕМЕННО до 5-1` | 4-3, 4-7 | 5-1 | `useAppHotkeys` в острове оверлеев |
| `ВРЕМЕННО до 5-4` | 4-3, 4-4, 4-7 | 5-4 | `useDeepLinks` в острове оверлеев, его вызовы `appImManager` |
| `ВРЕМЕННО до 5-5` | 4-4 | 5-5 | `params.call` в `op` |
| `ВРЕМЕННО до 5-7` | 4-4 | 5-7 | `story` в `onHashChange` → вьювер функцией |
| `ВРЕМЕННО до 2C-21` / `2C-27` | 4-7 (если нужно) | 2C-21, 2C-27 | `FolderInvitePopup`, `ReportPopup` в острове |

Задача, которая снимает пометку, проверяет `git grep -n "ВРЕМЕННО до <номер>"` → пусто.

---

## 5. Отложено этапа 4

Уже внесено в таблицу «Отложено» плана программы этим PR. Задача из колонки «Задача» ставит
`// О-n волна 7` у строки, где пункт не портируется.

| № | Что | Почему | Что разблокирует | Задача |
|---|---|---|---|---|
| О-125 | `updateStatus`/`goOffline` (`appImManager.ts:3210-3217`), `idleController` → `account.updateStatus(offline)` (`:354-362`); вызовы из левой колонки (`sidebarLeft/index.ts:871`, `:1783`) | ручки статуса нет: присутствие — по WS-соединению (`presencestore.go:36-37`), `presence_handler.go` только читает | «не в сети» при простое вкладки | 4-2 |
| О-126 | Карточки пустой колонки `chatTips` (`components/chatTips/*`, 734 строки; вызов `:377`) и «недавно закрытые» (`pushRecentlyClosedChat` `:824-833`, `appUsersManager.ts:327`) | в состав этапа 4 не входят (план программы); вопрос **В4-3** | пустой `#column-center` как у tweb | 4-3 / 4-6 |
| О-127 | Состояние вкладок между окнами: `apiManagerProxy.updateTabState('chatPeerIds')` (`:842`), `getTabState`/`getAllTabStates` для звука отправки (`:866-870`) | механизма состояния вкладок нет | звук отправки только в активной вкладке, мультиаккаунт | 4-6 |
| О-128 | `singleInstance` (`index.ts:487-494`, `appImManager.ts:951`) — одна активная вкладка, отключение по версии | механизма нет (`components/connectionStatus.ts:12`) | вкладка «приложение открыто в другом окне» | 4-1 |
| О-129 | `checkLastActiveAccountFromTMe`, `telegramMeWebManager` (`index.ts:443`, `appImManager.ts:953-957`, `:988-989`), test-режим веб-токена (`index.ts:578-605`) | нет t.me-интеграции и тестового DC | вход с t.me | 4-1 |
| О-130 | Подписки без предмета: `ephemeral_send_error`/`ephemeral_send_blocked` (`:567-586`), `file_speed_limited` (`:587-601`); `service_notification` (`:607-612`) и `payment_sent` (`:614-628`) — если шаг 1 задачи 4-6 не найдёт кадров | событий нет ни на бэкенде, ни в `RT` (`core/realtime/events.ts`) | тосты 1:1 | 4-6 |
| О-131 | Автоблокировка в воркере (`lib/mainWorker/useAutoLock.ts` tweb) | наш замок — главный поток (`useAutoLock.ts`); перенос в воркер — вне этапа | блокировка без открытой вкладки | 4-6 |

---

## 6. Вопросы пользователю (реальные развилки)

| № | Вопрос | Варианты | Рекомендация |
|---|---|---|---|
| **В4-1** | Выход из аккаунта. У tweb — перезагрузка страницы (`apiManagerProxy.ts:676-704` → `appNavigationController.reload`). У нас — сброс в памяти и размонтирование шелла без перезагрузки (`useAuthGate.ts`) | **А** — перезагрузка, как tweb: синглтоны вечные, их `destroy()` (`sidebarRight/index.ts:181`, `slider.ts:155`, `appDialogsManager` расхождения 1, 7, 17, 18) удаляется, сброс в памяти (`resetAccountStateInMemory`) уходит; **Б** — оставить SPA-выход: каждый синглтон сохраняет `destroy()` и повторный `construct`, `#page-chats` прячется обратно, `bootstrapIm` перестаёт быть идемпотентной | **А**: 1:1 с tweb, снимает четыре объявленных расхождения и класс ошибок «вкладка пережила выход». Цена — кадр белого экрана при выходе, как у оригинала. AUTH-12 проверяет то же |
| **В4-2** | «Черновик» пира без диалога (`navigationStore.draftPeer`, `draft:<id>`, `onChatCreated`). У tweb такого понятия нет: `setPeer({peerId})`, карточка из зеркала пиров | **А** — удалить в 4-3: сущность для `Chat.tsx` строится из списка или из `cachedPeer`; карточку пира, которого нет в зеркале, ставит воркер до `setPeer` (как `getPeer` у tweb, `:2006-2013`); **Б** — перенести `draftPeer` полем `ChatFacade` до Э6 (`// ВРЕМЕННО до Э6`) | **А**: `ChatFacade` не должен держать факт, которого нет у `Chat`; иначе Э6 портирует `Chat` против нашей модели. Риск — пир из поиска без записи в зеркале: шаг 3 задачи 4-3 ставит на это пин |
| **В4-3** | Карточки пустой колонки `chatTips` (734 строки tweb) — в `construct` (`:377`), но не в составе этапа 4 | **А** — оставить Отложено (О-126), отдельная задача после этапа 5; **Б** — добавить задачей 4-8 (+2 дня), после 4-3 | **А**: этап на критическом пути (2D-28 → 0а → 2 → 4 → 6 → 7), а карточки не держат ни одного шва |

Вопросы, которые план программы уже закрыл решением «везде А» (В-1…В-6), здесь не повторяются.
В-6 = «А» становится предусловием этапа (§ 0.2 п. 5).

---

## 7. Оценка

| Задача | План программы | Этот план | Почему иначе |
|---|---|---|---|
| 4-1 | 3 | **4** | выход через `reload`, вечные синглтоны (перевод ~21 тестового файла на `vi.resetModules`), PiP |
| 4-2 | 2,5 | 2,5 | — |
| 4-3 | 6 | **7** | черновик пира (В4-2), перенос 34 пинов первым коммитом |
| 4-4 | 3 | 3 | — |
| 4-5 | 2 | 2 | — |
| 4-6 | 3 | **3,5** | таблица подписок, перенос старта из `useAppBootstrap` |
| 4-7 | 2 | 2 | — |
| **Итого** | **21,5** (в таблице «Оценка объёма» — 22) | **24,5** | +11 %: меньше порога 25 % (план программы `:312-313`) |

Календарно: 4-1 → 4-2 → 4-3 последовательно (13,5 дня), 4-4/4-5/4-6 параллельно при двух
исполнителях (≈ 4,5 дня вместо 8,5), 4-7 — 2 дня. Итого ≈ 20 дней календаря.

---

## 8. Риски этапа

1. **4-3 — самое опасное место программы** (план, риск 1). Стек, записи `im`/`chat` и хэш сходятся в
   одном классе. Пины переносятся первым коммитом, мутации (г), (к) обязательны.
2. **N React-корней вместо одного** (план, риск 2). Замер памяти стека из 5 чатов до/после — в
   коммит 4-3. Утечка корня ловится пином (к) и счётчиком живых корней `mountReact`.
3. **Порядок старта** (план, риск 3). `waitForUnlock` → состояние → лангпак → развилка не меняется;
   пин (е) задачи 4-1.
4. **Вечные синглтоны и тесты.** Сейчас ~21 тестовый файл поднимает колонки многократно. Без
   перевода на `vi.resetModules()` тесты начнут делить состояние синглтонов между собой. Это
   основной объём 4-1, его нельзя откладывать на «потом».
5. **Предусловия не выполнены к старту.** Если к старту 4-1 жив `Sidebar.tsx` или
   `UserInfoPanel.tsx`, точка входа не переносится: React рисовал бы колонку внутри статичного
   узла, и это обратный мост. Этап ждёт, а не обходит.
6. **Ворота вручную.** Пока P0-набор Playwright не влит (В-6), P0-01…P0-10 на каждой из семи
   задач проверяются руками — это ненадёжно на этапе, который меняет каркас целиком.

---

## 9. Готово этапа 4

- [ ] Нет `main.tsx`, `App.tsx`, `#root`; вход — `src/index.ts`; каркас — `index.html` (tweb
  `:87-116`).
- [ ] `lib/appImManager.ts` — класс-синглтон с блоками A, B, C (в объёме этапа), G, I, J; шапка
  перечисляет, какой блок переносит этап 5 и Э6.
- [ ] Удалены: `ChatsContainer.tsx`, `chatStackStore.ts`, `navigationStore.ts`, `chatHistory.ts`,
  `openPeer.ts`, `useAuthGate`, `useShellEnterAnimation`, `useLeftColumnShown`, `useChatNavigation`,
  `useNavigationActions`, `useUrlSync`, `useShellTheme`, `useThemeToggle`, `useAppBootstrap`,
  `useGlobalToast`, `SvgDefs.tsx`.
- [ ] `git grep -n "ВРЕМЕННО до Э4" web-client/src` пуст.
- [ ] `git grep -n "react-dom/client" web-client/src` — только `shared/react/mountReact.tsx` и
  `components/mediaViewer/base.ts`.
- [ ] Писатели: `is-left-column-shown` — `AppImManager.selectTab`, `is-right-column-shown` —
  `AppSidebarRight`, `has-open-tabs` — `AppSidebarLeft`, `has-auth-pages` — `index.html`,
  `bootstrapIm`, `mountAuthFlow`; скан-тесты зелёные.
- [ ] Ворота раздела 2 — зелёные до и после, числа в PR.
- [ ] `docs/tweb/app-architecture.md` § 9.1 и `state-and-layout.md` § 5, § 6 — «у нас» обновлено.
