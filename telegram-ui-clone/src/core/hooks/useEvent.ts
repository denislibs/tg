import { useCallback, useLayoutEffect, useRef } from 'react'

// useEvent: returns a callback with a STABLE identity that always invokes the
// latest version of `fn` (the React "useEvent"/"useEventCallback" pattern). Use
// it for event handlers passed into memoized children/closures so toggling
// transient state doesn't bust their memoization, while the handler still reads
// fresh state/props. Do NOT call the returned function during render — it's for
// event handlers only (the ref is synced in a layout effect).
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}
