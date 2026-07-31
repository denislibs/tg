import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { watchLivestream, leaveLivestream } from '../calls/livestreamEngine'

// RTMP-креды трансляции канала (tweb Stream Settings): забираем при открытии
// (бэк генерирует ключ при первом обращении админа), даём перевыпуск ключа и
// старт/стоп трансляции. Read/command-путь через managers.
export function useLivestreamSettings(chatId: number, active: boolean, onClose: () => void): {
  url: string
  key: string
  busy: boolean
  revoke: () => void
  onAction: () => void
} {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void managers.livestream.status(chatId).then((st) => {
      if (!alive) return
      setUrl(st.rtmpUrl ?? '')
      setKey(st.streamKey ?? '')
    }).catch(() => {})
    return () => { alive = false }
  }, [managers, chatId])

  const revoke = () => {
    if (busy) return
    setBusy(true)
    void managers.livestream.revokeKey(chatId)
      .then((st) => { setUrl(st.rtmpUrl ?? ''); setKey(st.streamKey ?? '') })
      .finally(() => setBusy(false))
  }

  const onAction = () => {
    if (busy) return
    setBusy(true)
    if (active) {
      void managers.livestream.stop(chatId).then(() => {
        leaveLivestream()
        onClose()
      }).finally(() => setBusy(false))
    } else {
      void managers.livestream.start(chatId).then(() => {
        watchLivestream(chatId)
        onClose()
      }).finally(() => setBusy(false))
    }
  }

  return { url, key, busy, revoke, onAction }
}
