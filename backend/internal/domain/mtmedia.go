package domain

// Медиа сообщения в форме оригинала — структуры схемы TL (MTProto), а не
// плоский набор полей и не собственный формат.
//
// Фаза 0 перехода на TL: имена конструкторов и полей берутся из схемы
// БУКВАЛЬНО (tweb/src/lib/mtproto/schema.ts), сериализация пока JSON. Поэтому
// переход к бинарному TL станет заменой сериализатора, а не переделкой модели.
//
// Зачем. Плоская форма (media_w/media_h/media_blur/media_mime/…) отвечает ровно
// на те вопросы, которые мы догадались задать: лестницы превью в ней нет, тип
// документа приходится подделывать флагами на стороне клиента, а векторный
// контур стикера не помещается вовсе. Врапперы tweb
// (wrapPhoto/wrapVideo/wrapSticker/wrapDocument/wrapAlbum) написаны против этой
// модели — при совпадении формы они портируются буквально.
//
// ── Правила фазы 0 ──────────────────────────────────────────────────────────
//   - у каждого объекта есть дискриминатор `_` со значением predicate схемы;
//   - необязательность кодируется ОТСУТСТВИЕМ поля (в TL это бит flags), а не
//     null и не пустым значением: иначе на фазе бинарного кодека поведение
//     поедет. Поэтому обязательные по схеме поля сериализуются всегда, даже
//     нулевые, а flags-поля — только когда есть;
//   - поля `flags` в объекте НЕТ: битовая маска живёт только на проводе, а
//     кодек считает её из присутствия полей (tweb tl_utils.ts:360-405, :747 —
//     «will use local flags storage to avoid passing 'flags' property»);
//   - булевы флаги схемы (`flags.N?true`) собраны в под-объект `pFlags` и
//     всегда несут `true`; «выключено» — это ОТСУТСТВИЕ ключа, поэтому в
//     PFlags никогда не кладётся false (держит TestPFlagsNeverFalse);
//   - у каждого конструктора СВОЯ структура: один общий тип с omitempty не
//     смог бы отличить «size обязателен и равен нулю» (photoSize) от «size
//     здесь нет вовсе» (photoStrippedSize).
//
// ── MessageMedia — ОБЪЕДИНЕНИЕ, а не одна структура ─────────────────────────
// До этого шага здесь жила ОДНА структура MessageMedia с полями photo и
// document, и правило «у каждого конструктора своя структура» на неё не
// распространялось: два конструктора умещались в один тип, потому что оба
// несут ровно одно необязательное поле.
//
// Дотянуть тем же приёмом до гео, контакта, опроса, чек-листа, розыгрыша,
// превью ссылки и платного медиа невозможно, и причина не в аккуратности:
// у messageMediaContact ОБЯЗАТЕЛЬНЫ phone_number/first_name/last_name/vcard/
// user_id, у messageMediaGiveaway — channels/quantity/until_date. Общая
// структура с omitempty выкинула бы пустое обязательное поле (last_name у
// контакта без фамилии, quantity=0), то есть выдала бы «параметра нет вовсе»
// там, где схема требует «параметр есть и он пуст». На фазе 2 это разъехалось
// бы побайтово. Поэтому объединение стало интерфейсом, как MTMessage,
// MessageAction и ReplyMarkup.
//
// ── Чего в модели НЕТ и почему ───────────────────────────────────────────────
// Реквизиты MTProto-транспорта: у них нет предмета в нашей схеме доступа —
// файл адресуется одним числовым id через собственный медиа-эндпоинт:
//   - dc_id                 — номер датацентра MTProto-хранилища;
//   - access_hash           — токен доступа к файлу (и к точке geoPoint);
//   - file_reference        — протухающая ссылка, обновляемая getMessages;
//   - date                  — дата файла (у нас — дата сообщения);
//   - семейство Input*      — реквизиты того же транспорта (в т.ч.
//     documentAttributeSticker.stickerset: InputStickerSet — набор у нас
//     адресуется числовым set_id через свою ручку).
//
// Также не производятся (но объявлены, потому что кодек фазы 2 обязан их
// понимать) варианты PhotoSize без предмета в нашем хранилище:
// photoSizeProgressive (диапазоны байт), photoCachedSize (его роль целиком
// несёт photoStrippedSize), photoSizeEmpty.

// PhotoSize — объединение схемы: photoSizeEmpty | photoSize | photoCachedSize |
// photoStrippedSize | photoSizeProgressive | photoPathSize.
type PhotoSize interface{ isPhotoSize() }

// Буквы размеров (поле type у всех конструкторов PhotoSize).
const (
	SizeTypeStripped = "i" // stripped-плейсхолдер
	SizeTypePath     = "j" // векторный контур
	SizeTypeThumb    = "y" // серверное превью (≤ ThumbMaxSide)
	SizeTypeFull     = "w" // оригинал
)

// ThumbMaxSide — длинная сторона серверного превью (ffmpeg-процессор,
// thumbMaxSide). Ступень 'y' вписана в этот квадрат с сохранением пропорции,
// поэтому её w/h вычисляются, а не хранятся отдельной колонкой.
const ThumbMaxSide = 1280

