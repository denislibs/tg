// src/core/hooks/useLightbox.ts
//
// Full-screen media viewer state: opening a thumbnail collects every photo/video
// currently loaded in the chat (so the viewer can page through them), records the
// clicked element's rect as the zoom origin, and hides the source thumbnail while
// open so only the growing clone is visible (tweb behaviour).
import { useState } from 'react'
import { friendlyMsgTime } from '../friendlyTime'
import type { Peer } from '../managers/peersManager'
import type { MessageWindow } from './useMessageWindow'
import type { LightboxItem } from '../../components/messages/MediaLightbox'

interface Lightbox {
  items: LightboxItem[]
  index: number
  originRect: { top: number; left: number; width: number; height: number }
  originSrc?: string
  originEl: HTMLElement
}

interface UseLightboxArgs {
  win: MessageWindow
  isRealChat: boolean
  meId: number | null
  meName?: string
  peers: Map<number, Peer>
  chatName: string
  lang: string
}

export function useLightbox({ win, isRealChat, meId, meName, peers, chatName, lang }: UseLightboxArgs): {
  lightbox: Lightbox | null
  openLightbox: (mediaId: number, el: HTMLElement) => void
  closeLightbox: () => void
} {
  const [lightbox, setLightbox] = useState<Lightbox | null>(null)

  const openLightbox = (mediaId: number, el: HTMLElement) => {
    if (!isRealChat) return
    let items: LightboxItem[] = win.msgs
      .filter((m) => m.mediaId != null && (m.type === 'photo' || m.type === 'video'))
      .map((m) => ({
        mediaId: m.mediaId as number,
        type: m.type,
        sender: m.senderId === meId ? (meName || 'Вы') : (peers.get(m.senderId)?.displayName || chatName),
        date: friendlyMsgTime(m.createdAt, lang),
        width: m.mediaWidth,
        height: m.mediaHeight,
      }))
    let index = items.findIndex((it) => it.mediaId === mediaId)
    if (index < 0) {
      // Медиа не в ленте фото/видео (сервисное сообщение смены фото группы —
      // type 'service'): открываем одиночный просмотр именно этого фото.
      const src = win.msgs.find((m) => m.mediaId === mediaId)
      items = [{
        mediaId,
        type: 'photo',
        sender: src && src.senderId === meId ? (meName || 'Вы') : (peers.get(src?.senderId ?? -1)?.displayName || chatName),
        date: friendlyMsgTime(src?.createdAt ?? '', lang),
        width: src?.mediaWidth,
        height: src?.mediaHeight,
      }]
      index = 0
    }
    const r = el.getBoundingClientRect()
    const img = el.querySelector('img')
    // Hide the source thumbnail while the viewer is open so only the growing
    // clone is visible (no "ghost" of the original behind it — tweb does this).
    el.style.visibility = 'hidden'
    setLightbox({ items, index, originRect: { top: r.top, left: r.left, width: r.width, height: r.height }, originSrc: img?.currentSrc || img?.src, originEl: el })
  }
  const closeLightbox = () => {
    if (lightbox) lightbox.originEl.style.visibility = ''
    setLightbox(null)
  }

  return { lightbox, openLightbox, closeLightbox }
}
