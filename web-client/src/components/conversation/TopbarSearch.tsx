// Топбар-поиск по чату — порт tweb `src/components/chat/topbarSearch.tsx`
// (+ `src/components/inputSearch.ts`), дерево 1:1 с живым DOM tweb:
//
//   div.topbar-search-container
//     div.topbar-search-left-container[.is-focused]
//       div.topbar-search-left-background
//       div.input-search.topbar-search-input-container   ← [--padding-placeholder|-hashtag|-sender]
//         input.input-field-input.input-search-input.with-focus-effect.topbar-search-input
//         span.i18n.input-search-placeholder.will-animate
//         span.tgico.input-search-part.input-search-icon.will-animate
//         div.topbar-search-input-tools                  ← стрелки ↑/↓ + очистка
//         span.topbar-search-input-from                  ← «From: »
//         div.selector-user.topbar-search-input-entity   ← чип выбранного отправителя
//       div.topbar-search-left-reactions-container.topbar-search-left-collapsable  ← теги-реакции
//       div.topbar-search-left-reactions-container.topbar-search-left-collapsable  ← типы поиска
//       div.scrollable.scrollable-y.topbar-search-left-results.topbar-search-left-collapsable
//     div.topbar-search-right-container
//       div.topbar-search-right-filter[.is-hidden] × 2   ← «от кого» и «по дате»
//
// Стили — styles/tweb/_topbarSearch.scss (дословный порт партиала tweb).
// Вся presentation-логика — в useChatHeaderSearch; здесь только рендер + DOM-эффекты.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from 'react'
import Avatar from '../../shared/ui/Avatar'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import Emoji from '../emoji/Emoji'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { getPeerPhoto, getPeerPhotoId, type Chat as PeerChat, type User } from '../../core/peers/peer'
import { getPeerTitle } from '../../core/peers/getPeerTitle'
import { useChatHeaderSearch } from '../../core/hooks/useChatHeaderSearch'
import { gradientFor } from '../../core/dialogToChat'
import { messageDateISO, messageForReply } from '../../core/messageToConvMsg'
import { friendlyMsgTime } from '../../core/format/friendlyTime'
import { useLang, useT } from '../../i18n'
import type { Chat } from '../../data'

// tweb topbarSearch.tsx:657 MAX_HEIGHT — и высота списка, и «окно» центрирования
const MAX_HEIGHT = 271

// tweb getTextWidth(text, FontFull) — ширина строки в шрифте поля ввода
// (config/font.ts: FontFull = `400 16px Roboto, …`). Нужна, чтобы отодвинуть
// плейсхолдер и текст на «From: » / «#» (topbarSearch.tsx:517-519).
const FONT_FULL = '400 16px Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif'
let measureCtx: CanvasRenderingContext2D | null = null
function getTextWidth(text: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 0
  measureCtx.font = FONT_FULL
  return measureCtx.measureText(text).width
}

// Подсветка вхождения запроса в превью строки выдачи — tweb отдаёт сущность
// `messageEntityHighlight`, которая рендерится как `<i class="text-highlight">`
// (wrapRichText.ts:346); цвет/жирность берёт `.chatlist .text-highlight`.
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const parts: ReactNode[] = []
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  let i = 0
  let k = 0
  for (;;) {
    const idx = lower.indexOf(ql, i)
    if (idx < 0) { parts.push(text.slice(i)); break }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(<i key={k++} className="text-highlight">{text.slice(idx, idx + q.length)}</i>)
    i = idx + q.length
  }
  return <>{parts}</>
}

// tweb stringMiddleOverflow(str, maxLength) — длинный запрос в тексте «ничего не
// найдено» сокращается многоточием посередине (helpers/string/stringMiddleOverflow).
function middleOverflow(str: string, maxLength: number): string {
  return str.length > maxLength
    ? str.slice(0, Math.ceil(maxLength / 2)) + '...' + str.slice(-Math.floor(maxLength / 2))
    : str
}

