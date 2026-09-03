# Навигация чата: запись `im` вместо записи на каждый чат (остаток #108)

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ — `superpowers:subagent-driven-development`.
> Шаги отмечаются чекбоксами `- [ ]`.

**Цель:** привести навигацию чата к оригиналу: смена чата перестаёт создавать записи
истории (хэш переписывается на месте), а Back и Esc закрывают чат через ОДНУ запись
типа `im`, как в tweb.

**Архитектура:** источник поведения — `tweb/src/lib/appImManager.ts:2588-2652`
(`selectTab`): при переходе «список → чат» пушится единственная запись `im`, её
`onPop` зовёт `setPeer({})`, а хэш на каждой смене чата пишется через
`overrideHash` → `replaceState`. У нас роль `appImManager` в этой части берёт новый
модуль `core/navigation/chatHistory.ts`: он подписан на стек чатов и владеет обоими
ответами — записью `im` и хэшем. `useUrlSync` остаётся только направлением
«хэш → стор» (внешний вход: загрузка, правка адреса, диплинк), как
`appImManager.onHashChange` у оригинала.

**Источник порта:** `/Users/denisurevic/Documents/tweb` (далее `tweb/`).

**Стек:** TypeScript strict, vitest + @testing-library/react (happy-dom), Zustand 5.

## Global Constraints

- **Источник порта — компонент tweb, а не наш React.** Наше нынешнее поведение
  («Back ходит по чатам») — не «текущее поведение, которое надо сохранить», а ровно
  то расхождение, которое снимается.
- **Третьего механизма навигации не изобретать.** Единственный — 
  `core/navigation/appNavigationController.ts`. Прямых `history.pushState` /
  `history.replaceState` вне контроллера после этой работы остаться не должно.
- **Мутационная проверка обязательна:** каждый пин прогнать порчей проверяемой
  строки, вывод падения положить в тело коммита.
- **Никакого `git add -A`** — коммитить только перечисленные пути.
- **Комментарии и сообщения коммитов по-русски**, объясняют ПОЧЕМУ.
- Каждый порт несёт в шапке ссылку на источник вида `порт tweb/src/lib/appImManager.ts:2628-2638`.
- Мёртвый код удалять: `pushHashState`, `escFallback`-ветка чата и их тесты уходят,
  а не остаются «на всякий случай».

---

## Опорные факты (проверено в исходниках, не пересказ)

| Вопрос | Оригинал | У нас сейчас |
|---|---|---|
| Запись на смену чата | нет: `overrideHash` → `replaceState` (`appNavigationController.ts:274-288`, `:411-423`) | `pushHashState` на каждый чат И на каждый тред (`useUrlSync.ts:145`) |
| Запись `im` | пушится при росте таба `CHATLIST→CHAT` (`appImManager.ts:2628-2638`), `onPop` = `setPeer({}, canAnimate)` | производителя нет вовсе (тип объявлен, `appNavigationController.ts:82`) |
| Уход вглубь (тред) | новых записей НЕ добавляет: `setInnerPeer` (`appImManager.ts:2831-2872`) зовёт `setPeer`, тот `selectTab(CHAT)` при уже `CHAT` → условие `id > prevTabId` ложно | тред пишет свою запись и свой хэш `peerId_rootMsgId` (`useUrlSync.ts:29,146`) |
| Хэш на глубине | от глубины НЕ зависит: пишется `this.chat?.peerId` верхнего инстанса (`appImManager.ts:2597`) | `peerId_rootMsgId` |
| `setPeer({})` | одна точка ветвления: глубина > 1 → `spliceChats(chatIndex)` (`appImManager.ts:2768-2770`); иначе чат очищается и таб уходит на список (`:2804`, `:2825-2828`) | размазано: `chatStackStore.closeTop()` (`:162-163`), `navigationStore.selectChat(null)` → `clear()` (`:33`), ветвление в хоткеях (`useAppHotkeys.ts:21-26`) |
| Esc при открытом чате | `back(item.type)` по верхней записи `im` (`appNavigationController.ts:217-224`), запись истории съедается | `escFallback` мимо истории (`hotkeys.ts:49-63`), после чего `useUrlSync` дописывает ЕЩЁ одну запись |
| Второй Back после возврата из треда | записей нет → `pushState()` и выход (`appNavigationController.ts:198-202`); с сайта не уходит, чат не закрывается | — |

