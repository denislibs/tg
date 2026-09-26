// Порт tweb `src/environment/notificationSupport.ts` (72c50bfef) 1:1: Web
// Notifications API есть не везде (iOS Safari вне PWA, часть встроенных
// браузеров) — без него `Notification.requestPermission` бросает.
const IS_NOTIFICATION_SUPPORTED = typeof Notification !== 'undefined' &&
  typeof Notification.requestPermission === 'function'

export default IS_NOTIFICATION_SUPPORTED
