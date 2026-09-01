// Полноэкранный экран звонка (портал в body). Читает callStore, действия — у
// callEngine. Фазы по tweb PopupCall: входящий (accept/decline), исходящий
// (ringing), connecting, активный (mute/cam/end + таймер), ended (причина).
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import { useT } from '../i18n'
import Avatar from '../shared/ui/Avatar'
import { useCallStore } from '../stores/callStore'
import { useSettingsStore } from '../settings'
import { accept, decline, hangup, toggleMute, toggleCamera, toggleScreenShare } from '../core/calls/callEngine'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import s from './CallScreen.module.scss'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function CallScreen() {
  const t = useT()
  // Во время exit-анимации (AnimatePresence) стор уже null — рендерим последний
  // ненулевой снапшот, чтобы экран не крашился на закрытии.
  const live = useCallStore((st) => st.call)
  const lastRef = useRef(live)
  if (live) lastRef.current = live
  const call = lastRef.current!
  const speakerId = useSettingsStore((st) => st.speakerId)
  const avatarSrc = useMediaUrl(call.peer.photoId ?? null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const [secs, setSecs] = useState(0)
  const [sasOpen, setSasOpen] = useState(false)

  // таймер длительности от момента соединения
  useEffect(() => {
    if (call.phase !== 'active' || call.connectedAt == null) return
    const id = window.setInterval(() => setSecs(Math.floor((Date.now() - call.connectedAt!) / 1000)), 500)
    return () => window.clearInterval(id)
  }, [call.phase, call.connectedAt])

  // потоки → элементы
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = call.remoteStream
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = call.remoteStream
    // Когда видео-трек приходит в середине звонка, <video> монтируется только
    // сейчас — переустанавливаем srcObject после mount (эквивалент showRemoteVideo,
    // объявлен ниже; здесь inline, чтобы не попасть в TDZ).
  }, [call.remoteStream, call.phase === 'active' && call.remoteCamOn && !!call.remoteStream?.getVideoTracks().length])
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = call.localStream
  }, [call.localStream])

  // вывод звука на выбранный динамик (Настройки → Динамики и камера)
  useEffect(() => {
    const el = remoteAudioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el?.setSinkId && speakerId) void el.setSinkId(speakerId).catch(() => {})
  }, [speakerId, call.remoteStream])

  useEffect(() => {
    // preventDefault — сигнал глобальному Esc-фолбэку (core/hotkeys), что Esc обработан
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); hangup() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const endLabel: Record<string, string> = {
    hangup: t('Call.StatusEnded'), declined: t('Call.StatusDeclined'), busy: t('Call.StatusBusy'),
    missed: t('Call.StatusNoAnswer'), failed: t('StarsFailed'),
    privacy: t('Call.PrivacyError'),
  }
  const status =
    call.phase === 'incoming' ? (call.video ? t('CallMessageVideoIncoming') : t('CallMessageIncoming'))
    : call.phase === 'outgoing' ? t('Call.StatusRinging')
    : call.phase === 'connecting' ? t('Call.StatusConnecting')
    : call.phase === 'ended' ? endLabel[call.endReason ?? 'hangup']
    : fmt(secs)

  const active = call.phase === 'active'
  const gradient = active
    ? 'linear-gradient(135deg, #2faf86, #3bb2b8, #43cea2, #2a8f7a)'
    : 'linear-gradient(135deg, #6d5bd0, #3f7fd6, #8a5bff, #4f86e8)'

  const showRemoteVideo = active && call.remoteCamOn && !!call.remoteStream?.getVideoTracks().length
  const showLocalVideo = (call.camOn || call.screenOn) && !!call.localStream?.getVideoTracks().length

  const ctrlStyle: CSSProperties = {
    width: 54,
    height: 54,
    background: 'rgba(255,255,255,0.15)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    '--ib-hover': 'rgba(255,255,255,0.25)',
  } as CSSProperties
  const endStyle = { width: 64, height: 64, background: '#ff595a', '--ib-hover': '#e84a4b' } as CSSProperties

  return createPortal(
    <div className={s.root}>
      <div className={s.bg} style={{ background: gradient }} />
      <div className={s.scrim} />

      {/* E2E emoji-fingerprint (SAS): 4 эмодзи сверху-справа (модель Telegram-звонков).
          Обе стороны видят одинаковую цепочку — сверяют голосом против MITM. */}
      {call.phase !== 'ended' && call.e2eFingerprint && call.e2eFingerprint.length > 0 && (
        <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 6, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div
            role="button"
            tabIndex={0}
            aria-label={t('Call.EncryptionKey')}
            onClick={() => setSasOpen((v) => !v)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSasOpen((v) => !v) } }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              padding: '5px 10px', borderRadius: 999,
              background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <TgIcon name="lock" size={15} color="#fff" />
            <span style={{ fontSize: 18, lineHeight: 1, letterSpacing: 1 }}>
              {call.e2eFingerprint.slice(0, 4).join('')}
            </span>
          </div>
          {sasOpen && (
            <div style={{ maxWidth: 260, padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
              <Text size={13.5} color="#fff">
                {t('Call.EncryptionKeyHint')}
              </Text>
            </div>
          )}
        </div>
      )}

      {/* remote-медиа: звук всегда, видео — на весь экран когда есть */}
      <audio ref={remoteAudioRef} autoPlay />
      {showRemoteVideo && <video ref={remoteVideoRef} className={s.remoteVideo} autoPlay playsInline />}
      {showLocalVideo && (
        <video
          ref={localVideoRef}
          className={s.localVideo}
          style={call.screenOn ? { transform: 'none' } : undefined}
          autoPlay
          muted
          playsInline
        />
      )}

      {active && call.remoteMuted && (
        <div className={s.remoteMuted}>
          <Text size={13.5} color="#fff">{t('Call.MicrophoneOff')}</Text>
        </div>
      )}

      {!showRemoteVideo && (
        <div className={s.peer}>
          <Avatar background={call.peer.avatar} text={call.peer.avatarText ?? call.peer.name.charAt(0)} src={avatarSrc} size={136} />
          <Text size={28} weight={600}>{call.peer.name}</Text>
          <Text size={16} style={{ opacity: 0.85 }}>
            {call.video && active ? `${t('VideoCall')} · ${status}` : status}
          </Text>
        </div>
      )}

      <div className={s.controls}>
        {call.phase === 'incoming' ? (
          <>
            {/* принять (зелёная) / отклонить (красная) — tweb incoming pending */}
            <IconButton
              onClick={() => accept()}
              color="#fff"
              title={t('Call.Accept')}
              aria-label={t('Call.Accept')}
              style={{ width: 64, height: 64, background: '#4dcd5e', '--ib-hover': '#3fbd50' } as CSSProperties}
            >
              <TgIcon name="phone_filled" size={30} color="#fff" />
            </IconButton>
            <IconButton onClick={decline} color="#fff" title={t('Call.Decline')} aria-label={t('Call.Decline')} style={endStyle}>
              <TgIcon name="endcall_filled" size={30} color="#fff" />
            </IconButton>
          </>
        ) : call.phase === 'ended' ? null : (
          <>
            <IconButton
              onClick={toggleMute}
              color="#fff"
              title={call.muted ? t('VoipUnmute') : t('Call.Mute')}
              aria-label={call.muted ? t('VoipUnmute') : t('Call.Mute')}
              style={ctrlStyle}
            >
              {call.muted ? (
                <TgIcon name="microphone_crossed" size={26} color="#fff" />
              ) : (
                <TgIcon name="microphone_filled" size={26} color="#fff" />
              )}
            </IconButton>
            <IconButton
              onClick={() => void toggleCamera()}
              color="#fff"
              title={call.camOn ? t('Call.CameraOff') : t('Call.CameraOn')}
              aria-label={call.camOn ? t('Call.CameraOff') : t('Call.CameraOn')}
              style={ctrlStyle}
            >
              {call.camOn ? (
                <TgIcon name="videocamera" size={26} color="#fff" />
              ) : (
                <TgIcon name="videocamera_crossed_filled" size={26} color="#fff" />
              )}
            </IconButton>
            <IconButton
              onClick={() => void toggleScreenShare()}
              color="#fff"
              title={call.screenOn ? t('Call.StopScreenSharing') : t('Call.ShareScreen')}
              aria-label={call.screenOn ? t('Call.StopScreenSharing') : t('Call.ShareScreen')}
              style={call.screenOn ? { ...ctrlStyle, background: 'rgba(255,255,255,0.45)' } : ctrlStyle}
            >
              <TgIcon name="sharescreen_filled" size={26} color="#fff" />
            </IconButton>
            <IconButton onClick={hangup} color="#fff" title={t('CallSettings.EndCall')} aria-label={t('CallSettings.EndCall')} style={endStyle}>
              <TgIcon name="endcall_filled" size={30} color="#fff" />
            </IconButton>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
