/**
 * Порт tweb `src/components/buttonCorner.ts` (812502980) — круглая плавающая
 * кнопка в углу вкладки (`btn-circle btn-corner z-depth-1`). Первый потребитель —
 * «Далее» вкладки выбора участников (`sidebarLeft/tabs/addMembers.solid.tsx`).
 *
 * Расхождение: опции `ariaLabel` нет — её нет у нашего `Button`
 * (`components/button.ts`, a11y-правка tweb 472e3e76b туда не портирована).
 */
import Button from '@components/button'
import type { IconName } from '@core/tgico-icons'

const ButtonCorner = (options: Partial<{ className: string, icon: IconName, noRipple: true, onlyMobile: true, asDiv: boolean }> = {}) => {
  return Button('btn-circle btn-corner z-depth-1' + (options.className ? ' ' + options.className : ''), options)
}

export default ButtonCorner
