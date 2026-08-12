import { useMediaUrl } from '../core/hooks/useMediaUrl'

// Resolves a stored avatar URL into something an <img> can load. Avatars are
// stored as a "/media/{id}/content" path; the bytes are served by an
// authenticated endpoint, so the path is resolved through the worker download
// pipeline (Task 7: useMediaUrl → downloadMediaURL, ключ media_<id>) — зеркало
// отдаёт URL синхронно на каждом следующем маунте той же аватарки (их у одного
// пира по всему приложению много). An already-absolute URL (or empty) is
// returned unchanged.
export function useAvatarSrc(avatarUrl?: string): string {
  const m = avatarUrl?.match(/\/media\/(\d+)\/content/)
  const id = m ? Number(m[1]) : null
  const url = useMediaUrl(id)
  if (!avatarUrl) return ''
  return id != null ? url : avatarUrl // already absolute (e.g. external URL)
}
