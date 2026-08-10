// src/client/realtime/callSubscriber.ts
//
// Подписчик realtime-кадров звонков/трансляций → движки (callStore/groupCall/
// livestream). Вынесен из storeProjection: проектор пишет ТОЛЬКО стор, а сигналинг
// звонков — это императивный движок, отдельная забота (как sound/notification).
import rootScope from '@lib/rootScope'
import { RT, type CallFrameEvt } from '../../core/realtime/events'
import * as callEngine from '../../core/calls/callEngine'
import { handleGroupCallFrame, type GroupCallFrame } from '../../core/calls/groupCallEngine'
import { handleLivestreamFrame, type LivestreamFrame } from '../../core/calls/livestreamEngine'

export function registerCallSubscriber(): void {
  // 1:1 call signaling → движок звонка (стейт живёт в callStore).
  rootScope.addEventListener(RT.call, (raw) => { callEngine.handleFrame(raw as CallFrameEvt) })
  rootScope.addEventListener(RT.groupCall, (raw) => { handleGroupCallFrame(raw as GroupCallFrame) })
  // RTMP-трансляция: старт/стоп → livestreamStore (плашка LIVE + экран просмотра).
  rootScope.addEventListener(RT.livestream, (raw) => { handleLivestreamFrame(raw as LivestreamFrame) })
}
