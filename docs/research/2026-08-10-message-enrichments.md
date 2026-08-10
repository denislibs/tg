# Карта обогащений витринной модели поверх SSOT воркера

Дата: 2026-08-10. Готовит почву для операции `patch` (Task 2 этого этапа) и
будущей миграции остальных live-кадров на op-протокол (по образцу `new_message`,
уже переведённого на `insert` в Stage 1B.2). Метод: построчное сравнение
воркерного `cacheX` (мутация SSOT — `messagesManager.ts`,
`messages/{pollMethods,reactionMethods}.ts`) и сторного `applyX`
(`stores/messagesStore.ts`), плюс проверка, действительно ли поле, которое
`applyX` сохраняет «локально», воркеру физически недоступно — а не просто
независимо вычисляется им же по тому же алгоритму.

## TL;DR

- Рассмотрено **12** типов кадров. **11** — кандидаты на `patch` (точечное
  слияние 1–3 полей), **1** (`delete_message`) — уже `remove`. Кандидатов на
  `replace` **нет ни одного**: у каждого типа `applyX` в сторе сам делает
  выборочный merge, а не подмену всего сообщения — значит и операция обязана
  быть выборочной, иначе `replace` молча стёр бы поля, которых в объекте
  воркера просто никогда не было (см. ниже).
- Из «известных заранее» обогащений подтвердились буквально только **два**:
  `localUrl` и резолвнутый `replyTo` — воркерный SSOT их **никогда** не
  заполняет ни при инициализации (`mapMessage`), ни при `patchMsg`.
- Ожидание **`myVotes`/`participating`/`iWon`/`reactions[].mine`/
  `starReaction.mine` как «известно только главному потоку» — в буквальном
  смысле **неверно**: воркер вычисляет/хранит их точно тем же способом
  (собственный `getMeId`, собственный `patchMsg` после REST-ответа своего же
  действия). Нюанс — не «знает / не знает», а «чей экземпляр авторитетнее» в
  многовкладочном сценарии (SharedWorker общий на все вкладки, стор — per-tab);
  подробности в разделе 3. Для `patch` это не меняет вердикт (поле всё равно
  синхронизируется отдельно от общего merge), но опровергает наивную посылку.
- Находка сверх списка брифа: **`cacheEdit` не патчит `reply_markup`**, хотя
  кадр его несёт и `applyEdit` в сторе его применяет (раздел 4) — расхождение
  SSOT/стора уже существует сегодня, независимо от операций.
- Ещё находка: `applyReaction`/`patchViews` в сторе уже сегодня возвращают
  **прежнюю ссылку**, если значение не изменилось (сравнение перед записью) —
  это прямой прецедент для решения по «patch, который ничего не меняет» в
  Task 2 (раздел 5).

---

## 1. Таблица по типам кадров

