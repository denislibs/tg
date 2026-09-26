/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/backgroundColor.tsx:1-168 (812502980) —
 * вкладка «Цвет» (`AppBackgroundColorTab`, `solidJsTabs/tabs.ts`), открывается
 * кнопкой SetColor «Обоев». Задача 12 плана волны 2D.
 *
 * Состав — как у оригинала (`:145-165`): `ColorPicker` в секции и сетка из 12
 * образцов `COLORS` тем же видом, что у «Обоев» (`.search-super-content-media-grid`),
 * отдельным блоком.
 *
 * Расхождения с оригиналом:
 *  1. Сплошной цвет — наша настройка `wallpaper: {kind: 'color', color}` в zustand
 *     (модель обоев — шапка `background.solid.tsx`), а не `wallPaperNoFile` с
 *     `background_color` в настройках темы (`:67-90`). Цвет перекрывает своё
 *     фото только при снятом `customWallpaperMediaId` — вкладка его снимает,
 *     как у tweb новые обои темы заменяют прежние.
 *  2. Смешение с палитрой tinted (`blendWallpaperForTinted`, `:78-82`) не
 *     перенесено: у нас tinted-деривации нет вовсе (шапка
 *     `core/theme/themeController.ts`, «НЕ портировано»).
 *  3. `highlightingColor` (`:63-65`) не считается: цвет подсветки из обоев
 *     считает `ChatBackground.tsx`, это его предмет (как в «Обоях», п. 8).
 *  4. Активный образец и цвет при открытии берутся из `wallpaper.color`
 *     (строка `#rrggbb`), а не из числа `background_color` (`:44-47`, `:123-133`):
 *     форматировать и дополнять нулями нечего.
 *  5. `useHotReloadGuard` (`:32`) не нужен — HMR-ветки tweb не портированы;
 *     `themeController`/`appImManager` заменены стором (п. 1).
 */
import { For, onCleanup, onMount } from 'solid-js'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import markGridCornerItem, { GRID_CORNER_CLASSES } from '@helpers/dom/markGridCornerItem'
import throttle from '@helpers/schedulers/throttle'
import { useSettingsStore } from '@/settings'
import ColorPicker, { type ColorPickerColor } from '@components/colorPicker'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'

const COLORS = [
  '#E6EBEE',
  '#B2CEE1',
  '#008DD0',
  '#C6E7CB',
  '#C4E1A6',
  '#60B16E',
  '#CCD0AF',
  '#A6A997',
  '#7A7072',
  '#FDD7AF',
  '#FDB76E',
  '#DD8851',
]

/** Сплошной цвет обоев, если он сейчас рисуется (п. 1). */
const getWallPaperColor = () => {
  const { wallpaper, customWallpaperMediaId } = useSettingsStore.getState()
  return wallpaper.kind === 'color' && customWallpaperMediaId == null ? wallpaper.color : undefined
}

const BackgroundColor = () => {
  const [tab] = useSuperTab()

  const colorPicker = new ColorPicker()

  let grid!: HTMLDivElement
  let applyColor: (hex: string, updateColorPicker?: boolean) => void

  const setActive = () => {
    const active = grid.querySelector('.active')
    const color = getWallPaperColor()
    const target = color ? grid.querySelector(`.grid-item[data-color="${color.toLowerCase()}"]`) : null
    if(active === target) {
      return
    }

    active?.classList.remove('active', ...GRID_CORNER_CLASSES)
    if(target) {
      target.classList.add('active')
      markGridCornerItem(grid, target)
    }
  }

  const _applyColor = (hex: string, updateColorPicker = true) => {
    if(updateColorPicker) {
      colorPicker.setColor(hex)
    } else {
      useSettingsStore.getState().update({
        wallpaper: { kind: 'color', color: hex },
        customWallpaperMediaId: undefined,
      })
      setActive()
    }
  }

  const onColorChange = (color: ColorPickerColor) => {
    applyColor(color.hex, false)
  }

  onMount(() => {
    tab.container.classList.add('background-container', 'background-color-container')

    const middleware = tab.middlewareHelper.get()
    middleware.onDestroy(colorPicker.attachAutoResize())

    applyColor = throttle(_applyColor, 16, true)

    attachClickEvent(grid, (e) => {
      const target = findUpClassName(e.target!, 'grid-item')
      if(!target || target.classList.contains('active')) {
        return
      }

      const color = target.dataset.color
      if(!color) {
        return
      }

      applyColor(color)
    }, { listenerSetter: tab.listenerSetter })

    // mirror legacy onOpen()
    setTimeout(() => {
      const color = getWallPaperColor()
      const isColored = !!color

      // * set active if type is color
      if(isColored) {
        colorPicker.onChange = onColorChange
      }

      colorPicker.setColor(color || '#cccccc')

      if(!isColored) {
        colorPicker.onChange = onColorChange
      }
    }, 0)
  })

  onCleanup(() => {
    colorPicker.onChange = undefined
  })

  return (
    <>
      <Section>
        {colorPicker.container}
      </Section>
      {/* tweb :150-152 — та же сетка, что у «Обоев», во всю ширину, без карточки
          секции; `background-item` даёт образцам общее выделение (кольцо и угол). */}
      <div>
        <div class="search-super-content-media-grid" ref={grid}>
          <For each={COLORS}>
            {(color) => (
              <div class="grid-item background-item" data-color={color.toLowerCase()}>
                <div class="grid-item-media" style={{ 'background-color': color }} />
              </div>
            )}
          </For>
        </div>
      </div>
    </>
  )
}

export default BackgroundColor
