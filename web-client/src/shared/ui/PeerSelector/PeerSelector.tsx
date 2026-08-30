// PeerSelector — порт tweb `components/appSelectPeers.ts` + `components/selectorSearch.ts`.
//
// ОДИН компонент на все экраны выбора людей; форма и сторона — модификаторы,
// ровно как в оригинале (`appSelectPeers.ts:234-238`):
//   container.classList.add('selector', 'selector-' + design, 'selector-' + checkboxSide)
//
// Дерево 1:1 с живыми дампами (`docs/tweb/dom/dumps/`):
//   `15-right-06-administrators`, `15-right-07-subscribers`, `15-right-09-removed-users`,
//   `15-right-14-group-members` — правый вариант (`selector-round selector-right`);
//   `14-left-30-new-group-members`, `-30b-…-selected` — левый мастер с чипами
//   (`selector-square selector-left`).
//
//   div.selector.selector-{round|square}.selector-{right|left}
//     div.scrollable.scrollable-y.selector-scrollable
//       div.menu-horizontal-gradient-container.selector-search-gradient-container
//         div.menu-horizontal-gradient…selector-search-gradient
//       div.sidebar-left-section-container.selector-search-section-container
//         div.sidebar-left-section.selector-search-section
//           hr + div.sidebar-left-section-content
//             div.selector-search-container > div.scrollable.scrollable-y
//               div.selector-search > [чипы] + div.input-search.selector-search-input-container
//       [div.sidebar-left-section-container > div.sidebar-left-section-content.sidebar-left-section-caption]
//       div.selector-height-container
//         div.sidebar-left-section-container[.is-visible].selector-list-section-container
//           div.sidebar-left-section > hr + div.sidebar-left-section-content.selector-list-section-content
//             ul.chatlist > a.row…chatlist-chat.chatlist-chat-abitbigger
//         [div.selector-empty-placeholder]
//
// Что сознательно НЕ рендерим (в tweb это артефакты общего строителя строки
// диалога `appDialogsManager.addDialogNew`, у участника всегда пустые):
//   `div.row-title.row-title-right.dialog-title-details` со `span.message-status`
//   и `span.message-time` — у строки участника нет ни времени, ни статуса
//   доставки; `has-multiple-badges` на строке подписи — бейджей у неё тоже нет.
//
// Пустое состояние — порт `appSelectPeers.processPlaceholderOnResults` +
// `components/emptyPlaceholder.tsx`: `is-visible` на контейнере секции списка
// ставится РОВНО когда список непустой, иначе показывается
// `.selector-empty-placeholder` соседом внутри `.selector-height-container`.
import type { LangPackKey } from '@/lang'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import classNames from '../../lib/classNames'
import { useRipple } from '../Ripple/useRipple'
import Checkbox from '../Checkbox'
import InputSearch from '../InputSearch'
import TgIcon from '../../../components/TgIcon'
import UserAvatar from '../../../components/UserAvatar'
import LottieSticker from '../../../components/LottieSticker'
import { useT } from '../../../i18n'
import s from './PeerSelector.module.scss'

export interface SelectorPeer {
  /** ключ строки; он же `data-peer-id` (tweb) и ключ выбранного */
  id: number
  name: string
  /** id медиа аватарки (`user.photo.photo_id`); 0/undefined — фото нет */
  photoId?: number
  /** подпись под именем (tweb `wrapSubtitle`/`getSubtitleForElement`) */
  subtitle?: ReactNode
  /** строка не кликабельна, чекбокс заблокирован (уже участник) */
  disabled?: boolean
  /** галочка стоит независимо от выбора и чипа не даёт (уже участник) */
  checked?: boolean
  /** действия справа — наш заменитель контекстного меню участника из tweb */
  actions?: ReactNode
}

interface PeerSelectorProps {
  peers: SelectorPeer[]
  /** `multiSelect` (tweb): чекбоксы в строках + чипы выбранных в поле поиска */
  mode?: 'single' | 'multi'
  /** `design` (tweb): круглые чекбоксы правой колонки / квадратные левого мастера */
  design?: 'round' | 'square'
  /** `checkboxSide` (tweb): сторона чекбокса и, следом, весь модификатор колонки */
  side?: 'right' | 'left'
  placeholder?: string
  /** запрос наружу — для тех, кто досыпает в `peers` результаты сетевого поиска */
  onQueryChange?: (q: string) => void
  /** `peers` уже отфильтрован родителем — встроенный фильтр по имени выключен */
  noFilter?: boolean
  /** выбранные (mode='multi') */
  selected?: number[]
  onSelectedChange?: (ids: number[]) => void
  /** клик по строке (mode='single'); без него строки не кликабельны */
  onPick?: (peer: SelectorPeer) => void
  /** подпись между поиском и списком (tweb — отдельный SettingSection с caption) */
  caption?: ReactNode
  /** пустое состояние (tweb `emptyPlaceholder`, стикер UtyanSearch 140×140) */
  empty?: { title: LangPackKey; description?: LangPackKey }
  /** узлы между поиском и списком ВНУТРИ скроллера селектора: у попапа
   *  «Поделиться» это ряд «недавних» (`search-group search-group-contacts`) и
   *  табы папок — в дампе `17-popup-01-forward-share` они лежат именно там,
   *  а не отдельными соседями попапа. */
  beforeList?: ReactNode
  /** `selector-multiselect-hidden` (tweb): мультивыбор без поля чипов —
   *  так собран форвард-попап. */
  multiselectHidden?: boolean
}

