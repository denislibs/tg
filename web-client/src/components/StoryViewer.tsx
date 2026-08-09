import { createPortal } from 'react-dom'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import Menu, { MenuItem } from '../shared/ui/Menu'
import Popup from '../shared/ui/Popup'
import TgIcon from './TgIcon'
import Emoji from './emoji/Emoji'
import Avatar from '../shared/ui/Avatar'
import { useT } from '../i18n'
import { gradientFor } from '../core/dialogToChat'
import { initialStoryIndex, useStoryProgress, useStoryViewer } from '../core/hooks/useStoryViewer'
import { useStoryPreviewMedia } from '../core/hooks/useStoryPreviewMedia'
import EditStorySheet from './EditStorySheet'
import StealthModePopup from './StealthModePopup'
import StoryMediaAreas from './StoryMediaAreas'
import RepostStorySheet from './RepostStorySheet'
import { ForwardPicker } from './messages/ChatDialogs'
import { useChatsStore } from '../stores/chatsStore'
import { useStoriesStore } from '../stores/storiesStore'
import { useManagers } from '../core/hooks/useManagers'
import { uiEvents } from '../core/hooks/uiEvents'
import classNames from '../shared/lib/classNames'
import { animateStoryViewer, type StoryMorphElements } from './storyViewerMorph'
import type { StoryTargetGetter } from './StoriesRow'
import type { StoryGroup } from '../core/managers/storiesManager'
import s from './StoryViewer.module.scss'

// Статистика своей истории (графики) — оверлей по кнопке, не первый кадр → лениво.
const StoryStats = lazy(() => import('./StoryStats'))

// Быстрая реакция по умолчанию (tweb DEFAULT_REACTION_EMOTICON, viewer.tsx:249) + панель выбора.
const DEFAULT_REACTION = '❤'
const REACTIONS = ['❤', '👍', '🔥', '🥰', '👏', '😁', '😢']

// --- константы tweb (components/stories/viewer.tsx) ---------------------------
const STORY_DURATION = 5e3 // :107
const STORY_SCALE_SMALL = 0.33 // :109
const STORIES_PRESERVE = 2 // :110 — сколько соседей ВИДНО с каждой стороны
const STORIES_PRESERVE_HIDDEN = 2 // :111 — сколько ещё смонтировано (предзагрузка)
const MARGIN = 40 // :1743 — зазор между соседними сторями в карусели
const JOINER = ' • ' // :534

// Размер стори под вьюпорт (tweb store.tsx:523-535):
//   height = windowHeight − 48 − 8 − 8*2 − 8 = windowHeight − 80
//   width  = min(windowWidth, height * 9/16)
function calcSize() {
  const wh = window.innerHeight
  const ww = window.innerWidth
  const height = wh - 48 - 8 - 8 * 2 - 8
  const width = Math.min(ww, height * (9 / 16))
  // isFull (tweb viewer.tsx:2763-2767): портрет, либо окно уже стори + места под
  // раскрытый композер (135px) и поля 8px с двух сторон, либо стори во всю ширину.
  const isFull = wh > ww || ww < width + 135 + 8 * 2 || width === ww
  return { width, height, isFull }
}

