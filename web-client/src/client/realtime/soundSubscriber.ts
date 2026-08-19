// Подписчик звука/эффектов на realtime-события. Независим от Store-проектора:
// подписывается на rootScope и сам читает нужное состояние. Добавить/убрать звук —
// не трогая мост.
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import { useSettingsStore } from '../../settings'
import { mapEffect } from '../../core/models'
import { playMessageSent } from '../../core/audio/sounds'
import { playEmojiEffect } from '../../core/effects/emojiEffects'

export function registerSoundSubscriber(): void {
  // Сервер подтвердил нашу отправку → «пак» (tweb message_sent), если не выключен
  // в настройках (Sound Effects → Message Sent).
  rootScope.addEventListener(RT.ack, () => {
    if (useSettingsStore.getState().sentMessageSound) playMessageSent()
  })
  // Эффект сообщения (наш аналог Telegram message effects): чужое сообщение с
  // эффектом, пришедшее в ОТКРЫТЫЙ чат, проигрываем один раз (своё уже сыграли на
  // отправке; для закрытого чата — только click-replay в истории).
  rootScope.addEventListener(RT.newMessage, (evt, meta) => {
    // Кадр из catch-up (reconnect/backfill) — уже «прошлое»: звук и нотификация не
    // играют. Раньше это держалось только на дедупе funnel'а по pts.
    if (meta?.catchUp) return
    const effect = mapEffect(evt.effect)
    if (!effect) return
    const cs = useChatsStore.getState()
    if (evt.sender_id !== cs.meId && cs.activePeerId === evt.peer_id) playEmojiEffect(effect)
  })
}
