// src/components/DatePickerPopup.tsx
//
// Пикер даты — порт tweb `components/popups/datePicker.tsx` + `_datePicker.scss`.
//
// Устройство 1:1 с оригиналом:
//  • список месяцев строится ЦЕЛИКОМ (от первой даты до сегодня), но высоты
//    считаются заранее, поэтому рендерятся только видимые секции — каждая
//    абсолютом со своим translateY (виртуализация без замеров layout);
//  • месяц — самостоятельный блок: заголовок, строка дней недели и сетка 7×N,
//    где пропуски до 1-го числа и после последнего заполнены спейсерами;
//  • ячейка — кнопка во всю колонку сетки, а видимый круг 2.5rem рисует ::before
//    (отсюда одинаковый hover/active и место под миниатюру);
//  • у дней, где в чате есть медиа, в круге показывается его миниатюра
//    (бэкенд-ручка /chats/{id}/calendar — аналог getSearchResultsCalendar);
//  • заголовок и стрелки ведёт «месяц под центром вьюпорта» (эвристика tdesktop
//    CalendarBox, которую tweb использует, чтобы стрелки не перескакивали).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Popup from '../shared/ui/Popup'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { mediaContentUrl, mediaThumbUrl, hasMediaToken, useMediaTokenVersion } from '../core/mediaUrl'
import { useManagers } from '../core/hooks/useManagers'
import { useT, useLang } from '../i18n'
import type { CalendarDay } from '../core/managers/messagesManager'
import s from './DatePickerPopup.module.scss'

// Геометрия — держать синхронно с DatePickerPopup.module.scss
// (--date-picker-cell: 2.5rem при html font-size 16px ⇒ 40px).
const CELL_HEIGHT = 40
const MONTH_LABEL_HEIGHT = 40
const WEEKDAY_HEIGHT = 40
const ROW_GAP = 4
const SCROLL_BUFFER_PX = 200 // запас строк сверху/снизу вьюпорта

const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const startOfDay = (d: Date) => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** Ячейка сетки: реальный день либо выравнивающий пропуск. */
type Cell =
  | { kind: 'day'; date: Date; disabled: boolean }
  | { kind: 'spacer'; key: string }

interface MonthSection {
  date: Date
  key: string
  cells: Cell[]
  height: number
  offset: number
}

// Выходные по локали пользователя: Intl.Locale.weekInfo (Chrome 130+/Safari 17+),
// с откатом на субботу+воскресенье — как в tweb getWeekendDays.
function getWeekendDays(lang: string): Set<number> {
  try {
    const locale = new Intl.Locale(lang) as Intl.Locale & {
      weekInfo?: { weekend: number[] }
      getWeekInfo?: () => { weekInfo?: { weekend: number[] }; weekend?: number[] }
    }
    const info = locale.getWeekInfo?.() ?? locale.weekInfo
    const weekend = (info as { weekend?: number[] } | undefined)?.weekend
    if (weekend?.length) {
      // Intl: 1=Пн … 7=Вс; JS Date.getDay(): 0=Вс … 6=Сб
      return new Set(weekend.map((d) => d % 7))
    }
  } catch {
    /* локаль без weekInfo — падаем на дефолт */
  }
  return new Set([0, 6])
}

// Месяц — самостоятельный блок: спейсеры до 1-го числа (неделя с понедельника)
// и после последнего, чтобы сетка всегда была кратна семи.
function buildMonthCells(month: Date, minDate: Date, maxDate: Date): Cell[] {
  const cells: Cell[] = []
  const first = startOfDay(new Date(month.getFullYear(), month.getMonth(), 1))
  const key = monthKey(first)

  let leading = first.getDay() - 1
  if (leading === -1) leading = 6
  for (let i = 0; i < leading; i++) cells.push({ kind: 'spacer', key: `${key}-pre-${i}` })

  const cursor = new Date(first)
  do {
    cells.push({
      kind: 'day',
      date: new Date(cursor),
      disabled: cursor < minDate || cursor > maxDate,
    })
    cursor.setDate(cursor.getDate() + 1)
  } while (cursor.getDate() !== 1)

  const remainder = cells.length % 7
  if (remainder) {
    for (let i = remainder; i < 7; i++) cells.push({ kind: 'spacer', key: `${key}-post-${i}` })
  }
  return cells
}

