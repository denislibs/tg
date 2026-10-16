// src/core/calls/callEngine.ts
//
// Движок 1:1 звонков: WebRTC + сигналинг через наш WS-реле (кадры call_request /
// call_accept / call_decline / call_end / call_signal, бэк переадресует их
// девайсам собеседника). Архитектура — по tweb callInstance/callsController:
//
//   исходящий:  call_request → (ringing) → call_accept → RTC (звонящий = offerer)
//   входящий:   call_request → (ringing) → accept() → call_accept → RTC (answerer)
//   SDP/ICE/media-state ходят внутри call_signal (perfect negotiation: glare
//   разрешается politeness — отвечающая сторона polite, как в tweb).
//
// Проверка звонка против подмены сигналинга (Б-1, этап 1). Сигналинг идёт открытым через
// сервер (у tweb он шифруется ключом звонка, callInstance.ts:715-735), поэтому SDP с
// a=fingerprint мог бы подменить посредник. Защита: коммитмент ключа звонящего и отпечатков
// DTLS обеих сторон (tweb g_a_hash, callInstance.ts:554-563), SAS-эмодзи от DH и ОБЕЩАННЫХ
// отпечатков, сверка каждого SDP с обещанным, провал протокола фатален без отката на звонок
// без бейджа. Чистые функции — callSas.ts. Порт протокола tweb целиком — этап 2 М-3 (В-М16).
// Mute/камера — через track.enabled + renegotiation (без fallback-потоков silence/black).
//
// Не React-модуль: пишет состояние в callStore, UI зовёт его функции.
import { getUserTitle } from '../peers/getPeerTitle'
import { getPeerPhotoId } from '../peers/peer'
import { useCallStore, type CallPeer, type CallEndReason } from '../../stores/callStore'
import { useSettingsStore } from '../../settings'
import { playSound, stopSound } from '../audio/sounds'
import { startClient } from '../../client/bootstrap'
import type { CallFrameEvt } from '../realtime/events'
import { generateKeyPair, exportPublicKey, deriveSecret, b64FromBytes, b64ToBytes } from '../secret/crypto'
import { fingerprintEmoji } from '../secret/fingerprint'
import {
  computeCallSas, createDtlsIdentity, dhCommitment, extractDtlsFingerprints, parsePeerFingerprints, sameFingerprints,
} from './callSas'

// Fallback, если /calls/ice недоступен (без TURN звонок пройдёт только в
// пределах одной сети).
const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

// ICE-конфиг с бэка (STUN + эфемерные TURN-креды). coturn проверяет метку кредов при первой
// аутентификации аллокации (Allocate), дальше Refresh/CreatePermission идут на запомненном ключе
// (userdb.c::get_user_key, ns_turn_server.c hmackey_set): идущий звонок истечение переживает,
// ломается новая аллокация — новый pc (поздний участник mesh, смена сети, переподключение TURN).
// Креды живут час (К1, ice_handler.go::iceCredentialTTL) и берутся на вход в звонок, как у tweb,
// где они приходят с самим звонком (callInstance.ts:676-688); пока звонок идёт, keepIceFresh
// обновляет их заранее и отдаёт идущим pc (applyIceServers).
//
// Конфиг отдаётся из кэша, пока до истечения кредов больше ICE_REFRESH_MARGIN_MS: этого хватает
// pc, созданному на них, чтобы аутентифицировать Allocate (секунды) с большим запасом.
const ICE_REFRESH_MARGIN_MS = 10 * 60_000
// Сбой /calls/ice: последний успешный конфиг отдаётся, пока до истечения кредов больше минуты —
// Allocate нового pc уходит сразу после его создания.
const ICE_EXPIRY_MARGIN_MS = 60_000
// Повтор планового обновления после сбоя /calls/ice.
const ICE_RETRY_MS = 30_000
// Сколько ждать /calls/ice: у fetch и канального RPC своего таймаута нет, а на висящий запрос
// встают все вызовы вкладки (склейка ниже) — после таймаута тот же откат, что при сбое.
const ICE_FETCH_TIMEOUT_MS = 10_000
let cachedIce: { servers: RTCIceServer[]; expires: number } | null = null
// Запрос в полёте: pc mesh создаются пачкой, и каждый не должен идти в /calls/ice отдельно.
let iceInFlight: Promise<RTCIceServer[]> | null = null
export function iceServers(): Promise<RTCIceServer[]> {
  if (cachedIce && Date.now() < cachedIce.expires - ICE_REFRESH_MARGIN_MS) return Promise.resolve(cachedIce.servers)
  iceInFlight ??= new Promise<RTCIceServer[]>((resolve) => {
    const timer = setTimeout(() => resolve(lastGoodIce()), ICE_FETCH_TIMEOUT_MS)
    void fetchIceServers().then((servers) => { clearTimeout(timer); resolve(servers) })
  }).finally(() => { iceInFlight = null })
  return iceInFlight
}
async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const cfg = await managers().calls.iceConfig()
    if (cfg.servers.length) {
      cachedIce = { servers: cfg.servers, expires: Date.now() + cfg.ttlSeconds * 1000 }
      return cfg.servers
    }
  } catch { /* сбой запроса: ниже — последний успешный конфиг, пока его креды живы */ }
  return lastGoodIce()
}
// Сбой /calls/ice (5xx, сеть, обновление токена; 420 restClient пережидает сам) не должен
// превращать relay-pc в pc без единого кандидата: креды ещё действуют — последний успешный конфиг.
function lastGoodIce(): RTCIceServer[] {
  if (cachedIce && Date.now() < cachedIce.expires - ICE_EXPIRY_MARGIN_MS) return cachedIce.servers
  return FALLBACK_ICE
}
/**
 * Новые креды в живой pc. Креды проверяются при первой аутентификации аллокации, но pc
 * заводит новые: смена сети (Wi-Fi → LTE), переподключение TURN, ICE restart. Без этого
 * они пошли бы с кредами, выданными на вход в звонок, и после их истечения получили бы 401.
 */
