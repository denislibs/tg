# Stories — Plan St-2: Frontend

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-stories-design.md`. Backend St-1 merged.

**Goal:** Real stories on the frontend — feed row (chat partners + self with active stories), add-story (file + caption + privacy), full-screen viewer (media + auto-advance + progress + mark-viewed + viewers list for own). Reuse mock `StoriesRow`/`StoriesStack`/`StoryViewer` (mirror tweb); wire to real data.

**UI mandate:** reuse existing components/markup/animations; no invention.

**Backend ready (St-1):** `POST /stories {media_id,caption?,privacy?,allow_user_ids?}`→`{id}`; `GET /stories`→`{groups:[{author:{id,display_name,avatar_url}, stories:[{id,media_id,caption,created_at,viewed}]}]}` (own group first); `POST /stories/{id}/view`; `GET /stories/{id}/viewers`→`{viewers:[{id,display_name,avatar_url}],count}` (author-only 403); `DELETE /stories/{id}`. Media via worker `managers.media.upload` + `managers.media.contentUrl(id)`.

**Verified frontend:** `StoriesRow`/`StoriesStack` use a module mock `STORIES` const + `onOpen(index)`/`progress`; `StoryViewer({index,onClose})` uses `STORIES` internally; `Sidebar` renders them with `storyIndex` state. `MediaManager.upload`/`contentUrl`, `peersManager`, `startClient`, zustand stores pattern (`chatsStore`). Branch `frontend-slice11-stories`.

---

## Task St2-1: StoriesManager + store

**Files:** create `src/core/managers/storiesManager.ts` (+ test), `src/stores/storiesStore.ts` (+ test); modify `src/core/worker.ts`, `src/client/bootstrap.ts`, `src/App.tsx` (load on auth).

- [ ] **Step 1: Branch** `cd telegram-ui-clone && git checkout master && git checkout -b frontend-slice11-stories`.
- [ ] **Step 2: StoriesManager** — `src/core/managers/storiesManager.ts`:
```ts
import type { RestClient } from '../net/restClient'
export interface StoryItem { id: number; mediaId: number; caption: string; createdAt: string; viewed: boolean }
export interface StoryGroup { author: { id: number; displayName: string; avatarUrl: string }; stories: StoryItem[] }
export function newStoriesManager({ rest }: { rest: Pick<RestClient,'get'|'post'|'del'> }) {
  return {
    async feed(): Promise<StoryGroup[]> {
      const r = await rest.get<{ groups: { author:{id:number;display_name:string;avatar_url:string}; stories:{id:number;media_id:number;caption:string;created_at:string;viewed:boolean}[] }[] }>('/stories')
      return (r.groups ?? []).map(g => ({ author: { id:g.author.id, displayName:g.author.display_name, avatarUrl:g.author.avatar_url }, stories: g.stories.map(s => ({ id:s.id, mediaId:s.media_id, caption:s.caption, createdAt:s.created_at, viewed:s.viewed })) }))
    },
    async post(args: { mediaId: number; caption?: string; privacy?: 'everyone'|'contacts'|'selected'; allowIds?: number[] }): Promise<number> {
      const r = await rest.post<{id:number}>('/stories', { media_id: args.mediaId, caption: args.caption ?? '', privacy: args.privacy ?? 'contacts', allow_user_ids: args.allowIds ?? [] }); return r.id
    },
    async view(id: number): Promise<void> { await rest.post(`/stories/${id}/view`, {}) },
    async viewers(id: number): Promise<{ id:number; displayName:string; avatarUrl:string }[]> {
      const r = await rest.get<{viewers:{id:number;display_name:string;avatar_url:string}[]}>(`/stories/${id}/viewers`); return (r.viewers??[]).map(v=>({id:v.id,displayName:v.display_name,avatarUrl:v.avatar_url}))
    },
    async del(id: number): Promise<void> { await rest.del(`/stories/${id}`) },
  }
}
export type StoriesManager = ReturnType<typeof newStoriesManager>
```
- [ ] **Step 3: store** — `src/stores/storiesStore.ts`: zustand `{ groups: StoryGroup[], loaded: boolean, setGroups }` + free `loadStories(managers)` = `managers.stories.feed()` → setGroups. Test: loadStories populates; setGroups marks loaded.
- [ ] **Step 4: worker + Managers** — register `stories`; add to `Managers`:
```ts
  stories: {
    feed(): Promise<StoryGroup[]>
    post(args: { mediaId: number; caption?: string; privacy?: 'everyone'|'contacts'|'selected'; allowIds?: number[] }): Promise<number>
    view(id: number): Promise<void>
    viewers(id: number): Promise<{ id:number; displayName:string; avatarUrl:string }[]>
    del(id: number): Promise<void>
  }
