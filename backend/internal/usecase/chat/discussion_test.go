package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestEnableDiscussion_NonAdminForbidden(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_ = fg.AddMember(context.Background(), ch, 8, domain.RoleSubscriber, 0)

	if _, err := i.EnableDiscussion(context.Background(), ch, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-admin EnableDiscussion = %v, want ErrForbidden", err)
	}
}

func TestEnableDiscussion_CreatorAndIdempotent(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)

	gid, err := i.EnableDiscussion(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	if gid == 0 {
		t.Fatal("expected a non-zero discussion group id")
	}
	// creator is a member of the new discussion group
	if m, err := fg.GetMember(context.Background(), gid, 7); err != nil || m.Role != domain.RoleCreator {
		t.Fatalf("creator membership in discussion group = %+v err=%v", m, err)
	}
	// second call is idempotent -> same id
	gid2, err := i.EnableDiscussion(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("second EnableDiscussion: %v", err)
	}
	if gid2 != gid {
		t.Fatalf("idempotent EnableDiscussion = %d, want %d", gid2, gid)
	}
}

func TestPostComment_DiscussionsOff_NotFound(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)

	if _, err := i.PostComment(context.Background(), ch, 100, 8, "hi", ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("PostComment with discussions off = %v, want ErrNotFound", err)
	}
}

func TestPostComment_ThreadsAndAutoJoins(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	gid, err := i.EnableDiscussion(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}

	const postID = int64(100)
	msg, err := i.PostComment(context.Background(), ch, postID, 8, "first comment", "c1")
	if err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	// the inserted message lands in the discussion group with ThreadRootID set
	if msg.ChatID != gid {
		t.Fatalf("comment ChatID=%d, want discussion group %d", msg.ChatID, gid)
	}
	if msg.ThreadRootID == nil || *msg.ThreadRootID != postID {
		t.Fatalf("comment ThreadRootID=%v, want %d", msg.ThreadRootID, postID)
	}
	// commenter auto-joined the discussion group
	if _, err := fg.GetMember(context.Background(), gid, 8); err != nil {
		t.Fatalf("commenter not auto-joined: %v", err)
	}
}

func TestListComments_ReturnsThreadAndCount(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(context.Background(), ch, 7); err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}

	const postID = int64(100)
	if _, err := i.PostComment(context.Background(), ch, postID, 8, "c1", "k1"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	if _, err := i.PostComment(context.Background(), ch, postID, 9, "c2", "k2"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	// a comment on a different post must not leak into this thread
	if _, err := i.PostComment(context.Background(), ch, 200, 9, "other", "k3"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}

	msgs, cnt, err := i.ListComments(context.Background(), ch, postID, 7, 0, 50)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if cnt != 2 || len(msgs) != 2 {
		t.Fatalf("ListComments count=%d len=%d, want 2/2", cnt, len(msgs))
	}
	if msgs[0].Text != "c1" || msgs[1].Text != "c2" {
		t.Fatalf("thread order = %q,%q, want c1,c2", msgs[0].Text, msgs[1].Text)
	}

	counts, err := i.CommentCounts(context.Background(), ch, []int64{postID, 200, 300})
	if err != nil {
		t.Fatalf("CommentCounts: %v", err)
	}
	if counts[postID] != 2 || counts[200] != 1 || counts[300] != 0 {
		t.Fatalf("CommentCounts = %v", counts)
	}
}
