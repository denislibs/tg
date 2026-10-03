/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/topbarLive/topbarLive.tsx` (812502980, 42 строки) —
// содержимое плашки идущего эфира: «Прямой эфир · N зрителей» и «Смотреть». Стили —
// `styles/tweb/_topbarLive.scss`.
import type { JSX } from 'solid-js'
import { numberThousandSplitterForWatching } from '@helpers/number/numberThousandSplitter'
import { Skeleton } from '@components/skeleton/index.solid'
import { i18n } from '@lib/langPack'
import Button from '@components/buttonTsx.solid'
import classNames from '@helpers/string/classNames'
import { cnTopbarLive } from './topbarLive.cn'

export const TopbarLive = (props: {
  watching: number | undefined
  actionButton: JSX.Element
}) => {
  const watching = () => props.watching! > 0 ?
    i18n('Rtmp.Watching', [numberThousandSplitterForWatching(Math.max(0, props.watching!))]) :
    i18n('Rtmp.Topbar.NoViewers')

  const subtitle = (
    <div>
      <Skeleton loading={props.watching === undefined}>
        {watching()}
      </Skeleton>
    </div>
  )

  return (
    <>
      <Button.Icon icon="livestream" class="danger disable-hover" tabIndex={-1} aria-hidden="true" />
      <div class={cnTopbarLive('-content')}>
        <div class={classNames(cnTopbarLive('-title'), 'primary', 'text-bold')}>
          {i18n('Rtmp.Topbar.Title')}
        </div>
        <div class={classNames(cnTopbarLive('-subtitle'), 'secondary')}>
          {subtitle}
        </div>
      </div>
      {props.actionButton}
    </>
  )
}