| № | Кадр | `cacheX` (воркер) | `applyX` (стор) | Обогащение гл. потока? | Вердикт |
|---|---|---|---|---|---|
| 1 | `edit_message` | `messagesManager.ts:509-512` — патчит `text`, `entities`, `editedAt`. **`reply_markup` не трогает.** | `messagesStore.ts:399-409` — патчит `text`, `entities`, `editedAt`, и (если передан) `replyMarkup` | Нет главным-потоком-only поля, но есть расхождение SSOT/стора — см. §4 | `patch` |
| 2 | `delete_message` | `messagesManager.ts:546-548` (`evictMsg`) — физически удаляет из SSOT + всех срезов | `messagesStore.ts:459-463` — `filter` по id | Нет | `remove` (уже есть) |
| 3 | `media_read` | `messagesManager.ts:552-554` — `mediaUnread:false`, гейт по `!!m.mediaUnread` | `messagesStore.ts:465-471` — то же, гейт идентичен | Нет | `patch` |
| 4 | `web_page_update` | `messagesManager.ts:521-524` — `webPage` целиком (серверный агрегат) | `messagesStore.ts:419-425` — то же | Нет | `patch` |
| 5 | `factcheck_update` | `messagesManager.ts:527-530` — `factCheck` целиком (`undefined` — снята) | `messagesStore.ts:427-433` — то же | Нет | `patch` |
| 6 | `paid_media_unlock` | `messagesManager.ts:534-544` — набор медиа-полей + `paidMedia`, поштучно | `messagesStore.ts:435-457` — тот же набор полей поштучно (не подмена всего сообщения, хотя `storeProjection.ts:198-201` строит полный `incoming` через `fromNewMessageEvt`!) | Нет (сам `applyPaidUnlock` уже режет поля из готового Message) | `patch` |
| 7 | `geo_live_update` | `messagesManager.ts:515-518` — `geo` целиком (`mapGeo`, серверный агрегат вкл. `liveStopped`) | `messagesStore.ts:411-417` — то же | Нет | `patch` |
| 8 | `poll_update` | `pollMethods.ts:75-78` — `poll` целиком, но **сохраняет** `m.poll!.myVotes` из своей же SSOT-копии | `messagesStore.ts:355-361` — то же, сохраняет `m.poll.myVotes` из своей копии стора | `myVotes` не «известно только стору» — воркер тоже его хранит (см. §3.1) | `patch` |
| 9 | `checklist_update` | `pollMethods.ts:79-81` → `applyChecklistToCache` (`pollMethods.ts:11-14`) — `checklist` целиком, **без** сохранения чего-либо локального | `messagesStore.ts:371-377` — то же, без сохранения | Нет (комментарий в коде: «отметки глобальны... локального состояния нет») | `patch` |
| 10 | `giveaway_update` | `pollMethods.ts:83-86` — `giveaway` целиком, сохраняет `participating`/`iWon` из своей SSOT-копии | `messagesStore.ts:379-389` — то же, сохраняет из своей копии стора | `participating`/`iWon` не «известно только стору» — воркер тоже хранит (см. §3.2) | `patch` |
| 11 | `reaction` | `reactionMethods.ts:86-107` (`cacheReaction` → delta/absolute) — `mine` **вычисляется воркером** через свой `getMeId` | `messagesStore.ts:483-511` (`applyReaction`/`applyReactionOptimistic`) — `mine` деривится в сторе через `meId` из `chatsStore` | `mine` не «известно только стору» — воркер вычисляет тем же способом (см. §3.3) | `patch` |
| 12 | `star_reaction` | `reactionMethods.ts:110-114` — `mine` только для `sender_id === getMeId()`, иначе сохраняет прежнее | `messagesStore.ts:513-522` — та же логика через `meId` из `chatsStore` | Нет (симметрично) | `patch` |

Итого: **11 × `patch`, 1 × `remove`, 0 × `replace`**.

---

## 2. Почему не `replace` — даже там, где нет явного обогащения

Даже для кадров без единого локального поля (`media_read`, `web_page_update`,
`factcheck_update`, `geo_live_update`, `checklist_update`, `star_reaction`)
операция `replace` всё равно опасна: она подменяет **весь объект** сообщения
объектом из SSOT воркера. А в SSOT воркера отсутствуют поля, которые туда
никогда не пишутся ни при `mapMessage` (`models.ts:696-767`), ни при
`fromNewMessageEvt` (`models.ts:776-800`), ни при одном `patchMsg`:

- **`localUrl`** — blob-URL локального файла. Сервер его не присылает
  (`RawMessage` такого поля не имеет), значит `mapMessage` его не ставит; в
  `fromNewMessageEvt` тоже нет `localUrl`. Единственное место, где он живёт —
  сторный `insert()`/`applyIncoming` при слиянии с оптимистическим баблом
  (`messageOps.ts:47-55`, `messagesStore.ts:329-330`). Воркер этот merge не
  делает вообще — оптимистика воркера не хранится в `msgsByChat`.
- **`replyTo`** (резолвнутое превью ответа) — по прямому комментарию в коде
  воркер его не резолвит: `messagesManager.ts:487-488` («replyTo не передаём...
  резолв превью ответа нужен уже загруженное окно (main-thread забота)»).
  Резолвит его сам стор точечным `replace`-опом (единственное разрешённое
  исключение — `storeProjection.ts:99-124`).

Любой будущий `replace` с телом из SSOT воркера обнулил бы оба поля на
сообщении, у которого они были — даже если событие (скажем, `media_read`) с
этими полями вообще не связано. `patch` их не трогает по построению: он несёт
только `fields`, перечисленные явно.

---

## 3. Опровергнутые ожидания: «знает / не знает» — не то же самое, что «где хранится»

Бриф предполагал `myVotes`, `participating`/`iWon`, `reactions[].mine`,
`starReaction.mine` как обогащения, недоступные воркеру. Три предположения
из четырёх (`3.1`–`3.3`) неточны буквально: воркер эти значения **тоже
вычисляет и хранит**, тем же способом, что и стор.

### 3.1 `poll.myVotes`

Голос авторитетен и несёт **мой** выбор (комментарий `pollMethods.ts:26-29`).
`votePoll` пишет полный `poll` (с реальным `myVotes` из ответа REST) в SSOT
воркера:

