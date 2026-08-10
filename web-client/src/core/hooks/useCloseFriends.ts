import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import rootScope from '@lib/rootScope'
import { useT } from '../../i18n'

// Редактор списка близких друзей (постинг-сторона): грузит текущий список,
// держит выбор и сохраняет его целиком (managers.stories.setCloseFriends).
// Read/command-путь; выбор — локальный Set id, тост о результате через rootScope.
export function useCloseFriends(onClose: () => void): {
  selected: Set<number>
  loaded: boolean
  busy: boolean
  toggle: (id: number) => void
  save: () => Promise<void>
} {
  const managers = useManagers()
  const t = useT()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    managers.stories
      .closeFriends()
      .then((ids) => { if (alive) setSelected(new Set(ids)) })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [managers])

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      await managers.stories.setCloseFriends([...selected])
      rootScope.dispatchEvent('ui:toast', t('Close friends list updated'))
      onClose()
    } catch {
      rootScope.dispatchEvent('ui:toast', t('Something went wrong'))
    } finally {
      setBusy(false)
    }
  }

  return { selected, loaded, busy, toggle, save }
}
