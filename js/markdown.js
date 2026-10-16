/*!
 * markdown.js —— 零依赖 Markdown 渲染器（面向博客排版）
 *
 * 支持：标题 / 段落 / 粗体 / 斜体 / 删除线 / 行内代码 / 围栏代码块 /
 *      有序·无序列表（含嵌套与任务列表）/ 引用 / 分割线 / 链接 / 图片 /
 *      表格（含对齐）/ 软换行 / 标题锚点
 *
 * 安全：所有文本先做 HTML 转义，再拼接标签；链接协议做白名单过滤。
 * 对外暴露：window.Markdown.render(src) / window.Markdown.parse(src)
 */
(function (global) {
  'use strict';

  var PH_BLOCK = '\u0000B';
  var PH_CODE = '\u0000C';
  var PH_END = '\u0000';

  /* ---------- 转义与 URL ---------- */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 反向还原实体（&amp; 必须最后处理），用于把已转义文本变回纯文本
  function unescapeHtml(str) {
    return String(str)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function safeUrl(url, isImage) {
    var u = String(url || '').trim();
    var lower = u.toLowerCase();
    if (lower.indexOf('javascript:') === 0 || lower.indexOf('vbscript:') === 0) return '#';
    if (lower.indexOf('data:') === 0 && !(isImage && lower.indexOf('data:image/') === 0)) return '#';
    return u.replace(/"/g, '%22').replace(/\s/g, '%20');
  }

  /* ---------- 行内渲染 ---------- */

  function inline(text) {
    var codes = [];

    // 1) 行内代码先摘出来，避免内部被其它规则改写
    text = text.replace(/`([^`]+)`/g, function (m, code) {
      codes.push(code);
      return PH_CODE + (codes.length - 1) + PH_END;
    });

    // 2) 图片（必须在链接之前，否则会先被链接规则吃掉中括号）
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, function (m, alt, url) {
      var src = safeUrl(url, true);
      return '<img src="' + src + '" alt="' + alt + '" loading="lazy">';
    });

    // 3) 链接
    text = text.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, function (m, label, url) {
      var href = safeUrl(url, false);
      if (href === '#') return label;
      var external = /^https?:\/\//i.test(href);
      return '<a href="' + href + '"' +
        (external ? ' target="_blank" rel="noopener noreferrer"' : '') +
        '>' + label + '</a>';
    });

    // 4) 粗体 / 删除线 / 斜体
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    text = text.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

    // 5) 还原行内代码
    text = text.replace(new RegExp(PH_CODE + '(\\d+)' + PH_END, 'g'), function (m, n) {
      return '<code>' + codes[+n] + '</code>';
    });

    return text;
  }

  /* ---------- 标题锚点 ---------- */

  function slugify(text) {
    var s = String(text).replace(/<[^>]+>/g, '').trim().toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\- ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return s.slice(0, 60) || 'section';
  }

  /* ---------- 块级判定 ---------- */

  var RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var RE_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
  var RE_QUOTE = /^ {0,3}>/;
  var RE_LIST = /^( *)([-*+]|\d+[.)])[ \t]+(.*)$/;
  var RE_BLOCK_PH = /^\u0000B(\d+)\u0000$/;

  function isBlockStart(line) {
    if (!line.trim()) return true;
    if (RE_BLOCK_PH.test(line)) return true;
    if (RE_HEADING.test(line)) return true;
    if (RE_QUOTE.test(line)) return true;
    if (RE_LIST.test(line)) return true;
    if (RE_HR.test(line)) return true;
    return false;
  }

  /* ---------- 列表 ---------- */

  function parseList(lines, start) {
    var first = lines[start].match(RE_LIST);
    var baseIndent = first[1].length;
    var ordered = /\d/.test(first[2]);
    var items = [];
    var i = start;

    while (i < lines.length) {
      var m = lines[i].match(RE_LIST);

      if (!m) {
        // 项目内续行：非空且缩进更深
        var indent = (lines[i].match(/^ */) || [''])[0].length;
        if (items.length && lines[i].trim() && indent > baseIndent && !isBlockStart(lines[i])) {
          items[items.length - 1].lines.push(lines[i].trim());
          i++;
          continue;
        }
        break;
      }

      var ind = m[1].length;
      if (ind < baseIndent) break;

      if (ind > baseIndent) {
        if (!items.length) break;
        var sub = parseList(lines, i);
        items[items.length - 1].blocks.push(sub.html);
        i = sub.next;
        continue;
      }

      if (ordered && !/\d/.test(m[2])) break;
      items.push({ lines: [m[3]], blocks: [] });
      i++;
    }

    var tag = ordered ? 'ol' : 'ul';
    var body = items.map(function (item) {
      var text = item.lines.join('\n');
      var checked = text.match(/^\[([ xX])\][ \t]+([\s\S]*)$/);
      var cls = '';
      if (checked) {
        cls = ' class="task' + (checked[1].toLowerCase() === 'x' ? ' done' : '') + '"';
        text = (checked[1].toLowerCase() === 'x' ? '\u2611 ' : '\u2610 ') + checked[2];
      }
      var inner = inline(text).replace(/\n/g, '<br>');
      return '<li' + cls + '>' + inner + item.blocks.join('') + '</li>';
    }).join('');

    return { html: '<' + tag + '>' + body + '</' + tag + '>', next: i };
  }

  /* ---------- 表格 ---------- */

  function splitRow(line) {
    return line.replace(/^[ \t]*\|/, '').replace(/\|[ \t]*$/, '').split('|')
      .map(function (c) { return c.trim(); });
  }

  function isTableSep(line) {
    if (line.indexOf('-') === -1) return false;
    if (line.indexOf('|') === -1) return false;
    return /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/.test(line);
  }

  function parseTable(lines, start) {
    var head = splitRow(lines[start]);
    var align = splitRow(lines[start + 1]).map(function (c) {
      var left = c.charAt(0) === ':';
      var right = c.charAt(c.length - 1) === ':';
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return '';
    });

    var i = start + 2;
    var rows = [];
    while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) {
      rows.push(splitRow(lines[i]));
      i++;
    }

    function cell(tag, text, idx) {
      var a = align[idx] ? ' class="ta-' + align[idx] + '"' : '';
      return '<' + tag + a + '>' + inline(text) + '</' + tag + '>';
    }

    var thead = head.map(function (c, idx) { return cell('th', c, idx); }).join('');
    var tbody = rows.map(function (r) {
      var tds = [];
      for (var k = 0; k < head.length; k++) {
        tds.push(cell('td', r[k] === undefined ? '' : r[k], k));
      }
      return '<tr>' + tds.join('') + '</tr>';
    }).join('');

    var html = '<div class="table-wrap"><table><thead><tr>' + thead +
      '</tr></thead><tbody>' + tbody + '</tbody></table></div>';

    return { html: html, next: i };
  }

  /* ---------- 主解析 ---------- */

  function parse(src) {
    var source = String(src === undefined || src === null ? '' : src).replace(/\r\n?/g, '\n');

    // 先抽出围栏代码块（此时尚未转义，原样保存）
    var blocks = [];
    source = source.replace(/^```([^\n`]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, function (m, lang, code) {
      blocks.push({ lang: String(lang).trim(), code: code.replace(/\n$/, '') });
      return PH_BLOCK + (blocks.length - 1) + PH_END;
    });

    var escaped = escapeHtml(source);
    var lines = escaped.split('\n');

    var headings = [];
    var usedIds = Object.create(null);

    function renderCode(block) {
      var cls = block.lang ? ' class="language-' + escapeHtml(block.lang) + '"' : '';
      var label = block.lang ? '<span class="code-lang">' + escapeHtml(block.lang) + '</span>' : '';
      return '<div class="code-block">' + label +
        '<pre><code' + cls + '>' + escapeHtml(block.code) + '</code></pre></div>';
    }

    function parseBlocks(list) {
      var html = [];
      var i = 0;

      while (i < list.length) {
        var line = list[i];

        if (!line.trim()) { i++; continue; }

        // 代码块占位
        var ph = line.match(RE_BLOCK_PH);
        if (ph) {
          html.push(renderCode(blocks[+ph[1]]));
          i++;
          continue;
        }

        // 分割线
        if (RE_HR.test(line)) {
          html.push('<hr>');
          i++;
          continue;
        }

        // 标题
        var h = line.match(RE_HEADING);
        if (h) {
          var level = h[1].length;
          var raw = h[2];                                   // 已转义的标题文本
          var plain = unescapeHtml(raw).replace(/[*_`~]/g, '').trim(); // 目录用纯文本
          var id = slugify(plain);
          if (usedIds[id]) {
            usedIds[id]++;
            id = id + '-' + usedIds[id];
          } else {
            usedIds[id] = 1;
          }
          headings.push({ level: level, text: plain, id: id });
          html.push('<h' + level + ' id="' + id + '">' + inline(raw) + '</h' + level + '>');
          i++;
          continue;
        }

        // 引用（支持嵌套）
        if (RE_QUOTE.test(line)) {
          var q = [];
          while (i < list.length && RE_QUOTE.test(list[i])) {
            q.push(list[i].replace(/^ {0,3}>[ \t]?/, ''));
            i++;
          }
          html.push('<blockquote>' + parseBlocks(q) + '</blockquote>');
          continue;
        }

        // 表格
        if (line.indexOf('|') !== -1 && i + 1 < list.length && isTableSep(list[i + 1])) {
          var t = parseTable(list, i);
          html.push(t.html);
          i = t.next;
          continue;
        }

        // 列表
        if (RE_LIST.test(line)) {
          var l = parseList(list, i);
          if (l.next === i) { i++; continue; }
          html.push(l.html);
          i = l.next;
          continue;
        }

        // 段落
        var para = [];
        while (i < list.length && !isBlockStart(list[i])) {
          para.push(list[i]);
          i++;
        }
        if (para.length) {
          html.push('<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
        } else {
          i++;
        }
      }

      return html.join('\n');
    }

    var html = parseBlocks(lines);
    return { html: html, headings: headings };
  }

  function render(src) {
    return parse(src).html;
  }

  global.Markdown = {
    render: render,
    parse: parse,
    escapeHtml: escapeHtml,
    slugify: slugify
  };
})(window);
