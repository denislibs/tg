import { useCallback, useState, type CSSProperties, type PointerEvent } from 'react'
import classNames from '../../lib/classNames'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  /** цвет трека/ползунка (по умолчанию --primary-color) */
  color?: string
  /**
   * tweb `RangeSelector({useTransform: true})` — заполнение через `transform: scaleX()`
   * (filled всегда width:100%, layout не дёргается). Взаимоисключающе с withTransition:
   * «there is no sense in using transition with transform» (rangeSelector.ts:52-56).
   */
  useTransform?: boolean
  /** tweb `RangeSelector({withTransition: true})` — заполнение шириной с `transition: width .2s` */
  withTransition?: boolean
  className?: string
  /** перебить дефолтную раскладку (ширина/вертикальные отступы) — см. ниже */
  style?: CSSProperties
  /** подпись для скринридера на нативном input (в tweb её нет) */
  ariaLabel?: string
}

// Ползунок — разметка tweb RangeSelector (rangeSelector.ts:47-75; стили —
// styles/tweb/_ckin.scss):
//   div.progress-line[.use-transform|.with-transition] > div.progress-line__filled
//                                                      + input.progress-line__seek[type=range]
// Полоса-фон рисуется псевдоэлементом `:before`, заполненная часть — отдельным
// div'ом, кругляш-ползунок — `:after` у заполненной части. Нативный input лежит
// поверх прозрачным и даёт клавиатуру/драг.
//
// Режим заполнения — 1:1 с tweb `setFilled` (rangeSelector.ts:134-145): по
// умолчанию (как у настроечных селекторов, autoDownload/file.tsx:44) ширина в
// процентах без класса-модификатора; `useTransform` — scaleX; `withTransition` —
// ширина с переходом (так собрана зум-полоса медиавьюера, base.ts:375-380).
//
// отступление от tweb: ширина 100% и `margin-block: .5rem` идут инлайном (у tweb
// раскладку задаёт контейнер вроде `.range-setting-selector`). Инлайн — чтобы в
// DOM остался ровно `div.progress-line` без хеш-класса CSS-модуля; место сверху и
// снизу нужно потому, что `.progress-line__seek` вылезает на .5rem за полосу.
// Контейнер, который сам раскладывает полосу (`.zoom-container` медиавьюера),
// гасит это пропом `style`.
export default function Slider({
  value, min = 0, max = 100, step = 1, onChange, color, useTransform, withTransition, className, style, ariaLabel,
}: SliderProps) {
  const frac = max > min ? Math.min(Math.max((value - min) / (max - min), 0), 1) : 0
  // tweb RangeSelector.onMouseDown/onMouseUp (rangeSelector.ts:97-109) вешает на
  // контейнер `is-focused` на время перетаскивания — по нему кругляш растёт до
  // --focus-scale (_ckin.scss:375-377).
  const [focused, setFocused] = useState(false)
  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    setFocused(true)
    const up = () => setFocused(false)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', up, { once: true })
  }, [])
  const rootStyle = {
    width: '100%',
    marginBlock: '0.5rem',
    ...(color ? { ['--color' as string]: color } : {}),
    ...style,
  } as CSSProperties
  return (
    <div
      className={classNames(
        'progress-line',
        useTransform ? 'use-transform' : withTransition ? 'with-transition' : '',
        focused ? 'is-focused' : '',
        className ?? '',
      )}
      style={rootStyle}
      onPointerDown={onPointerDown}
    >
      <div
        className="progress-line__filled"
        style={useTransform ? { transform: `scaleX(${frac})` } : { width: `${frac * 100}%` }}
      />
      <input
        className="progress-line__seek"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
