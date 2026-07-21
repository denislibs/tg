package report

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeRepo struct {
	last  domain.Report
	calls int
}

func (f *fakeRepo) Add(_ context.Context, r domain.Report) error {
	f.last = r
	f.calls++
	return nil
}

func TestReportValidReasons(t *testing.T) {
	for _, reason := range []domain.ReportReason{
		domain.ReportReasonSpam, domain.ReportReasonViolence,
		domain.ReportReasonPorn, domain.ReportReasonChildAbuse, domain.ReportReasonOther,
	} {
		repo := &fakeRepo{}
		uc := New(repo)
		if err := uc.Report(context.Background(), 1, 42, nil, reason, ""); err != nil {
			t.Fatalf("reason %q: unexpected error %v", reason, err)
		}
		if repo.calls != 1 || repo.last.Reason != reason {
			t.Fatalf("reason %q: repo not called with the reason (%+v)", reason, repo.last)
		}
	}
}

func TestReportInvalidReasonRejected(t *testing.T) {
	repo := &fakeRepo{}
	uc := New(repo)
	err := uc.Report(context.Background(), 1, 42, nil, domain.ReportReason("bogus"), "hi")
	if !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
	if repo.calls != 0 {
		t.Fatalf("repo must not be called on invalid reason")
	}
}

func TestReportBadArgs(t *testing.T) {
	repo := &fakeRepo{}
	uc := New(repo)
	// нулевой reporter и нулевой чат — отклоняются до репозитория
	if err := uc.Report(context.Background(), 0, 42, nil, domain.ReportReasonSpam, ""); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("zero reporter: want ErrInvalid, got %v", err)
	}
	if err := uc.Report(context.Background(), 1, 0, nil, domain.ReportReasonSpam, ""); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("zero chat: want ErrInvalid, got %v", err)
	}
	if repo.calls != 0 {
		t.Fatalf("repo must not be called on bad args")
	}
}

func TestReportMsgIDAndCommentTruncation(t *testing.T) {
	repo := &fakeRepo{}
	uc := New(repo)
	msgID := int64(777)
	long := strings.Repeat("x", commentMaxLen+50)
	if err := uc.Report(context.Background(), 1, 42, &msgID, domain.ReportReasonOther, "  "+long+"  "); err != nil {
		t.Fatalf("unexpected error %v", err)
	}
	if repo.last.MsgID == nil || *repo.last.MsgID != msgID {
		t.Fatalf("msgID not forwarded: %+v", repo.last.MsgID)
	}
	if len(repo.last.Comment) != commentMaxLen {
		t.Fatalf("comment not truncated to %d, got %d", commentMaxLen, len(repo.last.Comment))
	}
}