// photoSize#75c78e60 type:string w:int h:int size:int = PhotoSize;
type PhotoSizeReal struct {
	Underscore string `json:"_"`
	Type       string `json:"type"`
	W          int    `json:"w"`
	H          int    `json:"h"`
	Size       int64  `json:"size"`
}

func (PhotoSizeReal) isPhotoSize() {}

// NewPhotoSize — photoSize с обязательными w/h/size (сериализуются и нулевыми).
func NewPhotoSize(sizeType string, w, h int, size int64) PhotoSizeReal {
	return PhotoSizeReal{Underscore: PhotoSizeTag, Type: sizeType, W: w, H: h, Size: size}
}

// photoStrippedSize#e0b0bc2e type:string bytes:bytes = PhotoSize;
type PhotoStrippedSize struct {
	Underscore string `json:"_"`
	Type       string `json:"type"`
	Bytes      []byte `json:"bytes"`
}

func (PhotoStrippedSize) isPhotoSize() {}

// NewPhotoStrippedSize — stripped-плейсхолдер (у нас — media.blur_preview).
func NewPhotoStrippedSize(b []byte) PhotoStrippedSize {
	return PhotoStrippedSize{Underscore: PhotoStrippedSizeTag, Type: SizeTypeStripped, Bytes: b}
}

// photoPathSize#d8214d41 type:string bytes:bytes = PhotoSize;
type PhotoPathSize struct {
	Underscore string `json:"_"`
	Type       string `json:"type"`
	Bytes      []byte `json:"bytes"`
}

func (PhotoPathSize) isPhotoSize() {}

// NewPhotoPathSize — векторный контур стикера (у нас — stickers.path_thumb).
func NewPhotoPathSize(b []byte) PhotoPathSize {
	return PhotoPathSize{Underscore: PhotoPathSizeTag, Type: SizeTypePath, Bytes: b}
}

// photo#fb197a65 flags:# has_stickers:flags.0?true id:long access_hash:long
// file_reference:bytes date:int sizes:Vector<PhotoSize>
// video_sizes:flags.1?Vector<VideoSize> dc_id:int = Photo;
type Photo struct {
	Underscore string      `json:"_"`
	ID         int64       `json:"id"`
	Sizes      []PhotoSize `json:"sizes"`
}

// NewPhoto — photo с обязательной лестницей размеров.
func NewPhoto(id int64, sizes []PhotoSize) *Photo {
	return &Photo{Underscore: PhotoTag, ID: id, Sizes: sizes}
}

// DocumentAttribute — объединение схемы (Video | Audio | Sticker | Filename |
// ImageSize | Animated в нашем периметре).
type DocumentAttribute interface{ isDocumentAttribute() }

// documentAttributeImageSize#6c37c15c w:int h:int = DocumentAttribute;
type DocumentAttributeImageSize struct {
	Underscore string `json:"_"`
	W          int    `json:"w"`
	H          int    `json:"h"`
}

func (DocumentAttributeImageSize) isDocumentAttribute() {}

// documentAttributeAnimated#11b58939 = DocumentAttribute;
type DocumentAttributeAnimated struct {
	Underscore string `json:"_"`
}

func (DocumentAttributeAnimated) isDocumentAttribute() {}

// documentAttributeSticker#6319d612 flags:# mask:flags.1?true alt:string
// stickerset:InputStickerSet mask_coords:flags.0?MaskCoords = DocumentAttribute;
//
// stickerset производится. Здесь сначала было записано обратное — «семейство
// Input* того же транспорта, набор адресуется числовым set_id через свою
// ручку», — и вывод оказался неверным: транспортный в этом конструкторе
// `access_hash`, а вопрос «какому набору принадлежит стикер» предмет имеет, это
// наш `set_id`. Пока параметр не производился, ради того же ответа
// существовала целая ручка обратного поиска (`GET /stickers/by-media/{id}`),
// которой у оригинала нет вовсе: там документ несёт набор в себе, а tweb
// держит его разобранным в клиентском параметре `stickerSetInput`
// (schema_additional_params.json). Разбор — tl-stickers-analysis.md, Р3.
//
// Значение — `inputStickerSetID{id, access_hash}`; `access_hash` идёт нулём
// (общее правило фазы 2: обязательный параметр без предмета — заглушка, и её
// надо назвать). Набора нет — `inputStickerSetEmpty`, а не отсутствие ключа:
// параметр в схеме обязательный.
type DocumentAttributeSticker struct {
	Underscore string          `json:"_"`
	Alt        string          `json:"alt"`
	Stickerset InputStickerSet `json:"stickerset"`
}

func (DocumentAttributeSticker) isDocumentAttribute() {}

// documentAttributeVideo#43c57c48 flags:# round_message:flags.0?true
// supports_streaming:flags.1?true nosound:flags.3?true duration:double w:int
// h:int … = DocumentAttribute;
//
// PFlags несёт только те биты, для которых у нас есть источник: round_message
// (тип сообщения). supports_streaming и nosound источника пока не имеют —
// стримингом владеет клиент (resolveStreamUrl), а наличие аудиодорожки
// процессор сводит в один признак animated (см. ниже), поэтому эти биты не
// объявляются вовсе, а не выставляются наугад.
type DocumentAttributeVideo struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Duration   float64         `json:"duration"`
	W          int             `json:"w"`
	H          int             `json:"h"`
}

