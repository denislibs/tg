// Регистрирует оверлей как слой навигации (Phase B): пока open — в стеке лежит
// слой + запись истории, и браузерный/аппаратный Back закрывает именно его
// (onClose). Программное закрытие (× / клик по скриму) снимает слой и «съедает»
// запись истории. onClose держим в ref, чтобы не пересоздавать слой на каждый
// рендер.
import { useEffect, useRef } from 'react'
import { pushLayer, removeLayer } from '../navigation/navigationStack'

export function useNavLayer(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const layer = pushLayer(() => onCloseRef.current())
    return () => removeLayer(layer)
  }, [open])
}
