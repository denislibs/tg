// Порт tweb `src/environment/videoSupport.ts` (812502980) в объёме потребителя —
// `IS_MOV_SUPPORTED` (`videoMimeTypesSupport.ts`). `IS_WEBM_SUPPORTED`,
// `IS_H265_SUPPORTED`, `IS_AV1_SUPPORTED` приедут со своими потребителями.
import { IS_SAFARI, IS_APPLE_MOBILE } from '@environment/userAgent'

const video = document.createElement('video')
// mov is not supported in Chrome on macOS
const IS_MOV_SUPPORTED = !!video.canPlayType('video/quicktime') || IS_SAFARI || IS_APPLE_MOBILE

export {
  IS_MOV_SUPPORTED,
}