```ts
// pollMethods.ts:30-35
async votePoll(chatId: number, pollId: number, options: number[]): Promise<Poll> {
  const r = await rest.post<{ poll: RawPoll }>(`/polls/${pollId}/vote`, { options })
  const poll = mapPoll(r.poll)
  patchMsg(chatId, (m) => m.poll?.id === poll.id, (m) => ({ ...m, poll }))
  return poll
},
```

`cachePoll` (обработчик кадра `poll_update`) затем **сохраняет** это же
`myVotes` из SSOT воркера при накатывании абсолютного агрегата:

```ts
// pollMethods.ts:75-78
cachePoll(evt: { chat_id: number; poll: RawPoll }): void {
  const poll = mapPoll(evt.poll)
  patchMsg(evt.chat_id, (m) => m.poll?.id === poll.id, (m) => ({ ...m, poll: { ...poll, myVotes: m.poll!.myVotes } }))
},
```

Это в точности та же пара действий, что делает стор (`votePoll(...).then(setPoll)`
на месте вызова + `applyPollUpdate` с сохранением `m.poll.myVotes`,
`messagesStore.ts:355-361`). **Нюанс, а не опровержение с чистого листа:**
воркер — единственный экземпляр SharedWorker на все вкладки одного профиля, а
стор — per-tab. Если голос отдан во вкладке A, SSOT воркера (общий) узнаёт
`myVotes` немедленно; стор вкладки B узнает только если сам получит ответ
REST — иначе его локально сохранённая копия `myVotes` устареет. То есть
воркерная копия в многовкладочном сценарии потенциально **авторитетнее**
сторной, а не беднее — обратное тому, что предполагал бриф. Выбор, откуда
операция `patch` в итоге возьмёт `myVotes` при будущей миграции — решение той
будущей задачи, не этой; здесь фиксируется только факт, что «воркер не знает»
неверно в буквальном смысле.

### 3.2 `giveaway.participating` / `giveaway.iWon`

Симметрично п. 3.1: `participateGiveaway` (`pollMethods.ts:66-71`) пишет
авторитетный ответ REST в SSOT воркера, `cacheGiveaway`
(`pollMethods.ts:82-86`) сохраняет `participating`/`iWon` из уже имеющейся
SSOT-копии — той же техникой, что `applyGiveawayUpdate`/`setGiveaway`
в сторе (`messagesStore.ts:379-397`).

### 3.3 `reactions[].mine`

Оба места деривят `mine` одним и тем же способом — сравнением `user_id`/
`sender_id` события с `meId`:

```ts
// reactionMethods.ts:86-92 (воркер, cacheReaction → applyReactionToCache)
const applyReactionToCache = (evt: ReactionEvt): void => {
  const mine = evt.user_id === (getMeId?.() ?? null)
  patchMsg(evt.chat_id, (m) => m.id === evt.msg_id, (m: Message) => {
    const next = reactionDelta(m.reactions, evt.emoji, evt.action, mine)
    return next === null ? null : { ...m, reactions: next }
  })
}
```

```ts
// messagesStore.ts:498-511 (стор, applyReactionOptimistic — тот же mine=true)
applyReactionOptimistic: (chatId, msgId, emoji, action, me) =>
  set((s) => patchChat(s, chatId, (w) => { /* ... */
    const next = reactionDelta(m.reactions, emoji, action, true, me)
    /* ... */
  })),
```

`getMeId` в воркере — рабочий геттер, резолвится один раз при старте воркера
(`worker.ts:77-83`: `void tokens.ready().then(() => auth.me()).then((u) => { meId = u?.id ?? null })`,
`getMeId: () => meId`), не заглушка. Значит и это поле воркеру доступно, не
только стору.

### 3.4 Подтвердившееся обогащение сверх реакций: `star_reaction.mine` — тоже НЕ обогащение

Аналогично п. 3.3 — см. таблицу, строка 12. Единственные буквально
подтвердившиеся из исходного списка — `localUrl` и `replyTo` (раздел 2).
`clientId` — частично: воркер ставит его в `fromNewMessageEvt`
(`models.ts:799`, эхо своей отправки), но **не** ставит в `mapMessage`
(`models.ts:696-767` не мапит `client_msg_id` вовсе) — значит для сообщения,
загруженного обычной историей (`getHistory`), `clientId` в SSOT воркера
отсутствует, даже если на сервере он есть. Практического значения для `patch`
это не имеет (операция несёт только явно перечисленные поля, `clientId` в
`fields` включать незачем), но для будущего `replace`-подобного кода — ещё
один довод против подмены всего объекта.

