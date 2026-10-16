// Подзаголовок строки чатлиста (порт tweb `dialogSubtitle.ts`): превью
// служебного сообщения — фраза узлами с живыми именами (P0 2026-10-16, Н2).
// Пин на ПРОВОДКУ: `renderDialogSubtitleParts` отдаёт `wrapMessageForReply`
// менеджеры и middleware узла имени — без них фраза склеивалась строкой из
// зеркала, и у владельца после перезагрузки читалась «Удалённый аккаунт …».
import { describe, expect, it, vi } from 'vitest'
import { makeServiceMessage } from '@core/messages/testMessage'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { getMiddleware } from '@helpers/middleware'
import middlewarePromise from '@helpers/middlewarePromise'
import renderDialogSubtitleParts from './dialogSubtitle'

describe('renderDialogSubtitleParts — служебное', () => {
  it('имя автора фразы — узел имени: пробел объявлен, карточка доехала — имя на месте', async () => {
    resetPeerMirror()
    const fillMirror = vi.fn(async () => {})
    const helper = getMiddleware()
    const parts = await renderDialogSubtitleParts({
      peerId: -9,
      isSaved: false,
      lastMessage: makeServiceMessage({ id: 1, peerId: -9, fromId: 42, action: { _: 'messageActionChatEditTitle', title: 'Новое' } }),
      middleware: middlewarePromise(helper.get()),
      titleMiddleware: helper.get(),
      managers: { peers: { fillMirror } },
    })
    const host = document.createElement('div')
    host.append(...parts)

    expect(host.querySelector('.peer-title')).not.toBeNull()
    expect(fillMirror).toHaveBeenCalledWith([42])
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: 42, first_name: 'Егор', pFlags: {} }] }])
    expect(host.textContent).toBe('Егор изменил(а) название группы на «Новое»')
  })
})
