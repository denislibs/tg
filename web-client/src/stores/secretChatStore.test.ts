import { describe, it, expect, beforeEach } from 'vitest'
import { useSecretChatStore } from './secretChatStore'

describe('secretChatStore', () => {
  beforeEach(() => useSecretChatStore.setState({ byChat: {} }))
  it('setStatus хранит стадию handshake по chatId', () => {
    useSecretChatStore.getState().setStatus(7, 'requested')
    expect(useSecretChatStore.getState().byChat[7]?.status).toBe('requested')
    useSecretChatStore.getState().setStatus(7, 'established')
    expect(useSecretChatStore.getState().byChat[7]?.status).toBe('established')
  })
  it('setFingerprint сохраняет emoji-цепочку и не теряет статус', () => {
    useSecretChatStore.getState().setStatus(7, 'established')
    useSecretChatStore.getState().setFingerprint(7, ['🔒', '🔑'])
    expect(useSecretChatStore.getState().byChat[7]?.fingerprint).toEqual(['🔒', '🔑'])
    expect(useSecretChatStore.getState().byChat[7]?.status).toBe('established')
  })
})