export function applyIceServers(pc: RTCPeerConnection, servers: RTCIceServer[]) {
  // Без certificates: по спецификации setConfiguration сверяет их с прежними, а менять нужно
  // только iceServers (остальные поля в getConfiguration уже те, что заданы при создании).
  const { certificates: _certificates, ...config } = pc.getConfiguration()
  try {
    pc.setConfiguration({ ...config, iceServers: servers })
  } catch (e) {
    if (pc.signalingState !== 'closed') console.warn('[call] не удалось обновить креды TURN в идущем pc', e)
  }
}
/**
 * Плановое обновление кредов, пока идёт звонок (К1): за ICE_REFRESH_MARGIN_MS до истечения конфиг
 * берётся заново, и pc участника, вошедшего позже, не ждёт /calls/ice и не упирается в истёкшую
 * метку; apply получает новый конфиг, чтобы отдать его уже идущим pc (applyIceServers).
 * Возвращает остановку.
 */
export function keepIceFresh(apply: (servers: RTCIceServer[]) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let applied = cachedIce?.servers
  const plan = () => {
    if (stopped) return
    const due = cachedIce ? cachedIce.expires - ICE_REFRESH_MARGIN_MS - Date.now() : 0
    timer = setTimeout(() => {
      void iceServers().then((servers) => {
        if (stopped) return
        if (servers !== applied && hasTurnServer(servers)) { applied = servers; apply(servers) }
        plan()
      })
    }, Math.max(due, ICE_RETRY_MS))
  }
  plan()
  return () => { stopped = true; clearTimeout(timer) }
}
/** Есть ли среди серверов хоть один TURN (`turn:`/`turns:`) — без него `relay` не собрать кандидатов. */
export function hasTurnServer(servers: RTCIceServer[]): boolean {
  return servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)))
}
const RING_TIMEOUT_MS = 45_000 // tweb: 45s до missed

const store = () => useCallStore.getState()
const managers = () => startClient().managers

let pc: RTCPeerConnection | null = null
// Плановое обновление кредов TURN, пока идёт звонок (К1).
let stopIceRefresh: (() => void) | null = null
let localStream: MediaStream | null = null
let screenStream: MediaStream | null = null
// единственный видео-sender: камера и шаринг экрана делят его через replaceTrack
// (tweb: video и presentation взаимоисключающие)
let videoSender: RTCRtpSender | null = null
// perfect negotiation (по tweb: входящая сторона откатывает свой оффер при glare)
let polite = false
let makingOffer = false
let ignoreOffer = false
let pendingCandidates: RTCIceCandidateInit[] = []
let ringTimer: ReturnType<typeof setTimeout> | null = null
// Грейс-таймер разрыва соединения: при 'disconnected' даём шанс восстановиться,
// иначе завершаем (иначе у собеседника «звонок-призрак», если тот перезагрузил вкладку).
let disconnectTimer: ReturnType<typeof setTimeout> | null = null
const DISCONNECT_GRACE_MS = 8000
// Обработчик закрытия/перезагрузки вкладки — шлём call_end собеседнику (best-effort).
//
// Лог звонка (служебное messageActionPhoneCall в чате) клиент НЕ отправляет:
// его кладёт сервер по концу звонка, сам считая исход и длительность
// (backend usecase/chat/phonecall.go) — как phone.discardCall у оригинала.
// Клиент, как tweb discardCall (callInstance.ts:888), лишь называет причину
// конца в поле reason кадра call_end: 'hangup' | 'missed' | 'disconnect'.
let unloadHandler: (() => void) | null = null

