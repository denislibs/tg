#!/usr/bin/env node
/**
 * Инвентарь tweb: что там есть и сколько из этого доехало к нам.
 *
 * Читает исходники tweb (TWEB_DIR, по умолчанию /Users/denisurevic/Documents/tweb)
 * и наш web-client, пишет машиночитаемые срезы в docs/tweb/inventory/:
 *
 *   styles.json   — по каждому scss-файлу tweb: портирован ли, покрытие классов
 *   classes.json  — все CSS-классы tweb с пометкой, встречаются ли у нас
 *   popups.json   — попапы tweb и сопоставление с нашими компонентами
 *   coverage.md   — человекочитаемая сводка
 *
 * Запуск: node tools/tweb-parity/inventory.mjs
 */

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';

import {classesOf, parseScss} from './lib/scss.mjs';
import {
  INVENTORY_DIR, TWEB_DIR, WEB_CLIENT_SRC,
  assertTweb, isScss, loadOurIndex, relFromTweb, walk
} from './lib/sources.mjs';

/** Какой док базы знаний отвечает за файл стилей. Ключ — подстрока имени. */
const DOC_BY_STYLE = [
  [/^_chatBubble|^_quote|^_reaction|^_reactions|^_poll|^_checklist/i, 'bubbles.md'],
  [/^_chat\.|^_chatTopbar|^_chatPinned|^_chatDrop|^_chatToast|^_chatSearch/i, 'chat-feed.md'],
  [/^_chatMarkupTooltip|^_autocomplete|^_chatEmojiHelper|^_chatStickersHelper|^_chatInlineHelper|^_chatBotCommands|^_emojiDropdown|^_input|^_markup|^_simpleMessageInput|^_mediaAttacher|^_replyKeyboard/i, 'composer.md'],
  [/^_mediaViewer|^_audio|^_document|^_ckin|^_gifsMasonry|^_customEmoji|^_stickerViewer|^_emojiAnimation|^_crop|^_mediaEditor/i, 'media.md'],
  [/^_profile|^_similarChannels|^_starGift|^_stars|^_usernames|^_toggleReadDate/i, 'right-sidebar.md'],
  [/^_leftSidebar|^_chatlist|^_searchGroup|^_inputSearch|^_foldersSidebar|^_topics|^_archive/i, 'left-sidebar.md'],
  [/^_tooltip|^_quizHint|^_reactedList|^_mute|^_inviteLink|^_joinChatInvite|^_createContact|^_deleteMegagroup|^_limit|^_accountsLimit|^_reportAd|^_respondTo/i, 'popups.md'],
  [/^_boost|^_sponsored|^_chatlistInvite|^_makePaid/i, 'channels.md'],
  [/^_themes|^_variables|^_global|^_normalize|^_typography|^_hover|^_animationLevel|^_print|^_textCenter|^_textOverflow|^_splitColor|^_movableElement|^_instanceDeactivated/i, 'state-and-layout.md']
];

/** Не UI-паритет: платные/звонковые/премиум-подсистемы, которых у нас нет как продукта. */
const OUT_OF_SCOPE = /^_(payment|paymentCard|paymentCardConfirmation|paymentMethods|paymentShipping|paymentVerification|call|conferenceCall|groupCall|webApp|passcodeLockScreen|print|roboto|robotoMono|prism|giftPremium|giftLink|boostsViaGifts|accountsLimit)/;

function docFor(file) {
  const name = basename(file);
  for(const [re, doc] of DOC_BY_STYLE) if(re.test(name)) return doc;
  return null;
}

function twebCommit() {
  try {
    return execFileSync('git', ['-C', TWEB_DIR, 'rev-parse', '--short', 'HEAD'], {encoding: 'utf8'}).trim();
  } catch {
    return null;
  }
}

function collectScss(files, relFn) {
  const byFile = new Map();
  for(const file of files) {
    const {selectors, dynamic} = parseScss(readFileSync(file, 'utf8'));
    byFile.set(relFn(file), {selectors, dynamic, classes: classesOf(selectors)});
  }
  return byFile;
}

