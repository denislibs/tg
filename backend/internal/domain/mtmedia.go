package domain

// Медиа сообщения в форме оригинала — структуры схемы TL (MTProto), а не
// плоский набор полей и не собственный формат.
//
// Фаза 0 перехода на TL: имена конструкторов и полей берутся из схемы
// БУКВАЛЬНО (tweb/src/lib/mtproto/schema.ts), сериализация пока JSON. Поэтому
// переход к бинарному TL станет заменой сериализатора, а не переделкой модели.
//
// Зачем вообще. Плоская форма (media_w/media_h/media_blur/media_mime/…)
// отвечает ровно на те вопросы, которые мы догадались задать: лестницы превью
// в ней нет, тип документа приходится подделывать флагами на стороне клиента,
// а векторный контур стикера не помещается вовсе. Врапперы tweb
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
// ── Чего в модели НЕТ и почему ───────────────────────────────────────────────
// Реквизиты MTProto-транспорта: у них нет предмета в нашей схеме доступа —
// файл адресуется одним числовым id через собственный медиа-эндпоинт:
//   - dc_id                 — номер датацентра MTProto-хранилища;
//   - access_hash           — токен доступа к файлу;
//   - file_reference        — протухающая ссылка, обновляемая getMessages;
//   - date                  — дата файла (у нас — дата сообщения);
//   - семейство Input*      — реквизиты того же транспорта (в т.ч.
//     documentAttributeSticker.stickerset: InputStickerSet — набор у нас
//     адресуется числовым set_id через свою ручку).
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
	return PhotoSizeReal{Underscore: "photoSize", Type: sizeType, W: w, H: h, Size: size}
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
	return PhotoStrippedSize{Underscore: "photoStrippedSize", Type: SizeTypeStripped, Bytes: b}
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
	return PhotoPathSize{Underscore: "photoPathSize", Type: SizeTypePath, Bytes: b}
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
	return &Photo{Underscore: "photo", ID: id, Sizes: sizes}
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
// stickerset не воспроизводится: InputStickerSet — семейство Input* того же
// транспорта, набор у нас адресуется числовым set_id через свою ручку.
type DocumentAttributeSticker struct {
	Underscore string `json:"_"`
	Alt        string `json:"alt"`
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

// MessageMedia — вложение сообщения: messageMediaPhoto | messageMediaDocument.
// Остальные варианты объединения (гео, контакт, опрос, …) у нас едут
// собственными полями сообщения и в этой модели не участвуют.
type MessageMedia struct {
	Underscore string `json:"_"`
	// PFlags.spoiler — messageMediaPhoto.spoiler:flags.3?true /
	// messageMediaDocument.spoiler:flags.4?true.
	//
	// Биты-подсказки messageMediaDocument video/round/voice (flags.6/7/8) не
	// выставляются: тип документа выводится из его атрибутов, как в
	// appDocsManager. Дублировать вывод вторым источником — это и есть та
	// подделка флага, которую модель устраняет.
	PFlags   map[string]bool `json:"pFlags,omitempty"`
	Photo    *Photo          `json:"photo,omitempty"`
	Document *Document       `json:"document,omitempty"`
}

// Значения дискриминатора `_`.
const (
	MessageMediaPhotoTag    = "messageMediaPhoto"
	MessageMediaDocumentTag = "messageMediaDocument"
	PhotoSizeTag            = "photoSize"
	PhotoStrippedSizeTag    = "photoStrippedSize"
	PhotoPathSizeTag        = "photoPathSize"
	AttrImageSize           = "documentAttributeImageSize"
	AttrAnimated            = "documentAttributeAnimated"
	AttrSticker             = "documentAttributeSticker"
	AttrVideo               = "documentAttributeVideo"
	AttrAudio               = "documentAttributeAudio"
	AttrFilename            = "documentAttributeFilename"
)

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
		attrs = append(attrs, DocumentAttributeSticker{Underscore: AttrSticker, Alt: s.StickerAlt})
		if s.Width > 0 && s.Height > 0 {
			attrs = append(attrs, DocumentAttributeImageSize{Underscore: AttrImageSize, W: s.Width, H: s.Height})
		}
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
func BuildMessageMedia(s MediaSource) *MessageMedia {
	if s.MediaID == 0 && len(s.thumbs()) == 0 && (s.Width <= 0 || s.Height <= 0) {
		return nil
	}
	var pFlags map[string]bool
	if s.Spoiler {
		pFlags = map[string]bool{"spoiler": true}
	}
	if s.Kind == "photo" {
		return &MessageMedia{Underscore: MessageMediaPhotoTag, PFlags: pFlags, Photo: NewPhoto(s.MediaID, s.sizes())}
	}
	return &MessageMedia{
		Underscore: MessageMediaDocumentTag,
		PFlags:     pFlags,
		Document: &Document{
			Underscore: "document",
			ID:         s.MediaID,
			MimeType:   s.Mime,
			Size:       s.Size,
			Thumbs:     s.thumbs(),
			Attributes: s.attributes(),
		},
	}
}

// sizeList — ступени вложения независимо от варианта (photo.sizes/document.thumbs).
func (md *MessageMedia) sizeList() []PhotoSize {
	if md == nil {
		return nil
	}
	if md.Photo != nil {
		return md.Photo.Sizes
	}
	if md.Document != nil {
		return md.Document.Thumbs
	}
	return nil
}

// StrippedThumb — байты stripped-плейсхолдера; nil, если ступени нет.
func (md *MessageMedia) StrippedThumb() []byte {
	for _, s := range md.sizeList() {
		if v, ok := s.(PhotoStrippedSize); ok {
			return v.Bytes
		}
	}
	return nil
}

// PathThumb — байты векторного контура; nil, если ступени нет.
func (md *MessageMedia) PathThumb() []byte {
	for _, s := range md.sizeList() {
		if v, ok := s.(PhotoPathSize); ok {
			return v.Bytes
		}
	}
	return nil
}

// Dimensions — размеры кадра медиа. У фотографии это верхняя ступень лестницы,
// у документа — его атрибут (video/imageSize), как в оригинале.
func (md *MessageMedia) Dimensions() (int, int) {
	if md == nil {
		return 0, 0
	}
	if md.Photo != nil {
		for _, s := range md.Photo.Sizes {
			if v, ok := s.(PhotoSizeReal); ok && v.Type == SizeTypeFull {
				return v.W, v.H
			}
		}
		return 0, 0
	}
	if a, ok := md.Attribute(AttrVideo).(DocumentAttributeVideo); ok {
		return a.W, a.H
	}
	if a, ok := md.Attribute(AttrImageSize).(DocumentAttributeImageSize); ok {
		return a.W, a.H
	}
	return 0, 0
}

// Attribute — атрибут документа по значению дискриминатора; nil, если это не
// документ или атрибута нет.
func (md *MessageMedia) Attribute(tag string) DocumentAttribute {
	if md == nil || md.Document == nil {
		return nil
	}
	for _, a := range md.Document.Attributes {
		if attributeTag(a) == tag {
			return a
		}
	}
	return nil
}

// Типизированные доступы к атрибутам — обёртки над Attribute, чтобы читающая
// сторона не рассыпалась приведениями типа.

// VideoAttr — documentAttributeVideo, если он есть.
func (md *MessageMedia) VideoAttr() (DocumentAttributeVideo, bool) {
	a, ok := md.Attribute(AttrVideo).(DocumentAttributeVideo)
	return a, ok
}

// AudioAttr — documentAttributeAudio, если он есть.
func (md *MessageMedia) AudioAttr() (DocumentAttributeAudio, bool) {
	a, ok := md.Attribute(AttrAudio).(DocumentAttributeAudio)
	return a, ok
}

// FileName — documentAttributeFilename.file_name; пусто, если атрибута нет.
func (md *MessageMedia) FileName() string {
	if a, ok := md.Attribute(AttrFilename).(DocumentAttributeFilename); ok {
		return a.FileName
	}
	return ""
}

// HasAttribute — атрибут с таким дискриминатором присутствует.
func (md *MessageMedia) HasAttribute(tag string) bool { return md.Attribute(tag) != nil }

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

// LockedPlaceholder — вложение в том виде, в каком его можно показать зрителю,
// не оплатившему платное медиа: псевдо-фото без id (скачивать нечего) с одной
// stripped-ступенью и размерами кадра. Та же форма, которую оригинал собирает
// из messageExtendedMediaPreview (tweb generatePhotoForExtendedMediaPreview):
// дальше она идёт в wrapPhoto как обычное фото, а «единственная ступень —
// stripped» и есть тот случай, ради которого у wrapPhoto есть ранний выход.
func LockedPlaceholder(md *MessageMedia) *MessageMedia {
	if md == nil {
		return nil
	}
	w, h := md.Dimensions()
	sizes := make([]PhotoSize, 0, 2)
	if b := md.StrippedThumb(); len(b) > 0 {
		sizes = append(sizes, NewPhotoStrippedSize(b))
	}
	if w > 0 && h > 0 {
		sizes = append(sizes, NewPhotoSize(SizeTypeFull, w, h, 0))
	}
	if len(sizes) == 0 {
		return nil
	}
	// Спойлер не переносим: заблокированное платное медиа И ТАК скрыто —
	// плейсхолдер с blur и кнопкой «разблокировать за N ⭐». Заслонка спойлера
	// поверх него была бы второй крышкой и похоронила бы саму кнопку. Флаг живёт
	// в строке messages и вернётся вместе с настоящим медиа после оплаты.
	return &MessageMedia{Underscore: MessageMediaPhotoTag, Photo: NewPhoto(0, sizes)}
}
