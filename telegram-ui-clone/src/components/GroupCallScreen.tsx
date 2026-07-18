// Окно группового звонка — порт tweb PopupGroupCall (group-call, 420×640,
// тёмный #212121): заголовок (название + счётчик), список участников (аватар,
// имя, статус listening/muted зелёным/серым, видео-тайлы), кнопки Video /
// Mute (зелёный↔синий градиент) / Leave (красный).
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import Avatar from '../shared/ui/Avatar'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { useGroupCallStore } from '../stores/groupCallStore'
import { useChatsStore } from '../stores/chatsStore'
import { usePeers } from '../core/hooks/usePeers'
import { getLocalStream, getRemoteStream, leaveGroupCall, toggleGroupCam, toggleGroupMic } from '../core/calls/groupCallEngine'
import { gradientFor } from '../core/dialogToChat'
import { useT } from '../i18n'
import { EASE } from '../motion'
import s from './GroupCallScreen.module.scss'

function RemoteAudio({ userId, version }: { userId: number; version: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const stream = getRemoteStream(userId)
    if (ref.current && stream && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream
      void ref.current.play().catch(() => undefined)
    }
  }, [userId, version])
  return <audio ref={ref} autoPlay />
}

function VideoTile({ stream, label, muted }: { stream: MediaStream; label: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream
      void ref.current.play().catch(() => undefined)
    }
  }, [stream])
  return (
    <div className={s.videoTile}>
      <video ref={ref} autoPlay playsInline muted={muted} />
      <span className={s.videoLabel}>{label}</span>
    </div>
  )
}

export default function GroupCallScreen({ chatName }: { chatName: string }) {
  const t = useT()
  const chatId = useGroupCallStore((st) => st.chatId)
  const participants = useGroupCallStore((st) => st.participants)
  const micOn = useGroupCallStore((st) => st.micOn)
  const camOn = useGroupCallStore((st) => st.camOn)
  const version = useGroupCallStore((st) => st.streamsVersion)
  const meId = useChatsStore((st) => st.meId)
  const ids = Object.keys(participants).map(Number)
  const peers = usePeers(ids)

  if (chatId == null) return null

  const nameOf = (id: number) => peers.get(id)?.displayName || peers.get(id)?.username || `#${id}`
  const localStream = getLocalStream()
  const videoTiles: { stream: MediaStream; label: string; muted?: boolean }[] = []
  if (camOn && localStream && localStream.getVideoTracks().some((tr) => tr.enabled)) {
    videoTiles.push({ stream: localStream, label: t('You'), muted: true })
  }
  for (const id of ids) {
    const stream = getRemoteStream(id)
    if (participants[id]?.videoOn && stream && stream.getVideoTracks().length > 0) {
      videoTiles.push({ stream, label: nameOf(id) })
    }
  }

  return createPortal(
    <motion.div
      className={s.window}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <div className={s.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text noWrap size={16} weight={600} color="#fff">{chatName}</Text>
          <Text size={13} color="#aaa" style={{ display: 'block' }}>
            {ids.length + 1} {t('participants')}
          </Text>
        </div>
      </div>

      {videoTiles.length > 0 && (
        <div className={s.videoGrid} data-count={Math.min(videoTiles.length, 4)}>
          {videoTiles.map((v, i) => <VideoTile key={i} {...v} />)}
        </div>
      )}

      <div className={s.list}>
        {/* я */}
        <div className={s.row}>
          <Avatar background={gradientFor(meId ?? 0)} text="Я" size="md" />
          <div className={s.rowBody}>
            <Text noWrap size={15} weight={600} color="#fff">{t('You')}</Text>
            <Text size={13} color="#aaa">{t('This is you')}</Text>
          </div>
          <TgIcon name={micOn ? 'microphone_filled' : 'microphone_crossed_filled'} size={20} color={micOn ? '#5CC85E' : '#aaa'} />
        </div>
        {ids.map((id) => {
          const p = participants[id]
          return (
            <div key={id} className={s.row}>
              <RemoteAudio userId={id} version={version} />
              <Avatar background={gradientFor(id)} text={nameOf(id).charAt(0).toUpperCase()} size="md" />
              <div className={s.rowBody}>
                <Text noWrap size={15} weight={600} color="#fff">{nameOf(id)}</Text>
                <Text size={13} color={p?.muted ? '#aaa' : '#5CC85E'}>
                  {t(p?.muted ? 'muted' : 'listening')}
                </Text>
              </div>
              <TgIcon name={p?.muted ? 'microphone_crossed_filled' : 'microphone_filled'} size={20} color={p?.muted ? '#aaa' : '#5CC85E'} />
            </div>
          )
        })}
      </div>

      <div className={s.buttons}>
        <button className={classNames(s.btn, camOn ? s.btnActive : '')} onClick={() => void toggleGroupCam()} title={t('video')}>
          <TgIcon name={camOn ? 'videocamera_filled' : 'videocamera'} size={24} color="#fff" />
        </button>
        <button className={classNames(s.btnMic, micOn ? s.micOn : s.micOff)} onClick={toggleGroupMic}>
          <TgIcon name={micOn ? 'microphone_filled' : 'microphone_crossed_filled'} size={28} color="#fff" />
        </button>
        <button className={classNames(s.btn, s.btnLeave)} onClick={leaveGroupCall} title={t('Leave')}>
          <TgIcon name="close" size={24} color="#fff" />
        </button>
      </div>
    </motion.div>,
    document.body,
  )
}
