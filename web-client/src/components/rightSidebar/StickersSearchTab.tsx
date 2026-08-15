// StickersSearchTab — экран «Поиск стикеров» правой колонки (порт tweb
// sidebarRight/tabs/stickers.tsx, живой DOM — дамп 19-emoticons-06):
// #stickers-container.chatlist-container, в шапке InputSearch «Search Stickers»,
// в скролле — div.sticker-sets со строками наборов:
//   div.sticker-set [data-sticker-set data-title]
//     div.sticker-set-header > div.sticker-set-details
//       (.sticker-set-name + .sticker-set-count) + button.sticker-set-button
//     div.sticker-set-stickers > ×5 div.sticker-set-sticker.media-sticker-wrapper
// Пустой запрос — трендовые наборы (наш GET /sticker-sets/featured), ввод —
// поиск наборов; Add/Added — toggleStickerSet (кнопка disabled на время
// запроса, установленный — «Added» + класс gray). Клик по превью-стикеру —
// отправка в текущий чат (tweb sendMessageWithDocument), на узком экране
// панель после отправки закрывается (симметрично GifsSearchTab). Клик по
// остальной части строки (не по кнопке и не по превью) — открывает
// `StickerSetModal` набора (tweb sidebarRight/tabs/stickers.tsx:172-198
// `attachClickEvent`: превью → send, кнопка → toggle, иначе → showStickersPopup).
// Отступление от tweb (нет аналога в нашем API): data-access_hash не рендерим —
// у наших наборов нет access_hash.
import { useCallback, useEffect, useRef, useState } from 'react'
import { openPopup } from '../../stores/popupStore'
import useMediaQuery from '../../shared/lib/useMediaQuery'
import { useT } from '../../i18n'
import { useStickersSearch } from '../../core/hooks/useStickersSearch'
import { useManagers } from '../../core/hooks/useManagers'
import { useMiddlewareHelper } from '../../core/hooks/useMiddlewareHelper'
import type { Sticker, StickerSet } from '../../core/managers/stickersManager'
import { createLazyLoadQueue, type LazyLoadQueue } from '../../core/lazyLoadQueue'
import { useLazyVisibility } from '../useLazyVisibility'
import StickerMedia from '../StickerMedia'
import StickerSetSkeleton from './StickerSetSkeleton'
import StickerSetModal from '../stickers/StickerSetModal'
import RightSearchTab, { RIGHT_SEARCH_POPUP_KIND, RightSearchPopup } from './RightSearchTab'

// Без скелетона первая загрузка (и любой новый поиск) на время запроса висит
// белым полотном под строкой поиска — выглядит как поломка (Task 6). Число
// строк — с запасом на высоту панели, под конкретный вьюпорт не подгоняем.
const SKELETON_COUNT = 6

// tweb stickers.tsx:58 — в строке набора ровно min(5, count) превью.
const PREVIEW_COUNT = 5
// tweb stickers.tsx:81-82 — превью 68×68.
const PREVIEW_SIZE = 68

// Запас предзагрузки строки — её собственная высота (не размер ячейки
// сетки модалки набора, у которой другая геометрия — ревью L3: экран поиска
// не должен зависеть от внутренностей StickerSetModal). Высота строки
// зафиксирована в CSS: `.sticker-set { height: 140px }`
// (styles/tweb/_rightSidebar.scss) — по образцу `ROW_H` в GifsMasonry.tsx,
// который берёт высоту ряда своей же кладки.
const ROW_PRELOAD_MARGIN = '140px 0px'

// Кэш стикеров набора на сессию: строки перемонтируются при каждом новом
// поиске, а состав набора в рамках сессии не меняется.
const setStickersCache = new Map<string, Promise<Sticker[]>>()

function loadSetStickers(
  managers: ReturnType<typeof useManagers>,
  slug: string,
  queue: LazyLoadQueue,
  isVisible: () => boolean,
): Promise<Sticker[]> {
  let p = setStickersCache.get(slug)
  if (!p) {
    // Сам запрос идёт через общую на экран очередь (Task 3) — как и загрузка
    // превью внутри StickerMedia ниже, одним лимитом на оба уровня; кэш-хит
    // (набор уже запрашивался) возвращает существующий промис МИМО очереди —
    // повторная прокрутка к уже открытому набору не должна ждать своей
    // очереди за то, что уже приехало. `isVisible` — приоритезация внутри
    // очереди (см. core/lazyLoadQueue.ts): строка, прокрученная мимо ПОСЛЕ
    // постановки в очередь, уступает место той, что сейчас перед глазами.
    p = queue.push(() => managers.stickers.setBySlug(slug), isVisible).then((r) => r.stickers)
    p.catch(() => setStickersCache.delete(slug)) // упавшую загрузку (в т.ч. queue.clear()) не кэшировать
    setStickersCache.set(slug, p)
  }
  return p
}