Отдельно: цикл `removeByType('chat')` (`appImManager.ts:2689-2692`) в оригинале
холостой — записей типа `'chat'` не производит никто. Не воспроизводить.

---

### Task 1: `chatHistory` — хэш на месте, без записей

**Files:**
- Create: `web-client/src/core/navigation/chatHistory.ts`
- Create: `web-client/src/core/navigation/chatHistory.test.ts`
- Modify: `web-client/src/core/hooks/useUrlSync.ts:126-146` (эффект «стор → хэш» уходит)

**Interfaces:**
- Consumes: `appNavigationController.overrideHash(hash?: string, forceReplace?: boolean)`
  (`core/navigation/appNavigationController.ts:319-331`), стор `chatStackStore`.
- Produces:
  - `hashForChat(): string` — хэш открытого состояния БЕЗ ведущего `#`; `''` — список чатов.
  - `syncChatHash(): void` — посчитать и отдать контроллеру через `overrideHash`.
  - `startChatHistory(): () => void` — подписка на стек чатов, возвращает отписку.

- [ ] **Step 1: Написать падающий тест**

`chatHistory.test.ts` пинит три факта, каждый из которых — расхождение из таблицы:

```ts
it('смена чата НЕ создаёт записи истории', () => {
  const push = vi.spyOn(history, 'pushState')
  useChatStackStore.getState().setPeer({ peerId: 42, type: 'chat' })
  syncChatHash()
  expect(push).not.toHaveBeenCalled()
  expect(location.hash).toBe('#42')
})

it('уход вглубь не меняет хэш: он адресует пир верхнего инстанса, а не ветку', () => {
  useChatStackStore.getState().setPeer({ peerId: 42, type: 'chat' })
  useChatStackStore.getState().setInnerPeer({ peerId: 77, type: 'discussion', threadId: 5, thread: { rootMsgId: 5, title: '', kind: 'comments' } })
  syncChatHash()
  expect(location.hash).toBe('#77')
})

it('пустой стек — пустой хэш', () => {
  useChatStackStore.getState().clear()
  syncChatHash()
  expect(location.hash).toBe('')
})
```

Точные имена полей `setPeer`/`setInnerPeer` взять из `stores/chatStackStore.ts:115-158`;
`@username` вместо числа — тем же правилом, что сейчас в `useUrlSync.ts:36-42`
(карточка чата из `core/peerCache.ts`), перенести правило дословно, а не переписывать.

- [ ] **Step 2: Прогнать — падает**

