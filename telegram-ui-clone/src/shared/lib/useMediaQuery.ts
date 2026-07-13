import { useEffect, useState } from 'react'

// Мини-хук media query (замена MUI useMediaQuery) на window.matchMedia.
export default function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatch(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return match
}
