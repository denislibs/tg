/**
 * Снимок DOM в том же текстовом формате, в котором лежат эталонные дампы
 * `docs/tweb/dom/dumps/*.json`. Результат скармливается `dom-parity.mjs`.
 *
 * Как снять на нашем стенде:
 *   1. открыть нужный экран (в встроенном браузере — с `?noSharedWorker=1`);
 *   2. выполнить содержимое этого файла в консоли страницы;
 *   3. `__snapshotDom('#main-columns', 5)` → строка; сохранить в файл;
 *   4. `node tools/tweb-parity/dom-parity.mjs 01-skeleton <файл>`.
 *
 * Через Chrome MCP то же самое: evaluate этого файла, затем evaluate вызова.
 *
 * Формат строки: `tag.class1.class2 [style="…"] "текст"`, вложенность — два пробела.
 * Сравниваются только тег, классы и вложенность, поэтому атрибуты и текст здесь
 * нужны человеку для чтения, а не машине для диффа.
 */

(function() {
  var TEXT_LIMIT = 80;
  var STYLE_LIMIT = 120;

  function truncate(value, limit) {
    var text = String(value).replace(/\s+/g, ' ').trim();
    return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
  }

  function describeAttributes(element) {
    var parts = [];
    var style = element.getAttribute('style');
    if(style !== null) parts.push('style="' + truncate(style, STYLE_LIMIT) + '"');
    for(var i = 0; i < element.attributes.length; ++i) {
      var name = element.attributes[i].name;
      if(name.indexOf('data-') === 0) parts.push(name);
    }
    return parts.length ? ' [' + parts.join(' ') + ']' : '';
  }

  function ownText(element) {
    var text = '';
    for(var i = 0; i < element.childNodes.length; ++i) {
      var node = element.childNodes[i];
      if(node.nodeType === 3) text += node.nodeValue;
    }
    return truncate(text, TEXT_LIMIT);
  }

  function describe(element) {
    var tag = element.tagName.toLowerCase();
    var classes = Array.prototype.filter.call(element.classList, Boolean);
    var line = classes.length ? tag + '.' + classes.join('.') : tag;
    line += describeAttributes(element);
    var hasElementChildren = element.children.length > 0;
    var text = ownText(element);
    if(text || !hasElementChildren) line += ' "' + text + '"';
    return line;
  }

  /**
   * @param {string} rootSelector корень снимка, например '#main-columns'
   * @param {number} depth сколько уровней вглубь снимать
   * @returns {string}
   */
  window.__snapshotDom = function(rootSelector, depth) {
    var root = document.querySelector(rootSelector);
    if(!root) throw new Error('Не найден элемент: ' + rootSelector);
    var maxDepth = typeof depth === 'number' ? depth : 5;
    var lines = ['=== ' + rootSelector + ' depth ' + maxDepth + ' ==='];

    (function visit(element, level) {
      if(level > maxDepth) return;
      lines.push(new Array(level).join('  ') + describe(element));
      if(level === maxDepth) return;
      for(var i = 0; i < element.children.length; ++i) visit(element.children[i], level + 1);
    })(root, 1);

    return lines.join('\n');
  };

  return 'готово: __snapshotDom(selector, depth)';
})();
