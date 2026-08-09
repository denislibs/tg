// Порт tweb `components/animationIntersector.ts`.
//
// Единая точка «что сейчас можно играть». Все анимации (lottie-стикеры,
// видео-стикеры, гифки, будущие точки-индикаторы) регистрируются здесь и
// наблюдаются ОДНИМ IntersectionObserver'ом вместо своего IO на каждый элемент.
// Он решает за них play/pause по четырём причинам:
//   • элемент уехал из вьюпорта (основной случай — лента чата, пикер);
//   • вкладка ушла в фон (`visibilitychange`);
//   • идёт тяжёлая анимация (см. `core/dom/heavyAnimation.ts`);
//   • группа заблокирована (`onlyOnePlayableGroup` — поверх открыт вьюер
//     стикера/попап, играет только он).
//
// Отличия от tweb (всё остальное — 1:1):
//   • нет `getAppWindow`/`onAppWindowChange` (Document PiP, куда tweb переносит
//     весь DOM и пересоздаёт наблюдателя) — у нас такого механизма нет;
//   • `idleController` (blur/focus/mousemove окна) заменён на `visibilitychange`:
//     из его API здесь нужен ровно признак «вкладку не видно», а `overrideIdleGroups`
//     некому звать — выкинут;
//   • сам наблюдатель создаётся ЛЕНИВО, на первой регистрации: в jsdom/happy-dom
//     `IntersectionObserver` появляется только после стаба в тесте, а модуль —
//     синглтон и импортируется раньше;
//   • подписка на heavy-animation живёт прямо здесь (в tweb это делает
//     `appImManager.ts:336-342`, у нас такого «менеджера всего» нет).
import type {LiteModeKey} from '@helpers/liteMode';
import type LottiePlayer from '@lib/lottie/lottiePlayer';
import type {Middleware} from '@helpers/middleware';
import {MOUNT_CLASS_TO} from '@config/debug';
import indexOfAndSplice from '@helpers/array/indexOfAndSplice';
import {fastRaf} from '@helpers/schedulers';
import {useSettingsStore} from '@/settings';
import {onHeavyAnimation} from '@core/dom/heavyAnimation';

export type AnimationItemGroup = '' | 'none' | 'chat' | 'lock' |
  'STICKERS-POPUP' | 'emoticons-dropdown' | 'STICKERS-SEARCH' | 'GIFS-SEARCH' |
  `CHAT-MENU-REACTIONS-${number}` | 'INLINE-HELPER' | 'GENERAL-SETTINGS' | 'STICKER-VIEWER' | 'EMOJI' |
  'EMOJI-STATUS' | `chat-${number}` | 'PREMIUM-PROMO' | 'NEW-MEDIA' | 'BLUFF-SPOILER';

export type AnimationItemType = 'lottie' | 'dots' | 'video' | 'emoji';

export interface AnimationItemWrapper {
  remove: () => void;
  paused: boolean;
  pause: () => any;
  play: () => any;
  autoplay: boolean;
  _autoplay?: boolean;
  loop: boolean | number;
  _loop?: boolean | number;
  onPlaybackParamsMutated?: () => void;
}

export interface AnimationItem {
  el: HTMLElement,
  group: AnimationItemGroup,
  animation: AnimationItemWrapper,
  liteModeKey?: LiteModeKey,
  controlled?: boolean | Middleware,
  type: AnimationItemType,
  locked?: boolean
}

/** tweb `helpers/dom/isInDOM` */
function isInDOM(element: Element): boolean {
  return !!element?.isConnected;
}

/** tweb `helpers/array/forEachReverse` — обход с конца, чтобы splice по ходу не сбивал индексы */
function forEachReverse<T>(array: T[], callback: (value: T) => void) {
  for(let i = array.length - 1; i >= 0; --i) {
    callback(array[i]);
  }
}

/** tweb `helpers/dom/safePlay` — `play()` у <video> отдаёт промис, который может реджектнуться */
function safePlay(media: {play: () => unknown}) {
  try {
    const promise = media.play();
    if(promise instanceof Promise) {
      promise.catch(() => {});
    }
  } catch(e) {
    console.error(e);
  }
}

export class AnimationIntersector {
  private observer: IntersectionObserver | undefined;
  private onObserve: (entries: IntersectionObserverEntry[]) => void;
  private visible: Set<AnimationItem>;

  private byGroups: {[group in AnimationItemGroup]?: AnimationItem[]};
  private byPlayer: Map<AnimationItem['animation'], AnimationItem>;
  // Элемент → его AnimationItem'ы; держится в синхроне с byGroups/byPlayer, чтобы
  // колбэк наблюдателя резолвил target → item за O(1), а не сканом всех групп.
  private byElement: Map<HTMLElement, AnimationItem[]>;
  private lockedGroups: {[group in AnimationItemGroup]?: true};
  private onlyOnePlayableGroup: AnimationItemGroup;

