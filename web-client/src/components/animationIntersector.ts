// Минимальный тип-shim из tweb components/animationIntersector: островку lottie
// (этап 1) нужны только типы AnimationItemGroup / AnimationItemWrapper, которые
// реализует LottiePlayer. Реальный intersector (авто play/pause по вьюпорту)
// переносится на этапе 2 — тогда этот файл заменится полной версией из tweb.
export type AnimationItemGroup = '' | 'none' | 'chat' | 'lock' |
  'STICKERS-POPUP' | 'emoticons-dropdown' | 'STICKERS-SEARCH' | 'GIFS-SEARCH' |
  `CHAT-MENU-REACTIONS-${number}` | 'INLINE-HELPER' | 'GENERAL-SETTINGS' | 'STICKER-VIEWER' | 'EMOJI' |
  'EMOJI-STATUS' | `chat-${number}` | 'PREMIUM-PROMO' | 'NEW-MEDIA' | 'BLUFF-SPOILER';

export interface AnimationItemWrapper {
  remove: () => void;
  paused: boolean;
  pause: () => any;
  play: () => any;
  autoplay: boolean;
  _autoplay?: boolean;
  loop: boolean | number;
  _loop?: boolean | number;
  onPlaybackParamsMutated?: () => void;
}
