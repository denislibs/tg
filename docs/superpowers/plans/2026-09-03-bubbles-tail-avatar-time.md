# Лента: хвост, отступ под аватар и время у медиа без подписи

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ — `superpowers:subagent-driven-development`.
> Шаги отмечаются чекбоксами `- [ ]`.

**Цель:** закрыть три недоделки порта ленты, дающие четыре видимых дефекта:
у сообщений нет хвостов; аватар автора лежит поверх бабла; реакции налезают на
аватар; время стикеров и файлов уезжает к правому краю колонки.

**Архитектура:** все три — недовезённые куски порта, а не поломки. CSS для них уже
портирован дословно (проверено `diff` с оригиналом: `_chatBubble.scss`, `_chat.scss`,
`_reactions.scss`, `_reaction.scss`, `_stackedAvatars.scss` отличаются от tweb только
строкой `@use`). Не хватает трёх вещей на стороне JS/разметки.

**Источник порта:** `/Users/denisurevic/Documents/tweb` (далее `tweb/`).
База знаний: `docs/tweb/bubbles.md` §2.2, §3.1, §5.4.

## Global Constraints

- **Источник порта — код tweb, а не наше нынешнее поведение.**
- Правило проекта: разметку и классы брать 1:1, CSS не изобретать — он уже на месте.
- Мутационная проверка обязательна: каждый новый пин прогнать порчей проверяемой
  строки, вывод падения — **в тело коммита**.
- Коммитить точечными путями, никогда `git add -A`.
- Комментарии и сообщения коммитов по-русски, объясняют ПОЧЕМУ.
- Проверка: `cd web-client && npx vitest run && npx tsc --noEmit`.

## Диагностика (факты, снятые на стенде и в исходниках)

| Симптом | Корень | Где |
|---|---|---|
| Хвостов нет ни у одного бабла | не портированы ни спрайт, ни вставка узла | `web-client/index.html` — ноль `<symbol>`; в `web-client/src` ноль вставок `bubble-tail` |
| Аватар автора лежит поверх бабла | `.bubbles-inner` не получает класс `is-chat`, поэтому не срабатывает `margin-inline-start: 2.875rem` | `bubbles.ts:874-881` против tweb `bubbles.ts:5787-5792`; правило — `styles/tweb/_chat.scss:1311-1316` |
| Реакции налезают на аватар | следствие предыдущего: вся зона `.bubble-content-wrapper` не сдвинута | — |
| Время стикера/файла у правого края | ветка `has-floating-time`/`service` не портирована: время и реакции всегда уходят в `.message` | `bubbles.ts:1813-1827` против tweb `bubbles.ts:9849-9851` |

Проверено на стенде: у стикера класс `has-floating-time` стоит, но `.time` лежит в
`.message.spoilers-container` со `position: static`, и его правый край совпадает с
правым краем колонки.

Отдельно, НЕ входит сюда: `messageActionStarGift` у нас маршрутизируется в
`kind: 'gift'` (`core/messages/messageKind.ts:99-101`) и потому рисуется обычным
баблом со временем, тогда как в tweb остаётся служебным (`SERVICE_AS_REGULAR`
содержит только звонок, tweb `bubbles.ts:275-279`). Записано долгом.

---

### Task 1: отступ под аватар — класс `is-chat`

Самая дешёвая правка с самым большим видимым эффектом: одна строка кода снимает два
симптома из четырёх.

**Files:**
- Modify: `web-client/src/components/chat/bubbles.ts:874-881`
- Test: `web-client/src/components/chat/bubbles.avatarOffset.test.ts` (новый)

**Interfaces:**
- Consumes: `styles/tweb/_chat.scss:1311-1316` (правило уже есть)
- Produces: `.bubbles-inner` и `.bubbles-remover` несут `is-chat` в групповом чате

- [ ] **Step 1: Написать падающий пин**

Пин закрепляет НАБЛЮДАЕМОЕ, а не строку: в групповом чате оба узла (`chatInner` и
`remover`) несут `is-chat`, в личном — не несут. Порт условия — tweb `bubbles.ts:5787-5792`
(`element.classList.toggle('is-chat', isLikeGroup)` в одном `forEach` на оба узла;
там же `no-messages`, `with-message-avatars`, `is-broadcast` — портировать те из них,
для которых у нас есть предмет, а для остальных назвать вычет в комментарии).

- [ ] **Step 2: Прогнать — падает** (`cd web-client && npx vitest run src/components/chat/bubbles.avatarOffset.test.ts`)
- [ ] **Step 3: Реализовать** — переключение класса там, где у нас известен тип чата;
  найти точку, соответствующую tweb `bubbles.ts:5770` (`isLikeGroup` из `this.chat`).
- [ ] **Step 4: Зелёный прогон + мутация** — снять класс с `remover`: пин обязан покраснеть.
- [ ] **Step 5: Живая сверка на стенде** — открыть групповой чат, убедиться, что аватар
  больше не лежит на бабле и реакции не налезают; числа «было/стало» — в тело коммита.