// ── E2E (SAS) ──
// Состояние проверки текущего звонка. Протокол (кадры и поля — m-security-contract.md, М3-1):
//   call_request {video, dh_hash}       dh_hash = H(pubA ‖ fpsCaller) — обещание звонящего
//   call_accept  {dh: pubB, dtls: fpsCallee}
//   call_signal  {dh_reveal: pubA, dtls: fpsCaller} — первым кадром после call_accept, до SDP
// SAS = H(dhFp ‖ "call-sas-v1" ‖ fpsCaller ‖ 0 ‖ fpsCallee) по ОБЕЩАННЫМ наборам; SDP каждой
// стороны обязан нести ровно обещанные отпечатки.
let ident: { cert: RTCCertificate; fps: string[] } | null = null // свой сертификат DTLS и его отпечатки
let dhPriv: CryptoKey | null = null
let dhPubRaw: Uint8Array | null = null
let peerDhHash: string | null = null // отвечающий: коммитмент из call_request
let peerFps: string[] | null = null // обещанные отпечатки собеседника
let dhFp: Uint8Array | null = null // отпечаток общего секрета ECDH
let accepting = false // accept() уже запущен — повторный клик не стартует второй
// Поколение звонка: cleanupRtc() его меняет, и позднее звено очереди/ответ getUserMedia
// старого звонка выходит, не трогая новый.
let gen = 0
// Очередь кадров call_accept/call_signal: строго по одному, иначе dh_reveal и offer из одного
// тика обгоняли бы друг друга на await криптографии.
let frameChain: Promise<void> = Promise.resolve()

/** Провал протокола проверки — фатален для звонка (отличается от случайной ошибки pc). */
class E2EFail extends Error {}

async function beginDh(): Promise<{ priv: CryptoKey; pubRaw: Uint8Array }> {
  const pair = await generateKeyPair()
  return { priv: pair.privateKey, pubRaw: await exportPublicKey(pair.publicKey) }
}

function resetDh() {
  gen++
  frameChain = Promise.resolve()
  ident = null
  dhPriv = null
  dhPubRaw = null
  peerDhHash = null
  peerFps = null
  dhFp = null
  accepting = false
}

// Единая точка фатального исхода. До ответа отвечающий отклоняет с причиной missed (сервер
// пишет «Пропущенный»; «Отклонённый» был бы ложью), после ответа — call_end disconnect
// («обрыв связи»); звонящий, не успевший послать call_request, просто закрывает экран.
type E2EPhase = 'pre-request' | 'before-answer' | 'after-answer'
function failE2E(phase: E2EPhase) {
  if (!store().call) return
  if (phase === 'before-answer') sendFrame('call_decline', { reason: 'missed' })
  else if (phase === 'after-answer') sendFrame('call_end', { reason: 'disconnect' })
  finish('failed')
}

// fatal: любая ошибка звена фатальна для звонка (звенья протокола); иначе только провал
// проверки (E2EFail) фатален, а случайная ошибка pc по ходу звонка пишется в консоль.
function enqueue(fn: (alive: () => boolean) => Promise<void>, fatal = false) {
  const g = gen
  const alive = () => g === gen && !!store().call
  frameChain = frameChain.then(() => (alive() ? fn(alive) : undefined)).catch((e: unknown) => {
    if (g !== gen) return
    if (fatal || e instanceof E2EFail) {
      console.warn('[call] protocol step failed', e)
      failE2E('after-answer')
    } else console.warn('[call] frame handler failed', e)
  })
}

// SAS появляется, как только известны ключ и оба обещанных набора.
async function publishSas(alive: () => boolean) {
  const call = store().call
  if (!call || !ident || !peerFps || !dhFp) return
  const [callerFps, calleeFps] = call.outgoing ? [ident.fps, peerFps] : [peerFps, ident.fps]
  const sas = await computeCallSas(dhFp, callerFps, calleeFps)
  if (alive()) store().patch({ e2eFingerprint: fingerprintEmoji(sas) })
}

async function deriveDhFp(peerPubB64: string): Promise<Uint8Array> {
  if (!dhPriv) throw new E2EFail('no dh key')
  try {
    return (await deriveSecret(dhPriv, b64ToBytes(peerPubB64))).fingerprint
  } catch {
    throw new E2EFail('bad peer dh key')
  }
}

// Свой localDescription обязан нести ровно свой сертификат.
function ownDescriptionMatches(desc: RTCSessionDescription | null): boolean {
  if (!ident || !desc) return false
  try { return sameFingerprints(extractDtlsFingerprints(desc.sdp), ident.fps) } catch { return false }
}

function sendFrame(type: string, data: Record<string, unknown>) {
  const call = store().call
  if (!call) return
  void managers().realtime.sendCallFrame({
    type,
    data: { to_user_id: call.peer.id, call_id: call.callId, ...data },
  })
}

function clearRingTimer() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null }
}

