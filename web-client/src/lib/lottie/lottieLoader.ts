// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
import {MOUNT_CLASS_TO} from '@config/debug';
import pause from '@helpers/schedulers/pause';
import noop from '@helpers/noop';
import {logger, LogTypes} from '@lib/logger';
import LottiePlayer, {LottieOptions} from '@lib/lottie/lottiePlayer';
import IS_WEB_ASSEMBLY_SIMD_SUPPORTED from '@environment/webAssemblySimdSupport';
import makeError from '@helpers/makeError';
import toArray from '@helpers/array/toArray';
import lottieMessagePort from '@lib/lottie/lottieMessagePort';
import animationIntersector from '@components/animationIntersector';
import tlottieWasmAssetUrl from '@vendor/tlottie/tlottie.wasm?url';

const TLOTTIE_WASM_URL = new URL(tlottieWasmAssetUrl, location.href).href;

export type LottieAssetName =
  | 'EmptyFolder'
  | 'Folders_1'
  | 'Folders_2'
  | 'TwoFactorSetupMonkeyClose'
  | 'TwoFactorSetupMonkeyCloseAndPeek'
  | 'TwoFactorSetupMonkeyCloseAndPeekToIdle'
  | 'TwoFactorSetupMonkeyIdle'
  | 'TwoFactorSetupMonkeyPeek'
  | 'TwoFactorSetupMonkeyTracking'
  | 'voice_outlined2'
  | 'voip_filled'
  | 'voice_mini'
  | 'jolly_roger'
  | 'Gift3'
  | 'Gift6'
  | 'Gift12'
  | 'Folders_Shared'
  | 'UtyanSearch'
  | 'UtyanDiscussion'
  | 'UtyanLinks'
  | 'UtyanStories'
  | 'ReactionGeneric'
  | 'StatsEmoji'
  | 'Congratulations'
  | 'large_lastseen'
  | 'large_readtime'
  | 'StarReaction'
  | 'StarReactionAppear'
  | 'StarReactionSelect'
  | 'StarReactionEffect1'
  | 'StarReactionEffect2'
  | 'StarReactionEffect3'
  | 'UtyanPasscode'
  | 'Diamond'
  | 'UtyanRestricted'
  | 'UtyanBirthday'
  | 'Cake'
  | 'Mailbox'
  | 'LoveLetter'
  | 'key'
  | 'UtyanDisappear'
  | 'hand_stop'
;

export class LottieLoader {
  private loadPromise: Promise<void>;
  private loaded = false;

  private players: {[reqId: number]: LottiePlayer} = {};
  private playersByCacheName: {[cacheName: string]: Set<LottiePlayer>} = {};

  private log = logger('LOTTIE', LogTypes.Error);

  constructor() {
    // worker-clock (free-run) события — в legacy-режиме этапа 1 не срабатывают,
    // но обработчики держим 1:1: при включении offscreen (этап 2) они уже на месте.
    lottieMessagePort.addEventListener('freeRunStopped', ({reqId, curFrame, error}) => {
      this.players[reqId]?.onFreeRunStopped(curFrame, error);
    });

    lottieMessagePort.addEventListener('freeRunEnded', ({reqId, curFrame}) => {
      this.players[reqId]?.onFreeRunEnded(curFrame);
    });
  }

  public getAnimation(element: HTMLElement) {
    for(const i in this.players) {
      if(this.players[i].el.includes(element)) {
        return this.players[i];
      }
    }

    return null;
  }

  public nudgeOffscreenPlayers() {
    for(const reqId in this.players) {
      this.players[reqId].nudgePresent();
    }
  }

  // a transferred placeholder canvas loses its displayed frame on a DOM move
  // (detach+reattach) - re-present every offscreen player inside the moved root
  public nudgePresentWithin(root: HTMLElement) {
    for(const reqId in this.players) {
      const player = this.players[reqId];
      if(player.el?.some((el) => el && root.contains(el))) {
        player.nudgePresent();
      }
    }
  }

