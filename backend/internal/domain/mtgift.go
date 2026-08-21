package domain

// Подарок за звёзды в форме оригинала — конструкторы схемы TL. Правила фазы 0 —
// в шапке mtmedia.go.
//
// ── Подарок — это ДЕЙСТВИЕ, а не вложение ───────────────────────────────────
// Долг, закрываемый этим шагом, назвал `gift` в одном ряду с гео, опросом и
// превью ссылки — как ещё один конструктор объединения MessageMedia. Проверка по
// схеме показала, что это НЕ ТАК, и разница принципиальная: конструктора
// messageMediaStarGift в схеме нет вовсе. Подарок приходит СЛУЖЕБНЫМ сообщением
// с действием messageActionStarGift — то есть пилюлей посреди ленты, а не
// баблом с вложением.
//
// Смысл совпадает с нашим: у сообщения типа 'gift' нет ни текста (текст дарителя
// живёт внутри подарка), ни медиа, ни разметки — это ровно то, что в схеме
// выражает выбор конструктора messageService. Поэтому подарок здесь становится
// действием, а поле `gift` уходит из объединения медиа, не появившись в нём.
//
// ── Что перестаёт ехать вместе с переводом ──────────────────────────────────
// `from_name` — имя дарителя строкой рядом с его id. Последний экземпляр
// display_name в этой подсистеме: имя собирает клиент из from_id, как везде
// после порта пиров. Анонимность при этом не страдает: у анонимного подарка
// read-модель не отдаёт from_id вовсе никому, кроме владельца.

// Значения дискриминатора `_` подсистемы подарка.
const (
	MessageActionStarGiftTag = "messageActionStarGift"
	StarGiftTag              = "starGift"
	SavedStarGiftTag         = "savedStarGift"
)

// starGift#313a9547 flags:# limited:flags.0?true sold_out:flags.1?true
// birthday:flags.2?true require_premium:flags.7?true
// limited_per_user:flags.8?true peer_color_available:flags.10?true
// auction:flags.11?true id:long sticker:Document stars:long
// availability_remains:flags.0?int availability_total:flags.0?int
// availability_resale:flags.4?long convert_stars:long first_sale_date:flags.1?int
// last_sale_date:flags.1?int upgrade_stars:flags.3?long
// resell_min_stars:flags.4?long title:flags.5?string released_by:flags.6?Peer
// … = StarGift;
//
// ПОЗИЦИЯ КАТАЛОГА: что именно подарено. Имя структуры совпадает с именем
// объединения (у StarGift их два — starGift и starGiftUnique, второго у нас
// нет), и имя `StarGift` в пакете занято плоской строкой каталога, поэтому
// структура зовётся MTStarGift — приём MTMessage/MTPoll.
//
// ── sticker: обязательный, предмета нет; вместо него наш emoji ──────────────
// В схеме внешность подарка — АНИМИРОВАННЫЙ СТИКЕР (sticker:Document), у нас —
// unicode-символ в колонке star_gifts.emoji. Это тот же случай, что emoji_status
// у пира и icon_emoji у темы форума: предмет «как выглядит» есть, а предмета
// «документ стикера» нет вовсе, и класть символ в поле документа нельзя — на
// фазе 2 кодек сломался бы молча.
//
// Поэтому sticker не производится (назван в «нет предмета»), а символ едет
// объявленным клиентским параметром emoji (schema_additional_params.json,
// предикат starGift).
//
// limited и пара availability_remains/availability_total делят ОДИН бит
// (flags.0): у оригинала они едут вместе или не едут вовсе, поэтому и
// выставляются одним решением — «подарок ограничен».
//
// Не производятся: birthday, require_premium, limited_per_user,
// peer_color_available, auction, availability_resale, resell_min_stars,
// upgrade_stars, first_sale_date/last_sale_date, released_by — механики нет ни у
// одного.
type MTStarGift struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	// Emoji — НАШ параметр: внешность подарка (см. докблок).
	Emoji string `json:"emoji,omitempty"`
	// Stars — обязательный: цена подарка.
	Stars int64 `json:"stars"`
	// AvailabilityRemains/Total — flags.0?int, парой с pFlags.limited.
	AvailabilityRemains int `json:"availability_remains,omitempty"`
	AvailabilityTotal   int `json:"availability_total,omitempty"`
	// ConvertStars — обязательный: во сколько звёзд обменивается подарок.
	ConvertStars int64 `json:"convert_stars"`
	// Title — flags.5?string.
	Title string `json:"title,omitempty"`
}

// NewStarGift — позиция каталога конструктором схемы.
func NewStarGift(g StarGift) MTStarGift {
	out := MTStarGift{
		Underscore:   StarGiftTag,
		ID:           g.ID,
		Emoji:        g.Emoji,
		Stars:        g.PriceStars,
		ConvertStars: g.ConvertStars,
		Title:        g.Title,
	}
	setPFlag(&out.PFlags, "sold_out", g.SoldOut)
	// Ограниченность и остаток — один бит на троих: либо подарок ограничен и
	// числа едут, либо ни того ни другого.
	if g.Total != nil {
		setPFlag(&out.PFlags, "limited", true)
		out.AvailabilityTotal = int(*g.Total)
		if g.Remains != nil {
			out.AvailabilityRemains = int(*g.Remains)
		}
	}
	return out
}

