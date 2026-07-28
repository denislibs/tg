// Подписчик звука/эффектов на realtime-события. Независим от Store-проектора:
// подписывается на eventBus и сам читает нужное состояние. Добавить/убрать звук —
// не трогая мост.
import { eventBus } from '../../core/realtime/eventBus'
import { RT } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import { useSettingsStore } from '../../settings'
import { mapEffect } from '../../core/models'
import { playMessageSent } from '../../core/audio/sounds'
import { playEmojiEffect } from '../../core/effects/emojiEffects'

export function registerSoundSubscriber(): void {
  // Сервер подтвердил нашу отправку → «пак» (tweb message_sent), если не выключен
  // в настройках (Sound Effects → Message Sent).
  eventBus.subscribe(RT.ack, () => {
    if (useSettingsStore.getState().sentMessageSound) playMessageSent()
  })
  // Эффект сообщения (наш аналог Telegram message effects): чужое сообщение с
  // эффектом, пришедшее в ОТКРЫТЫЙ чат, проигрываем один раз (своё уже сыграли на
  // отправке; для закрытого чата — только click-replay в истории).
  eventBus.subscribe(RT.newMessage, (evt) => {
    if (evt.backfill) return // catch-up после reconnect — эффект уже играли вживую
    const effect = mapEffect(evt.effect)
    if (!effect) return
    const cs = useChatsStore.getState()
    if (evt.sender_id !== cs.meId && cs.activeChatId === evt.chat_id) playEmojiEffect(effect)
  })
}
