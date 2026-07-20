// Inline-клавиатура под сообщением бота (Telegram replyInlineMarkup). Кнопки:
// callback (шлётся боту → toast/alert), url (открыть ссылку), webapp (mini-app —
// открываем в новой вкладке). Самодостаточный: chatId/botId из сообщения.
import { useState } from 'react'
import type { InlineButton } from '../../core/managers/botsManager'
import { useManagers } from '../../core/hooks/useManagers'
import { uiEvents } from '../../core/hooks/uiEvents'
import ConfirmDialog from '../settings/ConfirmDialog'
import classNames from '../../shared/lib/classNames'
import { openWebApp } from '../../core/webapp'
import { useT } from '../../i18n'
import s from './InlineKeyboard.module.scss'

export default function InlineKeyboard({ rows, chatId, botId }: { rows: InlineButton[][]; chatId: number; botId: number }) {
  const t = useT()
  const managers = useManagers()
  const [alert, setAlert] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onClick = async (b: InlineButton) => {
    if (b.url) { window.open(b.url, '_blank', 'noopener'); return }
    if (b.webapp) { openWebApp({ url: b.webapp, botName: b.text }); return }
    if (b.callback == null || busy) return
    setBusy(true)
    try {
      const ans = await managers.bots.callback(botId, chatId, b.callback)
      if (ans.text) {
        if (ans.alert) setAlert(ans.text)
        else uiEvents.emit('ui:toast', ans.text)
      }
    } finally { setBusy(false) }
  }

  return (
    <div className={s.keyboard}>
      {rows.map((row, ri) => {
        // tweb: у крайних кнопок ПОСЛЕДНЕГО ряда нижние внешние углы скруглены
        // большим радиусом — как дно бабла (.is-first / .is-last).
        const lastRow = ri === rows.length - 1
        return (
          <div key={ri} className={s.row}>
            {row.map((b, bi) => (
              <button
                key={bi}
                type="button"
                className={classNames(
                  s.btn,
                  lastRow && bi === 0 ? s.first : '',
                  lastRow && bi === row.length - 1 ? s.last : '',
                )}
                onClick={() => void onClick(b)}
              >
                {b.text}
                {b.url && <span className={s.ext}>↗</span>}
              </button>
            ))}
          </div>
        )
      })}
      {alert && (
        <ConfirmDialog title={t('Bot')} text={alert} action={t('OK')} onConfirm={() => setAlert(null)} onClose={() => setAlert(null)} />
      )}
    </div>
  )
}
