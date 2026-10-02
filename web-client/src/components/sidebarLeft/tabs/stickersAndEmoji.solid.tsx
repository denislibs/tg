/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/stickersAndEmoji.tsx:1-270` (812502980) —
 * вкладка «Стикеры и эмодзи» (`AppStickersAndEmojiTab`, `solidJsTabs/tabs.ts`).
 * Задача 15 плана 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`),
 * дамп `docs/tweb/dom/dumps/14-left-19-settings-stickers-emoji.json`. Открывает её
 * строка `StickersName` корня настроек (tweb `settings.tsx:257`).
 *
 *   Section caption=LoopAnimatedStickersInfo                        (:58-87)
 *     Row havePadding → AppQuickReactionTab + ReactionStickerPreview
 *     Row clickable (Icon lamp_filled, titleRight secondary) → контекст-меню
 *     Row (Icon flip) + тумблер settings.stickers.loop
 *   Section name=Emoji: тумблер settings.emoji.suggest              (:115-138)
 *   Section name=Telegram.InstalledStickerPacksController
 *           caption=StickersBotInfo: строки наборов                (:155-262)
 *
 * Разметка — как у оригинала: секции императивно дописываются в скроллер
 * вкладки на `onMount`, компонент возвращает `null` (:267).
 *
 * Расхождения с оригиналом:
 *  1. (О-30) Превью быстрой реакции в строке «Quick Reaction» пустое, и
 *     `quick_reaction` не слушается (:30-35, :108-110): быстрой реакции у нас нет
 *     по всей вертикали (шапка `quickReaction.solid.tsx`); у оригинала без неё
 *     `ReactionStickerPreview` тоже пуст (`Show when={props.sticker}`).
 *  2. (О-44) Пункты «All Sets» и «My Sets» у нас действуют одинаково: у
 *     оригинала `all` добавляет к подсказкам серверные стикеры
 *     (`stickersHelper.ts:66`, `includeServerStickers`), а наш поиск по эмодзи
 *     ищет только в установленных наборах (`GET /stickers/search`,
 *     `usecase/stickers/interactor.go:172`). `none` гасит панель подсказок
 *     композера, как `chat/input.ts:3843` (`Composer.tsx::checkStickerSuggest`).
 *  3. (О-45) Тумблера «Large Emoji» (`settings.emoji.big`, :127-136) нет: его
 *     читатель — ветка больших эмодзи ленты (tweb `bubbles.ts:8854`), а наша
 *     лента их не рисует (`backlogs/frontend/vanilla-feed-big-emoji.md`) —
 *     тумблер ничего бы не менял.
 *  4. (О-43) Секции «Dynamic Pack Order» (:140-153) нет: у оригинала тумблер
 *     уходит флагом `update_stickersets_order` в отправку стикера
 *     (`appMessagesManager.ts:2745`) и сервер поднимает набор наверх
 *     (`stickers_top`, :243-250); у нас ни флага отправки, ни события нет.
 *  5. (О-14) Наборы не перетаскиваются: нет `reorderStickerSets` — у бэкенда
 *     порядок установленных наборов не меняется ничем (`router.go`, стикеры:
 *     только install/uninstall). Поэтому нет `Sortable` (:252-259), класса
 *     `row-sortable`, ручки `row-sortable-icon` (:186, :193) и события
 *     `stickers_order` (:228-241); отдельный `appendSectionContent` оставлен —
 *     он же держит строки вне узла с именем секции (:165-167).
 *  6. Настройки — `checked`/`onChange` через мост `useAppSettings`, а не
 *     `stateKey` (у нашего `CheckboxFieldTsx` его нет, итог задачи 7).
 *  7. Данные — наши: `tab.managers.stickers.mySets()` вместо
 *     `appStickersManager.getAllStickers()` (:40), адрес набора `{id}` вместо
 *     `getStickerSetInputById` (:188); попап набора — мост `showStickersPopup`
 *     (`sidebarLeft/settingsPopups.tsx`, ВРЕМЕННО до 2C-15). Обложка —
 *     `wrappers/stickerSetThumb.ts` (свои расхождения в шапке), её отказ строку
 *     не рушит.
 */
import { onMount } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import rootScope from '@lib/rootScope'
import createContextMenu from '@helpers/dom/createContextMenu'
import noop from '@helpers/noop'
import { mountSolidComponent, unwrapSolidElement } from '@helpers/solid/wrapSolidComponent'
import { createLazyLoadQueue } from '@core/lazyLoadQueue'
import type { StickerSet } from '@core/managers/stickersManager'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import Section, { appendSectionContent } from '@components/section.solid'
import ReactionStickerPreview from '@components/reactionStickerPreview.solid'
import wrapStickerSetThumb from '@components/wrappers/stickerSetThumb'
import type SidebarSlider from '@components/slider'
import { showStickersPopup } from '@components/sidebarLeft/settingsPopups'
import { AppQuickReactionTab } from '@components/solidJsTabs/tabs'
import { useAppSettings } from '@stores/appSettings.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'

