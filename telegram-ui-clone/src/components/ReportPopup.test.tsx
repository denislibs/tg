// Попап «Пожаловаться»: выбор причины (radio) маппится в reason и уходит в
// managers.report.report; после отправки цель в reportStore очищается.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ReportPopup, { REPORT_REASONS } from './ReportPopup'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useReportStore } from '../stores/reportStore'
import type { Managers } from '../client/bootstrap'

function renderWithFake() {
  const report = vi.fn().mockResolvedValue(undefined)
  const managers = { report: { report } } as unknown as Managers
  render(
    <ManagersProvider managers={managers}>
      <ReportPopup />
    </ManagersProvider>,
  )
  return { report }
}

describe('ReportPopup', () => {
  beforeEach(() => useReportStore.setState({ target: null }))
  afterEach(cleanup)

  it('маппинг причин покрывает весь белый список бэкенда', () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual([
      'spam', 'violence', 'porn', 'child_abuse', 'other',
    ])
  })

  it('вызывает managers.report с выбранной причиной и id сообщения', async () => {
    const { report } = renderWithFake()
    useReportStore.getState().open({ chatId: 55, msgId: 900 })

    // выбираем «Pornography» → reason 'porn'
    fireEvent.click(await screen.findByText('Pornography'))
    // кнопка действия «Report» — последний одноимённый элемент (после заголовка)
    const reportEls = screen.getAllByText('Report')
    fireEvent.click(reportEls[reportEls.length - 1])

    await waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    expect(report).toHaveBeenCalledWith({
      chatId: 55,
      msgId: 900,
      reason: 'porn',
      comment: undefined,
    })
    // после успеха цель очищена
    await waitFor(() => expect(useReportStore.getState().target).toBeNull())
  })

  it('жалоба на чат целиком — msgId не задан, по умолчанию spam', async () => {
    const { report } = renderWithFake()
    useReportStore.getState().open({ chatId: 77 })

    const reportEls = await screen.findAllByText('Report')
    fireEvent.click(reportEls[reportEls.length - 1])

    await waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    expect(report).toHaveBeenCalledWith({
      chatId: 77,
      msgId: undefined,
      reason: 'spam',
      comment: undefined,
    })
  })
})
