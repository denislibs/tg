package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// RTMP-трансляции (Telegram livestream). Трансляция — это групповой звонок в
// режиме RTMP: админ канала/группы запускает эфир и получает креды для OBS
// (rtmp URL сервера + stream key). Зрители присоединяются через обычный
// групповой звонок (JoinGroupCall) — их число и есть счётчик зрителей. Метаданные
// потока (ключ, активность, старт) персистятся в LivestreamRepo, старт/стоп
// фанятся членам чата кадром livestream_update.
//
// Упрощение: реального RTMP-ingest-сервера в проекте нет — мы честно отдаём
// креды и моделируем статус/зрителей, но принятого по RTMP медиапотока нет.

const defaultRTMPURL = "rtmp://localhost/live"

// LivestreamState — представление трансляции для клиента. StreamKey/RTMPURL
// заполняются только для админов (зрителям секрет не отдаём).
type LivestreamState struct {
	Active    bool
	Viewers   int
	StartedAt *time.Time
	IsAdmin   bool
	RTMPURL   string
	StreamKey string
}

// newStreamKey — случайный секрет для OBS (32 hex-символа).
func newStreamKey() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand не должен падать; на всякий случай — детерминированный фолбэк.
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}

func (i *Interactor) rtmpBaseURL() string {
	if i.rtmpURL != "" {
		return i.rtmpURL
	}
	return defaultRTMPURL
}

// requireCallAdmin пропускает только creator/admin чата (управление
// трансляцией — админское действие, в отличие от join группового звонка).
func (i *Interactor) requireCallAdmin(ctx context.Context, chatID, userID int64) error {
	if i.groups == nil {
		return domain.ErrForbidden
	}
	m, err := i.groups.GetMember(ctx, chatID, userID)
	if err != nil {
		return domain.ErrForbidden
	}
	if m.Role != domain.RoleCreator && m.Role != domain.RoleAdmin {
		return domain.ErrForbidden
	}
	return nil
}

// ensureLivestream читает запись трансляции чата, создавая её (с новым ключом,
// неактивную) при первом обращении.
func (i *Interactor) ensureLivestream(ctx context.Context, chatID int64) (domain.Livestream, error) {
	ls, err := i.livestreams.Get(ctx, chatID)
	if err == nil {
		return ls, nil
	}
	if err != domain.ErrNotFound {
		return domain.Livestream{}, err
	}
	ls = domain.Livestream{ChatID: chatID, StreamKey: newStreamKey()}
	if err := i.livestreams.Upsert(ctx, ls); err != nil {
		return domain.Livestream{}, err
	}
	return ls, nil
}

func (i *Interactor) viewerCount(ctx context.Context, chatID int64) int {
	if i.groupCalls == nil {
		return 0
	}
	ids, err := i.groupCalls.Participants(ctx, chatID)
	if err != nil {
		return 0
	}
	return len(ids)
}

// StartLivestream запускает трансляцию (только админ) и возвращает креды OBS.
func (i *Interactor) StartLivestream(ctx context.Context, chatID, userID int64) (LivestreamState, error) {
	if i.livestreams == nil {
		return LivestreamState{}, domain.ErrNotFound
	}
	if err := i.requireCallAdmin(ctx, chatID, userID); err != nil {
		return LivestreamState{}, err
	}
	ls, err := i.ensureLivestream(ctx, chatID)
	if err != nil {
		return LivestreamState{}, err
	}
	now := time.Now()
	ls.Active = true
	ls.StartedAt = &now
	if err := i.livestreams.Upsert(ctx, ls); err != nil {
		return LivestreamState{}, err
	}
	i.publishLivestreamUpdate(ctx, chatID, "started")
	return LivestreamState{
		Active: true, Viewers: i.viewerCount(ctx, chatID), StartedAt: ls.StartedAt,
		IsAdmin: true, RTMPURL: i.rtmpBaseURL(), StreamKey: ls.StreamKey,
	}, nil
}

// StopLivestream завершает трансляцию (только админ).
func (i *Interactor) StopLivestream(ctx context.Context, chatID, userID int64) error {
	if i.livestreams == nil {
		return domain.ErrNotFound
	}
	if err := i.requireCallAdmin(ctx, chatID, userID); err != nil {
		return err
	}
	ls, err := i.livestreams.Get(ctx, chatID)
	if err != nil {
		return err
	}
	ls.Active = false
	ls.StartedAt = nil
	if err := i.livestreams.Upsert(ctx, ls); err != nil {
		return err
	}
	i.publishLivestreamUpdate(ctx, chatID, "stopped")
	return nil
}

// RevokeStreamKey перевыпускает stream key (только админ). Эфир не прерывается —
// меняется лишь секрет для OBS; старый ключ перестаёт работать.
func (i *Interactor) RevokeStreamKey(ctx context.Context, chatID, userID int64) (LivestreamState, error) {
	if i.livestreams == nil {
		return LivestreamState{}, domain.ErrNotFound
	}
	if err := i.requireCallAdmin(ctx, chatID, userID); err != nil {
		return LivestreamState{}, err
	}
	ls, err := i.ensureLivestream(ctx, chatID)
	if err != nil {
		return LivestreamState{}, err
	}
	ls.StreamKey = newStreamKey()
	if err := i.livestreams.Upsert(ctx, ls); err != nil {
		return LivestreamState{}, err
	}
	return LivestreamState{
		Active: ls.Active, Viewers: i.viewerCount(ctx, chatID), StartedAt: ls.StartedAt,
		IsAdmin: true, RTMPURL: i.rtmpBaseURL(), StreamKey: ls.StreamKey,
	}, nil
}

// LivestreamStatus — статус трансляции для участника чата. Креды (rtmp/key)
// отдаются только админам; зрители видят лишь активность и счётчик зрителей.
func (i *Interactor) LivestreamStatus(ctx context.Context, chatID, userID int64) (LivestreamState, error) {
	if i.livestreams == nil {
		return LivestreamState{}, domain.ErrNotFound
	}
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return LivestreamState{}, err
	}
	if !ok {
		return LivestreamState{}, domain.ErrNotFound
	}
	isAdmin := i.requireCallAdmin(ctx, chatID, userID) == nil
	st := LivestreamState{IsAdmin: isAdmin, Viewers: i.viewerCount(ctx, chatID)}
	if isAdmin {
		// админ всегда получает креды для OBS: ключ генерируется при первом
		// обращении (как tweb fetchRtmpUrl), даже если эфир ещё не запущен.
		ls, err := i.ensureLivestream(ctx, chatID)
		if err != nil {
			return LivestreamState{}, err
		}
		st.Active = ls.Active
		st.StartedAt = ls.StartedAt
		st.RTMPURL = i.rtmpBaseURL()
		st.StreamKey = ls.StreamKey
		return st, nil
	}
	// зритель видит лишь активность и число зрителей
	ls, err := i.livestreams.Get(ctx, chatID)
	if err == domain.ErrNotFound {
		return st, nil // трансляцию ещё не заводили — неактивна
	}
	if err != nil {
		return LivestreamState{}, err
	}
	st.Active = ls.Active
	st.StartedAt = ls.StartedAt
	return st, nil
}

func (i *Interactor) publishLivestreamUpdate(ctx context.Context, chatID int64, action string) {
	if i.publisher == nil {
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	f := frame("livestream_update", map[string]any{
		"chat_id": chatID, "action": action,
		"active": action == "started", "viewers": i.viewerCount(ctx, chatID),
	})
	for _, uid := range members {
		_ = i.publisher.PublishToUser(ctx, uid, f)
	}
}
