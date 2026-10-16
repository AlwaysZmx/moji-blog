/*!
 * app.js —— 博客前台：hash 路由 + 视图渲染
 */
(function () {
  'use strict';

  var esc = Markdown.escapeHtml;
  var view = document.getElementById('view');
  var navEl = document.getElementById('nav');
  var searchInput = document.getElementById('searchInput');
  var toastHost = document.getElementById('toastHost');

  var PAGE_SIZE = 6;
  var counted = Object.create(null);

  /* ---------------- 工具 ---------------- */

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    toastHost.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, 2000);
  }

  function encodePath(parts) {
    return parts.filter(function (p) { return p !== '' && p !== null && p !== undefined; })
      .map(function (p) { return encodeURIComponent(p); })
      .join('/');
  }

  /** 构造 hash 链接：#/path?a=1&b=2 */
  function href(path, params) {
    var qs = Object.keys(params || {}).filter(function (k) {
      var v = params[k];
      return v !== '' && v !== null && v !== undefined;
    }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return '#/' + encodePath(Array.isArray(path) ? path : [path]) + (qs ? '?' + qs : '');
  }

  function link(path, page) {
    return href(path, page && page > 1 ? { page: page } : {});
  }

  function parseHash() {
    var raw = location.hash.replace(/^#/, '');
    if (raw.charAt(0) === '/') raw = raw.slice(1);

    var query = {};
    var qi = raw.indexOf('?');
    if (qi !== -1) {
      raw.slice(qi + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        var k = i === -1 ? kv : kv.slice(0, i);
        var v = i === -1 ? '' : kv.slice(i + 1);
        try { query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* ignore */ }
      });
      raw = raw.slice(0, qi);
    }

    var path = raw.split('/').filter(Boolean).map(function (s) {
      try { return decodeURIComponent(s); } catch (e) { return s; }
    });

    return { path: path, query: query };
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtDateLong(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function readingTime(content) {
    var n = String(content || '').replace(/\s/g, '').length;
    return Math.max(1, Math.round(n / 400)) + ' 分钟';
  }

  function throttle(fn, wait) {
    var last = 0;
    var timer = null;
    return function () {
      var args = arguments;
      var nowTs = Date.now();
      var remain = wait - (nowTs - last);
      if (remain <= 0) {
        clearTimeout(timer);
        timer = null;
        last = nowTs;
        fn.apply(null, args);
      } else if (!timer) {
        timer = setTimeout(function () {
          last = Date.now();
          timer = null;
          fn.apply(null, args);
        }, remain);
      }
    };
  }

  /* ---------------- 通用片段 ---------------- */

  function pagination(path, page, pages, extra) {
    if (pages <= 1) return '';

    function pageHref(n) {
      var params = { page: n > 1 ? n : '' };
      Object.keys(extra || {}).forEach(function (k) { params[k] = extra[k]; });
      return href(path, params);
    }

    var out = ['<nav class="pagination">'];
    out.push('<button data-href="' + pageHref(page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>‹ 上一页</button>');

    var nums = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    nums.forEach(function (n) {
      if (n === '…') out.push('<button disabled>…</button>');
      else out.push('<button data-href="' + pageHref(n) + '"' + (n === page ? ' class="active"' : '') + '>' + n + '</button>');
    });

    out.push('<button data-href="' + pageHref(page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页 ›</button>');
    out.push('</nav>');
    return out.join('');
  }

  function postCard(post) {
    var cover = post.cover
      ? '<img class="cover" src="' + esc(post.cover) + '" alt="" loading="lazy">'
      : '';
    var tags = post.tags.slice(0, 3).map(function (t) {
      return '<a class="chip ghost" href="' + link(['tag', t]) + '">' + esc(t) + '</a>';
    }).join('');

    return '' +
      '<article class="post-card">' + cover +
        '<div class="body">' +
          '<h3><a href="' + link(['post', post.id]) + '">' + esc(post.title) + '</a></h3>' +
          '<p class="excerpt">' + esc(post.summary || Blog.excerpt(post.content, 80)) + '</p>' +
          '<div class="foot">' +
            '<time>' + fmtDate(post.createdAt) + '</time>' +
            (post.category ? '<a class="chip" href="' + link(['category', post.category]) + '">' + esc(post.category) + '</a>' : '') +
            (tags ? '<span class="tag-row" style="margin-left:auto">' + tags + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function listRow(post) {
    return '' +
      '<div class="list-item">' +
        '<time>' + fmtDate(post.createdAt) + '</time>' +
        '<div>' +
          '<h3><a href="' + link(['post', post.id]) + '">' + esc(post.title) + '</a></h3>' +
          '<div class="meta">' + esc(post.summary || Blog.excerpt(post.content, 60)) + '</div>' +
        '</div>' +
      '</div>';
  }

  function pagedList(opts, path, renderItem, extra) {
    var res = Blog.listPosts(Object.assign({ pageSize: PAGE_SIZE }, opts));
    if (!res.total) {
      return '<div class="empty"><div class="big">∅</div><p>这里还没有文章。</p></div>';
    }
    return res.items.map(renderItem).join('') + pagination(path, res.page, res.pages, extra);
  }

  /* ---------------- 视图 ---------------- */

  function viewHome(q) {
    var s = Blog.getSettings();
    var page = parseInt(q.page, 10) || 1;
    var res = Blog.listPosts({ page: page, pageSize: PAGE_SIZE, status: 'published' });
    var cats = Blog.categories().filter(function (c) { return c.count > 0; });
    var tagsList = Blog.tags().filter(function (t) { return t.count > 0; }).slice(0, 12);

    var html = '' +
      '<section class="hero">' +
        '<h1>' + esc(s.title) + '</h1>' +
        '<p>' + esc(s.description) + '</p>' +
        '<div class="hero-meta">共 ' + Blog.listPosts({ status: 'published', paged: false }).total +
          ' 篇文章 · ' + cats.length + ' 个分类 · ' + tagsList.length + '+ 个标签</div>' +
      '</section>';

    html += '<div class="section-title"><h2>最新文章</h2><span>第 ' + res.page + ' / ' + res.pages + ' 页</span></div>';

    html += res.total
      ? '<div class="post-grid">' + res.items.map(postCard).join('') + '</div>'
      : '<div class="empty"><div class="big">✎</div><p>还没有发布任何文章。' +
        '<a href="admin.html">去后台写一篇 →</a></p></div>';

    html += pagination([], res.page, res.pages);

    if (cats.length) {
      html += '<div class="section-title"><h2>分类</h2><a class="more" href="#/categories">全部 →</a></div>';
      html += '<div class="tag-row">' + cats.map(function (c) {
        return '<a class="chip" href="' + link(['category', c.name]) + '">' + esc(c.name) + ' · ' + c.count + '</a>';
      }).join('') + '</div>';
    }

    if (tagsList.length) {
      html += '<div class="section-title"><h2>热门标签</h2><a class="more" href="#/tags">全部 →</a></div>';
      html += '<div class="tag-row">' + tagsList.map(function (t) {
        return '<a class="chip ghost" href="' + link(['tag', t.name]) + '">#' + esc(t.name) + ' · ' + t.count + '</a>';
      }).join('') + '</div>';
    }

    return { html: html, nav: 'home', title: s.title + ' · ' + s.subtitle };
  }

  function viewPost(id) {
    var post = Blog.getPost(id);
    if (!post || post.status !== 'published') {
      return { html: notFound('文章不存在或已下架'), nav: '', title: '未找到' };
    }

    var isFirst = !counted[post.id];
    if (isFirst) {
      counted[post.id] = 1;
      Blog.viewPost(post.id);
      post = Blog.getPost(post.id);
    }

    var parsed = Markdown.parse(post.content);
    var toc = '';
    var hs = parsed.headings.filter(function (h) { return h.level === 2 || h.level === 3; });
    if (hs.length >= 3) {
      // 注意：不能使用 href="#id"，否则会与 hash 路由冲突
      toc = '<div class="toc"><strong>目录</strong><ul>' + hs.map(function (h) {
        return '<li class="lv' + h.level + '"><a data-anchor="' + esc(h.id) + '">' +
          esc(h.text) + '</a></li>';
      }).join('') + '</ul></div>';
    }

    var n = Blog.neighbors(post.id);

    var html = '' +
      '<article class="article">' +
        '<div class="crumbs"><a href="#/">首页</a>' +
          (post.category ? ' / <a href="' + link(['category', post.category]) + '">' + esc(post.category) + '</a>' : '') +
          ' / <span>正文</span></div>' +
        '<h1 class="article-title">' + esc(post.title) + '</h1>' +
        '<div class="article-meta">' +
          '<span>✍ ' + esc(Blog.getSettings().author) + '</span>' +
          '<span class="dot">·</span><span>' + fmtDateLong(post.createdAt) + '</span>' +
          '<span class="dot">·</span><span>' + readingTime(post.content) + '</span>' +
          '<span class="dot">·</span><span>阅读 ' + post.views + '</span>' +
        '</div>' +
        (post.cover ? '<img class="article-cover" src="' + esc(post.cover) + '" alt="' + esc(post.title) + '">' : '') +
        toc +
        '<div class="prose">' + parsed.html + '</div>' +
        '<div class="article-foot">' +
          (post.tags.length
            ? '<div class="tag-row">' + post.tags.map(function (t) {
                return '<a class="chip ghost" href="' + link(['tag', t]) + '">#' + esc(t) + '</a>';
              }).join('') + '</div>'
            : '') +
          '<div class="neighbors">' +
            (n.prev
              ? '<a class="neighbor" href="' + link(['post', n.prev.id]) + '"><small>← 上一篇</small><span>' + esc(n.prev.title) + '</span></a>'
              : '<span class="neighbor empty"></span>') +
            (n.next
              ? '<a class="neighbor next" href="' + link(['post', n.next.id]) + '"><small>下一篇 →</small><span>' + esc(n.next.title) + '</span></a>'
              : '<span class="neighbor empty"></span>') +
          '</div>' +
        '</div>' +
      '</article>';

    return { html: html, nav: '', title: post.title + ' · ' + Blog.getSettings().title };
  }

  function viewCategory(name, q) {
    var page = parseInt(q.page, 10) || 1;
    var html = '<div class="page-head"><h1>分类：' + esc(name) + '</h1>' +
      '<p><a href="#/categories">← 返回全部分类</a></p></div>';
    html += pagedList(
      { category: name, page: page, status: 'published' },
      ['category', name],
      listRow
    );
    return { html: html, nav: 'categories', title: '分类：' + name };
  }

  function viewTag(name, q) {
    var page = parseInt(q.page, 10) || 1;
    var html = '<div class="page-head"><h1>标签：#' + esc(name) + '</h1>' +
      '<p><a href="#/tags">← 返回全部标签</a></p></div>';
    html += pagedList(
      { tag: name, page: page, status: 'published' },
      ['tag', name],
      listRow
    );
    return { html: html, nav: 'tags', title: '标签：' + name };
  }

  function viewCategories() {
    var cats = Blog.categories();
    var html = '<div class="page-head"><h1>全部分类</h1><p>共 ' + cats.length + ' 个分类</p></div>';
    html += cats.length
      ? '<div class="taxonomy-grid">' + cats.map(function (c) {
          return '<a class="taxonomy-card" href="' + link(['category', c.name]) + '">' +
            '<b>' + esc(c.name) + '</b><span>' + c.count + ' 篇</span></a>';
        }).join('') + '</div>'
      : '<div class="empty"><div class="big">∅</div><p>还没有分类。</p></div>';
    return { html: html, nav: 'categories', title: '全部分类' };
  }

  function viewTags() {
    var ts = Blog.tags();
    var html = '<div class="page-head"><h1>全部标签</h1><p>共 ' + ts.length + ' 个标签</p></div>';
    html += ts.length
      ? '<div class="tag-row">' + ts.map(function (t) {
          return '<a class="chip' + (t.count ? '' : ' ghost') + '" href="' + link(['tag', t.name]) + '">' +
            '#' + esc(t.name) + ' · ' + t.count + '</a>';
        }).join('') + '</div>'
      : '<div class="empty"><div class="big">∅</div><p>还没有标签。</p></div>';
    return { html: html, nav: 'tags', title: '全部标签' };
  }

  function viewArchive() {
    var posts = Blog.listPosts({ status: 'published', paged: false }).items;
    var groups = {};
    posts.forEach(function (p) {
      var y = new Date(p.createdAt).getFullYear() || '未知';
      (groups[y] = groups[y] || []).push(p);
    });
    var years = Object.keys(groups).sort(function (a, b) { return b - a; });

    var html = '<div class="page-head"><h1>归档</h1><p>共 ' + posts.length + ' 篇已发布文章</p></div>';
    html += years.length
      ? years.map(function (y) {
          return '<section class="year-group"><h2>' + y + ' 年 <span style="font-size:13px;color:var(--muted)">' +
            groups[y].length + ' 篇</span></h2>' +
            groups[y].map(listRow).join('') + '</section>';
        }).join('')
      : '<div class="empty"><div class="big">∅</div><p>还没有文章。</p></div>';

    return { html: html, nav: 'archive', title: '归档' };
  }

  function viewSearch(q) {
    var keyword = (q.q || '').trim();
    if (!keyword) return viewHome({});
    var page = parseInt(q.page, 10) || 1;
    var res = Blog.listPosts({ q: keyword, page: page, pageSize: PAGE_SIZE, status: 'published' });

    var html = '<div class="page-head"><h1>搜索：' + esc(keyword) + '</h1>' +
      '<p>找到 ' + res.total + ' 条结果</p></div>';

    if (!res.total) {
      html += '<div class="empty"><div class="big">⌕</div><p>没有找到匹配的文章，换个关键词试试。</p></div>';
    } else {
      html += res.items.map(function (p) {
        var snippet = Blog.excerpt(p.content, 110);
        return '<div class="list-item">' +
          '<time>' + fmtDate(p.createdAt) + '</time>' +
          '<div><h3><a href="' + link(['post', p.id]) + '">' + esc(p.title) + '</a></h3>' +
          '<div class="meta">' + esc(snippet) + '</div></div></div>';
      }).join('');
      html += pagination(['search'], res.page, res.pages, { q: keyword });
    }

    return { html: html, nav: '', title: '搜索：' + keyword };
  }

  function viewAbout() {
    var s = Blog.getSettings();
    var st = Blog.stats();
    var html = '' +
      '<div class="page-head"><h1>关于</h1><p>' + esc(s.subtitle) + '</p></div>' +
      '<div class="article"><div class="prose">' +
        '<h2>关于本站</h2><p>' + esc(s.description) + '</p>' +
        '<h2>关于作者</h2><p>' + esc(s.author) + '</p>' +
        '<h2>本站数据</h2>' +
        '<div class="table-wrap"><table><tbody>' +
          '<tr><th>已发布文章</th><td>' + st.published + ' 篇</td></tr>' +
          '<tr><th>草稿</th><td>' + st.drafts + ' 篇</td></tr>' +
          '<tr><th>分类 / 标签</th><td>' + st.categories + ' / ' + st.tags + '</td></tr>' +
          '<tr><th>累计阅读</th><td>' + st.views + ' 次</td></tr>' +
          '<tr><th>总字数</th><td>约 ' + st.words.toLocaleString() + ' 字</td></tr>' +
        '</tbody></table></div>' +
        '<h2>技术说明</h2>' +
        '<p>这是一个<strong>纯静态</strong>博客系统：页面由 HTML + CSS + JavaScript 组成，' +
        '没有传统数据库。已发布的文章保存在一个 JSON 文件里，' +
        '通过 <code>/api/db</code> 读写，Markdown 在浏览器端实时渲染。</p>' +
        '<blockquote><p>所以同一批文章在任何设备、任何浏览器上都能看到。' +
        '没写完的草稿只留在写它的那台电脑上，' +
        '在 <a href="admin.html">管理后台</a> 里点「保存」并设为已发布后才会同步出去。</p></blockquote>' +
      '</div></div>';
    return { html: html, nav: 'about', title: '关于 · ' + s.title };
  }

  function notFound(msg) {
    return '<div class="empty"><div class="big">404</div><p>' + esc(msg || '页面不存在') +
      '</p><p><a href="#/">返回首页</a></p></div>';
  }

  /* ---------------- 路由 ---------------- */

  var currentNav = '';

  function render() {
    var r = parseHash();
    var p = r.path;
    var result;

    try {
      if (!p.length) result = viewHome(r.query);
      else if (p[0] === 'post' && p[1]) result = viewPost(p[1]);
      else if (p[0] === 'category' && p[1]) result = viewCategory(p[1], r.query);
      else if (p[0] === 'tag' && p[1]) result = viewTag(p[1], r.query);
      else if (p[0] === 'categories') result = viewCategories();
      else if (p[0] === 'tags') result = viewTags();
      else if (p[0] === 'archive') result = viewArchive();
      else if (p[0] === 'search') result = viewSearch(r.query);
      else if (p[0] === 'about') result = viewAbout();
      else result = { html: notFound(), nav: '', title: '未找到' };
    } catch (err) {
      result = {
        html: '<div class="empty"><div class="big">⚠</div><p>页面渲染出错：' + esc(err.message) + '</p></div>',
        nav: '', title: '出错了'
      };
    }

    view.innerHTML = result.html;
    document.title = result.title || Blog.getSettings().title;
    currentNav = result.nav;
    syncChrome();
    window.scrollTo(0, 0);
  }

  function syncChrome() {
    Array.prototype.forEach.call(navEl.querySelectorAll('a'), function (a) {
      a.classList.toggle('active', !!currentNav && a.getAttribute('data-nav') === currentNav);
    });
    navEl.classList.remove('open');

    // 搜索框：只在搜索页回填，离开搜索页时清空
    if (document.activeElement !== searchInput) {
      var r = parseHash();
      searchInput.value = r.path[0] === 'search' ? (r.query.q || '') : '';
    }
  }

  /* ---------------- 头部交互 ---------------- */

  // 主题只是访客的本机偏好，不改站点设置、也不触发任何写操作
  document.getElementById('themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('dshm_blog_theme', next); } catch (e) { /* ignore */ }
    toast(next === 'dark' ? '已切换到深色模式' : '已切换到浅色模式');
  });

  document.getElementById('menuBtn').addEventListener('click', function () {
    navEl.classList.toggle('open');
  });

  var goSearch = throttle(function () {
    var v = searchInput.value.trim();
    location.hash = v ? link(['search']) + '?q=' + encodeURIComponent(v) : '#/';
  }, 450);

  searchInput.addEventListener('input', goSearch);
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var v = searchInput.value.trim();
      location.hash = v ? link(['search']) + '?q=' + encodeURIComponent(v) : '#/';
    }
  });

  // 分页按钮 → 直接改 hash；目录锚点 → 平滑滚动（不走路由）
  view.addEventListener('click', function (e) {
    var anchor = e.target.closest('[data-anchor]');
    if (anchor) {
      e.preventDefault();
      var target = document.getElementById(anchor.getAttribute('data-anchor'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var btn = e.target.closest('button[data-href]');
    if (btn && !btn.disabled) {
      location.hash = btn.getAttribute('data-href');
    }
  });

  window.addEventListener('hashchange', render);

  /* ---------------- 启动 ---------------- */

  function boot(sync) {
    var s = Blog.getSettings();
    document.getElementById('brandName').textContent = s.title;
    document.getElementById('footerText').textContent = s.footer;

    var saved = s.theme;
    try {
      var t = localStorage.getItem('dshm_blog_theme');
      if (t) saved = t;
    } catch (e) { /* ignore */ }
    document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');

    if (!location.hash) location.hash = '#/';
    render();

    if (!Blog.isStorageOK()) {
      view.insertAdjacentHTML('afterbegin',
        '<div class="notice">当前浏览器禁用了本地存储（可能是隐私模式），本机读到的内容无法缓存。</div>');
    }

    // 云端拿不到数据时如实说明，不要让访客以为看到的就是最新内容
    if (sync && sync.checked && !sync.remote) {
      view.insertAdjacentHTML('afterbegin',
        '<div class="notice">云端数据暂时不可用，当前显示的是本机缓存的内容。' +
        (sync.error ? '原因：' + esc(sync.error) : '') + '</div>');
    }
  }

  // 必须等数据层把云端内容合并完再渲染，否则会先闪一下本机的旧数据
  Blog.ready().then(boot, function () { boot(null); });
})();
