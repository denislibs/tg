import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { PremiumSubscription } from '../managers/premiumManager'

// Активная подписка Premium (tweb settings manage-subscription): данные + отмена
// авто-продления. Read/command-путь через managers.
export function usePremiumSubscription(): {
  sub: PremiumSubscription | null
  loading: boolean
  cancelling: boolean
  cancel: () => Promise<void>
} {
  const managers = useManagers()
  const [sub, setSub] = useState<PremiumSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let alive = true
    void managers.premium.getSubscription().then((s) => {
      if (alive) {
        setSub(s)
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [managers])

  const cancel = async () => {
    if (cancelling) return
    setCancelling(true)
    try {
      setSub(await managers.premium.cancelSubscription())
    } finally {
      setCancelling(false)
    }
  }

  return { sub, loading, cancelling, cancel }
}
