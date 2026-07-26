// Экран «Горячие клавиши»: smoke — рендерятся все 8 секций и ключевые строки.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import HotkeysSettings from './HotkeysSettings'

describe('HotkeysSettings', () => {
  afterEach(cleanup)

  it('рендерит все 8 секций', () => {
    render(<HotkeysSettings onBack={() => {}} />)
    for (const caption of [
      'Text Formatting', 'Messages', 'Chat', 'Navigation',
      'Media Viewer', 'Stories', 'Photo Editor', 'Other',
    ]) {
      expect(screen.getByText(caption)).toBeTruthy()
    }
  })

  it('показывает новые/ключевые действия', () => {
    render(<HotkeysSettings onBack={() => {}} />)
    for (const action of ['Link', 'Edit Last Message', 'Next Chat', 'Saved Messages', 'Undo', 'Redo', 'Lock the App']) {
      expect(screen.getByText(action)).toBeTruthy()
    }
  })
})
