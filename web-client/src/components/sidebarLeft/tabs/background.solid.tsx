/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/background.tsx:1-615 (812502980) —
 * вкладка «Обои» (`AppChatBackgroundTab`, `solidJsTabs/tabs.ts`). Задача 12 плана
 * волны 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`).
 * Разметка — дамп `14-left-17b-settings-wallpaper` с классами HEAD
 * (`row-checkbox-field-toggle`, `docs/tweb/settings-rows.md` § 7).
 *
 * Состав — как у оригинала (`:572-612`): секция с тремя кнопками
 * `btn-primary btn-transparent` (загрузить, задать цвет, сбросить) и строкой-
 * тумблером размытия, под ней — сетка `.search-super-content-media-grid`.
 *
 * ── Модель обоев — наша, а не `WallPaper` сервера ───────────────────────────
 * У tweb обои — объекты `WallPaper` из `account.getWallPapers` в настройках
 * КАЖДОЙ темы (`themeController.getThemeSettings(theme).wallpaper`), выбор —
 * `setWallpaperForCurrentTheme` + `appImManager.applyCurrentTheme`. У нас обои —
 * одна настройка на все темы в zustand (`settings.tsx`): `wallpaper` (умолчание
 * темы / пресет-градиент / сплошной цвет) и поверх неё своё фото
 * `customWallpaperMediaId` + `customWallpaperBlur`; фон перерисовывается
 * подпиской на эти ключи (`chat/bubbles/chatBackground.solid.tsx::
 * watchWallPaperSettings`). Вкладка пишет ровно эти ключи — второй копии нет.
 * Соответствие (адаптер `wallpapers.ts`): `wallPaper` с узором (pattern) ↔ наш
 * пресет, загруженный `wallPaper` без узора ↔ своё фото, `wallPaperNoFile` ↔
 * сплошной цвет.
 *
 * Расхождения с оригиналом:
 *  1. (О-11) Сетка — наши пресеты `WALLPAPER_PRESETS` (`wallpapers.ts`), а не
 *     выдача `account.getWallPapers` (`:546-554`): ручек обоев на бэкенде нет
 *     (ни списка, ни `uploadWallPaper`, ни `saveWallPaper`). Поэтому нет и кэша
 *     `ChatBackgroundStore.cachedWallPapers`, ресурса и `<Show when={loaded()}>`
 *     (`:287`, `:529-554`): сетка строится сразу, ждать нечего. Своё фото
 *     сервер в выдачу не вернёт — его плитку вкладка ставит первой сама
 *     (у tweb загруженные обои приходят в той же выдаче).
 *  2. Обои одни на все темы (см. выше) — у tweb свои у каждой темы. «Сбросить»
 *     (`themeController.resetActiveTheme`, `:457-465`) возвращает умолчание
 *     темы (`DEFAULTS.wallpaper`) и снимает своё фото; акцент и прочие поля
 *     темы у нас не в теме и не трогаются.
 *  3. Загрузка: `managers.media.upload` (общая `/media/upload`) вместо
 *     `appDocsManager.prepareWallPaperUpload`/`uploadWallPaper` (`:404-416`);
 *     прогресс прелоадера — событие `media:upload_progress` по `progressId`,
 *     отмена — `media.cancelUpload`. Перекодирование PNG → JPEG (`:390-402`) не
 *     перенесено: его требует `account.uploadWallPaper`, наша ручка PNG
 *     принимает. Размеры картинки меряются `createImageBitmap`, как делал
 *     прежний экран: их просит наш `finalize`, у tweb их нет в запросе.
 *  4. Плитка — тот же Solid-`<ChatBackground>`, что рисует фон чата, с темой
 *     `day` и размером плитки (`:105-127`); наш аналог `WallPaper` сетки
 *     переводит в `WallPaper` фона адаптер `wallpapers.ts`. `LazyLoadQueue`
 *     (`:349`) не нужен: плиток 12, а не ~70, — монтируются сразу, как у выбора
 *     темы tweb; поэтому нет и `loadPromise`/`onReady`.
 *  5. Клик по плитке пресета применяет обои сразу: скачивать нечего, поэтому
 *     прелоадера и защиты от повторного клика `clicked` (`:494-523`) у плиток
 *     нет. `clicked` остаётся только у загрузки (`:433`, `:451`).
 *  6. `rootScope` `background_change` (`:570`) → подписка на zustand
 *     (`subscribeExternal`): смену обоев объявляет сам стор.
 *  7. Размытие — свойство своего фото (`customWallpaperBlur`), как у tweb флаг
 *     `blur` в `settings` загруженного `wallPaper`; у обоев с узором, цвета и
 *     умолчания размывать нечего — строка `disabled` (`:296-299`), значение —
 *     «выкл» (флага у них у нас нет). Повтор применения через 100 мс
 *     (`:470-481`) не нужен: фон перерисовывается от записи в стор.
 *  8. `highlightingColor` для выбранного фото (`:187-213`) не считается и не
 *     сохраняется в тему: `settings.themes[]` нет (О-38), цвет подсветки из
 *     показанных обоев выводит сам фон (`chatBackground.tsx:515-516`, `:623`).
 *  9. Кольцо фокуса плитки (`:focus-visible` в `_leftSidebar.scss`) — часть
 *     a11y-коммита 472e3e76b, у нас не портированного вместе с токенами
 *     `--focus-ring-*`; роль, `tabindex`, подпись и Enter/Space перенесены.
 */
import { createEffect, on, onCleanup, onMount } from 'solid-js'
import type { Managers } from '@/client/bootstrap'
import I18n, { i18n } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import { attachClickEvent, simulateClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import markGridCornerItem, { GRID_CORNER_CLASSES } from '@helpers/dom/markGridCornerItem'
import requestFile from '@helpers/files/requestFile'
import ListenerSetter from '@helpers/listenerSetter'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import { render } from 'solid-js/web'
import ChatBackgroundStore from '@core/chat/chatBackgroundStore'
import { getColorsFromWallPaper } from '@shared/lib/color'
import { DEFAULTS, useSettingsStore, type Settings } from '@/settings'
import {
  DEFAULT_WALLPAPERS,
  getAppTheme,
  getMediaWallPaperSlug,
  getUploadWallPaperSlug,
  makeImageWallPaper,
  makePresetWallPaper,
  WALLPAPER_PRESETS,
} from '@/wallpapers'
import { getCurrentPreset } from '@core/theme/themeController'
import { resolvePreset } from '@/theme'
import { ChatBackground as ChatBackgroundLayer } from '@components/chat/bubbles/chatBackground.solid'
import Section from '@components/section.solid'
import Row from '@components/rowTsx.solid'
import Button from '@components/buttonTsx.solid'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import ProgressivePreloader from '@components/preloader'
import type SidebarSlider from '@components/slider'
import { AppBackgroundColorTab } from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'

/** Наш аналог `WallPaper` сетки (см. «Модель обоев» в шапке). */
type WallPaper =
  | { _: 'preset', id: string, colors: readonly string[] }
  | { _: 'custom', mediaId?: number, uploadId?: number }

type WallPaperState = Pick<Settings, 'wallpaper' | 'customWallpaperMediaId' | 'customWallpaperBlur'>

const getWallPaperKey = (wallPaper: WallPaper) => wallPaper._ === 'preset' ?
  wallPaper.id :
  (wallPaper.mediaId !== undefined ? 'custom-' + wallPaper.mediaId : 'upload-' + wallPaper.uploadId)

const sameColors = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((color, i) => color.toLowerCase() === b[i].toLowerCase())

/** Цвета обоев умолчания текущей темы (`wallpapers.ts::DEFAULT_WALLPAPERS`). */
const getThemeGradient = () => {
  const themeName = getCurrentPreset() ?? resolvePreset(useSettingsStore.getState().themeChoice)
  return getColorsFromWallPaper(DEFAULT_WALLPAPERS[themeName]).split(',')
}

/** tweb `getWallPaperKeyFromTheme` (`:47`) — ключ плитки, которую сейчас рисует фон. */
const getWallPaperKeyFromState = (state: WallPaperState) => {
  if(state.customWallpaperMediaId != null) return 'custom-' + state.customWallpaperMediaId
  const colors = state.wallpaper.kind === 'preset' ?
    state.wallpaper.colors :
    state.wallpaper.kind === 'default' ? getThemeGradient() : undefined
  return colors && WALLPAPER_PRESETS.find((preset) => sameColors(preset.colors, colors))?.id
}

// tweb `getBlurDisabled` (`:296-299`): размывать можно только обои-картинку без узора.
const getBlurDisabled = (state: WallPaperState) => state.customWallpaperMediaId == null
// tweb `needBlur(wallPaper, false)` (`:41-44`, `:300`).
const getBlur = (state: WallPaperState) => !getBlurDisabled(state) && !!state.customWallpaperBlur

/** Наш `WallPaper` сетки → `WallPaper` фона (расхождение 4). */
const toLayerWallPaper = (wallPaper: WallPaper) => wallPaper._ === 'preset' ?
  makePresetWallPaper(wallPaper.colors, 'day') :
  makeImageWallPaper(wallPaper.mediaId !== undefined ?
    getMediaWallPaperSlug(wallPaper.mediaId) :
    getUploadWallPaperSlug(wallPaper.uploadId!))

// ─────────────────────────────────────────────────────────────────────────────
// Статическая часть — на `AppBackgroundTab`, как у оригинала (`:55-270`): её
// переиспользует выбор темы «Общих» (задача 13 плана 2D).
// ─────────────────────────────────────────────────────────────────────────────

export class AppBackgroundTab {
  public static tempId = 0

  // tweb `:76-147`. Плитка — синхронно (квадрат задаёт CSS), содержимое —
  // `<ChatBackground>` в `media` (расхождение 4).
  public static addWallPaper(
    wallPaper: WallPaper,
    container = document.createElement('div'),
    size: { width: number, height: number } = { width: 72, height: 96 },
  ) {
    container.classList.add('background-item')
    container.dataset.id = getWallPaperKey(wallPaper)

    const media = document.createElement('div')
    media.classList.add('background-item-media')
    // tweb `:95-102` — скелет цветами самих обоев; у картинки цветов нет — тёмная заливка.
    const skeletonStops = wallPaper._ === 'preset' ? wallPaper.colors : undefined
    media.style.background = skeletonStops ?
      (skeletonStops.length > 1 ? `linear-gradient(135deg, ${skeletonStops.join(', ')})` : skeletonStops[0]) :
      '#000'
    container.append(media)

    // tweb `:104-108`, `:115-127`: синтетическая тема `day` — плитка сетки
    // всегда в дневной отрисовке.
    const theme = getAppTheme('day')
    const layerWallPaper = toLayerWallPaper(wallPaper)
    const dispose = render(() => (
      <ChatBackgroundLayer
        theme={theme}
        wallPaper={layerWallPaper}
        transition="instant"
        width={size.width}
        height={size.height}
      />
    ), media)

    return {
      container,
      media,
      dispose,
    }
  }

  // tweb `:149-269` — применить обои. У нас это запись в zustand (шапка,
  // «Модель обоев»); фон перерисовывает подписка на неё (`watchWallPaperSettings`).
  public static setBackgroundDocument(wallPaper: WallPaper, blur?: boolean) {
    const { update } = useSettingsStore.getState()
    if(wallPaper._ === 'preset') {
      update({ wallpaper: { kind: 'preset', colors: [...wallPaper.colors] }, customWallpaperMediaId: undefined })
    } else {
      update({
        customWallpaperMediaId: wallPaper.mediaId,
        ...(blur !== undefined ? { customWallpaperBlur: blur } : {}),
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Вкладка — Solid-компонент (`:277-613`).
// ─────────────────────────────────────────────────────────────────────────────

const ChatBackground = () => {
  const [tab] = useSuperTab()
  const managers = tab.managers as Managers

  const wallPapersByElement = new Map<HTMLElement, WallPaper>()
  const elementsByKey = new Map<string, HTMLElement>()
  const clicked = new Set<string>()

  const state = subscribeExternal(useSettingsStore.subscribe, (): WallPaperState => {
    const { wallpaper, customWallpaperMediaId, customWallpaperBlur } = useSettingsStore.getState()
    return { wallpaper, customWallpaperMediaId, customWallpaperBlur }
  })

  // tweb `:292-293` — вид сетки Shared Media → Media (3 колонки, 1px, скругление).
  const grid = document.createElement('div')
  grid.classList.add('search-super-content-media-grid')

  const blurDisabled = () => getBlurDisabled(state())
  const blur = () => getBlur(state())

  const setBackgroundDocument = (wallPaper: WallPaper) => {
    // tweb `:315-324`: включённый тумблер переносит размытие на выбранное фото.
    AppBackgroundTab.setBackgroundDocument(wallPaper, blurDisabled() ? undefined : blur())
  }

  // tweb `:326-338`; `syncBlurControl` не нужен — тумблер читает стор напрямую.
  const setActive = () => {
    const active = grid.querySelector('.active')
    const key = getWallPaperKeyFromState(state())
    const target = key !== undefined ? elementsByKey.get(key) : undefined
    if(active === target) return

    active?.classList.remove('active', ...GRID_CORNER_CLASSES)
    if(target) {
      target.classList.add('active')
      markGridCornerItem(grid, target)
    }
  }

  const solidRoots: (() => void)[] = []

  const addWallPaper = (wallPaper: WallPaper, append = true) => {
    const result = AppBackgroundTab.addWallPaper(wallPaper)
    const { container, media, dispose } = result
    container.classList.add('grid-item')
    container.setAttribute('role', 'button')
    container.setAttribute('tabindex', '0')
    container.setAttribute('aria-label', I18n.format('ChatBackground', true))
    media.classList.add('grid-item-media')
    solidRoots.push(dispose)

    const key = getWallPaperKey(wallPaper)
    wallPapersByElement.set(container, wallPaper)
    elementsByKey.set(key, container)

    if(getWallPaperKeyFromState(state()) === key) {
      container.classList.add('active')
    }

    grid[append ? 'append' : 'prepend'](container)
    return result
  }

  // Локальные файлы загрузок (tweb `:405-415` сеет ими кэш фона) живут, пока
  // их показывает плитка, — до уборки вкладки.
  const uploadUrls: string[] = []

  const listenerSetter = new ListenerSetter()
  onCleanup(() => {
    listenerSetter.removeAll()
    solidRoots.forEach((d) => d())
    uploadUrls.forEach((url) => URL.revokeObjectURL(url))
  })

  // Прогресс отгрузки — канал `media:upload_progress` (расхождение 3).
  const uploadProgress = new Map<string, CancellablePromise<void>>()
  subscribeOn(rootScope)('media:upload_progress', ({ id, loaded, total }) => {
    uploadProgress.get(id)?.notifyAll?.({ done: loaded, total })
  })

  const onUploadClick = () => {
    void requestFile('image/x-png,image/png,image/jpeg').then(async(file) => {
      const uploadId = ++AppBackgroundTab.tempId
      const progressId = 'wallpaper-upload-' + uploadId
      // tweb `:405-415` — плитка (её `<ChatBackground>` берёт файл у
      // `ChatBackgroundStore`) показывает локальный файл, пока идёт отгрузка.
      const url = URL.createObjectURL(file)
      uploadUrls.push(url)
      const uploadSlug = getUploadWallPaperSlug(uploadId)
      ChatBackgroundStore.setBackgroundUrlToCache({ slug: uploadSlug, url })
      const wallPaper: WallPaper = { _: 'custom', uploadId }
      const key = getWallPaperKey(wallPaper)

      const deferred = deferredPromise<void>()
      deferred.cancel = () => { void managers.media.cancelUpload(progressId) }
      uploadProgress.set(progressId, deferred)

      const { container } = addWallPaper(wallPaper, false)
      clicked.add(key)

      const preloader = new ProgressivePreloader({
        isUpload: true,
        cancelable: true,
        tryAgainOnFail: false,
      })
      preloader.attach(container, false, deferred)

      // tweb `:434-439` `releaseUploadPreview`.
      const release = () => {
        uploadProgress.delete(progressId)
        ChatBackgroundStore.deleteBackgroundUrlFromCache({ slug: uploadSlug })
      }
      deferred.then(release, release)
      deferred.catch(() => {
        container.remove()
      })

      let width = 0
      let height = 0
      try {
        const bitmap = await createImageBitmap(file)
        width = bitmap.width
        height = bitmap.height
        bitmap.close()
      } catch {
        // размеры необязательны (расхождение 3)
      }

      managers.media.upload({ blob: file, mime: file.type || 'image/jpeg', size: file.size, width, height, progressId }).then((mediaId) => {
        clicked.delete(key)
        elementsByKey.delete(key)
        const uploaded: WallPaper = { _: 'custom', mediaId }
        wallPapersByElement.set(container, uploaded)
        const newKey = getWallPaperKey(uploaded)
        container.dataset.id = newKey
        elementsByKey.set(newKey, container)
        // tweb `:430` → `setBackgroundDocument`: без включённого тумблера у
        // новых обоев размытия нет (флага `blur` у свежего `wallPaper` нет).
        AppBackgroundTab.setBackgroundDocument(uploaded, blurDisabled() ? false : blur())
        deferred.resolve!()
      }, (error: unknown) => deferred.reject!(error))
    }, () => {})
  }

  const onResetClick = () => {
    useSettingsStore.getState().update({
      wallpaper: DEFAULTS.wallpaper,
      customWallpaperMediaId: undefined,
      customWallpaperBlur: false,
    })
  }

  const onBlurChange = (value: boolean) => {
    useSettingsStore.getState().update({ customWallpaperBlur: value })
  }

  const onGridClick = (e: MouseEvent | TouchEvent) => {
    const target = findUpClassName(e.target!, 'grid-item')
    if(!target) return

    const wallPaper = wallPapersByElement.get(target)
    if(!wallPaper) return
    // идёт отгрузка — у tweb клик ловит прелоадер (`:514-521`)
    if(clicked.has(getWallPaperKey(wallPaper))) return
    setBackgroundDocument(wallPaper)
  }

  // tweb `:529-534`.
  const buildGrid = () => {
    WALLPAPER_PRESETS.forEach((preset) => addWallPaper({ _: 'preset', id: preset.id, colors: preset.colors }))
    const mediaId = state().customWallpaperMediaId
    // Своё фото — плитка первой (расхождение 1); файл плитке отдаёт
    // `ChatBackgroundStore` (медиа-конвейер).
    if(mediaId != null) addWallPaper({ _: 'custom', mediaId }, false)
    markGridCornerItem(grid, grid.querySelector('.active'))
  }
  buildGrid()

  onMount(() => {
    attachClickEvent(grid, onGridClick, { listenerSetter })
    // tweb `:558-566` — Enter/Space на плитке в фокусе выбирает её.
    listenerSetter.add(grid)('keydown', (e: KeyboardEvent) => {
      if(e.key !== 'Enter' && e.key !== ' ') return
      const target = findUpClassName(e.target!, 'grid-item')
      if(!target) return
      e.preventDefault()
      simulateClickEvent(target)
    })
    tab.container.classList.add('background-container', 'background-image-container')
  })

  // tweb `:570` — `background_change` (расхождение 6).
  createEffect(on(state, setActive, { defer: true }))

  return (
    <>
      <Section>
        <Button
          class="btn-primary btn-transparent"
          icon="cameraadd"
          text="ChatBackground.UploadWallpaper"
          onClick={onUploadClick}
        />
        <Button
          class="btn-primary btn-transparent"
          icon="colorize"
          text="SetColor"
          onClick={() => void (tab.slider as SidebarSlider).createTab(AppBackgroundColorTab).open()}
        />
        <Button
          class="btn-primary btn-transparent"
          icon="favourites"
          text="Appearance.Reset"
          onClick={onResetClick}
        />
        <Row disabled={blurDisabled()}>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx
              disabled={blurDisabled()}
              name="blur"
              checked={blur()}
              toggle
              onChange={onBlurChange}
            />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('ChatBackground.Blur')}</Row.Title>
        </Row>
      </Section>
      <div>
        {grid}
      </div>
    </>
  )
}

export default ChatBackground
