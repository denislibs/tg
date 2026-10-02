/** @jsxImportSource solid-js */
// Порт tweb `src/components/sidebarLeft/notificationsSuggestion.tsx` (812502980,
// 1-55) — вид «включите уведомления» плашки-подсказки (`pendingSuggestion.solid.tsx`).
// Единственный вид с чисто клиентским источником данных: доступен, пока есть
// Web Notifications API, пользователь не отмахнулся (`notifications.suggested`)
// и разрешение не выдано.
//
// Расхождение с оригиналом одно: `uiNotificationsManager.onPushConditionsChange`
// → `client/pushSetup.ts::onPushConditionsChange` (класса-менеджера у нас нет;
// так же зовёт вкладка «Уведомления», `tabs/notifications.solid.tsx`).
import type { PendingSuggestionController } from '@components/sidebarLeft/pendingSuggestionController'
import { SimpleSuggestion } from '@components/sidebarLeft/pendingSuggestionItem.solid'
import { toastNew } from '@components/toast'
import { i18n } from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import { onPushConditionsChange } from '@/client/pushSetup'
import { useAppSettings } from '@stores/appSettings.solid'
import IS_NOTIFICATION_SUPPORTED from '@environment/notificationSupport'

function NotificationsSuggestion() {
  const [, setAppSettings] = useAppSettings()
  const emoji = () => wrapEmojiText('🔔')

  const onDismissed = () => {
    void setAppSettings('notifications', 'suggested', true)
    toastNew({ langPackKey: 'Suggestion.Notifications.Dismissed' })
  }

  const onClick = () => {
    if(!IS_NOTIFICATION_SUPPORTED) {
      onDismissed()
      return
    }

    Notification.requestPermission().then((permission) => {
      if(permission === 'granted') {
        void setAppSettings('notifications', 'suggested', true)
        void onPushConditionsChange()
      } else if(permission === 'denied') {
        throw 1
      }
    }).catch(onDismissed)
  }

  return (
    <SimpleSuggestion
      emoji={emoji}
      title={i18n('Suggestion.Notifications', [emoji()])}
      subtitle={i18n('Suggestion.Notifications.Subtitle')}
      onClick={onClick}
      onClose={onDismissed}
    />
  )
}

export default function createNotificationsSuggestion(): PendingSuggestionController {
  const [appSettings] = useAppSettings()

  return {
    available: () => IS_NOTIFICATION_SUPPORTED &&
      !appSettings.notifications.suggested &&
      Notification.permission !== 'granted',
    component: NotificationsSuggestion,
  }
}
