import { useEffect, useState } from 'react'
import { startClient } from '../client/bootstrap'

// Resolves a stored avatar URL into something an <img> can load. Avatars are
// stored as a "/media/{id}/content" path; the actual bytes are served by an
// authenticated endpoint, so we resolve the path to a token-carrying URL via the
// media manager. An already-absolute URL (or empty) is returned unchanged.
export function useAvatarSrc(avatarUrl?: string): string {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!avatarUrl) {
      setSrc('')
      return
    }
    const m = avatarUrl.match(/\/media\/(\d+)\/content/)
    if (!m) {
      setSrc(avatarUrl) // already absolute (e.g. external URL)
      return
    }
    let alive = true
    const { managers } = startClient()
    void Promise.resolve(managers.media.contentUrl(Number(m[1]))).then((u) => {
      if (alive) setSrc(u)
    })
    return () => {
      alive = false
    }
  }, [avatarUrl])
  return src
}
