import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { HttpError } from '../net/restClient'

// Текущее окно Stealth Mode: cooldownUntil (идёт ли кулдаун активации) +
// unavailable (503 — stealth недоступен, напр. нет Redis). Читается при открытии;
// setUnavailable отдаётся наружу — 503 может прийти и на попытке активации.
export function useStealthState(): {
  unavailable: boolean
  cooldownUntil: string | null
  setUnavailable: (v: boolean) => void
} {
  const managers = useManagers()
  const [unavailable, setUnavailable] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    managers.stories
      .stealthState()
      .then((st) => { if (alive) setCooldownUntil(st.cooldownUntil) })
      .catch((e) => { if (alive && e instanceof HttpError && e.status === 503) setUnavailable(true) })
    return () => { alive = false }
  }, [managers])
  return { unavailable, cooldownUntil, setUnavailable }
}