func (DocumentAttributeVideo) isDocumentAttribute() {}

// documentAttributeAudio#9852f9c6 flags:# voice:flags.10?true duration:int
// title:flags.0?string performer:flags.1?string waveform:flags.2?bytes
// = DocumentAttribute;
type DocumentAttributeAudio struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Duration   int             `json:"duration"`
	Title      string          `json:"title,omitempty"`
	Performer  string          `json:"performer,omitempty"`
	Waveform   []byte          `json:"waveform,omitempty"`
}

func (DocumentAttributeAudio) isDocumentAttribute() {}

// documentAttributeFilename#15590068 file_name:string = DocumentAttribute;
type DocumentAttributeFilename struct {
	Underscore string `json:"_"`
	FileName   string `json:"file_name"`
}

func (DocumentAttributeFilename) isDocumentAttribute() {}

// document#8fd4c4d8 flags:# id:long access_hash:long file_reference:bytes
// date:int mime_type:string size:long thumbs:flags.0?Vector<PhotoSize>
// video_thumbs:flags.1?Vector<VideoSize> dc_id:int
// attributes:Vector<DocumentAttribute> = Document;
//
// Поля-подсказки типа (type/w/h/duration/file_name) в схеме отсутствуют —
// в оригинале их дописывает КЛИЕНТ (appDocsManager.saveDoc) из attributes и
// mime_type. Мы их и не отдаём: иначе это был бы ровно тот подделанный флаг,
// ради которого всё и затевалось.
type Document struct {
	Underscore string              `json:"_"`
	ID         int64               `json:"id"`
	MimeType   string              `json:"mime_type"`
	Size       int64               `json:"size"`
	Thumbs     []PhotoSize         `json:"thumbs,omitempty"`
	Attributes []DocumentAttribute `json:"attributes"`
}

// ── MessageMedia ────────────────────────────────────────────────────────────

