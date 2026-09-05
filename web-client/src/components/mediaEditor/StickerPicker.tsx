// Пикер стикеров вкладки «stickers» медиа-редактора. Данные — из нашей общей
// инфраструктуры (useStickersPanel: recent + faved + установленные наборы через
// stickersManager), рендер — StickerMedia (тот же, что в чате/пикере эмодзи).
// Компактная тёмная сетка с навигацией по категориям (scroll-spy), как в
// StickersTab эмодзи-дропдауна, но в стилях самого редактора. Клик по стикеру →
// onPick добавляет слой. Поиска нет — у нашего sticker-API нет текстового
// поиска стикеров (только по эмодзи в саджестах композера), StickersTab
// дропдауна тоже без строки поиска; здесь тот же набор возможностей.
//
// Долг «фолбэк без WASM SIMD» (backlogs/frontend/lottie-no-wasm-fallback.md,
// «Отдельно и жирно: медиаредактор»): без SIMD движок tlottie не может
// декодировать lottie-стикер вовсе (`lottieLoader.ts` бросает NO_WASM ДО
// первого кадра), а один канвас-композер обслуживает и превью, и экспорт —
// добавленный такой стикер молча пропадает из сохранённого файла. Гасим
// причину, а не следствие: lottie-ячейки становятся недоступны для клика
// здесь же, в панели, ДО того как слой попал в сцену.
import { useEffect, useMemo, useRef, useState } from 'react'
import StickerMedia from '../StickerMedia'
import TgIcon, { type IconName } from '../TgIcon'
import { useStickersPanel } from '../../core/hooks/useStickers'
import type { Sticker } from '../../core/managers/stickersManager'
import { setThumbMediaId } from '../../core/stickers/setThumb'
import { isLottieMime } from '../../core/stickers/tgs'
import IS_WEB_ASSEMBLY_SIMD_SUPPORTED from '@environment/webAssemblySimdSupport'
import { useT } from '../../i18n'
import classNames from '../../shared/lib/classNames'
import s from './MediaEditor.module.scss'

interface Section {
  key: string
  title: string
  icon?: IconName
  thumb?: number
  stickers: Sticker[]
}

export default function StickerPicker({ onPick }: { onPick: (st: Sticker) => void }) {
  const t = useT()
  const panel = useStickersPanel(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const catElsRef = useRef(new Map<string, HTMLDivElement>())
  const [activeCat, setActiveCat] = useState('recent')

  const sections = useMemo<Section[]>(() => {
    const list: Section[] = []
    if (panel.recent.length) list.push({ key: 'recent', title: t('Emoji.Recent'), icon: 'recent', stickers: panel.recent })
    if (panel.faved.length) list.push({ key: 'faved', title: t('FavoriteStickers'), icon: 'favourites', stickers: panel.faved })
    for (const { set, stickers } of panel.sets) {
      if (stickers.length) list.push({ key: `set-${set.short_name}`, title: set.title, thumb: setThumbMediaId(set, stickers), stickers })
    }
    return list
  }, [panel.recent, panel.faved, panel.sets, t])

  // Scroll-spy активной категории (как в StickersTab эмодзи-дропдауна).
  const spyRaf = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(spyRaf.current)
    spyRaf.current = requestAnimationFrame(() => {
      const sc = scrollRef.current
      if (!sc) return
      const top = sc.scrollTop + 40
      let cur = sections[0]?.key
      for (const c of sections) {
        const el = catElsRef.current.get(c.key)
        if (el && el.offsetTop <= top) cur = c.key
      }
      if (cur) setActiveCat(cur)
    })
  }
  useEffect(() => () => cancelAnimationFrame(spyRaf.current), [])

  const scrollToCat = (key: string) => {
    const el = catElsRef.current.get(key)
    scrollRef.current?.scrollTo({ top: el ? el.offsetTop : 0, behavior: 'smooth' })
    setActiveCat(key)
  }

  const pick = (st: Sticker) => {
    // См. докблок вверху файла — lottie без WASM SIMD не добавляем вовсе.
    if (!IS_WEB_ASSEMBLY_SIMD_SUPPORTED && isLottieMime(st.mime_type)) return
    panel.markUsed(st)
    onPick(st)
  }

  return (
    <div className={s.stickerPicker}>
      <div className={s.stickerCats}>
        {sections.map((c) => (
          <button
            key={c.key}
            type="button"
            className={classNames(s.stickerCat, activeCat === c.key ? s.stickerCatActive : '')}
            onClick={() => scrollToCat(c.key)}
          >
            {c.icon
              ? <TgIcon name={c.icon} size={22} />
              : c.thumb != null
                ? <StickerMedia mediaId={c.thumb} width={22} height={22} />
                : null}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className={s.stickerScroll} onScroll={onScroll}>
        {sections.map((c) => (
          <div key={c.key} ref={(el) => { if (el) catElsRef.current.set(c.key, el); else catElsRef.current.delete(c.key) }}>
            <div className={s.stickerSectionTitle}>{c.title}</div>
            <div className={s.stickerGrid}>
              {c.stickers.map((st) => {
                const unsupported = !IS_WEB_ASSEMBLY_SIMD_SUPPORTED && isLottieMime(st.mime_type)
                return (
                  <span
                    key={st.id}
                    className={classNames(s.stickerCell, unsupported ? s.stickerCellDisabled : '')}
                    title={unsupported ? t('MediaEditor.StickerAnimatedUnsupported') : undefined}
                    onClick={() => pick(st)}
                  >
                    <StickerMedia doc={st} width={64} height={64} playOnHover={!unsupported} loop />
                  </span>
                )
              })}
            </div>
          </div>
        ))}
        {panel.loaded && sections.length === 0 && (
          <div className={s.stickerEmpty}>{t('NoStickersFound')}</div>
        )}
      </div>
    </div>
  )
}
