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

function StickerSetRow({
  set,
  covers,
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
  /** превью строки (covered sets, Task 2) — первые стикеры набора, приехавшие
   * ОДНИМ запросом со всей выдачей (useStickersSearch), без похода за полным
   * составом набора на каждую строку. Пусто — набор без стикеров или ответ
   * ещё не пришёл: ячейки остаются пустыми заглушками (см. ниже). */
  covers: Sticker[]
  installed: boolean
  busy: boolean
  /** строка попала во вьюпорт скроллера (запас — ROW_PRELOAD_MARGIN, высота строки) */
  visible: boolean
  /** ref-колбэк регистрации строки в общем IntersectionObserver экрана (useLazyVisibility) */
  register: (key: string, el: HTMLElement | null) => void
  /** общая на экран очередь загрузки (Task 3, tweb LazyLoadQueue) — по-прежнему
   * нужна: сами файлы превью (.tgs/.webm/картинка) качаются по видимости через
   * неё внутри StickerMedia, covers дают лишь метаданные и контур */
  queue: LazyLoadQueue
  onToggle: () => void
  onPickSticker?: (st: Sticker) => void
  /** клик по строке вне кнопки/превью — открыть StickerSetModal (tweb showStickersPopup) */
  onOpen: () => void
}) {
  const t = useT()

  // Живой геттер видимости ЭТОЙ строки — для приоритезации внутри очереди
  // загрузки ФАЙЛОВ превью (core/lazyLoadQueue.ts): проп `visible` меняется
  // только на РЕНДЕРАХ, а задача в очереди может ждать своей очереди дольше —
  // очереди нужен способ спросить «а сейчас?», а не то, каким visible был в
  // момент постановки.
  const visibleRef = useRef(visible)
  useEffect(() => { visibleRef.current = visible }, [visible])
  const isRowVisible = useCallback(() => visibleRef.current, [])

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
            прихода превью (covers), фиксированного размера (.sticker-set-sticker
            68×68, см. _rightSidebar.scss), и наполняются, как только придёт
            covers-выдача (Task 2) — строка не «схлопывается» на время запроса
            и список не дёргается. Пустая ячейка остаётся и после ответа, если
            для этого слота нет обложки (набор без стикеров, «усохший» набор). */}
        {Array.from({ length: Math.min(PREVIEW_COUNT, set.count) }, (_, i) => {
          const st = covers[i]
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
                  геометрию держит сама (fixed width/height, не по контенту).
                  Метаданные (covers) есть сразу у ВСЕХ строк выдачи — но сам
                  файл (.tgs/.webm/картинка) по-прежнему качается только по
                  видимости строки: `visible` гейтит именно монтирование
                  StickerMedia (и тем самым — вызов loadStickerContent внутри
                  неё), а не наличие данных для силуэта/thumb. Не будь этого
                  гейта, сотни строк вне вьюпорта стартовали бы закачку своих
                  файлов разом, как только приедет выдача — очередь бы просто
                  растянула их во времени (потолок 8), но не отменила вовсе. */}
              {st && visible && (
                <StickerMedia
                  mediaId={st.mediaId}
                  width={PREVIEW_SIZE}
                  height={PREVIEW_SIZE}
                  autoplay
                  loop
                  group="STICKERS-SEARCH"
                  thumb={st.thumb}
                  pathThumb={st.pathThumb}
                  docWidth={st.width}
                  docHeight={st.height}
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
  const { sets, covers, installedIds, busyIds, toggle, loading } = useStickersSearch(query)
  // Слаг открытого попапа набора (tweb showStickersPopup) — null, пока ни одна
  // строка не кликнута.
  const [openSlug, setOpenSlug] = useState<string | null>(null)

  // Одна очередь загрузки на весь экран (tweb `Stickers`: `const lazyLoadQueue
  // = new LazyLoadQueue()` в sidebarRight/tabs/stickers.tsx:25, отдаётся
  // каждому wrapSticker строки — :77): загрузка ФАЙЛОВ превью внутри
  // StickerMedia всех строк делит один и тот же лимит параллелизма (потолок
  // 8 — PARALLEL_LIMIT в core/lazyLoadQueue.ts). Состав набора (covers)
  // больше не грузится по сети отдельно на строку — приезжает одним пакетом
  // с самой выдачей (Task 2), через очередь не идёт.
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
                covers={covers.get(set.id) ?? []}
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
