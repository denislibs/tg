// Порт tweb `helpers/overlayCounter.ts` — 1:1.
//
// Счётчик открытых оверлеев приложения. Контекстному меню нужна только вторая
// половина — `isDarkOverlayActive`: меню, открытое поверх тёмного оверлея
// (медиавьювер, сториз), рисуется в ночной теме (`contextMenuController`
// вешает класс `night`, tweb contextMenuController.ts:127-131).
//
// Событие `change` (в tweb на него подписан `animationIntersector` — пауза
// стикеров/гифок под попапом) портировано вместе с классом: это его форма, а
// не отдельная фича; первым потребителем станет порт `PopupElement`.
import { MOUNT_CLASS_TO } from '@config/debug'
import EventListenerBase from '@helpers/eventListenerBase'

export class OverlayCounter extends EventListenerBase<{
  change: (isActive: boolean) => void
}> {
  public overlaysActive = 0
  public hasDarkOverlays = 0

  get isOverlayActive() {
    return this.overlaysActive > 0
  }

  set isOverlayActive(value: boolean) {
    this.overlaysActive += value ? 1 : -1
    this.dispatchEvent('change', this.isOverlayActive)
  }

  get isDarkOverlayActive() {
    return this.hasDarkOverlays > 0
  }

  set isDarkOverlayActive(value: boolean) {
    this.hasDarkOverlays += value ? 1 : -1
    this.isOverlayActive = value
  }
}

const overlayCounter = new OverlayCounter()
MOUNT_CLASS_TO.overlayCounter = overlayCounter
export default overlayCounter