- [ ] **Step 6: Коммит** — `fix(bubbles): лента группы отодвигает баблы под аватар`

---

### Task 2: хвост сообщения

**Files:**
- Modify: `web-client/index.html` (спрайт `symbol#message-tail-filled`)
- Create: `web-client/src/components/chat/tail.ts` (порт `tweb/src/components/chat/utils.ts:43-63`)
- Modify: `web-client/src/components/chat/bubbles.ts` (вставка, порт tweb `bubbles.ts:9707-9712`)
- Test: `web-client/src/components/chat/bubbles.tail.test.ts` (новый)

**Interfaces:**
- Produces: `generateTail(asSpan?: boolean): SVGSVGElement | HTMLSpanElement`

- [ ] **Step 1: Написать падающие пины**

Три утверждения:
1. в `web-client/index.html` есть `symbol#message-tail-filled` (иначе `<use>` не во что резолвить);
2. бабл с `can-have-tail` содержит `svg.bubble-tail > use[href="#message-tail-filled"]`
   **последним ребёнком `.bubble-content`** — проверять родителя и позицию, иначе порча
   «положили в wrapper» пройдёт незамеченной;
3. у круглого видео узел добавляется, а класса `can-have-tail` нет (tweb `bubbles.ts:9707`
   гейтит `!isRound`).

Ожидаемое дерево уже зафиксировано в фикстуре `web-client/scripts/domdiff/expected/bubbles.json:170-183`
(и ещё 7 вхождений) — сверить форму с ней, а не выдумывать.

- [ ] **Step 2: Прогнать — падает**
- [ ] **Step 3: Реализовать** — `generateTail` переносится дословно (SVG 11×20, viewBox
  `0 0 11 20`, `use[href="#message-tail-filled"]`); спрайт взять из `tweb/index.html:64-68`
  вместе с обрамляющим скрытым `<svg>`-блоком; вставка — `bubbleContainer.append(generateTail())`
  при `canHaveTail || isRound`.
- [ ] **Step 4: Зелёный прогон + мутация** — переложить узел в `bubble-content-wrapper`:
  пин на родителя обязан покраснеть.
- [ ] **Step 5: Живая сверка** — хвост виден у последнего бабла группы, у входящих слева,
  у исходящих справа, цвет совпадает с баблом.
- [ ] **Step 6: Коммит** — `fix(bubbles): хвост сообщения — спрайт и узел`

---

### Task 3: время и реакции у медиа без подписи

**Files:**
- Modify: `web-client/src/components/chat/bubbles.ts:1813-1827`
- Test: `web-client/src/components/chat/bubbles.floatingTime.test.ts` (новый)

**Interfaces:**
- Consumes: классы `has-floating-time`, `service` (уже ставятся — `components/messages/bubbleClasses.ts:10,12,13,129`)

- [ ] **Step 1: Написать падающие пины**

Порт развилки tweb `bubbles.ts:9849-9851`:
- у бабла с `has-floating-time` (медиа без подписи) и у служебного узел реакций —
  ребёнок `.bubble-content-wrapper`, а НЕ `.message`;
- время в этой ветке не уезжает внутрь реакций;
- у обычного текстового бабла всё остаётся как было (пин на неизменность).

Прежде чем писать — прочитать в оригинале `appendBubbleTime` и ветку `has-floating-time`
целиком (tweb `bubbles.ts:9822-9875` и `messageRender.ts`), чтобы перенести размещение
ВРЕМЕНИ, а не только реакций: наблюдаемый дефект — именно улетевшее время.

- [ ] **Step 2: Прогнать — падает**
- [ ] **Step 3: Реализовать**
- [ ] **Step 4: Зелёный прогон + мутация** — вернуть безусловный `messageDiv.append`:
  пин обязан покраснеть.
- [ ] **Step 5: Живая сверка** — у стикера и у файла время лежит на бабле, а не у края колонки.
- [ ] **Step 6: Коммит** — `fix(bubbles): время и реакции медиа без подписи — на бабле`

---

### Task 4: прогон, документация, долг

- [ ] **Step 1:** `cd web-client && npx vitest run && npx tsc --noEmit && npx vite build`
- [ ] **Step 2:** обновить `docs/tweb/bubbles.md` — секции «у нас» по хвосту, аватару и
  времени: расхождения сняты.
- [ ] **Step 3:** записать долг: `messageActionStarGift` маршрутизируется в `kind: 'gift'`
  (`core/messages/messageKind.ts:99-101`) и рисуется обычным баблом со временем, тогда как
  в оригинале остаётся служебным.
- [ ] **Step 4:** коммит `docs(bubbles): расхождения по хвосту, аватару и времени сняты`

## Живая проверка (делает ведущий)

Стенд по `STAND.md`; **бэкенд пересобрать вместе с фронтом**. Групповой чат: хвосты у
последних баблов серий, аватар слева и не поверх текста, реакции под текстом в границах
бабла, время стикера и файла — на бабле.