function useStoriesSize() {
  const [size, setSize] = useState(calcSize)
  useEffect(() => {
    const onResize = () => setSize(calcSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

// Смещение соседнего пира в карусели (tweb calculateTranslateX, viewer.tsx:1725-1753).
// Первый сосед прижимается к активной стори с зазором MARGIN, дальние — стопкой из
// уменьшенных (STORY_SCALE_SMALL) стори с тем же зазором.
function calcTranslateX(diff: number, storyWidth: number): string {
  if (!diff) return '0px'
  const multiplier = diff > 0 ? 1 : -1
  const smallStoryWidth = storyWidth * STORY_SCALE_SMALL
  const distance = (storyWidth - smallStoryWidth) / 2 - MARGIN
  let offset = (storyWidth - distance) * multiplier
  if (Math.abs(diff) !== 1) {
    const d = diff - 1 * multiplier
    offset += d * smallStoryWidth + MARGIN * d
  }
  return `${offset}px`
}

// Текст даты в шапке (tweb getDateText, viewer.tsx:1957-2009: StoryJustNow /
// MinutesShortAgo / HoursShortAgo / полная дата + пометка edited).
// Отступление от tweb: у нас нет lang-пака Telegram с плюрализацией, поэтому
// короткие формы собираем сами через t().
function dateText(createdAt: string, edited: boolean, t: (s: string) => string): string {
  const ts = new Date(createdAt).getTime()
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  let head: string
  if (sec < 60) head = t('just now')
  else if (sec < 3600) head = `${Math.floor(sec / 60)} ${t('min ago')}`
  else if (sec < 86400) head = `${Math.floor(sec / 3600)} ${t('h ago')}`
  else head = new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return edited ? head + JOINER + t('edited') : head
}

/**
 * Полноэкранный просмотрщик историй — порт `tweb/src/components/stories/viewer.tsx`.
 *
 * Дерево 1:1 с живым DOM tweb (§7b дампа `07b-stories-viewer.json`); маунт —
 * `#stories-viewer` в index.html, как в tweb (у tweb внутри ещё обёртка solid-js
 * Portal, у React-портала её нет):
 *   .Viewer[.isReady][.isFull] [--stories-width; --stories-height]
 *     .ViewerBackground
 *     button.btn-icon.ViewerClose.rp                       (только !isFull)
 *     .ViewerStoryContainer [--translateX]                 × N пиров (карусель)
 *       .ViewerStory
 *         .ViewerStoryContent > .ViewerStoryContentItem > .ViewerStoryContentMediaContainer > media
 *         .hideOnSmall
 *           .ViewerStoryShadow / .ViewerStorySlides > .ViewerStorySlidesSlide [--progress] / .ViewerStoryHeader.night
 *         .ViewerStoryInfo > avatar-162 + peer-title       (заставка соседа)
 *       .ViewerStoryFooter | .storiesInput
 *
 * Открытие/закрытие — WAAPI-морф из аватарки ряда историй (`storyViewerMorph.ts`).
 */
export default function StoryViewer({ groupIndex, getTarget, onClose }: {
  groupIndex: number
  /** аватарка-источник морфа по индексу группы (tweb `props.target`) */
  getTarget?: StoryTargetGetter
  onClose: () => void
}) {
  const t = useT()
  const groups = useStoriesStore((st) => st.groups)
  const managers = useManagers()
  const dialogs = useChatsStore((st) => st.dialogs)
  const { width: storiesWidth, height: storiesHeight, isFull } = useStoriesSize()

  // Активный пир карусели. Клик по соседу и переход в конце историй меняют его.
  const [peerIndex, setPeerIndex] = useState(groupIndex)

  // --- морф открытия/закрытия (tweb animate(), viewer.tsx:3150-3313) -----------
  const rootRef = useRef<HTMLDivElement>(null)
  const backgroundRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const flyRef = useRef<HTMLDivElement>(null)
  const activeContainerRef = useRef<HTMLDivElement>(null)
  // Актуальные значения для эффектов, которые должны отработать ровно один раз.
  const peerIndexRef = useRef(peerIndex)
  peerIndexRef.current = peerIndex
  const getTargetRef = useRef(getTarget)
  getTargetRef.current = getTarget
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // tweb open() (viewer.tsx:3070-3075): клон аватарки заводится, только если
  // источник — сама аватарка; иначе контейнер морфит из бокса цели без полёта.
  const [hasFly] = useState(() => !!getTarget?.(groupIndex)?.classList.contains('avatar'))

  // show() (tweb :2762) — снимает .isInvisible; hasViewer (:2962) — .isReady.
  const [shown, setShown] = useState(false)
  const [ready, setReady] = useState(false)
  const [closing, setClosing] = useState(false)
  // tweb `animating` (:3366) — пока морф играет, клики и закрытие игнорируются.
  const animatingRef = useRef(true)

  const collectMorph = useCallback((): StoryMorphElements | null => {
    const root = rootRef.current
    if (!root) return null
    const activeContainer = activeContainerRef.current
    return {
      root,
      background: backgroundRef.current,
      closeButton: closeBtnRef.current,
      containers: Array.from(root.querySelectorAll<HTMLElement>(`.${s.ViewerStoryContainer}`)),
      activeContainer,
      headerAvatar: activeContainer?.querySelector<HTMLElement>(`.${s.ViewerStoryHeaderAvatar}`) ?? null,
      flyAvatar: flyRef.current,
      target: getTargetRef.current?.(peerIndexRef.current) ?? null,
    }
  }, [])

  // tweb close() (viewer.tsx:2844-2862): pause + viewerReady(false) + setShow(false),
  // после чего Transition играет те же кадры в обратную сторону и только потом
  // размонтирует вьюер.
  const requestClose = useCallback(() => {
    if (animatingRef.current) return
    animatingRef.current = true
    setReady(false)
    setClosing(true)
  }, [])

  const vm = useStoryViewer({
    groupIndex: peerIndex,
    onClose: requestClose,
    onNextPeer: () => {
      if (peerIndex >= groups.length - 1) return false
      setPeerIndex(peerIndex + 1)
      return true
    },
    onPrevPeer: () => {
      if (peerIndex <= 0) return false
      setPeerIndex(peerIndex - 1)
      return true
    },
  })

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [reply, setReply] = useState('')
  // 4c: лист редактирования (своя история), stealth-попап и меню чужой истории.
  const [editOpen, setEditOpen] = useState(false)
  const [stealthOpen, setStealthOpen] = useState(false)
  const [othersMenuOpen, setOthersMenuOpen] = useState(false)
  // 4d: share истории в чаты + репост.
  const [shareOpen, setShareOpen] = useState(false)
  const [repostOpen, setRepostOpen] = useState(false)

  // Звук: tweb стартует с muted (store.tsx:166) и даёт кнопку mute в шапке.
  const [muted, setMuted] = useState(true)
  // tweb setBuffering (store.tsx:438): ждём догрузки — таймер сегмента стоит,
  // само видео при этом НЕ ставится на паузу (viewer.tsx:1186-1192).
  const [buffering, setBuffering] = useState(false)

  // Ключ показываемой истории — им же сбрасываются прогресс, длительность и
  // готовность контента (вместо синхронизации состояния через useEffect).
  const storyKey = `${peerIndex}:${vm.current}`
  const [durationEntry, setDurationEntry] = useState({ key: '', ms: 0 })
  const [readyKey, setReadyKey] = useState('')
  const videoDurationMs = durationEntry.key === storyKey ? durationEntry.ms : 0
  const contentReady = readyKey === storyKey
  // Стабильные колбэки: onDuration сидит в зависимостях эффекта у StoryPeer.
  const onDuration = useCallback((ms: number) => setDurationEntry({ key: storyKey, ms }), [storyKey])
  const onContentReady = useCallback(() => setReadyKey(storyKey), [storyKey])

  // Авто-прогресс на паузе, если пользователь нажал Space (manualPause), открыт
  // любой оверлей (меню удаления, подтверждение, панель реакций, ввод ответа,
  // редактирование, stealth, share/репост) или показана статистика.
  const holds = menuOpen || confirmDel || pickerOpen || reply.length > 0 || editOpen || stealthOpen || othersMenuOpen || shareOpen || repostOpen
  // closing — tweb close() дёргает actions.pause() до анимации выхода (viewer.tsx:2857).
  const paused = vm.manualPause || holds || vm.showStats || closing

  // Длительность сегмента: для видео — длительность ролика (+0.001, чтобы отличать
  // видео от фото, tweb playOnReady viewer.tsx:1756-1765), иначе STORY_DURATION.
  const storyDuration = videoDurationMs ? videoDurationMs + 0.001 : STORY_DURATION
  const progressRef = useStoryProgress({
    paused: paused || buffering || !contentReady,
    duration: storyDuration,
    resetKey: storyKey,
    onEnd: vm.next,
  })

  // tweb держит вьюер в DOM с .isInvisible и запускает морф, когда готово медиа
  // видимых стори, но не дольше 250 мс (openOnReady + страховочный setTimeout,
  // viewer.tsx:2880-2898).
  // Отступление от tweb: там ждут готовности ВСЕХ отрисованных пиров, у нас —
  // активного (готовность соседей наверх не поднимается).
  useEffect(() => {
    if (shown) return
    if (contentReady) {
      setShown(true)
      return
    }
    const timeout = setTimeout(() => setShown(true), 250)
    return () => clearTimeout(timeout)
  }, [shown, contentReady])

  // Открытие: onEnter → animate(el, true) → onAfterEnter → viewerReady(true)
  // (tweb viewer.tsx:3369-3379). isReady (= hasViewer) выставляется завершением
  // морфа, а не таймером.
  useLayoutEffect(() => {
    if (!shown) return
    const els = collectMorph()
    if (!els) {
      animatingRef.current = false
      setReady(true)
      return
    }
    let alive = true
    void animateStoryViewer(els, true).then(() => {
      if (!alive) return
      animatingRef.current = false
      setReady(true)
    })
    return () => { alive = false }
  }, [shown, collectMorph])

  // Закрытие: те же кадры в обратную сторону, размонтирование — после них
  // (tweb onExit/onAfterExit, viewer.tsx:3382-3390).
  useLayoutEffect(() => {
    if (!closing) return
    const els = collectMorph()
    if (!els) {
      onCloseRef.current()
      return
    }
    void animateStoryViewer(els, false).then(() => onCloseRef.current())
  }, [closing, collectMorph])

  if (!vm.group || !vm.story) return null

  const submitReply = () => {
    const text = reply.trim()
    if (!text) return
    setReply('')
    void vm.sendReply(text)
  }

  // Окно монтируемых пиров (tweb viewer.tsx:2948-2950): ±(PRESERVE + PRESERVE_HIDDEN).
  const preserve = STORIES_PRESERVE + STORIES_PRESERVE_HIDDEN
  const from = Math.max(peerIndex - preserve, 0)
  const items = groups.slice(from, Math.min(peerIndex + preserve + 1, groups.length))

  // Правая часть шапки (tweb viewer.tsx:2701-2716):
  // [play/pause][mute — только для видео][⋮ меню][close — только isFull].
  // Отступление от tweb: privacy-иконки нет (P2 аудита §10.10).
  const headerRight = (
    <>
      <IconButton onClick={vm.togglePause} aria-label={t(vm.manualPause ? 'Play' : 'Pause')}>
        <TgIcon name={vm.manualPause ? 'play' : 'pause'} />
      </IconButton>
      {videoDurationMs > 0 && (
        <IconButton onClick={() => setMuted((m) => !m)} aria-label={t('Sound')}>
          <TgIcon name={muted ? 'speakerofffilled' : 'speakerfilled'} />
        </IconButton>
      )}
      <IconButton
        className="btn-menu-toggle night"
        onClick={() => (vm.isMe ? setMenuOpen(true) : setOthersMenuOpen(true))}
        aria-label={t('More')}
      >
        <TgIcon name="more" />
      </IconButton>
      {/* в isFull кнопка закрытия переезжает в шапку (tweb viewer.tsx:2710-2715) */}
      {isFull && (
        <IconButton onClick={requestClose} aria-label={t('Close')}>
          <TgIcon name="close" />
        </IconButton>
      )}
    </>
  )

  // Оверлеи поверх медиа активной стори (внутри .hideOnSmall, как в tweb).
  const overlay = (
    <>
      {vm.mediaAreas.length > 0 && (
        <div className={s.ViewerStoryMediaAreas}>
          <StoryMediaAreas areas={vm.mediaAreas} reactionsCount={vm.reactionsCount} onReaction={vm.toggleReaction} />
        </div>
      )}

      {/* 4d: плашка репоста (tweb repostInfo) — «репост от {автор}» */}
      {vm.fwdFrom && (
        <div className={s.repost}>
          <TgIcon name="storyrepost" size={14} color="#fff" />
          <Text noWrap color="#fff" size={12} weight={600}>
            {vm.fwdAuthorName ?? t('Repost')}
          </Text>
        </div>
      )}

      {/* Caption (+ пометка edited, payload story.edited) */}
      {(vm.story.caption || vm.edited) && (
        <div className={s.caption}>
          {vm.story.caption && <Text color="#fff" size={15}>{vm.story.caption}</Text>}
          {vm.edited && <Text color="rgba(255,255,255,0.6)" size={12}>{t('edited')}</Text>}
        </div>
      )}

      {/* Viewers list sheet (own stories) */}
      {vm.showViewers && (
        <div className={s.viewersSheet}>
          <div className={s.viewersHeader}>
            <Text color="#fff" weight={700} size={15} className={s.viewersTitle}>
              Просмотры{vm.viewers ? ` (${vm.viewers.length})` : ''}
            </Text>
            <IconButton onClick={() => vm.setShowViewers(false)} color="#fff" size="small">
              <TgIcon name="close" />
            </IconButton>
          </div>
          {vm.viewers == null ? (
            <Text color="rgba(255,255,255,0.6)" size={14} className={s.viewersEmpty}>Загрузка…</Text>
          ) : vm.viewers.length === 0 ? (
            <Text color="rgba(255,255,255,0.6)" size={14} className={s.viewersEmpty}>Пока нет просмотров</Text>
          ) : (
            vm.viewers.map((v) => (
              <div key={v.id} className={s.viewerRow}>
                <Avatar background={gradientFor(v.id)} text={v.displayName.charAt(0)} size={36} />
                <Text noWrap color="#fff" size={15}>{v.displayName}</Text>
              </div>
            ))
          )}
        </div>
      )}
    </>
  )

  // Низ контейнера: своя история — .ViewerStoryFooter, чужая — композер.
  // tweb footer своей истории (viewer.tsx:2445-2466): слева зрители, справа delete.
  const footer = vm.isMe ? (
    <div className={classNames(s.ViewerStoryFooter, s.hideOnSmall, s.isMe)}>
      {/* отступление от tweb: в tweb слева stacked-avatars зрителей (P2 аудита §10.12) */}
      <div className={s.ViewerStoryFooterLeft} onClick={vm.openViewers} role="button" aria-label="Просмотры">
        <span className={s.ViewerStoryFooterIcon}>
          <TgIcon name="eye" className={s.ViewerStoryFooterIconIcon} />
        </span>
        Просмотры{vm.viewers ? ` (${vm.viewers.length})` : ''}
      </div>
      <div className={s.ViewerStoryFooterRight}>
        <IconButton onClick={() => setConfirmDel(true)} aria-label={t('Delete')}>
          <TgIcon name="delete" />
        </IconButton>
      </div>
    </div>
  ) : (
    // отступление от tweb: композер приедет в фазе 6 (Task 6.2) — в tweb здесь
    // полный `div.chat-input.stories-input` с плейсхолдером «Reply Privately…».
    <div className={s.storiesInput}>
      {pickerOpen && (
        <div className={s.reactBar}>
          {REACTIONS.map((r) => (
            <div
              key={r}
              className={classNames(s.reactChip, vm.myReaction === r ? s.reactChipActive : '')}
              onClick={() => { vm.toggleReaction(r); setPickerOpen(false) }}
            >
              <Emoji e={r} size={30} />
            </div>
          ))}
        </div>
      )}
      <input
        className={s.replyInput}
        placeholder={t('Reply')}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submitReply() }
          // не даём навигации/паузе сториз перехватывать ввод
          e.stopPropagation()
        }}
      />
      <IconButton onClick={() => setPickerOpen((v) => !v)} aria-label={t('React')}>
        <TgIcon name="smile" />
      </IconButton>
      <div
        className={classNames(s.heartBtn, vm.myReaction ? s.heartActive : '')}
        onClick={() => vm.toggleReaction(vm.myReaction ?? DEFAULT_REACTION)}
        role="button"
        aria-label={t('React')}
      >
        {vm.myReaction ? (
          <div key={vm.myReaction} className={s.reactPop}>
            <Emoji e={vm.myReaction} size={26} />
          </div>
        ) : (
          <TgIcon name="reactions" size={26} color="#fff" />
        )}
        {vm.reactionsCount > 0 && <span className={s.reactCount}>{vm.reactionsCount}</span>}
      </div>
    </div>
  )

  return createPortal(
    <>
    <div
      ref={rootRef}
      className={classNames(s.Viewer, shown ? '' : s.isInvisible, ready ? s.isReady : '', isFull ? s.isFull : '')}
      style={{ '--stories-width': `${storiesWidth}px`, '--stories-height': `${storiesHeight}px` } as React.CSSProperties}
      // tweb вешает click в фазе перехвата и глушит все клики, пока играет морф
      // (viewer.tsx:3113-3116, 2966-2969).
      onClickCapture={(e) => { if (animatingRef.current) { e.stopPropagation(); e.preventDefault() } }}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div ref={backgroundRef} className={s.ViewerBackground} />
      {/* tweb: на десктопе close лежит отдельной кнопкой вне карточки (viewer.tsx:2980) */}
      {!isFull && (
        <IconButton ref={closeBtnRef} className={s.ViewerClose} onClick={requestClose} aria-label={t('Close')}>
          <TgIcon name="close" />
        </IconButton>
      )}

      {items.map((group, i) => {
        const index = from + i
        const diff = index - peerIndex
        // tweb shouldShow (viewer.tsx:2554-2571): дальние пиры смонтированы (медиа
        // предзагружается), но в DOM не выводятся.
        if (Math.abs(diff) > STORIES_PRESERVE) return null
        const active = diff === 0
        return (
          <StoryPeer
            key={group.author.id}
            containerRef={active ? activeContainerRef : undefined}
            group={group}
            storyIndex={active ? vm.current : initialStoryIndex(group)}
            active={active}
            diff={diff}
            isFull={isFull}
            storiesWidth={storiesWidth}
            fadeInOnMount={ready}
            paused={paused}
            muted={muted}
            progressRef={active ? progressRef : undefined}
            headerRight={active ? headerRight : undefined}
            overlay={active ? overlay : undefined}
            footer={active ? footer : undefined}
            onSelect={() => setPeerIndex(index)}
            onNext={vm.next}
            onPrev={vm.prev}
            onBuffering={setBuffering}
            onDuration={onDuration}
            onContentReady={onContentReady}
          />
        )
      })}

      {/* Меню своей истории: закреп в профиле, редактирование, удаление.
          Add/Remove from Profile 1:1 с tweb (Story.AddToProfile/RemoveFromProfile). */}
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} zIndex={3100} style={{ top: 56, right: 16, transformOrigin: 'top right' }}>
        <MenuItem
          icon={<TgIcon name={vm.pinned ? 'pinlist' : 'pinnedchat'} size={20} />}
          label={vm.pinned ? t('Story.RemoveFromProfile') : t('Story.AddToProfile')}
          onClick={() => { setMenuOpen(false); vm.togglePinned() }}
        />
        <MenuItem
          icon={<TgIcon name="edit" size={20} />}
          label={t('Edit')}
          onClick={() => { setMenuOpen(false); setEditOpen(true) }}
        />
        <MenuItem
          icon={<TgIcon name="forward" size={20} />}
          label={t('Share')}
          onClick={() => { setMenuOpen(false); setShareOpen(true) }}
        />
        {/* tweb ViewStatistics (viewer.tsx:2199-2201) — пункт меню, не кнопка шапки */}
        <MenuItem
          icon={<TgIcon name="statistics" size={20} />}
          label={t('Story statistics')}
          onClick={() => { setMenuOpen(false); vm.openStats() }}
        />
        <MenuItem
          icon={<TgIcon name="delete" size={20} />}
          label={t('Delete')}
          danger
          onClick={() => { setMenuOpen(false); setConfirmDel(true) }}
        />
      </Menu>

      {/* Меню чужой истории: Hide My View (stealth) — 1:1 с tweb Stories.StealthMode.View. */}
      <Menu open={othersMenuOpen} onClose={() => setOthersMenuOpen(false)} zIndex={3100} style={{ top: 56, right: 16, transformOrigin: 'top right' }}>
        <MenuItem
          icon={<TgIcon name="eye2" size={20} />}
          label={t('Stories.StealthMode.View')}
          onClick={() => { setOthersMenuOpen(false); setStealthOpen(true) }}
        />
        <MenuItem
          icon={<TgIcon name="storyrepost" size={20} />}
          label={t('Repost')}
          onClick={() => { setOthersMenuOpen(false); setRepostOpen(true) }}
        />
        <MenuItem
          icon={<TgIcon name="forward" size={20} />}
          label={t('Share')}
          onClick={() => { setOthersMenuOpen(false); setShareOpen(true) }}
        />
      </Menu>

      {/* Оверлеи ниже раньше жили под framer-AnimatePresence — её тут больше нет
          (в tweb анимаций на framer нет вообще), поэтому у StoryStats/EditStorySheet
          играет только анимация появления, exit-вариант пропускается. */}

      {/* Статистика своей истории (full-screen оверлей над просмотрщиком) */}
      <Suspense fallback={null}>
        {vm.showStats && <StoryStats storyId={vm.story.id} onClose={vm.closeStats} />}
      </Suspense>

      {/* Подтверждение удаления (tweb DeleteStoryTitle / DeleteStorySubtitle) */}
      {confirmDel && (
        <Popup
          open
          title={t('Delete story')}
          onClose={() => setConfirmDel(false)}
          width={360}
          action={{ label: t('Delete'), onClick: () => { setConfirmDel(false); vm.del() } }}
        >
          <div style={{ padding: '0 16px 8px' }}>
            <Text size={15}>{t('Are you sure you want to delete this story?')}</Text>
          </div>
        </Popup>
      )}

      {/* Лист редактирования своей истории (portal над вьювером) */}
      {editOpen && <EditStorySheet story={vm.story} onClose={() => setEditOpen(false)} />}

      {/* Stealth Mode popup (Hide My View из меню чужой истории) */}
      {stealthOpen && <StealthModePopup onClose={() => setStealthOpen(false)} />}

      {/* 4d: share истории в чаты (tweb share, переиспользуем ForwardPicker) */}
      {shareOpen && (
        <ForwardPicker
          dialogs={dialogs}
          onClose={() => setShareOpen(false)}
          onPick={(chatIds) => {
            setShareOpen(false)
            if (!chatIds.length) return
            void managers.stories.share(vm.story!.id, chatIds).then((n) => {
              uiEvents.emit('ui:toast', n > 0 ? 'История отправлена' : 'Не удалось отправить')
            }).catch(() => uiEvents.emit('ui:toast', 'Не удалось отправить'))
          }}
        />
      )}

      {/* 4d: репост чужой истории */}
      {repostOpen && (
        <RepostStorySheet
          sourceAuthorId={vm.group.author.id}
          sourceStoryId={vm.story.id}
          onClose={() => setRepostOpen(false)}
        />
      )}
    </div>

    {/* Клон аватарки, летящий из ряда историй в шапку (tweb `avatarFrom`,
        viewer.tsx:3077-3084). Лежит рядом с вьюером (в tweb — в overlayRoot),
        перерисовывается на текущего автора, вне анимации спрятан.
        Отступление от tweb: там позиционируется сам узел аватарки, у нас —
        обёртка (аватар рисует React-компонент). */}
    {hasFly && (
      <div ref={flyRef} className={s.flyAvatar}>
        <Avatar
          background={gradientFor(vm.group.author.id)}
          src={vm.group.author.avatarUrl || undefined}
          text={vm.group.author.displayName.charAt(0)}
          size={32}
        />
      </div>
    )}
    </>,
    // tweb viewer.tsx:3434 — `<Portal mount={document.getElementById('stories-viewer')}>`;
    // сам узел лежит в index.html. Фолбэк на body — для сред без нашего index.html (jsdom).
    document.getElementById('stories-viewer') ?? document.body,
  )
}

