/**
 * Порт tweb `src/components/buttonCorner.ts` (812502980) — круглая плавающая
 * кнопка в углу вкладки (`btn-circle btn-corner z-depth-1`). Первый потребитель —
 * «Далее» вкладки выбора участников (`sidebarLeft/tabs/addMembers.solid.tsx`).
 */
import Button from '@components/button'
import type { IconName } from '@core/tgico-icons'
import type { LangPackKey } from '@lib/langPack'

const ButtonCorner = (options: Partial<{ className: string, icon: IconName, noRipple: true, onlyMobile: true, asDiv: boolean, ariaLabel: LangPackKey }> = {}) => {
  return Button('btn-circle btn-corner z-depth-1' + (options.className ? ' ' + options.className : ''), options)
}

export default ButtonCorner
