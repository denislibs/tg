// Полноэкранный экран звонка (портал в body). Читает callStore, действия — у
// callEngine. Фазы по tweb PopupCall: входящий (accept/decline), исходящий
// (ringing), connecting, активный (mute/cam/end + таймер), ended (причина).
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import { EASE } from '../motion'
import { useT } from '../i18n'
import Avatar from '../shared/ui/Avatar'
import { useCallStore } from '../stores/callStore'
import { useSettingsStore } from '../settings'
import { accept, decline, hangup, toggleMute, toggleCamera, toggleScreenShare } from '../core/calls/callEngine'
import { useAvatarSrc } from './useAvatarSrc'
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
  const avatarSrc = useAvatarSrc(call.peer.avatarUrl)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const [secs, setSecs] = useState(0)

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
  }, [call.remoteStream])
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
    hangup: t('Call ended'), declined: t('Declined'), busy: t('Busy'),
    missed: t('No answer'), failed: t('Failed'),
    privacy: t("This user doesn't accept calls"),
  }
  const status =
    call.phase === 'incoming' ? (call.video ? t('Incoming video call') : t('Incoming call'))
    : call.phase === 'outgoing' ? t('Ringing…')
    : call.phase === 'connecting' ? t('Connecting…')
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
    <motion.div
      className={s.root}
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <motion.div
        className={s.bg}
        style={{ background: gradient }}
        animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
      />
      <div className={s.scrim} />

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
          <Text size={13.5} color="#fff">{t('Microphone is off')}</Text>
        </div>
      )}

      {!showRemoteVideo && (
        <div className={s.peer}>
          <Avatar background={call.peer.avatar} text={call.peer.avatarText ?? call.peer.name.charAt(0)} src={avatarSrc} size={136} />
          <Text size={28} weight={600}>{call.peer.name}</Text>
          <Text size={16} style={{ opacity: 0.85 }}>
            {call.video && active ? `${t('Video Call')} · ${status}` : status}
          </Text>
        </div>
      )}

      <div className={s.controls}>
        {call.phase === 'incoming' ? (
          <>
            {/* принять (зелёная) / отклонить (красная) — tweb incoming pending */}
            <IconButton
              onClick={() => void accept()}
              color="#fff"
              style={{ width: 64, height: 64, background: '#4dcd5e', '--ib-hover': '#3fbd50' } as CSSProperties}
            >
              <TgIcon name="phone_filled" size={30} color="#fff" />
            </IconButton>
            <IconButton onClick={decline} color="#fff" style={endStyle}>
              <TgIcon name="endcall_filled" size={30} color="#fff" />
            </IconButton>
          </>
        ) : call.phase === 'ended' ? null : (
          <>
            <IconButton onClick={toggleMute} color="#fff" style={ctrlStyle}>
              {call.muted ? (
                <TgIcon name="microphone_crossed" size={26} color="#fff" />
              ) : (
                <TgIcon name="microphone_filled" size={26} color="#fff" />
              )}
            </IconButton>
            <IconButton onClick={() => void toggleCamera()} color="#fff" style={ctrlStyle}>
              {call.camOn ? (
                <TgIcon name="videocamera" size={26} color="#fff" />
              ) : (
                <TgIcon name="videocamera_crossed_filled" size={26} color="#fff" />
              )}
            </IconButton>
            <IconButton
              onClick={() => void toggleScreenShare()}
              color="#fff"
              style={call.screenOn ? { ...ctrlStyle, background: 'rgba(255,255,255,0.45)' } : ctrlStyle}
            >
              <TgIcon name="sharescreen_filled" size={26} color="#fff" />
            </IconButton>
            <IconButton onClick={hangup} color="#fff" style={endStyle}>
              <TgIcon name="endcall_filled" size={30} color="#fff" />
            </IconButton>
          </>
        )}
      </div>
    </motion.div>,
    document.body,
  )
}