function cleanupRtc() {
  makingOffer = false
  ignoreOffer = false
  pendingCandidates = []
  if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null }
  if (unloadHandler) {
    window.removeEventListener('pagehide', unloadHandler)
    window.removeEventListener('beforeunload', unloadHandler)
    unloadHandler = null
  }
  resetDh()
  localStream?.getTracks().forEach((t) => t.stop())
  localStream = null
  screenStream?.getTracks().forEach((t) => t.stop())
  screenStream = null
  videoSender = null
  stopIceRefresh?.()
  stopIceRefresh = null
  if (pc) {
    pc.onicecandidate = null
    pc.ontrack = null
    pc.onnegotiationneeded = null
    pc.onconnectionstatechange = null
    pc.close()
    pc = null
  }
}

// Завершение с показом финального статуса; экран закрывается через паузу.
function finish(reason: CallEndReason) {
  clearRingTimer()
  cleanupRtc()
  stopSound()
  const call = store().call
  if (!call || call.phase === 'ended') return
  playSound(reason === 'busy' || reason === 'declined' || reason === 'privacy' ? 'call_busy' : 'call_end')
  // бейдж гасится вместе с экраном: провалившаяся проверка не оставляет эмодзи на виду
  store().patch({ phase: 'ended', endReason: reason, localStream: null, remoteStream: null, e2eFingerprint: undefined })
  setTimeout(() => {
    const cur = store().call
    if (cur && cur.phase === 'ended') store().set(null)
  }, 1500)
}

// Звонок погашен не здесь (ответили или отклонили на другом устройстве):
// экран закрывается молча — без финального статуса и звука конца.
function dismiss() {
  clearRingTimer()
  cleanupRtc()
  stopSound()
  store().set(null)
}

// ── медиа ──

async function acquireLocal(withVideo: boolean): Promise<MediaStream | null> {
  const { micId, cameraId } = useSettingsStore.getState()
  const constraints: MediaStreamConstraints = {
    audio: micId ? { deviceId: { exact: micId } } : true,
    video: withVideo ? (cameraId ? { deviceId: { exact: cameraId } } : true) : false,
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch {
    // выбранное устройство могло исчезнуть — пробуем дефолтные
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo })
    } catch {
      return null // без локального медиа звонок остаётся recvonly
    }
  }
}

function sendMediaState() {
  const call = store().call
  if (!call) return
  sendFrame('call_signal', { media: { muted: call.muted, cam_on: call.camOn || call.screenOn } })
}

// ── WebRTC ──

// Создаёт pc (внутри очереди кадров) и запускает захват микрофона/камеры ВНЕ очереди:
// открытое окно разрешения не должно держать call_signal/ICE и прочие кадры звонка.
async function startRtc(withVideo: boolean, alive: () => boolean) {
  const call = store().call
  if (!call || !ident) return
  store().patch({ phase: 'connecting' })
  stopSound()
  playSound('voip_connecting')

  // Политика ICE — по p2p_allowed звонка (tweb callInstance.ts:1283-1287: `isP2p ? 'all' : 'relay'`).
  // Не `true` (в т.ч. поля нет) — закрываемся: relay. Без TURN relay не соберёт ни одного кандидата,
  // поэтому звонок не начинается, а не переходит молча на 'all' (IP ушёл бы собеседнику).
  const iceTransportPolicy: RTCIceTransportPolicy = call.p2pAllowed === true ? 'all' : 'relay'
  const servers = await iceServers()
  if (!alive()) return
  if (iceTransportPolicy === 'relay' && !hasTurnServer(servers)) {
    console.warn('[call] relay-only call without TURN server')
    failE2E('after-answer')
    return
  }
  pc = new RTCPeerConnection({ iceServers: servers, bundlePolicy: 'max-bundle', iceTransportPolicy, certificates: [ident.cert] })
  const main = pc
  stopIceRefresh = keepIceFresh((fresh) => applyIceServers(main, fresh))

  pc.onicecandidate = (e) => {
    if (e.candidate) sendFrame('call_signal', { ice: e.candidate.toJSON() })
  }

  pc.ontrack = (e) => {
    // ВСЕГДА новая ссылка MediaStream: при доборе видео в середине звонка браузер
    // переиспользует тот же remote-stream (тот же msid), и patch с прежней ссылкой
    // не перезапустил бы useEffect привязки srcObject в CallScreen — собеседник не
    // увидел бы включённую камеру (self-view работает, т.к. локально ссылка новая).
    const src = e.streams[0]
    const stream = new MediaStream(src ? src.getTracks() : [e.track])
    store().patch({ remoteStream: stream })
  }

  pc.onnegotiationneeded = async () => {
    if (!pc) return
    try {
      makingOffer = true
      await pc.setLocalDescription()
      if (!ownDescriptionMatches(pc.localDescription)) { failE2E('after-answer'); return }
      sendFrame('call_signal', { sdp: pc.localDescription!.toJSON() })
    } catch { /* pc умер во время переговоров — cleanup сделает finish */ }
    finally { makingOffer = false }
  }

  pc.onconnectionstatechange = () => {
    if (!pc) return
    const cur = store().call
    const st = pc.connectionState
    if (st === 'connected') {
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null } // восстановились
      if (cur && cur.phase !== 'active') {
        stopSound()
        store().patch({ phase: 'active', connectedAt: Date.now() })
      }
    } else if (st === 'failed') {
      sendFrame('call_end', { reason: 'disconnect' })
      finish('failed')
    } else if (st === 'disconnected') {
      // Собеседник пропал (перезагрузил вкладку / потерял сеть). Даём шанс
      // восстановиться DISCONNECT_GRACE_MS, иначе завершаем — иначе «звонок-призрак».
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          disconnectTimer = null
          if (pc && (pc.connectionState === 'disconnected' || pc.connectionState === 'failed')) {
            // tweb hangUp('phoneCallDiscardReasonDisconnect'): без кадра сервер
            // не узнал бы, что разговор кончился, и лога звонка не было бы.
            sendFrame('call_end', { reason: 'disconnect' })
            finish('failed')
          }
        }, DISCONNECT_GRACE_MS)
      }
    }
  }

  // Перезагрузка/закрытие вкладки во время звонка → уведомить собеседника, чтобы у
  // него звонок не завис (best-effort; выживший сам завершит по disconnected-таймеру).
  unloadHandler = () => { try { sendFrame('call_end', { reason: 'hangup' }) } catch { /* окно уже закрывается */ } }
  window.addEventListener('pagehide', unloadHandler)
  window.addEventListener('beforeunload', unloadHandler)

  void attachLocalMedia(withVideo, gen)
}

