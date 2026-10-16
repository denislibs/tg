// Движок групповых звонков (видеочатов): mesh WebRTC — по RTCPeerConnection на
// каждого удалённого участника, сигналинг через WS-реле (group_call_join /
// group_call_leave / group_call_signal, бэк переадресует адресату и фанит
// join/leave членам чата фреймом group_call_update).
//
// НОВИЧОК шлёт офферы всем, кто уже в звонке (их список отдаёт GET /chats/{id}/group_call
// перед join). Сидящий отвечает и, если у него есть дорожки, которым в offer новичка не нашлось
// m-строки (камера), шлёт свой offer (Г3). Камера посреди звонка — renegotiation. Offer и answer
// сопоставляются номером обмена (exchange_id), как у tweb (Г2).
// Mute/камера — track.enabled + media_state внутри group_call_signal.
import { toastNew } from '@components/toast'
import { useGroupCallStore } from '../../stores/groupCallStore'
import { useLivestreamStore } from '../../stores/livestreamStore'
import { useChatsStore } from '../../stores/chatsStore'
import { startClient } from '../../client/bootstrap'
import { hasTurnServer, iceServers, keepIceFresh } from './callEngine'

const sdpJSON = (d: RTCSessionDescription | null) => (d ? { type: d.type, sdp: d.sdp } : null)

const store = () => useGroupCallStore.getState()
const managers = () => startClient().managers

const pcs = new Map<number, RTCPeerConnection>()
// Соединение, которое ещё ждёт ICE-конфиг: второй offer того же участника берёт его же, а не
// создаёт второй pc с лишними TURN-аллокациями. Уход участника (closePeer) отменяет ожидание.
const pendingPcs = new Map<number, { promise: Promise<RTCPeerConnection | null>; cancelled: boolean }>()
// Кадры сигнала одного участника и наши offer ему — строго по очереди, как у tweb
// (callInstance.ts:904-941, :1568-1571 — цепочка processSignalingMessage): кандидаты новичка,
// пришедшие, пока сидящий берёт ICE-конфиг (/calls/ice), ждут за его offer, а не теряются без pc;
// второй offer ждёт конца первого; renegotiation не встревает между offer и answer.
const peerChains = new Map<number, Promise<void>>()
// Кандидаты для pc без remoteDescription (answer ещё не применён или отклонён) — до него, как
// tweb 'queue' (:2240-2255, :2315-2352) с тем же потолком (constants.ts:48).
const pendingCandidates = new Map<number, RTCIceCandidateInit[]>()
const MAX_PENDING_CANDIDATES = 256
// Операция закрытого посреди неё pc по спецификации не завершается никогда (Chromium оставляет
// промис висеть): каждую ждём вместе с «pc закрыт», который отклоняет closePeer.
const closers = new WeakMap<RTCPeerConnection, { closed: Promise<never>; close: () => void; isClosed: boolean }>()
class PcClosedError extends Error {}
// Обмены offer/answer соединения (tweb State.exchangeId, pendingLocalExchangeId,
// queuedRemoteNegotiation — callInstance.ts:126-128, :165). Номер уходит с offer и
// возвращается с answer: answer к заменённому offer (renegotiation до ответа на первый)
// не ложится на новый.
interface Negotiation {
  /** Счётчик наших offer этого pc. */
  exchangeId: number
  /** Номер нашего offer, ждущего answer. */
  pendingLocal?: number
  /** Встречный offer, отложенный невежливой стороной до answer на свой (tweb :2295-2302). */
  queuedRemote?: { sdp: RTCSessionDescriptionInit; exchangeId?: number }
}
const negotiations = new WeakMap<RTCPeerConnection, Negotiation>()
function negotiation(pc: RTCPeerConnection): Negotiation {
  let n = negotiations.get(pc)
  if (!n) negotiations.set(pc, n = { exchangeId: 0 })
  return n
}
const remoteStreams = new Map<number, MediaStream>()
let localStream: MediaStream | null = null
// Плановое обновление кредов TURN, пока мы в видеочате (К1).
let stopIceRefresh: (() => void) | null = null

export const getRemoteStream = (userId: number) => remoteStreams.get(userId)
export const getLocalStream = () => localStream