// Чип выбранного пира — tweb `SelectorSearch.renderEntity` (selectorSearch.ts:319-400)
// + вставка `addChip` (:192-220): `scale-in` вешается на вставку и снимается по
// `animationend`, последнему чипу достаётся `is-last`.
function SelectorUserChip({ peer, isLast, onClick }: {
  peer: SelectorPeer
  isLast: boolean
  onClick: () => void
}) {
  const [scaleIn, setScaleIn] = useState(true)
  return (
    <div
      className={classNames('selector-user', 'selector-user-primary', scaleIn ? 'scale-in' : '', isLast ? 'is-last' : '')}
      data-key={peer.id}
      onClick={onClick}
      // `animationend` всплывает и от аватарки (`fade-in`) — снимаем класс
      // только по собственной анимации чипа, как tweb (слушатель на самом чипе).
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) setScaleIn(false) }}
    >
      <div className="selector-user-avatar-container">
        <UserAvatar id={peer.id} name={peer.name} photoId={peer.photoId} size={30} className="selector-user-avatar" />
        <div className="selector-user-avatar-close">
          <TgIcon name="close" />
        </div>
      </div>
      <div className="selector-user-title">
        <span className="peer-title">{peer.name}</span>
      </div>
    </div>
  )
}

// Строка списка — `appDialogsManager.addDialogNew` в обвязке `renderResults`
// (appSelectPeers.ts:1121-1152): чекбокс прижимается к началу строки при
// `checkboxSide === 'left'` и к концу при 'right'.
//
// Экспортируется отдельно: в tweb этот же ряд используют экраны, где списка
// нет вовсе, — шапка «прав админа»/«ограничений участника» это буквально
// `ul.chatlist.chatlist-new` с одной такой строкой (дамп `15-right-16-user-admin-rights`).
export function PeerRow({ peer, design = 'round', side = 'right', multi = false, checked = false, onClick }: {
  peer: SelectorPeer
  design?: 'round' | 'square'
  side?: 'right' | 'left'
  multi?: boolean
  checked?: boolean
  onClick?: () => void
}) {
  const { onPointerDown, ripple } = useRipple()
  const clickable = !!onClick && !peer.disabled
  const checkbox = multi ? (
    // `className=""` (а не дефолтный модульный `s.root` компонента) — раскладку
    // чекбокса внутри селектора целиком задаёт партиал:
    // `.selector .checkbox-field:not(.checkbox-field-toggle)` (_selector.scss:258-271)
    // абсолютит его и гасит `pointer-events`, переключение идёт кликом по строке.
    <Checkbox checked={checked || !!peer.checked} disabled={peer.disabled} shape={design} className="" />
  ) : null

  return (
    <a
      className={classNames(
        'row', 'no-wrap', 'row-with-padding',
        clickable ? 'row-clickable' : '', clickable ? 'hover-effect' : '', clickable ? 'rp' : '',
        'chatlist-chat', 'chatlist-chat-abitbigger',
        peer.subtitle == null ? 'no-subtitle' : '',
      )}
      data-peer-id={peer.id}
      onClick={clickable ? onClick : undefined}
      onPointerDown={clickable ? onPointerDown : undefined}
    >
      {side === 'left' ? checkbox : null}
      {clickable ? ripple : null}
      {peer.subtitle != null && (
        <div className={classNames('row-row', 'row-subtitle-row', 'dialog-subtitle')}>
          <div className={classNames('row-subtitle', 'no-wrap')}>{peer.subtitle}</div>
        </div>
      )}
      <div className={classNames('row-row', 'row-title-row', 'dialog-title')}>
        <div className={classNames('row-title', 'no-wrap', 'user-title')}>
          <span className="peer-title">{peer.name}</span>
        </div>
      </div>
      <UserAvatar
        id={peer.id}
        name={peer.name}
        photoId={peer.photoId}
        size="md"
        className={classNames('dialog-avatar', 'row-media', 'row-media-abitbigger')}
      />
      {side === 'right' ? checkbox : null}
      {peer.actions && (
        <span className={s.actions} onClick={(e) => e.stopPropagation()}>{peer.actions}</span>
      )}
    </a>
  )
}

