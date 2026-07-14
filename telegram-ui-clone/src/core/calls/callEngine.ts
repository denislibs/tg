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
// Упрощение относительно tweb: без MTProto DH-слоя поверх сигналинга — медиа
// и так шифруется DTLS-SRTP, сигналинг идёт по нашему WSS. Mute/камера — через
// track.enabled + renegotiation (без fallback-потоков silence/black).
//
// Не React-модуль: пишет состояние в callStore, UI зовёт его функции.
import { useCallStore, type CallPeer, type CallEndReason } from '../../stores/callStore'
import { useChatsStore } from '../../stores/chatsStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { useSettingsStore } from '../../settings'
import { playSound, stopSound } from '../audio/sounds'
import { startClient } from '../../client/bootstrap'
import type { CallFrameEvt } from '../realtime/events'

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const RING_TIMEOUT_MS = 45_000 // tweb: 45s до missed

const store = () => useCallStore.getState()
const managers = () => startClient().managers

let pc: RTCPeerConnection | null = null
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
  localStream?.getTracks().forEach((t) => t.stop())
  localStream = null
  screenStream?.getTracks().forEach((t) => t.stop())
  screenStream = null
  videoSender = null
  if (pc) {
    pc.onicecandidate = null
    pc.ontrack = null
    pc.onnegotiationneeded = null
    pc.onconnectionstatechange = null
    pc.close()
    pc = null
  }
}

// Лог звонка в историю чата (tweb messageActionPhoneCall): одно сообщение,
// пишет ЗВОНЯЩИЙ — у него бабл «Исходящий звонок», у собеседника «Входящий».
function logCallMessage(reason: CallEndReason) {
  const call = store().call
  if (!call || !call.outgoing || call.chatId == null) return
  const duration = call.connectedAt ? Math.round((Date.now() - call.connectedAt) / 1000) : undefined
  const mapped: 'ok' | 'missed' | 'busy' | 'cancelled' =
    duration != null ? 'ok'
    : reason === 'missed' ? 'missed'
    : reason === 'busy' ? 'busy'
    : 'cancelled'
  const text = JSON.stringify({ video: call.video, reason: mapped, duration })
  const clientMsgId = crypto.randomUUID()
  const meId = useChatsStore.getState().meId
  if (meId != null) useMessagesStore.getState().appendOptimistic(call.chatId, text, meId, clientMsgId, undefined, 'call')
  void managers().realtime.sendMessage({ chatId: call.chatId, text, clientMsgId, type: 'call' })
}

// Завершение с показом финального статуса; экран закрывается через паузу.
function finish(reason: CallEndReason) {
  clearRingTimer()
  cleanupRtc()
  stopSound()
  const call = store().call
  if (!call || call.phase === 'ended') return
  logCallMessage(reason)
  playSound(reason === 'busy' || reason === 'declined' ? 'call_busy' : 'call_end')
  store().patch({ phase: 'ended', endReason: reason, localStream: null, remoteStream: null })
  setTimeout(() => {
    const cur = store().call
    if (cur && cur.phase === 'ended') store().set(null)
  }, 1500)
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

async function startRtc(withVideo: boolean) {
  const call = store().call
  if (!call) return
  store().patch({ phase: 'connecting' })
  stopSound()
  playSound('voip_connecting')

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' })

  pc.onicecandidate = (e) => {
    if (e.candidate) sendFrame('call_signal', { ice: e.candidate.toJSON() })
  }

  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track])
    store().patch({ remoteStream: stream })
  }

  pc.onnegotiationneeded = async () => {
    if (!pc) return
    try {
      makingOffer = true
      await pc.setLocalDescription()
      sendFrame('call_signal', { sdp: pc.localDescription!.toJSON() })
    } catch { /* pc умер во время переговоров — cleanup сделает finish */ }
    finally { makingOffer = false }
  }

  pc.onconnectionstatechange = () => {
    if (!pc) return
    const cur = store().call
    if (pc.connectionState === 'connected' && cur && cur.phase !== 'active') {
      stopSound()
      store().patch({ phase: 'active', connectedAt: Date.now() })
    } else if (pc.connectionState === 'failed') {
      sendFrame('call_end', {})
      finish('failed')
    }
  }

  localStream = await acquireLocal(withVideo)
  if (!pc) return // повесили трубку, пока ждали getUserMedia (tweb: isClosing check)
  if (localStream) {
    for (const track of localStream.getTracks()) {
      const sender = pc.addTrack(track, localStream)
      if (track.kind === 'video') videoSender = sender
    }
    store().patch({ localStream, camOn: localStream.getVideoTracks().length > 0 })
  } else {
    // нет пермишена/устройств: соединяемся только на приём
    pc.addTransceiver('audio', { direction: 'recvonly' })
    if (withVideo) pc.addTransceiver('video', { direction: 'recvonly' })
    store().patch({ camOn: false })
  }
  sendMediaState()
}

