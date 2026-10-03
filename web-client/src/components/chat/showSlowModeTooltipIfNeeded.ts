// Порт статического `ChatInput.showSlowModeTooltipIfNeeded` tweb (`components/chat/input.ts:4005-4069`,
// 812502980) — подсказка «Включён медленный режим» над кнопкой отправки (или над тем, что
// отправляет: стикер, скрепка). Отдельным модулем: `chat/input.ts` делает из него
// статический метод `ChatInput` (врезка — Б-37), а читатели вне ввода (попап медиа,
// запись голоса, `appImManager`) зовут его так же, как у tweb.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Карточка чата — синхронно из зеркала пиров (`cachedChat`, `core/peerCache.ts`), а не
//     `managers.appChatsManager.getChat`; полная — из зеркала полных карточек
//     (`cachedPeerFull`, `core/chatFullCache.ts`), а не `appProfileManager.getChatFull` с
//     походом в сеть: единственное читаемое поле `slowmode_next_send_date` бэкенд не
//     производит (`backend/internal/domain/mtchat.go`), поэтому ветка таймера по форме
//     tweb, но без предмета — `getLeftDuration()` всегда 0, и подсказка с остатком
//     («You can send your next message in …») не показывается. Ограничение «раз в N секунд»
//     держит бэкенд (`domain.ErrSlowmode` → NACK).
//  2. Без карточки чата — «режима нет» (`chat?.pFlags?.slowmode_enabled`): у tweb
//     `getChat` отдаёт карточку всегда.
//  3. `emoticonsDropdown` — параметр без умолчания: глобального эмодзи-дропдауна tweb
//     (`emoticonsDropdown` из `emoticonsDropdown/index.ts`) у нас ещё нет (Б-35), поэтому
//     `_emoticonsDropdown ??= emoticonsDropdown` не перенесено, а вызовы
//     `setIgnoreMouseOut` — через `?.`.
import type { Managers } from '@/client/bootstrap'
import { i18n } from '@lib/langPack'
import tsNow from '@helpers/tsNow'
import type DropdownHover from '@helpers/dropdownHover'
import { isUser } from '@core/peers/peerId'
import { cachedChat } from '@core/peerCache'
import { cachedPeerFull } from '@core/chatFullCache'
import type { Channel, ChannelFull } from '@core/peers/peer'
import showTooltip from '@components/tooltip.solid'
import { slowModeTimer } from '@components/chat/utils'

export type ShowSlowModeTooltipOptions = {
  peerId: PeerId,
  managers: Managers,
  element: HTMLElement,
  container?: HTMLElement,
  sendingFew?: boolean,
  textOverflow?: boolean,
  emoticonsDropdown?: Pick<DropdownHover, 'setIgnoreMouseOut'>,
}

/** tweb `input.ts:4005-4069` — `true`, если отправку надо остановить (подсказка показана). */
export default async function showSlowModeTooltipIfNeeded({
  peerId,
  managers,
  element,
  container,
  sendingFew,
  textOverflow,
  emoticonsDropdown: _emoticonsDropdown,
}: ShowSlowModeTooltipOptions) {
  if(isUser(peerId)) {
    return false
  }

  // расхождения 1-2 шапки
  const chat = cachedChat(peerId) as Channel | undefined

  if(!chat?.pFlags?.slowmode_enabled) {
    return false
  }

  let textElement: HTMLElement, onClose: (() => void) | undefined
  if(textOverflow) {
    textElement = i18n('SlowmodeSendErrorTooLong')
  } else if(sendingFew) {
    textElement = i18n('SlowmodeSendError')
  } else if(await managers.messages.hasOutgoingMessage(peerId)) {
    textElement = i18n('SlowmodeSendError')
  } else {
    // расхождение 1 шапки
    const chatFull = cachedPeerFull(peerId) as ChannelFull | undefined

    const getLeftDuration = () => Math.max(0, (chatFull?.slowmode_next_send_date || 0) - tsNow(true))
    if(!getLeftDuration()) {
      return false
    }

    const { element: timerElement, dispose } = slowModeTimer(getLeftDuration)
    onClose = dispose
    textElement = i18n('SlowModeHint', [timerElement])
  }

  showTooltip({
    element,
    vertical: 'top',
    container: container || element.parentElement!,
    textElement,
    onClose: () => {
      onClose?.()
      _emoticonsDropdown?.setIgnoreMouseOut('tooltip', false)
    },
    auto: true,
  })

  _emoticonsDropdown?.setIgnoreMouseOut('tooltip', true)

  return true
}
