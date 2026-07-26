// Пикер геолокации: интерактивная карта (Leaflet + OSM-тайлы), пин закреплён в
// центре (тянешь карту — двигаешь точку), кнопка «моё местоположение». Внизу —
// отправка выбранной точки (опц. название места → venue) и трансляция геопозиции
// (live location) на выбранный срок. В tweb-K нет map-picker'а — вёрстка своя на
// базе общего Popup, поведение как в мобильном Telegram (пин по центру).
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import TgIcon from './TgIcon'
import s from './LocationPicker.module.scss'

const DEFAULT_CENTER: [number, number] = [55.751244, 37.618423] // Москва — пока нет геолокации
const LIVE_DURATIONS: { label: string; secs: number }[] = [
  { label: '15 минут', secs: 15 * 60 },
  { label: '1 час', secs: 60 * 60 },
  { label: '8 часов', secs: 8 * 60 * 60 },
]

export default function LocationPicker({
  open, onClose, onExitComplete, onSend,
}: {
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
  /** отправить точку; livePeriod (сек) задаёт live-трансляцию, title — venue */
  onSend: (lat: number, lng: number, opts?: { title?: string; livePeriod?: number }) => void
}) {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const centerRef = useRef<[number, number]>(DEFAULT_CENTER)
  const [title, setTitle] = useState('')
  const [liveOpen, setLiveOpen] = useState(false)

  useEffect(() => {
    if (!open || !mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView(DEFAULT_CENTER, 14)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    map.on('move', () => {
      const c = map.getCenter()
      centerRef.current = [c.lat, c.lng]
    })
    mapRef.current = map
    // спросить текущую позицию и переехать на неё
    navigator.geolocation?.getCurrentPosition(
      (pos) => { map.setView([pos.coords.latitude, pos.coords.longitude], 16) },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    )
    // Leaflet считает размеры контейнера при создании; после анимации попапа
    // размер уже финальный — пересчитываем, иначе тайлы «съезжают».
    const t = setTimeout(() => map.invalidateSize(), 250)
    return () => { clearTimeout(t); map.remove(); mapRef.current = null }
  }, [open])

  const locateMe = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  const sendPoint = () => {
    const [lat, lng] = centerRef.current
    onSend(lat, lng, { title: title.trim() || undefined })
    onClose()
  }
  const sendLive = (secs: number) => {
    const [lat, lng] = centerRef.current
    onSend(lat, lng, { livePeriod: secs })
    onClose()
  }

  return (
    <Popup open={open} title="Местоположение" onClose={onClose} onExitComplete={onExitComplete} width={440}>
      <div className={s.mapWrap}>
        <div ref={mapEl} className={s.map} />
        <span className={s.pin}><TgIcon name="location" size={40} color="#e53935" /></span>
        <button className={s.locate} onClick={locateMe} title="Моё местоположение">
          <TgIcon name="location" size={22} color="var(--tg-accent)" />
        </button>
      </div>

      <div className={s.controls}>
        <Input label="Название места (необязательно)" value={title} onChange={setTitle} wrapClassName={s.field} />

        <div className={s.sendRow} onClick={sendPoint}>
          <TgIcon name="location" size={22} color="var(--tg-accent)" />
          <Text size={16} color="var(--tg-accent)">Отправить эту точку</Text>
        </div>

        {!liveOpen ? (
          <div className={s.sendRow} onClick={() => setLiveOpen(true)}>
            <TgIcon name="livelocation" size={22} color="var(--tg-accent)" />
            <Text size={16} color="var(--tg-accent)">Транслировать геопозицию</Text>
          </div>
        ) : (
          <div className={s.liveList}>
            <Text size={13} weight={600} color="var(--tg-textSecondary)" className={s.liveHint}>
              Транслировать в течение:
            </Text>
            {LIVE_DURATIONS.map((d) => (
              <div key={d.secs} className={s.sendRow} onClick={() => sendLive(d.secs)}>
                <TgIcon name="livelocation" size={22} color="var(--tg-accent)" />
                <Text size={16} color="var(--tg-textPrimary)">{d.label}</Text>
              </div>
            ))}
          </div>
        )}
      </div>
    </Popup>
  )
}