  private intersectionLockedGroups: {[group in AnimationItemGroup]?: true};
  private idle: boolean;

  constructor() {
    this.onObserve = (entries) => {
      for(const entry of entries) {
        const target = entry.target as HTMLElement;

        const items = this.byElement.get(target);
        if(!items) {
          continue;
        }

        // Та же семантика, что у прежнего скана по группам: действуем на первом
        // item'е, чья группа не заблокирована по пересечению, и выходим.
        const animation = items.find((p) => !this.intersectionLockedGroups[p.group]);
        if(!animation) {
          continue;
        }

        if(entry.isIntersecting) {
          this.visible.add(animation);
          this.checkAnimation(animation, false);
        } else {
          this.visible.delete(animation);
          this.checkAnimation(animation, true);

          const _animation = animation.animation;
          if(animation.type === 'lottie' && (_animation as LottiePlayer).paused) {
            (_animation as LottiePlayer).clearCacheWhenSafe();
          }
        }
      }
    };

    this.visible = new Set();

    this.byGroups = {};
    this.byPlayer = new Map();
    this.byElement = new Map();
    this.lockedGroups = {};
    this.onlyOnePlayableGroup = '';

    this.intersectionLockedGroups = {};
    this.idle = false;

    // tweb глушит анимации, пока вкладка не видна (там это idleController по
    // blur/focus окна, см. шапку файла).
    if(typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.idle = document.hidden;
        this.checkAnimations2(this.idle);
      });
    }

    // tweb appImManager.ts:336-342 — на время тяжёлой анимации играет только
    // группа 'lock' (её ни у кого нет, то есть не играет ничто).
    onHeavyAnimation(() => {
      this.setOnlyOnePlayableGroup('lock');
      this.checkAnimations2(true);
    }, () => {
      this.setOnlyOnePlayableGroup();
      this.checkAnimations2(false);
    });
  }

  private getObserver(): IntersectionObserver | undefined {
    if(this.observer || typeof IntersectionObserver === 'undefined') {
      return this.observer;
    }

    return this.observer = new IntersectionObserver(this.onObserve);
  }

  public getAnimations(element: HTMLElement) {
    const items = this.byElement.get(element);
    // копия — прежний контракт tweb (свежий массив на каждый вызов)
    return items ? items.slice() : [];
  }

  public removeAnimation(player: AnimationItem) {
    const {el, animation} = player;
    if(player.controlled !== true && player.type !== 'video') {
      animation.remove();
    }

    const group = this.byGroups[player.group];
    if(group) {
      indexOfAndSplice(group, player);
      if(!group.length) {
        delete this.byGroups[player.group];
      }
    }

    const elementItems = this.byElement.get(el);
    if(elementItems) {
      indexOfAndSplice(elementItems, player);
      if(!elementItems.length) {
        this.byElement.delete(el);
      }
    }

    this.observer?.unobserve(el);
    this.visible.delete(player);
    this.byPlayer.delete(animation);
  }

  public removeAnimationByPlayer(player: AnimationItemWrapper) {
    const item = this.byPlayer.get(player);
    if(item) {
      this.removeAnimation(item);
    }
  }

  public isVisible(animation: AnimationItem['animation']) {
    const item = this.byPlayer.get(animation);
    return !!item && this.visible.has(item);
  }

  public addAnimation(options: {
    animation: AnimationItem['animation'],
    group?: AnimationItemGroup,
    observeElement: HTMLElement,
    controlled?: AnimationItem['controlled'],
    liteModeKey?: LiteModeKey,
    type: AnimationItemType,
    locked?: boolean
  }) {
    const {animation, group = '', observeElement, controlled, liteModeKey, type, locked} = options;
    if(group === 'none' || this.byPlayer.has(animation)) {
      return;
    }

    const item: AnimationItem = {
      el: observeElement,
      animation,
      group,
      controlled,
      liteModeKey,
      type,
      locked
    };

    if(controlled && typeof(controlled) !== 'boolean') {
      controlled.onClean(() => {
        this.removeAnimationByPlayer(animation);
      });
    }

    if(item.type === 'lottie') {
      // tweb: appSettings.stickers.loop; у нас та же настройка зовётся loopStickers
      const {loopStickers} = useSettingsStore.getState();
      if(!loopStickers && animation.loop) {
        animation.loop = loopStickers;
      }
    }

    (this.byGroups[group] ??= []).push(item);
    let elementItems = this.byElement.get(item.el);
    if(!elementItems) {
      this.byElement.set(item.el, elementItems = []);
    }
    elementItems.push(item);
    this.getObserver()?.observe(item.el);
    this.byPlayer.set(animation, item);
  }

  public checkAnimations(
    blurred?: boolean,
    group?: AnimationItemGroup,
    destroy?: boolean,
    imitateIntersection?: boolean,
    exceptGroup?: AnimationItemGroup
  ) {
    if(group !== undefined && !this.byGroups[group]) {
      return;
    }

    const groups = group !== undefined ? [group] : Object.keys(this.byGroups) as AnimationItemGroup[];

    for(const group of groups) {
      if(group === exceptGroup) {
        continue;
      }

      if(imitateIntersection && this.intersectionLockedGroups[group]) {
        continue;
      }

      const animations = this.byGroups[group];
      if(!animations) {
        continue;
      }

      forEachReverse(animations, (animation) => {
        this.checkAnimation(animation, blurred, destroy);
      });
    }
  }

  public checkAnimations2(blurred?: boolean, exceptGroup?: AnimationItemGroup) {
    this.checkAnimations(blurred, undefined, undefined, true, exceptGroup);
  }

  public checkAnimation(player: AnimationItem, blurred?: boolean, destroy?: boolean) {
    const {el, animation, group, locked} = player;
    if(locked) {
      return;
    }

    if(destroy || (!this.lockedGroups[group] && !isInDOM(el))) {
      if(!player.controlled || destroy) {
        this.removeAnimation(player);
      }

      return;
    }

    if(
      blurred ||
      (this.onlyOnePlayableGroup && this.onlyOnePlayableGroup !== group)
    ) {
      if(!animation.paused) {
        animation.pause();
      }
    } else if(
      animation.paused &&
      this.visible.has(player) &&
      animation.autoplay &&
      (!this.onlyOnePlayableGroup || this.onlyOnePlayableGroup === group) &&
      !this.idle
    ) {
      safePlay(animation);
    }
  }

  public getOnlyOnePlayableGroup() {
    return this.onlyOnePlayableGroup;
  }

  public setOnlyOnePlayableGroup(group: AnimationItemGroup = '') {
    this.onlyOnePlayableGroup = group;
  }

  public lockGroup(group: AnimationItemGroup) {
    this.lockedGroups[group] = true;
  }

  public unlockGroup(group: AnimationItemGroup) {
    delete this.lockedGroups[group];
    this.checkAnimations(undefined, group);
  }

  public refreshGroup(group: AnimationItemGroup) {
    const animations = this.byGroups[group];
    if(!animations?.length) {
      return;
    }

    animations.forEach((animation) => {
      this.observer?.unobserve(animation.el);
    });

    fastRaf(() => {
      animations.forEach((animation) => {
        this.getObserver()?.observe(animation.el);
      });
    });
  }

  public lockIntersectionGroup(group: AnimationItemGroup) {
    this.intersectionLockedGroups[group] = true;
  }

  public unlockIntersectionGroup(group: AnimationItemGroup) {
    delete this.intersectionLockedGroups[group];
    this.refreshGroup(group);
  }

  public toggleIntersectionGroup(group: AnimationItemGroup, lock: boolean) {
    if(lock) this.lockIntersectionGroup(group);
    else this.unlockIntersectionGroup(group);
  }

  /** tweb: пересчёт autoplay при смене настройки lite-mode для класса анимаций */
  public setAutoplay(play: boolean, liteModeKey: LiteModeKey) {
    const {loopStickers} = useSettingsStore.getState();
    let changed = false;
    this.byPlayer.forEach((animationItem, animation) => {
      if(animationItem.liteModeKey === liteModeKey) {
        changed = true;
        animation.autoplay = play ? !!animation._autoplay : false;
        animation.loop = play ? (loopStickers && animation._loop) || false : false;
        animation.onPlaybackParamsMutated?.();
      }
    });

    return changed;
  }

  /** tweb: пересчёт loop при смене настройки «зацикливать стикеры» */
  public setLoop(loop: boolean) {
    let changed = false;
    this.byPlayer.forEach((animationItem, animation) => {
      if(
        animation._loop &&
        animation.loop !== loop &&
        (animationItem.type === 'lottie' || animationItem.type === 'video')
      ) {
        changed = true;
        animation.loop = loop;
        animation.autoplay = !!animation._autoplay;
        animation.onPlaybackParamsMutated?.();
      }
    });

    return changed;
  }

  public toggleItemLock(animationItem: AnimationItem, lock: boolean) {
    animationItem.locked = lock;
  }
}

const animationIntersector = new AnimationIntersector();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.animationIntersector = animationIntersector);
export default animationIntersector;
