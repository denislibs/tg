// Порт tweb `src/components/sendingStatus.ts:25-62` (812502980) — значок отправки
// в `span.message-status.sending-status` строки чатлиста (`setUnreadMessages`,
// `lib/appDialogsManager.ts`). Значок времени бабла — другая функция
// (`components/chat/messageTime.ts::setSendingStatus`, порт
// `setBubbleSendingStatus`): у tweb это тоже разные места.
//
// Расхождения с оригиналом:
//  1. На вход — только имя значка (`C`), ветки «по сообщению» (`:30-40`) нет: она
//     читает `pFlags.is_outgoing`/`pFlags.unread`/`error`, а у нашего сообщения
//     этих клиентских флагов нет (`core/models.ts::MessagePFlags`). Значок
//     выбирает вызывающий — по горизонту `read_outbox_max_id` диалога, ровно из
//     которого оригинал и выводит `pFlags.unread` исходящего.
//  2. Проверка «значок уже тот» (`:47-50`, `lastElement.classList.contains(_tgico(className))`)
//     не перенесена: `Icon` оригинала класс `tgico-<имя>` не ставит (`icon.ts:28-39`),
//     условие у него всегда ложно и значок пересоздаётся на каждом вызове — так и здесь.
//  3. `getSendingStatus`/`SENDING_STATUS` (`:8-23`) и закомментированная анимация
//     смены (`:64-82`) не портированы: вызывающих нет.
//  4. `disableAnimationIfRippleFound` (`:28`) у оригинала читает только
//     закомментированный код — параметр не заводится.
import Icon from '@components/icon'

export type SendingStatusIcon = 'check' | 'checks' | 'sending' | 'sendingerror_filled' | 'premium_lock'

/** tweb `:25-62` */
export function setSendingStatus(container: HTMLElement, className?: SendingStatusIcon) {
  if(!className) {
    container.textContent = ''
    container.classList.add('hide')
    return
  }

  const lastElement = container.lastElementChild as HTMLElement | null

  const statusClassName = className === 'sendingerror_filled' ? 'sendingerror' : className
  const element = Icon(className, 'sending-status-icon', 'sending-status-icon-' + statusClassName)
  container.append(element)
  container.classList.remove('hide')

  lastElement?.remove()
}
