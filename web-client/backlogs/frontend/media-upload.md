# Media: upload, bubbles, albums, viewer (1:1 tweb)

Goal: send/receive photos, videos, music, files; group photos/videos into albums;
reply/forward on media; send "as file" (no compression) for download OR compressed
(backend transcode for video, resize for photo); a media viewer (lightbox) with the
zoom-open animation and arrow navigation through all chat photos/videos.

All markup/layout/animation taken 1:1 from tweb. Paths below are absolute in
`/Users/denisurevic/Documents/tweb`.

## What already exists (reuse, don't rebuild)
- Backend blob store: `backend/internal/adapter/storage/minio/client.go`; media usecase
  `backend/internal/usecase/media/media.go`; endpoints in `.../delivery/http/router.go`
  (`POST /media/upload`, `PUT/GET /media/{id}/content`, `GET /media/{id}`, media tokens).
  Domain `backend/internal/domain/media.go` already has mime/size/width/height/duration/blurPreview.
- `messages.media_id` FK (migration `0004_media.sql`), `domain.Message.{Type,MediaID}`.
- Frontend: `src/core/managers/mediaManager.ts` (upload/meta/contentUrl);
  `src/components/messages/{VoiceMessage,RealMediaBubble,DocumentBubble,AudioBubble,RoundVideoBubble}.tsx`;
  `ConvMsg` types already include photo/video/album/document/audio (`src/data.ts`);
  `waveform.ts` client decode. Voice end-to-end is the working template.

## Gaps to fill
1. `messageToConvMsg` only promotes `voice`; everything else → text. Need photo/video/document/audio.
2. No filename stored for documents (Media has no `file_name`).
3. AttachMenu is a stub; no send-media compose popup.
4. No album: no `grouped_id`, no layouter, no album bubble.
5. MediaViewer is a mock (gradient/emoji); no real content, no zoom animation, no nav.
6. No backend thumbnails/compression (no ffmpeg).
7. Forward must carry `media_id` (+ `grouped_id`); "Download" menu action must save original.

---

## Phase 1 — Single media: send + render (photo / video / file / music)

### Backend
- Migration: add `media.file_name TEXT` (documents/music show the real name). Optionally
  `media.kind` (photo|video|audio|voice|document) or derive from mime + a `as_file` flag.
- `CreateUpload` accepts `file_name`; `messageJSON`/media JSON returns it.
- `SendMessage` already takes `type`; ensure allowed: text|photo|video|audio|voice|document.
- Forward (`message_forward.go`): confirm it copies `media_id` (and later `grouped_id`).

### Frontend
- **Attach flow**: wire `AttachMenu` ("Фото или видео" → `accept=image/*,video/*`; "Файл" → any)
  to a hidden `<input type=file multiple>`. On pick → open **SendMediaPopup** (compose).
- **SendMediaPopup** (new) — port of tweb `src/components/popups/newMedia.ts` (PopupNewMedia):
  - title "Отправить N фото/видео/файлов" (`setTitle` newMedia.ts:1754).
  - preview(s) + caption input + Send button.
  - 3-dot menu: "Сжать (как медиа)" ↔ "Отправить как файл" (`changeType` newMedia.ts:743),
    and (Phase 3) "Сгруппировать/Разгруппировать" (`changeGroup` :752).
  - single image preview sizing via `calcImageInBox` (we already have `core/dom/calcImageInBox.ts`).
  - scss ref: `src/scss/partials/popups/_mediaAttacher.scss`.
- **Send**: per file → `media.upload({bytes,mime,size,width,height,duration,fileName})`,
  optimistic `appendOptimistic(caption, me, clientId, mediaId, type)`, `realtime.sendMessage({type,...})`.
  Compress=photo path may downscale client-side (canvas) until backend transcode lands (Phase 4).
- **Type promotion** in `messageToConvMsg`: map server `type` → ConvMsg type; for `document`
  pass `{name,size,ext}`, for `audio` pass `{title,artist,duration}` from media meta + file_name.
- **Bubble styling 1:1** (bring existing stubs to pixel-accuracy):
  - Photo: tweb `src/components/wrappers/photo.ts` (`wrapPhoto`), classes `.media-photo`,
    `.media-container[-aspecter]` in `base.scss:1248-1290`; blur LQIP placeholder; time/ticks
    overlay; sizing from `src/helpers/mediaSizes.ts` (regular 420×400 desktop / 340 mobile).
  - Video: `src/components/wrappers/video.ts` (`wrapVideo`) — poster + `.video-play` btn +
    `.video-time` (duration/size badge), `base.scss:1294-1367`.
  - Document/file: `src/components/wrappers/document.ts` (`wrapDocument`) + `_document.scss`
    (`.document` 70px row, `.document-ico` ext color/fold, `.document-name/-size`, download ring).
  - Music: `src/components/audio.ts` (`AudioElement`) + `_audio.scss` (play/pause circle,
    title/performer, `MediaProgressLine` seekbar, duration). Distinct from voice (waveform).
  - Caption + time placement: `_chatBubble.scss` `.bubble.is-album`, `.bubble-first` (time on
    last text element; overlay on media when no caption).

**Ship 1**: pick a photo/video/file/mp3 → compose popup → send → renders as the right bubble;
reply & forward work on it; "Download" menu item saves the original.

---

## Phase 2 — Media viewer (lightbox)