// Строка выдачи-сообщения — та же разметка, что даёт tweb
// `appDialogsManager.addDialogAndSetLastMessage({avatarSize: 'abitbigger'})`:
// `a.row…chatlist-chat.chatlist-chat-abitbigger` с `.c-ripple` первым ребёнком.
// `active` — строка, к которой прыгнули (topbarSearch.tsx:870); `menu-open` —
// подсветка навигации по списку (attachListNavigation activeClassName).
function MessageRow({ chatId, senderId, name, photoId, preview, time, query, active, navigated, onPick }: {
  chatId: string
  senderId: number
  name: string
  photoId?: number
  preview: string
  time: string
  query: string
  active: boolean
  navigated: boolean
  onPick: () => void
}) {
  const { onPointerDown, ripple } = useRipple()
  // tweb отдаёт в строку только peerId, а фото достаёт avatarNew из стора пиров;
  // у нас тем же стором служит usePeers → `photo.photo_id`, а objectURL медиа
  // приезжает из воркерного конвейера (useMediaUrl, как в ChatListItem).
  const avatarSrc = useMediaUrl(photoId || null)
  return (
    <a
      className={classNames(
        'row', 'no-wrap', 'row-with-padding', 'row-clickable', 'hover-effect', 'rp',
        'chatlist-chat', 'chatlist-chat-abitbigger',
        active ? 'active' : '', navigated ? 'menu-open' : '',
      )}
      href={`#${chatId}`}
      data-peer-id={senderId}
      onPointerDown={onPointerDown}
      /* tweb attachListNavigation cancelMouseDown (:434): mousedown по списку
         отменяется, фокус остаётся на поле; уводит его уже onSelect (:432) */
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.preventDefault(); onPick() }}
    >
      {ripple}
      <div className="row-row row-subtitle-row dialog-subtitle">
        <div className="row-subtitle no-wrap dialog-subtitle-flex">
          <span className="dialog-subtitle-span dialog-subtitle-span-overflow dialog-subtitle-span-last">
            <Highlighted text={preview} query={query} />
          </span>
        </div>
      </div>
      <div className="row-row row-title-row dialog-title">
        <div className="row-title no-wrap user-title">
          <span className="peer-title">{name}</span>
        </div>
        <div className="row-title row-title-right row-title-right-secondary dialog-title-details">
          <span className="message-time">{time}</span>
        </div>
      </div>
      <Avatar
        background={gradientFor(senderId)}
        text={name.charAt(0)}
        src={avatarSrc}
        peerId={senderId}
        size={42}
        className="dialog-avatar row-media row-media-abitbigger"
      />
    </a>
  )
}

// Строка выбора отправителя — tweb `new Row({title, clickable: true})` +
// `createMedia('40')` + класс `topbar-search-left-sender` (topbarSearch.tsx:194-210).
// Публичное имя есть у `user` и у `channel`; у остальных конструкторов его в
// схеме нет вовсе.
const senderUsername = (peer: User | PeerChat | undefined): string | undefined =>
  peer && (peer._ === 'user' || peer._ === 'channel') ? peer.username : undefined

function SenderRow({ peerId, name, username, photoId, navigated, onPick }: {
  peerId: PeerId
  name: string
  username?: string
  photoId?: number
  navigated: boolean
  onPick: () => void
}) {
  const { onPointerDown, ripple } = useRipple()
  const avatarSrc = useMediaUrl(photoId || null)
  return (
    <div
      className={classNames(
        'row', 'no-subtitle', 'row-with-padding', 'row-clickable', 'hover-effect', 'rp',
        'topbar-search-left-sender', navigated ? 'menu-open' : '',
      )}
      onPointerDown={onPointerDown}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      {ripple}
      <div className="row-row row-title-row">
        <div className="row-title">
          <span>
            <b>{name}</b>{username ? <> <span className="secondary">{`@${username}`}</span></> : null}
          </span>
        </div>
      </div>
      <Avatar background={gradientFor(peerId)} text={name.charAt(0)} src={avatarSrc} peerId={peerId} size={40} className="row-media row-media-40" />
    </div>
  )
}

