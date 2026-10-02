// Порт tweb `src/components/generatePremiumIcon.ts` 1:1: звезда Premium у имени.
import Icon from '@components/icon'

export default function generatePremiumIcon() {
  const span = Icon('star', 'premium-icon')
  return span
}
