package domain

// Розыгрыш в форме оригинала — конструкторы схемы TL. Правила фазы 0 — в шапке
// mtmedia.go.
//
// До этого шага розыгрыш ехал собственным ключом `giveaway` строки витрины,
// записью GiveawayInfo, где в ОДНОМ объекте лежали три разных предмета:
//
//  1. условия розыгрыша (канал, приз, число победителей, срок) — одинаковы для
//     всех и не меняются;
//  2. итоги (кто выиграл) — появляются один раз, тоже одинаковы для всех;
//  3. ЛИЧНОЕ состояние зрителя (участвую ли, выиграл ли) — своё у каждого.
//
// В схеме первые два — РАЗНЫЕ конструкторы одного объединения MessageMedia
// (messageMediaGiveaway до розыгрыша, messageMediaGiveawayResults после), а
// третий вообще не является частью сообщения: он приходит отдельным ответом
// payments.giveawayInfo/giveawayInfoResults на явный запрос. Наше `status:
// "active"|"finished"` — это ВЫБОР конструктора, а не значение поля, ровно как
// «служебное ли» у самого сообщения.
//
// Практическое следствие: `participating` уходит из бабла. У оригинала бабл
// розыгрыша НЕ ЗНАЕТ, участвует ли зритель, — это выясняет попап, дёргая
// payments.getGiveawayInfo (tweb popupGiveaway). Оставить флаг в media значило
// бы держать в общем на всех теле кадра значение, своё у каждого получателя, —
// та же ловушка, что уже поймана у pFlags.out.

// Значения дискриминатора `_` подсистемы розыгрыша.
const (
	MessageMediaGiveawayTag        = "messageMediaGiveaway"
	MessageMediaGiveawayResultsTag = "messageMediaGiveawayResults"
	GiveawayInfoTag                = "payments.giveawayInfo"
	GiveawayInfoResultsTag         = "payments.giveawayInfoResults"
)

