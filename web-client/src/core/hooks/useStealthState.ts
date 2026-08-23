import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { HttpError } from '../net/restClient'

// Текущее окно Stealth Mode: cooldownUntil (идёт ли кулдаун активации) +
// unavailable (503 — stealth недоступен, напр. нет Redis). Читается при открытии;
// setUnavailable отдаётся наружу — 503 может прийти и на попытке активации.
//
// Граница окна — СЕКУНДЫ эпохи (`storiesStealthMode.cooldown_until_date`), те же
// единицы, что у сообщения; «кулдауна нет» это отсутствие параметра, а не `null`
// под тем же ключом.
export function useStealthState(): {
  unavailable: boolean
  cooldownUntil: number | null
  setUnavailable: (v: boolean) => void
} {
  const managers = useManagers()
  const [unavailable, setUnavailable] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    managers.stories
      .stealthState()
      .then((st) => { if (alive) setCooldownUntil(st.cooldown_until_date ?? null) })
      .catch((e) => { if (alive && e instanceof HttpError && e.status === 503) setUnavailable(true) })
    return () => { alive = false }
  }, [managers])
  return { unavailable, cooldownUntil, setUnavailable }
}
