// Глобальный слой звонка: монтируется в App, чтобы входящий звонок показывался
// из любого места приложения (а не только из открытого чата).
import { AnimatePresence } from 'framer-motion'
import CallScreen from '../CallScreen'
import { useCallStore } from '../../stores/callStore'

export default function CallOverlay() {
  const call = useCallStore((s) => s.call)
  return <AnimatePresence>{call && <CallScreen />}</AnimatePresence>
}
