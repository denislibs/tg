// StoryMediaAreas — интерактивные области поверх истории (tweb MediaArea).
// Координаты в процентах бокса медиа: x/y — ЦЕНТР области, w/h — размер, rotation —
// градусы. Ветвление идёт по КОНСТРУКТОРУ области, а не по строке `type`:
// mediaAreaGeoPoint/mediaAreaVenue → открыть карту; mediaAreaSuggestedReaction →
// поставить реакцию; mediaAreaUrl → открыть ссылку (через safeUrl-allow-list).
// Клик по области не должен мешать tap-навигации вне её границ — поэтому слой
// pointer-events:none, а сами области — auto.
import Emoji from './emoji/Emoji'
import Text from '../shared/ui/Text'
import { safeUrl } from '../core/safeUrl'
import type { MediaArea } from '../core/stories/story'
import type { GeoPoint } from '../core/media/messageMedia'

function openExternal(url: string | undefined) {
  const u = safeUrl(url)
  if (u) window.open(u, '_blank', 'noopener,noreferrer')
}

// Google Maps по координатам (https → безопасно, tweb makeGoogleMapsUrl).
// Точка приезжает СТУПЕНЬЮ `geoPoint` — той же, что у гео-вложения сообщения.
function mapsUrl(geo: GeoPoint): string {
  return `https://www.google.com/maps?q=${geo.lat},${geo.long}`
}

export default function StoryMediaAreas({
  areas,
  reactionsCount,
  onReaction,
}: {
  areas: MediaArea[]
  reactionsCount: number
  onReaction: (emoji: string) => void
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}>
      {areas.map((a, i) => {
        const c = a.coordinates
        const style: React.CSSProperties = {
          position: 'absolute',
          left: `${c.x}%`,
          top: `${c.y}%`,
          width: `${c.w}%`,
          height: `${c.h}%`,
          transform: `translate(-50%, -50%) rotate(${c.rotation || 0}deg)`,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }
        if (a._ === 'mediaAreaSuggestedReaction') {
          // Эмодзи наклейки — объединение `Reaction`; платная реакция наклейкой
          // не бывает, поэтому спрашиваем именно эмодзи-конструктор.
          const emoticon = a.reaction._ === 'reactionEmoji' ? a.reaction.emoticon : ''
          const dark = a.pFlags?.dark === true
          return (
            <div
              key={i}
              style={style}
              role="button"
              aria-label="Story.React"
              onClick={(e) => { e.stopPropagation(); if (emoticon) onReaction(emoticon) }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '6px 10px', borderRadius: 999,
                  background: dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)',
                  transform: a.pFlags?.flipped ? 'scaleX(-1)' : undefined,
                }}
              >
                <Emoji e={emoticon || '❤'} size={26} />
                {reactionsCount > 0 && (
                  <Text size={13} weight={700} color={dark ? '#fff' : '#000'}>{reactionsCount}</Text>
                )}
              </div>
            </div>
          )
        }
        if (a._ === 'mediaAreaGeoPoint' || a._ === 'mediaAreaVenue') {
          // Подпись есть только у места (`mediaAreaVenue`): у точки её в схеме нет.
          const title = a._ === 'mediaAreaVenue' ? (a.title || a.address) : ''
          return (
            <div
              key={i}
              style={style}
              role="button"
              aria-label={title || 'AttachLocation'}
              onClick={(e) => { e.stopPropagation(); openExternal(mapsUrl(a.geo)) }}
            >
              <div style={{ padding: '4px 10px', borderRadius: 12, background: 'rgba(0,0,0,0.45)', maxWidth: '100%' }}>
                <Text noWrap color="#fff" size={13} weight={600}>📍 {title || 'AttachLocation'}</Text>
              </div>
            </div>
          )
        }
        // mediaAreaUrl
        return (
          <div
            key={i}
            style={style}
            role="button"
            aria-label={a.url || 'SetUrlPlaceholder'}
            onClick={(e) => { e.stopPropagation(); openExternal(a.url) }}
          >
            <div style={{ padding: '4px 10px', borderRadius: 12, background: 'rgba(0,0,0,0.45)', maxWidth: '100%' }}>
              <Text noWrap color="#fff" size={13} weight={600}>🔗 {a.url}</Text>
            </div>
          </div>
        )
      })}
    </div>
  )
}
