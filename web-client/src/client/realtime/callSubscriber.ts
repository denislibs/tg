// src/client/realtime/callSubscriber.ts
//
// Подписчик realtime-кадров звонков/трансляций → движки (callStore/groupCall/
// livestream). Вынесен из storeProjection: проектор пишет ТОЛЬКО стор, а сигналинг
// звонков — это императивный движок, отдельная забота (как sound/notification).
import { eventBus } from '../../core/realtime/eventBus'
import { RT, type CallFrameEvt } from '../../core/realtime/events'
import * as callEngine from '../../core/calls/callEngine'
import { handleGroupCallFrame, type GroupCallFrame } from '../../core/calls/groupCallEngine'
import { handleLivestreamFrame, type LivestreamFrame } from '../../core/calls/livestreamEngine'

export function registerCallSubscriber(): void {
  // 1:1 call signaling → движок звонка (стейт живёт в callStore).
  eventBus.subscribe(RT.call, (raw) => { callEngine.handleFrame(raw as CallFrameEvt) })
  eventBus.subscribe(RT.groupCall, (raw) => { handleGroupCallFrame(raw as GroupCallFrame) })
  // RTMP-трансляция: старт/стоп → livestreamStore (плашка LIVE + экран просмотра).
  eventBus.subscribe(RT.livestream, (raw) => { handleLivestreamFrame(raw as LivestreamFrame) })
}
