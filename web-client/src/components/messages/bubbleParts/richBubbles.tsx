// src/components/messages/bubbleParts/richBubbles.tsx
// «Богатые» баблы: превью ссылки (+Instant View), блок проверки фактов, лог звонка,
// гео-локация (статичная/live) и контакт.
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import Text from '../../../shared/ui/Text'
import classNames from '../../../shared/lib/classNames'
import { useMediaUrl } from '../../../core/hooks/useMediaUrl'
import { useBlurThumb } from '../useBlurThumb'
import mediaSizes, { setAttachmentSize } from '../../../core/dom/mediaSizes'
import Avatar from '../../../shared/ui/Avatar'
import Spinner from '../../../shared/ui/Spinner'
import TgIcon from '../../TgIcon'
import RichText from '../../RichText'
import InstantView from '../../InstantView'
import { peerColor } from '../../peerColor'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import { useLiveShareStore } from '../../../stores/liveShareStore'
import { stopLiveShare } from '../../../core/liveShareEngine'
import type { IVArticle } from '../../../core/managers/ivManager'
import {
  getGeoFromMedia, getMediaDimensions, getStrippedThumb, hasServerThumb, isLiveGeoExpired,
  type MessageMediaGeoLive, type MyPhoto, type WebPage,
} from '../../../core/media/messageMedia'
import type { ConvMsg } from '../../../data'
import s from '../MessageBubbles.module.scss'

/**
 * Картинка карточки превью. Отдельный компонент, потому что тянет хуки
 * медиа-конвейера (URL из зеркала + канвас stripped-подложки), а рендерится
 * условно — в теле WebPagePreview хуки так вызывать нельзя.
 *
 * Дерево tweb (wrappers/webPage.tsx:69-91 + bubbles.ts:8112): resizer →
 * контейнер `.webpage-preview` (ему wrapPhoto добавляет `media-container`) →
 * само медиа `.media-photo`. Размер бокса — `setAttachmentSize` по
 * `mediaSizes.webpage`, как у tweb (boxWidth/boxHeight оттуда же).
 */
function WebPagePhoto({ photo, square }: { photo: MyPhoto; square: boolean }) {
  // Картинка карточки идёт ТЕМ ЖЕ путём, что фотография сообщения: ступень
  // выбирается лестницей (`hasServerThumb`/`getStrippedThumb`/
  // `getMediaDimensions`), а не пятью плоскими полями `photo_*` рядом с
  // карточкой. Это и есть то, что порт медиа не доделал в прошлый раз.
  const url = useMediaUrl(photo.id || null, { thumb: hasServerThumb(photo) })
  const hostRef = useBlurThumb(getStrippedThumb(photo), !!url)
  const dims = getMediaDimensions(photo)
  const { size } = setAttachmentSize({
    width: dims.w || 0,
    height: dims.h || 0,
    boxWidth: mediaSizes.active.webpage.width,
    boxHeight: mediaSizes.active.webpage.height,
    // tweb зовёт wrapPhoto карточки С сообщением (bubbles.ts:8221-8232), а
    // `message` — гейт минимальной ширины внутри setAttachmentSize
    hasMessage: true,
    // Медиа карточки здесь — ФОТО: ветка оригинала, которая её рисует, живёт
    // под `photo && !doc` (bubbles.ts:8184), и в setAttachmentSize уезжает
    // `photo` (MyPhoto). Значит дефолт натурального размера 100, не 512, и
    // внешний гейт минимумов истинен по ветке «не документ» — `isDocument`
    // остаётся false.
  })
  // tweb ставит квадратной картинке ровно 48px (bubbles.ts:8192).
  const box = square ? { width: SQUARE_PHOTO, height: SQUARE_PHOTO } : size
  return (
    <div className="webpage-preview-resizer">
      <div ref={hostRef} className="webpage-preview media-container" style={{ width: box.width, height: box.height }}>
        {url && <img className="media-photo" src={url} alt="" loading="lazy" decoding="async" />}
      </div>
    </div>
  )
}

/** tweb bubbles.ts:8189 — сторона квадратной картинки карточки */
const SQUARE_PHOTO = 48