// messageMediaGiveaway#aa073beb flags:# only_new_subscribers:flags.0?true
// winners_are_visible:flags.2?true channels:Vector<long>
// countries_iso2:flags.1?Vector<string> prize_description:flags.3?string
// quantity:int months:flags.4?int stars:flags.5?long until_date:int
// = MessageMedia;
//
// ИДУЩИЙ розыгрыш.
//
// Наш `prize_kind: "premium"|"stars"` в схеме не существует: вид приза выражен
// тем, КАКОЙ из двух параметров присутствует — months (срок подписки) или stars
// (звёзды каждому победителю). Строковый дискриминатор рядом с обоими значениями
// был бы третьим ответом на тот же вопрос.
//
// winners_are_visible выставляется всегда: список победителей у нас виден всем и
// едет тем же сообщением после розыгрыша (см. messageMediaGiveawayResults).
//
// ── id: НАШ параметр вне схемы, долг АДРЕСАЦИИ ──────────────────────────────
// Идентификатора у конструктора нет, потому что у оригинала участие в розыгрыше
// это ПОДПИСКА НА КАНАЛ — отдельного объекта, который надо адресовать, там нет
// вовсе. У нас розыгрыш — строка giveaways, и ручка участия принимает её ключ.
// Тот же долг и тот же способ, что у todoList.id (mttodo.go).
//
// Не производятся: only_new_subscribers (участвуют все подписчики),
// countries_iso2 (ограничения по стране нет), prize_description (произвольного
// описания приза не храним).
type MessageMediaGiveaway struct {
	Underscore string          `json:"_"`
	ID         int64           `json:"id"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// Channels — обязательный вектор каналов розыгрыша (у нас всегда один).
	// Числа те же, что в peerChannel.channel_id, — без знака.
	Channels []int64 `json:"channels"`
	// Quantity — обязательный: сколько будет победителей.
	Quantity int `json:"quantity"`
	// Months — flags.4?int: срок premium-подписки. Едет только у premium-приза.
	Months int `json:"months,omitempty"`
	// Stars — flags.5?long: звёзд каждому победителю. Едет только у ⭐-приза.
	Stars int64 `json:"stars,omitempty"`
	// UntilDate — обязательный: когда розыгрыш состоится, секунды эпохи.
	UntilDate int `json:"until_date"`
}

func (MessageMediaGiveaway) isMessageMedia() {}
func (m MessageMediaGiveaway) Tag() string   { return m.Underscore }

// messageMediaGiveawayResults#ceaa3ea1 flags:# only_new_subscribers:flags.0?true
// refunded:flags.2?true channel_id:long additional_peers_count:flags.3?int
// launch_msg_id:int winners_count:int unclaimed_count:int winners:Vector<long>
// months:flags.4?int stars:flags.5?long prize_description:flags.1?string
// until_date:int = MessageMedia;
//
// СОСТОЯВШИЙСЯ розыгрыш: тот же приз плюс список победителей.
//
// launch_msg_id — номер сообщения, которым розыгрыш ЗАПУЩЕН. У оригинала итоги
// приходят ОТДЕЛЬНЫМ сообщением, и параметр указывает на первое; у нас розыгрыш
// живёт одним сообщением, которое меняет вид, поэтому здесь стоит номер этого же
// сообщения — ссылка остаётся верной, а второго сообщения не выдумывается.
//
// unclaimed_count (сколько призов не забрали) едет нулём, и это ЗНАЧЕНИЕ, а не
// заглушка: у нас приз начисляется победителю сразу (premium-подписка либо
// звёзды), забирать по коду нечего.
//
// «Выиграл ли ЗРИТЕЛЬ» отдельным ключом не едет: он есть в векторе winners, и
// клиент отвечает на этот вопрос сам — ровно как на «моя ли реакция» и «моё ли
// сообщение».
//
// Не производятся: refunded (возврата у нас нет), additional_peers_count
// (дополнительных каналов розыгрыша нет), а also only_new_subscribers,
// prize_description — как у messageMediaGiveaway.
type MessageMediaGiveawayResults struct {
	Underscore string          `json:"_"`
	ID         int64           `json:"id"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ChannelID  int64           `json:"channel_id"`
	// LaunchMsgID — обязательный: номер сообщения-запуска.
	LaunchMsgID  int64 `json:"launch_msg_id"`
	WinnersCount int   `json:"winners_count"`
	// UnclaimedCount — обязательный, всегда 0 (см. докблок).
	UnclaimedCount int `json:"unclaimed_count"`
	// Winners — обязательный вектор id победителей. Едет пустым, если в
	// розыгрыше не было ни одного участника.
	Winners   []int64 `json:"winners"`
	Months    int     `json:"months,omitempty"`
	Stars     int64   `json:"stars,omitempty"`
	UntilDate int     `json:"until_date"`
}

func (MessageMediaGiveawayResults) isMessageMedia() {}
func (m MessageMediaGiveawayResults) Tag() string   { return m.Underscore }

// ToMedia — ЕДИНСТВЕННЫЙ перевод розыгрыша в конструктор схемы. Выбор
// конструктора делает статус: идущий розыгрыш и состоявшийся — разные формы, а
// не одна форма с полем.
//
// launchSeq — номер сообщения розыгрыша В ЕГО чате (messageMediaGiveawayResults.
// launch_msg_id). Ноль означает «сообщение неизвестно» и бывает у кадра
// giveaway_update, который рассылается сам по себе.
func (g GiveawayInfo) ToMedia(launchSeq int64) MessageMedia {
	months, stars := g.prize()
	if g.Status != "finished" {
		out := &MessageMediaGiveaway{
			Underscore: MessageMediaGiveawayTag,
			ID:         g.ID,
			Channels:   []int64{g.PeerID.ToChatID()},
			Quantity:   g.WinnersCount,
			Months:     months,
			Stars:      stars,
			UntilDate:  int(g.UntilDate / 1000),
		}
		setPFlag(&out.PFlags, "winners_are_visible", true)
		return out
	}
	return &MessageMediaGiveawayResults{
		Underscore:     MessageMediaGiveawayResultsTag,
		ID:             g.ID,
		ChannelID:      g.PeerID.ToChatID(),
		LaunchMsgID:    launchSeq,
		WinnersCount:   g.WinnersCount,
		UnclaimedCount: 0,
		Winners:        orEmpty(g.WinnerIDs),
		Months:         months,
		Stars:          stars,
		UntilDate:      int(g.UntilDate / 1000),
	}
}

// prize — приз в форме схемы: ровно один из months/stars, второй нулевой (и
// потому не едет). Наш prize_kind на провод не выходит вовсе.
func (g GiveawayInfo) prize() (months int, stars int64) {
	if g.PrizeKind == "stars" {
		return 0, g.Stars
	}
	return g.Months, 0
}

