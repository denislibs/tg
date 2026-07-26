// Раскладка колонок Shell. Широкий экран: сайдбар + чат инлайном. Узкий (<900px,
// tweb handheld): колонки перекрываются на весь экран классическим синхронным
// слайдом (список 0→-100%, чат 100%→0 и обратно по «назад»); обои чата остаются
// статичным фоном под ними.
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import s from '../../App.module.scss'

export default function ShellLayout({
  narrow,
  selectedId,
  renderSidebar,
  chatArea,
}: {
  narrow: boolean
  selectedId: string | null
  renderSidebar: (fullWidth?: boolean) => ReactNode
  chatArea: ReactNode
}) {
  if (!narrow) {
    return (
      <>
        {renderSidebar()}
        {chatArea}
      </>
    )
  }
  return (
    <>
      <AnimatePresence initial={false}>
        {selectedId && (
          <motion.div
            key="chat"
            className={s.mobileColumn}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
          >
            {chatArea}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {!selectedId && (
          <motion.div
            key="list"
            className={s.mobileColumn}
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
          >
            {renderSidebar(true)}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
