// Порт tweb `helpers/liteMode.ts` (812502980, 1-43): союз ключей, `isEnabled`,
// `isAvailable` — формула оригинала (`:16-35`): режим включён = `liteMode.all`,
// анимация ключа доступна = `!all && !liteMode[key]`. Галочки пишет вкладка
// «Энергосбережение» (`sidebarLeft/tabs/powerSaving.solid.tsx`) и пункт меню
// «Ещё» (`liteMode.animations`).
//
// Расхождения с оригиналом:
//  1. Источник — zustand `useSettingsStore` (`settings.tsx`, объект `liteMode`
//     формы tweb), а не Solid-стор `useAppSettings()`: у нас факт настроек живёт
//     там (О-2 плана 2D), и ~30 вызывающих из React-, ванильного и Solid-кода
//     читают его синхронно `getState()`.
//  2. `isReducedMotion` (системное `prefers-reduced-motion`, `:11-13`, `:21-28`)
//     не портирован: у нас гейт анимаций по ОС не заводился, это отдельный
//     предмет (не настройка «Энергосбережения»).
import { MOUNT_CLASS_TO } from '@config/debug'
import { useSettingsStore } from '@/settings'

/** tweb helpers/liteMode.ts:4-8 — союз ключей взят 1:1 */
export type LiteModeKey = 'all' | 'gif' | 'video' |
  'emoji' | 'emoji_panel' | 'emoji_messages' | 'emoji_appear' |
  'effects' | 'effects_reactions' | 'effects_premiumstickers' | 'effects_emoji' |
  'stickers' | 'stickers_panel' | 'stickers_chat' |
  'chat' | 'chat_background' | 'chat_spoilers' | 'animations' | 'blur'

export class LiteMode {
  /** tweb `:15-18` — включён ли режим энергосбережения целиком */
  public isEnabled(): boolean {
    return !!useSettingsStore.getState().liteMode.all
  }

  /** tweb `:24-35` — можно ли играть анимацию этого класса */
  public isAvailable(key: LiteModeKey): boolean {
    const { liteMode } = useSettingsStore.getState()
    return !!(liteMode && !liteMode.all && !liteMode[key])
  }
}

const liteMode = new LiteMode()
if(MOUNT_CLASS_TO) MOUNT_CLASS_TO.liteMode = liteMode
export default liteMode
