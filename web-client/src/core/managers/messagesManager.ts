// src/core/managers/messagesManager.ts
import { HttpError, type RestClient } from '../net/restClient'

/**
 * `messages.searchResultsCalendar` — календарь медиа контейнером.
 *
 * Ячейку дня наполняет САМО СООБЩЕНИЕ из `messages`, а превью рисуется из его
 * `media` — так делает оригинал (`datePicker.tsx:437-444`), и `periods` он не
 * читает вовсе. Прежде здесь был тип `CalendarDay` с выжимкой
 * `{media_id, type, has_thumb}` — вторым снимком того же медиа.
 *
 * `periods` объявлены, потому что они есть на проводе (обязательный вектор
 * конструктора), а не потому что нужны экрану: границы дней пригодятся, когда
 * появится листание календаря назад.
 */
export interface MessagesSearchResultsCalendar {
  _: 'messages.searchResultsCalendar'
  count: number
  min_date: number
  min_msg_id: number
  periods: { _: 'searchResultsCalendarPeriod'; date: number; min_msg_id: number; max_msg_id: number; count: number }[]
  messages: RawMyMessage[]
  users: UserReal[]
}
import { getThreadRootId, mapMyMessage, type MyMessage, type MessageReal, type MessageEntity, type RawMyMessage, type SecretMedia } from '../models'
import { getPeerId, type Peer } from '../peers/peerId'
import type { UserReal, Chat } from '../peers/peer'
import { generateMessageId, getServerMessageId } from '../history/messageId'
import type { NewMessageEvt, EditMessageEvt, DeleteMessageEvt, GeoLiveUpdateEvt, WebPageUpdateEvt, FactCheckUpdateEvt, MediaReadEvt, PaidMediaUnlockEvt, SendMessageAction } from '../realtime/events'
import type { SendArgs as WireSendArgs } from '../realtime/connectionManager'
import type { UploadArgs } from './mediaManager'
import { RT } from '../realtime/events'
import type { MessageOp } from '../realtime/messageOps'
import SlicedArray, { SliceEnd } from '../history/slicedArray'
import { saveMessageMedia } from '../media/messageMedia'
import { saveMessages, loadMessages, deletePersistedMessage } from '../store/persist'
import { newPollMethods } from './messages/pollMethods'
import { newTranslationMethods } from './messages/translationMethods'
import { newPendingMethods } from './messages/pending'
import { sendingParamsToWire, type MessageSendingParams } from './messages/sendingParams'
import { newReactionMethods } from './messages/reactionMethods'
// Реакционные типы переехали в reactionMethods — реэкспорт для стабильности
// импортов (StarReactionPopup, SavedTagsPanel и др. берут их отсюда).
export type { ReactionUser, SavedTag, StarSender, StarReactionInfo, StarReactionResult } from './messages/reactionMethods'

/**
 * messages.Messages — контейнер списка сообщений (обе формы объединения).
 *
 * `_` различает «отдано ВСЁ» (`messages.messages`) и «отдан кусок»
 * (`messages.messagesSlice`, у него есть `count`). Признаков «дошли до
 * верха/низа» у контейнера нет вовсе: их выводит клиент из самого окна —
 * порт `appMessagesManager.ts:9512-9518`.
 *
 * `users` — карточки авторов пачки: получатель списка обязан уметь нарисовать
 * подпись, ни о ком не спрашивая отдельно.
 */
export interface MessagesContainer {
  _: 'messages.messages' | 'messages.messagesSlice'
  messages: RawMyMessage[]
  users: UserReal[]
  chats: Chat[]
  count?: number
}

export interface HistoryArgs {
  peerId: number
  /** опорный НОМЕР (клиентское пространство); 0 — самое новое */
  offsetId?: number
  addOffset?: number // >0 older (inclusive), <=0 newer
  limit?: number
  /** окно треда (форум-топик / комментарии): номер корневого сообщения */
  threadRoot?: number
}

export interface HistoryResult {
  messages: MyMessage[] // ascending (oldest-first) for top→bottom rendering
  count: number // rows returned by the last fetch (or cached count)
  reachedTop: boolean
  reachedBottom: boolean
  cached?: boolean // served synchronously from the in-memory cache (no network)
}

export interface SendArgs {
  peerId: number
  text: string
  entities?: MessageEntity[] | null
  clientMsgId: string
  replyToId?: number | null
  /** кросс-чат ответ (tweb ReplyToAnotherChat): id исходного чата оригинала */
  replyToPeerId?: number | null
  mediaId?: number | null
  /** сообщение в тред (форум-топик): id корневого сообщения темы */
  threadRootId?: number | null
}

export interface MessagesDeps {
  rest: RestClient
  /** Расшифровка ciphertext секретного чата (ключи живут в secretManager воркера). */
  decryptSecret?: (peerId: number, encBody: string) => Promise<{ text: string; entities?: unknown[]; media?: SecretMedia } | null>
  /** id текущего пользователя — воркеру нужен, чтобы кэшировать `mine` реакций
   * (событие reaction несёт user_id реагирующего, а не флаг «моё») и чтобы
   * уточнять служебное действие до синтетического конструктора («Вы
   * присоединились» против «X присоединился», `refineMessageAction`).
   * Разрешается лениво (воркер зовёт /me), поэтому геттер, а не значение. */
  getMeId?: () => number | null
  /** Гейт «личность уже известна» (workerCore: гидрация `me` с диска / первый
   *  setMe). Сетевые пути, отдающие сообщения, ждут его ПЕРЕД маппингом:
   *  уточнение служебного действия сравнивает автора с `getMeId()`, а страница
   *  истории, обслуженная раньше ответа /me, уехала бы вкладке с чужой
   *  формулировкой пилюли. Опционален: юнит-тесты кэш-методов собирают менеджер
   *  одним `rest` — без гейта маппинг идёт сразу. */
  meReady?: () => Promise<void>
  /** Приёмник пиров, приехавших ПОПУТНО со списком сообщений (`users` контейнера
   *  messages.Messages) — тот же `saveApiPeers`, которым питаются диалоги и
   *  журнал звонков. Опционален по той же причине, что остальные инъекции. */
  peers?: { saveApiPeers(o: { users?: UserReal[]; chats?: Chat[] }): void }
  /** Порт `appPeersManager.isBroadcast(peerId)` для `generateFlags` (tweb
   *  appMessagesManager.ts:3128-3130) — см. `PendingCtx.isBroadcastChat`.
   *  Опционален по той же причине, что и остальные инъекции: юнит-тесты
   *  кэш-методов собирают менеджер одним `rest`. */
  isBroadcastChat?: (peerId: number) => boolean
  /** Эхо операций остальным вкладкам для RPC-путей, у которых нет WS-эха с тем же
   * эффектом (напр. deleteMessage: вкладка-инициатор чинит своё окно сама через
   * applyDelete, а остальным вкладкам операции нужно разослать отсюда). Опционален —
   * тесты кэш-методов (cacheX) его не используют. */
  broadcast?: (event: string, payload: unknown) => void
  /** ТРАНСПОРТ — ИНЪЕКЦИЕЙ, не импортом (workerCore подставляет
   * `conn.sendMessage`). В tweb ту же роль играет реестр `AppManagers`: менеджер
   * зовёт зависимость, полученную при сборке, поэтому кольца импортов
   * messagesManager ↔ connectionManager не возникает. */
  send?: (args: WireSendArgs) => void
  /** Отгрузка байтов медиа (mediaManager.upload) — её владеет `sendFile`. */
  upload?: (a: UploadArgs) => Promise<number>
  /** Оборвать активный аплоад по progressId (=clientMsgId). */
  cancelUpload?: (progressId: string) => void
  /** «Отправляет фото/файл…» на время аплоада (conn.sendTyping). */
  sendTyping?: (peerId: number, action: SendMessageAction) => void
  /** Прогресс аплоада вкладкам (media:upload_progress). */
  uploadProgress?: (id: string, loaded: number, total: number, done?: boolean) => void
}

