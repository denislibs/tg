# Стек инстансов колонки чата (порт `appImManager.chats[]`)

**Дата:** 2026-08-13
**Статус:** дизайн согласован
**Референс:** `~/Documents/tweb` (`e52b5d931`) + живые дампы
[`../../research/2026-08-13-tweb-channels-comments-reference.md`](../../research/2026-08-13-tweb-channels-comments-reference.md)
**Ворктри:** `.worktrees/chat-stack`, ветка `feat/chat-instance-stack`

## Задача

Колонка чата в tweb — это **стек инстансов**: открытие треда не подменяет содержимое
текущего чата, а кладёт сверху новый инстанс со своим topbar, лентой, инпутом и
скроллом; возврат снимает верхний и отдаёт нижнему ровно то состояние, которое он
имел до ухода. Переход между инстансами играет навигационную анимацию.

У нас колонка — один компонент `Chat` с пропом `thread`, подменяемый по `key`
(`App.tsx:154-171`). Возврат из треда пересобирает чат с нуля, анимации перехода нет,
режим инстанса выражен булевым пропом, а не типом.

Эта спека вводит стек как единственный механизм навигации внутри колонки. Она —
фундамент для двух следующих работ: зеркала поста на бэкенде и страницы комментариев
1:1 (обе — отдельные спеки).

## Референс tweb: что именно портируем

### Стек (`lib/appImManager.ts`)

- `chats: Chat[]` (`:218`), `chatsContainer` — `div.chats-container.tabs-container`
  с `dataset.animation = 'navigation'` (`:306-308`); при старте создаётся первый
  инстанс и выбирается вкладка (`:314-315`).
- `createNewChat()` (`:2658`) — новый инстанс, `container` добавляется в
  `chatsContainer`, инстанс пушится в `chats`.
- `setInnerPeer(options)` (`:2840-2870`) — **положить сверху**:
  - если инстанс с тем же пиром уже в стеке (`isSamePeer`) — срезать всё выше него
    (`spliceChats(existingIndex + 1)`) и сделать `setPeer` на нём;
  - иначе: если верхний инстанс уже `inited` — `createNewChat()`, затем `setPeer`;
    неинициализированный верхний переиспользуется.
  - там же выводится `type` из `threadId` (`:2846-2853`): свой peer → `Saved`,
    не форум → `Discussion`, иначе `Chat`.
- `setPeer(options)` (`:2758-2795`) — **заменить/спуститься**: пустой `peerId` при
  индексе > 0 → `spliceChats(chatIndex)` (назад); переход к другому пиру из глубины
  стека схлопывает стек до одного инстанса.
- `spliceChats(fromIndex, justReturn, animate, spliced)` (`:2672-2720`) — снять
  инстансы с `fromIndex`, событие `chat_changing {from, to}`, промежуточные узлы
  удалить из DOM (фикс z-index), `chatsSelectTab(chatTo, animate)`, вернуть
  `sharedMediaTab` цели в правый сайдбар, у снятых — `beforeDestroy()`.
- `chatsSelectTab(chat, animate)` (`:2237-2270`) — снять `.active` с предыдущего,
  на время анимации объявить тяжёлую анимацию (`250 + 150` мс), поставить/снять
  элемент навигации (Esc/back) в зависимости от направления перехода.
- `getChatSavedPosition(chat)` (`:2151`) — сохранённая позиция по ключу
  `peerId + ('_' + threadId)`, только для типов `Chat`/`Discussion`/`Saved`.

### Анимация (`components/transition.ts:23-42`)

`slideNavigation`: уходящая вкладка едет на `-width * 0.25` и притемняется
(`brightness(80%)`), приходящая — с `width` в 0; контейнер получает
`animating` (+`backwards` при возврате), CSS-переход — `_slider.scss:226-241`.

**Это у нас уже портировано**: `core/dom/navigationTransition.ts`
(`slideNavigation` + `runNavigationTransition` с раздачей `from`/`to`/`active` и
`dispatchHeavyAnimationEvent`), CSS — `styles/tweb/_slider.scss:226-241`.
Сейчас примитив используется слайдером настроек (`components/settings/kit.tsx`).
Переиспользуем его, второй раз не портируем.

### Тип инстанса (`ChatType`)

`chat.ts:883-895` выводит тип при смене пира; тип определяет заголовок
(`topbar.ts:1470-1540`), плашки (`topbar.ts:1235-1246`), плейсхолдер инпута
(`input.ts:2732-2745`), правый сайдбар (`chat.ts:990` —
`sharedMediaTab.setPeer(peerId, threadId)`).

