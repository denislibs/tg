// Порт tweb `src/components/sidebarLeft/notificationsSuggestion.tsx`.
// Единственный вариант плашки с чисто клиентским источником данных: показываем,
// пока пользователь не отмахнулся и разрешение на уведомления не выдано
// (tweb notificationsSuggestion.tsx:44).
import { setupPush } from '../../client/pushSetup'
import rootScope from '@lib/rootScope'
import { useT } from '../../i18n'
import { useSettingsStore } from '../../settings'
import type { PendingSuggestionController, PendingSuggestionProps } from './pendingSuggestionController'
import { SimpleSuggestion } from './pendingSuggestionItem'

const EMOJI = '🔔'

function NotificationsSuggestion({ collapsed }: PendingSuggestionProps) {
  const t = useT()
  const update = useSettingsStore((st) => st.update)
  const notifyPush = useSettingsStore((st) => st.notifyPush)

  // tweb: setAppSettings('notifications', 'suggested', true) + тост.
  const onDismissed = () => {
    update({ notifySuggested: true })
    rootScope.dispatchEvent('ui:toast', t('Suggestion.Notifications.Dismissed'))
  }

  // tweb: granted → запомнить и пересобрать push-подписку
  // (uiNotificationsManager.onPushConditionsChange); denied → throw → onDismissed.
  const onClick = () => {
    Notification.requestPermission()
      .then((permission) => {
        if (permission === 'granted') {
          update({ notifySuggested: true })
          if (notifyPush) void setupPush()
        } else if (permission === 'denied') {
          throw new Error('denied')
        }
      })
      .catch(onDismissed)
  }

  return (
    <SimpleSuggestion
      emoji={EMOJI}
      // `%s` в tweb-строке 'Suggestion.Notifications' (lang.ts:209) — это
      // wrapEmojiText('🔔'), то есть ОБЫЧНЫЙ нативный эмодзи. Проверено на живом
      // tweb (:8099), заголовок плашки там —
      //   <span class="i18n">Never miss a message! <span class="emoji emoji-native">🔔</span></span>
      // (font-size 16px, тот же, что у текста). Никакой анимированной иконки нет,
      // поэтому колокольчик остаётся; подстановки аргументов у нашего t() нет —
      // эмодзи уже вшит в ключ словаря.
      title={t('Suggestion.Notifications.Title')}
      subtitle={t('Suggestion.Notifications.Subtitle')}
      collapsed={collapsed}
      onClick={onClick}
      onClose={onDismissed}
    />
  )
}

export default function useNotificationsSuggestion(): PendingSuggestionController {
  const notifySuggested = useSettingsStore((st) => st.notifySuggested)

  return {
    available:
      !notifySuggested &&
      typeof Notification !== 'undefined' &&
      Notification.permission !== 'granted',
    component: NotificationsSuggestion,
  }
}