Replace mock `src/components/MediaViewer.tsx` with the real one.
- tweb refs: `src/components/appMediaViewer.ts`, `appMediaViewerBase.ts`, `_mediaViewer.scss`.
- **Open/zoom animation** (the signature effect) — port `setMoverToTarget`
  (appMediaViewerBase.ts:1167-1802): FLIP — start the mover at the thumbnail's rect with
  `translate3d(left,top,0) scale3d(rect.w/full.w, rect.h/full.h,1)` + clip-path inset matching
  the thumbnail's rounded rect, then `doubleRaf`, then animate to
  `translate3d(centerLeft,centerTop,0) scale3d(1,1,1)` + `clip-path: inset(0 round 0)`.
  Durations: `OPEN_TRANSITION_TIME=200`, `MOVE_TRANSITION_TIME=350` (:83). CSS vars
  `--open-duration/--move-duration` (`_mediaViewer.scss:376-384,538`).
- Structure: `.media-viewer-whole > topbar(author+date+download/forward/delete/zoom/close) +
  movers(prev/next switchers + mover) + caption`.
- **Arrow navigation through all chat media**: tweb uses `SearchListLoader`
  (`src/helpers/searchListLoader.ts`) with `inputFilter: photoVideo`. We need a backend list:
  **add `GET /chats/{id}/media?type=photo,video&before=<seq>&limit=`** (new repo query
  `WHERE chat_id=? AND type IN (...) AND deleted_at IS NULL ORDER BY seq DESC`). Frontend
  `messagesManager.listMedia` + a viewer-side loader (prev/next + preload neighbors).
  Buttons `.media-viewer-switcher-left/right`, `listLoader.go(±1)` (appMediaViewerBase.ts:457).
- Video playback in viewer (reuse our audio/video; controls).

**Ship 2**: click a photo → zooms open from its place; ←/→ pages through every photo/video in the chat; close zooms back.

---

## Phase 3 — Albums (grouped photos/videos)

### Backend
- Migration: `messages.grouped_id BIGINT NULL` (+ index). Sending N compressed media in one
  popup action creates N messages sharing one `grouped_id` (client-generated or server).
- History/forward/delete carry `grouped_id`; forwarding an album re-groups under a new id.

### Frontend
- Port the layouter: tweb `src/components/groupedLayout.ts` (`Layouter`/`ComplexLayouter`,
  the Telegram-desktop algorithm) → `src/core/dom/groupedLayout.ts`. Plus `prepareAlbum.ts`
  (absolute %-positioned items, `RectPart` border-radius `calc(radius - spacing)`, 1px spacing).
- Album bubble: `src/components/wrappers/album.ts` (`wrapAlbum`) → `<AlbumBubble>`; classes
  `.album-item`, `.album-item-media` (`base.scss:1173`), `.bubble.is-album` (`_chatBubble.scss:882`).
- Window/grouping: in the message window, fold consecutive same-`grouped_id` messages into one
  ConvMsg `album` with `MediaItem[]`. Caption = the group's caption message.
- Reply targets the album; clicking an album item opens the viewer at that index.

**Ship 3**: select multiple photos → grouped mosaic exactly like the screenshots; reply/forward/viewer work on albums.

---

## Phase 4 — Backend compression + thumbnails (ffmpeg)

Heaviest; can land last. Today width/height/blur are client-provided and the full file is served.
- Add `ffmpeg` to the backend image; pipeline on upload (sync small / async large):
  - Photo: downscale to max ~1280px, re-encode JPEG (quality), store compressed variant + keep original.
  - Video: transcode H.264 mp4 capped resolution/bitrate (+ `supportsStreaming`), generate poster.
  - Generate server-side thumbnail/LQIP (replace client blur).
- Media GET returns variant URLs (`thumb`, `compressed`, `original`); bubbles use thumb→compressed,
  "Send as file"/Download uses original. Voice already fine.
- tweb parallels: it relies on Telegram's server sizes/`supportsStreaming`; we emulate with variants.

---

## Decisions (confirmed)
- **Start with Phase 1** (send + bubbles), then 2 (viewer) → 3 (albums).
- **Compression: full ffmpeg on the backend from the start** — so Phase 4's pipeline is pulled
  into Phase 1. Backend generates a server thumbnail/poster + a compressed variant; "as file"
  serves the original. (Merged plan below.)
- **grouped_id**: TBD when we reach Phase 3 (lean client-generated, like clientMsgId).

## Phase 1 backend pipeline (ffmpeg) — build order
1. Dockerfile: install `ffmpeg` (gives `ffmpeg` + `ffprobe`) in the runtime stage.
2. Migration `0012_media_variants.sql`: `media.file_name TEXT`, `media.thumb_key TEXT`
   (poster/thumbnail jpeg). Server fills width/height/duration via ffprobe (more reliable
   than client values).
3. `domain.Media`: `FileName`, `ThumbKey`. Repo `Create`/`GetByID` include them; add
   `UpdateProcessed(id, width,height,duration,thumbKey)`.
4. New `internal/adapter/media/ffmpeg` processor (port `MediaProcessor`): given the original
   object, `ffprobe` for dims/duration, `ffmpeg` to make a thumbnail (image: downscale jpeg;
   video: poster frame). Reads original via `GetObject`, writes thumb via `PutObject`.
   (Video transcode H.264 can be a follow-up within the same package.)
5. Wire processing after `PutContent` (goroutine, non-blocking); update the row when done.
6. Handler: `CreateUpload` accepts `file_name`; `Get` returns `file_name`, `thumb_url`, dims.
7. fx: provide the processor to the media usecase.

## Out of scope (from the attach menu): Опрос / Список / Кошелёк.