interface StoryPeerProps {
  /** ref на `.ViewerStoryContainer` — ставится только активному (морф мерит его бокс) */
  containerRef?: React.RefObject<HTMLDivElement | null>
  group: StoryGroup
  storyIndex: number
  active: boolean
  /** index − activeIndex: знак задаёт сторону карусели / грань куба */
  diff: number
  isFull: boolean
  storiesWidth: number
  /** пир появился уже при открытом вьюере → проявляется через .fadeIn */
  fadeInOnMount: boolean
  paused: boolean
  muted: boolean
  progressRef?: React.RefObject<HTMLDivElement | null>
  headerRight?: ReactNode
  overlay?: ReactNode
  footer?: ReactNode
  onSelect: () => void
  onNext: () => void
  onPrev: () => void
  onBuffering: (b: boolean) => void
  onDuration: (ms: number) => void
  onContentReady: () => void
}

// Один пир карусели — tweb `StoryPeerContainer` (viewer.tsx:2592-2739).
// Активный показывает интерфейс, соседи — только затемнённое медиа и заставку
// «аватар + имя» (.ViewerStoryInfo); клик по соседу переключает на него.
function StoryPeer(props: StoryPeerProps) {
  const {
    containerRef, group, storyIndex, active, diff, isFull, storiesWidth, fadeInOnMount,
    paused, muted, progressRef, headerRight, overlay, footer,
    onSelect, onNext, onPrev, onBuffering, onDuration, onContentReady,
  } = props
  const t = useT()
  const story = group.stories[storyIndex]
  const { url, isVideo, duration } = useStoryPreviewMedia(story?.mediaId ?? 0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const bg = gradientFor(group.author.id)

  // tweb createEffect на fadeIn (viewer.tsx:2573-2590): контейнер, въехавший в окно
  // видимости, появляется через opacity 0 → 1 (doubleRaf, чтобы поймать transition).
  const [fadeIn, setFadeIn] = useState(fadeInOnMount)
  useEffect(() => {
    if (!fadeIn) return
    let r2 = 0
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setFadeIn(false)) })
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Пауза интерфейса синхронно останавливает видео (tweb viewer.tsx:1186-1192).
  // Буферизация сюда НЕ входит — она тормозит только таймер сегмента.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (paused || !active) v.pause()
    else void v.play().catch(() => {})
  }, [paused, active, url])

  // Длительность видео-сегмента наверх (tweb playOnReady, viewer.tsx:1756-1765).
  useEffect(() => {
    if (active) onDuration(isVideo && duration > 0 ? duration * 1000 : 0)
  }, [active, isVideo, duration, onDuration])

  if (!story) return null

  // Клик по стори (tweb viewer.tsx:2611-2664): по соседу — переключение на него;
  // по активной — тап-зоны ⅓ назад / остальное вперёд, но не по интерфейсу.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active) { onSelect(); return }
    if (paused) return
    const el = e.target as HTMLElement
    if (!el.closest(`.${s.ViewerStory}`)) return
    if (
      el.closest(`.${s.ViewerStoryHeader}`) ||
      el.closest(`.${s.ViewerStoryMediaAreas}`) ||
      el.closest(`.${s.caption}`) ||
      el.closest(`.${s.viewersSheet}`)
    ) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX > rect.left + rect.width / 3) onNext()
    else onPrev()
  }

  return (
    <div
      ref={containerRef}
      className={classNames(
        s.ViewerStoryContainer,
        // isFull — грани куба (fromLeft/current/fromRight); иначе — карусель (.small)
        isFull
          ? classNames(diff < 0 ? s.fromLeft : '', active ? s.current : '', diff > 0 ? s.fromRight : '')
          : (active ? '' : s.small),
        fadeIn ? s.fadeIn : '',
      )}
      style={isFull ? undefined : ({ '--translateX': calcTranslateX(diff, storiesWidth) } as React.CSSProperties)}
      onClick={onClick}
    >
      <div className={s.ViewerStory}>
        <div className={s.ViewerStoryContent}>
          <div className={s.ViewerStoryContentItem}>
            <div className={s.ViewerStoryContentMediaContainer}>
              {/* отступление от tweb: у tweb перед медиа лежит canvas.canvas-thumbnail
                  с blur-превью — у наших историй такого превью нет */}
              {url && (isVideo ? (
                <video
                  key={story.mediaId}
                  ref={videoRef}
                  className={classNames('media-video', s.ViewerStoryContentMedia)}
                  src={url}
                  autoPlay
                  playsInline
                  muted={muted}
                  onLoadedData={() => { if (active) onContentReady() }}
                  // сбойное медиа не должно вешать сегмент навсегда — пускаем таймер
                  onError={() => { if (active) onContentReady() }}
                  onWaiting={() => { if (active) onBuffering(true) }}
                  onPlaying={() => { if (active) onBuffering(false) }}
                />
              ) : (
                <img
                  key={story.mediaId}
                  className={classNames('media-photo', s.ViewerStoryContentMedia)}
                  src={url}
                  alt=""
                  onLoad={() => { if (active) onContentReady() }}
                  onError={() => { if (active) onContentReady() }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className={s.hideOnSmall}>
          <div className={classNames(s.ViewerStoryShadow, story.caption ? s.hasCaption : '')} />
          <div className={s.ViewerStorySlides}>
            {group.stories.map((st, i) => (
              <div
                key={st.id}
                ref={active && i === storyIndex ? progressRef : undefined}
                className={s.ViewerStorySlidesSlide}
                // Просмотренные сегменты залиты целиком; текущий пишет --progress
                // из тикера, будущие переменной не имеют (width auto → 0).
                style={i < storyIndex ? ({ '--progress': '100%' } as React.CSSProperties) : undefined}
              />
            ))}
          </div>
          <div className={classNames(s.ViewerStoryHeader, 'night')}>
            <div className={s.ViewerStoryHeaderLeft}>
              <Avatar
                className={s.ViewerStoryHeaderAvatar}
                background={bg}
                src={group.author.avatarUrl || undefined}
                text={group.author.displayName.charAt(0)}
                size={32}
              />
              <div className={s.ViewerStoryHeaderInfo}>
                <div className={s.ViewerStoryHeaderRow}>
                  <span className={classNames('peer-title', s.ViewerStoryHeaderName)}>{group.author.displayName}</span>
                  <span className={s.ViewerStoryHeaderSecondary}>{`${JOINER}${storyIndex + 1}/${group.stories.length}`}</span>
                </div>
                <div className={classNames(s.ViewerStoryHeaderSecondary, s.ViewerStoryHeaderTime)}>
                  {dateText(story.createdAt, story.edited, t)}
                </div>
              </div>
            </div>
            <div className={s.ViewerStoryHeaderRight}>{headerRight}</div>
          </div>
          {overlay}
        </div>

        {/* Заставка соседа — в isFull её нет (tweb viewer.tsx:2729-2734) */}
        {!isFull && (
          <div className={s.ViewerStoryInfo}>
            <Avatar
              className={s.ViewerStoryInfoAvatar}
              background={bg}
              src={group.author.avatarUrl || undefined}
              text={group.author.displayName.charAt(0)}
              size={162}
            />
            <span className={classNames('peer-title', s.ViewerStoryInfoName)}>{group.author.displayName}</span>
          </div>
        )}
      </div>
      {footer}
    </div>
  )
}
