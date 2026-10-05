// Локальный набор ключевых слов эмодзи (en + ru) — замена серверного пакета
// `messages.getEmojiKeywordsDifference` (tweb `appEmojiManager.getEmojiKeywords`), ручки
// которого у бэкенда нет (строка бэклога Б-131). Формат — как у пакета tweb
// (`EmojiLangPack.keywords`, ключевое слово → эмодзи), строится из таблицы «эмодзи → слова»
// ниже (перенесена из снесённого на К-4 `components/emoji/emojiData.ts`).
const EMOJI_KEYWORDS_TABLE: Record<string, string> = {
  '😀': 'grin smile happy улыбка радость', '😂': 'joy laugh tears lol смех ржака лол слезы',
  '🤣': 'rofl laugh угар ржу', '🙂': 'smile slight улыбка',
  '😊': 'blush smile happy улыбка смущение', '😉': 'wink подмигивание хитрый',
  '😅': 'sweat smile нервный фух', '😍': 'love heart eyes любовь влюблен глаза',
  '🥰': 'love hearts любовь мило', '😘': 'kiss love поцелуй чмок',
  '😎': 'cool sunglasses круто очки', '🤩': 'star struck wow вау восторг',
  '🥳': 'party celebrate birthday праздник др туса', '😭': 'cry sob sad плачу рыдаю грусть',
  '😢': 'cry sad tear слеза грустно', '😡': 'angry mad rage злой бешенство',
  '😠': 'angry mad злюсь сердит', '🤔': 'thinking hmm думаю хм',
  '😴': 'sleep tired zzz сон спать устал', '😱': 'scream shock fear шок ужас страх',
  '🥺': 'pleading puppy please умоляю пожалуйста', '🙄': 'eye roll закатил глаза',
  '😏': 'smirk ухмылка', '🤗': 'hug обнимаю обнимашки', '🤫': 'shush quiet тихо тсс',
  '🤪': 'crazy zany дурак сумасшедший', '😇': 'angel halo ангел святой',
  '🤥': 'lie liar врун ложь', '😷': 'mask sick маска болею', '🤒': 'sick fever болею температура',
  '🤮': 'vomit sick тошнит фу', '🤢': 'nausea sick тошнота фу', '😮': 'wow open mouth ого вау',
  '😲': 'astonished shocked удивление ошарашен', '😯': 'hushed surprised удивлен ох',
  '👍': 'thumbs up like yes ok да класс лайк хорошо', '👎': 'thumbs down dislike no нет плохо дизлайк',
  '👏': 'clap applause аплодисменты браво', '🙏': 'pray thanks please спасибо прошу молюсь',
  '🤝': 'handshake deal рукопожатие договор', '💪': 'muscle strong flex сила качок мощь',
  '✌️': 'peace victory мир виктори', '🤞': 'fingers crossed luck удача скрестил',
  '👌': 'ok perfect ок окей отлично', '👋': 'wave hello hi bye привет пока хай',
  '👉': 'point you ты туда указывает', '👈': 'point back тебя сюда',
  '🖕': 'middle finger фак палец', '🔥': 'fire lit hot огонь жара горит',
  '✨': 'sparkles shiny блеск искры', '⭐': 'star звезда', '🌟': 'star glow звезда сияет',
  '💯': 'hundred perfect сто топ', '🎉': 'party tada celebrate праздник ура поздравляю',
  '🎂': 'cake birthday торт др день рождения', '❤️': 'heart love red сердце любовь люблю',
  '💔': 'broken heart разбитое сердце боль', '🎃': 'pumpkin halloween тыква хэллоуин',
  '🐶': 'dog puppy собака пес щенок', '🐱': 'cat kitten кот кошка котик',
  '🦊': 'fox лиса', '🐻': 'bear медведь мишка', '🐼': 'panda панда',
  '🦁': 'lion лев', '🐸': 'frog лягушка жаба', '🦄': 'unicorn единорог',
  '🐝': 'bee пчела', '🦋': 'butterfly бабочка',
  '🌹': 'rose flower роза цветок', '🌸': 'blossom flower сакура цветок',
  '🌈': 'rainbow радуга', '☀️': 'sun sunny солнце тепло', '❄️': 'snow cold снег холод зима',
  '🌚': 'moon луна', '🍕': 'pizza пицца', '🍔': 'burger бургер', '🍟': 'fries картошка фри',
  '🍣': 'sushi суши', '🍺': 'beer пиво', '☕': 'coffee кофе', '🍷': 'wine вино',
  '🍎': 'apple яблоко', '🍌': 'banana банан', '🍓': 'strawberry клубника',
  '⚽': 'soccer football футбол мяч', '🏀': 'basketball баскетбол',
  '🎮': 'game controller gaming игра геймпад', '🎸': 'guitar music гитара',
  '🎧': 'headphones music наушники музыка', '🏆': 'trophy win кубок победа',
  '🚗': 'car машина тачка', '✈️': 'plane flight travel самолет полет',
  '🚀': 'rocket launch ракета запуск', '🏠': 'house home дом',
  '💡': 'idea bulb light идея лампочка', '💰': 'money bag деньги бабки',
  '💎': 'diamond gem алмаз бриллиант', '📱': 'phone mobile телефон',
  '💻': 'laptop computer ноутбук комп', '🎁': 'gift present подарок',
  '🔑': 'key ключ', '🔒': 'lock замок', '🎄': 'christmas tree елка новый год',
  '💀': 'skull dead череп умер', '🤡': 'clown клоун', '👀': 'eyes глаза смотрю',
}

export default function getLocalEmojiKeywords() {
  const keywords: { [keyword: string]: string[] } = {}
  for(const emoji in EMOJI_KEYWORDS_TABLE) {
    for(const keyword of EMOJI_KEYWORDS_TABLE[emoji].split(' ')) {
      (keywords[keyword] ??= []).push(emoji)
    }
  }

  return keywords
}