// ── payments.GiveawayInfo: ЛИЧНОЕ состояние зрителя ─────────────────────────

// GiveawayState — объединение схемы payments.GiveawayInfo: payments.giveawayInfo
// (розыгрыш идёт) | payments.giveawayInfoResults (розыгрыш состоялся). Ответ на
// вопрос «а что с этим розыгрышем у МЕНЯ», который у оригинала задаётся
// отдельным методом и в сообщение не попадает.
//
// Имя типа не повторяет имя объединения: `GiveawayInfo` в пакете занято
// read-моделью, которая живёт ещё один шаг.
type GiveawayState interface {
	isGiveawayState()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// payments.giveawayInfo#4367daa0 flags:# participating:flags.0?true
// preparing_results:flags.3?true start_date:int
// joined_too_early_date:flags.1?int admin_disallowed_chat_id:flags.2?long
// disallowed_country:flags.4?string = payments.GiveawayInfo;
//
// Состояние ИДУЩЕГО розыгрыша глазами зрителя.
//
// participants — НАШ параметр вне схемы (schema_additional_params.json,
// предикат payments.giveawayInfo). Предмета у него нет: оригинал числа
// участников не показывает вовсе — участие там это подписка на канал, и
// счётчиком служит число подписчиков. У нас участие отдельное
// (giveaway_participants), и счётчик показывается в попапе.
//
// Не производятся: preparing_results («победители определяются» — у нас
// розыгрыш происходит одним действием), joined_too_early_date,
// admin_disallowed_chat_id, disallowed_country — причин отказа в участии,
// кроме «не подписан», у нас нет.
type GiveawayStateActive struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// StartDate — обязательный: когда розыгрыш запущен, секунды эпохи.
	StartDate int `json:"start_date"`
	// Participants — наш параметр: сколько человек участвует.
	Participants int `json:"participants"`
}

func (GiveawayStateActive) isGiveawayState() {}
func (g GiveawayStateActive) Tag() string    { return g.Underscore }

// payments.giveawayInfoResults#e175e66f flags:# winner:flags.0?true
// refunded:flags.1?true start_date:int gift_code_slug:flags.3?string
// stars_prize:flags.4?long finish_date:int winners_count:int
// activated_count:flags.2?int = payments.GiveawayInfo;
//
// Состояние СОСТОЯВШЕГОСЯ розыгрыша глазами зрителя: главное здесь — winner,
// «выиграл ли я».
//
// Не производятся: refunded, gift_code_slug (кодов активации у нас нет — приз
// начисляется сразу), activated_count (по той же причине).
type GiveawayStateResults struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	StartDate  int             `json:"start_date"`
	// StarsPrize — flags.4?long: звёзд победителю. Едет только у ⭐-приза.
	StarsPrize int64 `json:"stars_prize,omitempty"`
	// FinishDate — обязательный: когда розыгрыш состоялся.
	FinishDate   int `json:"finish_date"`
	WinnersCount int `json:"winners_count"`
	// Participants — наш параметр, тот же, что у payments.giveawayInfo.
	Participants int `json:"participants"`
}

func (GiveawayStateResults) isGiveawayState() {}
func (g GiveawayStateResults) Tag() string    { return g.Underscore }

// ToState — личное состояние зрителя конструктором схемы. Второй перевод того
// же представления, но ДРУГОГО предмета: ToMedia отвечает «что за розыгрыш»,
// ToState — «что с ним у меня».
func (g GiveawayInfo) ToState() GiveawayState {
	if g.Status != "finished" {
		out := &GiveawayStateActive{
			Underscore:   GiveawayInfoTag,
			StartDate:    int(g.StartDate / 1000),
			Participants: g.Participants,
		}
		setPFlag(&out.PFlags, "participating", g.Participating)
		return out
	}
	_, stars := g.prize()
	out := &GiveawayStateResults{
		Underscore:   GiveawayInfoResultsTag,
		StartDate:    int(g.StartDate / 1000),
		StarsPrize:   stars,
		FinishDate:   int(g.UntilDate / 1000),
		WinnersCount: g.WinnersCount,
		Participants: g.Participants,
	}
	setPFlag(&out.PFlags, "winner", g.IWon)
	return out
}
