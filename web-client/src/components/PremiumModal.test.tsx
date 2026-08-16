// Пин DOM-структуры тела попапа Premium по живому дампу tweb
// (`docs/research/tweb-dom/14-left-24-premium-popup.json`):
//   div.popup.popup-premium.active > div.popup-container.z-depth-1 >
//     div.tabs-container.premium-tabs.fixed-size >
//       div.premium-promo-tab...tabs-tab.premium-tab.active >
//         div.popup-header > .popup-header-background + button.btn-icon.popup-close
//                           > span.tgico + div.popup-title.i18n
//         div.popup-body >
//           form.popup-gift-premium-options >
//             label.row.row-with-padding.row-clickable.hover-effect.rp.row-grid
//               .popup-gift-premium-option[.no-subtitle]
//               > div.c-ripple + [div.row-subtitle] + label.checkbox-field...
//                 input.checkbox-field-input[type=radio] + div.row-title
//                 + span.row-title-right-secondary.row-right
//           div.popup-premium-features-container >
//             div.row.row-clickable.hover-effect.rp.row-with-padding >
//               div.c-ripple + div.row-subtitle + div.row-title[+ span.row-title-badge]
//               + div.row-media.row-media-small.premium-promo-tab-icon > span.tgico
//     div.action-button-container > button.btn-primary.popup-gift-premium-confirm
//       .action-button.shimmer.rp
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import PremiumModal from './PremiumModal'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'

// PremiumCheckout (всегда смонтирован рядом, просто скрыт) читает менеджеры на
// каждом рендере — без провайдера useManagers() бросает.
const fakeManagers = {} as unknown as Managers

// `.active` вешается кадром позже (requestAnimationFrame в usePopupTransition,
// settings/kit.tsx) — как в MainMenu.test.tsx, флашим один кадр после рендера.
async function mount(props: Partial<Parameters<typeof PremiumModal>[0]> = {}) {
  const result = render(
    <ManagersProvider managers={fakeManagers}>
      <PremiumModal open onClose={() => {}} {...props} />
    </ManagersProvider>,
  )
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r))
  })
  return result
}

afterEach(cleanup)