export interface GroupCallFrame {
  t: string
  d: {
    peer_id: number
    user_id?: number
    /** action = rejected: отказ по праву/политике (иначе сбой хранилища) */
    forbidden?: boolean
    action?: 'joined' | 'left' | 'rejected'
    participants?: number[]
    from_user_id?: number
    sdp?: RTCSessionDescriptionInit
    /** Номер обмена: у offer — счётчик отправителя, у answer — номер offer, на который он. */
    exchange_id?: number
    candidate?: RTCIceCandidateInit
    media_state?: { muted: boolean; video: boolean }
  }
}

// Поколение звонка: teardownCall его сдвигает, и newPc, ждавший iceServers() через
// отказ входа или выход, не кладёт соединение в уже убранный звонок.
let callGen = 0

async function newPc(userId: number, cancelled: () => boolean): Promise<RTCPeerConnection | null> {
  const gen = callGen
  const servers = await iceServers()
  if (gen !== callGen || cancelled()) return null
  // Сбой /calls/ice без живого кэша — только STUN: relay-pc не соберёт ни одного кандидата.
  if (!hasTurnServer(servers)) {
    console.error('[group call] no TURN server: relay-only pc cannot connect', userId)
    return null
  }
  // Только через TURN: у tweb групповой звонок ходит к SFU и IP участника видит один сервер, у нас
  // mesh, и прямые кандидаты раскрыли бы адрес каждому участнику (М3-2, Б-8).
  const pc = new RTCPeerConnection({ iceServers: servers, bundlePolicy: 'max-bundle', iceTransportPolicy: 'relay' })
  localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream!))
  pc.ontrack = (e) => {
    const stream = e.streams[0]
    if (stream) {
      remoteStreams.set(userId, stream)
      store().bumpStreams()
    }
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) signal(userId, { candidate: e.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') closePeer(userId)
  }
  let reject!: (e: Error) => void
  const closed = new Promise<never>((_, r) => { reject = r })
  closed.catch(() => { /* ждут его только вместе с операциями pc */ })
  const closer = { closed, isClosed: false, close: () => { closer.isClosed = true; reject(new PcClosedError()) } }
  closers.set(pc, closer)
  pcs.set(userId, pc)
  store().upsertParticipant({ userId, muted: false, videoOn: false })
  return pc
}

/** Соединение с участником: готовое, ждущее ICE-конфиг или новое. */
function ensurePc(userId: number): Promise<RTCPeerConnection | null> {
  const ready = pcs.get(userId)
  if (ready) return Promise.resolve(ready)
  const pending = pendingPcs.get(userId)
  if (pending) return pending.promise
  const entry = { promise: null as unknown as Promise<RTCPeerConnection | null>, cancelled: false }
  entry.promise = newPc(userId, () => entry.cancelled).finally(() => {
    if (pendingPcs.get(userId) === entry) pendingPcs.delete(userId)
  })
  pendingPcs.set(userId, entry)
  return entry.promise
}

/** Операция pc, которая отклоняется, если pc закрыли (closePeer) до или во время неё. */
function op<T>(pc: RTCPeerConnection, run: () => Promise<T>): Promise<T> {
  const c = closers.get(pc)
  if (!c || c.isClosed) return Promise.reject(new PcClosedError())
  return Promise.race([c.closed, run()])
}

/** Задача участника — в его очередь; задача прошлого звонка не выполняется; ошибка закрытого pc
 *  ожидаема и не шумит. Промис очереди не отклоняется. */
function enqueue(userId: number, task: () => Promise<void>): Promise<void> {
  const gen = callGen
  const next = (peerChains.get(userId) ?? Promise.resolve())
    .then(() => (gen === callGen ? task() : undefined))
    .catch((e: unknown) => {
      if (!(e instanceof PcClosedError)) console.error('[group call] signal failed', userId, e)
    })
  peerChains.set(userId, next)
  void next.finally(() => { if (peerChains.get(userId) === next) peerChains.delete(userId) })
  return next
}