## Наше текущее состояние

- `App.tsx:154-176` — `tabKey` (`thread-…` / `chat-…` / `empty`), один `<Chat key>`
  внутри `.chats-container.tabs-container` (`:180`). Атрибута
  `data-animation="navigation"` на этом контейнере **нет** (он есть только у
  `#main-columns`, `:200`), поэтому CSS-переход вкладок сейчас не включается —
  добавление атрибута входит в этап 1.
- `stores/navigationStore.ts` — `openThread` (топик/комментарии), `openTopicThread`,
  `openCommentsThread`, `closeThread`.
- `components/Chat.tsx` (1634 строки) — принимает `chat` + `thread?: ThreadInfo`;
  внутри есть глобальные эффекты, например window-хоткей Ctrl+PageUp/PageDown
  (`:1106-1121`).
- Окно сообщений уже ключуется чатом **и** тредом: `winKey(chatId, threadRootId)`
  (`core/hooks/useMessageWindow.ts:43-44`) — совпадает с ключом инстанса.
- Сохранённых позиций скролла нет вовсе (`grep chatPositions` — пусто).

## Архитектура

### `stores/chatStackStore.ts` (новый)

```ts
export const enum ChatType { Chat, Discussion, Saved, Pinned, Search }

export interface ChatInstanceDesc {
  /** `${peerId}_${threadId ?? 0}_${type}` — он же ключ React-узла */
  key: string
  peerId: number
  threadId?: number
  type: ChatType
  /** только для ChatType.Search */
  query?: string
}
```

Действия (имена и семантика — из `appImManager`):

| действие | поведение |
|---|---|
| `setPeer(opts)` | заменить верхний инстанс; `peerId` пуст и глубина > 1 → `popTo(index)`; уход к другому пиру из глубины схлопывает стек до одного |
| `setInnerPeer(opts)` | положить сверху; тот же пир уже в стеке → срезать всё выше и `setPeer` на нём |
| `popTo(index)` | снять всё выше `index` |
| `closeTop()` | `popTo(depth - 2)`; на глубине 1 — no-op (за колонку отвечает `selectTab`) |

Инварианты: верхний элемент стека — активный; ключи в стеке уникальны; стек
никогда не пуст, когда чат открыт (глубина ≥ 1).

### `components/chat/ChatsContainer.tsx` (новый)

Рендерит `.chats-container.tabs-container[data-animation="navigation"]` и по
`<Chat>` на каждый дескриптор. `.active` — только у верхнего. Переключение
вкладки на смену стека — `runNavigationTransition({container, to, from, toRight})`,
где `toRight = глубина выросла`. Это и есть наш `chatsSelectTab`.

Промежуточные узлы при `popTo` через несколько уровней удаляются сразу
(фикс z-index из `spliceChats`), уходящий верхний живёт до конца перехода.

### `core/chat/chatInstanceContext.tsx` (новый)

Контекст `{ peerId, threadId, type, isActive }` + `useChatInstance()` /
`useIsActiveChat()`. **Правило:** любой эффект инстанса, который вешает слушатель
на `window`/`document` или пишет в глобальное состояние (хоткеи, заголовок вкладки,
классы `body`), обязан быть за `useIsActiveChat()`. Инстансы в стеке смонтированы
одновременно — без гейта такие эффекты сработают дважды.

### Позиция скролла

`core/chat/chatPositions.ts` — сохранение/восстановление по ключу
`peerId_threadId` (как `getChatSavedPosition`), в памяти. Пишется при уходе
инстанса из активных, читается при возврате. Персист в `AppState` — **вне
периметра** этой спеки (в tweb он есть, у нас появится отдельной задачей).

### Что меняется в существующем

- `App.tsx` — вместо развилки «тред/чат/пусто» рендерит `<ChatsContainer/>`.
- `stores/navigationStore.ts` — `openTopicThread`/`openCommentsThread`/`closeThread`
  становятся тонкими обёртками над `chatStack.setInnerPeer`/`closeTop`. Поле
  `openThread` из стора уходит; `selectedId` (подсветка в списке) остаётся за
  `navigationStore`.
- `components/Chat.tsx` — принимает дескриптор (`peerId`/`threadId`/`type`) вместо
  `chat` + `thread`; `ThreadInfo` заменяется на `type` + `threadId`; глобальные
  эффекты уходят за `useIsActiveChat()`.