export default function PeerSelector({
  peers,
  mode = 'single',
  design = 'round',
  side = 'right',
  placeholder,
  onQueryChange,
  noFilter = false,
  selected,
  onSelectedChange,
  onPick,
  caption,
  empty,
  beforeList,
  multiselectHidden = false,
}: PeerSelectorProps) {
  const t = useT()
  const [query, setQuery] = useState('')
  const multi = mode === 'multi'

  const list = useMemo(() => {
    if (noFilter) return peers
    const q = query.trim().toLowerCase()
    return q ? peers.filter((p) => p.name.toLowerCase().includes(q)) : peers
  }, [peers, query, noFilter])

  const selectedIds = selected ?? []
  // Чип обязан пережить смену выдачи: в tweb он живёт в собственном `chipsMap`
  // (selectorSearch.ts:188-189) и остаётся на месте, даже когда строки пира в
  // текущем списке уже нет (набрали другой запрос). Здесь ту же роль играет
  // кэш карточек всех виденных пиров — идемпотентная запись на рендере.
  const seenPeers = useRef(new Map<number, SelectorPeer>())
  for (const p of peers) seenPeers.current.set(p.id, p)
  // Порядок — ВЫБОРА (tweb добавляет чип в момент клика), не порядок списка.
  const chips = selectedIds
    .map((id) => seenPeers.current.get(id))
    .filter((p): p is SelectorPeer => !!p)

  const toggle = (peer: SelectorPeer) => {
    if (!onSelectedChange) return
    onSelectedChange(
      selectedIds.includes(peer.id)
        ? selectedIds.filter((x) => x !== peer.id)
        : [...selectedIds, peer.id],
    )
  }

  const onRowClick = (peer: SelectorPeer) =>
    multi
      ? (onSelectedChange ? () => toggle(peer) : undefined)
      : (onPick ? () => onPick(peer) : undefined)

  return (
    <div className={s.host}>
      <div className={classNames('selector', `selector-${design}`, `selector-${side}`, multiselectHidden ? 'selector-multiselect-hidden' : '')}>
        <div className={classNames('scrollable', 'scrollable-y', 'selector-scrollable')}>
          {/* tweb `Tabs.MenuGradient({color: 'background', className: 'selector-search-gradient', smaller: true})` */}
          <div className={classNames('menu-horizontal-gradient-container', 'selector-search-gradient-container')}>
            <div className={classNames(
              'menu-horizontal-gradient',
              'menu-horizontal-gradient-color-background',
              'menu-horizontal-gradient-smaller',
              'selector-search-gradient',
            )} />
          </div>

          <div className={classNames('sidebar-left-section-container', 'selector-search-section-container')}>
            <div className={classNames('sidebar-left-section', 'selector-search-section')}>
              {/* разделитель секции — tweb SettingSection (settingSection.ts:42-44) */}
              <hr />
              <div className="sidebar-left-section-content">
                <div className="selector-search-container">
                  <div className={classNames('scrollable', 'scrollable-y')}>
                    <div className="selector-search">
                      {multi && chips.map((p, i) => (
                        <SelectorUserChip
                          key={p.id}
                          peer={p}
                          isLast={i === chips.length - 1}
                          onClick={() => toggle(p)}
                        />
                      ))}
                      {/* tweb: `noBorder`/`noFocusEffect`, `clearBtn.remove()`
                          (selectorSearch.ts:38-49) — крестика очистки в селекторе нет. */}
                      <InputSearch
                        value={query}
                        onChange={(v) => { setQuery(v); onQueryChange?.(v) }}
                        placeholder={placeholder ?? t('Search')}
                        className="selector-search-input-container"
                        inputClassName="selector-search-input"
                        noBorder
                        noFocusEffect
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {caption != null && (
            // tweb removedUsers.tsx:62-67 — SettingSection с одним caption'ом,
            // у которого внутренний контейнер удалён (`firstElementChild.remove()`).
            <div className="sidebar-left-section-container">
              <div className={classNames('sidebar-left-section-content', 'sidebar-left-section-caption')}>
                {caption}
              </div>
            </div>
          )}

          {beforeList}

          <div className="selector-height-container">
            <div className={classNames(
              'sidebar-left-section-container',
              list.length ? 'is-visible' : '',
              'selector-list-section-container',
            )}>
              <div className="sidebar-left-section">
                <hr />
                <div className={classNames('sidebar-left-section-content', 'selector-list-section-content')}>
                  <ul className="chatlist">
                    {list.map((p) => (
                      <PeerRow
                        key={p.id}
                        peer={p}
                        design={design}
                        side={side}
                        multi={multi}
                        checked={selectedIds.includes(p.id)}
                        onClick={onRowClick(p)}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {empty && list.length === 0 && (
              <div className="selector-empty-placeholder">
                {/* tweb `wrapLocalSticker({assetName: 'UtyanSearch', width: 140, height: 140, loop: true})`
                    → `div.media-sticker-wrapper` + класс от emptyPlaceholder.tsx */}
                <div className={classNames('media-sticker-wrapper', 'selector-empty-placeholder-sticker')}>
                  <LottieSticker name="UtyanSearch" size={140} loop />
                </div>
                <div className="selector-empty-placeholder-title">{t(empty.title)}</div>
                {empty.description && (
                  <div className="selector-empty-placeholder-description">{t(empty.description)}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
