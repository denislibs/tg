// StoryMediaAreas — интерактивные области поверх истории (4d, tweb StoryMediaArea).
// Координаты в процентах бокса медиа: x/y — ЦЕНТР области, w/h — размер, rotation —
// градусы. geo/venue → открыть карту; reaction → поставить реакцию; url → открыть
// ссылку (через safeUrl-allow-list). Клик по области не должен мешать tap-навигации
// вне её границ — поэтому слой pointer-events:none, а сами области — auto.
import Emoji from './emoji/Emoji'
import Text from '../shared/ui/Text'
import { safeUrl } from '../core/safeUrl'
import type { MediaArea } from '../core/managers/storiesManager'

function openExternal(url: string | undefined) {
  const u = safeUrl(url)
  if (u) window.open(u, '_blank', 'noopener,noreferrer')
}

// Google Maps по координатам (https → безопасно, tweb makeGoogleMapsUrl).
function mapsUrl(lat?: number, long?: number): string {
  return `https://www.google.com/maps?q=${lat ?? 0},${long ?? 0}`
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
        if (a.type === 'reaction') {
          return (
            <div
              key={i}
              style={style}
              role="button"
              aria-label="React"
              onClick={(e) => { e.stopPropagation(); if (a.reaction) onReaction(a.reaction) }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '6px 10px', borderRadius: 999,
                  background: a.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)',
                  transform: a.flipped ? 'scaleX(-1)' : undefined,
                }}
              >
                <Emoji e={a.reaction ?? '❤'} size={26} />
                {reactionsCount > 0 && (
                  <Text size={13} weight={700} color={a.dark ? '#fff' : '#000'}>{reactionsCount}</Text>
                )}
              </div>
            </div>
          )
        }
        if (a.type === 'geo' || a.type === 'venue') {
          return (
            <div
              key={i}
              style={style}
              role="button"
              aria-label={a.title || 'Location'}
              onClick={(e) => { e.stopPropagation(); openExternal(mapsUrl(a.lat, a.long)) }}
            >
              <div style={{ padding: '4px 10px', borderRadius: 12, background: 'rgba(0,0,0,0.45)', maxWidth: '100%' }}>
                <Text noWrap color="#fff" size={13} weight={600}>📍 {a.title || a.address || 'Location'}</Text>
              </div>
            </div>
          )
        }
        // url
        return (
          <div
            key={i}
            style={style}
            role="button"
            aria-label={a.url || 'Link'}
            onClick={(e) => { e.stopPropagation(); openExternal(a.url) }}
          >
            <div style={{ padding: '4px 10px', borderRadius: 12, background: 'rgba(0,0,0,0.45)', maxWidth: '100%' }}>
              <Text noWrap color="#fff" size={13} weight={600}>🔗 {a.title || a.url}</Text>
            </div>
          </div>
        )
      })}
    </div>
  )
}
