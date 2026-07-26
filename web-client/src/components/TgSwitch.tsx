import s from './TgSwitch.module.scss'

/**
 * Telegram-style toggle, 1:1 with tweb's .checkbox-field-toggle:
 * track 31x14 (pill), 20px round thumb in surface-color with a 2px border that
 * matches the track colour (grey off / accent on), thumb overhangs the track by
 * the 3px offset on each side.
 */
export default function TgSwitch({
  checked,
  onClick,
}: {
  checked: boolean
  onClick?: (e: React.MouseEvent) => void
}) {
  return (
    <div className={s.root} data-on={checked || undefined} onClick={onClick}>
      <div className={s.track} />
      <div className={s.thumb} />
    </div>
  )
}