  public loadLottieWorkers() {
    if(!IS_WEB_ASSEMBLY_SIMD_SUPPORTED) {
      // This method is also used as a fire-and-forget preload. Unsupported
      // browsers should stay on their static fallback without an unhandled
      // rejection; actual animation loads still reject with NO_WASM below.
      return Promise.resolve();
    }

    if(this.loadPromise) {
      return this.loadPromise;
    }

    return this.loadPromise = this.registerLottieWorkers();
  }

  private async registerLottieWorkers() {
    // Одноворкерная схема (без пула/SharedWorker/MTProto-прокси tweb): dedicated
    // Worker цепляем напрямую к lottieMessagePort. Воркер при коннекте шлёт приватный
    // MessageChannel событием 'port' (механизм пула вкладок) — нам он не нужен,
    // глушим обработчиком, оставаясь на прямом канале UI↔worker.
    const worker = new Worker(
      new URL('./tlottie.worker.ts', import.meta.url),
      {type: 'module'}
    );
    worker.addEventListener('error', (err) => this.log.error('lottie worker error', err));
    lottieMessagePort.addEventListener('port', () => {});
    lottieMessagePort.attachPort(worker as unknown as MessageEventSource);
    this.loaded = true;
  }

  public makeAssetUrl(name: LottieAssetName) {
    return 'assets/tgs/' + name + '.json';
  }

  public loadAnimationAsAsset(params: Omit<LottieOptions, 'animationData' | 'name'>, name: LottieAssetName) {
    // (params as LottieOptions).name = name;
    return this.loadAnimationFromURL(params, this.makeAssetUrl(name));
  }

  public loadAnimationDataFromURL(url: string, method: 'json'): Promise<any>;
  public loadAnimationDataFromURL(url: string, method?: 'blob'): Promise<Blob>;
  public loadAnimationDataFromURL(url: string, method: 'json' | 'blob' = 'blob'): Promise<Blob | any> {
    if(!IS_WEB_ASSEMBLY_SIMD_SUPPORTED) {
      return Promise.reject(makeError('NO_WASM'));
    }

    this.loadLottieWorkers().catch(noop);

    return fetch(url)
    .then((res) => {
      // .tgs приходит gzip'нутым (application/octet-stream) — распаковываем нативным
      // DecompressionStream (tweb делает это в crypto-воркере, нам хватает браузерного).
      if(!res.headers || res.headers.get('content-type') === 'application/octet-stream') {
        const decompressed = new Response(res.body!.pipeThrough(new DecompressionStream('gzip')));
        return method === 'json' ? decompressed.json() : decompressed.blob();
      } else {
        return res[method]();
      }
    });
  }

  public loadAnimationFromURLManually(name: LottieAssetName) {
    const url = this.makeAssetUrl(name);
    return this.loadAnimationDataFromURL(url).then((blob) => {
      return (params: Omit<LottieOptions, 'animationData'>) => this.loadAnimationFromURLNext(blob, params, url);
    });
  }

  public loadAnimationFromURL(params: Omit<LottieOptions, 'animationData'>, url: string) {
    return this.loadAnimationDataFromURL(url).then((blob) => {
      return this.loadAnimationFromURLNext(blob, params, url);
    });
  }

  public loadAnimationFromURLNext(blob: Blob, params: Omit<LottieOptions, 'animationData'>, url: string) {
    const newParams = Object.assign(params, {animationData: blob, needUpscale: true});
    newParams.name ||= url;
    return this.loadAnimationWorker(newParams);
  }

  public waitForFirstFrame(player: LottiePlayer) {
    if(player.hasFailed) {
      return Promise.reject(player.error);
    }

    const firstFrameOrError = Promise.race([
      new Promise<void>((resolve) => {
        player.addEventListener('firstFrame', resolve, {once: true});
      }),
      new Promise<void>((resolve, reject) => {
        player.addEventListener('error', reject, {once: true});
      }),
      pause(2500)
    ]);

    return Promise.all([player.loadPromise, firstFrameOrError]).then(() => player);
  }

