// Владелец списка диалогов (порт модели tweb: dialogsStorage живёт в воркере
// вместе с generateDialogIndex, черновиками и порядком закреплённых).
// Витрина (`stores/chatsStore.ts`) — зеркало, её единственный писатель — проектор.
//
// Отступление от tweb: у них представление — сам DOM, которым владеет
// SortedDialogList, массива диалогов на main нет; у нас представление — React,
// читающий из стора, поэтому зеркало массивом. См. спеку
// docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-list-design.md.
import type { RestClient } from '../net/restClient'
import { HttpError } from '../net/restClient'
import { mapDialog, type Dialog, type Draft, type RawDialog } from '../models'
import { dialogIndex } from '../dialogs/dialogIndex'
import type { DialogItem, DialogOp } from '../dialogs/dialogOps'
import type { NewMessageEvt, ReadEvt, ChatUpdateEvt } from '../realtime/events'
import { equal } from '../store/reconcile'

/** Наше закрепление пер-юзерное и на весь список сразу — запись одна (см. chatsStore). */
const ALL_FOLDER_ID = 0

export interface DialogsDeps {
  rest: Pick<RestClient, 'get'>
  onDialogOps?: (ops: DialogOp[]) => void
  /** офлайн-кэш прошлой сессии (persist.loadDialogs) */
  loadCache: () => Promise<Dialog[]>
  /** ключи State, от которых зависит порядок (persist.loadStateAll) */
  loadState: () => Promise<{ pinnedOrders: Record<number, number[]>; drafts: Draft[] }>
  /** id текущего пользователя — нужен applyNewMessage (не бампить бейдж на своё же
   * эхо). Разрешается лениво (воркер узнаёт `me` асинхронно), поэтому геттер, а не
   * значение — тот же приём, что у `newMessagesManager` (messagesManager.ts). */
  getMeId?: () => number | null
  /**
   * Task 4 (действия без оптимистики): `applyPinned` двигает порядок закреплённых
   * и обязан и записать новый `pinnedOrders` на диск, и разослать зеркало ключа
   * остальным вкладкам — тем же путём, что `persistManager.stateKey`
   * (`saveStateKey` + `mirrorStateKey` в workerCore.ts), второй писатель того же
   * ключа не заводится. Опциональны по тому же приёму, что `getMeId` выше: тесты,
   * которых `applyPinned` не касается, их не задают.
   */
  savePinnedOrders?: (value: Record<number, number[]>) => Promise<void>
  mirrorStateKey?: (key: string, value: unknown) => void
  /**
   * Task 5 (персист переезжает к владельцу): физический writer офлайн-кэша
   * списка (`persist.saveDialogs`, подставляется в workerCore.ts). Раньше
   * снапшот собирала main-thread-подписка `stores/dialogsPersist.ts`
   * (дебаунс поверх зеркала chatsStore) и слала его воркеру RPC'ом; теперь
   * владелец — источник данных — пишет сам, тем же дебаунсом, что был там
   * (см. `scheduleSave` ниже). Опционален по тому же приёму, что и
   * `savePinnedOrders`/`mirrorStateKey`: тесты, которых персист не касается,
   * его не задают.
   */
  saveCache?: (dialogs: Dialog[]) => Promise<void>
  /**
   * Task 6 (диалоговая половина `loadChats` переезжает к владельцу): дешифровка
   * превью секретных чатов на холодном старте/сетевом догоне (порт
   * `chatsStore.decryptSecretPreviews`, main). Текст секретного сообщения
   * приходит с сервера как `enc_body`, plaintext знает только WebCrypto-ключ
   * секретного чата — тот живёт в `secretManager` (workerCore.ts), в ТОМ ЖЕ
   * воркере, поэтому RPC (как было с main) больше не нужен. Опционален по тому
   * же приёму, что `getMeId`/`savePinnedOrders` выше: тесты, которых секретные
   * чаты не касаются, его не задают.
   */
  decryptSecret?: (chatId: number, encBody: string) => Promise<{ text: string; media?: { mediaType: string } } | null>
}

/** Тот же интервал, что был у main-thread-дебаунса `dialogsPersist.ts` (800мс)
 * — с запасом округлён до секунды, чтобы серия частых patch'ей (realtime-
 * поток) схлопывалась в одну запись, а не открывала readwrite-транзакцию на
 * каждое изменение. */
const PERSIST_DEBOUNCE_MS = 1000