/** link preview card (rendered inside a text bubble) */
export function WebPagePreview({ wp }: { wp: WebPage }) {
  const t = useT()
  const managers = useManagers()
  const [ivLoading, setIvLoading] = useState(false)
  const [ivArticle, setIvArticle] = useState<IVArticle | null>(null)
  // Клик → лоадер → статья; 422/сеть → просто открыть в новой вкладке. Кнопка
  // при этом рисуется только при wp.has_iv — сервер проверил, что статья
  // извлекается (tweb показывает футер лишь при webPage.cached_page).
  const openIV = async (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!wp.url || ivLoading) return
    setIvLoading(true)
    try {
      setIvArticle(await managers.iv.article(wp.url))
    } catch {
      window.open(wp.url, '_blank', 'noopener')
    } finally {
      setIvLoading(false)
    }
  }
  const hasText = !!(wp.site_name || wp.title || wp.description)
  const dims = wp.photo ? getMediaDimensions(wp.photo) : {}
  // tweb bubbles.ts:8188-8202: квадратная картинка при тексте рядом — 48px
  // врезкой (`has-square-photo`, float), вертикальная — своим классом;
  // остальные едут во всю ширину карточки.
  const square = !!wp.photo && !!dims.w && dims.w === dims.h && hasText
  const vertical = !!wp.photo && !!dims.h && !!dims.w && dims.h > dims.w && !square
  // tweb bubbles.ts:8341: `position = invertMedia || isSquare ? 'top' : 'bottom'`
  // — у обычной карточки картинка ПОД текстом, а не над ним. Флага invert_media
  // (Telegram «медиа сверху») у нас нет, поэтому решает только квадратность.
  const photo = wp.photo ? <WebPagePhoto photo={wp.photo} square={square} /> : null
  // Разметка tweb (wrappers/webPage.tsx:105-142): .webpage.quote-like >
  // .webpage-quote.quote-like-border > .webpage-content > (.webpage-preview-resizer,
  // .webpage-name, .webpage-title, .webpage-text, .webpage-footer).
  return (
    <div
      className={classNames(
        'webpage', 'quote-like',
        square ? 'has-square-photo' : '',
        vertical ? 'has-vertical-photo' : '',
      )}
    >
      <div className={classNames('webpage-quote', 'quote-like-border')}>
        <div className="webpage-content">
          {square && photo}
          <div className="webpage-name">{wp.site_name}</div>
          <div className="webpage-title">{wp.title}</div>
          {wp.description && <div className="webpage-text">{wp.description}</div>}
          {!square && photo}
          {wp.has_iv && wp.url && (
            <button type="button" className={classNames('webpage-footer', 'is-button', s.ivButton)} onClick={openIV}>
              {ivLoading ? <Spinner size={16} thickness={2} /> : <>⚡ {t('Instant View')}</>}
            </button>
          )}
        </div>
      </div>
      {ivArticle && wp.url && (
        <InstantView url={wp.url} article={ivArticle} onClose={() => setIvArticle(null)} />
      )}
    </div>
  )
}

/**
 * Блок «Проверка фактов» в бабле (tweb factCheck WebPageBox): акцентная полоса,
 * заголовок, текст через RichText (НЕ raw HTML) и футер. Длинный текст сворачивается
 * до «Показать больше» (эвристика по длине, tweb setLinesLimit).
 */
export function FactCheckBox({ fc, out, linkColor }: { fc: NonNullable<ConvMsg['factCheck']>; out: boolean; linkColor: string }) {
  const t = useT()
  const accent = out ? '#fff' : linkColor
  const [expanded, setExpanded] = useState(false)
  const collapsible = (fc.text?.text.length ?? 0) > 160
  return (
    <div
      className={classNames('bubble-fact-check', 'quote-like', 'quote-like-border', s.factCheck)}
      data-out={out || undefined}
    >
      <Text size={14} weight={600} color={accent}>{t('Fact Check')}</Text>
      <div className={classNames(s.factText, collapsible && !expanded ? s.clamped : '')}>
        <Text size={14.5} color="var(--wp-title)" style={{ lineHeight: 1.35 }}>
          <RichText text={fc.text?.text ?? ''} entities={fc.text?.entities} linkColor={out ? '#fff' : linkColor} />
        </Text>
      </div>
      {collapsible && !expanded && (
        <button type="button" className={s.factMore} style={{ color: accent }} onClick={(e) => { e.stopPropagation(); setExpanded(true) }}>
          {t('Show More')}
        </button>
      )}
      <Text size={12.5} color="var(--wp-desc)" style={{ marginTop: 2 }}>
        {fc.country ? t('This fact check was added by an admin.') + ` (${fc.country})` : t('This fact check was added by an admin.')}
      </Text>
    </div>
  )
}

/**
 * Лог 1:1 звонка (tweb .bubble-call): иконка телефона/камеры, заголовок,
 * стрелка (зелёная — состоялся, красная — нет) + длительность/причина, время + галочки.
 */
