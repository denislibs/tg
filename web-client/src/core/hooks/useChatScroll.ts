// src/core/hooks/useChatScroll.ts
//
// The conversation scroll state machine — the single owner of "where the viewport
// sits" (tweb's scrolledDown). It holds the scroll/content refs, the bottom-pin
// intent, history pagination triggers, scroll-position restore across prepends,
// jump-to-message, the scroll-to-bottom escape, and the read-marker (markRead /
// unread-below pill). Everything that writes scrollTop lives here, so there are no
// competing writers.
//
// atBottomRef / userScrolledUpRef are owned here and returned so the send path
// (useChatSend) can pin to the bottom when the user sends.
//
// Known exception to the "only realtimeBridge subscribes to the socket" rule: this
// hook listens to rootScope(RT.newMessage) to markRead a live message when the
// viewport is pinned to the bottom and focused — that decision needs scroll/focus
// state that only lives here. The message DATA path is still realtimeBridge →
// messagesStore; this is a pure UI reaction. The unread-below badge count is NOT
// accumulated from that stream (it drifted on remount/resync): it is DERIVED from
// the store — newestSeq − lastReadSeq — so it can't desync from the source of truth.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEvent } from './useEvent'
import { useManagers } from './useManagers'
import { smoothCenterElement, afterScrollSettles } from '../dom/smoothScrollToElement'
import rootScope from '@lib/rootScope'
import { RT, type NewMessageEvt } from '../realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import type { MessageWindow } from './useMessageWindow'
import ScrollSaver, { type ScrollSaverTarget } from '@helpers/scrollSaver'

interface UseChatScrollArgs {
  numericChatId: number
  isRealChat: boolean
  win: MessageWindow
  /** высота верхней распорки ленты (.bubbles-padding-top) */
  paddingTop: number
  /** seq первого непрочитанного входящего (плашка «Непрочитанные сообщения»);
   * null — открывать чат обычным пином к низу */
  unreadDividerSeq: number | null
  /** высота sticky-зоны над лентой (хедер + плеер + пин-бар) — плашка
   * непрочитанных позиционируется сразу под ней */
  unreadStickyTop: number
}