async function attachLocalMedia(withVideo: boolean, g: number) {
  const stream = await acquireLocal(withVideo)
  if (g !== gen || !pc) { // повесили трубку, пока ждали getUserMedia (tweb: isClosing check)
    stream?.getTracks().forEach((t) => t.stop())
    return
  }
  localStream = stream
  if (localStream) {
    for (const track of localStream.getTracks()) {
      const sender = pc.addTrack(track, localStream)
      if (track.kind === 'video') videoSender = sender
    }
    store().patch({ localStream, camOn: localStream.getVideoTracks().length > 0 })
  } else {
    // нет пермишена/устройств: соединяемся только на приём. Отвечающая сторона к этому
    // моменту могла уже принять offer собеседника — тогда приёмные трансиверы уже есть.
    const has = (kind: string) => pc!.getTransceivers().some((t) => t.receiver.track.kind === kind)
    if (!has('audio')) pc.addTransceiver('audio', { direction: 'recvonly' })
    if (withVideo && !has('video')) pc.addTransceiver('video', { direction: 'recvonly' })
    store().patch({ camOn: false })
  }
  sendMediaState()
}

// Раскрытие ключа звонящего (отвечающая сторона): проверка по коммитменту из call_request,
// провал фатален — подложный ключ в SAS попасть не должен (tweb callsController.ts:233-240).
async function onDhReveal(d: Record<string, unknown>, alive: () => boolean) {
  const call = store().call
  if (!call || call.outgoing || !peerDhHash || !ident || dhFp) return // дубль раскрытия игнорируем
  const callerFps = parsePeerFingerprints(d.dtls)
  if (typeof d.dh_reveal !== 'string' || !callerFps) throw new E2EFail('bad dh_reveal')
  let pubRaw: Uint8Array
  try { pubRaw = b64ToBytes(d.dh_reveal) } catch { throw new E2EFail('bad dh_reveal key') }
  if (await dhCommitment(pubRaw, callerFps) !== peerDhHash) throw new E2EFail('commitment mismatch')
  const fp = await deriveDhFp(d.dh_reveal)
  if (!alive()) return
  peerFps = callerFps
  dhFp = fp
  await publishSas(alive)
}

