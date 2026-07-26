// Настройки → «Динамики и камера»: реальные устройства (enumerateDevices),
// живой уровень микрофона, превью камеры и тумблер приёма звонков. Выбор
// сохраняется в settings (speakerId/micId/cameraId/acceptCalls) — при
// реализации звонков CallProvider читает эти deviceId.
import { useEffect, useRef, useState } from 'react'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { useSettings } from '../../settings'
import { SettingsScreen, Section, Row } from './kit'
import { applyDeviceToActiveCall } from '../../core/calls/callEngine'
import Popup from '../../shared/ui/Popup'
import s from './SpeakersCamera.module.scss'

type Kind = 'speaker' | 'mic' | 'camera'

const DEVICE_KIND: Record<Kind, MediaDeviceKind> = {
  speaker: 'audiooutput',
  mic: 'audioinput',
  camera: 'videoinput',
}
const PICKER_TITLE: Record<Kind, string> = {
  speaker: 'Speaker',
  mic: 'Microphone',
  camera: 'Camera',
}

export default function SpeakersCamera({ onBack }: { onBack: () => void }) {
  const t = useT()
  const { speakerId, micId, cameraId, acceptCalls, update } = useSettings()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [picker, setPicker] = useState<Kind | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const levelRef = useRef<HTMLDivElement>(null)

  // tweb: список обновляется живьём при подключении/отключении устройств
  useEffect(() => {
    const refresh = () => {
      void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDevices([]))
    }
    refresh()
    navigator.mediaDevices.addEventListener?.('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refresh)
  }, [])

  // Аудиопоток выбранного микрофона → живая полоска уровня (Analyser + rAF,
  // ширина пишется в DOM напрямую — без setState на каждый кадр).
  useEffect(() => {
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let cancelled = false
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { deviceId: { exact: micId } } : true,
        })
      } catch {
        return // нет пермишена/устройства — полоска остаётся пустой
      }
      if (cancelled) {
        stream.getTracks().forEach((tr) => tr.stop())
        return
      }
      // после пермишена enumerateDevices отдаёт полные названия
      void navigator.mediaDevices.enumerateDevices().then((d) => { if (!cancelled) setDevices(d) })
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128)
        if (levelRef.current) levelRef.current.style.width = `${Math.min(100, Math.round(peak * 140))}%`
        raf = requestAnimationFrame(tick)
      }
      tick()
    }
    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
      void ctx?.close().catch(() => {})
    }
  }, [micId])

  // Видеопоток выбранной камеры → зеркальное превью (tweb зеркалит локальное видео).
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId ? { deviceId: { exact: cameraId } } : true,
        })
      } catch {
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((tr) => tr.stop())
        return
      }
      if (videoRef.current) videoRef.current.srcObject = stream
      void navigator.mediaDevices.enumerateDevices().then((d) => { if (!cancelled) setDevices(d) })
    }
    void start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [cameraId])

  const selectedId: Record<Kind, string> = { speaker: speakerId, mic: micId, camera: cameraId }
  const deviceName = (kind: Kind) => {
    const id = selectedId[kind]
    if (!id) return t('Default')
    return devices.find((d) => d.deviceId === id)?.label || t('Default')
  }
  const save = (kind: Kind, id: string) => {
    if (kind === 'speaker') update({ speakerId: id }) // динамик live: CallScreen следит за speakerId
    else if (kind === 'mic') { update({ micId: id }); void applyDeviceToActiveCall('mic', id) }
    else { update({ cameraId: id }); void applyDeviceToActiveCall('camera', id) }
    setPicker(null)
  }

  return (
    <SettingsScreen title="Speakers and Camera" onBack={onBack}>
      <Section caption="Speaker">
        <Row label="Playback device" value={deviceName('speaker')} onClick={() => setPicker('speaker')} />
      </Section>

      <Section caption="Microphone">
        <Row label="Recording device" value={deviceName('mic')} onClick={() => setPicker('mic')} />
        <div className={s.levelTrack}>
          <div ref={levelRef} className={s.levelFill} />
        </div>
      </Section>

      <Section caption="Camera">
        <Row label="Device" value={deviceName('camera')} onClick={() => setPicker('camera')} />
        <div className={s.preview}>
          <video ref={videoRef} autoPlay muted playsInline className={s.video} />
        </div>
      </Section>

      <Section footer="Turn this off to stop receiving calls and group video calls on this device.">
        <Row
          label="Accept calls on this device"
          toggle
          checked={acceptCalls}
          onClick={() => update({ acceptCalls: !acceptCalls })}
        />
      </Section>

      {picker && (
        <DevicePicker
          title={t(PICKER_TITLE[picker])}
          options={[
            { id: '', label: t('Default') },
            ...devices
              .filter((d) => d.kind === DEVICE_KIND[picker] && d.deviceId && d.deviceId !== 'default')
              .map((d) => ({ id: d.deviceId, label: d.label || d.deviceId.slice(0, 12) })),
          ]}
          selected={selectedId[picker]}
          onSave={(id) => save(picker, id)}
          onClose={() => setPicker(null)}
        />
      )}
    </SettingsScreen>
  )
}

// Модалка выбора устройства: общий Popup + радио-список + «Сохранить».
function DevicePicker({
  title,
  options,
  selected,
  onSave,
  onClose,
}: {
  title: string
  options: { id: string; label: string }[]
  selected: string
  onSave: (id: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [value, setValue] = useState(selected)
  // exit-анимация Popup: сохранение/закрытие гасят open, владелец размонтирует
  // в onExitComplete (выбор применяется тоже там — когда карточка уехала)
  const [open, setOpen] = useState(true)
  const saved = useRef<string | null>(null)
  return (
    <Popup
      open={open}
      title={title}
      onClose={() => setOpen(false)}
      onExitComplete={() => { if (saved.current != null) onSave(saved.current); else onClose() }}
      action={{ label: t('Save'), onClick: () => { saved.current = value; setOpen(false) } }}
    >
      <div className={s.options}>
        {options.map((o) => (
          <div key={o.id} className={s.option} onClick={() => setValue(o.id)}>
            <span className={s.radio} data-on={value === o.id || undefined} />
            <Text size={16} color="var(--tg-textPrimary)">{o.label}</Text>
          </div>
        ))}
      </div>
    </Popup>
  )
}