export function newMessagesManager({ rest, decryptSecret, getMeId, meReady, isBroadcastChat, broadcast, send, upload, cancelUpload, sendTyping, uploadProgress, peers }: MessagesDeps) {
  // ── Граница маппинга ────────────────────────────────────────────────────────
  // `pFlags.out` производит СЕРВЕР (решение Р7 разбора отменено): после порта у
  // сообщения от лица канала автором на проводе становится сам канал, и прежней
  // формулы клиента «автор это я» вывести стало не из чего. Здесь остались
  // перевод номеров в клиентское пространство и уточнение служебного действия —
  // и то и другое делает `mapMyMessage`.
  const mapOne = (r: RawMyMessage): MyMessage => mapMyMessage(r, getMeId?.() ?? null)
  // Гейт личности (см. `meReady` в MessagesDeps) — ждут его СЕТЕВЫЕ пути.
  // `cacheLive`/`insertPending` синхронны и ждать не могут: живой кадр приходит
  // по уже поднятому WS, а неотправленный бабл заводит сам пользователь — оба
  // заведомо позже гидрации `me`, которая стартует в `workerCore.start()` до
  // подключения сокета.
  const whenMeReady = meReady ?? (() => Promise.resolve())
  const mapPage = async (list: RawMyMessage[] | undefined): Promise<MyMessage[]> => {
    await whenMeReady()
    return (list ?? []).map(mapOne)
  }
  /**
   * Контейнер messages.Messages → страница сообщений.
   *
   * Пиры, приехавшие ПОПУТНО, публикуются ДО отдачи страницы: подпись автора
   * рисуется из карточки, и вкладка, получившая сообщения раньше карточек,
   * показала бы бабл без имени. Порядок тот же, что у диалогов.
   */
  const mapContainer = async (c: MessagesContainer): Promise<MyMessage[]> => {
    if (c.users?.length || c.chats?.length) peers?.saveApiPeers({ users: c.users, chats: c.chats })
    return mapPage(c.messages)
  }
  const mapNet = async (r: RawMyMessage): Promise<MyMessage> => {
    await whenMeReady()
    return mapOne(r)
  }
  // История секретного чата приходит с REST как enc_body + пустой текст —
  // расшифровываем страницу до отдачи в UI. Без ключа текст остаётся пустым, но
  // secret:true проставлен (UI покажет плейсхолдер). Живые сообщения
  // дешифруются в workerCore.ts.
  async function decryptPage(list: MyMessage[]): Promise<MyMessage[]> {
    if (!decryptSecret) return list
    return Promise.all(list.map(async (m) => {
      if (m._ !== 'message' || !m.enc_body) return m
      const dec = await decryptSecret(m.peerId, m.enc_body)
      return dec
        ? { ...m, message: dec.text, entities: (dec.entities as MessageReal['entities']) ?? m.entities, secret: true, secretMedia: dec.media ?? m.secretMedia }
        : { ...m, secret: true }
    }))
  }
  // Кэш истории ключуется чатом ИЛИ тредом чата ("peerId" / "peerId:root") —
  // окно топика/комментариев живёт отдельным срезом (tweb: history по threadId).
  // SSOT сообщений воркера: ОДНА копия сообщения на (чат, seq). Окна/треды —
  // это списки seq в `slices`, ссылающиеся в эту единую Map (как в tweb:
  // messagesStorageByPeerId + history: SlicedArray<mid>). Раньше кэш ключевался
  // по окну, и тред-сообщение дублировало объект между основным окном и окном
  // треда; живые апдейты приходилось раскатывать по всем окнам (keysOf).
  const slices = new Map<string, SlicedArray<number>>()
  const msgsByChat = new Map<number, Map<number, MyMessage>>()
  const hkey = (peerId: number, threadRoot?: number | null): string =>
    threadRoot ? `${peerId}:${threadRoot}` : String(peerId)
  // Ключи-ОКНА чата (основное + треды) — для операций над срезами (slices).
  const winKeysOf = (peerId: number): string[] =>
    [...slices.keys()].filter((k) => k === String(peerId) || k.startsWith(`${peerId}:`))

  const sliceFor = (key: string): SlicedArray<number> => {
    let sa = slices.get(key)
    if (!sa) { sa = new SlicedArray<number>(); slices.set(key, sa) }
    return sa
  }
  // peerId из ключа истории ("peerId" / "peerId:root") — для персиста по чату.
  const peerIdOf = (key: string): number => parseInt(key, 10)
  // Единая по чату Map сообщений (SSOT воркера). Все окна чата читают/пишут сюда.
  const msgsFor = (peerId: number): Map<number, MyMessage> => {
    let c = msgsByChat.get(peerId)
    if (!c) { c = new Map(); msgsByChat.set(peerId, c) }
    return c
  }
  // Совместимость: сайты истории оперируют «кэшем окна» — теперь это единая
  // по чату Map (окно определяется срезом `slices`, а не отдельной Map).
  const cacheFor = (key: string): Map<number, MyMessage> => msgsFor(peerIdOf(key))
  const put = (key: string, msgs: MyMessage[]) => {
    const c = msgsFor(peerIdOf(key))
    for (const m of msgs) c.set(m.id, m)
    // Write-through в офлайн-стор: put — единственный путь входа/обновления
    // сообщений в SSOT (страницы истории, отправка, live, пересылка, правки),
    // поэтому персист здесь покрывает их все.
    if (msgs.length) void saveMessages(peerIdOf(key), msgs)
  }
  // Точечно обновить одно сообщение чата в SSOT + персист. Идентичность — ОДНО
  // число, поэтому чаще всего хватает прямого доступа по ключу; `match` остаётся
  // ради обновлений, адресованных не номером, а вложенным объектом (опрос,
  // чек-лист, розыгрыш — у них свои id).
  const patchMsg = (peerId: number, match: (m: MyMessage) => boolean, upd: (m: MyMessage) => MyMessage | null): void => {
    const c = msgsByChat.get(peerId)
    if (!c) return
    for (const [id, m] of c) {
      if (!match(m)) continue
      const n = upd(m) // null — применять нечего (идемпотентное эхо своего действия)
      if (n === null) return
      c.set(id, n)
      void saveMessages(peerId, [n])
      return
    }
  }
  // Удалить сообщение из SSOT + снять его номер из всех окон-срезов чата +
  // персист. Прежде здесь стоял ПОЛНЫЙ СКАН по Map: метод принимал глобальный
  // ключ строки, а Map ключевалась номером в чате, и одно приходилось переводить
  // в другое. Числа свелись к одному — перевода больше нет.
  const evictMsg = (peerId: number, msgId: number): void => {
    const c = msgsByChat.get(peerId)
    if (!c?.delete(msgId)) return
    for (const k of winKeysOf(peerId)) slices.get(k)?.delete(msgId)
    void deletePersistedMessage(peerId, msgId)
  }
  // Ключи ВСЕХ окон чата (основное + треды), где сообщение сейчас видно (его
  // номер есть в срезе) — нужно операциям patch/remove (Stage 1B.3, Task 3).
  // Важный нюанс: patchMsg выше мутирует ОДНУ копию в единой SSOT-Map чата, а
  // сторный patchChat переигрывает мутацию по ВСЕМ окнам чата (основному и
  // тредам) — без этого перечисления операция дошла бы только до одного окна.
  const opWindowsFor = (peerId: number, msgId: number): string[] => {
    if (!msgsByChat.get(peerId)?.has(msgId)) return []
    return winKeysOf(peerId).filter((k) => slices.get(k)?.findSlice(msgId))
  }
  // Удаление сообщения → remove-операции по всем окнам, где оно было видно.
  // Общая точка входа для WS-пути (cacheDelete, funnel воркера) и RPC-пути
  // (deleteMessage, эта же вкладка удалила): обе обязаны вычислить ключи окон ДО
  // evictMsg — после эвикции seq уже выкинут из срезов, opWindowsFor не найдёт
  // ничего (Regression 2, финальное ревью feat/remaining-ops: deleteMessage звал
  // evictMsg напрямую и терял ops для остальных вкладок).
  const evictAndBuildRemoveOps = (peerId: number, msgId: number): MessageOp[] => {
    const keys = opWindowsFor(peerId, msgId)
    evictMsg(peerId, msgId)
    return keys.map((key): MessageOp => ({ op: 'remove', key, msgId }))
  }

  // Оптимистика в SSOT воркера (для переоткрытия чата до серверного эха): apply-хелперы
  // реакций/чек-листов живут в под-модулях. main-стор двигают клиентские вызыватели/
  // хуки, серверные WS-эхо приходят через funnel и реконсилят абсолютно.

  // Под-модули God-объекта (P1-6): опросы/чек-листы/розыгрыши, перевод/транскрипция и
  // реакции/теги/⭐ выделены в отдельные файлы, спредятся сюда — публичный API
  // messages.* не меняется.
  // readMsg — чтение одного сообщения из SSOT. Нужно там, где решение зависит
  // от УЖЕ ИЗВЕСТНОГО состояния, а не от содержимого кадра: кадр реакций несёт
  // абсолютный агрегат без пер-зрительской части, и «выросло ли число реакций
  // на МОЁМ сообщении» отвечает только владелец окна.
  const readMsg = (peerId: number, msgId: number): MyMessage | undefined => msgsByChat.get(peerId)?.get(msgId)
  const ctx = { rest, patchMsg, getMeId, opWindowsFor, readMsg, peers }
  // Локальной ссылкой (а не только спредом ниже) — её зовёт cacheLive, чтобы эхо
  // своей отправки убирало временный бабл из SSOT (порт tweb checkPendingMessage).
  const pending = newPendingMethods({
    hkey, slices, msgsFor,
    getMeId: () => getMeId?.() ?? null,
    isBroadcastChat: (peerId) => isBroadcastChat?.(peerId) ?? false,
    emit: (ops) => { if (ops.length) broadcast?.(RT.messageOp, { ops }) },
    // Заглушки-по-умолчанию — для юнит-тестов кэш-методов, которые собирают
    // менеджер одним лишь `rest`; в воркере все четыре подставляет workerCore
    // (пин проводки — core/workerCore.send.test.ts).
    send: send ?? (() => {}),
    upload: upload ?? (() => Promise.reject(new Error('messages: upload не подключён'))),
    cancelUpload: cancelUpload ?? (() => {}),
    sendTyping: sendTyping ?? (() => {}),
    uploadProgress: uploadProgress ?? (() => {}),
  })

  return {
    ...newReactionMethods(ctx),
    ...newPollMethods(ctx),
    ...newTranslationMethods(ctx),
    // Жизненный цикл неотправленного сообщения (порт формы tweb
    // appMessagesManager) — ему нужны не точечные хелперы, а сама структура
    // хранилища: временный бабл живёт в том же SSOT и в том же срезе окна, что и
    // настоящие, как `messagesStorage` + `historyStorage.history` в оригинале.
    // Поэтому у него свой ctx, а не общий MessagesCtx.
    ...pending,

    /**
     * Положить в SSOT сообщения, приехавшие ПОПУТНО с чужим ответом, — вектор
     * `messages` контейнера `messages.dialogs` (`GET /chats`). Порт
     * `appMessagesManager.saveMessages`: в оригинале КАЖДЫЙ ответ прогоняется
     * через сохранение сообщений, и только поэтому ссылка `dialog.top_message`
     * вообще разрешается.
     *
     * Окон (`slices`) НЕ трогает — это разные вещи и в оригинале тоже:
     * `messagesStorage` хранит объекты, `historyStorage.history` — списки id
     * открытого окна. Сообщение закрытого чата обязано лежать в хранилище, но
     * не создавать окна.
     *
     * Секретные расшифровываются тем же `decryptPage`, что и страница истории:
     * ключ живёт в этом же воркере, второй копии правила не заводим.
     */
    async saveApiMessages(list: RawMyMessage[] | undefined): Promise<MyMessage[]> {
      const mapped = await decryptPage(await mapPage(list))
      const byPeer = new Map<number, MyMessage[]>()
      for (const m of mapped) {
        const arr = byPeer.get(m.peerId)
        if (arr) arr.push(m)
        else byPeer.set(m.peerId, [m])
      }
      for (const [peerId, msgs] of byPeer) put(String(peerId), msgs)
      return mapped
    },

    /**
     * Порт `appMessagesManager.getMessageByPeer` (`:3588`) — сообщение чата по
     * его номеру. У оригинала номер это `mid`, у нас `seq`: `msgsByChat`
     * ключуется именно им, и `dialog.top_message` едет с бэкенда тем же seq
     * (`dialogscontainer.go` — `byID[d.TopMessageID].Seq`).
     *
     * Синхронный: разрешение ссылки `top_message` идёт по УЖЕ положенному в
     * SSOT (см. `saveApiMessages` выше), а не ходит в сеть.
     */
    getMessageByPeer(peerId: number, seq: number): MyMessage | undefined {
      return seq ? msgsByChat.get(peerId)?.get(seq) : undefined
    },

    async getHistory(args: HistoryArgs): Promise<HistoryResult> {
      const { peerId, offsetId = 0, addOffset = 0, limit = 40, threadRoot } = args
      const key = hkey(peerId, threadRoot)
      const sa = sliceFor(key)
      const c = cacheFor(key)

      // --- cache check (mirrors tweb appMessagesManager.getHistory) ---
      const have = sa.sliceMe(offsetId, addOffset, limit)
      const pagingOlder = addOffset > 0
      const pagingNewer = addOffset <= 0 && offsetId !== 0
      const cacheHit =
        have &&
        (have.slice.length >= limit ||
          (have.fulfilled & SliceEnd.Both) === SliceEnd.Both ||
          (pagingOlder && (have.fulfilled & SliceEnd.Top) === SliceEnd.Top) ||
          ((pagingNewer || offsetId === 0) && (have.fulfilled & SliceEnd.Bottom) === SliceEnd.Bottom))

      if (cacheHit && have) {
        const seqsDesc = Array.from(have.slice) // descending
        const msgs = seqsDesc.map((s) => c.get(s)).filter((m): m is MyMessage => !!m)
        const asc = msgs.slice().reverse()
        // reachedTop/Bottom must reflect the REAL ends of history, not `fulfilled`
        // (which only means the requested page had enough cached rows). Using
        // `fulfilled` here made a re-opened chat report reachedTop=true whenever
        // ≥limit messages were cached, which disabled scroll-up paging.
        return {
          messages: asc,
          count: asc.length,
          reachedTop: have.slice.isEnd(SliceEnd.Top),
          reachedBottom: have.slice.isEnd(SliceEnd.Bottom),
          cached: true,
        }
      }

      // --- network fetch ---
      let r: MessagesContainer
      try {
        r = await rest.get<MessagesContainer>(
          `/chats/${peerId}/history`,
          // ГРАНИЦА: наружу уходят СЕРВЕРНЫЕ номера. Ноль означает «самое новое»
          // и остаётся нулём — приведение идемпотентно.
          { offset_id: getServerMessageId(offsetId), add_offset: addOffset, limit, ...(threadRoot ? { thread_root: getServerMessageId(threadRoot) } : {}) },
        )
      } catch (e) {
        // Сеть недоступна (fetch reject, не HttpError): отдаём персистнутую историю
        // основного окна чата (тред офлайн не поднимаем — его срез не хранится
        // отдельно). Сидим кэш+срез напрямую (минуя put, чтобы не перезаписывать).
        if (!(e instanceof HttpError) && !threadRoot) {
          // Гейта `me` здесь НЕТ, и это не упущение: ветка ничего не выводит из
          // личности. Раньше выводила — пересчитывала `out`, потому что бэкенд
          // флага не отдавал; теперь `pFlags.out` производит СЕРВЕР (решение Р7
          // отменено), и пересчитывать нечего. `await whenMeReady()` тут стал бы
          // строкой, удаление которой не красит ни одного теста и ничего не
          // ломает, — такую держать нельзя.
          //
          // НАЗВАННЫЙ ОСТАТОК (не этого шага): всё, что зависит от того, КТО
          // смотрит, — и `pFlags.out`, и уточнённое служебное действие
          // (`refineMessageAction`) — сохраняется на диск вместе с сессией, а
          // офлайн-стор её переживает. Чинится это не пересчётом отдельных
          // полей при чтении (уточнённое действие обратно в серверное уже не
          // разворачивается), а тем, чтобы история прошлого аккаунта на диске
          // не оставалась: `persist.clearAll` в useAuthGate срабатывает только
          // при migrateTo === null.
          const persisted = await loadMessages(peerId)
          if (persisted.length) {
            for (const m of persisted) c.set(m.id, m)
            const seqsDesc = persisted.map((m) => m.id).sort((a, b) => b - a)
            const inserted = sa.insertSlice(seqsDesc)
            if (inserted) inserted.setEnd(SliceEnd.Bottom) // низ = последнее известное
            return { messages: persisted.slice(), count: persisted.length, reachedTop: false, reachedBottom: true, cached: true }
          }
        }
        throw e
      }
      const fetched = await decryptPage(await mapContainer(r))
      put(key, fetched)

      // normalize to descending seqs for the SlicedArray
      const seqsDesc = fetched.map((m) => m.id).sort((a, b) => b - a)
      const inserted = seqsDesc.length ? sa.insertSlice(seqsDesc) : sa.first

      // end detection: a short page means we hit the end in the paging direction.
      // NOTE: the backend's `count` is the chat TOTAL, not the page size — so end
      // detection must use the number of rows actually returned, not r.count.
      const short = fetched.length < limit
      let reachedTop = false
      let reachedBottom = false
      if (inserted) {
        if (offsetId === 0) {
          inserted.setEnd(SliceEnd.Bottom) // newest page always includes the bottom
          reachedBottom = true
          if (short) { inserted.setEnd(SliceEnd.Top); reachedTop = true }
        } else if (pagingOlder && short) {
          inserted.setEnd(SliceEnd.Top); reachedTop = true
        } else if (pagingNewer && short) {
          inserted.setEnd(SliceEnd.Bottom); reachedBottom = true
        }
      }

      // return ascending; for an older fetch we filter out the inclusive overlap
      // (caller passes offsetId=oldestLoaded with addOffset=1)
      let asc = fetched.slice().sort((a, b) => a.id - b.id)
      if (pagingOlder) asc = asc.filter((m) => m.id < offsetId)

      // `count` есть только у страницы (messages.messagesSlice). Пришёл полный
      // набор — считать нечего: его размер и есть длина вектора.
      return { messages: asc, count: r.count ?? fetched.length, reachedTop, reachedBottom, cached: false }
    },

    async sendMessage(args: SendArgs): Promise<MyMessage> {
      const created = await rest.post<RawMyMessage>(`/chats/${args.peerId}/messages`, {
        type: 'text',
        text: args.text,
        entities: args.entities ?? null,
        client_msg_id: args.clientMsgId,
        // ГРАНИЦА: номера, уходящие на сервер, приводятся к серверным.
        reply_to_id: args.replyToId != null ? getServerMessageId(args.replyToId) : null,
        reply_to_peer_id: args.replyToPeerId ?? null,
        media_id: args.mediaId ?? null,
        thread_root_id: args.threadRootId != null ? getServerMessageId(args.threadRootId) : null,
      })
      const m = await mapNet(created)
      const root = getThreadRootId(m)
      // Кладём и в основное окно чата, и в окно треда (если это тред-сообщение).
      for (const key of root ? [hkey(args.peerId), hkey(args.peerId, root)] : [hkey(args.peerId)]) {
        put(key, [m])
        const sa = sliceFor(key)
        // a sent message is the newest — push to the bottom end if we hold it
        if (sa.first.isEnd(SliceEnd.Bottom) && !sa.findSlice(m.id)) sa.unshift(m.id)
      }
      return m
    },

    // Edit a message's text (author only, server-enforced). Returns the updated
    // message and refreshes the cache entry.
    async editMessage(peerId: number, msgId: number, text: string, entities?: MessageEntity[]): Promise<MyMessage> {
      const updated = await rest.patch<RawMyMessage>(`/chats/${peerId}/messages/${getServerMessageId(msgId)}`, { text, entities: entities ?? null })
      const m = await mapNet(updated)
      // upsert правки в SSOT (только если сообщение уже загружено в чат).
      if (msgsFor(peerId).has(m.id)) put(hkey(peerId), [m])
      return m
    },

    // «Проверка фактов» (Telegram editFactCheck): прикрепить/изменить блок на
    // сообщении канала (право проверяет бэк — автор/админ канала). Возвращает
    // обновлённое сообщение и патчит SSOT.
    async setFactCheck(peerId: number, msgId: number, text: string, entities?: MessageEntity[], country?: string): Promise<MyMessage> {
      const updated = await rest.post<RawMyMessage>(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/factcheck`, {
        text, entities: entities ?? null, country: country ?? '',
      })
      const m = await mapNet(updated)
      if (msgsFor(peerId).has(m.id)) put(hkey(peerId), [m])
      // main-стор обновит вызыватель (applyFactCheck); WS factcheck_update реконсилит.
      return m
    },

    // Снять «проверку фактов» (Telegram deleteFactCheck). Патчит SSOT + эхо.
    async removeFactCheck(peerId: number, msgId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/factcheck`)
      patchMsg(peerId, (m) => m.id === msgId, (m) => ({ ...m, factCheck: undefined }))
      // main-стор обновит вызыватель (applyFactCheck); WS factcheck_update реконсилит.
    },

    // Delete a message. revoke=true → for everyone; false → only for me. Deleted
    // messages are never shown, so evict from the SSOT (+ all window slices) too,
    // or a later cache hit would resurrect it.
    async deleteMessage(peerId: number, msgId: number, revoke: boolean): Promise<void> {
      // После УСПЕХА сети: eviction из SSOT + рассылка remove-операций остальным
      // вкладкам (Regression 2, финальное ревью feat/remaining-ops: [RT.deleteMessage]
      // убран из реестра APPLY проектора — окно правит только applyOps, а WS
      // delete_message придёт по уже опустевшему SSOT воркера и cacheDelete отдаст
      // пустой список, если не разослать ops здесь). Вкладка-инициатор чинит своё
      // окно сама (useMessageActions → applyDelete), поэтому себе не шлём. Не
      // оптимистично до REST: сервер может отклонить удаление (напр. «для всех»
      // после окна времени), а откат eviction+persist сложен и рисковен —
      // мгновенность удаления тут не критична (tweb-компромисс).
      await rest.del(`/chats/${peerId}/messages/${getServerMessageId(msgId)}?revoke=${revoke ? 'true' : 'false'}`)
      const ops = evictAndBuildRemoveOps(peerId, msgId)
      if (ops.length) broadcast?.(RT.messageOp, { ops })
    },

    // Forward messages from one chat into another; returns the created copies.
    // dropAuthor — скрыть отправителя (копия как своё сообщение), dropCaption —
    // убрать подпись у пересылаемого медиа (tweb dropAuthor/dropCaptions).
    async forwardMessages(
      toPeerId: number,
      fromPeerId: number,
      msgIds: number[],
      opts?: { dropAuthor?: boolean; dropCaption?: boolean },
    ): Promise<MyMessage[]> {
      const r = await rest.post<MessagesContainer>(`/chats/${toPeerId}/forward`, {
        from_peer_id: fromPeerId,
        msg_ids: msgIds.map(getServerMessageId),
        drop_author: opts?.dropAuthor ?? false,
        drop_caption: opts?.dropCaption ?? false,
      })
      const msgs = await mapContainer(r)
      put(hkey(toPeerId), msgs)
      return msgs
    },

    async pin(peerId: number, msgId: number): Promise<void> {
      await rest.post(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/pin`, {})
    },

    async unpin(peerId: number, msgId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/pin`)
    },

    async listPins(peerId: number): Promise<MyMessage[]> {
      const r = await rest.get<MessagesContainer>(`/chats/${peerId}/pins`)
      return decryptPage(await mapContainer(r))
    },

    // Jump-to-message: load a window centered on centerSeq and RESET this chat's
    // slice/cache to it (so loadOlder/loadNewer continue from the jumped spot).
    async getAround(peerId: number, centerId: number, limit = 40, threadRoot?: number): Promise<{ messages: MyMessage[]; reachedTop: boolean; reachedBottom: boolean }> {
      const r = await rest.get<MessagesContainer>(
        `/chats/${peerId}/history`, { around: getServerMessageId(centerId), limit, ...(threadRoot ? { thread_root: getServerMessageId(threadRoot) } : {}) },
      )
      const asc = await decryptPage(await mapContainer(r))
      // Концы окна выводит КЛИЕНТ — их в ответе нет вовсе. Правило оригинала для
      // случая без `offset_id_offset` (appMessagesManager.ts:9512-9518): сторона
      // короче запрошенной значит, что за ней ничего нет.
      //
      // Сколько просили с каждой стороны — та же арифметика, что у сервера при
      // сборке окна: верхняя половина ВКЛЮЧАЕТ центр.
      const wantOlder = Math.floor(limit / 2) + 1
      const olderLoaded = asc.filter((m) => m.id <= centerId).length
      const reachedTop = olderLoaded < wantOlder
      const reachedBottom = asc.length - olderLoaded < limit - wantOlder
      const key = hkey(peerId, threadRoot)
      const sa = new SlicedArray<number>()
      slices.set(key, sa)
      const c = cacheFor(key)
      for (const m of asc) c.set(m.id, m)
      void saveMessages(peerId, asc) // офлайн-персист окна jump-to-message
      const seqsDesc = asc.map((m) => m.id).sort((a, b) => b - a)
      const inserted = seqsDesc.length ? sa.insertSlice(seqsDesc) : sa.first
      if (inserted) {
        if (reachedTop) inserted.setEnd(SliceEnd.Top)
        if (reachedBottom) inserted.setEnd(SliceEnd.Bottom)
      }
      return { messages: asc, reachedTop, reachedBottom }
    },

    // Search messages in a chat by text (newest first) + total match count.
    // Шаред-медиа профиля (табы Media/Files/Links/Music/Voice) — история чата
    // одного типа, новые сверху (tweb inputMessagesFilter*).
    async mediaHistory(peerId: number, filter: 'media' | 'files' | 'links' | 'music' | 'voice', offset = 0, limit = 30): Promise<{ messages: MyMessage[]; count: number }> {
      const r = await rest.get<MessagesContainer>(`/chats/${peerId}/media`, { filter, offset, limit })
      return { messages: await mapContainer(r), count: r.count ?? 0 }
    },

    // Поиск в чате: текст + необязательные фильтры (tweb topbarSearch) —
    // senderId (в группах), mediaType (photo/video/voice/roundvideo/file/link/music),
    // reaction (эмодзи). Пустой q при заданном фильтре допустим.
    async searchMessages(
      peerId: number,
      q: string,
      opts: { senderId?: number; mediaType?: string; reaction?: string; offset?: number; limit?: number } = {},
    ): Promise<{ messages: MyMessage[]; count: number }> {
      const query: Record<string, string | number> = { q, offset: opts.offset ?? 0, limit: opts.limit ?? 20 }
      if (opts.senderId) query.sender_id = opts.senderId
      if (opts.mediaType) query.media_type = opts.mediaType
      if (opts.reaction) query.reaction = opts.reaction
      const r = await rest.get<MessagesContainer>(`/chats/${peerId}/search`, query)
      return { messages: await mapContainer(r), count: r.count ?? 0 }
    },

    // Jump-to-date: НОМЕР ближайшего сообщения на/после даты (unix, сек). null,
    // если сообщений в чате нет (404). Ответ серверный — переводим на границе.
    async messageByDate(peerId: number, date: number): Promise<number | null> {
      try {
        // Ответ — САМ номер: обёртки `{id: …}` у него больше нет.
        const r = await rest.get<number>(`/chats/${peerId}/message_by_date`, { date })
        return generateMessageId(r)
      } catch {
        return null
      }
    },

    // Медиа-превью по дням месяца для пикера даты (tweb
    // getSearchResultsCalendar): month — любой unix-момент внутри месяца.
    //
    // Возвращаются САМИ сообщения, а не выжимка медиа: ячейку дня оригинал
    // наполняет объектом сообщения и рисует превью из `message.media`
    // (`datePicker.tsx:437-444`), вектор `periods` не читая. Прежде сервер
    // отдавал `{media_id, type, has_thumb}` — второй, урезанный снимок того же
    // медиа рядом с настоящим.
    async calendarMonth(peerId: number, month: number): Promise<MyMessage[]> {
      try {
        const r = await rest.get<MessagesSearchResultsCalendar>(`/chats/${peerId}/calendar`, { month })
        return (r?.messages ?? []).map(mapOne)
      } catch {
        return [] // календарь работает и без миниатюр
      }
    },

    // Глобальный поиск по сообщениям всех чатов (сайдбар-поиск): q — текст,
    // filter сужает по типу шаред-медиа ('' — любой тип, q обязателен).
    async searchGlobal(q: string, filter: '' | 'media' | 'files' | 'links' | 'music' | 'voice' = '', offset = 0, limit = 20): Promise<{ messages: MyMessage[]; count: number }> {
      const r = await rest.get<MessagesContainer>('/search/messages', { q, filter, offset, limit })
      return { messages: await mapContainer(r), count: r.count ?? 0 }
    },

    // Сообщения треда (форум-топика) по возрастанию + total.
    async threadMessages(peerId: number, rootId: number, offset = 0, limit = 50): Promise<{ messages: MyMessage[]; count: number }> {
      const r = await rest.get<MessagesContainer>(`/chats/${peerId}/threads/${getServerMessageId(rootId)}`, { offset, limit })
      return { messages: await decryptPage(await mapContainer(r)), count: r.count ?? 0 }
    },

    // ── Запланированные сообщения (Telegram scheduled) ──
    //
    // Собственной проводной формы у отложенного больше НЕТ: сервер отдаёт тот же
    // конструктор `message` с клиентским флагом `pFlags.is_scheduled` и нашими
    // параметрами `send_at`/`when_online` — ровно как у оригинала, где
    // отложенные едут вектором `messages.Message`.
    //
    // Идентичность у них СВОЯ: номера в чате отложенное ещё не получило (он
    // назначается при отправке), поэтому `id` здесь — ключ строки
    // `scheduled_messages`, а адрес — `/chats/{peerID}/scheduled/{schedID}`.
    // Клиентское пространство при этом ОБЩЕЕ (`generateMessageId` применяется на
    // границе разбора ко всему), значит и обратно оно приводится тем же
    // `getServerMessageId`.
    //
    // whenOnline (tweb Schedule.SendWhenOnline): очередь ждёт появления
    // собеседника в сети — send_at игнорируется бэком (только приватный чат).
    async scheduleMessage(peerId: number, p: { text: string; entities?: MessageEntity[]; sendAt: number; replyToId?: number; whenOnline?: boolean }): Promise<MyMessage> {
      const r = await rest.post<RawMyMessage>(`/chats/${peerId}/scheduled`, {
        type: 'text', text: p.text, entities: p.entities ?? null,
        reply_to_id: p.replyToId != null ? getServerMessageId(p.replyToId) : null, send_at: p.sendAt,
        when_online: p.whenOnline ?? false,
      })
      return mapNet(r)
    },
    // Отложенные едут ТЕМ ЖЕ контейнером, что история: набор отдан целиком,
    // поэтому `messages.messages`. Карточка автора приезжает вектором `users`
    // и публикуется до отдачи страницы — как у любого другого контейнера.
    async listScheduled(peerId: number): Promise<MyMessage[]> {
      return mapContainer(await rest.get<MessagesContainer>(`/chats/${peerId}/scheduled`))
    },
    async deleteScheduled(peerId: number, id: number): Promise<void> {
      await rest.del(`/chats/${peerId}/scheduled/${getServerMessageId(id)}`)
    },
    // Перепланировать (tweb MessageScheduleEditTime): сменить время отправки.
    // Сброс when_online делает бэк (появляется конкретная дата).
    async editScheduled(peerId: number, id: number, sendAt: number): Promise<MyMessage> {
      const r = await rest.patch<RawMyMessage>(`/chats/${peerId}/scheduled/${getServerMessageId(id)}`, { send_at: sendAt })
      return mapNet(r)
    },
    // Отправить запланированное немедленно; возвращает созданное сообщение.
    async sendScheduledNow(peerId: number, id: number): Promise<MyMessage> {
      const r = await rest.post<RawMyMessage>(`/chats/${peerId}/scheduled/${getServerMessageId(id)}/send_now`, {})
      return mapNet(r)
    },

    // Кто сейчас в видеочате группы (для баннера Join).
    //
    // Участник приезжает ССЫЛКОЙ `peerUser`, а не голым ключом: контейнера
    // `phone.groupCall` у нас нет и быть не может (звонок — P2P-mesh без
    // объекта звонка и без SSRC, см. хендлер), но адресация перенимается у
    // оригинала. Знаковый ключ выводится из конструктора, как везде.
    async groupCallParticipants(peerId: number): Promise<number[]> {
      const r = (await rest.get<Peer[]>(`/chats/${peerId}/group_call`)) ?? []
      return r.map(getPeerId)
    },

    async viewers(peerId: number, msgId: number): Promise<number[]> {
      // Ответ — ВЕКТОР объявленных строк `readParticipantDate`, а не голые
      // числа под именем поля. Даты прочтения сервер не хранит (задача #59).
      const r = await rest.get<{ _: 'readParticipantDate'; user_id: number }[]>(
        `/chats/${peerId}/messages/${getServerMessageId(msgId)}/viewers`)
      return (r ?? []).map((v) => v.user_id)
    },

    // Live-фрейм new_message → кэш истории (в чат-ключ и, для тред-сообщения,
    // в ключ треда). Без этого переоткрытие чата/треда попадало в устаревший
    // кэш-срез без свежих сообщений (свои комментарии «пропадали» до F5).
    // Помимо мутации SSOT возвращает MessageOp[] — по одной операции 'insert' на
    // затронутое окно (Stage 1B.2, Task 3): воркер зеркалит их проектору главного
    // потока (routeNewMessage → RT.messageOp), тот переигрывает поверх стора вместо
    // самостоятельного разбора кадра.
    cacheLive(evt: NewMessageEvt): MessageOp[] {
      // Отдельного маппера live-кадра (`fromNewMessageEvt`) больше НЕТ и быть не
      // может: кадр несёт сообщение ЦЕЛИКОМ под ключом `message` — тот же
      // конструктор, что и витрина (решение Р5). Прежде это была вторая проводная
      // форма и второй маппер к ней, и расходились они в обе стороны.
      // Дыра в кадре `new_message` невозможна по построению (сервер объявляет
      // появление сообщения, а не его отсутствие), но объединение это допускает —
      // отвечаем ПУСТЫМ списком операций, а не молчаливой подстановкой.
      if (evt.message._ === 'messageEmpty') return []
      const m = mapOne(evt.message)
      // Порт tweb checkPendingMessage: эхо СВОЕЙ отправки несёт random_id —
      // временный бабл уходит из SSOT воркера ДО вставки настоящего. Иначе в
      // хранилище остались бы два объекта, и переоткрытие чата показало бы
      // «отправляется…» рядом с уже отправленным. Слияние полей (random_id,
      // localUrl, secret) делает потребитель — messageOps.insert.
      pending.checkPendingMessage(m.random_id)
      const root = getThreadRootId(m)
      const keys = root ? [hkey(m.peerId), hkey(m.peerId, root)] : [hkey(m.peerId)]
      const ops: MessageOp[] = []
      for (const key of keys) {
        // Только в срез, уже державший низ истории — иначе позиция неизвестна.
        // Тот же гейт решает, породится ли операция: пропущенное здесь окно не
        // должно получить вставку и на главном потоке — иначе представления
        // разъедутся (ради устранения этого расхождения и вводится replay).
        const sa = slices.get(key)
        if (!sa || !sa.first.isEnd(SliceEnd.Bottom)) continue
        put(key, [m])
        if (!sa.findSlice(m.id)) sa.unshift(m.id)
        ops.push({ op: 'insert', key, msg: m })
      }
      return ops
    },

    // Live-правка от любого участника → единый объект в SSOT.
    // Stage 1B.3 (Task 3): НЕ переведено на операции — но уже не из-за пробела в
    // cacheEdit (тот чинили отдельно: reply_markup теперь кладётся сюда же тем же
    // правилом, что и на витрине — значение кадра при наличии поля, снятие
    // клавиатуры при его отсутствии, backend/internal/usecase/chat/frame.go:243
    // шлёт поле абсолютным значением). Других обогащений у edit_message нет, так что
    // структурных препятствий к переводу на patch не осталось — перевод остаётся
    // отдельной задачей (вне объёма этой), а не решением проблемы с данными.
    // Кадр несёт сообщение ЦЕЛИКОМ (форма updateEditMessage), поэтому и в SSOT
    // кладётся целое — тем же маппером, что и у живого кадра с новым
    // сообщением. Прежде здесь собирался патч из россыпи полей конверта, и
    // список этих полей был вторым описанием того, что вообще может меняться
    // правкой.
    cacheEdit(evt: EditMessageEvt): void {
      const mapped = mapOne(evt.message)
      const peerId = getPeerId(evt.message.peer_id)
      patchMsg(peerId, (m) => m.id === mapped.id, () => mapped)
    },

    // Live-обновление координат гео-трансляции → SSOT.
    // Stage 1B.3 (Task 3): НЕ переведено на операции — сознательно. geo_live_update
    // классифицирован в eventCatalog.ts как 'ephemeral' (без pts), поэтому идёт
    // мимо funnel/APPLY воркера напрямую в PASS_THROUGH — cacheGeoLive НИКОГДА не
    // вызывается (мёртвый код уже сегодня, независимо от этой задачи). Единственный
    // применяющий путь — сырой кадр в storeProjection (RT.geoLiveUpdate → applyGeoLive).
    // Перевод на операции потребовал бы структурного решения за рамками этой
    // задачи (переклассифицировать тип в 'logged', завести pts на бэке) — оставлено
    // как есть; и cache, и проекция не тронуты.
    cacheGeoLive(evt: GeoLiveUpdateEvt): void {
      const id = generateMessageId(evt.id)
      // Координаты приезжают ТЕМ ЖЕ конструктором, что и в сообщении, — кладём
      // вложение целиком. Время обновления едет рядом (edit_date) и ложится в
      // то же поле, что и у обычной правки: своего времени у гео в схеме нет.
      const media = saveMessageMedia(evt.media)
      patchMsg(evt.peer_id, (m) => m.id === id,
        (m) => (m._ !== 'message' ? m : { ...m, media, edit_date: evt.edit_date }))
    },

    // Догоняющее серверное превью ссылки → SSOT. Возвращает MessageOp[] — по одной
    // операции 'patch' на каждое окно чата, где сообщение видно (Stage 1B.3, Task 3).
    //
    // Карточка приезжает КОНСТРУКТОРОМ и кладётся как есть — переводить нечего:
    // форма кадра и форма модели совпали. Через `saveMessageMedia` она всё
    // равно проходит, как любое вложение с провода: это ОДНА граница разбора, а
    // не «нормализация там, где сегодня нужна».
    cacheWebPage(evt: WebPageUpdateEvt): MessageOp[] {
      const media = saveMessageMedia(evt.media)
      const peerId = getPeerId(evt.peer)
      const id = generateMessageId(evt.msg_id)
      patchMsg(peerId, (m) => m.id === id, (m) => (m._ !== 'message' ? m : { ...m, media }))
      return opWindowsFor(peerId, id).map((key): MessageOp => ({ op: 'patch', key, msgId: id, fields: { media } }))
    },

    // «Проверка фактов» прикреплена/изменена/снята → SSOT + операции по всем окнам.
    cacheFactCheck(evt: FactCheckUpdateEvt): MessageOp[] {
      // «Сняли» — ОТСУТСТВИЕ параметра в кадре; в модели окна это undefined.
      const factcheck = evt.factcheck
      const peerId = getPeerId(evt.peer)
      const id = generateMessageId(evt.msg_id)
      patchMsg(peerId, (m) => m.id === id, (m) => (m._ !== 'message' ? m : { ...m, factcheck }))
      return opWindowsFor(peerId, id).map((key): MessageOp => ({ op: 'patch', key, msgId: id, fields: { factcheck } }))
    },

    // Платное медиа разблокировано: раскрываем баббл в SSOT — возвращаем ссылку на
    // контент + метаданные и снимаем флаг locked. Операции несут только эти поля
    // (не полный объект — см. карту обогащений); сторный applyPaidUnlock, резавший
    // те же поля вручную, стал недостижим и удалён (Task 6).
    cachePaidUnlock(evt: PaidMediaUnlockEvt): MessageOp[] {
      const id = generateMessageId(evt.msg_id)
      const peerId = getPeerId(evt.peer)
      // Кадр несёт РОВНО предмет — вектор позиций, ставших настоящими вместо
      // заглушек. Прежде на разблокировку одного вложения приезжала вторая
      // копия ВСЕГО сообщения, и вложение доставали из неё.
      //
      // Цену (`stars_amount`) кадр не несёт и не должен: она свойство самого
      // платного вложения, которое у сообщения уже есть, — меняется только
      // содержимое вектора. Поэтому обёртку собираем из ТЕКУЩЕЙ у сообщения, а
      // не подменяем целиком.
      let fields: Partial<MessageReal> | null = null
      patchMsg(peerId, (m) => m.id === id, (m) => {
        if (m._ !== 'message' || m.media?._ !== 'messageMediaPaidMedia') return m
        // Нормализуем тем же `saveMessageMedia`, что и на границе маппинга: он
        // заходит внутрь обёртки, иначе у вложенного документа не было бы
        // выведенного типа.
        fields = { media: saveMessageMedia({ ...m.media, extended_media: evt.extended_media }) }
        return { ...m, ...fields }
      })
      if (!fields) return []
      const patched = fields as Partial<MessageReal>
      return opWindowsFor(peerId, id).map((key): MessageOp => ({ op: 'patch', key, msgId: id, fields: patched }))
    },

    // Номера едут ВЕКТОРОМ: у оригинала одно действие снимает сразу пачку, и
    // форма кадра это допускает, даже когда сервер пока шлёт по одному.
    cacheDelete(evt: DeleteMessageEvt): MessageOp[] {
      const peerId = getPeerId(evt.peer)
      return evt.messages.flatMap((id) => evictAndBuildRemoveOps(peerId, generateMessageId(id)))
    },

    // Голосовое/кружок прослушано → точка media_unread гаснет. Без кэша переоткрытие
    // чата из кэша возвращало точку (P0-1). matched — тот же гейт, что у patchMsg
    // (уже прочитанное сообщение не патчим и операцию на него не порождаем).
    cacheMediaRead(evt: MediaReadEvt): MessageOp[] {
      let matched = false
      const peerId = getPeerId(evt.peer)
      const id = generateMessageId(evt.messages[0])
      // «Ещё не прослушано» — булев флаг СХЕМЫ (`pFlags.media_unread`), а не
      // отдельное поле рядом; «прослушано» значит ОТСУТСТВИЕ ключа.
      const pFlags = (m: MyMessage): MyMessage['pFlags'] => {
        const next = { ...m.pFlags }
        delete next.media_unread
        return next
      }
      patchMsg(peerId, (m) => m.id === id && !!m.pFlags.media_unread, (m) => { matched = true; return { ...m, pFlags: pFlags(m) } })
      if (!matched) return []
      const cur = msgsByChat.get(peerId)?.get(id)
      const fields = cur ? { pFlags: cur.pFlags } : {}
      return opWindowsFor(peerId, id).map((key): MessageOp => ({ op: 'patch', key, msgId: id, fields }))
    },

    // Live location: отправить начальную точку трансляции по REST (нужен msgId,
    // чтобы затем слать обновления). Бабл появится WS-эхом new_message.
    // Пакет параметров тот же, что у остальных путей (порт tweb: `sendOther`
    // принимает `MessageSendingParams` наравне с `sendText`/`sendFile`); из него
    // REST `/chats/{id}/messages` понимает ответ+цитату, тред и send-as —
    // `silent`/`effect` этот эндпоинт не принимает (`sendBody`,
    // backend/internal/adapter/delivery/http/chat_handler.go:338), их несёт
    // только WS-кадр.
    async sendGeoLive(peerId: number, lat: number, lng: number, livePeriod: number, heading: number | undefined, params: MessageSendingParams): Promise<MyMessage> {
      const wire = sendingParamsToWire(params)
      const created = await rest.post<RawMyMessage>(`/chats/${peerId}/messages`, {
        type: 'geo', text: '', geo_lat: lat, geo_lng: lng,
        geo_live_period: livePeriod, geo_heading: heading ?? null, client_msg_id: '',
        reply_to_id: wire.replyToId, reply_quote_text: wire.replyQuoteText,
        reply_quote_offset: wire.replyQuoteOffset, thread_root_id: wire.threadRootId,
        send_as_peer_id: wire.sendAsPeerId,
      })
      const m = await mapNet(created)
      put(hkey(peerId), [m])
      const sa = sliceFor(hkey(peerId))
      if (sa.first.isEnd(SliceEnd.Bottom) && !sa.findSlice(m.id)) sa.unshift(m.id)
      return m
    },

    // Live location: обновить координаты (или остановить трансляцию stopped=true).
    async updateGeoLive(peerId: number, msgId: number, lat: number, lng: number, opts?: { heading?: number; stopped?: boolean }): Promise<MyMessage> {
      const r = await rest.post<RawMyMessage>(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/geo_live`, {
        lat, lng, heading: opts?.heading ?? null, stopped: opts?.stopped ?? false,
      })
      const m = await mapNet(r)
      if (msgsFor(peerId).has(m.id)) put(hkey(peerId), [m])
      return m
    },

  }
}

export type MessagesManager = ReturnType<typeof newMessagesManager>
