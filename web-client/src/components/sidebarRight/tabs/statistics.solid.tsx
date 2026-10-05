/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/statistics.tsx` (812502980) —
 * `AppStatisticsTab`, классовая вкладка правой колонки (`SliderSuperTabEventable`,
 * в `solidJsTabs/tabs.ts` её нет и у оригинала): статистика канала
 * (`stats.broadcastStats`), группы (`stats.megagroupStats`) и поста
 * (`stats.messageStats`). Содержимое — Solid `render` в прокрутку вкладки
 * (`:1137`), графики — пакет tweb `lib/tchart` (порт файлами, ленивый
 * `import()` как `ensureTChart` `:122-128`), стили — `_rightSidebar.scss`
 * (`.statistics*`) и `lib/tchart/chart.scss`.
 *
 * Открывают: пункт «Статистика» меню ⋮ шапки (`chat/topbar.ts`, tweb
 * `topbar.ts:682-689`) и «Статистика» в меню поста (`chat/contextMenu.ts`,
 * tweb `contextMenu.ts:1293-1298`, `:2333-2336`); строки профиля и
 * `editChat` у оригинала нет.
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *  1. `open(peerId, mid?)` — знаковый ключ пира, а не `chatId` (`:1062`): у нас
 *     `PeerId` чата и есть адрес ручки (`/channels/{peerId}/stats`).
 *  2. Нет режимов истории (`storyId`, `getStoryStats`, `wrapStoryMedia`,
 *     пункт `ViewStory`) и опроса (`mode: 'poll'`, `getPollStats`,
 *     `votes_graph`, `PollStats.*`): статистики историй для этой вкладки и
 *     статистики опросов у бэкенда нет — Б-122. Вьювер историй — React-остров
 *     волны 4 со своей `StoryStats`.
 *  3. Нет публичных пересылок поста (`getMessagePublicForwards`,
 *     `renderPublicForward`, секция `PublicSharesCount`, `MoreButton`):
 *     ручки нет. Обзор поста — без `public_shares`, `private_shares` ≈ все
 *     пересылки поста — Б-121.
 *  4. Нет топов группы (`top_posters`/`top_admins`/`top_inviters`,
 *     `renderPeer`, `appDialogsManager.addDialogNew`): бэкенд отдаёт пустые
 *     векторы — Б-123.
 *  5. Нет `statsGraphAsync`/`loadAsyncGraph` и детализации графика
 *     (`x_on_zoom`/`zoom_token`): бэкенд считает ряды сразу и почасовых рядов
 *     не держит — Б-124. `dcId`/`graphDcIds` не нужны (один дата-центр).
 *  6. Недавний пост — с аватаркой канала вместо превью медиа:
 *     `wrapReplyDivAndCaption` у нас медиа не рисует (`chat/replyContainer.ts`)
 *     и всегда отвечает `false` — ветка `avatarNew` оригинала (`:722-726`).
 *  7. `themeController.isNight()` — `isNight` из `core/theme/themeController.ts`;
 *     `I18n.format(key, true)` — `I18n.format` нашего `langPack`.
 */
import type TChart from '@lib/tchart/chart'
import type { TChartData, TChatOriginalData } from '@lib/tchart/types'
import type { PostInteractionCounters, StatsAbsValueAndPrev, StatsBroadcastStats, StatsGraph, StatsMegagroupStats, StatsMessageStats, StatsPercentValue } from '@layer'
import type { MessageReal } from '@core/models'
import I18n, { i18n, joinElementsWith, type LangPackKey } from '@lib/langPack'
import Section from '@components/section.solid'
import { SliderSuperTabEventable } from '@components/sliderTab'
import { For, render } from 'solid-js/web'
import { type JSX, createSignal, onMount } from 'solid-js'
import formatNumber from '@helpers/number/formatNumber'
import { FontFamily } from '@config/font'
import rootScope from '@lib/rootScope'
import customProperties from '@helpers/dom/customProperties'
import { hexToRgb, mixColors } from '@shared/lib/color'
import emptyPlaceholder from '@components/emptyPlaceholder.solid'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import liteMode from '@helpers/liteMode'
import classNames from '@helpers/string/classNames'
import Icon from '@components/icon'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import RowTsx from '@components/rowTsx.solid'
import { wrapReplyDivAndCaption } from '@components/chat/replyContainer'
import { formatFullSentTime } from '@helpers/date'
import numberThousandSplitter from '@helpers/number/numberThousandSplitter'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import { isNight } from '@core/theme/themeController'
import createContextMenu from '@helpers/dom/createContextMenu'
import appImManager from '@lib/appImManager'
import { avatarNew } from '@components/avatar'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import { isBroadcastPeer, isMegagroupPeer } from '@core/peerCache'
import type SidebarSlider from '@components/slider'

type PickByType<T, V> = { [K in keyof T as T[K] extends V | undefined ? K : never]: T[K] }

const CHANNEL_GRAPHS_TITLES: { [key in keyof PickByType<StatsBroadcastStats, StatsGraph>]: LangPackKey } = {
  growth_graph: 'GrowthChartTitle',
  followers_graph: 'FollowersChartTitle',
  mute_graph: 'Notifications',
  top_hours_graph: 'TopHoursChartTitle',
  views_by_source_graph: 'ViewsBySourceChartTitle',
  new_followers_by_source_graph: 'NewFollowersBySourceChartTitle',
  languages_graph: 'LanguagesChartTitle',
  interactions_graph: 'InteractionsChartTitle',
  iv_interactions_graph: 'IVInteractionsChartTitle',
  reactions_by_emotion_graph: 'ReactionsByEmotionChartTitle',
  story_interactions_graph: 'StoryInteractionsChartTitle',
  story_reactions_by_emotion_graph: 'StoryReactionsByEmotionChartTitle',
}

const GROUP_GRAPH_TITLES: { [key in keyof PickByType<StatsMegagroupStats, StatsGraph>]: LangPackKey } = {
  growth_graph: 'GrowthChartTitle',
  members_graph: 'GroupMembersChartTitle',
  new_members_by_source_graph: 'NewMembersBySourceChartTitle',
  languages_graph: 'MembersLanguageChartTitle',
  messages_graph: 'MessagesChartTitle',
  actions_graph: 'ActionsChartTitle',
  top_hours_graph: 'TopHoursChartTitle',
  weekdays_graph: 'TopDaysOfWeekChartTitle',
}

const MESSAGE_GRAPH_TITLES: { [key in keyof PickByType<StatsMessageStats, StatsGraph>]: LangPackKey } = {
  views_graph: 'ViewsAndSharesChartTitle',
  reactions_by_emotion_graph: 'ReactionsByEmotionChartTitle',
}

const CHANNEL_OVERVIEW_ITEMS: { [key in keyof PickByType<StatsBroadcastStats, StatsAbsValueAndPrev | StatsPercentValue>]: LangPackKey } = {
  followers: 'FollowersChartTitle',
  enabled_notifications: 'EnabledNotifications',
  views_per_post: 'ViewsPerPost',
  views_per_story: 'ViewsPerStory',
  shares_per_post: 'SharesPerPost',
  shares_per_story: 'SharesPerStory',
  reactions_per_post: 'ReactionsPerPost',
  reactions_per_story: 'ReactionsPerStory',
}

const GROUP_OVERVIEW_ITEMS: { [key in keyof PickByType<StatsMegagroupStats, StatsAbsValueAndPrev | StatsPercentValue>]: LangPackKey } = {
  members: 'MembersOverviewTitle',
  messages: 'MessagesOverview',
  viewers: 'ViewingMembers',
  posters: 'PostingMembers',
}

const MESSAGE_OVERVIEW_ITEMS: { [key in keyof PickByType<StatsMessageStats, StatsAbsValueAndPrev | StatsPercentValue>]: LangPackKey } = {
  views: 'StatisticViews',
  public_shares: 'PublicShares',
  reactions: 'Reactions',
  private_shares: 'PrivateShares',
}

type AnyStats = StatsBroadcastStats | StatsMegagroupStats | StatsMessageStats
type StatsRecord = Record<string, unknown>

let TChartPromise: Promise<void> | undefined
let _TChart: typeof TChart
function ensureTChart() {
  return TChartPromise ??= import('@lib/tchart/chart').then((module) => {
    _TChart = module.default
  })
}

function extractColor(color: string): string {
  return color.substring(color.indexOf('#'))
}

export const makeAbsStats = (value: number, approximate?: boolean): StatsAbsValueAndPrev => {
  return {
    _: 'statsAbsValueAndPrev',
    current: value,
    previous: 0,
    approximate,
  }
}

const StatisticsOverviewItem = ({
  value,
  title,
  includeZeroValue,
  describePercentage,
}: {
  value: StatsAbsValueAndPrev | StatsPercentValue,
  title: LangPackKey,
  includeZeroValue?: boolean,
  describePercentage?: boolean
}) => {
  const isPercentage = value._ === 'statsPercentValue'
  let v: JSX.Element
  if(isPercentage) {
    const n = (value.part / value.total * 100).toFixed(2)
    v = `${n}%`

    if(describePercentage) {
      v = (
        <>
          {`≈${value.part} `}
          <span class="statistics-overview-item-value-description">
            {v}
          </span>
        </>
      )
    }
  } else {
    v = formatNumber(value.current, 1)

    if(value.approximate) {
      v = '≈' + v
    }

    if(!value.current && !value.previous && !includeZeroValue) {
      return
    }

    if(value.current !== value.previous && value.previous) {
      const diff = value.current - value.previous
      const absDiff = Math.abs(diff)
      const vv = `${diff > 0 ? '+' : '-'}${formatNumber(absDiff, 1)}`
      const p = +(Math.abs(1 - value.current / value.previous) * 100).toFixed(2)
      const str = `${vv} (${p}%)`
      v = (
        <>
          {v}{' '}
          <span
            class={classNames('statistics-overview-item-value-description', diff > 0 ? 'green' : 'red')}
          >
            {str}
          </span>
        </>
      )
    }
  }

  return (
    <div class="statistics-overview-item">
      <div class="statistics-overview-item-value">
        {v}
      </div>
      <div class="statistics-overview-item-name">
        {i18n(title)}
      </div>
    </div>
  )
}

export const StatisticsOverviewItems = (props: {
  items: Parameters<typeof StatisticsOverviewItem>[0][]
}) => {
  return (
    <div class="statistics-overview">
      <For each={props.items}>{StatisticsOverviewItem}</For>
    </div>
  )
}

type RecentPost = { container: HTMLElement, postInteractionCounters: PostInteractionCounters }

export default class AppStatisticsTab extends SliderSuperTabEventable {
  private peerId!: PeerId
  private mid?: number
  private stats!: AnyStats
  private messages!: Map<number, MessageReal>
  private openPromise!: CancellablePromise<void>
  private isBroadcast = false
  private isMegagroup = false
  private isMessage = false

  protected onOpenAfterTimeout(): void {
    this.openPromise.resolve!()
  }

  private _construct(
    recentPosts: RecentPost[],
    currentPost: RecentPost | undefined,
  ) {
    const dateElement = new I18n.IntlDateElement({ options: {} })
    const getLabelDate: TChartData['getLabelDate'] = (value, options = {}) => {
      options.displayYear ??= true
      options.isMonthShort ??= true

      const date = new Date(value)
      dateElement.update({
        date,
        options: {
          weekday: options.displayWeekDay ? options.isShort ? 'short' : 'long' : undefined,
          year: options.displayYear ? 'numeric' : undefined,
          hour: options.displayHours ? '2-digit' : undefined,
          minute: options.displayHours ? '2-digit' : undefined,
          month: options.isMonthShort ? 'short' : 'long',
          day: 'numeric',
        },
      })

      return dateElement.element.textContent!
    }

    const getLabelTime: TChartData['getLabelTime'] = (value: number) => {
      const date = new Date(value)
      dateElement.update({
        date,
        options: {
          hour: '2-digit',
          minute: '2-digit',
        },
      })

      return dateElement.element.textContent!
    }

    const makeColors = () => {
      const surface = customProperties.getProperty('surface-color')
      const primary = customProperties.getProperty('primary-color')
      const secondary = customProperties.getProperty('secondary-color')
      const surfaceRgb = hexToRgb(surface)

      const miniMask = mixColors(
        hexToRgb(secondary),
        mixColors(
          hexToRgb(primary),
          surfaceRgb,
          0.1,
        ),
        0.2,
      )

      const miniFrame = mixColors(
        hexToRgb(secondary),
        mixColors(
          hexToRgb(primary),
          surfaceRgb,
          0.3,
        ),
        0.4,
      )

      const colors: NonNullable<ConstructorParameters<typeof TChart>[0]['settings']>['COLORS'] = {
        primary: customProperties.getProperty('primary-color'),
        secondary: customProperties.getProperty('secondary-color'),
        background: surface,
        backgroundRgb: surfaceRgb,
        text: customProperties.getProperty('primary-text-color'),
        dates: customProperties.getProperty('secondary-text-color'),
        grid: `rgba(${hexToRgb(customProperties.getProperty('secondary-text-color')).join(', ')}, 0.2)`,
        axis: {
          x: customProperties.getProperty('secondary-text-color'),
          y: customProperties.getProperty('secondary-text-color'),
        },
        barsSelectionBackground: `rgba(${surfaceRgb.join(', ')}, 0.5)`,
        miniMask: `rgba(${miniMask.join(', ')}, 0.6)`,
        miniFrame: `rgb(${miniFrame.join(', ')})`,
      }

      return colors
    }
    let colors = makeColors()
    this.listenerSetter.add(rootScope)('theme_changed', () => {
      colors = makeColors()
    })

    const titles: Record<string, LangPackKey> = this.isBroadcast ? CHANNEL_GRAPHS_TITLES : (this.isMegagroup ? GROUP_GRAPH_TITLES : MESSAGE_GRAPH_TITLES)
    const stats = this.stats as unknown as StatsRecord
    const graphs = Object.keys(titles).map((key) => {
      const statsGraph = stats[key] as StatsGraph.statsGraph | undefined
      return statsGraph && {
        statsGraph,
        title: titles[key],
        percentage: key === 'languages_graph',
      }
    }).filter(Boolean) as { statsGraph: StatsGraph.statsGraph, title: LangPackKey, percentage: boolean }[]
    const renderGraph = ({ statsGraph, title, percentage }: typeof graphs[0]) => {
      onMount(() => {
        let data: TChatOriginalData = JSON.parse(statsGraph.json.data)

        const prepareData = (data: TChatOriginalData, percentage?: boolean) => {
          for(const i in data.colors) {
            const color = data.colors[i]
            data.colors[i] = extractColor(color)
          }

          if(percentage) for(const i in data.types) {
            if(data.types[i] === 'bar') {
              data.types[i] = 'area'
            }
          }

          return data
        }

        data = prepareData(data, percentage)

        type T = ConstructorParameters<typeof TChart>[0]['data']
        const addOptions: Partial<T> = {
          getLabelDate,
          getLabelTime,
          tooltipOnHover: true,
        }

        // расхождение 5 — `x_on_zoom` по `zoom_token` не заводится
        const tChart = _TChart.render({
          container,
          data: {
            ...data,
            ...addOptions,
          } as unknown as T,
          settings: {
            darkMode: isNight(),
            ALL_LABEL: I18n.format('Chart.Tooltip.All', true),
            DATES_SIDE: 'left',
            DATES_WEIGHT: 'normal',
            DATES_FONT_SIZE: 14,
            ZOOM_TEXT: I18n.format('ZoomOut', true),
            FONT: {
              family: FontFamily,
              bold: '500',
              normal: '400',
            },
            COLORS: colors,
          },
        })

        const setStyles = () => {
          const p: [property: string, value: string][] = [
            ['primary-color', colors.primary!],
            ['background-color', colors.background],
            ['background-color-rgb', colors.backgroundRgb.join(', ')],
            ['text-color', colors.text],
            ['secondary-color', colors.secondary!],
            ['font-family', FontFamily],
          ]

          p.forEach(([property, value]) => {
            tChart.$wrapper.style.setProperty(`--tchart-${property}`, value)
          })
        }

        setStyles()

        this.listenerSetter.add(rootScope)('theme_changed', () => {
          tChart.setDarkMode(isNight(), { ...colors })
          setStyles()
        })
      })

      const titleElement = document.createElement('div')
      const captionElement = document.createElement('div')
      titleElement.classList.add('statistics-title')
      const t = i18n(title)
      t.classList.add('statistics-title-text')
      titleElement.append(t)
      let container!: HTMLDivElement
      return (
        <Section name={titleElement} nameRight={captionElement}>
          <div class="statistics-chart" ref={(el) => container = el}></div>
        </Section>
      )
    }

    const overviewTitles: Record<string, LangPackKey> = this.stats._ === 'stats.broadcastStats' ? CHANNEL_OVERVIEW_ITEMS : (this.isMegagroup ? GROUP_OVERVIEW_ITEMS : MESSAGE_OVERVIEW_ITEMS)
    const overviewItems = Object.keys(overviewTitles).map((key) => {
      const value = stats[key] as StatsAbsValueAndPrev | StatsPercentValue | undefined
      return value && {
        value,
        title: overviewTitles[key],
      }
    }).filter(Boolean) as { value: StatsAbsValueAndPrev | StatsPercentValue, title: LangPackKey }[]

    const formatDateRange = (min: number, max: number) => {
      return joinElementsWith<HTMLElement | string>([min, max].map((timestamp) => {
        return new I18n.IntlDateElement({
          date: new Date(timestamp * 1e3),
          options: {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          },
        }).element
      }), ' — ')
    }

    const period = (this.stats as StatsBroadcastStats).period
    let postsContainer: HTMLDivElement | undefined
    const ret = (
      <>
        {currentPost && <Section>{currentPost.container}</Section>}
        {!!overviewItems.length && <Section name="StatisticOverview" nameRight={period && formatDateRange(period.min_date, period.max_date)}>
          <StatisticsOverviewItems items={overviewItems} />
        </Section>}
        <For each={graphs}>{renderGraph}</For>
        {!!recentPosts.length && <Section ref={(el: HTMLDivElement) => postsContainer = el} name="RecentPosts">
          {recentPosts.map(({ container }) => container)}
        </Section>}
      </>
    )

    if(postsContainer) {
      const map: Map<HTMLElement, PostInteractionCounters> = new Map()
      recentPosts.forEach(({ container, postInteractionCounters }) => {
        map.set(container, postInteractionCounters)
      })

      const findTarget = (e: MouseEvent | TouchEvent) => findUpClassName(e.target!, 'statistics-post')
      let counters: PostInteractionCounters | undefined

      const onOpenClick = () => {
        void (this.slider as SidebarSlider).createTab(AppStatisticsTab).open(
          this.peerId,
          (counters as PostInteractionCounters.postInteractionCountersMessage).msg_id,
        )
      }

      attachClickEvent(postsContainer, (e) => {
        counters = map.get(findTarget(e)!)
        if(!counters) {
          return
        }

        onOpenClick()
      }, { listenerSetter: this.listenerSetter })

      createContextMenu({
        buttons: [{
          icon: 'statistics_filled',
          text: 'ViewStatistics',
          onClick: onOpenClick,
        }, {
          icon: 'message',
          text: 'Message.Context.Goto',
          onClick: () => {
            void appImManager.setInnerPeer({
              peerId: this.peerId,
              lastMsgId: (counters as PostInteractionCounters.postInteractionCountersMessage).msg_id,
            })
          },
          verify: () => counters?._ === 'postInteractionCountersMessage',
        }],
        listenTo: postsContainer,
        listenerSetter: this.listenerSetter,
        findElement: (e) => {
          const target = findTarget(e)
          counters = target ? map.get(target) : undefined
          return target
        },
        middleware: this.middlewareHelper.get(),
      })
    }

    return ret
  }

  private async renderRecentPost(
    postInteractionCounters: PostInteractionCounters.postInteractionCountersMessage,
    noLabels?: boolean,
  ): Promise<RecentPost> {
    const peerId = this.peerId
    const subtitleRightFragment = document.createDocumentFragment()
    const a: ['reactions' | 'reply', number][] = [
      ['reactions', postInteractionCounters.reactions],
      ['reply', postInteractionCounters.forwards],
    ]

    if(!noLabels) a.forEach(([icon, count]) => {
      if(!count) {
        return
      }

      const i = Icon(icon, 'statistics-post-counter-icon')
      if(icon === 'reply') {
        i.classList.add('icon-reflect')
      }

      const e = document.createElement('span')
      e.classList.add('statistics-post-counter')
      e.append(i, formatNumber(count, 1))
      subtitleRightFragment.append(e)
    })

    const middleware = this.middlewareHelper.get()
    const mediaEl = document.createElement('div')
    mediaEl.classList.add('statistics-post-media')
    let titleElement!: HTMLDivElement
    let subtitleElement!: HTMLDivElement
    const container = wrapSolidComponent(() => (
      <RowTsx
        clickable
        noWrap
        class="statistics-post"
      >
        <RowTsx.Title
          ref={(el) => titleElement = el}
          class="statistics-post-title"
          titleRight={noLabels ? undefined : i18n('Views', [numberThousandSplitter(postInteractionCounters.views)])}
        />
        <RowTsx.Subtitle
          ref={(el) => subtitleElement = el}
          subtitleRight={noLabels ? undefined : subtitleRightFragment}
        />
        <RowTsx.Media element={mediaEl} size="abitbigger" />
      </RowTsx>
    ), middleware)

    container.classList.add('statistics-post-message')
    const message = this.messages.get(postInteractionCounters.msg_id)!
    const isMediaSet = await wrapReplyDivAndCaption({
      titleEl: subtitleElement,
      title: formatFullSentTime(message.date),
      subtitleEl: titleElement,
      message,
    })

    // расхождение 6
    if(!isMediaSet) {
      const { node, readyThumbPromise } = avatarNew({ middleware, peerId, size: 42, managers: this.managers! })
      mediaEl.append(node)
      await readyThumbPromise
    }

    return { container, postInteractionCounters }
  }

  private async loadStats() {
    const peerId = this.peerId
    const manager = this.managers!.stats
    const statsPromise = this.isBroadcast ?
      manager.getBroadcastStats({ peerId }) :
      (this.isMegagroup ? manager.getMegagroupStats({ peerId }) : manager.getMessageStats({ peerId, mid: this.mid }))
    const postPromise = this.isMessage ? this.managers!.messages.reloadMessage(peerId, this.mid!) : undefined
    const { stats } = await statsPromise as { stats: AnyStats }
    this.stats = stats

    // `statsGraphError` графика без данных — ключ выбрасывается (`:996-1003`)
    const record = stats as unknown as StatsRecord
    for(const key in record) {
      const value = record[key] as StatsGraph | undefined
      if(value?._ === 'statsGraphError') {
        delete record[key]
      }
    }

    const promises: PromiseLike<unknown>[] = []
    const recentPosts = ((stats as StatsBroadcastStats).recent_posts_interactions || []).filter(
      (counters): counters is PostInteractionCounters.postInteractionCountersMessage => counters._ === 'postInteractionCountersMessage',
    )
    recentPosts.slice().forEach((postInteractionCounters) => {
      const promise = this.managers!.messages.reloadMessage(peerId, postInteractionCounters.msg_id)
      .then((message) => {
        if(message?._ !== 'message') {
          indexOfAndSplice(recentPosts, postInteractionCounters)
          return
        }

        this.messages.set(message.id, message)
      })

      promises.push(promise)
    })

    // `:1040-1060` без публичных пересылок — расхождение 3
    if(postPromise) {
      promises.push(postPromise.then((message) => {
        if(message?._ !== 'message') {
          return
        }

        const messageStats = stats as StatsMessageStats
        this.messages.set(message.id, message)
        messageStats.views = makeAbsStats(message.views || 0)
        messageStats.reactions = makeAbsStats(message.reactions ? message.reactions.results.reduce((acc, v) => acc + v.count, 0) : 0)
        messageStats.private_shares = makeAbsStats(message.forwards || 0, true)
      }))
    }

    await Promise.all(promises)
    const recentPostsPromises = recentPosts.map((postInteractionCounters) => {
      return this.renderRecentPost(postInteractionCounters)
    })

    const currentPostPromise = this.isMessage && this.messages.has(this.mid!) ? this.renderRecentPost({
      _: 'postInteractionCountersMessage',
      msg_id: this.mid!,
      forwards: 0,
      reactions: 0,
      views: 0,
    }, true) : undefined

    return Promise.all([
      Promise.all(recentPostsPromises),
      Promise.resolve(currentPostPromise),
    ] as const)
  }

  public async init(peerId: PeerId, mid?: number) {
    this.container.classList.add('statistics-container')

    this.peerId = peerId
    this.mid = mid
    this.messages = new Map()
    this.openPromise = deferredPromise<void>()

    if(mid) {
      this.isMessage = true
    } else {
      this.isBroadcast = isBroadcastPeer(peerId)
      this.isMegagroup = isMegagroupPeer(peerId)
    }

    this.setTitle(this.isBroadcast ? 'Statistics' : (this.isMegagroup ? 'GroupStats.Title' : 'PostStatistics'))

    const promise = Promise.all([
      ensureTChart(),
      this.openPromise,
      this.loadStats(),
    ])
    promise.catch((): undefined => undefined)

    const [hide, setHide] = createSignal(false)
    const middleware = this.middlewareHelper.get()

    const element = await emptyPlaceholder({
      title: () => i18n('LoadingStats'),
      description: () => i18n('LoadingStatsDescription'),
      assetName: 'StatsEmoji',
      middleware,
      hide,
      isFullSize: true,
    })

    if(!middleware() || !element) {
      return
    }

    this.scrollable.append(element)
    void promise.then(async([_, __, loaded]) => {
      if(!middleware()) {
        return
      }

      const div = document.createElement('div')
      this.scrollable.append(div)
      const dispose = render(() => this._construct(...loaded), div)
      this.eventListener.addEventListener('destroy', dispose)

      if(liteMode.isAvailable('animations')) {
        const keyframes: Keyframe[] = [{ opacity: '1' }, { opacity: '0' }]
        const options: KeyframeAnimationOptions = { duration: 200, fill: 'forwards', easing: 'ease-in-out' }
        const animations = [
          element.animate(keyframes, options),
          div.animate(keyframes.slice().reverse(), options),
        ]

        await Promise.all(animations.map((animation) => animation.finished)).catch((): undefined => undefined)
        if(!middleware()) {
          return
        }
      }

      setHide(true)
    }, () => undefined)
  }
}