---

## 4. Находка вне списка брифа: `cacheEdit` теряет `reply_markup`

`EditMessageEvt` несёt `reply_markup` (`events.ts:98`):

```ts
export interface EditMessageEvt { chat_id: number; msg_id: number; seq: number; text: string; entities?: MessageEntity[] | null; edited_at: string; reply_markup?: import('../models').RawMessage['reply_markup'] }
```

Стор его применяет:

```ts
// messagesStore.ts:399-409
applyEdit: (chatId, msgId, text, editedAt, entities, replyMarkup) =>
  set((s) => patchChat(s, chatId, (w) =>
    w.msgs.some((m) => m.id === msgId)
      ? w.msgs.map((m) => m.id === msgId
          ? { ...m, text, editedAt, entities, ...(replyMarkup !== undefined ? { replyMarkup: replyMarkup ?? undefined } : {}) }
          : m)
      : null)),
```

Воркер — нет:

```ts
// messagesManager.ts:509-512
cacheEdit(evt: EditMessageEvt): void {
  patchMsg(evt.chat_id, (m) => m.id === evt.msg_id,
    (m) => ({ ...m, text: evt.text, entities: evt.entities ?? undefined, editedAt: evt.edited_at }))
},
```

Расхождение существует **уже сегодня**, независимо от операций `patch`/
`replace` — SSOT воркера тише стора теряет обновлённую клавиатуру при правке
сообщения бота. Не в скоупе этой задачи (документ, не патч поведения), но
стоит держать в виду при будущей миграции `edit_message` на op-протокол:
`fields` для этой операции обязаны включать `replyMarkup`, иначе даже `patch`
унаследует тот же пробел от воркерного источника.

---

## 5. Прецедент «ничего не изменилось → та же ссылка» — уже в сторе

`applyReaction` в сторе явно сравнивает предыдущий и новый агрегат реакций
перед тем, как считать окно изменившимся:

```ts
// messagesStore.ts:76-83
function sameReactions(a: ReactionCount[] | undefined, b: ReactionCount[] | undefined): boolean {
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false
  if (!a || !b) return true
  for (let i = 0; i < a.length; i++) {
    if (a[i].emoji !== b[i].emoji || a[i].count !== b[i].count || a[i].mine !== b[i].mine) return false
  }
  return true
}
```

```ts
// messagesStore.ts:483-496
applyReaction: (chatId, msgId, counts, myEmoji, myAction) =>
  set((s) => patchChat(s, chatId, (w) => {
    if (!w.msgs.some((m) => m.id === msgId)) return null
    let changed = false
    const msgs = w.msgs.map((m) => {
      if (m.id !== msgId) return m
      const next = setReactions(m.reactions, counts, myEmoji, myAction)
      if (sameReactions(m.reactions, next)) return m
      changed = true
      return { ...m, reactions: next }
    })
    return changed ? msgs : null   // ← ничего не изменилось: patchChat пропускает окно целиком
  })),
```

`patchViews` делает то же на уровне отдельного поля (`views`,
`messagesStore.ts:473-481`: перестраивает только строки, у которых счётчик
реально изменился). Остальные `applyX` (`applyPollUpdate`, `applyGiveawayUpdate`,
`applyChecklistUpdate`, `applyEdit`, `applyGeoLive`, `applyWebPage`,
`applyFactCheck`, `applyPaidUnlock`) такой проверки не делают — они всегда
строят новый `msgs`/объект, если сообщение вообще найдено (гейт у них только
«сообщение существует», не «значение отличается»).

Это прямо отвечает на пункт Task 2 «патч, который ничего не меняет»: в сторе
уже есть согласованный прецедент — **если он есть, применяется** (не
универсальное правило для всех `applyX`, но именно там, где до этого решение
принималось намеренно, ответ «та же ссылка»). Решение и обоснование для
`applyOp('patch', …)` зафиксированы в отчёте Task 2.

---

## 6. Источники

- `web-client/src/core/managers/messagesManager.ts`
- `web-client/src/core/managers/messages/pollMethods.ts`
- `web-client/src/core/managers/messages/reactionMethods.ts`
- `web-client/src/stores/messagesStore.ts`
- `web-client/src/core/models.ts` (`Message`, `mapMessage`, `fromNewMessageEvt`, `mapGeo`)
- `web-client/src/core/realtime/events.ts` (типы кадров)
- `web-client/src/client/realtime/storeProjection.ts` (маршрутизация кадров → стор)
- `web-client/src/core/worker.ts:77-83` (`getMeId`)