export function useChatScroll({ numericChatId, isRealChat, win, paddingTop, unreadDividerSeq, unreadStickyTop }: UseChatScrollArgs) {
  const managers = useManagers()
  const [showScrollDown, setShowScrollDown] = useState(false)
  // Unread-below badge on the scroll-to-bottom button (tweb .bubbles-go-down count):
  // DERIVED from the store, not accumulated from the event stream. newestSeq (the
  // dialog's last message) minus lastReadSeq (the viewer's read horizon) is the
  // count of messages below the read point — which, while scrolled up, are exactly
  // the ones below the viewport. markRead (at bottom) advances lastReadSeq → 0.
  // Store-derived ⇒ survives remount/resync with no drift (the old c+1 counter lost
  // its value on remount and double-counted on a replay). The FAB is hidden unless
  // scrolled up (showScrollDown), so a transient count at the bottom is never seen.
  const unreadBelow = useChatsStore((s) => {
    const d = s.dialogs.find((x) => x.chatId === numericChatId)
    if (!d) return 0
    return Math.max(0, (d.lastMessage?.seq ?? 0) - d.lastReadSeq)
  })
  // Briefly highlighted message (jump-to target), by seq.
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastScrollTopRef = useRef(0)
  // `atBottomRef` is the SINGLE source of truth for scroll intent (tweb's
  // `scrolledDown`): true = follow the bottom, false = the user is browsing history.
  const atBottomRef = useRef(true)
  // Whether the user has scrolled up away from the open-time bottom. Until they do,
  // we stay anchored to the bottom even if the loaded window's bottom isn't yet
  // confirmed as the REAL chat bottom (a cache re-open can report reachedBottom=false
  // when messages arrived between sessions) — loadNewer chases the latest while the
  // pin follows it. Set on a real upward scroll / a jump; reset on chat change.
  const userScrolledUpRef = useRef(false)
  // Position restore across a loadOlder prepend — tweb's ScrollSaver (helpers/scrollSaver.ts):
  // anchors on the topmost visible message's DOMRect instead of a raw scrollHeight delta, so
  // it stays correct when something OTHER than the prepended chunk resizes mid-settle (e.g. an
  // unrelated bubble below the fold reflows) — a plain distance-from-bottom would wrongly move
  // the viewport in that case. `scrollSaved` gates restore()/correctScroll to the prepend-settle
  // window only (mirrors the old pendingRestore-active window): ScrollSaver has no live container
  // class in this codebase (no JS scrollbar thumb — see the adapter below), so restore() must not
  // run before the first save() or long after the chunk it belongs to has settled.
  const scrollSaverRef = useRef<ScrollSaver | null>(null)
  if (!scrollSaverRef.current) {
    // Minimal ScrollSaverTarget adapter over the native scroll div (see scrollSaver.ts header for
    // why there's no vendored Scrollable class here). '[data-seq]' is our message-row anchor
    // selector (MessageRow.tsx), the direct counterpart of tweb's '.bubble:not(...)'. reverse:
    // true — this instance only serves the loadOlder (prepend-at-top) restore, matching tweb's
    // createScrollSaver(reverse=true) for the same call site.
    const target: ScrollSaverTarget = {
      get container() { return scrollRef.current as HTMLElement },
      get scrollPosition() { return scrollRef.current?.scrollTop ?? 0 },
      get scrollSize() { return scrollRef.current?.scrollHeight ?? 0 },
      onSizeChange() {},
      setScrollPositionSilently(value) {
        const el = scrollRef.current
        if (el) el.scrollTop = value
      },
    }
    scrollSaverRef.current = new ScrollSaver(target, '[data-seq]', true)
  }
  const scrollSaved = useRef(false)
  const restoreTimer = useRef<number | undefined>(undefined)
  // Jump-to-message: target seq awaiting its window to mount before we scroll to it.
  const pendingJumpSeq = useRef<number | null>(null)
  // Set by the down-arrow escape: the next window commit (reloadNewest) must land
  // pinned to the bottom. A layout effect (below) does the pin synchronously so it
  // beats the passive onScroll effect, which would otherwise reset atBottomRef from
  // the still-at-top scroll position the instant the new page renders.
  const pinBottomNext = useRef(false)

  // Show the "scroll to bottom" button once the user scrolls up away from the latest messages
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const st = el.scrollTop
      const dist = el.scrollHeight - st - el.clientHeight
      // A genuine upward scroll away from the bottom means the user is now browsing
      // history — release the open-time bottom anchor.
      if (st < lastScrollTopRef.current - 1 && dist > 240) userScrolledUpRef.current = true
      // Show the down-arrow when scrolled up OR when we jumped mid-history and the
      // true bottom of the chat isn't loaded yet (tweb: visible while !loadedAll.bottom).
      setShowScrollDown(dist > 240 || (isRealChat && win.msgs.length > 0 && !win.reachedBottom))
      // Track whether we're pinned to the bottom — the content ResizeObserver
      // re-pins while this holds (so async media/height growth never strands the
      // view in the middle or jitters it on incoming messages). For a real chat,
      // require the REAL chat bottom to be loaded (tweb: scrolledDown needs
      // loadedAll.bottom): otherwise a short mid-history window (e.g. a jump near
      // the chat top) sits within 240px of the LOADED bottom, flips this true, and
      // the re-pin + loadNewer feed each other into a cascade that loads the whole
      // history. While a real chat is still loading (no msgs yet) leave atBottomRef
      // at its open-time default so the initial scroll-to-bottom isn't cancelled.
      if (!isRealChat) {
        atBottomRef.current = dist < 240
      } else if (win.msgs.length > 0) {
        const atRealBottom = dist < 240 && win.reachedBottom
        // Stay pinned to the bottom from open until the user scrolls up. Once they
        // have, fall back to the strict real-bottom gate (prevents a mid-history
        // jump from false-pinning + cascading loadNewer).
        atBottomRef.current = !userScrolledUpRef.current || atRealBottom
        // markRead at the real bottom advances lastReadSeq → the derived
        // unread-below badge falls to 0 (no manual reset needed).
        if (atRealBottom && document.hasFocus()) {
          void managers.realtime.markRead({ chatId: numericChatId, upToSeq: win.msgs[win.msgs.length - 1].seq })
        }
      }
      // Only page on genuine USER scrolls: programmatic bottom-pinning scrolls
      // DOWN (st increases), so requiring an upward delta prevents the open-time
      // cascade that would otherwise load the whole history and strand the view.
      const goingUp = st < lastScrollTopRef.current - 1
      lastScrollTopRef.current = st
      if (!isRealChat || win.msgs.length === 0) return
      if (goingUp && st < 300 && !win.reachedTop && !win.loadingOlder) {
        // Preserve the user's place across the prepend: ScrollSaver.save() snapshots the
        // topmost visible message's DOMRect NOW, before the prepend touches the DOM (rects
        // must be measured pre-mutation). The layout effect restores it after the new chunk
        // commits, and the content observer keeps restoring it while the prepended media
        // settles (a single restore landed before the DOM/heights were final → the view
        // jumped onto the freshly-loaded older messages).
        scrollSaverRef.current!.save()
        scrollSaved.current = true
        if (restoreTimer.current) clearTimeout(restoreTimer.current)
        restoreTimer.current = window.setTimeout(() => { scrollSaved.current = false }, 1500)
        void win.loadOlder()
      }
      // Load newer when within ~a viewport of the loaded bottom, in EITHER scroll
      // direction. We must NOT require a downward delta here: at the exact loaded
      // bottom scrollTop is maxed, so wheeling down fires no scroll event and the
      // user gets stranded (the "scroll up a bit then back down to load" bug).
      // Triggering a viewport early also keeps content ready ahead of the read.
      // reachedBottom (+ atBottomRef gating) already prevents an open-time cascade.
      if (dist < el.clientHeight * 0.75 && !win.reachedBottom && !win.loadingNewer) {
        void win.loadNewer()
      }
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isRealChat, win, managers, numericChatId])
  // Screen-size safety net: if the loaded window doesn't overflow the viewport
  // there's nothing to scroll, so the scroll-driven loadNewer above can never
  // fire — on a very tall screen a single page can fit entirely. Pull more until
  // the feed is scrollable (or the real bottom is reached) so reading forward
  // always works, independent of viewport height. Bounded: each fetch adds a page.
  useEffect(() => {
    if (!isRealChat || win.loading || win.reachedBottom || win.loadingNewer) return
    const el = scrollRef.current
    if (el && el.scrollHeight <= el.clientHeight + 4) void win.loadNewer()
  }, [isRealChat, win])

  const scrollToBottom = () =>
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })

  const flashSeq = (seq: number) => {
    setHighlightSeq(seq)
    window.setTimeout(() => setHighlightSeq((s) => (s === seq ? null : s)), 2000)
  }
  // Glide the target bubble to the vertical center (tweb fastSmoothScroll, see
  // smoothCenterElement) and flash it once the scroll settles — flashing immediately
  // would play the highlight out mid-travel, gone before the target arrives.
  const smoothCenterToSeq = (el: HTMLElement, seq: number) => {
    const sc = scrollRef.current
    if (!sc) { el.scrollIntoView({ block: 'center' }); flashSeq(seq); return }
    atBottomRef.current = false
    userScrolledUpRef.current = true // a jump leaves the bottom anchor
    smoothCenterElement(sc, el)
    afterScrollSettles(sc, () => {
      // Guarantee the target actually ended up on screen. A competing scroll write
      // during the smooth glide (window fill, media settling, layout shift) can land
      // the view somewhere else — if the target is off-screen now, glide it back to
      // center (smooth, not an instant snap, so the correction reads cleanly). Only
      // re-assert when fully off-screen, so a user who scrolled away isn't yanked.
      const cur = document.querySelector(`[data-seq="${seq}"]`) as HTMLElement | null
      if (cur) {
        const r = cur.getBoundingClientRect(), scR = sc.getBoundingClientRect()
        if (r.bottom <= scR.top || r.top >= scR.bottom) cur.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      flashSeq(seq)
    })
  }
  const jumpToSeq = (seq?: number) => {
    if (seq == null || !isRealChat) return
    const el = document.querySelector(`[data-seq="${seq}"]`) as HTMLElement | null
    if (el) {
      // Target already in the rendered window → glide to it.
      smoothCenterToSeq(el, seq)
      return
    }
    // Fresh load: drop the bottom-pin NOW (before the new window commits), or the
    // content ResizeObserver pins the swapped-in window to its bottom while
    // atBottomRef is still true — a visible jerk (bottom → then the jump effect
    // yanks to the target) on the first jump after a reload.
    atBottomRef.current = false
    userScrolledUpRef.current = true // a jump leaves the bottom anchor
    pendingJumpSeq.current = seq
    void win.jumpTo(seq)
  }

  // Reset scroll intent on chat change. (The component remounts on chat switch via
  // key={selectedId}, so this is belt-and-braces; kept here as scroll-state init.)
  useEffect(() => {
    atBottomRef.current = true
    userScrolledUpRef.current = false
    scrollSaved.current = false
    if (restoreTimer.current) clearTimeout(restoreTimer.current)
  }, [numericChatId])

  // The single scroll corrector. Real nodes ⇒ real scrollHeight ⇒ stable, no
  // spacers/anchor math, no competing writers:
  //   • atBottomRef (tweb scrolledDown) → follow the bottom as content grows
  //     (open, live/sent messages, async media reserving its box);
  //   • else if a prepend is settling → ScrollSaver.restore() re-anchors on the saved
  //     message's DOMRect so the user's place (e.g. the image they were viewing) stays
  //     put while the older chunk and its media finish laying out. restore() is safe to
  //     call repeatedly (idempotent once settled — diff goes to 0), which is what lets
  //     the ResizeObserver below call it on every resize during the settle window.
  // Runs on every content resize AND right after a prepend commits (layout effect).
  const correctScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
    else if (scrollSaved.current) scrollSaverRef.current!.restore()
  }
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(() => correctScroll())
    obs.observe(content)
    correctScroll()
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId])
  // Restore the prepend position synchronously after the new chunk commits.
  useLayoutEffect(() => {
    if (scrollSaved.current) correctScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.msgs])

  // Открытие чата с непрочитанными: позиционируем плашку «Непрочитанные
  // сообщения» у верха вьюпорта (tweb followingUnread → scrollToBubble 'start')
  // вместо пина к низу. rAF-ретрай, потому что лента появляется позже коммита
  // окна (useFeedReveal показывает спиннер); после лесенки открытия позицию
  // дожимаем ещё раз — высоты доезжают. Один раз за открытие.
  const unreadScrolled = useRef(false)
  useEffect(() => {
    if (unreadScrolled.current || unreadDividerSeq == null) return
    let raf = 0
    const t0 = performance.now()
    // Плашка уплыла (лесенка/медиа доложили высоту) — вернуть к верху вьюпорта.
    const offset = unreadStickyTop + 8
    const reassert = (target: HTMLElement) => {
      const sc = scrollRef.current
      if (!sc || !document.contains(target)) return
      const d = target.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset
      if (Math.abs(d) > 24) sc.scrollTop += d
    }
    const tryPosition = () => {
      if (unreadScrolled.current) return
      const sc = scrollRef.current
      const target = sc?.querySelector('[data-unread-divider]') as HTMLElement | null
      if (sc && target) {
        unreadScrolled.current = true
        atBottomRef.current = false
        userScrolledUpRef.current = true // плашка выше низа — якорь к низу снят
        sc.scrollTop += target.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset
        window.setTimeout(() => reassert(target), 350)
        window.setTimeout(() => reassert(target), 900)
        return
      }
      if (performance.now() - t0 < 3000) raf = requestAnimationFrame(tryPosition)
    }
    tryPosition()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadDividerSeq])

  // After a jump-to-message window loads, scroll to the target + flash it.
  useLayoutEffect(() => {
    const seq = pendingJumpSeq.current
    if (seq == null) return
    const el = document.querySelector(`[data-seq="${seq}"]`) as HTMLElement | null
    if (el) {
      // Window mounted → glide to the target (tweb fastSmoothScroll). The bubble is
      // in the DOM now, so the distance-capped smooth scroll animates a short stretch
      // even when the jump spans the whole chat. (onScroll keeps lastScrollTopRef in
      // sync as the animation runs.)
      smoothCenterToSeq(el, seq)
      pendingJumpSeq.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.msgs])

  // After the down-arrow escape (reloadNewest) commits the newest page, pin to the
  // bottom synchronously. Doing it in a layout effect beats the passive onScroll
  // effect's re-run (which reads the still-at-top scroll and would clear
  // atBottomRef); the content ResizeObserver then keeps it pinned as media settles.
  useLayoutEffect(() => {
    if (!pinBottomNext.current) return
    const el = scrollRef.current
    if (el) { atBottomRef.current = true; userScrolledUpRef.current = false; el.scrollTop = el.scrollHeight }
    pinBottomNext.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.msgs])

  // Появление/исчезновение плейтов (пин, теги) меняет высоту верхней распорки
  // ленты. Компенсируем scrollTop на дельту, чтобы вьюпорт остался на месте
  // (tweb chat.ts preservePaddingScroll) — и в середине истории, и у низа.
  const prevPaddingTop = useRef(paddingTop)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const delta = paddingTop - prevPaddingTop.current
    prevPaddingTop.current = paddingTop
    if (el && delta !== 0) el.scrollTop += delta
  }, [paddingTop])

  // Read-marker for a live message in THIS open chat: mark read if the user is at
  // the bottom & focused (tweb: read only what's seen). When scrolled up we do
  // nothing here — the unread-below badge is derived from the store (newestSeq −
  // lastReadSeq), so the incoming message already grows it via lastMessage.seq. The
  // DATA path is realtimeBridge → messagesStore; this stays a pure UI reaction.
  useEffect(() => {
    if (!isRealChat) return
    // Подписка на rootScope напрямую (типизированный payload). storeProjection
    // пишет стор раньше (его подписка регистрируется на старте bridge), поэтому к
    // моменту этого обработчика окно/диалог уже обновлены.
    const onNewMessage = (m: NewMessageEvt) => {
      if (m.chat_id !== numericChatId) return
      if (atBottomRef.current && document.hasFocus()) {
        void managers.realtime.markRead({ chatId: numericChatId, upToSeq: m.seq })
      }
    }
    rootScope.addEventListener(RT.newMessage, onNewMessage)
    return () => rootScope.removeEventListener(RT.newMessage, onNewMessage)
  }, [isRealChat, numericChatId, managers])

  // Mark read on open / at the bottom — when the newest is loaded, focused, and the
  // viewport is pinned to the bottom, read up to max seq. This effect re-runs on
  // every win.msgs change, so it must be gated on atBottomRef: a user scrolled up in
  // history must NOT have the messages below the fold auto-marked read (tweb reads
  // only what's seen) — otherwise the derived unread-below badge could never rise.
  // Gated on focus like tweb (a background tab shouldn't mark a chat read).
  useEffect(() => {
    if (!isRealChat || !win.reachedBottom || win.msgs.length === 0) return
    if (!atBottomRef.current || !document.hasFocus()) return
    const maxSeq = win.msgs[win.msgs.length - 1].seq
    void managers.realtime.markRead({ chatId: numericChatId, upToSeq: maxSeq })
  }, [isRealChat, win.reachedBottom, win.msgs, numericChatId, managers])

  // Mark read when the window regains focus while we're at the bottom of this chat.
  useEffect(() => {
    if (!isRealChat) return
    const onFocus = () => {
      const el = scrollRef.current
      if (!el || win.msgs.length === 0) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
        // markRead advances lastReadSeq → derived unread-below badge → 0.
        void managers.realtime.markRead({ chatId: numericChatId, upToSeq: win.msgs[win.msgs.length - 1].seq })
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isRealChat, numericChatId, win.msgs, managers])

  // Floating "scroll to bottom" button (tweb .bubbles-go-down). If we jumped into
  // mid-history (true bottom not loaded), reload the newest page and pin to it —
  // scrolling the loaded window alone would strand us in old messages
  // (tweb onGoDownClick → setMessageId()).
  const onScrollDownClick = useEvent(() => {
    // No manual badge reset: landing at the bottom triggers markRead (onScroll /
    // reachedBottom effect) which advances lastReadSeq → derived unread-below → 0.
    if (isRealChat && !win.reachedBottom) {
      atBottomRef.current = true; userScrolledUpRef.current = false
      pendingJumpSeq.current = null
      pinBottomNext.current = true
      void win.reloadNewest()
    } else {
      scrollToBottom()
    }
  })

  return {
    scrollRef, contentRef,
    atBottomRef, userScrolledUpRef,
    highlightSeq,
    showScrollDown, unreadBelow,
    jumpToSeq,
    onScrollDownClick,
  }
}