describe('PremiumModal — тело попапа 1:1 с tweb', () => {
  it('корень popup-premium.active > popup-container.z-depth-1 > tabs-container.premium-tabs', async () => {
    await mount()
    const root = document.querySelector('.popup')!
    expect(root.classList.contains('popup-premium')).toBe(true)
    expect(root.classList.contains('active')).toBe(true)
    expect(root.querySelector(':scope > .popup-container.z-depth-1')).not.toBeNull()
    expect(document.querySelector('.popup-container > .tabs-container.premium-tabs.fixed-size')).not.toBeNull()
  })

  it('хедер: popup-header-background + btn-icon.popup-close > span.tgico + popup-title.i18n', async () => {
    await mount()
    const header = document.querySelector('.popup-header')!
    expect(header.querySelector(':scope > .popup-header-background')).not.toBeNull()

    const close = header.querySelector(':scope > .btn-icon.popup-close')!
    expect(close.tagName).toBe('BUTTON')
    expect(close.querySelector(':scope > .tgico')).not.toBeNull()

    const title = header.querySelector(':scope > .popup-title')!
    expect(title.classList.contains('i18n')).toBe(true)
    expect(title.textContent).toBe('Telegram Premium')
  })

  it('тарифная строка: row-grid.popup-gift-premium-option, радио — input[type=radio] в checkbox-field', async () => {
    await mount()
    const form = document.querySelector('form.popup-gift-premium-options')!
    const rows = form.querySelectorAll(':scope > .popup-gift-premium-option')
    // core/premium/plans.ts — три тарифа (12m/6m/1m)
    expect(rows.length).toBe(3)

    const first = rows[0]!
    expect(first.tagName).toBe('LABEL')
    for (const cls of ['row', 'row-with-padding', 'row-clickable', 'hover-effect', 'rp', 'row-grid']) {
      expect(first.classList.contains(cls)).toBe(true)
    }
    expect(first.querySelector(':scope > .c-ripple')).not.toBeNull()

    const radio = first.querySelector('input.checkbox-field-input') as HTMLInputElement
    expect(radio.type).toBe('radio')
    expect(radio.name).toBe('premium-period')
    expect(radio.closest('label')!.classList.contains('checkbox-field')).toBe(true)

    // самый дешёвый в месяц план (последняя строка, 1 месяц) — без подписи/скидки
    const last = rows[rows.length - 1]!
    expect(last.classList.contains('no-subtitle')).toBe(true)
    expect(last.querySelector(':scope > .row-subtitle')).toBeNull()

    // не самый дешёвый — со скидкой и подписью "-N% <цена> / month"
    const discounted = rows[0]!
    const subtitle = discounted.querySelector(':scope > .row-subtitle')!
    expect(subtitle.querySelector('.popup-gift-premium-discount')!.textContent).toMatch(/^-\d+%$/)
    expect(subtitle.querySelector('.i18n')!.textContent).toContain('per month')

    // цена целиком — row-title-right-secondary.row-right, БЕЗ i18n (Row.ts rightTextContent)
    const price = discounted.querySelector(':scope > .row-title-right-secondary.row-right')!
    expect(price.classList.contains('i18n')).toBe(false)
    expect(price.textContent).toMatch(/^\$/)
  })

  it('клик по тарифной строке переключает радио (нативный label, без ручного onClick)', async () => {
    await mount()
    const rows = document.querySelectorAll('form.popup-gift-premium-options > .popup-gift-premium-option')
    const secondTitle = rows[1]!.querySelector('.row-title')!
    fireEvent.click(secondTitle)
    const secondRadio = rows[1]!.querySelector('input.checkbox-field-input') as HTMLInputElement
    expect(secondRadio.checked).toBe(true)
  })

  it('строка фичи: row-with-padding + row-media.row-media-small.premium-promo-tab-icon > tgico', async () => {
    await mount()
    const container = document.querySelector('.popup-premium-features-container')!
    const rows = container.querySelectorAll(':scope > .row')
    expect(rows.length).toBeGreaterThan(0)

    const row = rows[0]!
    for (const cls of ['row', 'row-clickable', 'hover-effect', 'rp', 'row-with-padding']) {
      expect(row.classList.contains(cls)).toBe(true)
    }
    expect(row.querySelector(':scope > .c-ripple')).not.toBeNull()
    expect(row.querySelector(':scope > .row-subtitle > .i18n')).not.toBeNull()

    const media = row.querySelector(':scope > .row-media.row-media-small.premium-promo-tab-icon')!
    expect(media.querySelector(':scope > .tgico')).not.toBeNull()
    expect((media as HTMLElement).style.backgroundColor).not.toBe('')
  })

  it('бейдж "New" — span.i18n.row-title-badge внутри row-title той же фичи', async () => {
    await mount()
    const badge = document.querySelector('.popup-premium-features-container .row-title-badge')!
    expect(badge.classList.contains('i18n')).toBe(true)
    expect(badge.parentElement!.classList.contains('row-title')).toBe(true)
    expect(badge.textContent).toBe('New')
  })

  it('CTA: action-button-container > btn-primary.popup-gift-premium-confirm.action-button.shimmer.rp', async () => {
    await mount()
    const cta = document.querySelector('.action-button-container > button')!
    for (const cls of ['btn-primary', 'popup-gift-premium-confirm', 'action-button', 'shimmer', 'rp']) {
      expect(cta.classList.contains(cls)).toBe(true)
    }
    expect(cta.querySelector(':scope > .c-ripple')).not.toBeNull()
    expect(cta.querySelector(':scope > .i18n')!.textContent).toContain('Subscribe for')
  })

  it('клик по CTA открывает чекаут (PremiumCheckout) для выбранного тарифа', async () => {
    await mount()
    const cta = document.querySelector('.action-button-container > button')!
    // PremiumCheckout сидит рядом уже смонтированным (open=false); клик
    // переключает его проп — `mounted` там обновляется эффектом, не в этом же
    // тике, поэтому флашим микротаску. PremiumCheckout — отдельный, свой попап
    // (не на глобальных tweb-классах — вне периметра этой задачи), поэтому
    // ищем по числу `.popup`-корней и своему тексту "Payment", а не по классу.
    await act(async () => {
      fireEvent.click(cta)
      await Promise.resolve()
    })
    expect(document.querySelectorAll('.popup').length).toBe(2)
    expect(document.body.textContent).toContain('Payment')
  })

  it('клик по скриму закрывает попап', async () => {
    const onClose = vi.fn()
    await mount({ onClose })
    fireEvent.click(document.querySelector('.popup')!)
    expect(onClose).toHaveBeenCalled()
  })
})