/** Наш offer участнику (вход новичка, renegotiation) — в его очередь. */
function sendOffer(userId: number, makePc: boolean): Promise<void> {
  const gen = callGen
  return enqueue(userId, async () => {
    const pc = makePc ? await ensurePc(userId) : pcs.get(userId)
    if (!pc) return // звонок убран, участник ушёл или нет TURN
    try {
      await op(pc, async () => { await pc.setLocalDescription(await pc.createOffer()) })
    } catch (e) {
      if (!(e instanceof PcClosedError) && gen === callGen && pcs.get(userId) === pc) closePeer(userId)
      throw e
    }
    if (gen !== callGen) return // звонок убран, а может, уже идёт другой: старый offer не слать
    // повторный offer до answer на прошлый (JSEP разрешает) заменяет его: answer прошлого — мимо
    const n = negotiation(pc)
    n.pendingLocal = ++n.exchangeId
    signal(userId, { sdp: sdpJSON(pc.localDescription), exchange_id: n.pendingLocal })
  })
}

/** Есть отправитель, которому в согласованном описании не нашлось m-строки (JSEP: mid ещё нет). */
const hasUnnegotiatedSender = (pc: RTCPeerConnection) =>
  pc.getTransceivers().some((t) => t.sender.track && !t.mid)

/** Чужой offer: answer, а при встречном — разведение по вежливости (tweb :1755-1760, :2295-2305). */
async function acceptOffer(from: number, pc: RTCPeerConnection, sdp: RTCSessionDescriptionInit, exchangeId: number | undefined) {
  const n = negotiation(pc)
  let rolledBack = false
  if (pc.signalingState === 'have-local-offer') {
    // встречный offer (оба включили камеру). ОТСТУПЛЕНИЕ (ждёт согласования): у tweb вежлив
    // !isOutgoing, у mesh звонящего нет — вежлива сторона с большим id. Невежливая, как tweb
    // (:2295-2302), откладывает встречный offer до answer на свой; вежливая откатывает свой.
    if (!polite(from)) { n.queuedRemote = { sdp, exchangeId }; return }
    await op(pc, () => pc.setLocalDescription({ type: 'rollback' }))
    n.pendingLocal = undefined
    rolledBack = true
  }
  await op(pc, async () => {
    await pc.setRemoteDescription(sdp)
    await pc.setLocalDescription(await pc.createAnswer())
  })
  signal(from, { sdp: sdpJSON(pc.localDescription), exchange_id: exchangeId })
  await commitCandidates(from, pc)
  broadcastMediaState()
  // tweb :1836-1842, :1984-1991: ответившая сторона со своими дорожками шлёт свой offer. По JSEP —
  // если какому-то отправителю answer не дал m-строки (новичок вошёл без камеры, а у нас она есть)
  // или мы откатили свой offer: невежливая сторона применит его устаревшую копию из очереди, и
  // свежий offer её заменит.
  if (rolledBack || hasUnnegotiatedSender(pc)) void sendOffer(from, false)
}

async function addCandidate(pc: RTCPeerConnection, c: RTCIceCandidateInit) {
  await op(pc, () => pc.addIceCandidate(c)).catch(() => { /* закрыт или кандидат прошлой ICE-сессии */ })
}

/** Кандидаты, ждавшие remoteDescription, — в pc после применённого offer/answer. */
async function commitCandidates(userId: number, pc: RTCPeerConnection) {
  const queue = pendingCandidates.get(userId)
  if (!queue) return
  pendingCandidates.delete(userId)
  await Promise.all(queue.map((c) => addCandidate(pc, c)))
}

function signal(toUserId: number, data: Record<string, unknown>) {
  const peerId = store().peerId
  if (peerId == null) return
  void managers().realtime.sendCallFrame({
    type: 'group_call_signal',
    data: { ...data, peer_id: peerId, to_user_id: toUserId },
  })
}

function closePeer(userId: number) {
  const pending = pendingPcs.get(userId)
  if (pending) { pending.cancelled = true; pendingPcs.delete(userId) }
  const pc = pcs.get(userId)
  pcs.delete(userId)
  if (pc) { pc.close(); closers.get(pc)?.close() }
  pendingCandidates.delete(userId)
  remoteStreams.delete(userId)
  store().removeParticipant(userId)
  store().bumpStreams()
}

function broadcastMediaState() {
  const s = store()
  for (const userId of pcs.keys()) {
    signal(userId, { media_state: { muted: !s.micOn, video: s.camOn } })
  }
}

