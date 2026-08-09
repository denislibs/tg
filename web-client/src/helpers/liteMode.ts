// Порт tweb `helpers/liteMode.ts` (1:1 по форме API: `isEnabled` / `isAvailable`
// + союз ключей `LiteModeKey`).
//
// Отличие от tweb — только источник данных. Там за каждым ключом стоит своя
// галочка (`appSettings.liteMode[key]`, «Энергосбережение» с 12 переключателями);
// у нас настройка одна — `reduceMotion` («Без анимаций» в меню «Ещё»,
// settings.tsx:58), и она играет роль tweb-ключа `all`: включена — недоступно
// ВСЁ (`isAvailable(любой) === false`), как при `liteMode.all` в tweb
// (`liteMode.ts:18`: `!appSettings.liteMode.all && !appSettings.liteMode[key]`).
// Поэтому ключ здесь не различается — но сигнатура сохранена, чтобы код,
// портируемый из tweb, звался слово-в-слово и не переписывался, когда галочки
// разъедутся по типам.
import {MOUNT_CLASS_TO} from '@config/debug';
import {useSettingsStore} from '@/settings';

/** tweb helpers/liteMode.ts:4-8 — союз ключей взят 1:1 */
export type LiteModeKey = 'all' | 'gif' | 'video' |
  'emoji' | 'emoji_panel' | 'emoji_messages' | 'emoji_appear' |
  'effects' | 'effects_reactions' | 'effects_premiumstickers' | 'effects_emoji' |
  'stickers' | 'stickers_panel' | 'stickers_chat' |
  'chat' | 'chat_background' | 'chat_spoilers' | 'animations' | 'blur';

export class LiteMode {
  /** tweb `liteMode.isEnabled()` — включён ли режим энергосбережения целиком */
  public isEnabled(): boolean {
    return useSettingsStore.getState().reduceMotion;
  }

  /** tweb `liteMode.isAvailable(key)` — можно ли играть анимацию этого класса */
  public isAvailable(_key: LiteModeKey): boolean {
    return !useSettingsStore.getState().reduceMotion;
  }
}

const liteMode = new LiteMode();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.liteMode = liteMode);
export default liteMode;
