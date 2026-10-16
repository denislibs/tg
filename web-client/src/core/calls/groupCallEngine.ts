// Движок групповых звонков (видеочатов): mesh WebRTC — по RTCPeerConnection на
// каждого удалённого участника, сигналинг через WS-реле (group_call_join /
// group_call_leave / group_call_signal, бэк переадресует адресату и фанит
// join/leave членам чата фреймом group_call_update).
//
// Без glare: НОВИЧОК шлёт офферы всем, кто уже в звонке (их список отдаёт
// GET /chats/{id}/group_call перед join); сидящие просто ждут оффер.
// Mute/камера — track.enabled + media_state внутри group_call_signal.
import { toastNew } from '@components/toast'
import { useGroupCallStore } from '../../stores/groupCallStore'
import { useLivestreamStore } from '../../stores/livestreamStore'
import { useChatsStore } from '../../stores/chatsStore'
import { startClient } from '../../client/bootstrap'
import { hasTurnServer, iceServers } from './callEngine'

const sdpJSON = (d: RTCSessionDescription | null) => (d ? { type: d.type, sdp: d.sdp } : null)

const store = () => useGroupCallStore.getState()
const managers = () => startClient().managers

const pcs = new Map<number, RTCPeerConnection>()
// Соединение, которое ещё ждёт ICE-конфиг: второй offer того же участника берёт его же, а не
// создаёт второй pc с лишними TURN-аллокациями. Уход участника (closePeer) отменяет ожидание.
const pendingPcs = new Map<number, { promise: Promise<RTCPeerConnection | null>; cancelled: boolean }>()
// Кадры сигнала одного участника — строго по очереди, как у tweb (callInstance.ts:904-941,
// :1568-1571 — цепочка processSignalingMessage): кандидаты новичка, пришедшие, пока сидящий
// берёт ICE-конфиг (/calls/ice), ждут за его offer, а не теряются без pc (tweb держит их в
// очереди до remoteDescription — :2240-2255, :2315-2352); второй offer ждёт конца первого.
const peerChains = new Map<number, Promise<void>>()
// Операция закрытого посреди неё pc по спецификации не завершается никогда (Chromium оставляет
// промис висеть): каждую ждём вместе с «pc закрыт», который отклоняет closePeer.
const closers = new WeakMap<RTCPeerConnection, { closed: Promise<never>; close: () => void }>()
class PcClosedError extends Error {}
const remoteStreams = new Map<number, MediaStream>()
let localStream: MediaStream | null = null

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
  let close!: () => void
  const closed = new Promise<never>((_, reject) => { close = () => reject(new PcClosedError()) })
  closed.catch(() => { /* ждут его только вместе с операциями pc */ })
  closers.set(pc, { closed, close })
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
  if (!c) return Promise.reject(new PcClosedError())
  return Promise.race([run(), c.closed]) // уже закрытый: closed отклонён раньше, чем run()
}

/** Кадр участника — в его очередь; ошибка закрытого pc ожидаема и не шумит. */
function enqueue(userId: number, task: () => Promise<void>) {
  const next = (peerChains.get(userId) ?? Promise.resolve()).then(task).catch((e: unknown) => {
    if (!(e instanceof PcClosedError)) console.error('[group call] signal failed', userId, e)
  })
  peerChains.set(userId, next)
  void next.finally(() => { if (peerChains.get(userId) === next) peerChains.delete(userId) })
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
  const gen = callGen
  void managers().realtime.sendCallFrame({ type: 'group_call_join', data: { peer_id: peerId } })
  // новичок предлагает соединение каждому сидящему — параллельно: медленный или закрытый посреди
  // операции pc одного участника не задерживает остальных
  const meId = useChatsStore.getState().meId
  await Promise.all(existing.filter((userId) => userId !== meId).map(async (userId) => {
    const pc = await ensurePc(userId)
    if (!pc) return // звонок убран, участник ушёл или нет TURN
    try {
      await op(pc, async () => { await pc.setLocalDescription(await pc.createOffer()) })
    } catch (e) {
      if (!(e instanceof PcClosedError) && gen === callGen && pcs.get(userId) === pc) {
        console.error('[group call] offer failed', userId, e)
        closePeer(userId)
      }
      return
    }
    if (gen !== callGen) return // звонок убран, а может, уже идёт другой: старый offer не слать
    signal(userId, { sdp: sdpJSON(pc.localDescription) })
  }))
  if (gen !== callGen) return
  broadcastMediaState()
}

/** Локальная уборка звонка: соединения, микрофон/камера, стор. Кадров не шлёт. */
function teardownCall() {
  callGen++
  for (const userId of [...pcs.keys()]) closePeer(userId)
  for (const pending of pendingPcs.values()) pending.cancelled = true
  pendingPcs.clear()
  peerChains.clear()
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
  const s = store()
  const next = !s.camOn
  if (next && localStream && localStream.getVideoTracks().length === 0) {
    // камера ещё не запрашивалась — добираем видеотрек и доливаем во все pc
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true })
      const track = cam.getVideoTracks()[0]
      localStream.addTrack(track)
      for (const [userId, pc] of pcs) {
        pc.addTrack(track, localStream)
        // renegotiation: мы инициатор изменения
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        signal(userId, { sdp: sdpJSON(pc.localDescription) })
      }
    } catch {
      return
    }
  } else {
    localStream?.getVideoTracks().forEach((t) => { t.enabled = next })
  }
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
  if (d.media_state) {
    store().upsertParticipant({ userId: from, muted: d.media_state.muted, videoOn: d.media_state.video })
    return
  }
  const { sdp, candidate } = d
  enqueue(from, async () => {
    // звонок убран или участник ушёл, пока кадр ждал очереди
    if (store().peerId !== d.peer_id || !isPeer()) return
    if (sdp?.type === 'offer') {
      const pc = await ensurePc(from)
      if (!pc) return
      await op(pc, async () => {
        await pc.setRemoteDescription(sdp)
        await pc.setLocalDescription(await pc.createAnswer())
      })
      signal(from, { sdp: sdpJSON(pc.localDescription) })
      broadcastMediaState()
      return
    }
    const pc = pcs.get(from)
    if (!pc) return // соединения нет и не ждём (ушёл, failed): кадр не к чему применить
    if (sdp) {
      await op(pc, () => pc.setRemoteDescription(sdp))
      return
    }
    if (candidate) {
      try { await op(pc, () => pc.addIceCandidate(candidate)) } catch (e) {
        if (e instanceof PcClosedError) throw e
        /* кандидат прошлой ICE-сессии */
      }
    }
  })
}