  public async loadAnimationWorker(params: LottieOptions): Promise<LottiePlayer> {
    if(!IS_WEB_ASSEMBLY_SIMD_SUPPORTED) {
      throw makeError('NO_WASM');
    }

    if(!this.loaded) {
      await this.loadLottieWorkers();
    }

    const {middleware, group = ''} = params;
    if(middleware && !middleware()) {
      throw makeError('MIDDLEWARE');
    }

    if(params.sync) {
      const cacheName = LottiePlayer.CACHE.generateName(
        params.name,
        params.width,
        params.height,
        params.color,
        params.toneIndex
      );
      const players = this.playersByCacheName[cacheName];
      if(players?.size) {
        for(const player of players) {
          // a compositorDelivery request must match an 'emoji' player exactly, and a legacy sync
          // consumer must never adopt an offscreen 'canvas' player (its renderFrame2 never feeds
          // overrideRender - the consumer would stay permanently blank)
          if(params.compositorDelivery ? player.offscreen === 'emoji' : !player.offscreen) {
            return Promise.resolve(player);
          }
        }
        // delivery-mismatched players only - fall through and create a matching one
      }
    }

    const containers = toArray(params.container);
    if(!params.width || !params.height) {
      params.width = parseInt(containers[0].style.width);
      params.height = parseInt(containers[0].style.height);
    }

    if(!params.width || !params.height) {
      throw new Error('No size for sticker!');
    }

    params.group = group;

    const player = this.initPlayer(containers, params);

    animationIntersector.addAnimation({
      animation: player,
      group,
      observeElement: player.el[0],
      controlled: middleware,
      liteModeKey: params.liteModeKey,
      type: 'lottie'
    });

    if(!params.sync) {
      // * have to use onClean here, SuperStickerRenderer relies on it
      middleware?.onClean(() => {
        player.remove();
      });
    }

    return player;
  }

  public onDestroy(reqId: number) {
    delete this.players[reqId];
  }

  public destroyWorkers() {
    if(!IS_WEB_ASSEMBLY_SIMD_SUPPORTED) {
      return;
    }

    lottieMessagePort.terminateAll();

    this.log('workers destroyed');
    this.loaded = false;
    this.loadPromise = undefined;
  }

  private initPlayer(el: LottiePlayer['el'], options: LottieOptions) {
    const player = new LottiePlayer({
      el,
      options
    });

    let {reqId} = player;
    const {cacheName} = player;
    this.players[reqId] = player;

    const playersByCacheName = cacheName ? this.playersByCacheName[cacheName] ??= new Set() : undefined;
    if(cacheName) {
      playersByCacheName.add(player);
    }

    // an offscreen-load failure downgrades to legacy and mints a fresh reqId (lottiePlayer.loadFromData
    // fallback); re-key so freeRunStopped/freeRunEnded for the new id still reach this player
    player.addEventListener('reqIdChanged', ({previousReqId, reqId: newReqId}) => {
      delete this.players[previousReqId];
      this.players[newReqId] = player;
      reqId = newReqId;
    });

    player.addEventListener('destroy', () => {
      this.onDestroy(reqId);
      if(playersByCacheName.delete(player) && !playersByCacheName.size) {
        delete this.playersByCacheName[cacheName];
      }
    });

    player.addEventListener('error', (err) => {
      this.log.error('animation failed', err);
      player.remove();
    });

    const loadPromise = player.loadFromData(options.animationData, TLOTTIE_WASM_URL);
    player.loadPromise = loadPromise;
    loadPromise.catch((err: unknown) => player.fail(err));

    return player;
  }
}

const lottieLoader = new LottieLoader();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.lottieLoader = lottieLoader);
export default lottieLoader;