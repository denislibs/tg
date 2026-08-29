import { describe, expect, it } from 'vitest'
import SettingSection from './settingSection'

describe('SettingSection', () => {
  it('кладёт имя и подпись в разметку секции (структура — два узла, как в tweb)', () => {
    const section = new SettingSection({ name: 'CurrentSession', caption: 'ClearOtherSessionsHelp' })

    // Внутренний узел — карточка с фоном/тенью, внешний — только обёртка с отступами.
    expect(section.innerContainer.classList.contains('sidebar-left-section')).toBe(true)
    expect(section.container.classList.contains('sidebar-left-section-container')).toBe(true)
    expect(section.container.contains(section.innerContainer)).toBe(true)

    // title — публичное поле, у него есть потребители в оригинале (userPermissions.tsx,
    // sharedFolderInvite.ts), которые вставляют/дописывают узлы рядом с заголовком.
    expect(section.title).not.toBeUndefined()
    expect(section.title!.classList.contains('sidebar-left-h2')).toBe(true)
    expect(section.innerContainer.contains(section.title!)).toBe(true)

    // Подпись без captionOld рисуется СНАРУЖИ карточки (прямой потомок внешнего container,
    // не внутреннего) — как в tweb: фон/тень/скругление на неё не распространяются.
    expect(section.caption).not.toBeUndefined()
    expect(section.caption!.parentElement).toBe(section.container)
    expect(section.innerContainer.contains(section.caption!)).toBe(false)
  })

  it('generateContentElement добавляет блок содержимого в innerContainer (не в container)', () => {
    const section = new SettingSection({ name: 'CurrentSession' })
    const extra = section.generateContentElement()
    expect(extra.parentElement).toBe(section.innerContainer)
    expect(section.innerContainer.querySelectorAll('.sidebar-left-section-content')).toHaveLength(2)
  })

  it('captionOld оставляет подпись внутри карточки (старое поведение)', () => {
    const section = new SettingSection({
      name: 'CurrentSession',
      caption: 'ClearOtherSessionsHelp',
      captionOld: true,
    })
    expect(section.caption!.parentElement).toBe(section.innerContainer)
  })

  it('caption === true создаёт узел подписи без переведённого текста', () => {
    const section = new SettingSection({ caption: true })
    expect(section.caption).not.toBeUndefined()
    expect(section.caption!.querySelector('.i18n')).toBeNull()
  })

  it('name как готовый HTMLElement вставляется в title как есть, без i18n-обёртки', () => {
    const custom = document.createElement('span')
    custom.textContent = 'Custom title'
    const section = new SettingSection({ name: custom })
    expect(section.title!.contains(custom)).toBe(true)
    expect(section.title!.querySelector('.i18n')).toBeNull()
  })

  it('noShadow навешивает класс, снимающий тень карточки', () => {
    const section = new SettingSection({ noShadow: true })
    expect(section.innerContainer.classList.contains('no-shadow')).toBe(true)
  })

  describe('ветка разделителя', () => {
    it('по умолчанию вставляет <hr> и не трогает классы делимитера', () => {
      const section = new SettingSection({})
      expect(section.innerContainer.querySelector('hr')).not.toBeNull()
      expect(section.innerContainer.classList.contains('no-delimiter')).toBe(false)
      expect(section.innerContainer.classList.contains('with-fake-delimiter')).toBe(false)
    })

    it('noDelimiter — без <hr>, с классом no-delimiter (реальный стиль: border-top в контексте boostsViaGifts)', () => {
      const section = new SettingSection({ noDelimiter: true })
      expect(section.innerContainer.querySelector('hr')).toBeNull()
      expect(section.innerContainer.classList.contains('no-delimiter')).toBe(true)
    })

    it('fakeGradientDelimiter — узел .gradient-delimiter вместо <hr>, класс with-fake-delimiter', () => {
      const section = new SettingSection({ fakeGradientDelimiter: true })
      expect(section.innerContainer.querySelector('hr')).toBeNull()
      expect(section.innerContainer.querySelector('.gradient-delimiter')).not.toBeNull()
      expect(section.innerContainer.classList.contains('with-fake-delimiter')).toBe(true)
    })
  })
})