const StickersAndEmoji = () => {
  const [tab] = useSuperTab()
  const [appSettings, setAppSettings] = useAppSettings()
  const promiseCollector = usePromiseCollector()

  onMount(() => {
    tab.container.classList.add('stickers-emoji-container')

    const allStickersPromise = tab.managers!.stickers.mySets()

    const promises: Promise<unknown>[] = []

    {
      let suggestStickersRow!: HTMLElement

      const map: { [k in typeof appSettings.stickers.suggest]: LangPackKey } = {
        all: 'SuggestStickersAll',
        installed: 'SuggestStickersInstalled',
        none: 'SuggestStickersNone',
      }

      const setStickersSuggest = (value: typeof appSettings.stickers.suggest) => {
        if(appSettings.stickers.suggest === value) return
        void setAppSettings('stickers', 'suggest', value)
      }

      const section = unwrapSolidElement(
        <Section caption="LoopAnimatedStickersInfo">
          <Row
            havePadding
            clickable={() => void (tab.slider as SidebarSlider).createTab(AppQuickReactionTab).open()}
          >
            <Row.Title>{i18n('DoubleTapSetting')}</Row.Title>
            {/* О-30 — расхождение 1 */}
            <ReactionStickerPreview />
          </Row>
          <Row ref={(el) => { suggestStickersRow = el }} clickable>
            <Row.Icon icon="lamp_filled" />
            <Row.Title
              titleRight={i18n(map[appSettings.stickers.suggest])}
              titleRightSecondary
            >
              {i18n('Stickers.SuggestStickers')}
            </Row.Title>
          </Row>
          <Row>
            <Row.Icon icon="flip" />
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                checked={appSettings.stickers.loop}
                onChange={(value) => void setAppSettings('stickers', 'loop', value)}
                toggle
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('InstalledStickers.LoopAnimated')}</Row.Title>
          </Row>
        </Section>,
      ) as HTMLElement

      createContextMenu({
        buttons: [{
          icon: 'stickers_face',
          text: 'SuggestStickersAll',
          onClick: setStickersSuggest.bind(null, 'all'),
        }, {
          icon: 'newprivate',
          text: 'SuggestStickersInstalled',
          onClick: setStickersSuggest.bind(null, 'installed'),
        }, {
          icon: 'stop',
          text: 'SuggestStickersNone',
          onClick: setStickersSuggest.bind(null, 'none'),
        }],
        listenTo: suggestStickersRow,
        middleware: tab.middlewareHelper.get(),
        listenForClick: true,
      })

      tab.scrollable.append(section)
    }

    // О-45: без строки `GeneralSettings.BigEmoji` — расхождение 3.
    tab.scrollable.append(unwrapSolidElement(
      <Section name="Emoji">
        <Row>
          <Row.Icon icon="lamp_filled" />
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx
              checked={appSettings.emoji.suggest}
              onChange={(value) => void setAppSettings('emoji', 'suggest', value)}
              toggle
            />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('GeneralSettings.EmojiPrediction')}</Row.Title>
        </Row>
      </Section>,
    ) as HTMLElement)

    // О-43: секции `DynamicPackOrder` нет — расхождение 4.

    {
      const section = unwrapSolidElement(
        <Section
          name="Telegram.InstalledStickerPacksController"
          caption="StickersBotInfo"
        />,
      ) as HTMLElement

      const stickerSets: { [id: string]: { container: HTMLElement, dispose: VoidFunction } } = {}

      // the sortable list gets a content element of its own: reordering reads the
      // element's children, so the section's title must not be among them (tweb :165-166)
      const stickersContent = appendSectionContent(section)

      const lazyLoadQueue = createLazyLoadQueue()
      const renderStickerSet = (stickerSet: StickerSet, method: 'append' | 'prepend' = 'append') => {
        const media = document.createElement('div')
        const mounted = mountSolidComponent((middleware) => {
          wrapStickerSetThumb({
            set: stickerSet,
            container: media,
            group: 'GENERAL-SETTINGS',
            lazyLoadQueue,
            width: 36,
            height: 36,
            managers: tab.managers!,
            middleware,
          }).catch(noop)

          // О-14: без `row-sortable` и ручки `row-sortable-icon` — расхождение 5.
          return (
            <Row
              havePadding
              clickable={() => showStickersPopup({ id: stickerSet.id })}
            >
              <Row.Title>{wrapEmojiText(stickerSet.title)}</Row.Title>
              <Row.Subtitle>{i18n('Stickers', [stickerSet.count])}</Row.Subtitle>
              <Row.Media element={media} />
            </Row>
          )
        }, tab.middlewareHelper.get())
        const row = mounted.element

        row.dataset.id = '' + stickerSet.id
        stickerSets[stickerSet.id] = { container: row, dispose: mounted.dispose }

        stickersContent[method](row)
      }

      const promise = allStickersPromise.then((sets) => {
        sets.forEach((stickerSet) => renderStickerSet(stickerSet))
      })

      promises.push(promise)

      tab.listenerSetter.add(rootScope)('stickers_installed', (set) => {
        if(!stickerSets[set.id]) {
          renderStickerSet(set, 'prepend')
        }
      })

      tab.listenerSetter.add(rootScope)('stickers_deleted', (set) => {
        const row = stickerSets[set.id]
        if(row) {
          row.dispose()
          row.container.remove()
          delete stickerSets[set.id]
        }
      })

      tab.scrollable.append(section)
    }

    promiseCollector.collect(Promise.all(promises))
  })

  return null
}

export default StickersAndEmoji