## Что определяет `type`

Зафиксировано по снятому эталону:

| | `Chat` | `Discussion` |
|---|---|---|
| шапка | аватар + `peer-title` + сабтайтл | без аватара, title = `N Comments`, `.info.hide` |
| история | окно чата | окно треда (`threadRoot`) |
| инпут | обычный плейсхолдер | `Comment` |
| плашки сверху | пины, анрид | плашка-родитель (статический пост) |
| правый сайдбар | профиль пира | профиль пира + `threadId` |

`Saved`, `Pinned`, `Search` объявлены в enum как контракт; их поведение снимается
с tweb отдельно на этапе 3 и **не выдумывается** здесь.

## Этапы

### Этап 1 — скелет стека

Стор, `ChatsContainer`, контекст активности, `chatPositions`; комментарии и
форум-топики переезжают на стек (`ChatType.Discussion` и `ChatType.Chat` +
`threadId` соответственно — форум-топик в tweb остаётся `Chat` с `threadId`,
см. `chat.ts:894`). Шапка/инпут/плашки продолжают работать как сейчас — их
приведение к tweb идёт в спеке страницы комментариев.

**Приёмка:** `npm test`, `npm run typecheck`, `npm run lint` зелёные; на стенде
`:38080` — переход в комментарии и обратно играет навигационную анимацию, возврат
сохраняет позицию скролла и не перезагружает окно.

### Этап 2 — раскол `Chat.tsx`

`ChatTopbar` / `ChatBubbles` / `ChatInput` / `ChatInstance` (композиция + владение
`peerId`/`threadId`/`type`). Глобальное (window-хоткеи, drag&drop, тема/фон) уезжает
в `ChatsContainer` или в отдельные модули уровня колонки. Цель — чтобы безопасность
многократного монтирования держалась структурой, а не гейтами.

**Приёмка:** тесты этапа 1 зелёные без правок + новые тесты на границы вынесенных
модулей; поведение на стенде не изменилось.

### Этап 3 — остальные типы инстанса

`Saved`, `Pinned`, `Search` переводятся на стек, каждый со своим снятым с tweb
эталоном (дампы + исходники), по одному типу за подэтап.

## Тесты

Норма проводки из `web-client/CLAUDE.md`: каждая строка проводки либо краснит тест
при удалении/порче, либо помечена комментарием у себя с причиной.

- `stores/chatStackStore.test.ts` — `setPeer`/`setInnerPeer`/`popTo`/`closeTop`,
  переиспользование инстанса того же пира, схлопывание стека при уходе к другому
  пиру, уникальность ключей, инвариант «верхний = активный».
- `components/chat/ChatsContainer.test.tsx` — по узлу на дескриптор, `.active`
  только у верхнего, порядок узлов = порядку стека, удаление промежуточных при
  `popTo` через уровень; **факт вызова** `runNavigationTransition` с
  `toRight`, соответствующим направлению (мутация в no-op обязана краснеть).
- `core/chat/chatInstanceContext.test.tsx` — при двух смонтированных инстансах
  гейтированный эффект отрабатывает один раз.
- `core/chat/chatPositions.test.ts` — сохранение при уходе, восстановление при
  возврате, ключ включает `threadId`.

## Риски

- **Двойные эффекты.** Главный риск этапа 1: `Chat.tsx` писался в расчёте на один
  смонтированный экземпляр. Митигация — гейт + тест на двойное срабатывание;
  структурное решение — этап 2.
- **Производительность.** Два-три смонтированных инстанса держат свои ленты в DOM.
  В tweb ровно так же (неактивные вкладки скрыты `display: none`), плюс тяжёлая
  анимация глушит стикеры/видео на время перехода — это уже делает
  `runNavigationTransition`.
- **Расхождение с `navigationStore`.** Пока стек и `selectedId` живут в разных
  сторах, возможна рассинхронизация подсветки в списке чатов. Держим одним
  правилом: подсветку определяет **дно стека** (первый инстанс), а не верх.

## Вне периметра

- Бэкенд-зеркало поста в группе обсуждения — отдельная спека.
- Страница комментариев 1:1 (шапка `N Comments`, плашка-родитель, «Discussion
  started», футер поста, ссылки `?comment=`) — отдельная спека, поверх этой.
- Персист позиций скролла в `AppState`.
- Мобильная колоночная навигация (`selectTab` между списком и чатом) — не трогаем.
