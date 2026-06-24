# Discussions — Plan Disc-2: Frontend

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-discussions-design.md`. Backend Disc-1 merged.

**Goal:** Channel admin enables discussions; each channel post shows a "Комментарии (N)" bar; tapping opens a thread (real comment list + composer + live). Reuse mock `CommentsBar`/`DiscussionView` (mirror tweb) on real data.

**UI mandate:** reuse existing components; no invented markup/animations.

**Backend ready (Disc-1):** `POST /channels/{id}/discussion`→`{discussion_chat_id}`; `POST /channels/{id}/posts/{postId}/comments {text,client_msg_id}`→`<Message>`; `GET /channels/{id}/posts/{postId}/comments?offset&limit`→`{messages,count}`; `GET /channels/{id}/comment_counts?ids=`→`{counts:{}}`. Comments are discussion-group messages (live via existing `rt:new_message` to discussion-group members, carrying `thread_root_id`). `Message`/new_message JSON now includes `thread_root_id`.

**Verified frontend:** channels render as message bubbles in `ConversationView` (channel mode: `isChannel`, admin composer); `CommentsBar({onOpen})`; `DiscussionView({post,onBack})` uses MOCK_COMMENTS internally; `GroupsManager.card` does NOT return discussion_chat_id; `models.mapMessage` does not map thread_root_id; `UserInfoPanel` has the admin sections (C-5/D2). Branch `frontend-slice10-discussions`.

---

## Task Disc2-1: backend card exposes discussion_chat_id (micro)

**Files (backend):** `internal/adapter/repo/postgres/grouprepo.go` (Card query), `internal/domain/chat.go` (ChatCard), `internal/adapter/delivery/http/group_handler.go` (Card JSON). Branch `disc-card`.

- [ ] Card SQL: add `c.discussion_chat_id` (COALESCE(...,0)) to the SELECT + scan into `domain.ChatCard.DiscussionChatID int64` (new field). Card handler JSON: add `"discussion_chat_id": c.DiscussionChatID`.
- [ ] Quick test (grouprepo Card test or http): a channel with discussion enabled → Card.DiscussionChatID != 0; without → 0.
- [ ] `cd backend && go build ./... && go test ./internal/adapter/repo/postgres/ ./internal/adapter/delivery/http/ -run 'Card|Group|Channel'`; commit; `git checkout master && git merge --no-ff disc-card -m "feat(chat): card exposes discussion_chat_id"`. Rebuild verify backend.

---

## Task Disc2-2: frontend channelsManager comments + thread_root_id

**Files:** `src/core/managers/channelsManager.ts` (+ test), `src/core/models.ts` (+ test), `src/core/managers/groupsManager.ts`, `src/client/bootstrap.ts`. Branch `frontend-slice10-discussions`.

- [ ] **models.ts:** `RawMessage`/`Message` += `thread_root_id`/`threadRootId?: number | null`; map in `mapMessage` (`threadRootId: r.thread_root_id ?? null`). Update mapMessage test.
- [ ] **groupsManager.card:** add `discussionChatId` to GroupCard + map `discussion_chat_id`→`discussionChatId`. (Managers type already references GroupCard.)
- [ ] **channelsManager:** add
```ts
async enableDiscussion(channelId: number): Promise<number> { const r = await rest.post<{discussion_chat_id:number}>(`/channels/${channelId}/discussion`, {}); return r.discussion_chat_id },
async postComment(channelId: number, postId: number, text: string, clientMsgId: string): Promise<Message> { const r = await rest.post<RawMessage>(`/channels/${channelId}/posts/${postId}/comments`, { text, client_msg_id: clientMsgId }); return mapMessage(r) },
async listComments(channelId: number, postId: number, offset = 0, limit = 50): Promise<{ messages: Message[]; count: number }> { const r = await rest.get<{messages:RawMessage[];count:number}>(`/channels/${channelId}/posts/${postId}/comments`, { offset, limit }); return { messages: (r.messages??[]).map(mapMessage), count: r.count } },
async commentCounts(channelId: number, postIds: number[]): Promise<Record<number, number>> { if(!postIds.length) return {}; const r = await rest.get<{counts:Record<string,number>}>(`/channels/${channelId}/comment_counts`, { ids: postIds.join(',') }); const out:Record<number,number>={}; for(const k in r.counts) out[+k]=r.counts[k]; return out },
```
+ add the 4 methods to `Managers.channels` in bootstrap.ts.
- [ ] Tests (channelsManager.test.ts): enableDiscussion POST→number; postComment POST→mapped Message (thread_root_id mapped); listComments maps; commentCounts maps string keys→number. 
- [ ] `npx vitest run src/core/managers/channelsManager.test.ts src/core/models.test.ts && npx tsc -b`; commit `feat(discussions): channelsManager comment methods + thread_root_id`.

---

## Task Disc2-3: channel admin toggle + per-post comments bar + DiscussionView

**Files:** `src/components/UserInfoPanel.tsx`, `src/components/ConversationView.tsx`, `src/components/DiscussionView.tsx`, `src/components/CommentsBar.tsx`.

- [ ] **Admin toggle** (UserInfoPanel, channel + admin gate CHANGE_INFO=64/creator): an "Обсуждения" row — if `card.discussionChatId` is 0/undefined, a "Включить обсуждения" button → `managers.channels.enableDiscussion(numericId)` → set local state enabled; else show "Обсуждения включены". Reuse the panel row/section markup.
- [ ] **Per-post comments bar** (ConversationView channel mode): when the channel has discussions (fetch via the existing `card` state → `discussionChatId>0`), under each out/post bubble render `CommentsBar` with the post's comment count (from a `commentCounts` fetch over the loaded post ids; refetch on msgs change, debounced). Extend `CommentsBar` to accept an optional `count` prop (show "Комментарии" + count; reuse its existing markup). Clicking opens a DiscussionView overlay for that post id.
  > Keep it minimal: render the bar only for real channel posts when discussions enabled. The post id = the message's backend id (win.msgs[i].id).
- [ ] **DiscussionView real data** — extend `DiscussionView` props to accept `channelId`, `postId`, and a `post` summary; replace MOCK_COMMENTS with: on open `managers.channels.listComments(channelId, postId)` → render comments (sender names via peersManager; reuse the existing comment row markup); a composer → `managers.channels.postComment(channelId, postId, text, clientMsgId)` (optimistic append); live: subscribe `uiEvents` RT.newMessage where `payload.chat_id === discussionChatId && payload.thread_root_id === postId` → append. (Need discussionChatId — from the channel card; pass it in.) Keep the existing overlay markup/animation.
- [ ] `npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`; commit `feat(discussions): admin toggle + per-post comments bar + real DiscussionView thread`.

---

## Task Disc2-4: live verify + memory + merge

- [ ] Rebuild client+nginx. As A (channel admin): open channel info → "Включить обсуждения". Open the channel → a post shows "Комментарии (0)" bar → click → DiscussionView opens. Type a comment → appears; count → 1. Via API as B: post a comment on the same post → appears live in the open thread (discussion-group new_message filtered by thread_root_id) + count bumps. 0 console errors. Screenshot.
- [ ] Memory: Disc-2 done → discussions feature COMPLETE. Merge `frontend-slice10-discussions` → master.

## Self-review
- Reuses CommentsBar/DiscussionView (mirror tweb) on real data; comments ride the discussion-group realtime path (live via thread_root_id filter); admin toggle gated CHANGE_INFO. card discussion_chat_id added so the client knows enabled. thread_root_id mapped in models for the live filter. ✓