// messageActionStarGift#ea2c31d3 flags:# name_hidden:flags.0?true
// saved:flags.2?true converted:flags.3?true upgraded:flags.5?true
// refunded:flags.9?true can_upgrade:flags.10?true prepaid_upgrade:flags.13?true
// upgrade_separate:flags.16?true auction_acquired:flags.17?true gift:StarGift
// message:flags.1?TextWithEntities convert_stars:flags.4?long
// upgrade_msg_id:flags.5?int upgrade_stars:flags.8?long from_id:flags.11?Peer
// peer:flags.12?Peer saved_id:flags.12?long … = MessageAction;
//
// ПИЛЮЛЯ «вам подарили»: единственный обязательный параметр — сам подарок.
//
// Наш `hidden` (скрыт из профиля) — это ОТРИЦАНИЕ saved: в схеме флаг отвечает
// «сохранён в профиле», и класть его как есть нельзя, потому что pFlags несёт
// только true.
//
// peer и saved_id делят бит flags.12 и потому ставятся вместе: адрес подарка —
// это пара «чей профиль» + «какой из подарков», и порознь такой объект не
// соберётся.
//
// Не производятся: upgraded/upgrade_msg_id/upgrade_stars/can_upgrade/
// prepaid_upgrade/upgrade_separate (улучшения подарков нет), refunded,
// auction_acquired, gift_msg_id, to_id, gift_num.
type MessageActionStarGift struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// Gift — обязательный.
	Gift MTStarGift `json:"gift"`
	// Message — flags.1?TextWithEntities: пожелание дарителя.
	Message *TextWithEntities `json:"message,omitempty"`
	// ConvertStars — flags.4?long: во сколько звёзд владелец может обменять.
	ConvertStars int64 `json:"convert_stars,omitempty"`
	// FromID — flags.11?Peer: даритель. У анонимного подарка ключа нет вовсе —
	// это и есть pFlags.name_hidden, а не пустая карточка рядом с ним.
	FromID Peer `json:"from_id,omitempty"`
	// Peer/SavedID — flags.12: чей профиль и какой подарок (см. докблок).
	Peer    Peer  `json:"peer,omitempty"`
	SavedID int64 `json:"saved_id,omitempty"`
}

func (MessageActionStarGift) isMessageAction() {}
func (a MessageActionStarGift) Tag() string    { return a.Underscore }

// ToAction — ЕДИНСТВЕННЫЙ перевод выданного подарка в действие схемы.
func (g GiftInfo) ToAction() MessageActionStarGift {
	a := MessageActionStarGift{
		Underscore:   MessageActionStarGiftTag,
		Gift:         NewStarGift(g.Gift),
		ConvertStars: g.ConvertStars,
		SavedID:      g.ID,
	}
	if g.Message != "" {
		a.Message = NewTextWithEntities(g.Message, nil)
	}
	if g.FromID != nil {
		a.FromID = NewPeerUser(*g.FromID)
	}
	if g.OwnerID != 0 {
		a.Peer = NewPeerUser(g.OwnerID)
	}
	setPFlag(&a.PFlags, "name_hidden", g.Anonymous)
	setPFlag(&a.PFlags, "saved", !g.Hidden)
	setPFlag(&a.PFlags, "converted", g.Converted)
	return a
}

// savedStarGift#41df43fc flags:# name_hidden:flags.0?true unsaved:flags.5?true
// refunded:flags.9?true can_upgrade:flags.10?true pinned_to_top:flags.12?true
// upgrade_separate:flags.17?true from_id:flags.1?Peer date:int gift:StarGift
// message:flags.2?TextWithEntities msg_id:flags.3?int saved_id:flags.11?long
// convert_stars:flags.4?long … = SavedStarGift;
//
// ТОТ ЖЕ подарок, но в ВИТРИНЕ ПРОФИЛЯ, а не в ленте. Отдельный конструктор, а
// не переиспользование действия: у витрины профиля есть дата подарка (в ленте её
// несёт само сообщение) и нет привязки к сообщению.
//
// Наш `hidden` здесь называется unsaved и знака не меняет — в отличие от
// messageActionStarGift.saved, где тот же смысл выражен отрицанием. Это не наша
// вольность, а форма схемы.
//
// Не производятся: msg_id (номера сообщения-подарка витрина профиля не хранит),
// refunded, can_upgrade, pinned_to_top, upgrade_separate и остальные параметры
// улучшений/перепродажи — механики нет.
type SavedStarGift struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	FromID     Peer            `json:"from_id,omitempty"`
	// Date — обязательный: когда подарен, секунды эпохи.
	Date         int               `json:"date"`
	Gift         MTStarGift        `json:"gift"`
	Message      *TextWithEntities `json:"message,omitempty"`
	SavedID      int64             `json:"saved_id,omitempty"`
	ConvertStars int64             `json:"convert_stars,omitempty"`
}

// ToSaved — тот же подарок для витрины профиля.
func (g GiftInfo) ToSaved() SavedStarGift {
	out := SavedStarGift{
		Underscore:   SavedStarGiftTag,
		Date:         unixSeconds(g.Date),
		Gift:         NewStarGift(g.Gift),
		SavedID:      g.ID,
		ConvertStars: g.ConvertStars,
	}
	if g.Message != "" {
		out.Message = NewTextWithEntities(g.Message, nil)
	}
	if g.FromID != nil {
		out.FromID = NewPeerUser(*g.FromID)
	}
	setPFlag(&out.PFlags, "name_hidden", g.Anonymous)
	setPFlag(&out.PFlags, "unsaved", g.Hidden)
	return out
}