// MessageMedia — объединение схемы: вложение сообщения. Производим двенадцать
// конструкторов из девятнадцати; не производим те, у которых нет предмета:
// messageMediaEmpty и messageMediaUnsupported (двух степеней полноты объекта у
// нас нет), messageMediaGame, messageMediaInvoice, messageMediaDice,
// messageMediaStory, messageMediaVideoStream.
type MessageMedia interface {
	isMessageMedia()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_`.
const (
	MessageMediaPhotoTag           = "messageMediaPhoto"
	MessageMediaDocumentTag        = "messageMediaDocument"
	MessageMediaGeoTag             = "messageMediaGeo"
	MessageMediaGeoLiveTag         = "messageMediaGeoLive"
	MessageMediaVenueTag           = "messageMediaVenue"
	MessageMediaContactTag         = "messageMediaContact"
	MessageMediaPaidMediaTag       = "messageMediaPaidMedia"
	MessageExtendedMediaTag        = "messageExtendedMedia"
	MessageExtendedMediaPreviewTag = "messageExtendedMediaPreview"
	GeoPointTag                    = "geoPoint"
	PhotoTag                       = "photo"
	DocumentTag                    = "document"
	PhotoSizeTag                   = "photoSize"
	PhotoStrippedSizeTag           = "photoStrippedSize"
	PhotoPathSizeTag               = "photoPathSize"
	AttrImageSize                  = "documentAttributeImageSize"
	AttrAnimated                   = "documentAttributeAnimated"
	AttrSticker                    = "documentAttributeSticker"
	AttrVideo                      = "documentAttributeVideo"
	AttrAudio                      = "documentAttributeAudio"
	AttrFilename                   = "documentAttributeFilename"
)

// messageMediaPhoto#e216eb63 flags:# spoiler:flags.3?true live_photo:flags.4?true
// photo:flags.0?Photo ttl_seconds:flags.2?int video:flags.4?Document
// = MessageMedia;
//
// Картинка, снятая КАК ФОТОГРАФИЯ: лестница размеров, без mime и имени файла.
//
// ttl_seconds здесь не производится намеренно: срок самоуничтожения у нас на
// СООБЩЕНИИ (messages.ttl_seconds → message.ttl_period), а не на вложении, и
// второе место для того же значения — ровно тот второй источник истины, ради
// которого делается переход. live_photo и video (живое фото iOS) предмета не
// имеют.
type MessageMediaPhoto struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Photo      *Photo          `json:"photo,omitempty"`
}

func (MessageMediaPhoto) isMessageMedia() {}
func (m MessageMediaPhoto) Tag() string   { return m.Underscore }

// NewMessageMediaPhoto — фотография; spoiler это свойство вложения В ЭТОМ
// сообщении, а не файла.
func NewMessageMediaPhoto(photo *Photo, spoiler bool) *MessageMediaPhoto {
	m := &MessageMediaPhoto{Underscore: MessageMediaPhotoTag, Photo: photo}
	setPFlag(&m.PFlags, "spoiler", spoiler)
	return m
}

// messageMediaDocument#52d8ccd9 flags:# nopremium:flags.3?true
// spoiler:flags.4?true video:flags.6?true round:flags.7?true voice:flags.8?true
// document:flags.0?Document alt_documents:flags.5?Vector<Document>
// video_cover:flags.9?Photo video_timestamp:flags.10?int
// ttl_seconds:flags.2?int = MessageMedia;
//
// Биты-подсказки video/round/voice (flags.6/7/8) не выставляются: тип документа
// выводится из его атрибутов, как в appDocsManager. Дублировать вывод вторым
// источником — это и есть та подделка флага, которую модель устраняет.
type MessageMediaDocument struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Document   *Document       `json:"document,omitempty"`
}

func (MessageMediaDocument) isMessageMedia() {}
func (m MessageMediaDocument) Tag() string   { return m.Underscore }

// NewMessageMediaDocument — документ (всё, что не снято как фотография).
func NewMessageMediaDocument(doc *Document, spoiler bool) *MessageMediaDocument {
	m := &MessageMediaDocument{Underscore: MessageMediaDocumentTag, Document: doc}
	setPFlag(&m.PFlags, "spoiler", spoiler)
	return m
}

// ── Гео ─────────────────────────────────────────────────────────────────────

// geoPoint#b2a2f663 flags:# long:double lat:double access_hash:long
// accuracy_radius:flags.0?int = GeoPoint;
//
// ТОЧКА, общая для трёх конструкторов гео. Параметр называется `long` (долгота),
// а не `lng`: имя берётся из схемы буквально.
//
// access_hash (ОБЯЗАТЕЛЬНЫЙ) — реквизит MTProto-транспорта, которым оригинал
// подписывает запрос картинки карты в своём прокси; у нас карту рисует клиент
// по координатам, и предмета у токена нет. accuracy_radius (точность
// геолокации) браузерного watchPosition мы не сохраняем.
type GeoPoint struct {
	Underscore string  `json:"_"`
	Long       float64 `json:"long"`
	Lat        float64 `json:"lat"`
}

// NewGeoPoint — точка на карте. Оба параметра обязательные и едут всегда.
func NewGeoPoint(lat, lng float64) GeoPoint {
	return GeoPoint{Underscore: GeoPointTag, Long: lng, Lat: lat}
}

// messageMediaGeo#56e0d474 geo:GeoPoint = MessageMedia;
//
// Обычная точка: ни названия места, ни трансляции.
type MessageMediaGeo struct {
	Underscore string   `json:"_"`
	Geo        GeoPoint `json:"geo"`
}

func (MessageMediaGeo) isMessageMedia() {}
func (m MessageMediaGeo) Tag() string   { return m.Underscore }

func NewMessageMediaGeo(lat, lng float64) *MessageMediaGeo {
	return &MessageMediaGeo{Underscore: MessageMediaGeoTag, Geo: NewGeoPoint(lat, lng)}
}

// messageMediaGeoLive#b940c666 flags:# geo:GeoPoint heading:flags.0?int
// period:int proximity_notification_radius:flags.1?int = MessageMedia;
//
// ЖИВАЯ ТРАНСЛЯЦИЯ координат.
//
// ── «Остановлена» — это period, а не отдельный флаг ─────────────────────────
// У нас в geo_meta лежит `stopped bool`, и на проводе он ехал собственным
// ключом. В схеме такого параметра НЕТ, и подделывать его нечем: оригинал
// выражает конец трансляции ИСТЕЧЕНИЕМ срока — клиент считает
// `date + period <= now` и рисует «трансляция закончилась» (tweb geo.ts:178-179,
// isLiveExpired). Досрочная остановка у оригинала правит сообщение так, что
// срок истекает сразу.
//
// Поэтому досрочно остановленная трансляция едет с period, УКОРОЧЕННЫМ до
// момента остановки (edit_date − date): смысл сохраняется целиком, а второго
// способа ответить на вопрос «идёт ли трансляция» на проводе не появляется.
//
// proximity_notification_radius (уведомление о приближении) механики не имеет.
type MessageMediaGeoLive struct {
	Underscore string   `json:"_"`
	Geo        GeoPoint `json:"geo"`
	// Heading — flags.0?int: направление движения, 0..359.
	Heading int `json:"heading,omitempty"`
	// Period — обязательный: сколько секунд от даты сообщения трансляция живёт.
	Period int `json:"period"`
}

func (MessageMediaGeoLive) isMessageMedia() {}
func (m MessageMediaGeoLive) Tag() string   { return m.Underscore }

// NewMessageMediaGeoLive — живая трансляция. heading == 0 значит «направления
// нет» и ключа не даёт: строго на север браузерный watchPosition не сообщает,
// а ноль в схеме — значение, а не отсутствие.
func NewMessageMediaGeoLive(lat, lng float64, period, heading int) *MessageMediaGeoLive {
	return &MessageMediaGeoLive{
		Underscore: MessageMediaGeoLiveTag,
		Geo:        NewGeoPoint(lat, lng),
		Heading:    heading,
		Period:     period,
	}
}

// messageMediaVenue#2ec0533f geo:GeoPoint title:string address:string
// provider:string venue_id:string venue_type:string = MessageMedia;
//
// МЕСТО (не просто точка): у нас это та же строка гео, но с title/address в
// geo_meta. Отдельный конструктор, а не два лишних ключа у messageMediaGeo:
// клиент рисует у места подпись и футер, а у точки — нет (tweb geo.ts:190).
//
// provider/venue_id/venue_type (все ОБЯЗАТЕЛЬНЫЕ) предмета не имеют: это
// реквизиты СПРАВОЧНИКА мест (foursquare/gplaces) — идентификатор заведения в
// чужой базе и его категория. Справочника мест у нас нет вовсе, точку с
// подписью присылает сам отправитель.
type MessageMediaVenue struct {
	Underscore string   `json:"_"`
	Geo        GeoPoint `json:"geo"`
	Title      string   `json:"title"`
	Address    string   `json:"address"`
}

func (MessageMediaVenue) isMessageMedia() {}
func (m MessageMediaVenue) Tag() string   { return m.Underscore }

func NewMessageMediaVenue(lat, lng float64, title, address string) *MessageMediaVenue {
	return &MessageMediaVenue{
		Underscore: MessageMediaVenueTag,
		Geo:        NewGeoPoint(lat, lng),
		Title:      title,
		Address:    address,
	}
}

// ── Контакт ─────────────────────────────────────────────────────────────────

// messageMediaContact#70322949 phone_number:string first_name:string
// last_name:string vcard:string user_id:long = MessageMedia;
//
// Присланная визитка: снимок имени и телефона на момент отправки плюс ссылка на
// аккаунт.
//
// Все пять параметров ОБЯЗАТЕЛЬНЫЕ и едут всегда, в том числе пустыми:
//   - last_name пуст, потому что мы храним имя визитки ОДНОЙ строкой
//     (messages.contact_name) — ровно так же ведёт себя оригинал, когда у
//     контакта нет фамилии. Разрезать нашу строку по первому пробелу значило бы
//     выдумывать фамилию там, где её никто не вводил;
//   - vcard пуст: карточки vCard мы не принимаем и не храним.
//
// Пустая строка здесь — ЗНАЧЕНИЕ («фамилии нет»), а не отсутствие параметра, и
// разница видна на проводе.
type MessageMediaContact struct {
	Underscore  string `json:"_"`
	PhoneNumber string `json:"phone_number"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	Vcard       string `json:"vcard"`
	UserID      int64  `json:"user_id"`
}