export interface TopbarSearchProps {
  chat: Chat
  onJumpToSeq: (seq: number) => void
  /** ref на `.topbar-search-container` — по нему ChatHeader гоняет opacity-анимацию
   *  появления/ухода (tweb chat.ts animateElements) */
  containerRef?: Ref<HTMLDivElement>
}

export default function TopbarSearch({ chat, onJumpToSeq, containerRef }: TopbarSearchProps) {
  const t = useT()
  const [lang] = useLang()
  const s = useChatHeaderSearch(chat, onJumpToSeq)

  const inputRef = useRef<HTMLInputElement>(null)
  const entityRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // tweb: `--padding-sender` = ширина чипа + 6px (topbarSearch.tsx:551).
  // Измеряем после верстки чипа — до замера отступа нет, как и в tweb.
  const [senderPadding, setSenderPadding] = useState(0)
  useLayoutEffect(() => {
    setSenderPadding(entityRef.current ? entityRef.current.offsetWidth + 6 : 0)
  }, [s.filterPeerId, s.filterPeerName])

  // tweb placeCaretAtEnd(inputSearch.input) после включения режима «от кого»
  // и после выбора отправителя (topbarSearch.tsx:1215 / :860).
  useEffect(() => {
    if (s.filteringSender) inputRef.current?.focus()
  }, [s.filteringSender, s.filterPeerId])

  // Автофокус при открытии панели (tweb: createEffect с placeCaretAtEnd, :409).
  useEffect(() => { inputRef.current?.focus() }, [])

  // Активная строка держится по центру списка (tweb onArrowButtonClick :678-681:
  // scrollTop = top − MAX_HEIGHT/2 + height/2).
  const centerRow = (selector: string) => {
    const scroller = scrollRef.current
    const row = scroller?.querySelector<HTMLElement>(selector)
    if (!scroller || !row) return
    scroller.scrollTop = row.offsetTop - MAX_HEIGHT / 2 + row.clientHeight / 2
  }
  useEffect(() => { centerRow('.row.active') }, [s.targetIdx])

  // Прелоадер в поле появляется, только когда поиск хотя бы раз стартовал
  // (tweb конструирует его лениво в InputSearch.toggleLoading).
  const everLoadedRef = useRef(false)
  if (s.loading) everLoadedRef.current = true
  const everLoaded = everLoadedRef.current

  // фото выбранного отправителя для чипа (tweb avatarNew в renderEntity)
  const filterPeerAvatar = useMediaUrl(s.filterPeerPhotoId ?? null)

  const hashWidth = useMemo(() => getTextWidth('#'), [])
  const fromText = `${t('Search.From')} `
  const fromWidth = useMemo(() => getTextWidth(fromText), [fromText])

  // tweb :552 — плейсхолдер поля
  const placeholder = s.filteringSender && s.filterPeerId == null
    ? t('Search.Member')
    : s.isHashtag ? t('Search.Hashtag') : t('Search')

  // tweb :693 — стрелки прячутся без выдачи и пока выбираем отправителя
  const arrowsHidden = !s.count || (s.filteringSender && s.filterPeerId == null)
  const isEmpty = s.text === ''

  const onClearClick = () => {
    const wasEmpty = isEmpty
    s.setText('')
    s.onInputClear(wasEmpty)
  }

  const senders = s.listType === 'senders'
  const listIsEmpty = s.count === 0 || (s.isHashtag && s.count === undefined)

  // ── навигация по списку с клавиатуры (tweb attachListNavigation, type 'y',
  // activeClassName 'menu-open'): стрелки двигают подсветку по кругу, Enter
  // выбирает; наведение мышью тоже переносит подсветку (onMouseMove :133). ──
  const [navIdx, setNavIdx] = useState(-1)
  useEffect(() => { setNavIdx(-1) }, [s.value, s.filterPeerId, s.filteringSender, s.reaction])
  const listLength = senders ? s.senderPeerIds.length : s.messages.length
  const moveNav = (delta: 1 | -1) => {
    if (listLength < 2) return
    setNavIdx((prev) => {
      const base = prev < 0 ? (delta === 1 ? -1 : 0) : prev
      const next = base + delta
      return next < 0 ? listLength - 1 : next >= listLength ? 0 : next
    })
  }
  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const list = e.currentTarget
    const row = (e.target as HTMLElement).closest('.row')
    if (row && row.parentElement === list) setNavIdx(Array.prototype.indexOf.call(list.children, row))
  }
  // tweb attachListNavigation setCurrentTarget → fastSmoothScroll position 'center'
  useEffect(() => { centerRow('.row.menu-open') }, [navIdx])
  const pickNavigated = () => {
    const idx = navIdx < 0 ? 0 : navIdx
    if (idx >= listLength) return
    s.pickTarget(idx)
    if (!senders) inputRef.current?.blur()
  }

  return (
    <div ref={containerRef} className="topbar-search-container">
      <div className={classNames('topbar-search-left-container', s.isActive ? 'is-focused' : '')}>
        <div className="topbar-search-left-background" />

        {/* поле ввода (tweb InputSearch с классами topbar-search-input*) */}
        {/* `is-connecting` ниже — НЕ автомат состояния соединения (тот живёт в
            components/connectionStatus.ts и ведёт поле поиска сайдбара). Здесь
            другая семантика: загрузка выдачи поиска по чату — порт своих же
            вызовов tweb `inputSearch.toggleLoading(true/false)` в
            chat/topbarSearch.tsx (:841 старт поиска, :800 первая пачка выдачи),
            источник — `s.loading` из useChatHeaderSearch. Сам класс инертен: CSS
            под него нет ни у нас, ни в tweb (единственное правило,
            _chatPinned.scss:971, про топбар звонка), а читает его в tweb только
            `InputSearch.isLoading()` — здесь поле собрано разметкой, а не
            компонентом, так что класс держим ради совпадения DOM с оригиналом.
            Видимостью управляют `is-hiding` на лупе и `.preloader-container`. */}
        <div
          className={classNames(
            'input-search', 'topbar-search-input-container',
            s.lookingHashtag === '' ? 'show-placeholder' : '',
            everLoaded && s.loading ? 'is-connecting' : '',
          )}
          style={{
            ['--padding-placeholder' as string]: `${s.shouldShowFromPlaceholder ? fromWidth : 0}px`,
            ['--padding-hashtag' as string]: `${s.isHashtag ? hashWidth : 0}px`,
            ['--padding-sender' as string]: `${senderPadding}px`,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            dir="auto"
            placeholder=" "
            className={classNames(
              'input-field-input', 'input-search-input', 'with-focus-effect', 'topbar-search-input',
              isEmpty ? 'is-empty' : '',
            )}
            value={s.text}
            onChange={(e) => s.setText(e.target.value)}
            onFocus={() => s.setIsInputFocused(true)}
            onBlur={() => s.setIsInputFocused(false)}
            onKeyDown={(e) => {
              // tweb onKeyDown (:502): Backspace на пустом поле снимает чип/режим
              if (e.key === 'Backspace' && isEmpty && (s.filterPeerId != null || s.filteringSender)) {
                s.onInputClear(true)
              } else if (e.key === 'Escape') {
                // tweb NavigationItem.onPop (:445): пока в поле есть текст, Escape
                // только снимает фокус; закрывает — уже следующий
                e.preventDefault()
                if (s.isInputFocused && s.value) e.currentTarget.blur()
                else s.close()
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                moveNav(e.key === 'ArrowDown' ? 1 : -1)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                pickNavigated()
              }
            }}
          />
          <span className="i18n input-search-placeholder will-animate">{placeholder}</span>
          <TgIcon
            name="search"
            size="var(--icon-size)"
            className={classNames('input-search-part', 'input-search-icon', everLoaded ? 'will-animate' : '', everLoaded && s.loading ? 'is-hiding' : '')}
          />
          {everLoaded && (
            /* tweb ProgressivePreloader.construct() — та же разметка, что в preloader.ts:96 */
            <div className={classNames('preloader-container', 'preloader-transparent', 'preloader-bold', 'is-visible', 'will-animate', s.loading ? '' : 'is-hiding')}>
              <div className="you-spin-me-round">
                <svg xmlns="http://www.w3.org/2000/svg" className="preloader-circular" viewBox="27 27 54 54">
                  <circle className="preloader-path-new" cx="54" cy="54" r="24" fill="none" strokeMiterlimit="10" />
                </svg>
              </div>
            </div>
          )}
          <div className="topbar-search-input-tools">
            {(['up', 'down'] as const).map((direction) => (
              <IconButton
                key={direction}
                noRipple
                className={classNames('input-search-part', 'topbar-search-input-arrow', arrowsHidden ? 'hide' : '')}
                onClick={() => s.onArrowButtonClick(direction)}
              >
                <TgIcon name={direction} />
              </IconButton>
            ))}
            <IconButton
              noRipple
              className="input-search-part input-search-button input-search-clear always-visible"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClearClick}
            >
              <TgIcon name="close" />
            </IconButton>
          </div>
          <span className={classNames('topbar-search-input-from', s.shouldShowFromPlaceholder ? 'is-visible' : '')}>
            {fromText}
          </span>
          {s.filterPeerId != null && (
            /* чип отправителя — tweb SelectorSearch.renderEntity (selectorSearch.ts:321) */
            <div
              ref={entityRef}
              className="selector-user topbar-search-input-entity scale-in"
              data-key={s.filterPeerId}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => s.setFilterPeerId(undefined)}
            >
              <div className="selector-user-avatar-container">
                <Avatar
                  background={gradientFor(s.filterPeerId)}
                  text={(s.filterPeerName ?? '').charAt(0)}
                  src={filterPeerAvatar}
                  size={30}
                  className="selector-user-avatar"
                />
                <div className="selector-user-avatar-close"><TgIcon name="close" size={22} /></div>
              </div>
              <div className="selector-user-title">{s.filterPeerName}</div>
            </div>
          )}
        </div>

        {/* теги-реакции «Избранного» (tweb :1282) */}
        <div
          className="topbar-search-left-reactions-container topbar-search-left-collapsable"
          style={s.reactionsHeight ? { height: `${s.reactionsHeight}px` } : undefined}
        >
          <div className="topbar-search-left-delimiter" />
          <div className="scrollable scrollable-x topbar-search-left-reactions-scrollable">
            <div className="topbar-search-left-reactions-padding" />
            <div className="reactions reactions-tag reactions-like-block topbar-search-left-reactions">
              {(s.savedTags ?? []).map((tag) => (
                <div
                  key={tag.reaction}
                  className={classNames('reaction', 'reaction-tag', 'reaction-like-block', s.reaction === tag.reaction ? 'is-chosen forwards' : '')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { s.toggleReaction(tag.reaction); inputRef.current?.focus() }}
                >
                  <div className="reaction-tag-background" />
                  <svg className="reaction-tag-svg" width="43" height="30" viewBox="0 0 43 30" xmlns="http://www.w3.org/2000/svg">
                    <path className="reaction-tag-svg-path" d="M40.8317 12.0432L34.9967 4.08636C33.1129 1.51761 30.1181 0 26.9326 0H7C3.13401 0 0 3.13401 0 7V23C0 26.866 3.13401 30 7 30H26.9326C30.1181 30 33.1129 28.4824 34.9967 25.9136L40.8317 17.9568C42.1223 16.1969 42.1223 13.8031 40.8317 12.0432Z" />
                  </svg>
                  <div className="reaction-tag-dot" />
                  <div className="reaction-sticker"><Emoji e={tag.reaction} size={20} /></div>
                  <span className="reaction-counter">
                    {tag.title ? <span className="reaction-counter-title">{tag.title}</span> : null}
                    {tag.title ? ' ' : ''}{tag.count}
                  </span>
                </div>
              ))}
            </div>
            <div className="topbar-search-left-reactions-padding" />
          </div>
        </div>

        {/* типы поиска по хэштегу (tweb :1291) — секция есть в дереве, но всегда
            схлопнута: `Search.Types.*` требует серверного hashtagType (см. отчёт) */}
        <div
          className="topbar-search-left-reactions-container topbar-search-left-collapsable"
          style={s.searchTypesHeight ? { height: `${s.searchTypesHeight}px` } : undefined}
        >
          <div className="topbar-search-left-delimiter" />
          <div className="scrollable scrollable-x topbar-search-left-reactions-scrollable">
            <div className="topbar-search-left-reactions-padding" />
            <div className="topbar-search-left-search-types" />
            <div className="topbar-search-left-reactions-padding" />
          </div>
        </div>

        {/* выдача (tweb Scrollable :1235) */}
        <div
          ref={scrollRef}
          className="scrollable scrollable-y topbar-search-left-results topbar-search-left-collapsable"
          style={s.resultsHeight ? { height: `${s.resultsHeight}px` } : undefined}
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) s.onScrolledBottom()
          }}
        >
          <div className="topbar-search-left-delimiter" />
          <div className={classNames('topbar-search-left-chatlist', 'chatlist', 'animated-item', listIsEmpty ? 'is-empty' : '')}>
            {listIsEmpty ? (
              <div className="topbar-search-left-results-empty">
                {s.isHashtag && s.count === undefined
                  ? t('Search.HelpHashtag')
                  : s.filterPeerId != null
                    ? <>{t('Search.Empty.FromPrefix')} <b>{s.filterPeerName}</b>.</>
                    : <>{t('Search.Empty.QueryPrefix')} <b>“{middleOverflow(s.value, 18)}”</b>{t('Search.Empty.Suffix')}</>}
              </div>
            ) : (
              <>
                {/* tweb attachListNavigation вешает `navigable-list` на первого
                    ребёнка списка (attachListNavigation.ts:131) */}
                <div className="navigable-list" onMouseMove={onListMouseMove}>
                  {senders
                    ? s.senderPeerIds.map((peerId, i) => (
                      <SenderRow
                        key={peerId}
                        peerId={peerId}
                        name={peerId === s.meId ? t('SavedMessages') : getPeerTitle({ peerId, peer: s.senderPeers.get(peerId) })}
                        username={senderUsername(s.senderPeers.get(peerId))}
                        photoId={getPeerPhotoId(getPeerPhoto(s.senderPeers.get(peerId)))}
                        navigated={i === navIdx}
                        onPick={() => s.pickTarget(i)}
                      />
                    ))
                    : s.messages.map((m, i) => (
                      <MessageRow
                        key={m.id}
                        chatId={chat.id}
                        senderId={m.fromId ?? 0}
                        name={getPeerTitle({ peerId: m.fromId ?? 0, peer: s.resultPeers.get(m.fromId ?? 0) }) || s.chatName}
                        photoId={getPeerPhotoId(getPeerPhoto(s.resultPeers.get(m.fromId ?? 0)))}
                        preview={messageForReply(m)}
                        time={friendlyMsgTime(messageDateISO(m.date), lang)}
                        query={s.value}
                        active={i === s.targetIdx}
                        navigated={i === navIdx}
                        onPick={() => { s.pickTarget(i); inputRef.current?.blur() }}
                      />
                    ))}
                </div>
                <div className="topbar-search-left-results-padding" />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="topbar-search-right-container">
        {s.canFilterSender && (
          <div className={classNames('topbar-search-right-filter', s.filteringSender || s.isHashtag ? 'is-hidden' : '')}>
            <IconButton
              className="topbar-search-right-filter-button"
              color="var(--secondary-text-color)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={s.startFilteringSender}
            >
              <TgIcon name="newprivate" />
            </IconButton>
          </div>
        )}
        <div className={classNames('topbar-search-right-filter', s.isHashtag ? 'is-hidden' : '')}>
          <IconButton color="var(--secondary-text-color)" onClick={s.openDatePicker}>
            <TgIcon name="calendar" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
