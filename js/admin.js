/*!
 * admin.js —— 管理后台：登录 / 仪表盘 / 文章 CRUD / 分类标签 / 设置 / 备份
 */
(function () {
  'use strict';

  var esc = Markdown.escapeHtml;
  var AUTH_KEY = 'dshm_blog_auth';
  var DRAFT_KEY = 'dshm_blog_editor_draft';

  var loginView = document.getElementById('loginView');
  var appView = document.getElementById('appView');
  var view = document.getElementById('view');
  var modalHost = document.getElementById('modalHost');
  var toastHost = document.getElementById('toastHost');
  var sideNav = document.getElementById('sideNav');
  var sidebar = document.getElementById('sidebar');
  var pageTitle = document.getElementById('pageTitle');
  var topHint = document.getElementById('topHint');

  var dirty = false;
  var editingId = null;
  var listState = { q: '', status: 'all', category: '', page: 1, pageSize: 10 };

  /* ============================================================
     基础工具
     ============================================================ */

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    toastHost.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(16px)';
      setTimeout(function () { el.remove(); }, 260);
    }, 2400);
  }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function parseHash() {
    var raw = location.hash.replace(/^#/, '');
    if (raw.charAt(0) === '/') raw = raw.slice(1);
    return raw.split('/').filter(Boolean).map(function (s) {
      try { return decodeURIComponent(s); } catch (e) { return s; }
    });
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        resolve();
      } catch (e) { reject(e); }
    });
  }

  /* ---------------- 模态 ---------------- */

  function openModal(opts) {
    var mask = document.createElement('div');
    mask.className = 'modal-mask';

    var inputHtml = opts.input
      ? '<input type="' + (opts.inputType || 'text') + '" id="modalInput" ' +
        'placeholder="' + esc(opts.placeholder || '') + '" value="' + esc(opts.value || '') + '">'
      : '';

    mask.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<h3>' + esc(opts.title) + '</h3>' +
        (opts.desc ? '<p>' + esc(opts.desc) + '</p>' : '') +
        inputHtml +
        '<div class="btn-row">' +
          (opts.cancelText === null ? '' : '<button class="btn" data-m="cancel">' + esc(opts.cancelText || '取消') + '</button>') +
          '<button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-m="ok">' + esc(opts.confirmText || '确定') + '</button>' +
        '</div>' +
      '</div>';

    function close() {
      mask.remove();
      document.removeEventListener('keydown', onKey);
    }

    function submit() {
      var val = opts.input ? mask.querySelector('#modalInput').value : true;
      if (opts.input && opts.required !== false && !String(val).trim()) {
        mask.querySelector('#modalInput').focus();
        return;
      }
      close();
      if (opts.onConfirm) opts.onConfirm(val);
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && opts.input) { e.preventDefault(); submit(); }
    }

    mask.addEventListener('click', function (e) {
      if (e.target === mask) return close();
      var m = e.target.getAttribute && e.target.getAttribute('data-m');
      if (m === 'cancel') close();
      if (m === 'ok') submit();
    });

    document.addEventListener('keydown', onKey);
    modalHost.appendChild(mask);

    var inp = mask.querySelector('#modalInput');
    if (inp) setTimeout(function () { inp.focus(); inp.select(); }, 30);
    else setTimeout(function () { mask.querySelector('[data-m="ok"]').focus(); }, 30);
  }

  function confirmAction(title, desc, onOk, danger) {
    openModal({
      title: title,
      desc: desc,
      confirmText: danger ? '确认删除' : '确定',
      danger: !!danger,
      onConfirm: onOk
    });
  }

  /* ============================================================
     登录
     ============================================================ */

  function isAuthed() {
    try { return sessionStorage.getItem(AUTH_KEY) === '1'; } catch (e) { return false; }
  }

  function setAuthed(v) {
    try {
      if (v) sessionStorage.setItem(AUTH_KEY, '1');
      else sessionStorage.removeItem(AUTH_KEY);
    } catch (e) { /* ignore */ }
  }

  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('pwdInput');
    var tip = document.getElementById('pwdTip');
    if (Blog.login(input.value)) {
      setAuthed(true);
      input.value = '';
      tip.textContent = '';
      enterApp();
      toast('欢迎回来', 'ok');
    } else {
      tip.innerHTML = '<span style="color:var(--danger)">密码不正确，请重试。</span>';
      input.select();
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    function doLogout() {
      setAuthed(false);
      dirty = false;
      writeDraft(null);
      appView.hidden = true;
      loginView.hidden = false;
      document.getElementById('pwdInput').focus();
    }
    if (dirty) {
      confirmAction('放弃未保存的修改？', '当前文章有未保存的内容，退出后会丢失。', doLogout, true);
    } else {
      doLogout();
    }
  });

  function enterApp() {
    loginView.hidden = true;
    appView.hidden = false;
    if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
    render();
  }

  /* ============================================================
     离开保护
     ============================================================ */

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#/"]') : null;
    if (!a || !dirty) return;
    if (a.getAttribute('href') === location.hash) return;
    var ok = window.confirm('当前文章有未保存的内容，确定要离开吗？');
    if (!ok) {
      e.preventDefault();
      e.stopPropagation();
    } else {
      dirty = false;
    }
  }, true);

  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  /* ============================================================
     路由
     ============================================================ */

  var NAV_TITLE = {
    dashboard: '仪表盘',
    posts: '文章管理',
    editor: '写文章',
    taxonomy: '分类与标签',
    settings: '站点设置',
    backup: '数据备份',
    account: '修改密码'
  };

  function render() {
    if (!isAuthed()) return;

    var path = parseHash();
    var key = path[0] || 'dashboard';
    var result;

    try {
      switch (key) {
        case 'dashboard': result = viewDashboard(); break;
        case 'posts': result = viewPosts(); break;
        case 'editor': result = viewEditor(path[1] && path[1] !== 'new' ? path[1] : null); break;
        case 'taxonomy': result = viewTaxonomy(); break;
        case 'settings': result = viewSettings(); break;
        case 'backup': result = viewBackup(); break;
        case 'account': result = viewAccount(); break;
        default: result = viewDashboard(); key = 'dashboard';
      }
    } catch (err) {
      result = {
        html: '<div class="notice err">页面渲染出错：' + esc(err.message) + '</div>',
        nav: '',
        title: '出错了'
      };
    }

    view.innerHTML = result.html;
    view.className = 'content' + (result.narrow ? ' narrow' : '');
    pageTitle.textContent = result.title || NAV_TITLE[result.nav] || '管理后台';
    document.title = pageTitle.textContent + ' · 墨迹';
    highlightNav(result.nav);
    sidebar.classList.remove('open');

    var st = Blog.stats();
    topHint.textContent = st.total + ' 篇文章 · ' + st.published + ' 已发布 / ' + st.drafts + ' 草稿';
    document.getElementById('badgePosts').textContent = st.total;

    if (result.after) result.after();
  }

  function highlightNav(nav) {
    Array.prototype.forEach.call(sideNav.querySelectorAll('a'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === nav);
    });
  }

  window.addEventListener('hashchange', render);

  /* ============================================================
     视图：仪表盘
     ============================================================ */

  function viewDashboard() {
    var st = Blog.stats();
    var storageNote = Blog.isStorageOK() ? '' :
      '<div class="notice">当前浏览器禁用了本地存储（可能是隐私模式）。数据只存在内存里，请尽快到「数据备份」导出，或关闭无痕模式。</div>';

    var html = storageNote;

    html += '<div class="stat-grid">' +
      stat('已发布', st.published, '篇', true) +
      stat('草稿', st.drafts, '篇') +
      stat('分类', st.categories, '个') +
      stat('标签', st.tags, '个') +
      stat('累计阅读', st.views, '次') +
      stat('总字数', st.words > 9999 ? (st.words / 10000).toFixed(1) : st.words, st.words > 9999 ? '万字' : '字') +
      '</div>';

    html += '<div class="card"><h2>快速操作</h2><p class="desc">常用入口</p>' +
      '<div class="btn-row">' +
        '<a class="btn primary" href="#/editor/new">✎ 写新文章</a>' +
        '<a class="btn" href="#/posts">▦ 管理文章</a>' +
        '<a class="btn" href="#/taxonomy">◈ 分类与标签</a>' +
        '<a class="btn" href="#/backup">⇅ 导出备份</a>' +
        '<a class="btn" href="index.html" target="_blank" rel="noopener">↗ 查看站点</a>' +
      '</div></div>';

    html += '<div class="card flush"><div class="head" style="display:flex;align-items:center">' +
      '<h2>最近更新</h2>' +
      '<a class="btn sm" style="margin-left:auto" href="#/posts">全部 →</a></div>';

    if (!st.recent.length) {
      html += '<div class="empty-row">还没有文章，<a href="#/editor/new">现在写一篇</a>。</div>';
    } else {
      html += '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>标题</th><th>分类</th><th>状态</th><th>更新于</th><th class="actions">操作</th>' +
        '</tr></thead><tbody>' +
        st.recent.map(function (p) {
          return '<tr>' +
            '<td class="title-cell"><b>' + esc(p.title) + '</b></td>' +
            '<td>' + (p.category ? '<span class="pill tag">' + esc(p.category) + '</span>' : '<span class="pill gray">未分类</span>') + '</td>' +
            '<td>' + statusPill(p.status) + '</td>' +
            '<td>' + fmtDateTime(p.updatedAt) + '</td>' +
            '<td class="actions"><a class="btn sm" href="#/editor/' + esc(p.id) + '">编辑</a></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>';
    }
    html += '</div>';

    return { html: html, nav: 'dashboard', title: '仪表盘' };
  }

  function stat(label, value, unit, accent) {
    return '<div class="stat' + (accent ? ' accent' : '') + '">' +
      '<div class="label">' + label + '</div>' +
      '<div class="value">' + value + '<small>' + unit + '</small></div></div>';
  }

  function statusPill(status) {
    return status === 'draft'
      ? '<span class="pill draft">草稿</span>'
      : '<span class="pill ok">已发布</span>';
  }

  /* ============================================================
     视图：文章列表
     ============================================================ */

  function viewPosts() {
    var res = Blog.listPosts({
      status: listState.status,
      category: listState.category,
      q: listState.q,
      page: listState.page,
      pageSize: listState.pageSize
    });

    var cats = Blog.categories();
    var allCount = Blog.listPosts({ status: 'all', paged: false }).total;

    var html = '<div class="card flush">';

    html += '<div class="toolbar">' +
      '<input type="search" id="fq" placeholder="搜索标题或内容…" value="' + esc(listState.q) + '">' +
      '<select id="fstatus">' +
        opt('all', '全部状态', listState.status) +
        opt('published', '已发布', listState.status) +
        opt('draft', '草稿', listState.status) +
      '</select>' +
      '<select id="fcat">' + opt('', '全部分类', listState.category) +
        cats.map(function (c) { return opt(c.name, c.name + '（' + c.count + '）', listState.category); }).join('') +
      '</select>' +
      '<button class="btn sm" id="freset">重置</button>' +
      '<a class="btn primary sm" style="margin-left:auto" href="#/editor/new">+ 新建文章</a>' +
      '</div>';

    if (!res.total) {
      html += '<div class="empty-row">' +
        (listState.q || listState.status !== 'all' || listState.category
          ? '没有符合条件的文章。'
          : '还没有文章，<a href="#/editor/new">写第一篇</a>。') +
        '</div>';
    } else {
      html += '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>标题</th><th>分类</th><th>标签</th><th>状态</th><th>阅读</th><th>更新于</th><th class="actions">操作</th>' +
        '</tr></thead><tbody>' +
        res.items.map(function (p) {
          return '<tr data-id="' + esc(p.id) + '">' +
            '<td class="title-cell"><b>' + esc(p.title) + '</b>' +
              '<div class="slug">/' + esc(p.slug) + ' · ' + esc(fmtDate(p.createdAt)) + '</div></td>' +
            '<td>' + (p.category ? '<span class="pill tag">' + esc(p.category) + '</span>' : '<span class="pill gray">未分类</span>') + '</td>' +
            '<td>' + (p.tags.length
              ? p.tags.slice(0, 3).map(function (t) { return '<span class="pill gray">' + esc(t) + '</span>'; }).join(' ')
              : '—') + '</td>' +
            '<td>' + statusPill(p.status) + '</td>' +
            '<td>' + p.views + '</td>' +
            '<td style="white-space:nowrap">' + fmtDateTime(p.updatedAt) + '</td>' +
            '<td class="actions">' +
              '<a class="btn sm" href="#/editor/' + esc(p.id) + '">编辑</a> ' +
              '<button class="btn sm" data-act="toggle">' + (p.status === 'draft' ? '发布' : '下架') + '</button> ' +
              '<button class="btn sm danger" data-act="del">删除</button>' +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>';

      html += '<div style="padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--border-soft)">' +
        '<span style="color:var(--muted);font-size:13px">共 ' + res.total + ' 篇（全部状态 ' + allCount + '） · 第 ' + res.page + '/' + res.pages + ' 页</span>' +
        '<span style="margin-left:auto;display:flex;gap:6px">' +
          '<button class="btn sm" data-page="' + (res.page - 1) + '"' + (res.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
          '<button class="btn sm" data-page="' + (res.page + 1) + '"' + (res.page >= res.pages ? ' disabled' : '') + '>下一页</button>' +
        '</span></div>';
    }

    html += '</div>';

    return {
      html: html,
      nav: 'posts',
      title: '文章管理',
      after: function () {
        var fq = document.getElementById('fq');
        var timer = null;
        fq.addEventListener('input', function () {
          clearTimeout(timer);
          timer = setTimeout(function () {
            listState.q = fq.value.trim();
            listState.page = 1;
            render();
          }, 300);
        });

        document.getElementById('fstatus').addEventListener('change', function () {
          listState.status = this.value;
          listState.page = 1;
          render();
        });

        document.getElementById('fcat').addEventListener('change', function () {
          listState.category = this.value;
          listState.page = 1;
          render();
        });

        document.getElementById('freset').addEventListener('click', function () {
          listState = { q: '', status: 'all', category: '', page: 1, pageSize: 10 };
          render();
        });

        view.querySelectorAll('[data-page]').forEach(function (b) {
          b.addEventListener('click', function () {
            listState.page = parseInt(b.getAttribute('data-page'), 10) || 1;
            render();
          });
        });

        view.querySelectorAll('tr[data-id]').forEach(function (tr) {
          var id = tr.getAttribute('data-id');
          tr.addEventListener('click', function (e) {
            var act = e.target.getAttribute && e.target.getAttribute('data-act');
            if (act === 'del') return onDeletePost(id);
            if (act === 'toggle') return onToggleStatus(id);
          });
        });
      }
    };
  }

  function opt(value, label, current) {
    return '<option value="' + esc(value) + '"' + (String(current) === String(value) ? ' selected' : '') + '>' +
      esc(label) + '</option>';
  }

  function onDeletePost(id) {
    var p = Blog.getPost(id);
    if (!p) return;
    confirmAction('删除文章', '「' + p.title + '」将被永久删除，此操作不可撤销。', function () {
      Blog.deletePost(id);
      toast('已删除', 'ok');
      render();
    }, true);
  }

  function onToggleStatus(id) {
    var p = Blog.getPost(id);
    if (!p) return;
    var next = p.status === 'draft' ? 'published' : 'draft';
    Blog.savePost({
      id: p.id,
      title: p.title,
      slug: p.slug,
      category: p.category,
      tags: p.tags,
      status: next,
      cover: p.cover,
      summary: p.summary,
      content: p.content
    });
    toast(next === 'published' ? '已发布' : '已转为草稿', 'ok');
    render();
  }

  /* ============================================================
     视图：编辑器
     ============================================================ */

  function readDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeDraft(data) {
    try {
      if (data) localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      else localStorage.removeItem(DRAFT_KEY);
    } catch (e) { /* ignore */ }
  }

  function viewEditor(id) {
    editingId = id;
    var post = id ? Blog.getPost(id) : null;
    if (id && !post) {
      return { html: '<div class="notice err">文章不存在或已被删除。</div><a class="btn" href="#/posts">← 返回列表</a>', nav: 'posts', title: '文章不存在' };
    }

    var db = Blog.db();
    var restored = false;
    var data = post ? {
      title: post.title,
      slug: post.slug,
      category: post.category,
      tags: post.tags.join(', '),
      status: post.status,
      cover: post.cover,
      summary: post.summary,
      content: post.content
    } : { title: '', slug: '', category: '', tags: '', status: 'published', cover: '', summary: '', content: '' };

    // 新建时尝试恢复本地草稿
    if (!post) {
      var d = readDraft();
      if (d && (d.content || d.title) && d.id === null) {
        data = d;
        restored = true;
      }
    }

    var catOptions = db.categories.map(function (c) {
      return '<option value="' + esc(c) + '"></option>';
    }).join('');

    var html = '';

    if (restored) {
      html += '<div class="notice" style="display:flex;align-items:center;gap:12px">' +
        '<span>已恢复上次未发布的草稿。</span>' +
        '<button class="btn sm" style="margin-left:auto" id="discardDraft">丢弃草稿</button></div>';
    }

    html += '<div class="card">';

    html += '<div class="editor-head">' +
      '<input type="text" class="title-input" id="fTitle" placeholder="请输入文章标题…" value="' + esc(data.title) + '">' +
      '<select id="fStatus" style="max-width:130px">' +
        opt('published', '已发布', data.status) +
        opt('draft', '草稿', data.status) +
      '</select>' +
      '</div>';

    html += '<div class="row">' +
      '<div class="field"><label for="fCategory">分类</label>' +
        '<input type="text" id="fCategory" list="catList" placeholder="如：技术" value="' + esc(data.category) + '">' +
        '<datalist id="catList">' + catOptions + '</datalist></div>' +
      '<div class="field"><label for="fTags">标签</label>' +
        '<input type="text" id="fTags" placeholder="用逗号分隔，如：前端, JavaScript" value="' + esc(data.tags) + '">' +
        '<div class="tip" id="tagSuggest"></div></div>' +
      '<div class="field"><label for="fSlug">固定链接（slug）</label>' +
        '<input type="text" id="fSlug" placeholder="留空自动生成" value="' + esc(data.slug) + '"></div>' +
      '</div>';

    html += '<div class="field"><label for="fCover">封面图 URL</label>' +
      '<input type="url" id="fCover" placeholder="https://… （可留空）" value="' + esc(data.cover) + '"></div>';

    html += '<div class="field"><label for="fSummary">摘要</label>' +
      '<textarea id="fSummary" rows="2" placeholder="留空则自动截取正文前 80 字" style="min-height:60px">' + esc(data.summary) + '</textarea></div>';

    html += '<div class="field" style="margin-bottom:6px"><label>正文（Markdown）</label></div>';

    html += '<div class="editor-split">' +
      '<div class="editor-pane">' +
        '<div class="pane-head">MARKDOWN' +
          '<span class="spacer"></span>' +
          '<button class="btn sm ghost" data-md="h2" title="标题">H</button>' +
          '<button class="btn sm ghost" data-md="bold" title="加粗"><b>B</b></button>' +
          '<button class="btn sm ghost" data-md="italic" title="斜体"><i>I</i></button>' +
          '<button class="btn sm ghost" data-md="code" title="代码">&lt;/&gt;</button>' +
          '<button class="btn sm ghost" data-md="link" title="链接">🔗</button>' +
          '<button class="btn sm ghost" data-md="list" title="列表">≡</button>' +
          '<button class="btn sm ghost" data-md="quote" title="引用">❝</button>' +
        '</div>' +
        '<textarea id="mdInput" spellcheck="false" placeholder="# 标题&#10;&#10;开始写点什么…">' + esc(data.content) + '</textarea>' +
      '</div>' +
      '<div class="editor-pane">' +
        '<div class="pane-head">实时预览<span class="spacer"></span>' +
          '<span id="wordCount" style="color:var(--muted)"></span></div>' +
        '<div class="prose" id="mdPreview"></div>' +
      '</div>' +
    '</div>';

    html += '<div class="btn-row" style="margin-top:20px">' +
      '<button class="btn primary" id="saveBtn">💾 保存文章</button>' +
      '<button class="btn" id="previewBtn">↗ 在新窗口预览</button>' +
      (post ? '<a class="btn" href="index.html#/post/' + esc(post.id) + '" target="_blank" rel="noopener">查看前台</a>' : '') +
      '<span class="spacer"></span>' +
      (post ? '<button class="btn danger" id="delBtn">删除此文</button>' : '') +
      '</div>';

    html += '</div>';

    return {
      html: html,
      nav: post ? 'posts' : 'editor',
      title: post ? '编辑：' + post.title : '写文章',
      after: function () { setupEditor(post); }
    };
  }

  function setupEditor(post) {
    var fTitle = document.getElementById('fTitle');
    var fSlug = document.getElementById('fSlug');
    var fCategory = document.getElementById('fCategory');
    var fTags = document.getElementById('fTags');
    var fStatus = document.getElementById('fStatus');
    var fCover = document.getElementById('fCover');
    var fSummary = document.getElementById('fSummary');
    var mdInput = document.getElementById('mdInput');
    var mdPreview = document.getElementById('mdPreview');
    var wordCount = document.getElementById('wordCount');

    // 标签快捷建议
    var suggest = document.getElementById('tagSuggest');
    var knownTags = Blog.db().tags.slice(0, 10);
    if (knownTags.length) {
      suggest.innerHTML = '常用：' + knownTags.map(function (t) {
        return '<a href="#" data-tag="' + esc(t) + '" style="margin-right:8px">#' + esc(t) + '</a>';
      }).join('');
      suggest.addEventListener('click', function (e) {
        var a = e.target.closest('a[data-tag]');
        if (!a) return;
        e.preventDefault();
        var t = a.getAttribute('data-tag');
        var cur = fTags.value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (cur.indexOf(t) === -1) {
          cur.push(t);
          fTags.value = cur.join(', ');
          onInput();
        }
      });
    } else {
      suggest.textContent = '';
    }

    // 实时预览
    var previewTimer = null;
    function renderPreview() {
      mdPreview.innerHTML = Markdown.render(mdInput.value);
      var n = mdInput.value.replace(/\s/g, '').length;
      wordCount.textContent = n + ' 字 · 约 ' + Math.max(1, Math.round(n / 400)) + ' 分钟读完';
    }

    function onInput() {
      dirty = true;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 140);

      if (!post) {
        clearTimeout(onInput._t);
        onInput._t = setTimeout(function () {
          writeDraft({
            id: null,
            title: fTitle.value,
            slug: fSlug.value,
            category: fCategory.value,
            tags: fTags.value,
            status: fStatus.value,
            cover: fCover.value,
            summary: fSummary.value,
            content: mdInput.value
          });
        }, 600);
      }
    }

    [fTitle, fSlug, fCategory, fTags, fStatus, fCover, fSummary, mdInput].forEach(function (el) {
      el.addEventListener('input', onInput);
      el.addEventListener('change', onInput);
    });

    renderPreview();

    // 标题为空时自动生成 slug 建议
    fTitle.addEventListener('blur', function () {
      if (!fSlug.value.trim() && fTitle.value.trim()) {
        fSlug.value = fTitle.value.trim().toLowerCase()
          .replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      }
    });

    // Markdown 工具栏
    view.querySelectorAll('[data-md]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var kind = btn.getAttribute('data-md');
        insertMarkdown(mdInput, kind);
        onInput();
        renderPreview();
      });
    });

    // 保存
    function save() {
      if (!fTitle.value.trim()) {
        toast('请先填写标题', 'err');
        fTitle.focus();
        return;
      }
      var saved = Blog.savePost({
        id: post ? post.id : null,
        title: fTitle.value,
        slug: fSlug.value,
        category: fCategory.value,
        tags: fTags.value,
        status: fStatus.value,
        cover: fCover.value,
        summary: fSummary.value,
        content: mdInput.value
      });

      if (!post) writeDraft(null);
      dirty = false;

      if (!post) {
        location.hash = '#/editor/' + saved.id;
      } else {
        post = saved;
        render();
      }
      toast('已保存' + (saved.status === 'published' ? '并发布' : '（草稿）'), 'ok');
    }

    document.getElementById('saveBtn').addEventListener('click', save);

    var previewBtn = document.getElementById('previewBtn');
    if (previewBtn) {
      previewBtn.addEventListener('click', function () {
        var w = window.open('', '_blank');
        if (!w) return toast('浏览器拦截了新窗口', 'err');
        w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
          '<title>' + esc(fTitle.value || '预览') + '</title>' +
          '<link rel="stylesheet" href="css/style.css"></head><body>' +
          '<main class="wrap" style="padding:40px 20px"><article class="article">' +
          '<h1 class="article-title">' + esc(fTitle.value || '（无标题）') + '</h1>' +
          '<div class="prose">' + Markdown.render(mdInput.value) + '</div>' +
          '</article></main></body></html>');
        w.document.close();
      });
    }

    var delBtn = document.getElementById('delBtn');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        confirmAction('删除文章', '「' + fTitle.value + '」将被永久删除，此操作不可撤销。', function () {
          Blog.deletePost(post.id);
          dirty = false;
          toast('已删除', 'ok');
          location.hash = '#/posts';
          render();
        }, true);
      });
    }

    var discard = document.getElementById('discardDraft');
    if (discard) {
      discard.addEventListener('click', function () {
        writeDraft(null);
        location.hash = '#/editor/new';
        render();
        toast('草稿已丢弃');
      });
    }
  }

  function insertMarkdown(ta, kind) {
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var sel = ta.value.slice(start, end);
    var before = ta.value.slice(0, start);
    var after = ta.value.slice(end);

    function lineStart() {
      var i = before.lastIndexOf('\n');
      return before.slice(0, i + 1);
    }

    function surround(pre, post, ph) {
      var text = sel || ph;
      ta.value = before + pre + text + post + after;
      ta.selectionStart = start + pre.length;
      ta.selectionEnd = start + pre.length + text.length;
    }

    function prefixLines(prefix) {
      var block = sel || '文本';
      var ls = lineStart();
      var head = before.slice(0, ls.length);
      var body = (ls + block).split('\n').map(function (l, i) {
        return prefix.replace('%d', i + 1) + l;
      }).join('\n');
      ta.value = head + body + after;
      ta.selectionStart = ls.length;
      ta.selectionEnd = ls.length + body.length;
    }

    switch (kind) {
      case 'bold': surround('**', '**', '粗体文字'); break;
      case 'italic': surround('*', '*', '斜体文字'); break;
      case 'code':
        if (sel.indexOf('\n') !== -1 || !sel) surround('```\n', '\n```', 'code');
        else surround('`', '`', 'code');
        break;
      case 'link': surround('[', '](https://)', '链接文字'); break;
      case 'h2': prefixLines('## '); break;
      case 'list': prefixLines('- '); break;
      case 'quote': prefixLines('> '); break;
      default: break;
    }
    ta.focus();
  }

  /* ============================================================
     视图：分类与标签
     ============================================================ */

  function viewTaxonomy() {
    var cats = Blog.categories();
    var tags = Blog.tags();

    var html = '';

    html += '<div class="card"><h2>分类</h2><p class="desc">用于给文章分组，一个文章只属于一个分类。删除分类不会删除文章，文章会变成「未分类」。</p>' +
      '<div class="inline-add"><input type="text" id="newCat" placeholder="输入新分类名称"><button class="btn primary" id="addCat">添加分类</button></div>' +
      '<div class="chip-list">' +
      (cats.length ? cats.map(function (c) {
        return '<span class="chip-item" data-cat="' + esc(c.name) + '">' + esc(c.name) +
          '<span class="n">' + c.count + ' 篇</span>' +
          '<button class="edit" data-act="rename-cat" title="重命名">✎</button>' +
          '<button data-act="del-cat" title="删除">✕</button></span>';
      }).join('') : '<span style="color:var(--muted)">还没有分类。</span>') +
      '</div></div>';

    html += '<div class="card"><h2>标签</h2><p class="desc">一篇文章可以有多个标签。删除标签会从所有文章中移除它。</p>' +
      '<div class="inline-add"><input type="text" id="newTag" placeholder="输入新标签名称"><button class="btn primary" id="addTag">添加标签</button></div>' +
      '<div class="chip-list">' +
      (tags.length ? tags.map(function (t) {
        return '<span class="chip-item" data-tag="' + esc(t.name) + '">#' + esc(t.name) +
          '<span class="n">' + t.count + ' 篇</span>' +
          '<button data-act="del-tag" title="删除">✕</button></span>';
      }).join('') : '<span style="color:var(--muted)">还没有标签。</span>') +
      '</div></div>';

    return {
      html: html,
      nav: 'taxonomy',
      title: '分类与标签',
      after: function () {
        var newCat = document.getElementById('newCat');
        var newTag = document.getElementById('newTag');

        function addCat() {
          var v = newCat.value.trim();
          if (!v) return;
          Blog.addCategory(v);
          newCat.value = '';
          toast('已添加分类「' + v + '」', 'ok');
          render();
        }
        function addTag() {
          var v = newTag.value.trim().replace(/^#/, '');
          if (!v) return;
          Blog.addTag(v);
          newTag.value = '';
          toast('已添加标签「' + v + '」', 'ok');
          render();
        }

        document.getElementById('addCat').addEventListener('click', addCat);
        document.getElementById('addTag').addEventListener('click', addTag);
        newCat.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addCat(); } });
        newTag.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });

        view.querySelectorAll('.chip-item').forEach(function (chip) {
          var cat = chip.getAttribute('data-cat');
          var tag = chip.getAttribute('data-tag');
          chip.querySelectorAll('button').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var act = btn.getAttribute('data-act');
              if (act === 'rename-cat') {
                openModal({
                  title: '重命名分类',
                  desc: '所有属于「' + cat + '」的文章会同步更新。',
                  input: true,
                  value: cat,
                  onConfirm: function (v) {
                    Blog.renameCategory(cat, v.trim());
                    toast('已重命名', 'ok');
                    render();
                  }
                });
              } else if (act === 'del-cat') {
                confirmAction('删除分类', '「' + cat + '」将从文章上移除（文章本身保留）。', function () {
                  Blog.deleteCategory(cat);
                  toast('已删除', 'ok');
                  render();
                }, true);
              } else if (act === 'del-tag') {
                confirmAction('删除标签', '「' + tag + '」会从所有文章中移除。', function () {
                  Blog.deleteTag(tag);
                  toast('已删除', 'ok');
                  render();
                }, true);
              }
            });
          });
        });
      }
    };
  }

  /* ============================================================
     视图：站点设置
     ============================================================ */

  function viewSettings() {
    var s = Blog.getSettings();

    var html = '<div class="card"><h2>站点信息</h2><p class="desc">这些内容会显示在博客前台。</p>' +
      '<div class="row">' +
        field('siteTitle', '站点名称', s.title, '显示在导航栏与浏览器标题') +
        field('siteSubtitle', '副标题', s.subtitle, '显示在「关于」页') +
      '</div>' +
      field('siteAuthor', '作者署名', s.author, '显示在文章头部') +
      '<div class="field"><label for="siteDesc">站点描述</label>' +
        '<textarea id="siteDesc" rows="3">' + esc(s.description) + '</textarea>' +
        '<div class="tip">显示在首页大标题下方。</div></div>' +
      '<div class="row">' +
        field('siteFooter', '页脚版权', s.footer) +
        field('siteIcp', '备案号（可选）', s.icp) +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label for="sitePageSize">每页文章数</label>' +
          '<input type="number" id="sitePageSize" min="1" max="50" value="' + s.pageSize + '">' +
          '<div class="tip">1 – 50，默认 6。</div></div>' +
        '<div class="field"><label for="siteTheme">默认主题</label>' +
          '<select id="siteTheme">' + opt('light', '浅色', s.theme) + opt('dark', '深色', s.theme) + '</select>' +
          '<div class="tip">访客本地切换过主题时，以访客的选择为准。</div></div>' +
      '</div>' +
      '<div class="btn-row"><button class="btn primary" id="saveSettings">保存设置</button>' +
      '<a class="btn" href="index.html" target="_blank" rel="noopener">查看效果</a></div>' +
      '</div>';

    html += '<div class="card"><h2>危险操作</h2><p class="desc">把全部内容恢复成初始的演示数据。当前的文章、分类、标签和设置都会被覆盖。</p>' +
      '<button class="btn danger" id="resetAll">恢复演示数据</button></div>';

    return {
      html: html,
      nav: 'settings',
      narrow: true,
      title: '站点设置',
      after: function () {
        document.getElementById('saveSettings').addEventListener('click', function () {
          Blog.updateSettings({
            title: document.getElementById('siteTitle').value.trim() || '墨迹',
            subtitle: document.getElementById('siteSubtitle').value.trim(),
            author: document.getElementById('siteAuthor').value.trim() || '站长',
            description: document.getElementById('siteDesc').value.trim(),
            footer: document.getElementById('siteFooter').value.trim(),
            icp: document.getElementById('siteIcp').value.trim(),
            pageSize: parseInt(document.getElementById('sitePageSize').value, 10) || 6,
            theme: document.getElementById('siteTheme').value
          });
          toast('设置已保存', 'ok');
          render();
        });

        document.getElementById('resetAll').addEventListener('click', function () {
          confirmAction('恢复演示数据', '当前所有文章、分类、标签和设置都会被清空并替换为演示数据，无法撤销。建议先导出备份。', function () {
            Blog.reset();
            dirty = false;
            writeDraft(null);
            toast('已恢复演示数据', 'ok');
            location.hash = '#/dashboard';
            render();
          }, true);
        });
      }
    };
  }

  function field(id, label, value, tip) {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input type="text" id="' + id + '" value="' + esc(value) + '">' +
      (tip ? '<div class="tip">' + esc(tip) + '</div>' : '') + '</div>';
  }

  /* ============================================================
     视图：数据备份
     ============================================================ */

  function viewBackup() {
    var st = Blog.stats();

    var html = '';

    html += '<div class="card"><h2>导出备份</h2>' +
      '<p class="desc">把全部数据（' + st.total + ' 篇文章、' + st.categories + ' 个分类、' +
      st.tags + ' 个标签及站点设置）导出成一个 JSON 文件。换设备、换浏览器时用它恢复。</p>' +
      '<div class="btn-row">' +
        '<button class="btn primary" id="doExport">⬇ 导出 JSON 文件</button>' +
        '<button class="btn" id="doCopy">复制到剪贴板</button>' +
      '</div>' +
      '<div class="tip" style="margin-top:10px;color:var(--muted);font-size:12.5px">导出内容包含站点设置中的密码散列，请勿随意公开。</div>' +
      '</div>';

    html += '<div class="card"><h2>导入数据</h2>' +
      '<p class="desc">选择一个之前导出的 JSON 文件，或直接粘贴内容。<strong>导入会覆盖当前全部数据。</strong></p>' +
      '<div class="field"><label for="importFile">从文件导入</label>' +
        '<input type="file" id="importFile" accept=".json,application/json">' +
        '<div class="tip">选择文件后会先校验格式，确认后才覆盖。</div></div>' +
      '<div class="field"><label for="importText">或粘贴 JSON</label>' +
        '<textarea id="importText" rows="5" placeholder=\'{"version":1,"posts":[…],…}\'></textarea></div>' +
      '<div class="btn-row"><button class="btn" id="doImport">导入并覆盖</button></div>' +
      '</div>';

    html += '<div class="card"><h2>当前数据预览</h2>' +
      '<p class="desc">下面是即将被导出的完整内容，只读。</p>' +
      '<div class="mono" id="jsonView"></div>' +
      '</div>';

    return {
      html: html,
      nav: 'backup',
      narrow: true,
      title: '数据备份',
      after: function () {
        var jsonView = document.getElementById('jsonView');
        jsonView.textContent = Blog.exportJSON();

        function stamp() {
          var d = new Date();
          function p(n) { return n < 10 ? '0' + n : '' + n; }
          return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
        }

        document.getElementById('doExport').addEventListener('click', function () {
          download('blog-backup-' + stamp() + '.json', Blog.exportJSON());
          toast('已导出备份文件', 'ok');
        });

        document.getElementById('doCopy').addEventListener('click', function () {
          copyText(Blog.exportJSON())
            .then(function () { toast('已复制到剪贴板', 'ok'); })
            .catch(function () { toast('复制失败，请手动选中下方内容', 'err'); });
        });

        function doImport(text) {
          confirmAction('导入并覆盖', '当前全部数据将被导入的内容替换，无法撤销。建议先导出当前备份。', function () {
            try {
              Blog.importJSON(text);
              dirty = false;
              writeDraft(null);
              toast('导入成功', 'ok');
              location.hash = '#/dashboard';
              render();
            } catch (err) {
              toast(err.message, 'err');
            }
          }, true);
        }

        document.getElementById('doImport').addEventListener('click', function () {
          var text = document.getElementById('importText').value.trim();
          if (!text) return toast('请先粘贴 JSON 内容', 'err');
          doImport(text);
        });

        document.getElementById('importFile').addEventListener('change', function () {
          var file = this.files && this.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function () {
            try {
              JSON.parse(String(reader.result));
            } catch (e) {
              return toast('文件不是合法的 JSON', 'err');
            }
            doImport(String(reader.result));
          };
          reader.onerror = function () { toast('读取文件失败', 'err'); };
          reader.readAsText(file);
        });
      }
    };
  }

  /* ============================================================
     视图：修改密码
     ============================================================ */

  function viewAccount() {
    var html = '<div class="card"><h2>修改管理密码</h2>' +
      '<p class="desc">密码只作用于本机浏览器，用于防止他人随手打开你的后台。' +
      '它保存在本地的散列值中，<strong>忘记密码后只能清空浏览器数据重置</strong>。</p>' +
      '<div class="field"><label for="oldPwd">当前密码</label>' +
        '<input type="password" id="oldPwd" autocomplete="current-password"></div>' +
      '<div class="field"><label for="newPwd">新密码</label>' +
        '<input type="password" id="newPwd" autocomplete="new-password">' +
        '<div class="tip">至少 4 位。</div></div>' +
      '<div class="field"><label for="newPwd2">确认新密码</label>' +
        '<input type="password" id="newPwd2" autocomplete="new-password"></div>' +
      '<div class="btn-row"><button class="btn primary" id="doChangePwd">保存新密码</button></div>' +
      '</div>';

    html += '<div class="card"><h2>关于这个后台</h2>' +
      '<p class="desc">纯前端实现，没有服务端。数据全部保存在浏览器 localStorage 中。</p>' +
      '<div class="mono">localStorage key: dshm_blog_db_v1\n' +
      '存储可用: ' + (Blog.isStorageOK() ? '是' : '否（隐私模式？）') + '\n' +
      '默认密码: ' + Blog.DEFAULT_PASSWORD + '</div>' +
      '</div>';

    return {
      html: html,
      nav: 'account',
      narrow: true,
      title: '修改密码',
      after: function () {
        document.getElementById('doChangePwd').addEventListener('click', function () {
          var o = document.getElementById('oldPwd').value;
          var n = document.getElementById('newPwd').value;
          var n2 = document.getElementById('newPwd2').value;

          if (n !== n2) return toast('两次输入的新密码不一致', 'err');
          if (n.length < 4) return toast('新密码至少 4 位', 'err');

          try {
            if (Blog.changePassword(o, n)) {
              toast('密码已更新', 'ok');
              render();
            } else {
              toast('当前密码不正确', 'err');
            }
          } catch (err) {
            toast(err.message, 'err');
          }
        });
      }
    };
  }

  /* ============================================================
     启动
     ============================================================ */

  document.getElementById('sideToggle').addEventListener('click', function () {
    sidebar.classList.toggle('open');
  });

  // 全局只注册一次：编辑器内 Ctrl/Cmd + S 保存
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== 's') return;
    var btn = document.getElementById('saveBtn');
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  });

  if (isAuthed()) {
    enterApp();
  } else {
    appView.hidden = true;
    loginView.hidden = false;
    document.getElementById('pwdInput').focus();
  }

  if (!Blog.isStorageOK()) {
    document.getElementById('loginSub').innerHTML =
      '<span style="color:var(--warn)">注意：浏览器禁用了本地存储，修改不会被保存。</span>';
  }
})();
