/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/chatTips/stickersCard.tsx` (812502980) — карточка «Стикеры»
 * пустой колонки (Б-13 бэклога волны 7).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *  1. Обложка пака — первый документ covered-выдачи трендов (`stickers.featuredSets` отдаёт
 *     набор вместе с первыми документами), а не `getStickerSet` на каждый пак (`:84-87`): у
 *     tweb тот вызов отдаёт из кэша менеджера тот самый covered-набор, кэша наборов у нашего
 *     менеджера нет — то же расхождение 1 у `sidebarRight/tabs/stickers.solid.tsx`.
 *  2. Адрес набора — `{id}` (`InputStickerSetAddress`), а не `getStickerSetInputByStickerSet`.
 *  3. `showStickersPopup` — мост `sidebarLeft/settingsPopups.tsx` на React-попап набора,
 *     ВРЕМЕННО до 2C-15 (порт `popups/stickers`), как у вкладки «Стикеры и эмодзи».
 *  4. `withLock: true` (`:95`) не передаётся: премиум-замка у нашего `wrapSticker` нет
 *     (О-29 волна 7). Обложке даны превью и контур документа — их `StickerTsx` оригинала
 *     достаёт из `MyDocument` сам, наш `wrapSticker` принимает их опциями.
 */
import { createEffect, createResource, For, on, Show } from 'solid-js'
import anchorCallback from '@helpers/dom/anchorCallback'
import { i18n, type LangPackKey } from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import { useAppSettings } from '@stores/appSettings.solid'
import type { Settings } from '@/settings'
import type { IconName } from '@core/tgico-icons'
import type { Sticker, StickerSet } from '@core/managers/stickersManager'
import { getPathThumb, getStrippedThumb } from '@core/media/messageMedia'
import { getProxiedManagers } from '@/client/bootstrap'
import { showStickersPopup } from '@components/sidebarLeft/settingsPopups'
import appSidebarLeft from '@components/sidebarLeft'
import { AppStickersTab } from '@components/solidJsTabs/tabs'
import StickerTsx from '@components/wrappers/stickerTsx.solid'
import TipCard, { openSettingsTab, useTipReady, type TipCardButton } from './tipCard.solid'
import styles from './chatTips.module.scss'

/** macOS shows three featured packs side by side in the content slot. */
const SETS_LIMIT = 3

const COVER_SIZE = 88

type SuggestMode = Settings['stickersSuggest']

const MODES: [SuggestMode, IconName, LangPackKey][] = [
  ['none', 'stop', 'SuggestStickersNone'],
  ['installed', 'newprivate', 'SuggestStickersInstalled'],
  ['all', 'stickers_face', 'SuggestStickersAll'],
]

type TrendingSet = { set: StickerSet, cover?: Sticker }

/**
 * Stickers tip — macOS' `WidgetStickersController`: the "Suggest Stickers by Emoji" mode in the
 * button row (the same `settings.stickers.suggest` key Stickers and Emoji writes), a few trending
 * packs as the content, and a line pointing at the full Trending list.
 */
export default function StickersTipCard() {
  const [appSettings, setAppSettings] = useAppSettings()

  // Расхождение 1
  const [featured] = createResource(async(): Promise<TrendingSet[]> => {
    const { sets, covers } = await getProxiedManagers().stickers.featuredSets()
    return sets.slice(0, SETS_LIMIT).map((set) => ({ set, cover: covers.get(set.id)?.[0] }))
  })

  const markReady = useTipReady()
  createEffect(on(featured, (sets) => sets && markReady()))

  const buttons = (): TipCardButton[] => MODES.map(([value, icon, langKey]) => ({
    icon,
    text: i18n(langKey),
    selected: appSettings.stickers.suggest === value,
    onClick: () => void setAppSettings('stickers', 'suggest', value),
  }))

  return (
    <TipCard
      title={i18n('Stickers.SuggestStickers')}
      buttons={buttons()}
      contentTitle={i18n('Stickers.Trending')}
      description={i18n('ChatTips.Stickers.Description', [
        anchorCallback(() => openSettingsTab(appSidebarLeft, AppStickersTab)),
      ])}
    >
      <div class={styles.stickerSets}>
        <For each={featured()}>{(trending) => <TrendingStickerSet {...trending} />}</For>
      </div>
    </TipCard>
  )
}

/** One trending pack: its cover sticker over the pack title. Clicking it opens the pack. */
function TrendingStickerSet(props: TrendingSet) {
  // Named by the pack title under the cover; the cover itself is decoration.
  return (
    <button type="button" class={styles.stickerSet} onClick={() => showStickersPopup({ id: props.set.id })}>
      <div class={styles.stickerSetCover} aria-hidden="true">
        <Show when={props.cover}>{(doc) => (
          <StickerTsx
            mediaId={doc().id}
            width={COVER_SIZE}
            height={COVER_SIZE}
            extraOptions={{
              group: 'CHAT-TIPS',
              play: true,
              loop: true,
              thumb: getStrippedThumb(doc()),
              pathThumb: getPathThumb(doc()),
              docWidth: doc().w,
              docHeight: doc().h,
            }}
          />
        )}</Show>
      </div>
      <div class={styles.stickerSetName}>{wrapEmojiText(props.set.title)}</div>
    </button>
  )
}