function StickerSetRow({
  set,
  installed,
  busy,
  visible,
  register,
  queue,
  onToggle,
  onPickSticker,
  onOpen,
}: {
  set: StickerSet
  installed: boolean
  busy: boolean
  /** строка попала во вьюпорт скроллера (запас — ROW_PRELOAD_MARGIN, высота строки) */
  visible: boolean
  /** ref-колбэк регистрации строки в общем IntersectionObserver экрана (useLazyVisibility) */
  register: (key: string, el: HTMLElement | null) => void
  /** общая на экран очередь загрузки (Task 3, tweb LazyLoadQueue) */
  queue: LazyLoadQueue
  onToggle: () => void
  onPickSticker?: (st: Sticker) => void
  /** клик по строке вне кнопки/превью — открыть StickerSetModal (tweb showStickersPopup) */
  onOpen: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  const [stickers, setStickers] = useState<Sticker[]>([])

  // Живой геттер видимости ЭТОЙ строки — для приоритезации внутри очереди
  // (core/lazyLoadQueue.ts): проп `visible` меняется только на РЕНДЕРАХ, а
  // задача в очереди может ждать своей очереди дольше — очереди нужен способ
  // спросить «а сейчас?», а не то, каким visible был в момент постановки.
  const visibleRef = useRef(visible)
  useEffect(() => { visibleRef.current = visible }, [visible])
  const isRowVisible = useCallback(() => visibleRef.current, [])

  // Состав набора запрашивается ТОЛЬКО когда строка видима — иначе выдача
  // из десятков наборов на маунте залпом бьёт setBySlug по каждому, хотя во
  // вьюпорте видно 3-4 строки. Эффект перезапускается при каждой смене
  // visible, но реальный сетевой запрос уходит ровно один раз на slug —
  // `loadSetStickers` отдаёт уже созданный промис из кэша при возврате
  // строки во вьюпорт повторно (прокрутка туда-обратно дублей не рождает).
  // Актуальность ответа — дочерний scope middleware (web-client/CLAUDE.md
  // «Асинхронщина и актуальность»), а не ручной alive-флаг: он гасится в
  // cleanup КАЖДОГО прогона (смена visible, размонтирование), запросу нового
  // поколения принадлежит свежий scope.
  useEffect(() => {
    if (!visible) return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    loadSetStickers(managers, set.slug, queue, isRowVisible).then(
      (sts) => { if (middleware()) setStickers(sts.slice(0, PREVIEW_COUNT)) },
      () => {},
    )
    return () => { scope.destroy() }
  }, [managers, set.slug, visible, queue, isRowVisible, middlewareHelper])

  // ref стабилен: инлайновая стрелка меняла бы идентичность на каждый рендер,
  // React отцеплял бы и прицеплял узел заново на каждый чих — тот же приём,
  // что и у StickerCell в StickerSetModal.
  const rowRef = useCallback((el: HTMLDivElement | null) => register(set.slug, el), [register, set.slug])

  return (
    <div ref={rowRef} className="sticker-set" data-sticker-set={set.id} data-title={set.title} onClick={onOpen}>
      <div className="sticker-set-header">
        <div className="sticker-set-details">
          <div className="sticker-set-name" dir="auto">{set.title}</div>
          <div className="sticker-set-count">
            <span className="i18n">{set.count} {t('stickers')}</span>
          </div>
        </div>
        {/* tweb: установленный — «Added» + класс gray; disabled на время запроса;
            stopPropagation — иначе клик по кнопке всплыл бы до onOpen (tweb
            `e.preventDefault(); e.cancelBubble = true` в attachClickEvent) */}
        <button
          className={`btn-primary btn-color-primary sticker-set-button${installed ? ' gray' : ''}`}
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); onToggle() }}
        >
          <span className="i18n">{t(installed ? 'Added' : 'Add')}</span>
        </button>
      </div>
      <div className="sticker-set-stickers">
        {/* tweb stickers.tsx:57-64 — ровно min(5, count) ячеек создаются ДО
            ответа за составом набора, фиксированного размера (.sticker-set-sticker
            68×68, см. _rightSidebar.scss), и наполняются по мере прихода
            стикеров (stickers.tsx:66-87) — строка не «схлопывается» на время
            запроса и список не дёргается по мере подгрузки. */}
        {Array.from({ length: Math.min(PREVIEW_COUNT, set.count) }, (_, i) => {
          const st = stickers[i]
          return (
            <div
              key={i}
              data-testid="sticker-set-cell"
              className="sticker-set-sticker media-sticker-wrapper"
              data-doc-id={st?.mediaId}
              onClick={(e) => {
                // Гасим клик ВСЕГДА, а не только когда контент уже приехал — tweb
                // (findUpClassName(target, 'sticker-set-sticker') в attachClickEvent)
                // ловит клик по ячейке независимо от dataset.docId и делает return,
                // так и не доходя до onOpen; иначе клик по ещё не наполненному
                // (или навсегда пустому — набор усох ниже count) слоту всплывает
                // на строку и открывает StickerSetModal.
                e.stopPropagation()
                if (st) onPickSticker?.(st)
              }}
            >
              {/* превью — play:true, loop:true (tweb wrapSticker в этом экране);
                  пока стикер для этого слота не приехал — ячейка пустая, но
                  геометрию держит сама (fixed width/height, не по контенту) */}
              {st && (
                <StickerMedia
                  mediaId={st.mediaId}
                  width={PREVIEW_SIZE}
                  height={PREVIEW_SIZE}
                  autoplay
                  loop
                  group="STICKERS-SEARCH"
                  thumb={st.thumb}
                  pathThumb={st.pathThumb}
                  loadQueue={queue}
                  isVisible={isRowVisible}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function StickersSearchTab({
  onPickSticker,
  onClose,
}: {
  /** отправка стикера в текущий чат (проводка — как onPickSticker Composer'а) */
  onPickSticker?: (st: Sticker) => void
  onClose: () => void
}) {
  const t = useT()
  const narrow = useMediaQuery('(max-width:900px)')
  const [query, setQuery] = useState('')
  const { sets, installedIds, busyIds, toggle, loading } = useStickersSearch(query)
  // Слаг открытого попапа набора (tweb showStickersPopup) — null, пока ни одна
  // строка не кликнута.
  const [openSlug, setOpenSlug] = useState<string | null>(null)

  // Одна очередь загрузки на весь экран (tweb `Stickers`: `const lazyLoadQueue
  // = new LazyLoadQueue()` в sidebarRight/tabs/stickers.tsx:25, отдаётся
  // каждому wrapSticker строки — :77) — и запрос состава набора, и загрузка
  // превью внутри StickerMedia делят один и тот же лимит параллелизма.
  const [queue] = useState<LazyLoadQueue>(() => createLazyLoadQueue())
  useEffect(() => {
    // На закрытии экрана снимаем ещё не начатые задачи — иначе строки,
    // прокрученные мимо и так и не дождавшиеся своей очереди, продолжали бы
    // качать данные уже закрытой панели (tweb `clear()` — тот же смысл).
    return () => queue.clear()
  }, [queue])

  // Корень наблюдения — сам скроллер вкладки (тот же элемент, что рисует
  // RightSearchTab через `scrollRef`), запас предзагрузки — своя высота
  // строки (ROW_PRELOAD_MARGIN), а не чужая — сетки модалки набора.
  const scrollRef = useRef<HTMLDivElement>(null)
  const { visible, register } = useLazyVisibility(scrollRef, ROW_PRELOAD_MARGIN)

  const pick = onPickSticker
    ? (st: Sticker) => {
        onPickSticker(st)
        // мобильный tweb закрывает правую колонку после отправки
        if (narrow) onClose()
      }
    : undefined

  return (
    <RightSearchTab
      id="stickers-container"
      containerClassName="chatlist-container"
      placeholder={t('Search Stickers')}
      value={query}
      onChange={setQuery}
      onClose={onClose}
      scrollRef={scrollRef}
    >
      <div className="sticker-sets">
        {loading && sets.length === 0
          ? <StickerSetSkeleton count={SKELETON_COUNT} />
          : sets.map((set) => (
              <StickerSetRow
                key={set.id}
                set={set}
                installed={installedIds.has(set.id)}
                busy={busyIds.has(set.id)}
                visible={visible.has(set.slug)}
                register={register}
                queue={queue}
                onToggle={() => toggle(set)}
                onPickSticker={pick}
                onOpen={() => setOpenSlug(set.slug)}
              />
            ))}
      </div>
      {openSlug && (
        <StickerSetModal
          slug={openSlug}
          onClose={() => setOpenSlug(null)}
          // Клик по стикеру внутри модалки шлёт его тем же путём, что и превью
          // строки набора (`pick` уже закрывает узкий экран после отправки) —
          // здесь модалка САМА закроется в StickerSetModal (см. её докблок).
          onPickSticker={pick}
        />
      )}
      {/* пустой div после списка — как в живом DOM (хвост tweb Scrollable) */}
      <div />
    </RightSearchTab>
  )
}

/** Публичный путь открытия извне — симметрично openGifsSearchTab (см. там). */
export function openStickersSearchTab(opts: { onPickSticker?: (st: Sticker) => void }) {
  return openPopup(
    (p) => (
      <RightSearchPopup api={p}>
        <StickersSearchTab onPickSticker={opts.onPickSticker} onClose={p.destroy} />
      </RightSearchPopup>
    ),
    RIGHT_SEARCH_POPUP_KIND,
  )
}
