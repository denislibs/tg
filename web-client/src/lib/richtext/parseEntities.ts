// Поиск служебных сущностей в тексте — порт tweb
// `lib/richTextProcessor/{index.ts (регэкспы), checkBrackets.ts, parseEntities.ts, wrapMessageEntities.ts}`.
//
// Сервер отдаёт только «настоящие» сущности (bold/link/…); ссылки-в-тексте,
// @упоминания, #хэштеги, переводы строк и эмодзи находит здесь клиент, ровно как
// tweb, и склеивает с серверными через mergeEntities. Без этого прохода
// однопроходный wrapRichText не увидит ни автолинков, ни переносов строк.
//
// НЕ портированы две ветки parseEntities: `messageEntityBotCommand` и
// `messageEntityTimestamp` — у нас нет ни ботов, ни таймкодов медиа (в
// wrapRichText для них тоже нет case'а). Всё остальное 1:1, включая нумерацию
// групп FULL_REG_EXP.
/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */
import emojiRegExp from './emojiRegex'
import TLD from './tld'
import { fixEmoji, mergeEntities } from './entities'
import type { MessageEntity } from '@layer'
import { encodeEmoji } from './emoji'

export const ALPHA_CHARS_REG_EXP = 'a-z' +
  '\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u00ff' + // Latin-1
  '\\u0100-\\u024f' + // Latin Extended A and B
  '\\u0253\\u0254\\u0256\\u0257\\u0259\\u025b\\u0263\\u0268\\u026f\\u0272\\u0289\\u028b' + // IPA Extensions
  '\\u02bb' + // Hawaiian
  '\\u0300-\\u036f' + // Combining diacritics
  '\\u1e00-\\u1eff' + // Latin Extended Additional (mostly for Vietnamese)
  '\\u0400-\\u04ff\\u0500-\\u0527' + // Cyrillic
  '\\u2de0-\\u2dff\\ua640-\\ua69f' + // Cyrillic Extended A/B
  '\\u0591-\\u05bf\\u05c1-\\u05c2\\u05c4-\\u05c5\\u05c7' +
  '\\u05d0-\\u05ea\\u05f0-\\u05f4' + // Hebrew
  '\\ufb1d-\\ufb28\\ufb2a-\\ufb36\\ufb38-\\ufb3c\\ufb3e\\ufb40-\\ufb41' +
  '\\ufb43-\\ufb44\\ufb46-\\ufb4f' + // Hebrew Pres. Forms
  '\\u0610-\\u061a\\u0620-\\u065f\\u066e-\\u06d3\\u06d5-\\u06dc' +
  '\\u06de-\\u06e8\\u06ea-\\u06ef\\u06fa-\\u06fc\\u06ff' + // Arabic
  '\\u0750-\\u077f\\u08a0\\u08a2-\\u08ac\\u08e4-\\u08fe' + // Arabic Supplement and Extended A
  '\\ufb50-\\ufbb1\\ufbd3-\\ufd3d\\ufd50-\\ufd8f\\ufd92-\\ufdc7\\ufdf0-\\ufdfb' + // Pres. Forms A
  '\\ufe70-\\ufe74\\ufe76-\\ufefc' + // Pres. Forms B
  '\\u200c' + // Zero-Width Non-Joiner
  '\\u0e01-\\u0e3a\\u0e40-\\u0e4e' + // Thai
  '\\u1100-\\u11ff\\u3130-\\u3185\\uA960-\\uA97F\\uAC00-\\uD7AF\\uD7B0-\\uD7FF' + // Hangul (Korean)
  '\\u3003\\u3005\\u303b' + // Kanji/Han iteration marks
  '\\uff21-\\uff3a\\uff41-\\uff5a' + // full width Alphabet
  '\\uff66-\\uff9f' + // half width Katakana
  '\\uffa1-\\uffdc' // half width Hangul (Korean)
export const ALPHA_NUMERIC_REG_EXP = '0-9\\_' + ALPHA_CHARS_REG_EXP
export const DOMAIN_ADD_CHARS = '·'
// Based on Regular Expression for URL validation by Diego Perini
export const URL_ALPHANUMERIC_REG_EXP_PART = '[' + ALPHA_CHARS_REG_EXP + '0-9]'
export const URL_PROTOCOL_REG_EXP_PART = '((?:https?|ftp)://|mailto:)?'
export const URL_REG_EXP = URL_PROTOCOL_REG_EXP_PART +
  // user:pass authentication
  '(?:' + URL_ALPHANUMERIC_REG_EXP_PART + '{1,64}(?::' + URL_ALPHANUMERIC_REG_EXP_PART + '{0,64})?@)?' +
  '(?:' +
  // sindresorhus/ip-regexp
  '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])(?:\\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])){3}' +
  '|' +
  // host name
  URL_ALPHANUMERIC_REG_EXP_PART + '[' + ALPHA_CHARS_REG_EXP + DOMAIN_ADD_CHARS + '0-9\\-]{0,64}' +
  // domain name
  '(?:\\.' + URL_ALPHANUMERIC_REG_EXP_PART + '[' + ALPHA_CHARS_REG_EXP + DOMAIN_ADD_CHARS + '0-9\\-]{0,64}){0,10}' +
  // TLD identifier
  '(?:\\.(xn--[0-9a-z]{2,16}|[' + ALPHA_CHARS_REG_EXP + ']{2,24}))' +
  ')' +
  // port number
  '(?::\\d{2,5})?' +
  // resource path
  '(?:/(?:\\S{0,255}[^\\s.;,(\\[\\]{}<>"\'])?)?'
