package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
)

// newStoryRouter builds a router wired with auth, chat, media, and story
// handlers over the test DB (media uses an in-memory storage so uploads work
// without MinIO).
func newStoryRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	chatUC := newChatUC(pool)
	authUC := newAuthUC(pool)
	mediaH := NewMediaHandler(usecasemedia.New(pgadapter.NewMediaRepo(pool), newFakeStorage(), nil), chatUC, authUC, "test-secret")
	storySvc := storyusecase.New(
		pgadapter.NewStoryRepo(pool),
		chatUC,
		pgadapter.NewMediaAccessRepo(pool),
		pgadapter.NewTxManager(pool),
	)
	storySvc.SetMessageSender(chatUC)
	storyH := NewStoryHandler(storySvc, chatUC)
	return NewRouter(authUC, chatUC, nil, mediaH, nil, nil, storyH, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil), pool
}

func TestStories_Lifecycle_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990000070")
	tokenB, idB := signUp(t, h, pool, "+79990000071")
	tokenC, _ := signUp(t, h, pool, "+79990000072")

	// A sets B as a close friend; GET reflects it.
	rec := authedReq(t, h, http.MethodPut, "/me/close_friends", tokenA, map[string]any{"user_ids": []int64{idB}})
	if rec.Code != http.StatusOK {
		t.Fatalf("set close_friends: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/me/close_friends", tokenA, nil)
	var cf struct {
		UserIDs []int64 `json:"user_ids"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cf)
	if len(cf.UserIDs) != 1 || cf.UserIDs[0] != idB {
		t.Fatalf("close_friends = %v; want [%d]", cf.UserIDs, idB)
	}

	// A uploads media and posts a "close" story.
	rec = authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "close story", "privacy": "close",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post close story: %d %s", rec.Code, rec.Body.String())
	}
	var posted struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &posted)

	// Close friend B can view; stranger C is forbidden from viewing and reacting.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/view", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("B view close story: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/view", tokenC, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C view close story: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/reaction", tokenC, map[string]any{"reaction": "👍"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C react close story: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// A edits the story: new caption + widen to everyone; payload shows edited=true.
	rec = authedReq(t, h, http.MethodPatch, "/stories/"+itoa(posted.ID), tokenA, map[string]any{
		"caption": "edited", "privacy": "everyone",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("edit story: %d %s", rec.Code, rec.Body.String())
	}
	// C (non-owner) cannot edit.
	rec = authedReq(t, h, http.MethodPatch, "/stories/"+itoa(posted.ID), tokenC, map[string]any{"caption": "hax"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C edit: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// A's own feed reflects edited=true, privacy=everyone, new caption.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenA, nil)
	var feed struct {
		Groups []struct {
			Stories []struct {
				ID      int64  `json:"id"`
				Caption string `json:"caption"`
				Privacy string `json:"privacy"`
				Pinned  bool   `json:"pinned"`
				Edited  bool   `json:"edited"`
			} `json:"stories"`
		} `json:"groups"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &feed)
	if len(feed.Groups) != 1 || len(feed.Groups[0].Stories) != 1 {
		t.Fatalf("A feed shape: %s", rec.Body.String())
	}
	st := feed.Groups[0].Stories[0]
	if !st.Edited || st.Privacy != "everyone" || st.Caption != "edited" {
		t.Fatalf("edited story payload = %+v", st)
	}

	// A pins the story; non-owner C cannot.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/pin", tokenA, map[string]any{"pinned": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("pin: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/pin", tokenC, map[string]any{"pinned": false})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C pin: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// Pinned list for A returns the story with pinned=true.
	rec = authedReq(t, h, http.MethodGet, "/stories/pinned?peer="+itoa(idA), tokenA, nil)
	var pinned struct {
		Stories []struct {
			ID     int64 `json:"id"`
			Pinned bool  `json:"pinned"`
		} `json:"stories"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &pinned)
	if len(pinned.Stories) != 1 || pinned.Stories[0].ID != posted.ID || !pinned.Stories[0].Pinned {
		t.Fatalf("pinned = %s", rec.Body.String())
	}

	// Stealth store is not configured in this router → 503.
	rec = authedReq(t, h, http.MethodGet, "/stories/stealth", tokenA, nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("stealth state without store: want 503, got %d %s", rec.Code, rec.Body.String())
	}
}

// TestStories_SelectedAllowlist_HTTP verifies that allow_user_ids is exposed
// only on the author's own selected story, never to other viewers (even those
// on the allowlist), so audiences of others' stories are not revealed.
func TestStories_SelectedAllowlist_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000080")
	tokenB, idB := signUp(t, h, pool, "+79990000081")

	// A uploads media and posts a "selected" story allowing B.
	rec := authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "sel", "privacy": "selected", "allow_user_ids": []int64{idB},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post selected story: %d %s", rec.Code, rec.Body.String())
	}

	type feedResp struct {
		Groups []struct {
			Stories []struct {
				ID           int64   `json:"id"`
				AllowUserIDs []int64 `json:"allow_user_ids"`
			} `json:"stories"`
		} `json:"groups"`
	}

	// A (author) sees allow_user_ids=[idB] on their own selected story.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenA, nil)
	var fa feedResp
	_ = json.Unmarshal(rec.Body.Bytes(), &fa)
	if len(fa.Groups) != 1 || len(fa.Groups[0].Stories) != 1 {
		t.Fatalf("A feed shape: %s", rec.Body.String())
	}
	if got := fa.Groups[0].Stories[0].AllowUserIDs; len(got) != 1 || got[0] != idB {
		t.Fatalf("A own selected story allow = %v; want [%d]", got, idB)
	}

	// B (allowlisted, non-author) sees the story but WITHOUT allow_user_ids —
	// the field must be entirely absent from the payload.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	body := rec.Body.String()
	var fb feedResp
	_ = json.Unmarshal([]byte(body), &fb)
	if len(fb.Groups) != 1 || len(fb.Groups[0].Stories) != 1 {
		t.Fatalf("B feed shape: %s", body)
	}
	if strings.Contains(body, "allow_user_ids") {
		t.Fatalf("allow_user_ids leaked to non-owner: %s", body)
	}
}

func TestStories_Flow_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000060")
	tokenB, idB := signUp(t, h, pool, "+79990000061")

	// A uploads a media object they own.
	rec := authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.MediaID == 0 {
		t.Fatalf("no media id: %s", rec.Body.String())
	}

	// A↔B private chat so B is a contact (partner) of A.
	rec = authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}

	// A posts a story.
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "hi", "privacy": "contacts",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post story: %d %s", rec.Code, rec.Body.String())
	}
	var posted struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &posted)
	if posted.ID == 0 {
		t.Fatalf("no story id: %s", rec.Body.String())
	}

	// B's feed shows A's story group with viewed=false.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("feed: %d %s", rec.Code, rec.Body.String())
	}
	var feed struct {
		Groups []struct {
			Author struct {
				ID int64 `json:"id"`
			} `json:"author"`
			Stories []struct {
				ID     int64 `json:"id"`
				Viewed bool  `json:"viewed"`
			} `json:"stories"`
		} `json:"groups"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &feed)
	if len(feed.Groups) != 1 || len(feed.Groups[0].Stories) != 1 {
		t.Fatalf("expected 1 group/1 story, got %s", rec.Body.String())
	}
	if feed.Groups[0].Stories[0].ID != posted.ID || feed.Groups[0].Stories[0].Viewed {
		t.Fatalf("unexpected feed: %s", rec.Body.String())
	}

	// B views the story.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/view", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("view: %d %s", rec.Code, rec.Body.String())
	}

	// A (author) sees B in the viewers list.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(posted.ID)+"/viewers", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("viewers: %d %s", rec.Code, rec.Body.String())
	}
	var viewers struct {
		Viewers []struct {
			ID int64 `json:"id"`
		} `json:"viewers"`
		Count int `json:"count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &viewers)
	if viewers.Count != 1 || len(viewers.Viewers) != 1 || viewers.Viewers[0].ID != idB {
		t.Fatalf("expected viewers=[B], got %s", rec.Body.String())
	}

	// B (non-author) is forbidden from the viewers list.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(posted.ID)+"/viewers", tokenB, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author viewers, got %d %s", rec.Code, rec.Body.String())
	}

	// A (author) reads story stats: 1 view + a per-day views series.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(posted.ID)+"/stats", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
	}
	var stats struct {
		Views      int64 `json:"views"`
		ViewsByDay []struct {
			Date  string `json:"date"`
			Value int64  `json:"value"`
		} `json:"views_by_day"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &stats)
	if stats.Views != 1 || len(stats.ViewsByDay) != 1 || stats.ViewsByDay[0].Value != 1 {
		t.Fatalf("unexpected story stats: %s", rec.Body.String())
	}

	// B (non-author) is forbidden from story stats.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(posted.ID)+"/stats", tokenB, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author stats, got %d %s", rec.Code, rec.Body.String())
	}

	// B reacts to the story; A's feed reflects the aggregate; B's my_reaction set.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/reaction", tokenB, map[string]any{"reaction": "👍"})
	if rec.Code != http.StatusOK {
		t.Fatalf("react: %d %s", rec.Code, rec.Body.String())
	}
	var reactFeed struct {
		Groups []struct {
			Stories []struct {
				ReactionsCount int     `json:"reactions_count"`
				MyReaction     *string `json:"my_reaction"`
				Reactions      []struct {
					Emoji string `json:"emoji"`
					Count int    `json:"count"`
					Mine  bool   `json:"mine"`
				} `json:"reactions"`
			} `json:"stories"`
		} `json:"groups"`
	}
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &reactFeed)
	if len(reactFeed.Groups) != 1 || len(reactFeed.Groups[0].Stories) != 1 {
		t.Fatalf("react feed shape: %s", rec.Body.String())
	}
	st := reactFeed.Groups[0].Stories[0]
	if st.ReactionsCount != 1 || st.MyReaction == nil || *st.MyReaction != "👍" {
		t.Fatalf("expected my_reaction=👍 count=1, got %s", rec.Body.String())
	}
	if len(st.Reactions) != 1 || st.Reactions[0].Emoji != "👍" || st.Reactions[0].Count != 1 || !st.Reactions[0].Mine {
		t.Fatalf("unexpected reactions breakdown: %s", rec.Body.String())
	}

	// A's stats include the reaction.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(posted.ID)+"/stats", tokenA, nil)
	var rstats struct {
		ReactionsTotal int64 `json:"reactions_total"`
		Reactions      []struct {
			Emoji string `json:"emoji"`
			Count int    `json:"count"`
		} `json:"reactions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &rstats)
	if rstats.ReactionsTotal != 1 || len(rstats.Reactions) != 1 || rstats.Reactions[0].Emoji != "👍" {
		t.Fatalf("unexpected stats reactions: %s", rec.Body.String())
	}

	// B removes the reaction; count drops to 0.
	rec = authedReq(t, h, http.MethodDelete, "/stories/"+itoa(posted.ID)+"/reaction", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("unreact: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &reactFeed)
	if reactFeed.Groups[0].Stories[0].ReactionsCount != 0 || reactFeed.Groups[0].Stories[0].MyReaction != nil {
		t.Fatalf("expected reactions cleared, got %s", rec.Body.String())
	}

	// A deletes the story; it disappears from B's feed.
	rec = authedReq(t, h, http.MethodDelete, "/stories/"+itoa(posted.ID), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &feed)
	if len(feed.Groups) != 0 {
		t.Fatalf("expected empty feed after delete, got %s", rec.Body.String())
	}
}

// TestStories_MediaAreasRepostShare_HTTP covers the 4d endpoints end-to-end:
// posting a story with media_areas (round-tripped in the feed payload), a
// visibility-gated repost carrying fwd_from, and sharing the story into a chat
// as a regular media message.
func TestStories_MediaAreasRepostShare_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990000090")
	tokenB, idB := signUp(t, h, pool, "+79990000091")
	tokenC, _ := signUp(t, h, pool, "+79990000092")

	// A↔B private chat makes B a partner of A (can see contacts stories) and a
	// valid share target.
	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	var chat struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &chat)

	// A uploads media and posts a story with media_areas.
	rec = authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	areas := []map[string]any{
		{"type": "reaction", "coordinates": map[string]any{"x": 50, "y": 50, "w": 10, "h": 10, "rotation": 0}, "reaction": "👍"},
		{"type": "geo", "coordinates": map[string]any{"x": 1, "y": 2, "w": 5, "h": 5, "rotation": 0}, "lat": 55.75, "long": 37.61, "title": "Москва"},
	}
	// "selected" allowing only B: B may repost/see it, C may not (contacts/everyone
	// stories are visible to everyone by the Visible predicate, so they can't gate C).
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "orig", "privacy": "selected",
		"allow_user_ids": []int64{idB}, "media_areas": areas,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post story: %d %s", rec.Code, rec.Body.String())
	}
	var posted struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &posted)

	// A's feed payload carries media_areas.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenA, nil)
	var feed struct {
		Groups []struct {
			Stories []struct {
				ID         int64 `json:"id"`
				MediaAreas []struct {
					Type        string   `json:"type"`
					Reaction    string   `json:"reaction"`
					Lat         *float64 `json:"lat"`
					Coordinates struct {
						X float64 `json:"x"`
					} `json:"coordinates"`
				} `json:"media_areas"`
			} `json:"stories"`
		} `json:"groups"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &feed)
	if len(feed.Groups) != 1 || len(feed.Groups[0].Stories) != 1 {
		t.Fatalf("A feed shape: %s", rec.Body.String())
	}
	fa := feed.Groups[0].Stories[0].MediaAreas
	if len(fa) != 2 || fa[0].Type != "reaction" || fa[0].Reaction != "👍" || fa[1].Type != "geo" || fa[1].Lat == nil {
		t.Fatalf("media_areas payload = %+v", fa)
	}

	// C (no chat with A) cannot repost A's contacts story.
	rec = authedReq(t, h, http.MethodPost, "/stories/repost", tokenC, map[string]any{
		"source_author_id": idA, "source_story_id": posted.ID,
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C repost: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// B (partner) reposts; the new story references A via fwd_from.
	rec = authedReq(t, h, http.MethodPost, "/stories/repost", tokenB, map[string]any{
		"source_author_id": idA, "source_story_id": posted.ID, "caption": "look", "privacy": "everyone",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("B repost: %d %s", rec.Code, rec.Body.String())
	}
	var reposted struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &reposted)

	// B's feed shows the repost with fwd_from{author_id:A}.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	var bfeed struct {
		Groups []struct {
			Stories []struct {
				ID      int64 `json:"id"`
				FwdFrom *struct {
					AuthorID int64 `json:"author_id"`
					StoryID  int64 `json:"story_id"`
				} `json:"fwd_from"`
			} `json:"stories"`
		} `json:"groups"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &bfeed)
	var fwdSeen bool
	for _, g := range bfeed.Groups {
		for _, s := range g.Stories {
			if s.ID == reposted.ID {
				if s.FwdFrom == nil || s.FwdFrom.AuthorID != idA || s.FwdFrom.StoryID != posted.ID {
					t.Fatalf("repost fwd_from payload = %+v", s.FwdFrom)
				}
				fwdSeen = true
			}
		}
	}
	if !fwdSeen {
		t.Fatalf("repost not found in B feed: %s", rec.Body.String())
	}

	// A shares the story into the A↔B chat: sent count 1, a media message lands.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/share", tokenA, map[string]any{
		"peer_ids": []int64{chat.PeerID},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("share: %d %s", rec.Code, rec.Body.String())
	}
	var shareResp struct {
		Sent int `json:"sent"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &shareResp)
	if shareResp.Sent != 1 {
		t.Fatalf("share sent = %d; want 1", shareResp.Sent)
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(chat.PeerID)+"/history?limit=10", tokenA, nil)
	var hist struct {
		Messages []struct {
			MediaID *int64 `json:"media_id"`
			Text    string `json:"text"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	var shared bool
	for _, m := range hist.Messages {
		if m.MediaID != nil && *m.MediaID == created.MediaID {
			shared = true
		}
	}
	if !shared {
		t.Fatalf("shared media message not found in chat history: %s", rec.Body.String())
	}

	// C cannot share a story it cannot see.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/share", tokenC, map[string]any{
		"peer_ids": []int64{chat.PeerID},
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C share: want 403, got %d %s", rec.Code, rec.Body.String())
	}
}
