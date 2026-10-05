package chat

import (
	"context"
	"errors"

	"github.com/messenger-denis/backend/internal/domain"
)

// manageTarget — общий гейт действий над ЧУЖИМ участником: повысить, снять,
// исключить, забанить, ограничить. Актор должен иметь право need, а цель —
// быть ему подвластна:
//   - цель не сам актор;
//   - цель не владелец (его не трогает никто);
//   - чужого админа правит только владелец или тот, кто его назначил (tweb
//     canEditAdmin: creator ∨ promoted_by == я; у Telegram — USER_ADMIN_INVALID);
//   - requireMember — цель обязана быть участником (иначе domain.ErrNotFound,
//     у Telegram USER_NOT_PARTICIPANT); бан бывает и не-участнику.
//
// Прежде гейт смотрел только право актора: админ с одним add_admins выдавал
// себе всё и снимал владельца, а админ с ban_users выгонял владельца и старших
// админов.
//
// target — нулевой Member, если цель не участник (и requireMember=false).
func (i *Interactor) manageTarget(ctx context.Context, chatID, actorID, targetID int64, need domain.Rights, requireMember bool) (actor, target domain.Member, err error) {
	if i.groups == nil {
		return actor, target, domain.ErrForbidden
	}
	actor, err = i.groups.GetMember(ctx, chatID, actorID)
	if err != nil || !domain.HasRight(actor.Role, actor.Rights, need) {
		return actor, target, domain.ErrForbidden
	}
	if targetID == actorID {
		return actor, target, domain.ErrForbidden
	}
	target, err = i.groups.GetMember(ctx, chatID, targetID)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		if requireMember {
			return actor, domain.Member{}, domain.ErrNotFound
		}
		return actor, domain.Member{}, nil
	case err != nil:
		return actor, target, err
	}
	if target.Role == domain.RoleCreator {
		return actor, target, domain.ErrForbidden
	}
	if target.Role == domain.RoleAdmin && actor.Role != domain.RoleCreator && target.PromotedBy != actorID {
		return actor, target, domain.ErrForbidden
	}
	return actor, target, nil
}