```
- [ ] **Step 5: load on auth** — in `App.tsx` Shell effect (after loadChats), add `void loadStories(startClient().managers)`.
- [ ] **Step 6: tests + commit** — `npx vitest run src/core/managers/storiesManager.test.ts src/stores/storiesStore.test.ts && npx tsc -b`; commit `feat(stories): StoriesManager + store + load on auth`.

---

## Task St2-2: real StoriesRow feed + add-story flow

**Files:** modify `src/components/StoriesRow.tsx`, `src/components/Sidebar.tsx`.

UI mandate: reuse the existing StoriesRow/StoriesStack avatar markup + the ring/animation. Only swap the data source + add the add-story action.

- [ ] **Step 1: Real feed** — StoriesRow/StoriesStack read the real feed from `useStoriesStore` (instead of the module `STORIES` const). Map each group → an avatar item: `{ id: author.id, name: author.displayName, avatarText: name[0], hasUnseen: stories.some(s=>!s.viewed), isMe }`. Keep the existing avatar+ring markup (ring/gradient when hasUnseen). `onOpen(index)` passes the group index. Keep the `progress` collapse behavior. (If avatar image is needed, the row already uses gradient/text avatars — keep that; story media is shown in the viewer.)
- [ ] **Step 2: "My Story" + add** — the first item is "My Story" (self). If the current user has no active story, show the "+" add affordance; clicking → a hidden `<input type=file accept=image/*,video/*>` → on pick: read arrayBuffer + (image dims) → `managers.media.upload(...)` → open a small caption+privacy sheet (reuse existing modal/sheet style from the app, e.g. the add-member modal pattern) with a privacy selector (Все/Контакты/Выбранные) → `managers.stories.post({mediaId,caption,privacy,allowIds})` → `loadStories` refresh. For "Выбранные" pick from contacts (chatsStore private peers) — minimal list. Keep it simple but functional.
- [ ] **Step 3: tsc/tests/build + commit** — `npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`; commit `feat(stories): real feed row + add-story (file+caption+privacy)`.

---

## Task St2-3: real StoryViewer + verify + merge

**Files:** modify `src/components/StoryViewer.tsx`, `src/components/Sidebar.tsx`; memory.

- [ ] **Step 1: Real viewer** — StoryViewer props → `{ groupIndex, onClose }` (or pass the selected group's stories). Read the feed from `useStoriesStore`; show the selected author's stories in sequence: media via `await managers.media.contentUrl(mediaId)` (`<img>`/`<video>`), caption, the existing progress-bar/auto-advance animation (reuse). On each story shown → `managers.stories.view(storyId)` (and mark viewed in store). Advancing past the last → onClose (or next author). For the viewer's OWN stories, show a "Просмотры (N)" affordance → `managers.stories.viewers(id)` list (reuse a simple list/sheet). Keep the existing overlay markup + keyboard (Esc) + tap-to-advance.
- [ ] **Step 2: Sidebar wiring** — `storyIndex` now indexes the real groups; pass `groupIndex` to StoryViewer. After closing, `loadStories` to refresh seen-rings.
- [ ] **Step 3: Rebuild + live verify (playwright)** — rebuild client+nginx. As A: stories row shows (self "My Story" + the "+"); add a story (pick image, caption, privacy Контакты) → posts. As A↔B partner: B's feed shows A's story with an unseen ring; open viewer → media + caption render; mark viewed; A opens own story → "Просмотры" shows B after B viewed (seed via API if needed). 0 console errors. Screenshot.
- [ ] **Step 4: Memory + merge** — note St-2 done → stories feature COMPLETE. Merge `frontend-slice11-stories` → master.

## Self-review
- Reuses StoriesRow/StoriesStack/StoryViewer (mirror tweb) on real data; add-story reuses media upload + a privacy chooser (satisfies the per-story audience setting); viewer marks views + shows viewers for own. Feed = partners+self (backend scope). ✓
