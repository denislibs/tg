// Каркас вкладки эмодзи-дропдауна — порт tweb `components/emoticonsDropdown/tab.ts`
// (класс EmoticonsTabC) + `search.tsx`. Дерево строится ровно как там:
//
//   div.tabs-tab.emoticons-container[.no-menu][.<padding>][.active][.no-border-top][.is-searching]
//     div.menu-wrapper.emoticons-menu-wrapper.emoticons-will-move-up        ← только если есть меню
//       div.scrollable.scrollable-x                                          (ScrollableX(menuWrapper))
//         nav.menu-horizontal-div.no-stripe.justify-start.emoticons-menu
//     div.emoticons-content
//       div.scrollable.scrollable-y[.emoticons-will-move-up]                 (Scrollable(content))
//         div.emoticons-search-container[.emoticons-will-move-down]
//           div.input-search.emoticons-search-input-container                (EmoticonsSearch)
//         div                                                                ← обёртка Animated cross-fade
//           div.emoticons-categories-container[.emoticons-will-move-down].emoticons-has-search.animated-item
//
// Классы `emoticons-will-move-*` вешаются только когда у вкладки есть меню
// (tab.ts:104-109) — у GIF-вкладки (noMenu) их нет, как и в живом дампе
// docs/research/tweb-dom/04-emoji-dropdown.json.
import { useEffect, useState, type ReactNode, type RefObject, type UIEvent } from 'react'
import { createPortal } from 'react-dom'
import InputSearch from '../../shared/ui/InputSearch'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'

/** Пункт ленты категорий: tweb StickersTabCategory.elements.menuTab —
 * `ButtonIcon(undefined, {noRipple: true})` + класс `menu-horizontal-div-item`.
 * Локальная категория получает `span.tgico` прямо в кнопку (menuTabPadding
 * удаляется), набор — `.not-local` и `div.menu-horizontal-div-item-padding`
 * с превью (category.ts:87-96, tab.ts:243-246). */
export function MenuTab({
  active,
  notLocal,
  onClick,
  children,
}: {
  active: boolean
  /** категория-набор (не локальная): превью в `.menu-horizontal-div-item-padding` */
  notLocal?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <IconButton
      noRipple
      className={classNames('menu-horizontal-div-item', notLocal ? 'not-local' : '', active ? 'active' : '')}
      onClick={onClick}
    >
      {notLocal ? <div className="menu-horizontal-div-item-padding">{children}</div> : children}
    </IconButton>
  )
}

/** Поле поиска вкладки — tweb EmoticonsSearch (search.tsx): общий InputSearch
 * с классом `emoticons-search-input-container`. Полоска emoji-групп в tweb
 * ВСТАВЛЯЕТСЯ внутрь него (`inputSearch.input.after(scrollableContainer)`),
 * поэтому здесь она уходит порталом в тот же узел `.input-search`.
 *
 * отступление от tweb: у `input` нет класса `emoticons-search-input`, а кнопки
 * `emoticons-search-input-arrow` (сброс выбранной группы) нет вовсе — общий
 * `shared/ui/InputSearch` не даёт ни докинуть класс на сам инпут, ни скрыть
 * свою иконку поиска, под которой эта стрелка живёт. Группа сбрасывается
 * повторным кликом по чипу. */
export function EmoticonsSearch({
  inputRef,
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  focused,
  chips,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  onChange: (v: string) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder: string
  focused?: boolean
  /** `.emoticons-search-input-category` — чипы emoji-групп */
  chips?: ReactNode
}) {
  // tweb вставляет полоску групп внутрь `.input-search`; у нас это родитель
  // инпута (см. комментарий в shared/ui/InputSearch — корень компонента и есть
  // `.input-search`), так что портал целится в него.
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(inputRef.current?.parentElement ?? null)
  }, [inputRef])

  return (
    <>
      {/* placeholder НЕ отдаём общему InputSearch: в tweb он переезжает внутрь
          `.emoticons-search-input-scrollable` (search.tsx:88-96) и там же
          гаснет вместе с чипами по `is-searching` — рендерим его ниже. */}
      <InputSearch
        ref={inputRef}
        className="emoticons-search-input-container"
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        focused={focused}
        onClear={() => onChange('')}
      />
      {host &&
        createPortal(
          <div
            className={classNames(
              'scrollable',
              'scrollable-x',
              'emoticons-search-input-scrollable',
              value.trim() ? 'is-searching' : '',
            )}
          >
            {/* tweb search.tsx:96 снимает с него `will-animate` */}
            <span className="i18n input-search-placeholder" onClick={() => inputRef.current?.focus()}>
              {placeholder}
            </span>
            {chips && <div className="emoticons-search-input-categories">{chips}</div>}
          </div>,
          host,
        )}
    </>
  )
}

export default function EmoticonsTab({
  padding,
  active,
  noMenu,
  searching,
  noBorderTop,
  menuRef,
  menu,
  scrollRef,
  onScroll,
  search,
  result,
  children,
}: {
  /** `emoji-padding` | `stickers-padding` | `gifs-padding` (tabs/*.ts) */
  padding: string
  active: boolean
  /** вкладка без ленты категорий (tweb GifsTab: `noMenu: true`) */
  noMenu?: boolean
  /** tweb tab.ts:176 — `container.classList.toggle('is-searching', …)` */
  searching?: boolean
  /** tweb index.ts:651 — снимается, как только скролл ушёл с нуля */
  noBorderTop?: boolean
  menuRef?: RefObject<HTMLElement | null>
  menu?: ReactNode
  scrollRef?: RefObject<HTMLDivElement | null>
  onScroll?: (e: UIEvent<HTMLDivElement>) => void
  /** содержимое `.emoticons-search-container` */
  search?: ReactNode
  /** результат поиска вместо контейнера категорий (tweb Animated cross-fade) */
  result?: ReactNode
  /** содержимое `.emoticons-categories-container` */
  children?: ReactNode
}) {
  const willMoveUp = noMenu ? '' : 'emoticons-will-move-up'
  const willMoveDown = noMenu ? '' : 'emoticons-will-move-down'
  return (
    <div
      className={classNames(
        'tabs-tab',
        'emoticons-container',
        noMenu ? 'no-menu' : '',
        padding,
        active ? 'active' : '',
        noBorderTop ? 'no-border-top' : '',
        searching ? 'is-searching' : '',
      )}
    >
      {!noMenu && (
        <div className={classNames('menu-wrapper', 'emoticons-menu-wrapper', 'emoticons-will-move-up')}>
          <div className={classNames('scrollable', 'scrollable-x')}>
            <nav ref={menuRef} className="menu-horizontal-div no-stripe justify-start emoticons-menu">
              {menu}
            </nav>
          </div>
        </div>
      )}
      <div className="emoticons-content">
        <div
          ref={scrollRef}
          className={classNames('scrollable', 'scrollable-y', willMoveUp)}
          onScroll={onScroll}
        >
          <div className={classNames('emoticons-search-container', willMoveDown)}>{search}</div>
          {/* обёртка Animated('cross-fade') из tweb tab.ts:158-165 — у неё нет классов */}
          <div>
            {result ?? (
              <div
                className={classNames(
                  'emoticons-categories-container',
                  willMoveDown,
                  'emoticons-has-search',
                  'animated-item',
                )}
              >
                {children}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
