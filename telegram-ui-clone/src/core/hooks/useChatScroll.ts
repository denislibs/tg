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
// hook listens to uiEvents(rt:new_message) to decide markRead-vs-unread-pill for a
// live message in the OPEN chat — that decision needs scroll/focus state that only
// lives here. The message DATA path is still realtimeBridge → messagesStore; this is
// a pure UI reaction. (Folding it into a store-driven signal is future work.)
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEvent } from './useEvent'
import { smoothCenterElement, afterScrollSettles } from '../dom/smoothScrollToElement'
import { uiEvents } from './uiEvents'
import { RT, type NewMessageEvt } from '../realtime/events'
import type { MessageWindow } from './useMessageWindow'

interface ScrollManagers {
  realtime: { markRead(args: { chatId: number; upToSeq: number }): Promise<{ ok: boolean }> }
}

interface UseChatScrollArgs {
  numericChatId: number
  isRealChat: boolean
  win: MessageWindow
  managers: ScrollManagers
  playerOffset: number
}

export function useChatScroll({ numericChatId, isRealChat, win, managers, playerOffset }: UseChatScrollArgs) {
  const [showScrollDown, setShowScrollDown] = useState(false)
  // Count of new messages that arrived below the viewport while scrolled up
  // (shown as a badge on the scroll-to-bottom button, like tweb).
  const [unreadBelow, setUnreadBelow] = useState(0)
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
  // Distance-from-bottom to hold across a loadOlder prepend (null = not prepending).
  const pendingRestore = useRef<number | null>(null)
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
        if (dist < 240) setUnreadBelow(0)
      } else if (win.msgs.length > 0) {
        const atRealBottom = dist < 240 && win.reachedBottom
        // Stay pinned to the bottom from open until the user scrolls up. Once they
        // have, fall back to the strict real-bottom gate (prevents a mid-history
        // jump from false-pinning + cascading loadNewer).
        atBottomRef.current = !userScrolledUpRef.current || atRealBottom
        if (atRealBottom) {
          setUnreadBelow(0)
          if (document.hasFocus()) {
            void managers.realtime.markRead({ chatId: numericChatId, upToSeq: win.msgs[win.msgs.length - 1].seq })
          }
        }
      }
      // Only page on genuine USER scrolls: programmatic bottom-pinning scrolls
      // DOWN (st increases), so requiring an upward delta prevents the open-time
      // cascade that would otherwise load the whole history and strand the view.
      const goingUp = st < lastScrollTopRef.current - 1
      lastScrollTopRef.current = st
      if (!isRealChat || win.msgs.length === 0) return
      if (goingUp && st < 300 && !win.reachedTop && !win.loadingOlder) {
        // Preserve the user's place across the prepend: record distance-from-bottom
        // now; the layout effect restores it after the new chunk commits, and the
        // content observer keeps restoring it while the prepended media settles
        // (single rAF restore landed before the DOM/heights were final → the view
        // jumped onto the freshly-loaded older messages).
        pendingRestore.current = el.scrollHeight - el.scrollTop
        if (restoreTimer.current) clearTimeout(restoreTimer.current)
        restoreTimer.current = window.setTimeout(() => { pendingRestore.current = null }, 1500)
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
  useEffect(() => { atBottomRef.current = true; userScrolledUpRef.current = false; pendingRestore.current = null }, [numericChatId])

  // The single scroll corrector. Real nodes ⇒ real scrollHeight ⇒ stable, no
  // spacers/anchor math, no competing writers:
  //   • atBottomRef (tweb scrolledDown) → follow the bottom as content grows
  //     (open, live/sent messages, async media reserving its box);
  //   • else if a prepend is settling → hold distance-from-bottom so the user's
  //     place (e.g. the image they were viewing) stays put while the older chunk
  //     and its media finish laying out.
  // Runs on every content resize AND right after a prepend commits (layout effect).
  const correctScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
    else if (pendingRestore.current != null) el.scrollTop = el.scrollHeight - pendingRestore.current
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
    if (pendingRestore.current != null) correctScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.msgs])

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

  // Opening/closing the player changes the feed's top padding by playerOffset.
  // Compensate scrollTop by the delta so the viewport stays put (no jump up),
  // unless we're pinned to the bottom (the resize observer re-pins there).
  const prevPlayerOffset = useRef(playerOffset)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const delta = playerOffset - prevPlayerOffset.current
    prevPlayerOffset.current = playerOffset
    // Unconditional: the feed's top padding changed by `delta`, so shift
    // scrollTop by the same amount — keeps the viewport fixed whether the user
    // is mid-history or pinned to the bottom (no jump on play).
    if (el && delta !== 0) el.scrollTop += delta
  }, [playerOffset])

  // Read-marker for a live message in THIS open chat: mark read if the user is at
  // the bottom & focused, else bump the unread-below pill (tweb: read only what's
  // seen). The DATA path is realtimeBridge → messagesStore; this is a UI reaction.
  useEffect(() => {
    if (!isRealChat) return
    return uiEvents.on(RT.newMessage, (raw) => {
      const m = raw as NewMessageEvt
      if (m.chat_id !== numericChatId) return
      if (atBottomRef.current && document.hasFocus()) {
        void managers.realtime.markRead({ chatId: numericChatId, upToSeq: m.seq })
      } else {
        setUnreadBelow((c) => c + 1)
      }
    })
  }, [isRealChat, numericChatId, managers])

  // Mark read on open — when the newest is loaded and the window is focused, read up
  // to max seq (clears the unread badge). Gated on focus like tweb (a background tab
  // shouldn't mark a chat read).
  useEffect(() => {
    if (!isRealChat || !win.reachedBottom || win.msgs.length === 0) return
    if (!document.hasFocus()) return
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
        setUnreadBelow(0)
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
    setUnreadBelow(0)
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