async function handleSignal(d: Record<string, unknown>) {
  const call = store().call
  if (!call || !pc) return
  // media-state собеседника (tweb шлёт его в DataChannel; у нас — тем же реле)
  const media = d.media as { muted?: boolean; cam_on?: boolean } | undefined
  if (media) {
    store().patch({ remoteMuted: !!media.muted, remoteCamOn: !!media.cam_on })
    return
  }
  const sdp = d.sdp as RTCSessionDescriptionInit | undefined
  if (sdp) {
    // perfect negotiation: impolite (звонящий) игнорирует чужой offer при glare,
    // polite (отвечающий) откатывает свой — ровно как rollback в tweb.
    const collision = sdp.type === 'offer' && (makingOffer || pc.signalingState !== 'stable')
    ignoreOffer = !polite && collision
    if (ignoreOffer) return
    await pc.setRemoteDescription(sdp)
    for (const c of pendingCandidates) await pc.addIceCandidate(c).catch(() => {})
    pendingCandidates = []
    if (sdp.type === 'offer') {
      await pc.setLocalDescription()
      sendFrame('call_signal', { sdp: pc.localDescription!.toJSON() })
    }
    return
  }
  const ice = d.ice as RTCIceCandidateInit | undefined
  if (ice) {
    if (!pc.remoteDescription) pendingCandidates.push(ice)
    else await pc.addIceCandidate(ice).catch(() => { if (!ignoreOffer) throw new Error('bad ice') })
  }
}

// ── публичное API (UI) ──

export function startOutgoing(peer: CallPeer, video: boolean, chatId: number | null = null) {
  if (store().call) return // уже в звонке
  const callId = crypto.randomUUID()
  useCallStore.getState().set({
    callId, peer, chatId, outgoing: true, video, phase: 'outgoing',
    muted: false, camOn: video, screenOn: false, remoteMuted: false, remoteCamOn: false,
    connectedAt: null, localStream: null, remoteStream: null,
  })
  polite = false // звонящий — impolite (tweb: incoming сторона делает rollback)
  playSound('call_outgoing', { loop: true })
  sendFrame('call_request', { video })
  ringTimer = setTimeout(() => { sendFrame('call_end', {}); finish('missed') }, RING_TIMEOUT_MS)
}

export function accept() {
  const call = store().call
  if (!call || call.phase !== 'incoming') return
  clearRingTimer()
  polite = true
  sendFrame('call_accept', {})
  void startRtc(call.video)
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
  sendFrame('call_end', {})
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
    if (videoSender?.track && localStream?.getVideoTracks().includes(videoSender.track)) {
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
    // имя/аватар звонящего подтягиваем асинхронно
    useCallStore.getState().set({
      callId, peer: { id: from, name: `ID ${from}`, avatar: 'var(--tg-accent)' },
      chatId: null, outgoing: false, video, phase: 'incoming',
      muted: false, camOn: video, screenOn: false, remoteMuted: false, remoteCamOn: false,
      connectedAt: null, localStream: null, remoteStream: null,
    })
    void managers().peers.getUsers([from]).then((users) => {
      const u = users[0]
      const cur = store().call
      if (u && cur && cur.callId === callId) {
        store().patch({
          peer: {
            id: from, name: u.displayName,
            avatar: cur.peer.avatar, avatarText: u.displayName.charAt(0).toUpperCase(),
            avatarUrl: u.avatarUrl || undefined,
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

  // остальные кадры относятся только к текущему звонку
  if (!call || (callId && call.callId !== callId)) return

  switch (t) {
    case 'call_accept':
      if (call.outgoing && call.phase === 'outgoing') {
        clearRingTimer()
        void startRtc(call.video)
      }
      break
    case 'call_decline':
      clearRingTimer()
      finish(d.reason === 'busy' ? 'busy' : 'declined')
      break
    case 'call_end':
      finish('hangup')
      break
    case 'call_signal':
      void handleSignal(d)
      break
  }
}
