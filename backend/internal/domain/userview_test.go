package domain

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// A4-08: карточка `user` глазами зрителя — одним сборщиком на всех витринах.
// Номер прочитан, но наружу выходит только по правилу; статус — по last_seen;
// фото — по profile_photo, кроме личного; себя зритель видит целиком.
func TestUserViewRules_Apply(t *testing.T) {
	photo := NewUserProfilePhoto(5, nil, false, false)
	personal := NewUserProfilePhoto(6, nil, false, true)
	users := []UserReal{
		NewUser(1, UserFlags{Self: true}).WithHiddenPhone("+71"),
		NewUser(2, UserFlags{}).WithHiddenPhone("+72"),
		NewUser(3, UserFlags{}).WithHiddenPhone("+73"),
		NewUser(4, UserFlags{Bot: true}),
	}
	users[0].Photo, users[1].Photo, users[2].Photo = photo, photo, personal
	// Номер, не прошедший правило, на провод не попадает вовсе.
	raw, _ := json.Marshal(users)
	if strings.Contains(string(raw), "+7") {
		t.Fatalf("скрытый номер на проводе: %s", raw)
	}
	online := NewUserStatusOnline(time.Now().Add(time.Minute))
	UserViewRules{
		ViewerID: 1,
		Photo:    map[int64]bool{},
		Phone:    map[int64]bool{2: true},
		LastSeen: map[int64]bool{3: true, 4: true},
		Status:   func(int64) UserStatus { return online },
	}.Apply(users)
	if users[0].Phone != "+71" || users[0].Status == nil {
		t.Errorf("себя: phone=%q status=%v", users[0].Phone, users[0].Status)
	}
	if users[1].Phone != "+72" || users[1].Status.Tag() != UserStatusRecentlyTag {
		t.Errorf("2: phone=%q status=%v, want номер и «недавно»", users[1].Phone, users[1].Status)
	}
	if _, empty := users[1].Photo.(UserProfilePhotoEmpty); !empty {
		t.Errorf("2: фото не погашено правилом: %#v", users[1].Photo)
	}
	if users[2].Phone != "" || users[2].Status.Tag() != UserStatusOnlineTag {
		t.Errorf("3: phone=%q status=%v, want без номера, онлайн", users[2].Phone, users[2].Status)
	}
	if p, ok := users[2].Photo.(UserProfilePhotoReal); !ok || !p.Personal() {
		t.Errorf("3: личное фото погашено: %#v", users[2].Photo)
	}
	if users[3].Status != nil {
		t.Errorf("бот со статусом: %v", users[3].Status)
	}
}