export interface DatePickerPopupProps {
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
  /** дата, на которой пикер открывается (мс) */
  initDate: number
  /** самая ранняя доступная дата (мс) — обычно дата первого сообщения чата */
  minDate?: number
  /** чат, из которого тянуть медиа-превью по дням; без него превью не грузятся */
  chatId?: number
  /** выбранный день (unix-секунды полуночи) */
  onPick: (timestamp: number) => void
}

export default function DatePickerPopup({
  open, onClose, onExitComplete, initDate, minDate, chatId, onPick,
}: DatePickerPopupProps) {
  const t = useT()
  const managers = useManagers()
  // Язык берём из приложения (как tweb I18n), а не из navigator — иначе месяцы
  // и дни недели рисуются на языке браузера, а не интерфейса.
  const [lang] = useLang()

  const today = useMemo(() => startOfDay(new Date()), [])
  // tweb datePicker.tsx:141 — дефолтная нижняя граница «01.08.2013» (запуск
  // Telegram): выбирать можно любой день истории, а не только день клика.
  const min = useMemo(() => startOfDay(new Date(minDate ?? Date.parse('2013-08-01T00:00:00'))), [minDate])
  const init = useMemo(() => startOfDay(new Date(initDate)), [initDate])
  const [selected, setSelected] = useState(() => startOfDay(new Date(initDate)))

  // Все месяцы от минимального до текущего; высоты известны заранее, поэтому
  // виртуализация обходится без замеров (tweb monthSections).
  const sections = useMemo<MonthSection[]>(() => {
    const list: MonthSection[] = []
    const cursor = new Date(min.getFullYear(), min.getMonth(), 1)
    const last = new Date(today.getFullYear(), today.getMonth(), 1)
    let offset = 0
    while (cursor <= last) {
      const cells = buildMonthCells(cursor, min, today)
      const rows = Math.ceil(cells.length / 7)
      // row-gap стоит только МЕЖДУ строками, поэтому для rows строк — rows-1 зазоров
      const height = MONTH_LABEL_HEIGHT + WEEKDAY_HEIGHT + rows * CELL_HEIGHT + Math.max(0, rows - 1) * ROW_GAP
      list.push({ date: new Date(cursor), key: monthKey(cursor), cells, height, offset })
      offset += height
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return list
  }, [min, today])

  const totalHeight = sections.length ? sections[sections.length - 1].offset + sections[sections.length - 1].height : 0

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  // Начальная позиция — месяц initDate; ставится до первого показа, чтобы не
  // анимировать прыжок (в tweb это делает queueMicrotask в onMount).
  const scrolledRef = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || scrolledRef.current || !sections.length) return
    scrolledRef.current = true
    const idx = Math.max(0, sections.findIndex((m) => m.key === monthKey(init)))
    el.scrollTop = sections[idx].offset
    setScrollTop(el.scrollTop)
    setViewportH(el.clientHeight)
  }, [sections, init, open])

  const visible = useMemo(() => {
    const top = scrollTop
    const bottom = top + Math.max(viewportH, CELL_HEIGHT * 6)
    const out: MonthSection[] = []
    for (const section of sections) {
      if (section.offset + section.height < top - SCROLL_BUFFER_PX) continue
      if (section.offset > bottom + SCROLL_BUFFER_PX) break
      out.push(section)
    }
    return out
  }, [sections, scrollTop, viewportH])

  // «Текущий» месяц — тот, чья полоса накрывает ЦЕНТР вьюпорта: по верхней
  // кромке заголовок врал бы у самого низа прокрутки (tweb topMostSection).
  const current = useMemo(() => {
    if (!sections.length) return undefined
    const probe = viewportH > 0 ? scrollTop + viewportH / 2 : scrollTop + 1
    return sections.find((m) => m.offset + m.height > probe) ?? sections[sections.length - 1]
  }, [sections, scrollTop, viewportH])

  const scrollToSection = useCallback((section: MonthSection) => {
    scrollRef.current?.scrollTo({ top: section.offset, behavior: 'smooth' })
  }, [])

  const currentIdx = current ? sections.indexOf(current) : -1
  const onPrev = () => currentIdx > 0 && scrollToSection(sections[currentIdx - 1])
  const onNext = () => currentIdx >= 0 && currentIdx < sections.length - 1 && scrollToSection(sections[currentIdx + 1])

  // ── медиа-превью по дням: грузим месяц, как только он попал во вьюпорт ──
  const [mediaByDay, setMediaByDay] = useState<Map<string, CalendarDay>>(new Map())
  const requested = useRef(new Set<string>())
  useEffect(() => {
    if (chatId == null) return
    for (const section of visible) {
      if (requested.current.has(section.key)) continue
      requested.current.add(section.key)
      void managers.messages.calendarMonth(chatId, Math.floor(section.date.getTime() / 1000)).then((days) => {
        if (!days.length) return
        setMediaByDay((prev) => {
          const next = new Map(prev)
          for (const d of days) next.set(dayKey(new Date(d.day * 1000)), d)
          return next
        })
      })
    }
  }, [visible, chatId, managers])

  const weekend = useMemo(() => getWeekendDays(lang), [lang])
  const weekdays = useMemo(() => {
    // Понедельник первым (tweb weekdayInfo)
    const base = new Date(2024, 0, 1) // понедельник
    const fmt = new Intl.DateTimeFormat(lang, { weekday: 'narrow' })
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      return { key: i, name: fmt.format(d).toUpperCase(), weekend: weekend.has(d.getDay()) }
    })
  }, [lang, weekend])

  const monthTitle = useMemo(
    () => (current ? new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' }).format(current.date) : ''),
    [current, lang],
  )

  return (
    <Popup
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      title={<span className={s.monthTitle}>{monthTitle}</span>}
      headerRight={
        <div className={s.controls}>
          <IconButton onClick={onPrev} disabled={currentIdx <= 0} title={t('Previous')}>
            <TgIcon name="up" size={24} />
          </IconButton>
          <IconButton onClick={onNext} disabled={currentIdx < 0 || currentIdx >= sections.length - 1} title={t('Next')}>
            <TgIcon name="down" size={24} />
          </IconButton>
        </div>
      }
      action={{
        label: t('Jump to Date'),
        onClick: () => {
          onPick(Math.floor(startOfDay(selected).getTime() / 1000))
          onClose()
        },
      }}
    >
      {/* tweb `withBorders="both"` (_scrollable.scss:128-143): линии сверху/снизу
          показываются, только когда прокрутка не упёрта в соответствующий край */}
      <div
        ref={scrollRef}
        className={classNames(
          s.scrollable,
          scrollTop <= 0 ? s.scrolledStart : '',
          scrollTop + viewportH >= totalHeight - 1 ? s.scrolledEnd : '',
        )}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className={s.months} style={{ height: totalHeight }}>
          {visible.map((section) => (
            <div
              key={section.key}
              className={s.monthSection}
              style={{ transform: `translateY(${section.offset}px)`, height: section.height }}
            >
              <div className={s.monthLabel}>
                {new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' }).format(section.date)}
              </div>
              <div className={s.weekdays}>
                {weekdays.map((w) => (
                  <div key={w.key} className={classNames(s.weekday, w.weekend ? s.danger : '')}>
                    {w.name}
                  </div>
                ))}
              </div>
              <div className={s.grid}>
                {section.cells.map((cell) =>
                  cell.kind === 'spacer' ? (
                    <div key={cell.key} className={s.spacer} />
                  ) : (
                    <DayCell
                      key={cell.date.getTime()}
                      cell={cell}
                      media={mediaByDay.get(dayKey(cell.date))}
                      active={startOfDay(selected).getTime() === cell.date.getTime()}
                      weekend={weekend.has(cell.date.getDay())}
                      onClick={() => setSelected(cell.date)}
                    />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Popup>
  )
}

// Ячейка дня: кнопка во всю колонку, круг рисует ::before, миниатюра медиа —
// поверх круга, но под номером дня (tweb .date-picker-month-date).
function DayCell({ cell, media, active, weekend, onClick }: {
  cell: Cell & { kind: 'day' }
  media?: CalendarDay
  active: boolean
  weekend: boolean
  onClick: () => void
}) {
  useMediaTokenVersion()
  // Миниатюра есть не у всякого медиа — тогда берём оригинал, иначе ?v=thumb
  // ответит 404 (бэкенд отдаёт has_thumb вместе с днём).
  const thumb = media && hasMediaToken()
    ? (media.has_thumb ? mediaThumbUrl(media.media_id) : mediaContentUrl(media.media_id))
    : undefined
  return (
    <button
      type="button"
      className={classNames(
        s.day,
        active ? s.active : '',
        thumb ? s.withMedia : '',
        weekend && !active ? s.danger : '',
      )}
      disabled={cell.disabled}
      onClick={onClick}
    >
      {thumb && (
        <span className={s.cellPhoto}>
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        </span>
      )}
      <span className={s.dayNum}>{cell.date.getDate()}</span>
    </button>
  )
}
