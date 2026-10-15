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
	rows  []domain.Report
	calls int
}

func (f *fakeRepo) Add(_ context.Context, reps []domain.Report) error {
	f.rows = reps
	f.last = reps[len(reps)-1]
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
	if err := uc.Report(context.Background(), 1, 42, []int64{msgID}, domain.ReportReasonOther, "  "+long+"  "); err != nil {
		t.Fatalf("unexpected error %v", err)
	}
	if repo.last.MsgID == nil || *repo.last.MsgID != msgID {
		t.Fatalf("msgID not forwarded: %+v", repo.last.MsgID)
	}
	if len(repo.last.Comment) != commentMaxLen {
		t.Fatalf("comment not truncated to %d, got %d", commentMaxLen, len(repo.last.Comment))
	}
}

// messages.report{id: Vector<int>} (tweb appMessagesManager.ts:7807-7827): на
// каждое названное сообщение — своя строка жалобы, все одним вызовом хранилища.
func TestReportVectorOfMessages(t *testing.T) {
	repo := &fakeRepo{}
	uc := New(repo)
	if err := uc.Report(context.Background(), 1, 42, []int64{10, 11, 10}, domain.ReportReasonSpam, "c"); err != nil {
		t.Fatalf("unexpected error %v", err)
	}
	if repo.calls != 1 || len(repo.rows) != 2 {
		t.Fatalf("calls=%d rows=%d; want один вызов и 2 строки (повтор номера схлопнут)", repo.calls, len(repo.rows))
	}
	for n, want := range []int64{10, 11} {
		r := repo.rows[n]
		if r.MsgID == nil || *r.MsgID != want || r.ChatID != 42 || r.ReporterID != 1 || r.Comment != "c" {
			t.Fatalf("строка %d = %+v", n, r)
		}
	}
}

// id: [] — жалоба на чат (reportAd.tsx:372): одна строка без msg_id.
func TestReportEmptyVectorIsChatReport(t *testing.T) {
	repo := &fakeRepo{}
	uc := New(repo)
	if err := uc.Report(context.Background(), 1, 42, []int64{}, domain.ReportReasonSpam, ""); err != nil {
		t.Fatalf("unexpected error %v", err)
	}
	if len(repo.rows) != 1 || repo.rows[0].MsgID != nil {
		t.Fatalf("rows = %+v; want одна строка на чат", repo.rows)
	}
}

// Потолок вектора — 100 номеров (как messages.report у сервера Telegram);
// больше — отказ до хранилища.
func TestReportVectorCap(t *testing.T) {
	repo := &fakeRepo{}
	uc := New(repo)
	ids := make([]int64, 0, MaxIDs+1)
	for n := int64(1); n <= MaxIDs; n++ {
		ids = append(ids, n)
	}
	if err := uc.Report(context.Background(), 1, 42, ids, domain.ReportReasonSpam, ""); err != nil || len(repo.rows) != MaxIDs {
		t.Fatalf("ровно %d: err=%v rows=%d", MaxIDs, err, len(repo.rows))
	}
	repo.calls = 0
	if err := uc.Report(context.Background(), 1, 42, append(ids, 999), domain.ReportReasonSpam, ""); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("%d номеров: err=%v; want ErrInvalid", MaxIDs+1, err)
	}
	if repo.calls != 0 {
		t.Fatalf("хранилище вызвано при переполнении вектора")
	}
}
