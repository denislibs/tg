package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Б-9: видеочат с нуля начинает только создатель/админ (tweb topbar.ts:350-361,
// appImManager.ts:2343-2358: звонка нет и права нет → выход). Отказ виден
// входящему кадром group_call_update {action: "rejected"}, остальным — тишина.

// groupCallFramesFor — разобранные group_call_update, доставленные пользователю.
func groupCallFramesFor(t *testing.T, pub *fakePublisher, userID int64) []map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	var out []map[string]any
	for _, f := range pub.frames {
		if f.userID != userID {
			continue
		}
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if json.Unmarshal(f.frame, &env) == nil && env.T == "group_call_update" {
			out = append(out, env.D)
		}
	}
	return out
}

func TestJoinGroupCall_NoCall_MemberCannotStart(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()

	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("рядовой начинает видеочат: %v, want ErrForbidden", err)
	}
	if ids, _ := e.calls.Participants(ctx, e.chatID); len(ids) != 0 {
		t.Fatalf("рядовой попал в множество участников: %v", ids)
	}
	got := groupCallFramesFor(t, e.pub, callMember)
	if len(got) != 1 || got[0]["action"] != "rejected" || got[0]["user_id"] != float64(callMember) {
		t.Fatalf("входящему: %v, want один group_call_update rejected", got)
	}
	if _, ok := got[0]["peer_id"]; !ok {
		t.Fatalf("в отказе нет peer_id: %v", got[0])
	}
	if n := len(groupCallFramesFor(t, e.pub, callOwner)); n != 0 {
		t.Fatalf("создателю пришло %d кадров group_call_update при чужом отказе", n)
	}
	if n := len(e.chatUpdates(t, callOwner)); n != 0 {
		t.Fatalf("отказ породил chat_update: %d", n)
	}
}

func TestJoinGroupCall_NoCall_AdminStarts(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatalf("создатель начинает видеочат: %v", err)
	}
	if ids, _ := e.calls.Participants(ctx, e.chatID); len(ids) != 1 || ids[0] != callOwner {
		t.Fatalf("участники = %v, want [создатель]", ids)
	}
	// Админ, назначенный создателем, тоже начинает.
	if err := e.in.PromoteAdmin(ctx, e.chatID, callOwner, callMember, domain.RightPinMessages, nil); err != nil {
		t.Fatalf("PromoteAdmin: %v", err)
	}
	_ = e.in.LeaveGroupCall(ctx, e.chatID, callOwner)
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatalf("админ начинает видеочат: %v", err)
	}
}

func TestJoinGroupCall_ActiveCall_MemberJoins(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	before, err := e.in.JoinGroupCall(ctx, e.chatID, callMember)
	if err != nil {
		t.Fatalf("рядовой входит в идущий видеочат: %v", err)
	}
	if len(before) != 1 || before[0] != callOwner {
		t.Fatalf("участники до входа = %v, want [создатель]", before)
	}
}

func TestJoinGroupCall_LivestreamActive_MemberJoins(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.in.SetLivestreams(newFakeLivestreamRepo(), "rtmp://test/live")
	if _, err := e.in.StartLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatalf("зритель входит при активном эфире: %v", err)
	}
	if ids, _ := e.calls.Participants(ctx, e.chatID); len(ids) != 1 || ids[0] != callMember {
		t.Fatalf("участники = %v, want [зритель]", ids)
	}
}

func TestJoinGroupCall_LivestreamStopped_MemberCannotStart(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.in.SetLivestreams(newFakeLivestreamRepo(), "rtmp://test/live")
	if _, err := e.in.StartLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if err := e.in.StopLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("рядовой после конца эфира: %v, want ErrForbidden", err)
	}
}

func TestJoinGroupCall_NotMember_NotFound(t *testing.T) {
	e := newCallEnv(t)
	if _, err := e.in.JoinGroupCall(context.Background(), e.chatID, 99); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не член чата: %v, want ErrNotFound", err)
	}
	if n := len(groupCallFramesFor(t, e.pub, 99)); n != 0 {
		t.Fatalf("не члену чата отдан кадр: %d", n)
	}
}
