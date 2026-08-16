// Контекстное меню сообщения — обычный ui-kit Menu (портал/бэкдроп/анимация из
// кита, как у attach-меню). DOM — 1:1 с живым дампом tweb
// (`docs/tweb/dom/dumps/05-context-menu.json`, разметку строят
// `chat/contextMenu.ts::appendReactionsMenu` + `chat/reactionsMenu.ts`):
//
//   div.btn-menu.contextmenu.has-items-wrapper.<угол>
//     div.btn-menu-reactions-container.btn-menu-reactions-container-horizontal
//        .btn-menu-transition.is-visible
//       div.btn-menu-reactions-bubble.btn-menu-reactions-bubble-big
//       div.btn-menu-reactions
//         div.btn-menu-reactions-reaction > div.btn-menu-reactions-reaction-scale
//         button.btn-icon.btn-menu-reactions-more > span.tgico.button-icon
//     div.btn-menu-items.btn-menu-transition
//       div.btn-menu-item.rp-overflow …
//       hr
//
// `has-items-wrapper` снимает с самой панели фон/тень/паддинг и переводит их на
// `.btn-menu-items`, а показом обеих частей рулит `.btn-menu.active
// .btn-menu-transition` (_button.scss:149-158, 206-212) — всё это уже есть в
// портированном партиале, поэтому своих стилей у меню почти нет.
//
// Единственное осознанное упрощение: у tweb внутри `-reaction-scale` лежат две
// обёртки `media-sticker-wrapper` с `canvas.lottie` (appear/select-анимации
// реакции приезжают с MTProto-сервера) — у нас реакции статические эмодзи,
// поэтому в `-reaction-scale` стоит наш `<Emoji>`. Шеврон «ещё» разворачивает
// полный EmojiDropdown (tweb onMoreClick → EmojiTab).
import { Fragment, lazy, memo, Suspense, useRef, useState, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import Menu, { MenuItem, cornerFrom } from '../../shared/ui/Menu'
import Emoji from '../emoji/Emoji'
// Полный пикер эмодзи (шеврон «ещё реакции») — тот же ленивый чанк, что и в Composer.
const EmojiDropdown = lazy(() => import('../emoji/EmojiDropdown'))
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { usePortalContainer } from '../../core/pip'
import classNames from '../../shared/lib/classNames'
import s from './MessageContextMenu.module.scss'

// Список общий с быстрой реакцией по ховеру бабла (core/reactions.ts).
import { REACTIONS } from '../../core/reactions'

// Высота полоски (2.5rem) + зазор до меню (.5rem) — tweb --menu-offset.
const BAR_OFFSET = 48

export interface MsgMenuItem {
  icon: ReactNode
  /** строку прогоняем через t(), готовую ноду (скелетон read-date) — как есть */
  label: ReactNode
  danger?: boolean
  /** `hr` под пунктом — tweb ButtonMenu separatorDown */
  separatorDown?: boolean
  onClick?: (e: MouseEvent) => void
}

export interface MessageContextMenuProps {
  menu: { x: number; y: number; originX: 'left' | 'right'; originY: 'top' | 'bottom'; closing?: boolean }
  items: MsgMenuItem[]
  onClose: () => void
  /** exit-анимация доиграла — владелец окончательно размонтирует меню */
  onExited: () => void
  /** клик по эмодзи в полоске/пикере реакций (undefined — мок-чат, полоски нет) */
  onReaction?: (emoji: string) => void
}

function MessageContextMenu({ menu, items, onClose, onExited, onReaction }: MessageContextMenuProps) {
  const t = useT()
  const portalContainer = usePortalContainer()
  // Шеврон «ещё» разворачивает полный пикер эмодзи на месте меню (tweb EmojiTab).
  const [expanded, setExpanded] = useState(false)
  // The "Viewers" action needs the click coordinates; capture the last pointer
  // event on `.btn-menu-items` (capture-фаза срабатывает до onClick пункта), чтобы
  // MenuItem's (event-less) onClick could still forward it — своей обёртки у
  // пункта в tweb нет, так что перехватываем на общем контейнере.
  const lastEvent = useRef<MouseEvent | null>(null)

  // Anchor a corner at the click: top/left when growing down-right, right/bottom
  // (via CSS) when growing up-left — exact at the cursor regardless of menu size.
  const xPos: CSSProperties =
    menu.originX === 'left' ? { left: menu.x } : { right: window.innerWidth - menu.x }
  const yPos: CSSProperties =
    menu.originY === 'top' ? { top: menu.y } : { bottom: window.innerHeight - menu.y }
  // Полоска над панелью не должна уйти за верх экрана (меню открылось у верха) —
  // тогда tweb показывает её под меню (openSide top → шеврон 'up').
  const barBelow = menu.originY === 'top' && menu.y < BAR_OFFSET + 8

  if (expanded && onReaction) {
    // Полный пикер эмодзи на месте меню (tweb onMoreClick → EmojiTab);
    // exit-анимация пикера — при closing, окончательный анмаунт по onExited.
    return createPortal(
      <>
        {!menu.closing && (
          <div
            onClick={onClose}
            onContextMenu={(e) => { e.preventDefault(); onClose() }}
            style={{ position: 'fixed', inset: 0, zIndex: 2000 }}
          />
        )}
        <div style={{ position: 'fixed', ...xPos, ...yPos, zIndex: 2001 }}>
          <Suspense fallback={null}>
            <EmojiDropdown
              open={!menu.closing}
              className={s.pickerInMenu}
              onPick={(e) => onReaction(e)}
              onClose={onClose}
              onExitComplete={onExited}
            />
          </Suspense>
        </div>
      </>,
      portalContainer,
    )
  }

  return (
    <Menu
      open={!menu.closing}
      onClose={onClose}
      onExitComplete={onExited}
      className={classNames('contextmenu', 'has-items-wrapper', s.panel)}
      corner={cornerFrom(menu.originY, menu.originX)}
      style={{ ...xPos, ...yPos }}
    >
      {onReaction && (
        // Позиционирование полоски — целиком из партиала: `position: absolute` +
        // `margin-top: var(--menu-offset)` (= -(высота + .5rem)) поднимают её над
        // панелью, `inset-inline-end: var(--bubble-side-offset)` выравнивает по
        // краю (_button.scss:684-700). Инлайновых left/right больше нет.
        // `is-visible` обязателен: без него партиал держит `opacity: 0 !important`
        // (tweb вешает его в ChatReactionsMenu.render → setVisible).
        <div
          className={classNames(
            'btn-menu-reactions-container',
            'btn-menu-reactions-container-horizontal',
            'btn-menu-transition',
            'is-visible',
            barBelow ? s.below : '',
          )}
        >
          <div className="btn-menu-reactions-bubble btn-menu-reactions-bubble-big" />
          <div className="btn-menu-reactions">
            {REACTIONS.map((r) => (
              <div key={r} className="btn-menu-reactions-reaction" onClick={() => onReaction(r)}>
                {/* у tweb внутри -scale два `media-sticker-wrapper` с `canvas.lottie`
                    (appear + select); у нас реакция — статический <Emoji> */}
                <div className="btn-menu-reactions-reaction-scale">
                  <Emoji e={r} size={28} />
                </div>
              </div>
            ))}
            {/* tweb: ButtonIcon(`${openSide === 'bottom' ? 'down' : 'up'} btn-menu-reactions-more`)
                внутри `.btn-menu-reactions` (reactionsMenu.ts:183-188). Размер глифа
                даёт `.btn-icon` (font-size: 1.5rem), инлайном не задаём. */}
            <button
              type="button"
              className="btn-icon btn-menu-reactions-more"
              onClick={() => setExpanded(true)}
            >
              <TgIcon name={barBelow ? 'up' : 'down'} className="button-icon" size="inherit" />
            </button>
          </div>
        </div>
      )}
      <div className="btn-menu-items btn-menu-transition" onClickCapture={(e) => (lastEvent.current = e)}>
        {items.map((it, i) => (
          // Ключ — позиция: подписи больше не обязаны быть строками (read-date —
          // нода), а порядок пунктов внутри открытого меню не меняется.
          <Fragment key={i}>
            <MenuItem
              icon={it.icon}
              label={typeof it.label === 'string' ? t(it.label) : it.label}
              danger={it.danger}
              onClick={() => (it.onClick ? it.onClick(lastEvent.current as MouseEvent) : onClose())}
            />
            {it.separatorDown && <hr />}
          </Fragment>
        ))}
      </div>
    </Menu>
  )
}

export default memo(MessageContextMenu)
