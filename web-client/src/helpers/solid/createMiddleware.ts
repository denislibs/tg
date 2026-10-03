// Порт tweb `src/helpers/solid/createMiddleware.ts` (812502980) 1:1 — middleware,
// который гаснет вместе с владельцем Solid (`onCleanup`).
import { getMiddleware } from '@helpers/middleware'
import { onCleanup } from 'solid-js'

export default function createMiddleware() {
  const middleware = getMiddleware()
  onCleanup(() => middleware.destroy())
  return middleware
}