export const USERNAME_REG_EXP = '[a-zA-Z\\d_]{5,32}'
// Группы: 1 (^| ), 2 (@), 3 username | 4 url, 5 protocol, 6 tld | 7 \n |
// 8,9 эмодзи (внешние скобки здесь + скобки внутри вендорного регэкспа) |
// 10 префикс хэштега, 11 хэштег. Ветки bot_command/timestamp из tweb не портированы.
export const FULL_REG_EXP = new RegExp('(^| )(@)(' + USERNAME_REG_EXP + ')|(' + URL_REG_EXP + ')|(\\n)|(' + emojiRegExp + ')|(^|[\\s\\(\\]])(#[' + ALPHA_NUMERIC_REG_EXP + ']{2,64})', 'i')
export const EMAIL_REG_EXP = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
export const SITE_HASHTAGS: { [siteName: string]: string } = {
  'Telegram': 'tg://search_hashtag?hashtag={1}',
  'Twitter': 'https://twitter.com/hashtag/{1}',
  'Instagram': 'https://instagram.com/explore/tags/{1}/',
  'Google Plus': 'https://plus.google.com/explore/{1}',
}

/** Порт tweb `checkBrackets.ts` — не втягивать в URL закрывающие скобки соседнего текста. */
export function checkBrackets(url: string) {
  let urlLength = url.length
  const urlOpenBrackets = url.split('(').length - 1
  let urlCloseBrackets = url.split(')').length - 1
  while (urlCloseBrackets > urlOpenBrackets &&
    url.charAt(urlLength - 1) === ')') {
    url = url.substr(0, urlLength - 1)
    urlCloseBrackets--
    urlLength--
  }
  if (urlOpenBrackets > urlCloseBrackets) {
    url = url.replace(/\)+$/, '')
  }
  return url
}

/** Порт tweb `parseEntities.ts` (без веток bot_command/timestamp). */
export default function parseEntities(text: string) {
  let match: RegExpMatchArray | null
  let raw = text
  const entities: MessageEntity[] = []
  let matchIndex: number
  let rawOffset = 0
  FULL_REG_EXP.lastIndex = 0
  while ((match = raw.match(FULL_REG_EXP))) {
    matchIndex = rawOffset + (match.index ?? 0)

    if (match[3]) { // mentions
      entities.push({
        _: 'messageEntityMention',
        offset: matchIndex + match[1].length,
        length: match[2].length + match[3].length,
      })
    } else if (match[4]) {
      if (EMAIL_REG_EXP.test(match[4])) { // email
        entities.push({
          _: 'messageEntityEmail',
          offset: matchIndex,
          length: match[4].length,
        })
      } else {
        let url: string | undefined
        let protocol = match[5]
        const tld = match[6]
        if (tld) { // URL
          if (!protocol && (tld.substr(0, 4) === 'xn--' || TLD.indexOf(tld.toLowerCase()) !== -1)) {
            protocol = 'http://'
          }

          if (protocol) {
            const balanced = checkBrackets(match[4])
            if (balanced.length !== match[4].length) {
              match[4] = balanced
            }

            url = (match[5] ? '' : protocol) + match[4]
          }
        } else { // IP address
          url = (match[5] ? '' : 'http://') + match[4]
        }

        if (url) {
          entities.push({
            _: 'messageEntityUrl',
            offset: matchIndex,
            length: match[4].length,
          })
        }
      }
    } else if (match[7]) { // New line
      entities.push({
        _: 'messageEntityLinebreak',
        offset: matchIndex,
        length: 1,
      })
    } else if (match[8]) { // Emoji
      // tweb здесь зовёт getEmojiUnified(), который сверяет глиф с таблицей
      // `@config/emoji` (~100 КБ) и пропускает неизвестные. Таблицу мы не тащим,
      // поэтому unified считаем численно из кодпоинтов (emoji.ts) — этого хватает
      // и для класса `.emoji`, и для имени файла картинки (см. wrapRichText).
      entities.push({
        _: 'messageEntityEmoji',
        offset: matchIndex,
        length: match[8].length,
        unicode: encodeEmoji(match[8]),
      })
    } else if (match[11]) { // Hashtag
      entities.push({
        _: 'messageEntityHashtag',
        offset: matchIndex + (match[10] ? match[10].length : 0),
        length: match[11].length,
      })
    }

    raw = raw.substr((match.index ?? 0) + match[0].length)
    rawOffset += (match.index ?? 0) + match[0].length
  }

  return entities
}

/**
 * Порт tweb `wrapMessageEntities.ts` — fixEmoji + parseEntities + mergeEntities.
 *
 * Расхождение с tweb: сущности КОПИРУЮТСЯ перед fixEmoji. В tweb `fixEmoji`
 * правит offset/length прямо в массиве сообщения — там это временный объект
 * рендера, а у нас сущности лежат в сторе и общие с другими потребителями
 * (React-ветки, поиск, превью), так что мутировать их нельзя.
 */
export function wrapMessageEntities(message: string, entities: MessageEntity[] = []) {
  const copied = entities.map((entity) => ({ ...entity }))
  message = fixEmoji(message, copied)

  const myEntities = parseEntities(message)
  // ! only in this order, otherwise bold and emoji formatting won't work
  const totalEntities = mergeEntities(copied, myEntities)
  return {
    message,
    entities: copied,
    myEntities,
    totalEntities,
  }
}
