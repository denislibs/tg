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

func TestLinkDiscussion_LinksExistingGroup(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	// actor 7 owns a plain group.
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 7)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleCreator, domain.AllRights)

	got, err := i.LinkDiscussion(ctx, ch, gid, 7)
	if err != nil || got != gid {
		t.Fatalf("LinkDiscussion = %d, %v; want %d", got, err, gid)
	}
	if cur, _ := fg.GetDiscussion(ctx, ch); cur != gid {
		t.Fatalf("discussion not set: %d", cur)
	}
}

func TestLinkDiscussion_ForumRejected(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 7)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleCreator, domain.AllRights)
	_ = fg.SetForum(ctx, gid, true)

	if _, err := i.LinkDiscussion(ctx, ch, gid, 7); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("forum group link = %v, want ErrForbidden", err)
	}
}

func TestLinkDiscussion_NotGroupAdminRejected(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 99)
	_ = fg.AddMember(ctx, gid, 99, domain.RoleCreator, domain.AllRights)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleMember, 0) // actor is a plain member

	if _, err := i.LinkDiscussion(ctx, ch, gid, 7); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-admin group link = %v, want ErrForbidden", err)
	}
}

func TestUnlinkDiscussion(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 7)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleCreator, domain.AllRights)
	if _, err := i.LinkDiscussion(ctx, ch, gid, 7); err != nil {
		t.Fatal(err)
	}
	if err := i.UnlinkDiscussion(ctx, ch, 7); err != nil {
		t.Fatalf("UnlinkDiscussion: %v", err)
	}
	if cur, _ := fg.GetDiscussion(ctx, ch); cur != 0 {
		t.Fatalf("discussion still set: %d", cur)
	}
}

func TestDiscussionCandidates(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	// eligible: plain group where 7 is creator
	g1, _ := fg.CreateMultiMember(ctx, "group", "Eligible", "", "", false, 7)
	_ = fg.AddMember(ctx, g1, 7, domain.RoleCreator, domain.AllRights)
	// ineligible: forum group
	g2, _ := fg.CreateMultiMember(ctx, "group", "Forum", "", "", false, 7)
	_ = fg.AddMember(ctx, g2, 7, domain.RoleCreator, domain.AllRights)
	_ = fg.SetForum(ctx, g2, true)
	// ineligible: 7 is only a member
	g3, _ := fg.CreateMultiMember(ctx, "group", "Member", "", "", false, 99)
	_ = fg.AddMember(ctx, g3, 7, domain.RoleMember, 0)

	cands, err := i.DiscussionCandidates(ctx, 7)
	if err != nil {
		t.Fatalf("DiscussionCandidates: %v", err)
	}
	if len(cands) != 1 || cands[0].ID != g1 {
		t.Fatalf("candidates = %+v, want only %d", cands, g1)
	}
}

func TestSetSignatures(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	if err := i.SetSignatures(ctx, ch, 7, true, true); err != nil {
		t.Fatalf("SetSignatures on: %v", err)
	}
	if c, _ := fg.Card(ctx, ch, 7); !c.Signatures || !c.SignatureProfiles {
		t.Fatalf("signatures not set: %+v", c)
	}
	// profiles forced off when signatures off.
	if err := i.SetSignatures(ctx, ch, 7, false, true); err != nil {
		t.Fatalf("SetSignatures off: %v", err)
	}
	if c, _ := fg.Card(ctx, ch, 7); c.Signatures || c.SignatureProfiles {
		t.Fatalf("signatures should be off: %+v", c)
	}
	// non-admin forbidden.
	if err := i.SetSignatures(ctx, ch, 8, true, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-admin SetSignatures = %v, want ErrForbidden", err)
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