/** Войти в видеочат группы (создаёт его, если ещё не идёт). */
export async function joinGroupCall(peerId: number, withVideo = false) {
  if (store().peerId != null || store().connecting) return // уже в звонке или входим
  store().setConnecting(true)
  // Предел mesh (К3, domain.GroupCallMaxParticipants): в полный звонок не входим, не открывая окна
  // микрофона. Решает сервер (rejected), здесь — по известному списку; нет конфига — решит он.
  // У tweb отказа «звонок полон» нет (видеочат через SFU): тост — общий, как у отказа сервера.
  const { groupcall_video_participants_max: max } = await managers().appConfig.getAppConfig()
  const others = (store().activeByChat[peerId] ?? []).filter((id) => id !== useChatsStore.getState().meId)
  if (max != null && others.length >= max) {
    store().reset()
    toastNew({ langPackKey: 'Error.AnError' })
    return
  }
  // relay без TURN не соберёт ни одного кандидата: входим только при его наличии, а не молча
  // идём в обход на прямое соединение. До микрофона — окно разрешения зря не открываем.
  if (!hasTurnServer(await iceServers())) {
    console.error('[group call] no TURN server: relay-only mesh cannot connect')
    store().reset()
    return
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo })
  } catch {
    store().reset()
    return
  }
  const existing = await managers().messages.groupCallParticipants(peerId).catch(() => [] as number[])
  store().setJoined(peerId)
  store().setMedia(true, withVideo)
  stopIceRefresh = keepIceFresh()
  void managers().realtime.sendCallFrame({ type: 'group_call_join', data: { peer_id: peerId } })
  // новичок предлагает соединение каждому сидящему — параллельно: медленный или закрытый посреди
  // операции pc одного участника не задерживает остальных
  const meId = useChatsStore.getState().meId
  await Promise.all(existing.filter((userId) => userId !== meId).map((userId) => sendOffer(userId, true)))
  broadcastMediaState() // после уборки звонка pcs пуст — никому
}

/** Локальная уборка звонка: соединения, микрофон/камера, стор. Кадров не шлёт. */
function teardownCall() {
  callGen++
  stopIceRefresh?.()
  stopIceRefresh = null
  for (const userId of [...pcs.keys()]) closePeer(userId)
  for (const pending of pendingPcs.values()) pending.cancelled = true
  pendingPcs.clear()
  peerChains.clear()
  pendingCandidates.clear()
  localStream?.getTracks().forEach((t) => t.stop())
  localStream = null
  store().reset()
}

/** Выйти из видеочата. */
export function leaveGroupCall() {
  const peerId = store().peerId
  if (peerId == null) return
  void managers().realtime.sendCallFrame({ type: 'group_call_leave', data: { peer_id: peerId } })
  teardownCall()
}

/**
 * Сервер не пустил в видеочат (рядовой участник при пустом звонке, Б-9): мы уже
 * взяли микрофон и открыли экран звонка — откатываем локально, без
 * group_call_leave (мы в звонок не входили).
 */
function handleJoinRejected(peerId: number, forbidden: boolean) {
  const inCall = store().peerId === peerId
  const live = useLivestreamStore.getState()
  const watching = live.watchingPeerId === peerId
  if (!inCall && !watching) return // отказ запоздал: мы уже вышли
  if (inCall) teardownCall()
  if (watching) live.setWatching(null)
  // по праву — «Видеочат завершён» (tweb appImManager.ts:2369-2373, звонка нет и права нет)
  toastNew({ langPackKey: forbidden ? 'VoiceChat.Chat.Ended' : 'Error.AnError' })
}

export function toggleGroupMic() {
  const s = store()
  const next = !s.micOn
  localStream?.getAudioTracks().forEach((t) => { t.enabled = next })
  s.setMedia(next, s.camOn)
  broadcastMediaState()
}

