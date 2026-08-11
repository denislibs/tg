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
import Scrollable from '@components/scrollable'

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
  // The real, ported tweb Scrollable (components/scrollable.ts) wrapping scrollRef's native
  // div as its `container` (constructed with no `el`, so it does NOT move/own React's children —
  // see the mount effect below). Gives us the throttled onScroll, the onScrolledTop/onScrolledBottom
  // pagination triggers, and — the piece Task 3 (ScrollSaver) explicitly deferred here —
  // setScrollPositionSilently/ignoreNextScrollEvent: a corrective scrollTop write that actually
  // skips its own next 'scroll' event, instead of relying on direction heuristics that a
  // scrollTop-decreasing restore() near the top could fool into "user scrolled up".
  const scrollableRef = useRef<Scrollable | null>(null)
  // Route every corrective (non-user) scrollTop write through it once mounted; before that (there's
  // one commit's gap before the mount effect below runs) fall back to a raw write. Also updates
  // lastScrollTopRef — the write is silent (no 'scroll' event, so onAdditionalScroll's own
  // `lastScrollTopRef.current = st` never runs for it); without this the NEXT real scroll event's
  // "went up" delta (`st < lastScrollTopRef.current - 1`) would be computed against a stale
  // pre-jump baseline and could misfire on an unrelated corrective jump (review Б-6).
  //
  // `recompute` (default true): re-run onAdditionalScroll()/checkForTriggers() right after the
  // write. This is THE choke point for "a silent write happened, showScrollDown/atBottomRef/
  // pagination triggers may now be stale" — moved here (review round after C-1/C-2) from
  // correctScroll, which only covered the writes IT made. Every OTHER silent writer had the exact
  // same gap: the unread-divider positioning below moves the viewport from the bottom to the
  // middle of history — thousands of pixels — and nothing recomputed after it, so the down-arrow
  // stayed OFF while the user sat mid-history (the C-1 bug's mirror image, on a different call
  // site). Tying the recompute to the write itself, not to whichever effect happened to make it,
  // means the NEXT silent writer added to this hook gets it for free instead of reintroducing the
  // same class of bug a seventh time.
  //
  // `false` is for paddingTop compensation ONLY (see that effect below): it moves scrollTop and
  // scrollHeight by the exact same delta (the padding spacer is itself part of the scrollable
  // content, so it grows scrollHeight before this effect even runs) — `dist` provably doesn't
  // change, so recomputing would be a guaranteed no-op. Skipping it also keeps this the one path
  // useChatScroll.test.tsx's lastScrollTopRef test can isolate line 91 (`lastScrollTopRef.current =
  // value`, review Б-6) in — every OTHER path now self-recomputes, and onAdditionalScroll's own
  // trailing `lastScrollTopRef.current = st` would silently re-sync it regardless of line 91,
  // masking a regression there (see that test's own header comment for the full trace).
  //
  // Not a recursion risk: onAdditionalScroll only reads scroll geometry and writes React
  // state/refs — no scrollTop write anywhere in its body. checkForTriggers can call onScrolledTop/
  // onScrolledBottom, which only scrollSaverRef.save()/win.loadOlder()/win.loadNewer() — loadOlder/
  // loadNewer are async, so any resulting scrollTop write (via a LATER win.msgs commit) lands on a
  // separate render, never synchronously inside this call.
  const setScrollTopSilently = (value: number, recompute = true) => {
    lastScrollTopRef.current = value
    const s = scrollableRef.current
    if (s) { s.setScrollPositionSilently(value) } else {
      const el = scrollRef.current
      if (el) el.scrollTop = value
    }
    if (recompute) {
      onAdditionalScroll()
      scrollableRef.current?.checkForTriggers()
    }
  }
  // Position restore across a loadOlder prepend — tweb's ScrollSaver (helpers/scrollSaver.ts):
  // anchors on the topmost visible message's DOMRect instead of a raw scrollHeight delta, so
  // it stays correct when something OTHER than the prepended chunk resizes mid-settle (e.g. an
  // unrelated bubble below the fold reflows) — a plain distance-from-bottom would wrongly move
  // the viewport in that case. `scrollSaved` gates restore()/correctScroll to the prepend-settle
  // window only (mirrors the old pendingRestore-active window): ScrollSaver itself has no notion of
  // "is a restore still pending" (see scrollSaver.ts — it's a pure save/restore pair, no settle-window
  // state of its own), so this ref is what stops restore() from running before the first save() or
  // long after the chunk it belongs to has settled.
  const scrollSaverRef = useRef<ScrollSaver | null>(null)
  if (!scrollSaverRef.current) {
    // Minimal ScrollSaverTarget adapter over the native scroll div (see scrollSaver.ts header for
    // why there's no Scrollable-owned container here — React, not Scrollable's constructor, owns
    // scrollRef's children). '[data-seq]' is our message-row anchor selector (MessageRow.tsx), the
    // direct counterpart of tweb's '.bubble:not(...)'. reverse: true — this instance only serves
    // the loadOlder (prepend-at-top) restore, matching tweb's createScrollSaver(reverse=true) for
    // the same call site. setScrollPositionSilently now genuinely silences (see setScrollTopSilently
    // above) — this is the fix for the bug Task 3 flagged and deferred here: restore() shrinking
    // scrollTop near the top used to be indistinguishable from the user scrolling up.
    const target: ScrollSaverTarget = {
      get container() { return scrollRef.current as HTMLElement },
      get scrollPosition() { return scrollRef.current?.scrollTop ?? 0 },
      get scrollSize() { return scrollRef.current?.scrollHeight ?? 0 },
      onSizeChange() {},
      setScrollPositionSilently: setScrollTopSilently,
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

  // Chat-specific per-scroll reactions (badge, atBottom pin/gate, markRead, "scrolled away
  // from the open-time bottom" detection) — the tweb counterpart of bubbles.ts wiring its OWN
  // onScroll as `scrollable.onAdditionalScroll` (Scrollable's throttled onScroll calls it after
  // updating lastScrollDirection — scrollable.ts:210-244). useEvent gives this a stable identity
  // so the mount effect below can assign it to the Scrollable instance exactly once while it
  // keeps reading the latest win/isRealChat/managers/numericChatId.
  const onAdditionalScroll = useEvent(() => {
    const el = scrollRef.current
    if (!el) return
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
    lastScrollTopRef.current = st
  })

  // Pagination triggers — tweb Scrollable.checkForTriggers (scrollable.ts:433-457): fires
  // onScrolledTop/onScrolledBottom unconditionally once within onScrollOffset (300px, tweb
  // bubbles.ts's own `new Scrollable(null, 'IM', 300)`, matched below) of the respective edge.
  // loadedAll ISN'T read inside Scrollable itself (scrollable.ts:374 only declares the field) —
  // tweb's bubbles.ts reads it in the CALLBACK (loadMoreHistory), same as here. This replaces the
  // homemade `goingUp && st < 300 && !win.reachedTop` / `dist < clientHeight * 0.75` thresholds
  // this hook used to compute itself (Task 3 explicitly deferred the fix for the former to here —
  // see scrollSaverRef's header comment above).
  const onScrolledTop = useEvent(() => {
    if (!isRealChat || win.msgs.length === 0) return
    const s = scrollableRef.current
    if (!s || s.loadedAll.top || win.loadingOlder) return
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
  })
  const onScrolledBottom = useEvent(() => {
    // Same explicit gate as onScrolledTop above — the pre-refactor code had this implicitly (one
    // shared `if (!isRealChat || win.msgs.length === 0) return` above BOTH triggers in a single
    // onScroll function); splitting into two Scrollable callbacks dropped it from this one
    // (review Б-5). win.loadNewer() itself no-ops on an empty/non-real window regardless, but
    // keeping the gate explicit here matches onScrolledTop and avoids relying on that internally.
    if (!isRealChat || win.msgs.length === 0) return
    const s = scrollableRef.current
    if (!s || s.loadedAll.bottom || win.loadingNewer) return
    void win.loadNewer()
  })

  // Mount the real, ported Scrollable once (this hook's whole component remounts per chat via
  // key={selectedId} — see the "chat change" reset effect below, so one instance per chat is
  // correct). `container: el`, no `el` argument — Scrollable's constructor only moves/owns
  // children when given one (scrollable.ts's `if(el) {...}` branch); here it just wraps the div
  // React already renders and owns, replacing the raw `el.addEventListener('scroll', ...)` this
  // hook used to own directly.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const scrollable = new Scrollable(undefined, 'chat', 300, undefined, el)
    scrollableRef.current = scrollable
    scrollable.onAdditionalScroll = onAdditionalScroll
    scrollable.onScrolledTop = onScrolledTop
    scrollable.onScrolledBottom = onScrolledBottom
    onAdditionalScroll() // eager run — seeds showScrollDown/atBottomRef from the mount scrollTop
    return () => {
      scrollable.destroy()
      // destroy() doesn't remove the thumb container it may have prepended (thumb/thumbContainer
      // are `protected`, unset — tweb's own container is throwaway, so it never needed to; ours is
      // React's persistent scrollRef div, so under StrictMode's dev mount→unmount→mount a leftover
      // node would double up — review Б-4). `.scrollable-thumb-container` only exists when
      // !IS_OVERLAY_SCROLL_SUPPORTED() created it (scrollable.ts's constructor); harmless no-op
      // query otherwise.
      el.querySelector(':scope > .scrollable-thumb-container')?.remove()
      scrollableRef.current = null
    }
  }, [onAdditionalScroll, onScrolledTop, onScrolledBottom])
  // Keep loadedAll in sync with the window's real top/bottom (tweb: bubbles.ts' setLoaded()
  // writes scrollable.loadedAll[side] on every window-state change) — onScrolledTop/
  // onScrolledBottom above read it at trigger time.
  useEffect(() => {
    const s = scrollableRef.current
    if (!s) return
    s.loadedAll.top = win.reachedTop
    s.loadedAll.bottom = win.reachedBottom
  }, [win.reachedTop, win.reachedBottom])
  // Re-derive showScrollDown/atBottomRef eagerly whenever the window's msgs/reachedBottom
  // actually change — NOT only from throttled scroll events. The pre-Scrollable onScroll ran
  // this synchronously at the top of its own `[isRealChat, win, managers, numericChatId]`-deps
  // effect on every win change; that eager call is what this restores. Needed because corrective
  // writes now go through setScrollPositionSilently, which BY DESIGN produces no scroll event —
  // e.g. onScrollDownClick's reloadNewest() + pinBottomNext silently pins to the bottom once the
  // new page commits; without this eager re-run, win.reachedBottom flipping true wouldn't reach
  // setShowScrollDown until the user scrolled by hand (review blocker Б-3).
  //
  // Deps are `win.msgs`/`win.reachedBottom` (the only two `win` fields onAdditionalScroll's body
  // actually reads), NOT the whole `win` object: useMessageWindow.ts's `return {...}` builds a
  // FRESH wrapper object literal on every call, so `win` itself changes reference on every
  // render of Chat.tsx — including ones with nothing to do with scroll (theme toggle, unrelated
  // store update). That would fire this effect (and its markRead call, when pinned to the bottom
  // and focused) on every such re-render — a real, avoidable network call, not just a wasted
  // recompute. `win.msgs`/`win.reachedBottom` are direct fields of the STORE's window record
  // (useMessageWindow.ts: `useMessagesStore((s) => s.byKey[key])`) and stay reference-stable
  // across renders that don't touch that store key — same narrowing already used by the "mark
  // read on open/at the bottom" effect below (`[isRealChat, win.reachedBottom, win.msgs, ...]`).
  useEffect(() => {
    onAdditionalScroll()
  }, [win.msgs, win.reachedBottom, onAdditionalScroll])
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
    // Cleanup, not just init: key={selectedId} means a chat switch fully unmounts this
    // hook instance rather than re-running this effect ([numericChatId] is fixed for the
    // instance's whole lifetime) — so the ONLY way to catch a restoreTimer left pending by
    // onScrolledTop (set after this effect's init run already happened, e.g. the user
    // scrolled up right before switching chats) is a real unmount cleanup here. Without it
    // the timer fires ~1.5s after unmount and writes into a dead instance's scrollSaved ref
    // — harmless (no crash, no visible effect), but still a stray timer outliving its owner.
    return () => { if (restoreTimer.current) clearTimeout(restoreTimer.current) }
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
    // tweb bubbles.ts:2276 — `scrollable.setScrollPositionSilently(scrollable.scrollSize) //
    // keep the chat pinned to the bottom`, same silent write for the same reason here.
    // setScrollTopSilently recomputes showScrollDown/atBottomRef/pagination triggers itself now
    // (see its own header comment, review round after C-1/C-2) — this function used to duplicate
    // that recompute here, which only covered the two writes IT makes; moved to the write itself
    // so every OTHER silent writer in this hook gets the same fix, not just these two.
    if (atBottomRef.current) setScrollTopSilently(el.scrollHeight)
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
      if (Math.abs(d) > 24) setScrollTopSilently(sc.scrollTop + d)
    }
    const tryPosition = () => {
      if (unreadScrolled.current) return
      const sc = scrollRef.current
      // Плашка — не отдельный узел, а модификатор бабла (ChatFeed.tsx's
      // isFirstUnread, tweb bubbles.ts:11609 is-first-unread); бабл несёт
      // data-seq (MessageRow.tsx), поэтому якорь ищется по нему, а не по
      // отдельному атрибуту плашки — такого узла в разметке нет.
      const target = sc?.querySelector(`[data-seq="${unreadDividerSeq}"]`) as HTMLElement | null
      if (sc && target) {
        unreadScrolled.current = true
        atBottomRef.current = false
        userScrolledUpRef.current = true // плашка выше низа — якорь к низу снят
        setScrollTopSilently(sc.scrollTop + target.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset)
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
    if (el) { atBottomRef.current = true; userScrolledUpRef.current = false; setScrollTopSilently(el.scrollHeight) }
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
    // tweb bubbles.ts:2285 — `scrollable.setScrollPositionSilently(scrollable.scrollPosition + delta)`.
    // recompute=false: the padding spacer is itself scrollable content, so scrollHeight already grew
    // by the same `delta` before this effect ran — dist = scrollHeight-scrollTop-clientHeight is
    // unchanged by this write, recomputing would be a no-op (see setScrollTopSilently's own header
    // comment for why this is the one path deliberately excluded).
    if (el && delta !== 0) setScrollTopSilently(el.scrollTop + delta, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
