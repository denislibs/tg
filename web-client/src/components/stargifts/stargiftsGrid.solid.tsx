/** @jsxImportSource solid-js */
// Порт tweb `src/components/stargifts/stargiftsGrid.tsx` (397 строк) —
// сетка плиток подарков, в объёме вида `profile` (витрина профиля; виды `list`/
// `resale`/`transfer` — каталог покупки и попапы, которых у нас нет).
// Стили — `stargiftsGrid.module.scss`, порт 1:1 (лежал заранее).
//
// ── Что в плитке НЕ портировано, и почему (каждое — отсутствие предмета) ──────
//  • Стикер (`SuperStickerRenderer.renderSticker`, `:50-51`): в нашей модели
//    внешность подарка — unicode-символ `gift.emoji`, а не документ-стикер
//    (`core/messages/messageAction.ts`, докблок `StarGift`). Символ кладётся в
//    тот же слот `itemSticker`.
//  • Коллекционные подарки (`starGiftUnique`: `collectibleAttributes`,
//    `StarGiftBackdrop`, `--overlay-color`, бейдж `#num`, `resellPriceStars`,
//    `resellOnlyTon`, `isWearing`) — конструктора в модели нет.
//  • `pinned_to_top` (`itemPin`, `:223-225`), `locked_until_date` (`itemLock`),
//    `require_premium` (`itemPremium`) — полей на проводе нет
//    (`savedStarGift`/`starGift` в `core/managers/starsManager.ts`).
//  • Контекстное меню (`createContextMenu`, `:170-176`; пункты share/pin/copy/
//    transfer/collections/wear/hide) — `createContextMenu` не портирован
//    (шапка `components/row.ts`); единственный пункт с предметом у нас —
//    «Hide»/«Show» (`stars.setHidden`) — приедет вместе с ним.
//  • Выделение (`hasSelection`/`CheckboxFieldTsx`) — режим попапа выбора
//    подарков в коллекцию, коллекций нет.
import { For, onCleanup } from 'solid-js'
import type { SavedStarGift } from '@core/managers/starsManager'
import { isGiftHidden } from '@core/managers/starsManager'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import { IconTsx } from '@components/iconTsx.solid'
import { StarGiftBadge } from './stargiftBadge.solid'
import { i18n } from '@lib/langPack'
import formatNumber from '@helpers/number/formatNumber'
import classNames from '@helpers/string/classNames'
import { getMiddleware } from '@helpers/middleware'
import { getPeerId } from '@core/peers/peerId'
import styles from './stargiftsGrid.module.scss'

function StarGiftGridItem(props: {
  item: SavedStarGift
  onClick?: () => void
  managers: AvatarManagers
}) {
  // `:275-279` — даритель мини-аватаром (`AvatarNewTsx size={20}`), у нас
  // императивный `avatarNew` (порт того же `avatarNew`).
  const fromId = () => props.item.from_id ? getPeerId(props.item.from_id) : undefined
  const senderAvatar = () => {
    const id = fromId()
    if(props.item.pFlags?.name_hidden || id === undefined) return undefined
    const middlewareHelper = getMiddleware()
    onCleanup(() => middlewareHelper.destroy())
    return avatarNew({ peerId: id, size: 20, middleware: middlewareHelper.get(), managers: props.managers }).node
  }

  return (
    <div
      class={/* @once */ classNames(styles.gridItem, styles.viewProfile)}
      onClick={props.onClick}
    >
      {isGiftHidden(props.item) && (
        <IconTsx icon="hide" class={/* @once */ styles.itemUnsaved} />
      )}
      <div class={/* @once */ styles.itemSticker}>{props.item.gift.emoji}</div>

      <div class={/* @once */ styles.itemFrom}>
        {senderAvatar() ?? (
          <div class={/* @once */ styles.itemFromAnonymous}>
            <img src="assets/img/anon_paid_reaction.png" alt="Anonymous" />
          </div>
        )}
      </div>

      {/* `:333-339` — ограниченный выпуск: «1 of N» */}
      {props.item.gift.availability_total ? (
        <StarGiftBadge>
          {i18n('StarGiftLimitedBadgeNum', [formatNumber(props.item.gift.availability_total, 1)])}
        </StarGiftBadge>
      ) : null}
    </div>
  )
}

export function StarGiftsGrid(props: {
  class?: string
  items: SavedStarGift[]
  onClick?: (item: SavedStarGift) => void
  managers: AvatarManagers
}) {
  return (
    <div class={classNames(styles.grid, props.class)}>
      <For each={props.items}>
        {(item) => (
          <StarGiftGridItem
            item={item}
            onClick={() => props.onClick?.(item)}
            managers={props.managers}
          />
        )}
      </For>
    </div>
  )
}