Run: `cd web-client && npx vitest run src/core/navigation/chatHistory.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

Модуль переносит `hashForState` из `useUrlSync.ts:26-43` с ОДНИМ изменением: ветка
открытого треда (`:29`, суффикс `_rootMsgId`) снимается — оригинал адресует пир
верхнего инстанса и только его (`appImManager.ts:2597`). Запись отдаётся
`appNavigationController.overrideHash(hash)`; собственных `history.*` в модуле нет.

- [ ] **Step 4: Снять эффект «стор → хэш» из `useUrlSync`**

`useUrlSync.ts:126-146` удаляется целиком вместе с `pushHashState`-вызовом; в файле
остаётся направление «хэш → стор» (`:113-123`). `readyRef` при этом теряет предмет —
проверить и убрать, если не осталось потребителя. Подписку `startChatHistory()`
поднять там же, где сейчас живёт `useUrlSync` (см. его вызывающего).

- [ ] **Step 5: Зелёный прогон + мутация**

Run: `cd web-client && npx vitest run src/core/navigation/ src/core/hooks/useUrlSync.applyHash.test.ts`
Мутация: заменить `overrideHash` на `pushHashState` — тест «не создаёт записи» обязан покраснеть. Вывод падения — в тело коммита.

- [ ] **Step 6: Коммит**

```
git add web-client/src/core/navigation/chatHistory.ts web-client/src/core/navigation/chatHistory.test.ts web-client/src/core/hooks/useUrlSync.ts
git commit -m "feat(navigation): хэш чата пишется на месте, без записи истории"
```

---

### Task 2: запись `im` и одна точка «закрыть уровень»

**Files:**
- Modify: `web-client/src/core/navigation/chatHistory.ts`
- Modify: `web-client/src/core/navigation/chatHistory.test.ts`
- Modify: `web-client/src/stores/chatStackStore.ts` (если понадобится читающий селектор глубины)

**Interfaces:**
- Consumes: `appNavigationController.pushItem/findItemByType/removeByType`
  (`core/navigation/appNavigationController.ts:416-458`), `chatStackStore.closeTop()`
  (`:162-163`), `navigationStore.selectChat(null)` (`:33`).
- Produces: `closeChatLevel(): void` — наш `setPeer({})`: глубина > 1 → срезать верхний
  инстанс; глубина 1 → закрыть чат.

- [ ] **Step 1: Написать падающие тесты**

```ts
it('открытие чата из списка кладёт РОВНО одну запись im', () => { … })
it('уход вглубь второй записи НЕ добавляет', () => { … })   // tweb appImManager.ts:2628 — id > prevTabId ложно
it('Back из треда срезает верхний инстанс, чат остаётся открытым', () => { … })
it('Back из корневого чата закрывает чат', () => { … })
it('смена чата на другой из списка новой записи не добавляет', () => { … })
```

Эмуляция Back — тем же приёмом, что в `core/navigation/appNavigationController.test.ts:89`
(там уже отлажены и `settle()` очереди мутаций, и снятие слушателей синглтона —
переиспользовать, а не изобретать второй способ).

- [ ] **Step 2: Прогнать — падает**

Run: `cd web-client && npx vitest run src/core/navigation/chatHistory.test.ts`

- [ ] **Step 3: Реализовать**

Пуш записи — когда чат открывается при закрытом (переход «список → чат»), и только
если `!appNavigationController.findItemByType('im')` — порт условия
`appImManager.ts:2628-2629`. `onPop: (canAnimate) => closeChatLevel()`.
`closeChatLevel` ветвится ОДИН раз, по глубине стека, — порт `appImManager.ts:2768-2770`
и `:2825-2828`.

- [ ] **Step 4: Перевести программные закрытия чата на запись**

Все пути «закрыть чат/уровень» обязаны идти через `appNavigationController.back('im')`,
а не звать стор напрямую, — иначе запись останется висеть, а история разъедется
(в оригинале даже стрелка «назад» в шапке идёт этим путём: `tweb/src/components/chat/chat.ts:1628-1632`).
Найти вызывающих `closeTop()`/`selectChat(null)` в UI (`components/Chat.tsx:156`,
`core/hooks/useAppHotkeys.ts:21-26`, прочие по grep) и перевести.

- [ ] **Step 5: Зелёный прогон + мутация**

Мутация: снять условие `!findItemByType('im')` — тест «уход вглубь второй записи не
добавляет» обязан покраснеть.

- [ ] **Step 6: Коммит**

```
git add web-client/src/core/navigation/ web-client/src/components/Chat.tsx web-client/src/core/hooks/useAppHotkeys.ts
git commit -m "feat(navigation): одна запись im на всю глубину чата, Back закрывает уровень"
```

---

### Task 3: Esc — через ту же запись, `escFallback` уходит

**Files:**
- Modify: `web-client/src/core/hotkeys.ts:21-22,49-63`
- Modify: `web-client/src/core/hooks/useAppHotkeys.ts:21-26,63`
- Modify: `web-client/src/core/hotkeys.test.ts:49-56`

- [ ] **Step 1: Переписать пин**

Сейчас `hotkeys.test.ts:49` закрепляет «записей нет → зовётся `escFallback`». После
задачи 2 записи ЕСТЬ всегда, пока открыт чат, и Esc обязан идти через контроллер
(`appNavigationController.ts:217-224`). Пин переписывается на это: Esc при открытом
чате снимает запись `im`, `escFallback` не существует.

- [ ] **Step 2: Прогнать — падает** (`npx vitest run src/core/hotkeys.test.ts`)

- [ ] **Step 3: Снять `escFallback`**

Убрать ветку чата из `hotkeys.ts` и её ветвление тред/чат из `useAppHotkeys.ts`
(предмет переехал в `closeChatLevel`). Остальные хоткеи и гейты текстовых полей не трогать.

- [ ] **Step 4: Зелёный прогон + мутация** (снять `cancelEvent` в контроллере — пин обязан покраснеть)

- [ ] **Step 5: Коммит**

```
git add web-client/src/core/hotkeys.ts web-client/src/core/hotkeys.test.ts web-client/src/core/hooks/useAppHotkeys.ts
git commit -m "refactor(navigation): Esc закрывает чат записью im, escFallback снят"
```

---

### Task 4: `pushHashState` и прямые писатели истории уходят

**Files:**
- Modify: `web-client/src/core/navigation/appNavigationController.ts:481-496`
- Modify: `web-client/src/core/hooks/useDeepLinks.ts:49,73,78,83,101`
- Modify: `web-client/src/components/auth/cards/SignImportCard.tsx:44`
- Modify: `web-client/src/core/navigation/appNavigationController.test.ts` (пин на отсутствие второго писателя)

- [ ] **Step 1: Написать пин-скан**

Тест-скан по `web-client/src`: вне `core/navigation/appNavigationController.ts` не
должно быть ни одного вызова `history.pushState` / `history.replaceState`. Образец
скана — любой из существующих (`src/stores/noManualOrder.test.ts`).

- [ ] **Step 2: Прогнать — падает** (три писателя: `pushHashState`, `useDeepLinks`, `SignImportCard`)

- [ ] **Step 3: Снять**

`pushHashState` удалить целиком (потребитель ушёл в задаче 1). Зачистку адреса в
`useDeepLinks` и `SignImportCard` перевести на `appNavigationController.overrideHash('')`
— так же, как это делает оригинал (`tweb/src/index.ts:579`).

- [ ] **Step 4: Зелёный прогон, `npx tsc --noEmit`**

- [ ] **Step 5: Коммит**

```
git add web-client/src/core/navigation/ web-client/src/core/hooks/useDeepLinks.ts web-client/src/components/auth/cards/SignImportCard.tsx
git commit -m "refactor(navigation): единственный писатель истории — контроллер"
```

---

### Task 5: полный прогон и документация

**Files:**
- Modify: `docs/tweb/state-and-layout.md` (§5.2 — секция «у нас»)
- Modify: `web-client/CLAUDE.md`, если он описывает старое поведение Back

- [ ] **Step 1:** `cd web-client && npx vitest run && npx tsc --noEmit && npx vite build`
- [ ] **Step 2:** обновить §5.2 `state-and-layout.md`: запись `im` у нас появилась, хэш пишется на месте, `pushHashState` и `escFallback` сняты.
- [ ] **Step 3:** коммит `docs(navigation): навигация чата приведена к оригиналу`

## Живая проверка на стенде (делает ведущий, не агент)

Сценарий из `STAND.md`, числами «что было / что стало»:

1. Открыть чат из списка → адрес `#<peer>`, записей истории не прибавилось.
2. Переключиться между тремя чатами → адрес меняется, длина истории та же.
3. Открыть комментарии → адрес остаётся пиром группы, записи не прибавилось.
4. Back → возврат из комментариев в канал, чат открыт.
5. Back → чат закрылся, список.
6. Back ещё раз → с сайта не ушли.
7. Esc вместо Back в пунктах 4–5 — тот же результат.
8. Перезагрузка на открытом чате → чат восстановился.
