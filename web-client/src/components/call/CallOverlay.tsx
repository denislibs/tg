// Глобальный слой звонка: монтируется в App, чтобы входящий звонок показывался
// из любого места приложения (а не только из открытого чата).
import CallScreen from '../CallScreen'
import { useCallStore } from '../../stores/callStore'

// Появление/уход — на CSS самого CallScreen (кейфрейм на вставке узла, как у
// tweb `_transition.scss`), поэтому обёртка-презенс тут не нужна.
export default function CallOverlay() {
  const call = useCallStore((s) => s.call)
  return call ? <CallScreen /> : null
}
