// Порт tweb `src/helpers/wrapAsyncClickHandler.ts` (812502980) 1:1.
/**
 * Prevent spamming an async click handler
 */
export function wrapAsyncClickHandler<Args extends unknown[]>(handler: (...args: Args) => Promise<void>) {
  let isPending = false
  return async(...args: Args) => {
    if(isPending) return

    try {
      isPending = true
      await handler(...args)
    } finally {
      isPending = false
    }
  }
}