function buildStyles(twebScss, ourScss, ourScssClasses, our) {
  const ourByBase = new Map();
  for(const [rel, data] of ourScss) ourByBase.set(basename(rel), {rel, ...data});

  const files = [];
  for(const [rel, data] of twebScss) {
    const base = basename(rel);
    const ours = ourByBase.get(base);
    const classes = [...data.classes].sort();
    const missing = classes.filter((c) => !ourScssClasses.has(c) && !our.codeTokens.has(c));
    files.push({
      file: rel,
      base,
      // global — общие партиалы src/scss (их мы и портируем);
      // module — локальные стили Solid-компонентов форка, отдельный слой.
      kind: rel.startsWith('src/scss/') ? 'global' : 'module',
      doc: docFor(rel),
      outOfScope: OUT_OF_SCOPE.test(base),
      ported: Boolean(ours),
      ours: ours?.rel ?? null,
      twebSelectors: data.selectors.length,
      twebDynamicSelectors: data.dynamic.length,
      twebClasses: classes.length,
      classesPresent: classes.length - missing.length,
      coverage: classes.length ? +((classes.length - missing.length) / classes.length).toFixed(3) : 1,
      missingClasses: missing
    });
  }
  files.sort((a, b) => b.missingClasses.length - a.missingClasses.length);
  return files;
}

function buildClasses(twebScss, ourScssClasses, our) {
  const entries = new Map();
  for(const [rel, data] of twebScss) {
    for(const cls of data.classes) {
      if(!entries.has(cls)) entries.set(cls, {files: [], inOurScss: false, inOurCode: false});
      entries.get(cls).files.push(rel);
    }
  }
  for(const [cls, entry] of entries) {
    entry.inOurScss = ourScssClasses.has(cls);
    entry.inOurCode = our.codeTokens.has(cls);
    entry.files.sort();
  }
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));
}

const normalizeName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Один попап tweb — это либо файл в `popups/`, либо папка с `index.tsx`.
 * Вложенные файлы папки — части попапа, отдельными попапами не считаются.
 */