async function handleSignal(d: Record<string, unknown>, alive: () => boolean) {
  if (!store().call) return
  if (d.dh_reveal !== undefined) { await onDhReveal(d, alive); return }
  if (!pc) return
  // media-state собеседника (tweb шлёт его в DataChannel; у нас — тем же реле)
  const media = d.media as { muted?: boolean; cam_on?: boolean } | undefined
  if (media) {
    store().patch({ remoteMuted: !!media.muted, remoteCamOn: !!media.cam_on })
    return
  }
  const sdp = d.sdp as RTCSessionDescriptionInit | undefined
  if (sdp) {
    // SDP до проверенного раскрытия ключа, не offer/answer или с отпечатками, отличными от
    // обещанных, — подмена (или нарушенный порядок): звонок рвётся.
    if (!dhFp || !peerFps) throw new E2EFail('sdp before dh_reveal')
    if ((sdp.type !== 'offer' && sdp.type !== 'answer') || typeof sdp.sdp !== 'string') throw new E2EFail('bad sdp')
    let sdpFps: string[]
    try { sdpFps = extractDtlsFingerprints(sdp.sdp) } catch { throw new E2EFail('malformed sdp fingerprint') }
    if (!sameFingerprints(sdpFps, peerFps)) throw new E2EFail('sdp fingerprint mismatch')
    // perfect negotiation: impolite (звонящий) игнорирует чужой offer при glare,
    // polite (отвечающий) откатывает свой — ровно как rollback в tweb.
    const collision = sdp.type === 'offer' && (makingOffer || pc.signalingState !== 'stable')
    ignoreOffer = !polite && collision
    if (ignoreOffer) return
    const p = pc
    await p.setRemoteDescription(sdp)
    if (!alive() || pc !== p) return // звонок закончился (или начался новый) посреди переговоров
    for (const c of pendingCandidates) await p.addIceCandidate(c).catch(() => {})
    if (!alive() || pc !== p) return
    pendingCandidates = []
    if (sdp.type === 'offer') {
      await p.setLocalDescription()
      if (!alive() || pc !== p) return
      if (!ownDescriptionMatches(p.localDescription)) throw new E2EFail('own sdp fingerprint mismatch')
      sendFrame('call_signal', { sdp: p.localDescription!.toJSON() })
    }
    return
  }
  const ice = d.ice as RTCIceCandidateInit | undefined
  if (ice) {
    if (!pc.remoteDescription) pendingCandidates.push(ice)
    else await pc.addIceCandidate(ice).catch(() => { if (!ignoreOffer) throw new Error('bad ice') })
  }
}

// Ответ звонящему на call_accept: набор и ключ отвечающего, раскрытие своего ключа и SAS.
async function onCallAccept(d: Record<string, unknown>, alive: () => boolean) {
  const call = store().call
  if (!call || !call.outgoing || !ident || !dhPubRaw || peerFps) return // ранний или повторный call_accept
  clearRingTimer()
  const calleeFps = parsePeerFingerprints(d.dtls)
  if (typeof d.dh !== 'string' || !calleeFps) throw new E2EFail('call_accept without dh/dtls')
  const fp = await deriveDhFp(d.dh)
  if (!alive()) return
  peerFps = calleeFps
  dhFp = fp
  // раскрытие — первым кадром, до SDP: отвечающий проверяет его по коммитменту до SAS
  sendFrame('call_signal', { dh_reveal: b64FromBytes(dhPubRaw), dtls: ident.fps })
  await publishSas(alive)
  if (!alive()) return
  await startRtc(call.video, alive)
}

// ── публичное API (UI) ──

export function startOutgoing(peer: CallPeer, video: boolean) {
  if (store().call) return // уже в звонке
  const callId = crypto.randomUUID()
  useCallStore.getState().set({
    callId, peer, outgoing: true, video, phase: 'outgoing',
    muted: false, camOn: video, screenOn: false, remoteMuted: false, remoteCamOn: false,
    connectedAt: null, localStream: null, remoteStream: null,
  })
  polite = false // звонящий — impolite (tweb: incoming сторона делает rollback)
  playSound('call_outgoing', { loop: true })
  // Сертификат DTLS и ключ ECDH — до первого кадра: в call_request уходит только коммитмент
  // на пару «ключ + отпечатки», сами они раскрываются после ответа (call_signal dh_reveal).
  const g = gen
  void (async () => {
    try {
      const id = await createDtlsIdentity()
      const dh = await beginDh()
      const dhHash = await dhCommitment(dh.pubRaw, id.fps)
      if (g !== gen) return
      ident = id
      dhPriv = dh.priv
      dhPubRaw = dh.pubRaw
      sendFrame('call_request', { video, dh_hash: dhHash })
    } catch (e) {
      console.warn('[call] cannot prepare DTLS identity / DH', e)
      if (g === gen) failE2E('pre-request')
    }
  })()
  ringTimer = setTimeout(() => { sendFrame('call_end', { reason: 'missed' }); finish('missed') }, RING_TIMEOUT_MS)
}

export function accept() {
  const call = store().call
  if (!call || call.phase !== 'incoming' || accepting) return
  clearRingTimer()
  polite = true
  // Звонящий старой сборки коммитмента не прислал — проверить его нечем: честный отказ,
  // а не звонок без бейджа.
  if (!peerDhHash) { failE2E('before-answer'); return }
  accepting = true
  const g = gen
  void (async () => {
    try {
      const id = await createDtlsIdentity()
      const dh = await beginDh()
      if (g !== gen) return
      ident = id
      dhPriv = dh.priv
      dhPubRaw = dh.pubRaw
    } catch (e) {
      console.warn('[call] cannot prepare DTLS identity / DH', e)
      if (g === gen) failE2E('before-answer')
      return
    }
    sendFrame('call_accept', { dh: b64FromBytes(dhPubRaw!), dtls: ident!.fps })
    store().patch({ phase: 'connecting' })
    enqueue((alive) => startRtc(call.video, alive), true)
  })()
}

