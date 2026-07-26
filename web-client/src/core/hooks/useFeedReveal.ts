// src/core/hooks/useFeedReveal.ts
//
// First-load reveal policy for the feed: a grace-delayed, minimum-duration spinner
// (so a cache hit never flashes one), `feedLoading` to gate the list, and the
// open-chat ladder arming (tweb animateAsLadder) — the first NETWORK-loaded batch
// cascades in; a cache hit reveals instantly with no animation, and live appends
// after the first batch insert plainly.
import { useEffect, useRef, useState } from 'react'
import type { MessageWindow } from './useMessageWindow'

const SPINNER_GRACE = 250 // ms before the spinner is allowed to appear
const SPINNER_MIN = 1000 // ms minimum on screen once it has appeared

export function useFeedReveal({ isRealChat, win, numericChatId }: { isRealChat: boolean; win: MessageWindow; numericChatId: number }): {
  showSpinner: boolean
  feedLoading: boolean
  ladderActive: boolean
} {
  // The first loaded batch cascades in — but ONLY when the chat came over the
  // network. `armed` stays true from chat-switch until the first revealed batch has
  // mounted, then the effect below disarms it so live appends don't ladder.
  const ladderArmedRef = useRef(true)
  const ladderChatRef = useRef(numericChatId)
  if (ladderChatRef.current !== numericChatId) {
    ladderChatRef.current = numericChatId
    ladderArmedRef.current = true
  }

  // Loader policy: don't show the spinner for a cached/instant open. Only reveal
  // it if the load is still going after a short grace period; once shown, keep
  // it for a minimum so it can't flash. Cache hit ⇒ resolves < grace ⇒ no spinner.
  const [showSpinner, setShowSpinner] = useState(false)
  const showSpinnerRef = useRef(false)
  const spinnerShownAt = useRef(0)
  const setSpinner = (v: boolean) => { showSpinnerRef.current = v; setShowSpinner(v) }
  useEffect(() => {
    let t: number | undefined
    if (isRealChat && win.loading) {
      t = window.setTimeout(() => { spinnerShownAt.current = Date.now(); setSpinner(true) }, SPINNER_GRACE)
    } else if (showSpinnerRef.current) {
      const remain = Math.max(0, SPINNER_MIN - (Date.now() - spinnerShownAt.current))
      t = window.setTimeout(() => setSpinner(false), remain)
    } else {
      setSpinner(false)
    }
    return () => { if (t) window.clearTimeout(t) }
  }, [isRealChat, win.loading])
  // Hide the feed (and show the spinner) only while actually loading or while the
  // spinner is on screen; a cache hit skips both → content appears instantly.
  const feedLoading = isRealChat && (win.loading || showSpinner)

  // Ladder fires when the content is revealed (!feedLoading) for the FIRST time
  // after a NETWORK load. A cache hit (win.loadedFromCache) reveals instantly with
  // NO cascade, matching tweb's `noTransition = setPeerCached`. The list is gated on
  // !feedLoading so rows mount exactly at reveal — the cascade is seen, not played
  // hidden behind the spinner.
  const ladderActive =
    isRealChat && !feedLoading && win.msgs.length > 0 && ladderArmedRef.current && !win.loadedFromCache

  // Disarm the open-chat ladder once the first loaded batch has committed (it
  // already mounted with the cascade); subsequent appends then insert plainly.
  useEffect(() => {
    if (ladderActive) ladderArmedRef.current = false
  }, [ladderActive])

  return { showSpinner, feedLoading, ladderActive }
}
