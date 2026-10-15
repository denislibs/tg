package chat

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Истории идут в журнал получателя строками `story_update` / `story_read` /
// `story_reaction` (usecase/story + ownsync). Офлайн-устройство находит их через
// getDifference: белого списка типов нет, любая строка с конструктором уходит в
// other_updates как есть — updateStory, updateReadStories, updateSentStoryReaction.
func TestUpdatesDifference_CarriesStoryRows(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const author, bob int64 = 1, 2
	peer := domain.NewPeer(domain.PeerID(author))
	story := domain.StoryRecord{Seq: 3, Caption: "hi", Privacy: "contacts", CreatedAt: time.Unix(10, 0), ExpiresAt: time.Unix(20, 0)}.ToStoryItem(false)

	rows := []struct {
		typ  string
		body any
		tag  string
	}{
		{"story_update", domain.NewUpdateStory(peer, story), domain.UpdateStoryTag},
		{"story_update", domain.NewUpdateStory(peer, domain.NewStoryItemDeleted(3)), domain.UpdateStoryTag},
		{"story_read", domain.NewUpdateReadStories(peer, 3), domain.UpdateReadStoriesTag},
		// своя реакция зрителя: тело под него, с sent_reaction внутри истории
		{"story_update", domain.NewUpdateStory(peer, domain.StoryRecord{Seq: 3, MyReaction: "👍", CreatedAt: time.Unix(10, 0), ExpiresAt: time.Unix(20, 0)}.ToStoryItem(false)), domain.UpdateStoryTag},
	}
	for _, r := range rows {
		raw, err := json.Marshal(r.body)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := in.updates.AppendUpdate(ctx, bob, 1, 1, r.typ, raw); err != nil {
			t.Fatal(err)
		}
	}

	d := diffReal(t, in, bob, 0)
	if len(d.OtherUpdates) != len(rows) {
		t.Fatalf("other_updates = %d; want %d строк историй", len(d.OtherUpdates), len(rows))
	}
	for i, r := range rows {
		var body map[string]any
		if err := json.Unmarshal(d.OtherUpdates[i], &body); err != nil {
			t.Fatal(err)
		}
		if body["_"] != r.tag {
			t.Errorf("строка %d: конструктор %v; want %s", i, body["_"], r.tag)
		}
	}
	// Реакция зрителя доезжает после офлайна внутри самой истории.
	var last map[string]any
	_ = json.Unmarshal(d.OtherUpdates[len(rows)-1], &last)
	sent, _ := last["story"].(map[string]any)["sent_reaction"].(map[string]any)
	if sent == nil || sent["emoticon"] != "👍" {
		t.Errorf("sent_reaction не доехал через getDifference: %v", last)
	}
	if d.State.Pts != int64(len(rows)) {
		t.Errorf("state.pts = %d; want %d", d.State.Pts, len(rows))
	}
}
