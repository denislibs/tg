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

  // Кто уже отмечен, видно ПО КАРТОЧКАМ контактов: `pFlags.close_friend` —
  // признак зрителя, и едет он вместе с адресной книгой. Отдельной ручки
  // «список близких» больше нет — её нет и у оригинала.
  useEffect(() => {
    let alive = true
    managers.contacts
      .list()
      .then((cs) => {
        if (alive) setSelected(new Set(cs.filter((c) => c.user.pFlags?.close_friend).map((c) => c.userId)))
      })
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
      rootScope.dispatchEvent('ui:toast', t('CloseFriends.Updated'))
      onClose()
    } catch {
      rootScope.dispatchEvent('ui:toast', t('Error.SomethingWentWrong'))
    } finally {
      setBusy(false)
    }
  }

  return { selected, loaded, busy, toggle, save }
}
