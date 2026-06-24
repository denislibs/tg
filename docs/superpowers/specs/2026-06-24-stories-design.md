# Stories — Design Spec

**Status:** Approved 2026-06-24. User: audience = chat partners by default **+ a per-story privacy setting the author chooses** (Everyone / Contacts / Selected).

**Goal:** Ephemeral stories — a user posts media (24h TTL); a stories row at the top of the chat list shows people (chat partners + self) with active stories; tapping opens a full-screen auto-advancing viewer; the author sees who viewed; per-story privacy (Everyone / Contacts / Selected allowlist). Reuses the media pipeline + the existing mock UI (`StoriesRow`/`StoriesStack`/`StoryViewer`, which mirror tweb).

## Data model (migration 0009)
- `stories(id bigserial, author_id bigint→users, media_id bigint→media, caption text, privacy text /* 'everyone'|'contacts'|'selected' */ default 'contacts', created_at timestamptz default now(), expires_at timestamptz not null)`. Index `(author_id, expires_at)`.
- `story_views(story_id bigint→stories ON DELETE CASCADE, viewer_id bigint→users, viewed_at default now(), PRIMARY KEY(story_id, viewer_id))`.
- `story_allow(story_id bigint→stories ON DELETE CASCADE, user_id bigint→users, PRIMARY KEY(story_id, user_id))` — allowlist for privacy='selected'.

## Visibility (feed scope)
The stories feed for viewer V = active (`expires_at > now`) stories whose author is **V or a chat partner of V** (reuse `ChatPartners`), further filtered by each story's privacy:
- own (author = V): always.
- partner story: show if `privacy IN ('everyone','contacts')`, OR `privacy='selected' AND V ∈ story_allow`.
(True global 'everyone' discovery for non-partners is out of scope; 'everyone' vs 'contacts' both show to partners in v1 — the meaningful restriction is 'selected'.)

## Backend (clean-arch; `internal/usecase/story` new package + `adapter/repo/postgres/storyrepo.go` + handler)
- `domain.Story{ID,AuthorID,MediaID,Caption,Privacy,CreatedAt,ExpiresAt}`, `StoryGroup{Author UserCard, Stories []StoryItem}` (StoryItem adds `Viewed bool`).
- `StoryRepo`: `Create(story, allowIDs)`, `ActiveFeed(viewerID, partnerIDs)` → grouped active stories visible to viewer (+viewed flag via story_views), `MarkViewed(storyID, viewerID)`, `Viewers(storyID)` → []UserCard, `Delete(storyID, authorID)`, `GetAuthor(storyID)`.
- `StoryService`: `Post(authorID, mediaID, caption, privacy, allowIDs)` (TTL 24h; validate media owned by author — reuse media access), `Feed(viewerID)` (resolve partners via a `ChatPartners` port → repo), `View(storyID, viewerID)` (visible check then MarkViewed), `Viewers(storyID, authorID)` (author-only), `Delete(storyID, authorID)`.

## API (REST; contracts/openapi)
- `POST /stories { media_id, caption?, privacy?, allow_user_ids?[] }` → `{ id }` (privacy default 'contacts').
- `GET /stories` → `{ groups: [ { author:{id,display_name,avatar_url}, stories:[ {id, media_id, caption, created_at, viewed} ] } ] }` (own group first).
- `POST /stories/{id}/view` → `{ ok }`.
- `GET /stories/{id}/viewers` → `{ viewers:[{id,display_name,avatar_url}], count }` (author-only → 403).
- `DELETE /stories/{id}` → `{ ok }` (author-only).
Media bytes via the existing `GET /media/{id}/content?token=` (worker builds URL).

## Frontend
- `StoriesManager` (worker): `feed()`, `post({mediaBytes,mime,caption,privacy,allowIds})` (reuse MediaManager.upload → media_id → POST /stories), `view(id)`, `viewers(id)`, `del(id)`.
- `StoriesRow`/`StoriesStack` (reuse): render real feed (avatars with a ring = has unseen). "My Story" + a "+" → add-story flow: pick file (reuse media attach) → preview + caption + **privacy chooser** (Все/Контакты/Выбранные → for Selected, pick from contacts) → post → refresh feed.
- `StoryViewer` (reuse): real media (`content?token`) + caption, auto-advance + progress bars across an author's stories, mark `view` on show; for own stories show a "viewers (N)" affordance → list.
- Stories load when authed (alongside loadChats); a lightweight store.

## Out of scope
Global 'everyone' discovery beyond partners; story replies/reactions; close-friends as a persisted user-level list (we use per-story allowlist); story editing; highlights/archive; video story trimming.

## Plans
- **St-1 (backend):** migration 0009, domain + StoryRepo + StoryService (visibility/privacy/views/viewers), HTTP, contracts, merge + smoke.
- **St-2 (frontend):** StoriesManager + store; real StoriesRow feed; add-story flow (file+caption+privacy); StoryViewer real (media/auto-advance/mark-viewed/viewers); live verify + merge.

## Self-review
- Per-story privacy (Everyone/Contacts/Selected) satisfies the user's "author chooses audience"; default contacts. Reuses media + ChatPartners + mock UI. Views/viewers via story_views. 24h TTL filtered on read. ✓
