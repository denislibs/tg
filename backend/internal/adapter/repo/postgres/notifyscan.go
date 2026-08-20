package postgres

import (
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Чтение пер-чатных настроек уведомлений в форме КОНСТРУКТОРА
// peerNotifySettings — один сборщик на все репозитории, которые их отдают
// (список диалогов, карточка чата, гейт пуша, профиль).
//
// Раньше на этот вопрос отвечали пять копий одного SQL-условия
// (`muted OR (muted_until IS NOT NULL AND muted_until > now())` в
// chatsrepo/pushrepo/grouprepo × 3), и каждая могла разъехаться молча. Теперь в
// SQL едет СРОК, а «замьючен ли сейчас» решает единственный предикат
// domain.PeerNotifySettings.Muted.

// peerNotifySettings собирает конструктор из трёх нуллабельных колонок
// chat_members. NULL везде означает одно и то же — «переопределения для этого
// пира нет, действует настройка типа чата», — и потому даёт пустой конструктор,
// а не выдуманные значения по умолчанию.
func peerNotifySettings(muteUntil *time.Time, preview *bool, sound *string, now time.Time) domain.PeerNotifySettings {
	var until time.Time
	if muteUntil != nil {
		// Истёкший срок хранить незачем: замьюченным чат уже не считается, а на
		// проводе прошлое время сбивало бы клиент с толку (он заводит по нему
		// таймер снятия мьюта). Ноль — это «мьюта нет» явным ответом.
		if muteUntil.After(now) {
			until = *muteUntil
		} else {
			until = time.Unix(domain.MuteUntilNever, 0)
		}
	}
	return domain.NewPeerNotifySettings(until, preview, notificationSound(sound))
}

// notificationSound — наш chat_members.notify_sound как ОБЪЕДИНЕНИЕ схемы, а не
// строка. NULL — переопределения нет; неизвестное значение тоже даёт nil:
// выдумывать конструктор под строку, которой в схеме не соответствует ничего,
// хуже, чем промолчать.
//
// 'none' — это notificationSoundNone, а НЕ silent, и разница существенна: silent
// участвует в предикате «замьючен» оригинала (appNotificationsManager.ts:255),
// а наше 'none' описано как беззвучное уведомление БЕЗ полного мьюта. Смапив в
// silent, мы выкинули бы такие чаты из счётчика непрочитанного и повесили на них
// иконку мьюта.
func notificationSound(sound *string) domain.NotificationSound {
	if sound == nil {
		return nil
	}
	switch *sound {
	case "default":
		return domain.NewNotificationSoundDefault()
	case "none":
		return domain.NewNotificationSoundNone()
	}
	return nil
}
