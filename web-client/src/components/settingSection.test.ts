import { describe, expect, it } from 'vitest'
import SettingSection from './settingSection'

describe('SettingSection', () => {
  it('кладёт имя и подпись в разметку секции', () => {
    const section = new SettingSection({ name: 'CurrentSession', caption: 'ClearOtherSessionsHelp' })
    expect(section.container.classList.contains('sidebar-left-section')).toBe(true)
    expect(section.container.querySelector('.sidebar-left-h2')).not.toBeNull()
    expect(section.caption).not.toBeUndefined()
  })

  it('generateContentElement добавляет ещё один блок содержимого', () => {
    const section = new SettingSection({ name: 'CurrentSession' })
    const extra = section.generateContentElement()
    expect(extra.parentElement).toBe(section.container)
    expect(section.container.querySelectorAll('.sidebar-left-section-content')).toHaveLength(2)
  })
})
