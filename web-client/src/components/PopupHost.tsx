// PopupHost — единственная точка рендера стека попапов (popupStore). Монтируется
// один раз в App. Каждому попапу даёт PopupApi для управления закрытием/анимацией.
import { Fragment } from 'react'
import { usePopupStore, type PopupApi } from '../stores/popupStore'

export default function PopupHost() {
  const popups = usePopupStore((s) => s.popups)
  const setClosing = usePopupStore((s) => s.setClosing)
  const remove = usePopupStore((s) => s.remove)
  return (
    <>
      {popups.map((entry) => {
        const api: PopupApi = {
          open: !entry.closing,
          requestClose: () => setClosing(entry.id),
          onExitComplete: () => remove(entry.id),
          destroy: () => remove(entry.id),
        }
        return <Fragment key={entry.id}>{entry.render(api)}</Fragment>
      })}
    </>
  )
}
