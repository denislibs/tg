// tweb's bubbles-scrollable fade: a pure alpha mask on the scroll viewport (no
// blur, no colour) so messages fade out to a 0.24 floor behind the floating
// header/composer, eased iOS-style (cubic-bezier sampled at 0/.2/.4/.6/.8/1).
export const FADE_TOP = 76 // clear the floating header
export const FADE_BOTTOM = 84 // clear the floating composer

const FLOOR = 'rgba(255,255,255,0.24)'
const mix = (k: number) => `color-mix(in srgb, #000 ${k}%, ${FLOOR})`

export const FEED_MASK = `linear-gradient(to bottom, ${FLOOR} 0, ${mix(8.6)} ${FADE_TOP * 0.2}px, ${mix(33.4)} ${FADE_TOP * 0.4}px, ${mix(66.6)} ${FADE_TOP * 0.6}px, ${mix(91.4)} ${FADE_TOP * 0.8}px, #000 ${FADE_TOP}px, #000 calc(100% - ${FADE_BOTTOM}px), ${mix(91.4)} calc(100% - ${FADE_BOTTOM * 0.8}px), ${mix(66.6)} calc(100% - ${FADE_BOTTOM * 0.6}px), ${mix(33.4)} calc(100% - ${FADE_BOTTOM * 0.4}px), ${mix(8.6)} calc(100% - ${FADE_BOTTOM * 0.2}px), ${FLOOR} 100%)`