export async function toggleGroupCam() {
  const next = !store().camOn
  if (next && localStream && localStream.getVideoTracks().length === 0) {
    // камера ещё не запрашивалась — добираем видеотрек и доливаем во все pc. Поколение — до
    // запроса: звонок убран (или убран и начат заново), пока открыто окно камеры, — камеру гасим.
    const gen = callGen
    let cam: MediaStream
    try {
      cam = await navigator.mediaDevices.getUserMedia({ video: true })
    } catch {
      return
    }
    const stream = localStream as MediaStream | null
    if (gen !== callGen || !stream || stream.getVideoTracks().length > 0) {
      cam.getTracks().forEach((t) => t.stop()) // звонок убран или камеру уже добрал второй клик
      return
    }
    const track = cam.getVideoTracks()[0]
    stream.addTrack(track)
    // renegotiation: мы инициатор изменения; каждому участнику — в его очередь
    await Promise.all([...pcs].map(([userId, pc]) => {
      try {
        if (!pc.getSenders().some((sd) => sd.track === track)) pc.addTrack(track, stream)
      } catch {
        return Promise.resolve() // pc закрыт посреди обхода: остальным камеру всё равно доливаем
      }
      return sendOffer(userId, false)
    }))
    if (gen !== callGen) return
  } else {
    localStream?.getVideoTracks().forEach((t) => { t.enabled = next })
  }
  const s = store()
  s.setMedia(s.micOn, next)
  broadcastMediaState()
  s.bumpStreams()
}

/** Входящие group_call_* фреймы (из realtimeBridge). */
export function handleGroupCallFrame(evt: GroupCallFrame) {
  const { t, d } = evt
  if (t === 'group_call_update') {
    // список идущих звонков — для баннера Join у всех членов чата
    if (d.action === 'rejected') {
      // Отказ списка участников не несёт (причина могла быть и сбоем хранилища, а
      // звонок — идти): activeByChat не трогаем. Кадр адресован только отказанному,
      // user_id сверяем: чужой не трогает наш звонок.
      if (d.user_id === useChatsStore.getState().meId) handleJoinRejected(d.peer_id, !!d.forbidden)
      return
    }
    store().setActive(d.peer_id, d.participants ?? [])
    if (store().peerId === d.peer_id && d.action === 'left' && d.user_id != null) {
      closePeer(d.user_id)
    }
    return
  }
  if (t !== 'group_call_signal' || d.from_user_id == null) return
  if (store().peerId !== d.peer_id) return
  const from = d.from_user_id
  // Сигнал — только от участника видеочата (список из group_call_update) или
  // того, с кем соединение уже есть: на offer постороннего движок отдал бы
  // ему свой микрофон и камеру (newPc → addTrack). Сервер реле так же сверяет.
  const isPeer = () => pcs.has(from) || (store().activeByChat[d.peer_id] ?? []).includes(from)
  if (!isPeer()) return
  const { sdp, candidate, media_state: media } = d
  void enqueue(from, async () => {
    // звонок убран или участник ушёл, пока кадр ждал очереди
    if (store().peerId !== d.peer_id || !isPeer()) return
    if (media) {
      store().upsertParticipant({ userId: from, muted: media.muted, videoOn: media.video })
      return
    }
    if (sdp?.type === 'offer') {
      const pc = await ensurePc(from)
      if (!pc) return
      await acceptOffer(from, pc, sdp, d.exchange_id)
      return
    }
    const pc = pcs.get(from)
    if (!pc) return // соединения нет и не ждём (ушёл, failed): кадр не к чему применить
    if (sdp) {
      // answer не к последнему нашему offer (к заменённому, повтор, запоздал) — молча мимо:
      // tweb :1726 (answer — по exchangeId), :1763-1767 (answer не в have-local-offer)
      const n = negotiation(pc)
      if (d.exchange_id == null || d.exchange_id !== n.pendingLocal || pc.signalingState !== 'have-local-offer') return
      await op(pc, () => pc.setRemoteDescription(sdp))
      n.pendingLocal = undefined
      await commitCandidates(from, pc)
      // отложенный встречный offer — после answer на свой (tweb :1853-1856)
      const queued = n.queuedRemote
      if (queued) {
        n.queuedRemote = undefined
        await acceptOffer(from, pc, queued.sdp, queued.exchangeId)
      }
      return
    }
    if (candidate) {
      if (!pc.remoteDescription) {
        const queue = pendingCandidates.get(from) ?? []
        queue.push(candidate)
        if (queue.length > MAX_PENDING_CANDIDATES) queue.splice(0, queue.length - MAX_PENDING_CANDIDATES)
        pendingCandidates.set(from, queue)
        return
      }
      await addCandidate(pc, candidate)
    }
  })
}

/** Вежливая сторона пары (при встречных offer уступает) — с большим id. */
function polite(peerUserId: number): boolean {
  return (useChatsStore.getState().meId ?? 0) > peerUserId
}