export function decline() {
  const call = store().call
  if (!call || call.phase !== 'incoming') return
  sendFrame('call_decline', { reason: 'declined' })
  finish('declined')
}

export function hangup() {
  const call = store().call
  if (!call) return
  if (call.phase === 'incoming') { decline(); return }
  sendFrame('call_end', { reason: 'hangup' })
  finish('hangup')
}

export function toggleMute() {
  const call = store().call
  if (!call) return
  const muted = !call.muted
  localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted })
  store().patch({ muted })
  sendMediaState()
}

export async function toggleCamera() {
  const call = store().call
  if (!call || !pc) return
  if (call.camOn) {
    // выключение: трек глушим (sender остаётся — tweb-паттерн track.enabled)
    localStream?.getVideoTracks().forEach((t) => { t.enabled = false })
    if (videoSender?.track && (localStream?.getVideoTracks() as MediaStreamTrack[] | undefined)?.includes(videoSender.track)) {
      // ок: тот же трек, enabled=false уже заглушил отправку
    }
    store().patch({ camOn: false })
    sendMediaState()
    return
  }
  // камера и шаринг взаимоисключающие (tweb): включение камеры гасит шаринг
  if (call.screenOn) await stopScreenShare(false)
  const existing = localStream?.getVideoTracks()[0]
  if (existing) {
    existing.enabled = true
    if (videoSender && videoSender.track !== existing) await videoSender.replaceTrack(existing).catch(() => {})
    store().patch({ camOn: true, localStream: localStream ? new MediaStream(localStream.getTracks()) : null })
    sendMediaState()
    return
  }
  // камеры ещё не было (аудиозвонок): добираем трек → renegotiation
  const { cameraId } = useSettingsStore.getState()
  let cam: MediaStream | null = null
  try {
    cam = await navigator.mediaDevices.getUserMedia({
      video: cameraId ? { deviceId: { exact: cameraId } } : true,
    })
  } catch { return }
  if (!pc || !store().call) { cam.getTracks().forEach((t) => t.stop()); return }
  const track = cam.getVideoTracks()[0]
  if (!localStream) {
    localStream = cam
  } else {
    localStream.addTrack(track)
  }
  if (videoSender) await videoSender.replaceTrack(track).catch(() => {})
  else videoSender = pc.addTrack(track, localStream) // дёрнет onnegotiationneeded → новый offer
  store().patch({ localStream: new MediaStream(localStream.getTracks()), camOn: true })
  sendMediaState()
}

// ── шаринг экрана (tweb presentation: делит видео-слот с камерой) ──

export async function toggleScreenShare() {
  const call = store().call
  if (!call || !pc) return
  if (call.screenOn) { await stopScreenShare(true); return }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
  } catch { return } // отказ в пикере браузера — просто ничего не делаем
  if (!pc || !store().call) { stream.getTracks().forEach((t) => t.stop()); return }
  const track = stream.getVideoTracks()[0]
  // «Stop sharing» из браузерного UI заканчивает шаринг и у нас
  track.onended = () => { void stopScreenShare(true) }
  screenStream = stream
  // взаимоисключение: камера гаснет на время шаринга
  localStream?.getVideoTracks().forEach((t) => { t.enabled = false })
  if (videoSender) await videoSender.replaceTrack(track).catch(() => {})
  else videoSender = pc.addTrack(track, stream) // renegotiation
  store().patch({ screenOn: true, camOn: false, localStream: stream })
  sendMediaState()
}

async function stopScreenShare(notify: boolean) {
  if (!screenStream) return
  screenStream.getTracks().forEach((t) => t.stop())
  screenStream = null
  if (videoSender) await videoSender.replaceTrack(null).catch(() => {})
  const cur = store().call
  if (cur) store().patch({ screenOn: false, localStream: localStream ? new MediaStream(localStream.getTracks()) : null })
  if (notify) sendMediaState()
}

// ── смена устройства на лету (tweb applyDeviceToActiveCall) ──
// Динамик применяется в CallScreen (setSinkId по settings.speakerId);
// микрофон/камера — здесь через getUserMedia → replaceTrack.