func (MessageMediaContact) isMessageMedia() {}
func (m MessageMediaContact) Tag() string   { return m.Underscore }

func NewMessageMediaContact(userID int64, name, phone string) *MessageMediaContact {
	return &MessageMediaContact{
		Underscore:  MessageMediaContactTag,
		PhoneNumber: phone,
		FirstName:   name,
		UserID:      userID,
	}
}

// ── Платное медиа ───────────────────────────────────────────────────────────

// MessageExtendedMedia — объединение схемы: messageExtendedMediaPreview |
// messageExtendedMedia. Одна позиция внутри платного вложения: либо ЗАГЛУШКА
// для неоплатившего, либо настоящее медиа.
type MessageExtendedMedia interface {
	isMessageExtendedMedia()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// messageExtendedMediaPreview#ad628cc8 flags:# w:flags.0?int h:flags.0?int
// thumb:flags.1?PhotoSize video_duration:flags.2?int = MessageExtendedMedia;
//
// Что видит зритель, НЕ оплативший платное медиа: коробка кадра и
// stripped-подложка — и больше ничего, по чему можно было бы получить байты.
//
// Прежде на этом месте у нас ехало ПСЕВДО-ФОТО без id (LockedPlaceholder):
// конструктор messageMediaPhoto с единственной stripped-ступенью. Форма была
// подсмотрена у клиента оригинала — это он собирает такое фото из превью
// (generatePhotoForExtendedMediaPreview), чтобы отдать его в wrapPhoto. То есть
// сервер отдавал результат КЛИЕНТСКОГО преобразования вместо самого предмета.
//
// video_duration не производится: длительность — это уже сведение о содержимом
// неоплаченного медиа, и стирает её тот же stripLockedMedia, что стирает mime.
type MessageExtendedMediaPreview struct {
	Underscore string `json:"_"`
	W          int    `json:"w,omitempty"`
	H          int    `json:"h,omitempty"`
	// Thumb — flags.1?PhotoSize: одна ступень, stripped-подложка.
	Thumb PhotoSize `json:"thumb,omitempty"`
}

func (MessageExtendedMediaPreview) isMessageExtendedMedia() {}
func (m MessageExtendedMediaPreview) Tag() string           { return m.Underscore }

// messageExtendedMedia#ee479c64 media:MessageMedia = MessageExtendedMedia;
//
// Оплачено (или своё) — настоящее вложение целиком.
type MessageExtendedMediaReal struct {
	Underscore string       `json:"_"`
	Media      MessageMedia `json:"media"`
}

func (MessageExtendedMediaReal) isMessageExtendedMedia() {}
func (m MessageExtendedMediaReal) Tag() string           { return m.Underscore }

// messageMediaPaidMedia#a8852491 stars_amount:long
// extended_media:Vector<MessageExtendedMedia> = MessageMedia;
//
// Медиа, разблокируемое за звёзды. У нас цена ехала собственным ключом
// paid_media:{price, locked} РЯДОМ с обычным media, то есть «платность» была
// припиской к вложению, а не его видом. В схеме это ОБЁРТКА: платное вложение —
// сам конструктор, а настоящее медиа лежит внутри вектора extended_media.
//
// Пер-зрительское «заблокировано» выражается ВЫБОРОМ конструктора элемента
// вектора (preview или media), а не булевым ключом рядом: у оригинала зритель,
// не оплативший медиа, физически не получает объекта, из которого можно достать
// байты.
type MessageMediaPaidMedia struct {
	Underscore string `json:"_"`
	// StarsAmount — обязательный: цена доступа в звёздах.
	StarsAmount int64 `json:"stars_amount"`
	// ExtendedMedia — обязательный вектор. У нас платное медиа всегда одно
	// (альбомов платных вложений мы не собираем), но вектор едет вектором.
	ExtendedMedia []MessageExtendedMedia `json:"extended_media"`
}

func (MessageMediaPaidMedia) isMessageMedia() {}
func (m MessageMediaPaidMedia) Tag() string   { return m.Underscore }

// NewMessageMediaPaidMedia — платное вложение. locked решает, каким
// конструктором едет позиция вектора: заглушкой или настоящим медиа.
func NewMessageMediaPaidMedia(stars int64, md MessageMedia, locked bool) *MessageMediaPaidMedia {
	out := &MessageMediaPaidMedia{
		Underscore:    MessageMediaPaidMediaTag,
		StarsAmount:   stars,
		ExtendedMedia: []MessageExtendedMedia{},
	}
	if locked {
		w, h := MediaDimensions(md)
		p := MessageExtendedMediaPreview{Underscore: MessageExtendedMediaPreviewTag, W: w, H: h}
		if b := MediaStrippedThumb(md); len(b) > 0 {
			p.Thumb = NewPhotoStrippedSize(b)
		}
		out.ExtendedMedia = append(out.ExtendedMedia, p)
		return out
	}
	if md != nil {
		out.ExtendedMedia = append(out.ExtendedMedia,
			MessageExtendedMediaReal{Underscore: MessageExtendedMediaTag, Media: md})
	}
	return out
}

// ── Сборка вложения из строки media ─────────────────────────────────────────

// fitThumb вписывает w×h в квадрат ThumbMaxSide с сохранением пропорции — та же
// арифметика, что у генератора превью. Оригинал меньше квадрата — превью с ним
// совпадает.
func fitThumb(w, h int) (int, int) {
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	if w <= ThumbMaxSide && h <= ThumbMaxSide {
		return w, h
	}
	if w >= h {
		return ThumbMaxSide, max(1, h*ThumbMaxSide/w)
	}
	return max(1, w*ThumbMaxSide/h), ThumbMaxSide
}

// MediaSource — сырьё для сборки вложения: строка media плюс метаданные
// стикера (контур и эмодзи лежат в строке стикера, а не в media) и флаг
// спойлера самого сообщения. Собирается read-моделью и не хранится.
type MediaSource struct {
	MediaID   int64
	Width     int
	Height    int
	Mime      string
	Blur      []byte
	HasThumb  bool
	Duration  int
	Size      int64
	FileName  string
	Waveform  []byte
	Title     string
	Performer string
	// Animated — файл проигрывается как гифка: image/gif либо видео без
	// аудиодорожки. Отдаётся как documentAttributeAnimated — тот самый атрибут,
	// из которого оригинал выводит doc.type === 'gif'.
	Animated bool
	// PathThumb — векторный контур стикера (photoPathSize) из строки стикера.
	PathThumb []byte
	// StickerAlt — эмодзи стикера (documentAttributeSticker.alt).
	StickerAlt string
	// StickerSetID — набор, которому принадлежит стикер
	// (documentAttributeSticker.stickerset). 0 — набор неизвестен: стикер
	// удалённого набора либо файл, отправленный как стикер, но в наборе не
	// числящийся. Тогда едет inputStickerSetEmpty, а не подставленный ноль.
	StickerSetID int64
	// Spoiler — свойство вложения В ЭТОМ сообщении, а не файла.
	Spoiler bool
	// Kind — тип сообщения ('photo'|'video'|'round'|'voice'|'audio'|'sticker'|
	// 'gif'|…). Решает, какими атрибутами описан документ; сам в модель не
	// попадает — клиент выводит тип из атрибутов, как в оригинале.
	Kind string
}

// thumbs — ступени, которые ТОЛЬКО превью: stripped-плейсхолдер, векторный
// контур и сгенерированное сервером превью. Оригинала здесь нет: у документа
// сам файл адресуется его id, а размеры кадра лежат в атрибутах — ровно как в
// схеме, где document.thumbs не содержит полного размера.
func (s MediaSource) thumbs() []PhotoSize {
	out := make([]PhotoSize, 0, 3)
	if len(s.Blur) > 0 {
		out = append(out, NewPhotoStrippedSize(s.Blur))
	}
	if len(s.PathThumb) > 0 {
		out = append(out, NewPhotoPathSize(s.PathThumb))
	}
	if s.HasThumb && s.Width > 0 && s.Height > 0 {
		tw, th := fitThumb(s.Width, s.Height)
		out = append(out, NewPhotoSize(SizeTypeThumb, tw, th, 0))
	}
	return out
}

// sizes — полная лестница фотографии: превью + оригинал. У фотографии файл
// выбирается ступенью (choosePhotoSize), поэтому оригинал — тоже ступень.
func (s MediaSource) sizes() []PhotoSize {
	out := s.thumbs()
	if s.Width > 0 && s.Height > 0 {
		out = append(out, NewPhotoSize(SizeTypeFull, s.Width, s.Height, s.Size))
	}
	return out
}

// attributes описывает документ так же, как это делает отправляющий клиент
// Telegram: набор атрибутов, из которого appDocsManager выводит doc.type.
func (s MediaSource) attributes() []DocumentAttribute {
	attrs := make([]DocumentAttribute, 0, 3)
	switch s.Kind {
	case "video", "gif", "round":
		a := DocumentAttributeVideo{Underscore: AttrVideo, Duration: float64(s.Duration), W: s.Width, H: s.Height}
		if s.Kind == "round" {
			a.PFlags = map[string]bool{"round_message": true}
		}
		attrs = append(attrs, a)
	case "voice", "audio":
		a := DocumentAttributeAudio{Underscore: AttrAudio, Duration: s.Duration,
			Title: s.Title, Performer: s.Performer, Waveform: s.Waveform}
		if s.Kind == "voice" {
			a.PFlags = map[string]bool{"voice": true}
		}
		attrs = append(attrs, a)
	case "sticker":
		// ПОРЯДОК ЗНАЧИМ, и это не стиль. Разбор документа идёт по атрибутам
		// подряд (`saveDoc` оригинала), и `documentAttributeImageSize`
		// БЕЗУСЛОВНО ставит `type = 'photo'` — то есть, стоя после атрибута
		// стикера, затирает его. У Telegram размер идёт первым, стикер вторым,
		// поэтому побеждает стикер; у нас порядок был обратный, и разобранный
		// стикер оказывался документом-фотографией.
		if s.Width > 0 && s.Height > 0 {
			attrs = append(attrs, DocumentAttributeImageSize{Underscore: AttrImageSize, W: s.Width, H: s.Height})
		}
		attrs = append(attrs, DocumentAttributeSticker{
			Underscore: AttrSticker, Alt: s.StickerAlt, Stickerset: stickerSetAddr(s.StickerSetID),
		})
	default:
		// Обычный файл: кадр описывается documentAttributeImageSize только если
		// это картинка — у оригинала ровно тот же смысл, из него выводится
		// doc.type === 'photo'.
		if s.Width > 0 && s.Height > 0 {
			attrs = append(attrs, DocumentAttributeImageSize{Underscore: AttrImageSize, W: s.Width, H: s.Height})
		}
	}
	if s.Animated {
		attrs = append(attrs, DocumentAttributeAnimated{Underscore: AttrAnimated})
	}
	if s.FileName != "" {
		attrs = append(attrs, DocumentAttributeFilename{Underscore: AttrFilename, FileName: s.FileName})
	}
	return attrs
}

// BuildMessageMedia собирает вложение сообщения. Возвращает nil, когда медиа
// нет вовсе (и нечего показать даже плейсхолдером).
//
// Развилка photo/document — та же, что у отправляющего клиента Telegram:
// картинка, снятая как фотография, едет messageMediaPhoto (лестница размеров,
// без mime и имени файла), всё остальное — messageMediaDocument.
func BuildMessageMedia(s MediaSource) MessageMedia {
	if s.MediaID == 0 && len(s.thumbs()) == 0 && (s.Width <= 0 || s.Height <= 0) {
		return nil
	}
	if s.Kind == "photo" {
		return NewMessageMediaPhoto(NewPhoto(s.MediaID, s.sizes()), s.Spoiler)
	}
	return NewMessageMediaDocument(BuildDocument(s), s.Spoiler)
}

// BuildDocument собирает САМ документ — без обёртки вложения сообщения.
//
// Нужен там, где документ едет не в сообщении: наборы стикеров, недавние,
// избранное, сохранённые GIF. Сборка одна на всех, и это главное: пока витрина
// стикеров строила «свою» карточку, у неё разъезжались с сообщением и ступени
// превью, и атрибуты — ровно та болезнь, ради которой делается переход.
func BuildDocument(s MediaSource) *Document {
	return &Document{
		Underscore: DocumentTag,
		ID:         s.MediaID,
		MimeType:   s.Mime,
		Size:       s.Size,
		Thumbs:     s.thumbs(),
		Attributes: s.attributes(),
	}
}

// ── Доступ к содержимому вложения ───────────────────────────────────────────
//
// Функции, а не методы: объединение стало интерфейсом (см. шапку), а у гео,
// контакта и опроса ни ступеней превью, ни атрибутов документа нет вовсе —
// объявлять им пустые методы значило бы утверждать обратное.

// mediaSizes — ступени вложения независимо от варианта (photo.sizes /
// document.thumbs); nil у вариантов без файла.
func mediaSizes(md MessageMedia) []PhotoSize {
	switch v := md.(type) {
	case *MessageMediaPhoto:
		if v.Photo != nil {
			return v.Photo.Sizes
		}
	case *MessageMediaDocument:
		if v.Document != nil {
			return v.Document.Thumbs
		}
	}
	return nil
}

// MediaStrippedThumb — байты stripped-плейсхолдера; nil, если ступени нет.
func MediaStrippedThumb(md MessageMedia) []byte {
	for _, s := range mediaSizes(md) {
		if v, ok := s.(PhotoStrippedSize); ok {
			return v.Bytes
		}
	}
	return nil
}

// MediaPathThumb — байты векторного контура; nil, если ступени нет.
func MediaPathThumb(md MessageMedia) []byte {
	for _, s := range mediaSizes(md) {
		if v, ok := s.(PhotoPathSize); ok {
			return v.Bytes
		}
	}
	return nil
}

// MediaDimensions — размеры кадра медиа. У фотографии это верхняя ступень
// лестницы, у документа — его атрибут (video/imageSize), как в оригинале.
func MediaDimensions(md MessageMedia) (int, int) {
	if v, ok := md.(*MessageMediaPhoto); ok {
		if v.Photo == nil {
			return 0, 0
		}
		for _, s := range v.Photo.Sizes {
			if size, ok := s.(PhotoSizeReal); ok && size.Type == SizeTypeFull {
				return size.W, size.H
			}
		}
		return 0, 0
	}
	if a, ok := MediaVideoAttr(md); ok {
		return a.W, a.H
	}
	if a, ok := MediaAttribute(md, AttrImageSize).(DocumentAttributeImageSize); ok {
		return a.W, a.H
	}
	return 0, 0
}

// MediaAttribute — атрибут документа по значению дискриминатора; nil, если это
// не документ или атрибута нет.
func MediaAttribute(md MessageMedia, tag string) DocumentAttribute {
	doc, ok := md.(*MessageMediaDocument)
	if !ok || doc.Document == nil {
		return nil
	}
	for _, a := range doc.Document.Attributes {
		if attributeTag(a) == tag {
			return a
		}
	}
	return nil
}

// Типизированные доступы к атрибутам — обёртки над MediaAttribute, чтобы
// читающая сторона не рассыпалась приведениями типа.

// MediaVideoAttr — documentAttributeVideo, если он есть.
func MediaVideoAttr(md MessageMedia) (DocumentAttributeVideo, bool) {
	a, ok := MediaAttribute(md, AttrVideo).(DocumentAttributeVideo)
	return a, ok
}

// MediaAudioAttr — documentAttributeAudio, если он есть.
func MediaAudioAttr(md MessageMedia) (DocumentAttributeAudio, bool) {
	a, ok := MediaAttribute(md, AttrAudio).(DocumentAttributeAudio)
	return a, ok
}

// MediaFileName — documentAttributeFilename.file_name; пусто, если атрибута нет.
func MediaFileName(md MessageMedia) string {
	if a, ok := MediaAttribute(md, AttrFilename).(DocumentAttributeFilename); ok {
		return a.FileName
	}
	return ""
}

// MediaHasAttribute — атрибут с таким дискриминатором присутствует.
func MediaHasAttribute(md MessageMedia, tag string) bool { return MediaAttribute(md, tag) != nil }

// MediaPhoto — фотография вложения; nil, если это не messageMediaPhoto. Нужна
// действиям (смена аватарки чата, предложенное фото), которые несут photo
// внутри себя.
func MediaPhoto(md MessageMedia) *Photo {
	if v, ok := md.(*MessageMediaPhoto); ok {
		return v.Photo
	}
	return nil
}

func attributeTag(a DocumentAttribute) string {
	switch v := a.(type) {
	case DocumentAttributeVideo:
		return v.Underscore
	case DocumentAttributeAudio:
		return v.Underscore
	case DocumentAttributeSticker:
		return v.Underscore
	case DocumentAttributeFilename:
		return v.Underscore
	case DocumentAttributeImageSize:
		return v.Underscore
	case DocumentAttributeAnimated:
		return v.Underscore
	}
	return ""
}

// StripLockedMedia — вложение в том виде, в каком его МОЖНО держать в строке
// витрины для зрителя, не оплатившего платное медиа: остаются только размеры
// кадра и stripped-подложка, всё остальное (id файла, mime, имя, длительность,
// волна, атрибуты) исчезает вместе с любой возможностью получить байты.
//
// На провод это уходит конструктором messageExtendedMediaPreview внутри
// messageMediaPaidMedia — см. NewMessageMediaPaidMedia. Здесь остаётся только
// строка витрины, потому что стирать надо ДО того, как сообщение попадёт в
// любую другую выдачу, а не на границе провода.
func StripLockedMedia(md MessageMedia) MessageMedia {
	if md == nil {
		return nil
	}
	w, h := MediaDimensions(md)
	sizes := make([]PhotoSize, 0, 2)
	if b := MediaStrippedThumb(md); len(b) > 0 {
		sizes = append(sizes, NewPhotoStrippedSize(b))
	}
	if w > 0 && h > 0 {
		sizes = append(sizes, NewPhotoSize(SizeTypeFull, w, h, 0))
	}
	if len(sizes) == 0 {
		return nil
	}
	// Спойлер не переносим: заблокированное платное медиа И ТАК скрыто —
	// заглушка с blur и кнопкой «разблокировать за N ⭐». Заслонка спойлера
	// поверх него была бы второй крышкой и похоронила бы саму кнопку. Флаг живёт
	// в строке messages и вернётся вместе с настоящим медиа после оплаты.
	return NewMessageMediaPhoto(NewPhoto(0, sizes), false)
}