export function CallBubble({ m, out, time, reactions, onClick }: {
  m: ConvMsg
  out: boolean
  time?: ReactNode
  reactions?: ReactNode
  onClick?: () => void
}) {
  const t = useT()
  const call = m.call!
  const title = out
    ? (call.video ? t('Outgoing video call') : t('Outgoing call'))
    : (call.video ? t('Incoming video call') : t('Incoming call'))
  const sub =
    call.duration != null
      ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}`
      : call.reason === 'busy' ? t('Busy')
      : call.reason === 'missed' ? t('Missed call')
      : t('Cancelled call')
  return (
    <div
      className={s.callBubble}
      onClick={onClick}
      // Скругления/фон/тень — на `.bubble-content` снаружи (tweb): свои сюда
      // не дублируем, иначе получается второй контур из-под бабла.
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {/* tweb кладёт `.bubble-call` внутрь `.message` (bubbles.ts:8701) — отступы
          и точку отсчёта для времени даёт тело сообщения, а не padding бабла */}
      <div className={classNames('message', 'spoilers-container', s.msgBody)}>
        <div className={classNames('bubble-call', s.call)}>
          {/* tweb `.bubble-call-icon`: просто глиф слева абсолютом, без подложки,
              цветом текста бабла */}
          <TgIcon name={call.video ? 'videocamera' : 'phone'} className={classNames('bubble-call-icon', s.callIcon)} size="1.5rem" />
          <div className="bubble-call-title">{title}</div>
          <div className={classNames('bubble-call-subtitle', s.callSub)}>
            <TgIcon
              name="arrow_next"
              className={classNames('bubble-call-arrow', call.duration != null ? 'bubble-call-arrow-green' : 'bubble-call-arrow-red', s.callArrow, call.duration != null ? s.callArrowGreen : s.callArrowRed)}
              size="1rem"
            />
            {sub}
            {/* tweb: `subtitle.append(timeSpan)` (bubbles.ts:8693) — распорка едет
                flex-элементом в конце строки и резервирует место, видимая копия
                прибивается к нижне-правому углу тела сообщения */}
            {time}
          </div>
        </div>
        {reactions}
      </div>
    </div>
  )
}

// ── гео-бабл (tweb wrapGeo: .geo-container 277×195, ссылка на Google Maps) ──
// Статичная карта из OSM-тайлов (в tweb карту отдаёт MTProto webfile, вне Telegram
// недоступен); пин по центру, тап — makeGoogleMapsUrl 1:1.
const GEO_W = 277
const GEO_H = 195
const GEO_ZOOM = 15

/**
 * Гео-бабл. Вложение — ОДИН из трёх конструкторов, и вопрос «место это или
 * трансляция» задаётся конструктору, а не полям внутри одного объекта.
 *
 * ── «Трансляция закончилась» ────────────────────────────────────────────────
 * Флага у неё НЕТ и на проводе не было бы чем его подделать: конец выражается
 * ИСТЕЧЕНИЕМ СРОКА — `date + period <= now` (`isLiveGeoExpired`, порт tweb
 * `geo.ts:178-179`). Досрочная остановка приезжает укороченным `period`, то
 * есть тем же истечением. Прежний булев `geo.liveStopped` здесь был ВТОРЫМ
 * ответом на тот же вопрос — и разъезжался с первым, когда срок истекал сам.
 */
export function GeoBubble({ m, out, radius, time }: {
  m: ConvMsg
  out: boolean
  radius: string
  time?: ReactNode
}) {
  const managers = useManagers()
  const media = m.media
  const geoPoint = getGeoFromMedia(media)
  // Тикающие «сейчас» — только для live-локации (отсчёт + «обновлено N назад»).
  const [now, setNow] = useState(() => Date.now())
  const live: MessageMediaGeoLive | undefined = media?._ === 'messageMediaGeoLive' ? media : undefined
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  const activeShare = useLiveShareStore((st) => (m.peerId != null ? st.active[m.peerId] : undefined))
  if (!geoPoint) return null

  const lat = geoPoint.lat
  const lng = geoPoint.long
  const venue = media?._ === 'messageMediaVenue' ? media : undefined
  const isVenue = !!venue
  const isLive = !!live

  const date = m.date ?? 0
  const expired = !!live && isLiveGeoExpired(live, date, Math.floor(now / 1000))
  const sharingByMe = out && isLive && !expired && activeShare?.msgId === m.id
  const remainMin = Math.max(0, Math.round((date + (live?.period ?? 0) - now / 1000) / 60))
  // «Обновлено N назад» — время последней правки сообщения: своего времени у
  // гео в схеме нет вовсе, и второй колонки под него не заводится.
  const updatedAgoMin = m.editDate ? Math.max(0, Math.floor((now / 1000 - m.editDate) / 60)) : 0

  const T = 256
  const n = 2 ** GEO_ZOOM
  const latR = (lat * Math.PI) / 180
  const px = ((lng + 180) / 360) * n * T - GEO_W / 2
  const py = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * T - GEO_H / 2
  const tiles: { tx: number; ty: number; left: number; top: number }[] = []
  for (let tx = Math.floor(px / T); tx * T < px + GEO_W; tx++) {
    for (let ty = Math.floor(py / T); ty * T < py + GEO_H; ty++) {
      tiles.push({ tx, ty, left: tx * T - px, top: ty * T - py })
    }
  }
  return (
    <div className={s.geoWrap}>
      <a
        className={s.geoContainer}
        style={{ borderRadius: (isVenue || isLive) ? `${radius.split(' ')[0]} ${radius.split(' ')[0]} 0 0` : radius }}
        href={`https://maps.google.com/maps?q=${lat},${lng}`}
        target="_blank"
        rel="noreferrer"
      >
        {tiles.map((t) => (
          <img
            key={`${t.tx}:${t.ty}`}
            className={s.geoTile}
            src={`https://tile.openstreetmap.org/${GEO_ZOOM}/${t.tx}/${t.ty}.png`}
            style={{ left: t.left, top: t.top }}
            alt=""
            loading="lazy"
          />
        ))}
        <span className={s.geoPin} style={live?.heading != null ? { transform: `translate(-50%, -86%) rotate(${live.heading}deg)` } : undefined}>
          <TgIcon name={isLive ? 'livelocation' : 'location'} size={38} color={expired ? '#9e9e9e' : '#e53935'} />
        </span>
        {isLive && !expired && <span className={s.geoLiveBadge}>LIVE</span>}
        {time}
      </a>

      {venue && (
        <div className={s.geoFooter}>
          <Text size={15} weight={600} color="var(--b-primary)" noWrap>{venue.title}</Text>
          {venue.address && <Text size={13.5} color="var(--b-secondary)" noWrap>{venue.address}</Text>}
        </div>
      )}

      {isLive && (
        <div className={s.geoFooter}>
          {expired ? (
            <Text size={13.5} color="var(--b-secondary)">Трансляция окончена</Text>
          ) : (
            <>
              <div className={s.geoLiveRow}>
                <Text size={15} weight={600} color="var(--b-primary)">Трансляция геопозиции</Text>
                {sharingByMe && (
                  <span
                    className={s.geoStop}
                    onClick={(e) => { e.preventDefault(); if (m.peerId != null) stopLiveShare(managers, m.peerId) }}
                  >
                    Остановить
                  </span>
                )}
              </div>
              <Text size={13} color="var(--b-secondary)">
                {(updatedAgoMin <= 0 ? 'обновлено только что' : `обновлено ${updatedAgoMin} мин назад`) + ` · осталось ~${remainMin} мин`}
              </Text>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── бабл контакта (tweb .bubble.contact-message: аватар 54 + имя + телефон) ──
export function ContactBubble({ m, time, reactions, onOpen }: {
  m: ConvMsg
  time?: ReactNode
  reactions?: ReactNode
  /** клик по контакту — открыть чат/профиль (tweb contactDiv.dataset.peerId) */
  onOpen?: () => void
}) {
  if (m.media?._ !== 'messageMediaContact') return null
  const c = m.media
  // Имя визитки — СНИМОК на момент отправки, и в схеме он разложен на
  // first_name/last_name; у нас фамилия всегда пуста (храним одной строкой), но
  // пустая строка это ЗНАЧЕНИЕ, а не отсутствие параметра, — поэтому склейка, а
  // не чтение одного поля.
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
  const initials = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className={classNames('message', 'spoilers-container', s.contactBubble)}>
      {/* Дерево tweb (_chatBubble.scss:1319-1347): .contact > .contact-avatar +
          .contact-details > .contact-name + .contact-number */}
      <div className={classNames('contact', s.contactRow)} onClick={onOpen} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
        <div className="contact-avatar">
          <Avatar background={peerColor(name || String(c.user_id))} text={initials} size={54} />
        </div>
        <div className={classNames('contact-details', s.contactDetails)}>
          <div className="contact-name">{name || `#${c.user_id}`}</div>
          <div className="contact-number">{c.phone_number ? `+${c.phone_number.replace(/^\+/, '')}` : ''}</div>
        </div>
      </div>
      {time}
      {reactions}
    </div>
  )
}