export async function applyDeviceToActiveCall(kind: 'mic' | 'camera', deviceId: string) {
  const call = store().call
  if (!call || !pc) return
  if (kind === 'mic') {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
    } catch { return }
    if (!pc || !store().call) { stream.getTracks().forEach((t) => t.stop()); return }
    const track = stream.getAudioTracks()[0]
    track.enabled = !store().call!.muted // mute переживает смену устройства
    const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
    if (sender) await sender.replaceTrack(track).catch(() => {})
    else pc.addTrack(track, stream)
    const old = localStream?.getAudioTracks()[0]
    if (localStream && old) { localStream.removeTrack(old); old.stop() }
    if (localStream) localStream.addTrack(track)
    else localStream = stream
    return
  }
  // камера: применяем только когда она сейчас передаётся (не шаринг, не выкл)
  if (!call.camOn) return
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    })
  } catch { return }
  if (!pc || !store().call) { stream.getTracks().forEach((t) => t.stop()); return }
  const track = stream.getVideoTracks()[0]
  if (videoSender) await videoSender.replaceTrack(track).catch(() => {})
  else videoSender = pc.addTrack(track, localStream ?? stream)
  const old = localStream?.getVideoTracks()[0]
  if (localStream && old) { localStream.removeTrack(old); old.stop() }
  if (localStream) localStream.addTrack(track)
  else localStream = stream
  store().patch({ localStream: new MediaStream(localStream.getTracks()) })
}

// ── входящие кадры (из realtimeBridge) ──

export function handleFrame(evt: CallFrameEvt) {
  const { t, d } = evt
  const call = store().call
  const callId = typeof d.call_id === 'string' ? d.call_id : ''
  const from = d.from_user_id

  if (t === 'call_request') {
    // уже в звонке → busy тому, кто звонит (не трогая текущий звонок)
    if (call) {
      void managers().realtime.sendCallFrame({
        type: 'call_decline',
        data: { to_user_id: from, call_id: callId, reason: 'busy' },
      })
      return
    }
    const video = !!d.video
    // Коммитмент звонящего на пару «ключ + отпечатки DTLS»; без него (старая сборка)
    // accept() честно откажет.
    peerDhHash = typeof d.dh_hash === 'string' ? d.dh_hash : null
    // имя/аватар звонящего подтягиваем асинхронно
    useCallStore.getState().set({
      callId, peer: { id: from, name: `ID ${from}`, avatar: 'var(--primary-color)' },
      outgoing: false, video, phase: 'incoming',
      p2pAllowed: d.p2p_allowed === true,
      muted: false, camOn: video, screenOn: false, remoteMuted: false, remoteCamOn: false,
      connectedAt: null, localStream: null, remoteStream: null,
    })
    void managers().peers.getUsers([from]).then((users) => {
      const u = users[0]
      const cur = store().call
      if (u && cur && cur.callId === callId) {
        const name = getUserTitle(u)
        store().patch({
          peer: {
            id: from, name,
            avatar: cur.peer.avatar, avatarText: name.charAt(0).toUpperCase(),
            photoId: getPeerPhotoId(u.photo) || undefined,
          },
        })
      }
    }).catch(() => {})
    playSound('call_incoming', { loop: true })
    ringTimer = setTimeout(() => {
      sendFrame('call_decline', { reason: 'missed' })
      finish('missed')
    }, RING_TIMEOUT_MS)
    return
  }

  // остальные кадры относятся только к текущему звонку: тот же call_id (кадр
  // без него — не кадр звонка)
  if (!call || !callId || call.callId !== callId) return

  // Ответили или отклонили на другом моём устройстве (сервер: call_end
  // answered_elsewhere): ещё звонящий экран гаснет, ответившему — не касается.
  if (t === 'call_end' && d.reason === 'answered_elsewhere') {
    if (call.phase === 'incoming') dismiss()
    return
  }
  // кадр звонка — только от собеседника этого звонка
  if (from !== call.peer.id) return

  switch (t) {
    case 'call_accept':
      if (call.outgoing && call.phase === 'outgoing' && ident && dhPubRaw) { // call_request уже ушёл
        // 'connecting' сразу: кадры call_signal отвечающего, пришедшие, пока звено крутит
        // криптографию, должны встать в очередь за ним, а не быть отброшены фильтром по фазе
        // p2p_allowed звонка — из call_accept (серверное поле, tweb callInstance.ts:690-694)
        store().patch({ phase: 'connecting', p2pAllowed: d.p2p_allowed === true })
        enqueue((alive) => onCallAccept(d, alive), true)
      }
      break
    case 'call_decline':
      // отказ осмыслен только у ещё не отвеченного исходящего: идущий разговор
      // запоздалым отказом (второе устройство собеседника) не рвётся
      if (!call.outgoing || call.phase !== 'outgoing') break
      clearRingTimer()
      finish(d.reason === 'busy' ? 'busy' : d.reason === 'privacy' ? 'privacy' : 'declined')
      break
    case 'call_end':
      finish('hangup')
      break
    case 'call_signal':
      // до ответа (звонящий в outgoing, отвечающий в incoming) сигналинга быть не может
      if (call.phase === 'connecting' || call.phase === 'active') // раскрытие ключа — звено протокола: его сбой фатален (иначе звонок пошёл бы без бейджа)
      enqueue((alive) => handleSignal(d, alive), d.dh_reveal !== undefined)
      break
  }
}
