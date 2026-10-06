// Package presence tracks online/last-seen state via a PresenceStore port and
// fans presence changes out to a user's chat partners.
package presence

import (
	"context"
	"encoding/json"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Publisher delivers a frame to a user's realtime channel (satisfied by the
// realtime RedisPublisher).
type Publisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// PartnersFunc returns the user ids that should see a user's presence.
type PartnersFunc func(ctx context.Context, userID int64) ([]int64, error)

// PrivacyChecker отвечает, видит ли viewer аспект key владельца ownerID
// (usecase/privacy). Для presence используется ключ last_seen.
type PrivacyChecker interface {
	Check(ctx context.Context, ownerID, viewerID int64, key domain.PrivacyKey) (bool, error)
}

// PresenceStore abstracts the online/last-seen storage (Redis in prod).
type PresenceStore interface {
	SetOnlineNX(ctx context.Context, userID int64, ttl time.Duration) (set bool, err error) // true if transitioned offline→online
	Refresh(ctx context.Context, userID int64, ttl time.Duration) (existed bool, err error) // false if the key had expired
	SetOffline(ctx context.Context, userID int64, lastSeen int64) error
	IsOnline(ctx context.Context, userID int64) (bool, error)
	LastSeen(ctx context.Context, userID int64) (int64, error)
	// OnlineExpires — дедлайн ключа присутствия. Нулевое время — пир не онлайн.
	OnlineExpires(ctx context.Context, userID int64) (time.Time, error)
	// Announce запоминает дедлайн онлайна, ОБЪЯВЛЕННЫЙ партнёрам
	// (userStatusOnline.expires последнего кадра); запись живёт до него же.
	Announce(ctx context.Context, userID int64, deadline time.Time) error
	// AnnouncedExpires — последний объявленный дедлайн; нулевое время — не
	// объявлялся или уже истёк.
	AnnouncedExpires(ctx context.Context, userID int64) (time.Time, error)
	// CountOnline — сколько из userIDs сейчас онлайн (одним конвейером).
	CountOnline(ctx context.Context, userIDs []int64) (int, error)
}

// Горизонт онлайна и порог его продления.
//
// Telegram держит собеседника «в сети» ПОТОКОМ updateUserStatus: tweb зовёт
// account.updateStatus каждые 50 с (appImManager.ts:360), и каждый вызов
// уходит зрителям новым userStatusOnline со свежим expires, а клиент гасит
// онлайн, как только expires прошёл (appUsersManager.ts:995-1003). Наш пульс —
// WS-heartbeat раз в 25 с (ws.pingPeriod); продлевать им только TTL ключа
// (35 с) значит обещать партнёру онлайн на 35 с и больше не сказать ничего —
// через минуту клиент гасит статус живого человека («был(а) в сети только что»).
//
// Поэтому обещание длиннее ключа (onlineHorizon) и продлевается кадром, когда
// до его истечения остаётся меньше reannounceBefore: при пульсе 25 с это кадр
// раз в ~50 с — каденция оригинала, а не веер на каждый пульс. reannounceBefore
// обязан превышать период пульса, иначе обещание истечёт между пульсами.
const (
	onlineHorizon    = 90 * time.Second
	reannounceBefore = 45 * time.Second
)

type Manager struct {
	store    PresenceStore
	pub      Publisher
	partners PartnersFunc
	ttl      time.Duration
	privacy  PrivacyChecker
	now      func() time.Time
}

func NewManager(store PresenceStore, pub Publisher, partners PartnersFunc, ttl time.Duration) *Manager {
	return &Manager{store: store, pub: pub, partners: partners, ttl: ttl, now: time.Now}
}

// SetPrivacy подключает правило «кто видит время моего захода» (optional):
// партнёрам вне правила уходит presence с online=false/last_seen=0
// (клиент показывает «был(а) недавно», как Telegram).
func (m *Manager) SetPrivacy(p PrivacyChecker) { m.privacy = p }

// Online marks a user online. It fans out a presence(online) frame only on the
// transition from offline → online (SET NX), so multiple devices/replicas don't
// each re-announce.
func (m *Manager) Online(ctx context.Context, userID int64) error {
	set, err := m.store.SetOnlineNX(ctx, userID, m.ttl)
	if err != nil {
		return err
	}
	if !set { // already online elsewhere — just refresh the TTL
		_, _ = m.store.Refresh(ctx, userID, m.ttl)
		return nil
	}
	return m.announceOnline(ctx, userID)
}

// Heartbeat refreshes the online TTL; if the key had expired it re-establishes
// presence (which re-announces online). Живой ключ продлевается и обещанием
// партнёрам — кадром, когда объявленный дедлайн близок (см. onlineHorizon).
func (m *Manager) Heartbeat(ctx context.Context, userID int64) error {
	existed, err := m.store.Refresh(ctx, userID, m.ttl)
	if err != nil {
		return err
	}
	if !existed {
		return m.Online(ctx, userID)
	}
	if exp, _ := m.store.AnnouncedExpires(ctx, userID); exp.Sub(m.now()) >= reannounceBefore {
		return nil
	}
	return m.announceOnline(ctx, userID)
}

// announceOnline объявляет партнёрам онлайн с новым дедлайном и запоминает его,
// чтобы снимок (Status) обещал ровно то же, что последний кадр.
func (m *Manager) announceOnline(ctx context.Context, userID int64) error {
	deadline := m.now().Add(onlineHorizon)
	_ = m.store.Announce(ctx, userID, deadline)
	return m.fanout(ctx, userID, domain.NewUserStatusOnline(deadline))
}

// Offline marks a user offline, records last-seen, and fans out presence(offline).
func (m *Manager) Offline(ctx context.Context, userID int64) error {
	now := m.now()
	_ = m.store.SetOffline(ctx, userID, now.UnixMilli())
	return m.fanout(ctx, userID, domain.PresenceStatus(false, time.Time{}, now))
}

// IsOnline reports whether a user is currently online. It satisfies the HTTP
// layer's PresenceQuery seam (used by GET /chats/{id}/members).
func (m *Manager) IsOnline(ctx context.Context, userID int64) (bool, error) {
	return m.store.IsOnline(ctx, userID)
}

// CountOnline — «N онлайн» чата (messages.getOnlines, Б-84): сколько из ids
// держат ключ присутствия. Скрывших время визита считаем тоже — число не
// раскрывает, кто именно (решение по умолчанию). Порог: группы до десятков
// тысяч; дальше — сет онлайна и пересечение (SINTERCARD), не сейчас.
func (m *Manager) CountOnline(ctx context.Context, userIDs []int64) (int, error) {
	return m.store.CountOnline(ctx, userIDs)
}

// Status — снимок присутствия в том виде, из которого собирается UserStatus
// схемы: онлайн ли пир, ДО КАКОГО МОМЕНТА (объявленный партнёрам дедлайн —
// тот же, что в последнем кадре; до первого объявления — дедлайн TTL ключа) и
// когда заходил в последний раз. Реализует шов PresenceSnapshot у privacy и
// delivery.
//
// Срок годности — не украшение. Без него потерянный кадр присутствия оставлял
// человека онлайн навсегда; с ним клиент деградирует online → offline сам,
// даже не получив ни одного кадра (tweb appUsersManager.ts:880-889).
func (m *Manager) Status(ctx context.Context, userID int64) (online bool, expires, lastSeen time.Time) {
	online, _ = m.store.IsOnline(ctx, userID)
	if online {
		if expires, _ = m.store.AnnouncedExpires(ctx, userID); expires.IsZero() {
			expires, _ = m.store.OnlineExpires(ctx, userID)
		}
	}
	if ms, _ := m.store.LastSeen(ctx, userID); ms > 0 {
		lastSeen = time.UnixMilli(ms)
	}
	return online, expires, lastSeen
}

// UserStatus — готовый конструктор UserStatus для пира. visible=false —
// правило приватности last_seen не пускает зрителя: это userStatusRecently,
// то есть скрытость выражена САМИМ статусом, а не флагом рядом с обнулённым
// временем.
func (m *Manager) UserStatus(ctx context.Context, userID int64, visible bool) domain.UserStatus {
	if !visible {
		return domain.NewUserStatusRecently(false)
	}
	return domain.PresenceStatus(m.Status(ctx, userID))
}

// fanout рассылает партнёрам смену присутствия КОНСТРУКТОРОМ UserStatus.
//
// Прежде кадр нёс пару {online, last_seen} — и у «online» не было срока
// годности: потерянный кадр оставлял человека онлайн навсегда.
// userStatusOnline несёт expires, и клиент гасит статус по таймеру сам.
//
// Скрытое правилом last_seen присутствие — не «пустой кадр с online:false», а
// ДРУГОЙ конструктор: userStatusRecently. Приватность выражена выбором
// конструктора, ровно как в оригинале.
func (m *Manager) fanout(ctx context.Context, userID int64, status domain.UserStatus) error {
	partners, err := m.partners(ctx, userID)
	if err != nil {
		return err
	}
	frame, _ := json.Marshal(map[string]any{
		"t": "presence",
		"d": domain.NewUpdateUserStatus(userID, status),
	})
	var hidden []byte
	for _, p := range partners {
		f := frame
		if m.privacy != nil {
			if ok, err := m.privacy.Check(ctx, userID, p, domain.PrivacyLastSeen); err == nil && !ok {
				if hidden == nil {
					hidden, _ = json.Marshal(map[string]any{
						"t": "presence",
						"d": domain.NewUpdateUserStatus(userID, domain.NewUserStatusRecently(false)),
					})
				}
				f = hidden
			}
		}
		_ = m.pub.PublishToUser(ctx, p, f)
	}
	return nil
}
