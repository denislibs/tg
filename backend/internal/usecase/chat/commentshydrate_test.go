package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Комментарии поста канала уходят той же формой, что история треда: у
// комментария с фото собрано вложение. Прежде ListComments отдавал ListThread
// сырым — фото в комментариях приезжало без media.
func TestListComments_HydratedLikeHistory(t *testing.T) {
	var s *store
	i, _, _, _ := newChannelTestInteractorMsgs(t, func(st *store) MessageRepo { s = st; return fakeMsgs{st} })
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	post, _ := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	comment, err := i.PostComment(ctx, ch, post.ID, 8, "смотри фото", "c1")
	if err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	// Комментарий с фото: PostComment шлёт только текст, поэтому вложение
	// дописывается строке напрямую — ровно так она и лежит в messages.
	const mediaID int64 = 42
	s.seedMediaDims(mediaID, domain.MediaSource{Mime: "image/jpeg", Width: 640, Height: 480, Size: 1000})
	s.mu.Lock()
	for idx, m := range s.messages[disc] {
		if m.ID == comment.ID {
			id := mediaID
			s.messages[disc][idx].Type = "photo"
			s.messages[disc][idx].MediaID = &id
		}
	}
	s.mu.Unlock()

	msgs, _, err := i.ListComments(ctx, ch, post.ID, 8, 0, 50)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("комментариев %d, want 1", len(msgs))
	}
	if _, ok := msgs[0].Media.(*domain.MessageMediaPhoto); !ok {
		t.Fatalf("комментарий без вложения: Media = %#v", msgs[0].Media)
	}
}