function twebPopupEntries() {
  const dir = join(TWEB_DIR, 'src/components/popups');
  const entries = [];
  for(const entry of readdirSync(dir, {withFileTypes: true})) {
    if(entry.isDirectory()) {
      for(const ext of ['tsx', 'ts']) {
        const candidate = join(dir, entry.name, `index.${ext}`);
        if(existsSync(candidate)) {
          entries.push({file: candidate, stem: entry.name});
          break;
        }
      }
      continue;
    }
    if(!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    const stem = entry.name.replace(/\.tsx?$/, '');
    // index.ts / indexTsx.tsx — сам PopupElement, инфраструктура, а не попап.
    if(stem === 'index' || stem === 'indexTsx') continue;
    entries.push({file: join(dir, entry.name), stem});
  }
  return entries;
}

function buildPopups(our) {
  const twebEntries = twebPopupEntries();
  const ourFiles = our.codeFiles.filter((f) => /(Popup|Modal|Sheet|Dialog|View)\.tsx$/.test(f));
  const ourByNorm = new Map();
  for(const file of ourFiles) {
    const stem = basename(file).replace(/\.tsx$/, '');
    // `Popup.tsx` — это шелл, а не попап: после срезки суффикса ключ пустой.
    const key = normalizeName(stem.replace(/(Popup|Modal|Sheet|Dialog|View)$/, ''));
    if(key.length >= 4) ourByNorm.set(key, stem);
  }

  /**
   * `exact` — нормализованные имена совпали, это надёжно.
   * `fuzzy` — наше имя длиннее и содержит имя tweb (`checklist` → `CreateChecklistPopup`);
   * подсказка для человека, не доказательство паритета. Обратное направление
   * (имя tweb содержит наше) не берём: так `starsPay` цеплялся за `StarsPopup`.
   */
  const matchOurs = (stem) => {
    const key = normalizeName(stem);
    if(ourByNorm.has(key)) return {ours: ourByNorm.get(key), match: 'exact'};
    if(key.length < 5) return {ours: null, match: null};
    const candidates = [...ourByNorm].filter(([k]) => k.includes(key));
    if(candidates.length === 1) return {ours: candidates[0][1], match: 'fuzzy'};
    return {ours: null, match: null};
  };

  const popups = twebEntries.map(({file, stem}) => {
    const source = readFileSync(file, 'utf8');
    const className = /export default class (\w+)/.exec(source)?.[1] ?? null;
    return {file: relFromTweb(file), name: className ?? stem, ...matchOurs(stem)};
  });
  popups.sort((a, b) => a.name.localeCompare(b.name));

  const matchedOurs = new Set(popups.map((p) => p.ours).filter(Boolean));
  const extraOurs = [...ourByNorm.values()].filter((name) => !matchedOurs.has(name)).sort();
  return {popups, extraOurs};
}

function percent(n) {
  return `${Math.round(n * 100)}%`;
}

function renderCoverage({meta, styles, classes, popups}) {
  const inScope = styles.filter((f) => !f.outOfScope && f.kind === 'global');
  const notPorted = inScope.filter((f) => !f.ported);
  const modules = styles.filter((f) => !f.outOfScope && f.kind === 'module');
  const totalClasses = Object.keys(classes).length;
  const presentClasses = Object.values(classes).filter((c) => c.inOurScss || c.inOurCode).length;
  const exactPopups = popups.popups.filter((p) => p.match === 'exact').length;
  const fuzzyPopups = popups.popups.filter((p) => p.match === 'fuzzy');

  const lines = [];
  lines.push('# Покрытие tweb: сводка');
  lines.push('');
  lines.push('<!-- Файл генерируется: node tools/tweb-parity/inventory.mjs. Руками не править. -->');
  lines.push('');
  lines.push(`Снято: ${meta.generatedAt}. Источник: \`${meta.twebDir}\`` +
    (meta.twebCommit ? ` @ \`${meta.twebCommit}\`` : '') + '.');
  lines.push('');
  lines.push('| Срез | Значение |');
  lines.push('|---|---|');
  lines.push(`| Общих партиалов \`src/scss\` в tweb (в скоупе) | ${inScope.length} |`);
  lines.push(`| Из них есть файлом у нас | ${inScope.length - notPorted.length} |`);
  lines.push(`| CSS-классов в tweb | ${totalClasses} |`);
  lines.push(`| Из них встречаются у нас | ${presentClasses} (${percent(presentClasses / totalClasses)}) |`);
  lines.push(`| Попапов в tweb | ${popups.popups.length} |`);
  lines.push(`| Из них нашлись у нас по имени | ${exactPopups} точно, ${fuzzyPopups.length} предположительно |`);
  lines.push(`| Локальных \`*.module.scss\` компонентов форка | ${modules.length} (отдельный слой, см. ниже) |`);
  lines.push('');
  lines.push('«Встречается у нас» = имя класса найдено в наших scss или в коде компонентов.');
  lines.push('Это признак наличия, а не паритета: точное совпадение вёрстки проверяет');
  lines.push('`dom-parity.mjs`, набор селекторов внутри файла — `scss-parity.mjs`.');
  lines.push('');
  lines.push('Локальный tweb — форк с частичной миграцией на Solid, поэтому часть стилей там');
  lines.push('живёт в `*.module.scss` рядом с компонентом. Мы портируем глобальный слой, а модульные');
  lines.push('файлы смотрим точечно — они в `styles.json` с `kind: "module"`.');
  lines.push('');

  lines.push('## Партиалы tweb, которых у нас нет файлом');
  lines.push('');
  lines.push('Отсортировано по числу классов, которых нет нигде в нашем коде — это и есть дыра.');
  lines.push('Файл может отсутствовать, а классы быть (переехали в другой наш файл) — такие внизу.');
  lines.push('');
  lines.push('| Файл | Классов | Нет у нас | Док |');
  lines.push('|---|---|---|---|');
  for(const f of notPorted.sort((a, b) => b.missingClasses.length - a.missingClasses.length)) {
    lines.push(`| \`${f.base}\` | ${f.twebClasses} | ${f.missingClasses.length} | ${f.doc ?? '—'} |`);
  }
  lines.push('');

  lines.push('## Портированные файлы с самым большим отставанием');
  lines.push('');
  lines.push('| Файл | Классов в tweb | Есть у нас | Покрытие | Док |');
  lines.push('|---|---|---|---|---|');
  const laggards = inScope
    .filter((f) => f.ported && f.missingClasses.length)
    .sort((a, b) => b.missingClasses.length - a.missingClasses.length)
    .slice(0, 25);
  for(const f of laggards) {
    lines.push(`| \`${f.base}\` | ${f.twebClasses} | ${f.classesPresent} | ${percent(f.coverage)} | ${f.doc ?? '—'} |`);
  }
  lines.push('');
  lines.push('Полные списки недостающих классов — в `styles.json`, поле `missingClasses`.');
  lines.push('');

  lines.push('## Попапы tweb без пары у нас');
  lines.push('');
  lines.push('Сопоставление идёт по имени файла, поэтому переименованный попап тоже попадёт сюда —');
  lines.push('список читать как «проверить», а не как «отсутствует».');
  lines.push('');
  const orphanPopups = popups.popups.filter((p) => !p.ours);
  lines.push(orphanPopups.map((p) => `\`${p.name}\``).join(', ') || '— нет');
  lines.push('');
  if(fuzzyPopups.length) {
    lines.push('### Предположительные пары (совпало не точно)');
    lines.push('');
    lines.push(fuzzyPopups.map((p) => `\`${p.name}\` → \`${p.ours}\``).join(', '));
    lines.push('');
  }
  if(popups.extraOurs.length) {
    lines.push('## Наши попапы без прямого аналога в tweb');
    lines.push('');
    lines.push(popups.extraOurs.map((n) => `\`${n}\``).join(', '));
    lines.push('');
    lines.push('Часть из них — переименования (сопоставление идёт по имени файла), часть — наше собственное.');
    lines.push('');
  }

  lines.push('## Вне скоупа');
  lines.push('');
  lines.push('Не считаем расхождением: ' +
    styles.filter((f) => f.outOfScope).map((f) => `\`${f.base}\``).join(', ') + '.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  assertTweb();
  mkdirSync(INVENTORY_DIR, {recursive: true});

  const our = loadOurIndex();
  const twebScss = collectScss(walk(join(TWEB_DIR, 'src'), isScss), relFromTweb);
  const ourScss = collectScss(our.scssFiles, (f) => f.slice(WEB_CLIENT_SRC.length + 1));

  const ourScssClasses = new Set();
  for(const data of ourScss.values()) for(const cls of data.classes) ourScssClasses.add(cls);

  const meta = {
    generatedAt: new Date().toISOString().slice(0, 10),
    twebDir: TWEB_DIR,
    twebCommit: twebCommit()
  };

  const styles = buildStyles(twebScss, ourScss, ourScssClasses, our);
  const classes = buildClasses(twebScss, ourScssClasses, our);
  const popups = buildPopups(our);

  const write = (name, data) =>
    writeFileSync(join(INVENTORY_DIR, name), JSON.stringify(data, null, 2) + '\n');

  write('styles.json', {meta, files: styles});
  write('classes.json', {meta, classes});
  write('popups.json', {meta, ...popups});
  writeFileSync(join(INVENTORY_DIR, 'coverage.md'), renderCoverage({meta, styles, classes, popups}));

  console.log(`Инвентарь обновлён: ${INVENTORY_DIR}`);
  console.log(`  файлов стилей tweb: ${styles.length}, классов: ${Object.keys(classes).length}, попапов: ${popups.popups.length}`);
}

main();