export function newDialogsManager({ rest, onDialogOps, loadCache, loadState, getMeId, savePinnedOrders, mirrorStateKey, saveCache, decryptSecret }: DialogsDeps) {
  let items: DialogItem[] = []
  // Полный State-ключ (все папки) — нужен целиком, чтобы applyPinned не затёр
  // чужие записи при записи на диск (порт tweb: `{...orders, [ALL_FOLDER_ID]: …}`,
  // см. прежний chatsStore.setDialogPinned). `pinnedOrder` — производная для
  // ТЕКУЩЕЙ (единственной) папки, ей пользуется dialogIndex().
  let pinnedOrders: Record<number, number[]> = {}
  let pinnedOrder: number[] = []
  let drafts: Draft[] = []
  let hydrated = false
  // Промис гидратации в полёте (а не булев флаг): конкурентный fillMirror()/
  // refresh() — две вкладки поднимают общий SharedWorker одновременно, либо оба
  // метода зовутся почти сразу друг за другом — обязан ждать РЕЗУЛЬТАТ первого
  // вызова, а не проскакивать мимо него. Флаг `hydrated=true`, выставленный
  // синхронно ДО await, давал второму вызову увидеть «уже гидратировано» и
  // разослать пустой reset раньше, чем первый успел загрузить кэш/State — этот
  // дефект воспроизведён и закрыт тестом «конкурентный fillMirror не рассылает
  // пустой reset» (dialogsManager.test.ts). `null` после промаха — гидратация
  // упавшая (оффлайн/битый IDB) обязана даться повторить, а не залипнуть на
  // вечно отклонённом промисе (см. тест «упавшая гидратация не залипает»).
  let hydrating: Promise<void> | null = null
  // Task 5: таймер отложенной записи кэша (см. scheduleSave/cancelPersist).
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Fix (финальное ревью, Minor #4): поколение сессии. `resetForLogout()`
   * опустошает кэш синхронно, но НЕ гасит уже улетевшие `hydrate()`/`refresh()`
   * — чтение диска и ответ `/chats`, отправленный под ПРОШЛЫМ токеном, придут
   * уже после смены сессии и без гварда применились бы к кэшу нового аккаунта и
   * разошлись бы веером по вкладкам. Приём — тот же `downloadGen` у медиа
   * (`mediaManager.ts::downloadMediaURL`/`resetDownloads`): поколение снимается
   * в момент ЗАПУСКА операции и сверяется перед записью/публикацией.
   */
  let sessionGen = 0

  /** Схлопнуть серию публикаций в одну запись на диск (см. докблок `saveCache`
   * в DialogsDeps). Каждый publish() двигает окно — итоговая запись случится
   * один раз, через PERSIST_DEBOUNCE_MS ПОСЛЕ ПОСЛЕДНЕЙ операции серии,
   * последняя правка при этом не теряется (пишем `items` в момент срабатывания
   * таймера, а не в момент планирования). */
  function scheduleSave(): void {
    if (!saveCache) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveCache(items.map((i) => i.dialog))
    }, PERSIST_DEBOUNCE_MS)
  }

  /**
   * Разослать операции вкладкам, НЕ трогая диск. Fix (финальное ревью,
   * Important #4): запись на диск — следствие изменения ЗНАЧЕНИЙ кэша, а не
   * самого факта рассылки. Два колсайта объявляют операцию, ничего в значениях
   * не меняя, и обязаны идти этим путём:
   *  - `fillMirror()` — данные только что прочитаны с ТОГО ЖЕ диска, планировать
   *    обратную запись нечего;
   *  - `reindex` из `setStateKey()` — меняется порядок (производная от
   *    State-ключей `pinnedOrders`/`drafts`), а на диск идут только значения
   *    диалогов (`items.map(i => i.dialog)`), они те же.
   */
  const announce = (ops: DialogOp[]) => { onDialogOps?.(ops) }
  /** Изменились ЗНАЧЕНИЯ кэша: разослать и запланировать запись на диск. */
  const publish = (ops: DialogOp[]) => { announce(ops); scheduleSave() }
  const draftFor = (chatId: number) => drafts.find((d) => d.chatId === chatId)

  /** Порядок — производная от данных (tweb generateDialogIndex, dialogs.ts:605-608). */
  const sort = (dialogs: Dialog[]): DialogItem[] =>
    dialogs
      .map((dialog) => ({ dialog, index: dialogIndex(dialog, pinnedOrder, draftFor(dialog.chatId)) }))
      .sort((a, b) => b.index - a.index)

  /**
   * Досеять `pinnedOrders` порядком закреплённых из получившегося списка — порт
   * tweb `generateDialogPinnedDate` (dialogs.ts:934-936), где отсутствующий в
   * порядке закреплённый тут же в него добавляется (`order.unshift`) и порядок
   * сохраняется (`savePinnedOrders`). До Task 6 жил в main (`chatsStore.
   * applyDialogs`/`syncPinnedOrder`) и не был перенесён вместе с остальным —
   * последний кусок легаси-пути, см. `stores/chatsStore.order.test.ts` (снесён
   * этой же задачей, сценарии перенесены сюда).
   *
   * Зачем: `pinned_at` сервер наружу не отдаёт (в `Dialog` только флаг
   * `pinned`), он выражен лишь ПОРЯДКОМ ответа `/chats` (ORDER BY m.pinned_at
   * DESC, chatsrepo.go:225). Первый применённый список этот порядок и
   * фиксирует (стабильная сортировка ES2019 разводит dialogIndex-«ничьи» между
   * ЕЩЁ не отслеженными закреплёнными строго по порядку входного массива —
   * см. докблок `dialogIndex.pinnedDate`), дальше он берётся из `pinnedOrder` —
   * иначе закреплённые без записи в порядке (все получают ОДИНАКОВЫЙ индекс)
   * зависели бы от порядка входного массива при КАЖДОМ применении, то есть от
   * того же расхождения кэш/сеть, ради которого dialogIndex вообще заведён.
   *
   * Тот же канал записи/зеркала, что `applyPinned` (Task 4) — второй писатель
   * `pinnedOrders` не заводится.
   *
   * Возвращает, действительно ли `pinnedOrder` изменился: до сих пор
   * НЕотслеженные закреплённые (`idx===-1` в `dialogIndex.pinnedDate`) все
   * получают ОДИНАКОВЫЙ индекс (offset считается от длины `pinnedOrder`, не от
   * позиции) — засеяв их позициями в `next`, тот же `dialogIndex()` для КАЖДОГО
   * из них начнёт отдавать РАЗНЫЕ значения. `setAll` обязан пересчитать `items`
   * заново в этом случае — иначе их СОХРАНЁННЫЙ `index` (ещё старый, общий)
   * разойдётся с тем, что `dialogIndex()` вернул бы сейчас, и ближайший же
   * `patchDialog` любого из них (например, входящее сообщение) пересчитает
   * его индекс уже НОВЫМ и заново засеянным `pinnedOrder`, увидит `moved` и
   * перетасует пин-блок, будто это первый вход в порядок — см.
   * `dialogsManager.test.ts`, «первичное засеивание переживает последующий
   * точечный patch, не только повторный полный список».
   */
  function syncPinnedOrder(sorted: readonly DialogItem[]): boolean {
    const next = sorted.filter((i) => i.dialog.pinned).map((i) => i.dialog.chatId)
    if (next.length === pinnedOrder.length && next.every((id, i) => id === pinnedOrder[i])) return false
    pinnedOrder = next
    pinnedOrders = { ...pinnedOrders, [ALL_FOLDER_ID]: next }
    void savePinnedOrders?.(pinnedOrders)
    mirrorStateKey?.('pinnedOrders', pinnedOrders)
    return true
  }

  /**
   * Совпал ли пересчитанный список с текущим — И порядком (`chatId` + `index`),
   * И значениями. `equal()` — тот же структурный компаратор, которым
   * `reconcileEntity` сохраняет ссылки на витрине.
   */
  function sameItems(a: readonly DialogItem[], b: readonly DialogItem[]): boolean {
    return a.length === b.length
      && a.every((it, i) => it.index === b[i].index && it.dialog.chatId === b[i].dialog.chatId && equal(it.dialog, b[i].dialog))
  }

  /**
   * Применить ПОЛНЫЙ список (кэш при гидрации, ответ `/chats` при догоне).
   *
   * Fix (финальное ревью, Important #4): `null`, если результат структурно
   * совпал с текущим `items`, — инвариант «совпавший ответ не даёт ни
   * перерисовки, ни записи в IDB» (web-client/CLAUDE.md, «Применять ответ сети
   * полной подменой коллекции»; порт tweb `saveDialogFilter`). Без этого каждый
   * колсайт `refresh()` (их больше десятка — Sidebar, deep-links, редактор
   * контакта, resync-кадр) публиковал бы `reset` и переписывал ВЕСЬ `S_DIALOGS`
   * даже когда сервер вернул ровно то же самое.
   *
   * Прежний `items` при совпадении сохраняется ПО ССЫЛКЕ (вместе со ссылками на
   * сами диалоги) — свежие объекты `mapDialog` выбрасываем: кэш владельца ведёт
   * себя так же, как зеркало под `reconcileById`.
   */
  const setAll = (dialogs: Dialog[]): DialogOp | null => {
    const prev = items
    items = sort(dialogs)
    // Пересортировать НАДО ЖЕ засеянным pinnedOrder — см. докблок syncPinnedOrder.
    if (syncPinnedOrder(items)) items = sort(dialogs)
    if (sameItems(prev, items)) { items = prev; return null }
    return { op: 'reset', items }
  }

  const findDialog = (chatId: number): Dialog | undefined => items.find((i) => i.dialog.chatId === chatId)?.dialog

  /**
   * Точечно смержить `fields` в один диалог кэша и опубликовать `patch`. Индекс
   * пересчитывается той же чистой `dialogIndex()` — если он не сдвинулся, `index`
   * в операции не участвует (зеркало просто накладывает `fields` на месте).
   *
   * Диалога нет в кэше — не ошибка (Task 3, «Осторожно» #3): молча выходим, как
   * раньше выходил `if (!cur) return {}` в chatsStore — он приедет со следующей
   * загрузкой/reset'ом.
   *
   * Fix (ревью Task 3, Important): смерженный результат структурно совпал с
   * текущим значением (напр. бэкенд повторно шлёт идентичный `chat_update` —
   * `publishChatUpdate` зовётся из 13 мест бэка и прилетает КАЖДОМУ участнику
   * чата) — `patch` не публикуем вовсе. Раньше (main, chatsStore.applyChatMeta)
   * это давало бесплатно `reconcileEntity`/`reconcileById` (совпавший ответ
   * возвращает ИСХОДНЫЙ объект/массив); patch-путь владельца эту сверку не
   * делал и создавал новую ссылку на диалог/патчил зеркало (`chatsStore.ts`,
   * ветка `patch`: `{...d, ...op.fields}` МИМО `reconcileById`) при нулевом
   * изменении данных — лишний ре-рендер мемоизированного `ChatListItem`.
   * `equal()` — тот же структурный компаратор, что и в `reconcileEntity`.
   */
  function patchDialog(chatId: number, fields: Partial<Dialog>): void {
    const idx = items.findIndex((i) => i.dialog.chatId === chatId)
    if (idx === -1) return
    const prev = items[idx].dialog
    const dialog: Dialog = { ...prev, ...fields }
    if (equal(prev, dialog)) return
    const index = dialogIndex(dialog, pinnedOrder, draftFor(chatId))
    const moved = index !== items[idx].index
    items[idx] = { dialog, index }
    if (moved) items = [...items].sort((a, b) => b.index - a.index)
    publish([{ op: 'patch', chatId, fields, ...(moved ? { index } : {}) }])
  }

  // Расшифровать превью секретных чатов «на месте» (мутирует lastMessage
  // входящих диалогов) — порт `chatsStore.decryptSecretPreviews` (main, до
  // Task 6), но без RPC: секретный ключ знает `secretManager`, живущий в этом
  // же воркере. Диалог без encBody, с уже готовым text или не secret-типа —
  // no-op; упавшая дешифровка (ключ ещё не пришёл/битый) глотается, превью
  // остаётся generic-лейблом — как и раньше.
  async function decryptSecretPreviews(dialogs: Dialog[]): Promise<void> {
    if (!decryptSecret) return
    await Promise.all(dialogs.map(async (d) => {
      const lm = d.lastMessage
      if (d.type !== 'secret' || !lm?.encBody || lm.text) return
      const dec = await decryptSecret(d.chatId, lm.encBody).catch(() => null)
      if (!dec) return
      lm.text = dec.text
      if (!dec.text && dec.media) lm.mediaType = dec.media.mediaType
    }))
  }

  async function doHydrate(): Promise<void> {
    // Гварды поколения (Minor #4): чтение диска асинхронно, за это время могла
    // случиться смена сессии — тогда прочитанное принадлежит прошлому аккаунту.
    // Выходим, НЕ выставив `hydrated`: следующий вызов гидрирует заново, уже
    // под новым скоупом персиста.
    const gen = sessionGen
    const state = await loadState()
    if (gen !== sessionGen) return
    pinnedOrders = state.pinnedOrders
    pinnedOrder = pinnedOrders[ALL_FOLDER_ID] ?? []
    drafts = state.drafts
    if (!items.length) {
      const cached = await loadCache()
      await decryptSecretPreviews(cached)
      if (gen !== sessionGen) return
      setAll(cached)
    }
    hydrated = true
  }

  function hydrate(): Promise<void> {
    if (hydrated) return Promise.resolve()
    // `hydrating === p` в finally (а не безусловное обнуление): `resetForLogout()`
    // сбрасывает `hydrating` синхронно, и гидратация ПРОШЛОЙ сессии, дорезолвившись
    // позже, обнулила бы ссылку на уже начатую гидратацию НОВОЙ — третий
    // конкурентный вызов начал бы её заново (тот же класс гонки, что закрыт
    // кэшированием промиса вместо булева флага, см. докблок `hydrating`).
    const p = (hydrating ??= doHydrate().finally(() => { if (hydrating === p) hydrating = null }))
    return p
  }

  return {
    /**
     * Зеркало объявило пробел. Отвечаем ВСЕГДА — и ответом RPC (его ждёт boot.ts
     * до первого рендера), и веером (соседние вкладки). «Уже публиковали» не
     * считается доставкой: SuperMessagePort кадры не буферизует.
     *
     * `announce`, а не `publish` (Important #4, отложенная мелочь): значения
     * только что прочитаны с диска — планировать обратную запись на тот же диск
     * бессмысленно.
     */
    async fillMirror(): Promise<DialogOp> {
      const gen = sessionGen
      await hydrate()
      // Сессия сменилась, пока читали диск (Minor #4): ответ прошлого аккаунта
      // ни рассылать, ни отдавать спросившему нельзя — отдаём честно пустой.
      if (gen !== sessionGen) return { op: 'reset', items: [] }
      const op: DialogOp = { op: 'reset', items }
      announce([op])
      return op
    },

    /**
     * Сетевой догон. Офлайн — молча остаёмся на кэше (как прежний listDialogs).
     *
     * Fix (финальное ревью, Important #2): возвращает ОПУБЛИКОВАННУЮ операцию
     * (или `null`, если применять нечего). Единственным каналом доставки был
     * бродкаст `rt:dialog_op`, а насос `smp.on(...)` поднимается лишь в
     * `startRealtime()` из эффекта `useAppBootstrap` — ПОСЛЕ первого рендера;
     * `SuperMessagePort` кадры не буферизует, поэтому ответ `/chats`, пришедший
     * раньше подписки (localhost/быстрая сеть — обычное дело), уходил в никуда,
     * и вкладка жила весь сеанс на дисковом кэше. Правило то же, что у
     * `fillMirror`: пробел закрывает ОТВЕТ RPC, а не следующий бродкаст;
     * повторное применение через бродкаст идемпотентно.
     */
    async refresh(): Promise<DialogOp | null> {
      const gen = sessionGen
      await hydrate()
      try {
        const r = await rest.get<{ chats?: RawDialog[] }>('/chats')
        const dialogs = (r.chats ?? []).map(mapDialog)
        await decryptSecretPreviews(dialogs)
        // Ответ отправлен под ПРОШЛЫМ токеном (Minor #4) — не применяем.
        if (gen !== sessionGen) return null
        const op = setAll(dialogs)
        // Ответ совпал с памятью — ни операции, ни записи на диск (Important #4).
        if (op) publish([op])
        return op
      } catch (e) {
        if (e instanceof HttpError) throw e
        return null
      }
    },

    getSnapshot: (): DialogItem[] => items,

    /**
     * Task 5, «Осторожно» (смена аккаунта/логаут): гасит ОЖИДАЮЩИЙ таймер
     * (см. scheduleSave), пока он ещё не выстрелил, — экономит заведомо
     * бессмысленную запись устаревших диалогов (действие, чей REST-ответ
     * прилетел уже после логаута, успело бы запланировать саму запись, но не
     * успело её исполнить). Зовётся из workerCore.ts (onLoggingOut/
     * onLoggedIn) тем же приёмом, что `media.resetToken`/`resetDownloads` —
     * синхронно, ДО broadcast намерения перехода.
     *
     * Важно НЕ приписывать этому методу защиту от гонки «таймер уже
     * выстрелил, `saveDialogs()` в полёте (после `await locked()`, уже внутри
     * `enqueue()`), и тут приходит `persistClearAll()`» — от неё
     * `cancelPersist()` не защищает и защищать не должен: к этому моменту
     * отменять уже нечего. Гарантию даёт СУЩЕСТВУЮЩИЙ (до Task 5) механизм
     * `core/store/persist.ts`: `persistClearAll()` физически недостижим из
     * воркера иначе как через два кросс-контекстных RPC-раунда (воркер →
     * `broadcast(RT.loggingOut)` → main `useAuthGate.ts` →
     * `managers.persist.clearAll()` обратно в воркер) — на порядки медленнее
     * пары микротасков внутри самого воркера; а `enqueue()` того же стора
     * (`persist.ts`) батчит операции и открывает IndexedDB-транзакции В
     * ПОРЯДКЕ ВЫЗОВА, а IndexedDB исполняет readwrite-транзакции одного стора
     * в порядке их СОЗДАНИЯ, а не завершения (порядок фиксирует и комментарий
     * у `persistManager.clearAll`: «clear сериализуется после любых
     * накопленных воркером записей», актуален с до-Task-5 времён). Поэтому
     * `enqueue()` клира физически не может опередить уже вызванный `enqueue()`
     * записи диалогов — клир гарантированно ляжет ПОСЛЕ устаревшей записи, и
     * `cancelPersist()` тут ни при чём.
     *
     * Полный сброс самого кэша (`items`/`hydrated`) на логаут — `resetForLogout()`
     * ниже, отдельный метод (Task 6).
     */
    cancelPersist(): void {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    },

    /**
     * Task 6 (пины владения, приоритетная находка ревью Task 5): полный сброс
     * in-memory кэша владельца на логауте/смене аккаунта. `dialogsManager`
     * живёт в SharedWorker, который переживает `location.reload()` отдельной
     * вкладки, пока жива хотя бы одна другая, — без этого сброса `items`/
     * `hydrated` пережили бы логаут, и следующий `fillMirror()` (уже под ДРУГИМ
     * вошедшим пользователем) отдал бы готовый `items` вместо честной
     * регидратации с диска нового аккаунта — чужой список диалогов на экране.
     *
     * `items = []` обязателен, а не только `hydrated = false`: `doHydrate()`
     * перечитывает кэш с диска ТОЛЬКО когда `!items.length` (см. выше) — при
     * непустом `items` он молча оставил бы старые данные, даже сбросив флаг.
     * `pinnedOrders`/`pinnedOrder`/`drafts` тоже перезапишет ближайший
     * `doHydrate()` (он их читает безусловно), но обнуляем и здесь — с момента
     * `resetForLogout()` до следующего `fillMirror()`/`refresh()` кэш обязан
     * быть честно пуст, а не хранить обрывки прошлой сессии на случай, если
     * что-то дёрнет владельца в этом окне (напр. запоздавший realtime-кадр).
     *
     * Вызывается РЯДОМ с `cancelPersist()` — тем же приёмом, что
     * `media.resetToken()`/`resetDownloads()` (workerCore.ts, onLoggingOut/
     * onLoggedIn): каждый владелец сбрасывает СВОЙ кэш сам, отдельным вызовом.
     */
    resetForLogout(): void {
      // Minor #4: всё, что уже улетело под прошлым токеном (чтение диска в
      // doHydrate, ответ /chats в refresh), обязано осечься перед применением —
      // см. докблок sessionGen.
      sessionGen++
      items = []
      pinnedOrders = {}
      pinnedOrder = []
      drafts = []
      hydrated = false
      hydrating = null
    },

    /**
     * Ключ State, от которого зависит порядок, изменился (пишет persistManager).
     * Значения диалогов те же — публикуем reindex, а не reset.
     *
     * И по той же причине — `announce`, а не `publish` (Important #4): на диск
     * (`S_DIALOGS`) уезжают только значения диалогов, а они не изменились;
     * новый порядок целиком выводится из State-ключей, у которых свой писатель.
     */
    setStateKey(key: string, value: unknown): void {
      if (key === 'pinnedOrders') {
        pinnedOrders = value as Record<number, number[]>
        pinnedOrder = pinnedOrders[ALL_FOLDER_ID] ?? []
      } else if (key === 'drafts') drafts = value as Draft[]
      else return
      items = sort(items.map((i) => i.dialog))
      announce([{ op: 'reindex', items: items.map((i) => ({ chatId: i.dialog.chatId, index: i.index })) }])
    },

    // ── Task 3: realtime-кадры применяет владелец ────────────────────────────
    // Тела перенесены из chatsStore КАК ЕСТЬ (fallback `unread ?? +1`,
    // идемпотентность `applyRead`, абсолютный снимок `chat_update`); меняется
    // только выход — вместо `set({dialogs})` публикуем `patch`/`remove`.

    /** Новое сообщение (live `new_message`) поднимает диалог и бампит превью/unread. */
    applyNewMessage(e: NewMessageEvt): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return // unknown chat (приедет на следующей reset-загрузке)
      const meId = getMeId?.() ?? null
      // Wave 3: сервер шлёт авторитетный unread получателям — берём verbatim; локальный
      // +1 остаётся fallback (старый бэк без поля). Своё же эхо (sender_id===meId,
      // включая другие вкладки/устройства) бейдж не бампит — у отправителя поле
      // `unread` в кадре и не приходит (backend message.go: `if uid != in.SenderID`).
      //
      // Отступление от прежнего main-кода (chatsStore.applyNewMessage): там ещё
      // проверялся `activeChatId`, чтобы не бампить бейдж для открытого на ЭТОЙ
      // вкладке чата. Воркер общий на все вкладки и какая из них что смотрит —
      // не знает; `activeChatId` — эфемерика, остаётся на main (докблок
      // ChatsState.activeChatId, спека docs/superpowers/specs/2026-08-12-
      // dialogs-ownership-and-virtual-list-design.md, «Что остаётся на main»).
      // Блип бейджа для открытого чата гасит немедленный markRead активной вкладки.
      const incoming = e.sender_id !== meId
      const nextUnread = incoming ? (e.unread ?? cur.unread + 1) : cur.unread
      patchDialog(e.chat_id, {
        lastMessage: {
          seq: e.seq,
          text: e.text,
          senderId: e.sender_id,
          at: e.created_at,
          mediaId: e.media_id ?? undefined,
          mediaType: e.type || undefined,
          senderName: e.sender_name || undefined,
          forwarded: e.fwd_from_user_id != null || e.fwd_from_chat_id != null || undefined,
        },
        unread: nextUnread,
      })
    },

    /** `read` — моё прочтение гасит unread/горизонт, чужое двигает peerReadSeq (✓✓). */
    applyRead(e: ReadEvt, meId: number | null): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return
      if (e.user_id === meId) {
        // Wave 3: авторитетный unread из кадра verbatim (обычно 0); локальный =0 — fallback.
        const unread = e.unread ?? 0
        const lastReadSeq = Math.max(cur.lastReadSeq, e.up_to_seq)
        // Идемпотентность: повторное эхо того же прочтения (up_to_seq ≤ горизонта,
        // unread уже 0) НЕ публикует операцию — иначе на зеркале перезапустится
        // mark-read-эффект (деп win.msgs) и получится бесконечный цикл ре-рендера.
        if (unread === cur.unread && cur.unreadMentions === 0 && cur.unreadReactions === 0 && lastReadSeq === cur.lastReadSeq) return
        patchDialog(e.chat_id, { unread, unreadMentions: 0, unreadReactions: 0, lastReadSeq })
      } else {
        // the OTHER side read my messages → advance the peer horizon (out ticks → ✓✓)
        const peerReadSeq = Math.max(cur.peerReadSeq, e.up_to_seq)
        if (peerReadSeq === cur.peerReadSeq) return // no advance → no-op (без операции)
        patchDialog(e.chat_id, { peerReadSeq })
      }
    },

    // Бэкенд шлёт в `chat_update` АБСОЛЮТНЫЙ снимок метаданных чата
    // (backend/internal/usecase/chat/chat_update.go:18-42) — сливаем его в
    // существующий диалог, в сеть за списком не ходим.
    applyChatMeta(e: ChatUpdateEvt): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return // чата нет в списке — приедет со следующей загрузкой
      // Пишем только те поля, что реально пришли в снимке: '' и null — это
      // «сброшено» (снимок абсолютный), отсутствие ключа — «не про это событие».
      const fields: Partial<Dialog> = {
        ...(e.title !== undefined && { title: e.title }),
        // username кладём verbatim — ровно как маппинг ответа /chats (models.ts:675).
        ...(e.username !== undefined && { username: e.username }),
        ...(e.photo_media_id !== undefined && {
          // Тот же путь, что отдаёт /chats (backend chatsrepo.go:190) — НЕ готовый
          // URL с медиа-токеном: токен живёт ~15 минут, в долгоживущую модель его класть нельзя.
          photoUrl: e.photo_media_id === null ? undefined : `/media/${e.photo_media_id}/content`,
        }),
      }
      patchDialog(e.chat_id, fields)
    },

    // Кто-то поставил реакцию на МОЁ сообщение → бампим бейдж непрочитанных
    // реакций диалога (Telegram unread_reactions_count). Сброс — на applyRead.
    bumpUnreadReactions(chatId: number, count?: number): void {
      const cur = findDialog(chatId)
      if (!cur) return
      // Авторитетный счётчик из кадра (reaction.unread_reactions) — verbatim, как
      // unread у new_message/read; локальный +1 — fallback, если поля нет.
      const value = typeof count === 'number' ? count : (cur.unreadReactions ?? 0) + 1
      patchDialog(chatId, { unreadReactions: value })
    },

    // Меня удалили из группы / вышел сам (chat_removed) — диалог исчезает из списка.
    applyRemoved(chatId: number): void {
      const idx = items.findIndex((i) => i.dialog.chatId === chatId)
      if (idx === -1) return // не было в кэше — нечего убирать
      items = items.filter((i) => i.dialog.chatId !== chatId)
      publish([{ op: 'remove', chatId }])
    },

    // ── Task 4 (действия без оптимистики) ─────────────────────────────────────
    // Порт tweb: `invokeApi(...).then(saveUpdate)` — сеть уже подтвердила, ЗАТЕМ
    // применяем. Сетевые менеджеры (groupsManager/chatThemesManager) зовут эти
    // методы ПОСЛЕ успешного REST-ответа; при ошибке они не зовутся вовсе — см.
    // dialogsManager.test.ts «RPC упал — ни одной операции».

    /** Пер-чатовый mute (messages.setMute) — то же поле, что и realtime-эхо dialog_mute. */
    applyMute(chatId: number, muted: boolean): void {
      patchDialog(chatId, { muted })
    },

    /** В архив / из архива — пин сбрасывается (как на бэке, group_settings.go). */
    applyArchived(chatId: number, archived: boolean): void {
      patchDialog(chatId, { archived, pinned: false })
    },

    /** Тема оформления чата (messages.setChatTheme) — пустая строка сбрасывает к дефолту. */
    applyTheme(chatId: number, themeId: string): void {
      patchDialog(chatId, { themeId: themeId || undefined })
    },

    /**
     * Пин/анпин двигает и ПОРЯДОК: свежий пин встаёт первым (порт tweb
     * `order.unshift`, dialogs.ts:934), анпин выпадает из порядка. Порядок
     * закреплённых — общий State-ключ на весь список (см. докблок ALL_FOLDER_ID
     * выше и прежний chatsStore.setDialogPinned, откуда перенесена логика).
     * Пишем на диск и рассылаем зеркало ключа тем же путём, что
     * `persistManager.stateKey` (`saveStateKey` + `mirrorStateKey` в
     * workerCore.ts) — второй писатель того же ключа не заводится.
     *
     * Fix (ревью Task 4, Critical): пин/анпин — ФАКТ (булево поле диалога), а не
     * команда «переставь». `order.unshift` оправдан только при РЕАЛЬНОМ переходе
     * `pinned` false↔true; повторный/запоздавший кадр того же уже применённого
     * факта (собственное WS-эхо — бэкенд шлёт `dialog_pin` на ВСЕ соединения
     * пользователя, включая инициировавшее: `backend/internal/adapter/delivery/
     * ws/hub.go:203-209`, во фрейме нет id соединения, фильтровать нечем) не
     * должен трогать уже устоявшийся `pinnedOrder` — иначе чат, запиненный
     * РАНЬШЕ, задним числом обгоняет чат, запиненный ПОЗЖЕ (порядок событий:
     * apply(1,true) → apply(2,true) → запоздавшее эхо apply(1,true) снова
     * бросало бы 1 на вершину, ломая [2,1,…] обратно на [1,2,…]). Гвард —
     * ровно та же идея, что `equal()` в `patchDialog`: нечего менять — не
     * трогаем ни кэш, ни диск, ни зеркало.
     *
     * Отличимость от «легитимного перепина уже закреплённого чата» (чтобы
     * снова всплыть наверх): такого действия в продукте НЕТ — UI показывает
     * либо «Pin» у незакреплённого чата, либо «Unpin» у закреплённого
     * (`ChatListItem.tsx`: `chat.pinned ? 'Unpin' : 'Pin'`), кнопки «запинить
     * заново уже запиненный, чтобы поднять его» не существует ни у нас, ни в
     * tweb (порядок закреплённых меняется явным drag'ом, которого в этом
     * клиенте тоже нет). Единственный путь получить `applyPinned(id, true)` с
     * уже `pinned===true` — дубль/эхо ОДНОГО И ТОГО ЖЕ действия. Различить
     * «дубль» от «легитимного намерения поднять» по одним лишь текущим данным
     * (без монотонного номера действия в кадре) НЕЛЬЗЯ — если такая фича
     * появится, `dialog_pin` придётся снабдить версией/меткой времени.
     */
    applyPinned(chatId: number, pinned: boolean): void {
      const idx = items.findIndex((i) => i.dialog.chatId === chatId)
      if (idx === -1) return
      const cur = items[idx].dialog
      if (cur.pinned === pinned) return // факт уже применён — не переставляем и не пишем повторно
      const others = pinnedOrder.filter((id) => id !== chatId)
      pinnedOrder = pinned ? [chatId, ...others] : others
      pinnedOrders = { ...pinnedOrders, [ALL_FOLDER_ID]: pinnedOrder }
      void savePinnedOrders?.(pinnedOrders)
      mirrorStateKey?.('pinnedOrders', pinnedOrders)
      const dialog: Dialog = { ...cur, pinned }
      items = sort(items.map((i) => (i.dialog.chatId === chatId ? dialog : i.dialog)))
      publish([
        { op: 'patch', chatId, fields: { pinned } },
        { op: 'reindex', items: items.map((i) => ({ chatId: i.dialog.chatId, index: i.index })) },
      ])
    },
  }
}
export type DialogsManager = ReturnType<typeof newDialogsManager>
