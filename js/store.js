/*!
 * store.js —— 纯前端博客数据层
 * 依赖：无（localStorage + 内存兜底）
 * 对外暴露：window.Blog
 */
(function (global) {
  'use strict';

  var KEY = 'dshm_blog_db_v1';
  var SALT = 'dshm-blog::';
  var DEFAULT_PASSWORD = 'admin123';

  /* ---------- 工具 ---------- */

  function uid(prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 6);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  // 简易字符串散列（djb2），仅用于避免本地明文存密码，不是加密算法
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return 'h' + h.toString(16);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function toArray(v) {
    if (Array.isArray(v)) {
      return v.filter(function (x) { return x !== null && x !== undefined && String(x).trim() !== ''; })
        .map(function (x) { return String(x).trim(); });
    }
    if (typeof v === 'string') {
      return v.split(/[,，\s]+/).filter(function (x) { return x !== ''; });
    }
    return [];
  }

  function uniq(arr) {
    var seen = Object.create(null);
    var out = [];
    arr.forEach(function (x) {
      if (!seen[x]) { seen[x] = 1; out.push(x); }
    });
    return out;
  }

  function trimText(html, len) {
    var t = String(html || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#>*`_\[\]()!\-|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > len ? t.slice(0, len) + '…' : t;
  }

  /* ---------- 种子数据 ---------- */

  function seed() {
    var t = nowISO();
    return {
      version: 1,
      settings: {
        title: '墨迹',
        subtitle: '记录思考、代码与生活',
        author: '站长',
        description: '一个用纯前端写成的博客系统：没有服务端，没有数据库，数据就存在你的浏览器里。',
        footer: '© ' + new Date().getFullYear() + ' 墨迹 · 由纯前端驱动',
        icp: '',
        pageSize: 6,
        theme: 'light',
        passwordHash: hash(SALT + DEFAULT_PASSWORD)
      },
      categories: ['技术', '随笔', '阅读'],
      tags: ['JavaScript', '前端', 'Markdown', '随笔', '效率'],
      posts: [
        {
          id: uid('post'),
          title: '用纯前端搭一个博客：整体思路',
          slug: 'pure-frontend-blog',
          category: '技术',
          tags: ['前端', 'JavaScript'],
          status: 'published',
          cover: '',
          summary: '没有服务器、没有数据库，只靠一个 HTML 文件加浏览器存储，能不能跑起一个像样的博客？可以。',
          content: [
            '# 为什么是纯前端',
            '',
            '传统博客至少需要三样东西：**服务器**、**数据库**、**渲染层**。',
            '而纯前端方案把这三点全部搬进了浏览器：',
            '',
            '1. 页面就是静态文件，扔到任何地方都能打开；',
            '2. 数据存在 `localStorage` 里，离线也能读写；',
            '3. 渲染由 JavaScript 完成，不需要任何构建工具。',
            '',
            '> 代价也很明确：内容只属于当前浏览器，换设备就要靠导入导出。',
            '',
            '## 分层设计',
            '',
            '整个系统只有三层，边界很清楚：',
            '',
            '| 层 | 文件 | 职责 |',
            '| --- | --- | --- |',
            '| 数据层 | `store.js` | 增删改查、统计、导入导出 |',
            '| 渲染层 | `markdown.js` | 把 Markdown 变成安全的 HTML |',
            '| 视图层 | `app.js` / `admin.js` | 路由、界面、交互 |',
            '',
            '## 一行代码都不用装',
            '',
            '```js',
            '// 发布一篇文章只有一步',
            'Blog.savePost({',
            '  title: "你好，世界",',
            '  content: "# 标题\\n\\n正文",',
            '  status: "published"',
            '});',
            '```',
            '',
            '## 它适合谁',
            '',
            '- 想写点东西、又不想折腾服务器的人',
            '- 需要一个**演示用**后台的技术同学',
            '- 想读一份能一口气看完的完整前端源码的人',
            '',
            '---',
            '',
            '接下来我会把几个具体的坑单独写一篇。'
          ].join('\n'),
          createdAt: t,
          updatedAt: t,
          views: 128
        },
        {
          id: uid('post'),
          title: 'localStorage 当数据库的一些坑',
          slug: 'localstorage-pitfalls',
          category: '技术',
          tags: ['JavaScript', '前端'],
          status: 'published',
          cover: '',
          summary: '容量、同步、序列化、隐私模式——把浏览器存储当数据库用之前，最好先知道这几件事。',
          content: [
            '## 1. 它是同步 API',
            '',
            '`localStorage` 是**同步**阻塞的，写入大数据时会卡主线程。',
            '所以千万不要每次输入都存一次，要做**防抖**。',
            '',
            '```js',
            'let timer = null;',
            'function saveLater(data) {',
            '  clearTimeout(timer);',
            '  timer = setTimeout(() => save(data), 400);',
            '}',
            '```',
            '',
            '## 2. 容量大约 5MB',
            '',
            '不同浏览器略有差异，但量级都是 5MB 上下：',
            '',
            '- 存文本绰绰有余；',
            '- 把图片转成 base64 塞进去，几篇就爆了。',
            '',
            '> 正确做法：图片走外链或对象存储，数据库里只留 URL。',
            '',
            '## 3. 隐私模式会直接抛异常',
            '',
            'Safari 无痕模式下 `setItem` 会抛 `QuotaExceededError`。',
            '所以任何一次读写都必须包在 `try/catch` 里 —— 本项目的做法是**内存兜底**：',
            '',
            '| 情况 | 表现 | 处理 |',
            '| --- | --- | --- |',
            '| 正常 | 数据持久化 | 直接读写 |',
            '| 隐私模式 | 写入抛错 | 退回内存，提示用户 |',
            '| 手动清空 | 数据丢失 | 用导出功能备份 |',
            '',
            '## 4. 换设备 = 从零开始',
            '',
            '这是纯前端方案绕不开的限制，只能靠**导出 / 导入 JSON** 来兜底。',
            '养成习惯：写完一批内容就导出一次。'
          ].join('\n'),
          createdAt: t,
          updatedAt: t,
          views: 86
        },
        {
          id: uid('post'),
          title: '我的 2026 阅读清单',
          slug: 'reading-list-2026',
          category: '阅读',
          tags: ['随笔', '效率'],
          status: 'published',
          cover: '',
          summary: '今年打算读的书，以及一个已经验证有效的笨办法：每月只允许自己买一本。',
          content: [
            '## 年度目标',
            '',
            '- [x] 一月：《代码整洁之道》',
            '- [x] 三月：《暗时间》',
            '- [ ] 五月：《设计数据密集型应用》',
            '- [ ] 八月：《人类简史》',
            '- [ ] 十一月：《禅与摩托车维修艺术》',
            '',
            '## 一个笨办法',
            '',
            '**每月只允许买一本。**',
            '',
            '买书太容易了，读书太难了。限制购买速度，反而逼着自己把手里的书读完。',
            '',
            '## 记录方式',
            '',
            '| 书名 | 状态 | 评分 |',
            '| --- | :---: | ---: |',
            '| 代码整洁之道 | 已读完 | 9 |',
            '| 暗时间 | 已读完 | 8 |',
            '| 设计数据密集型应用 | 在读 | — |',
            '',
            '> 读不完也没关系，关键是要留下痕迹。'
          ].join('\n'),
          createdAt: t,
          updatedAt: t,
          views: 42
        },
        {
          id: uid('post'),
          title: '草稿：关于长期主义的碎片想法',
          slug: 'draft-long-termism',
          category: '随笔',
          tags: ['随笔'],
          status: 'draft',
          cover: '',
          summary: '还没写完，先放着。',
          content: [
            '## 待整理',
            '',
            '1. 复利的前提是不要中断',
            '2. 中断的成本远高于慢速前进',
            '3. 所以要做的是降低单次启动成本',
            '',
            '（这篇还是草稿，只有登录后台才看得到。）'
          ].join('\n'),
          createdAt: t,
          updatedAt: t,
          views: 0
        }
      ]
    };
  }

  /* ---------- 持久化 ---------- */

  var memoryDb = null;
  var storageOK = true;

  function storageAvailable() {
    try {
      var k = '__dshm_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function persist(db) {
    memoryDb = db;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      storageOK = false;
    }
    return db;
  }

  function normalize(db) {
    var base = seed();
    var out = db && typeof db === 'object' ? db : {};
    out.version = 1;

    // settings
    var s = out.settings && typeof out.settings === 'object' ? out.settings : {};
    var merged = {};
    Object.keys(base.settings).forEach(function (k) {
      merged[k] = s[k] === undefined || s[k] === null ? base.settings[k] : s[k];
    });
    merged.pageSize = Math.max(1, Math.min(50, parseInt(merged.pageSize, 10) || 6));
    merged.theme = merged.theme === 'dark' ? 'dark' : 'light';
    out.settings = merged;

    // 数组容器
    out.categories = uniq(toArray(out.categories).concat([]));
    out.tags = uniq(toArray(out.tags).concat([]));

    // 文章
    out.posts = (Array.isArray(out.posts) ? out.posts : []).map(function (p) {
      p = p && typeof p === 'object' ? p : {};
      return {
        id: p.id || uid('post'),
        title: String(p.title || '未命名文章'),
        slug: String(p.slug || ''),
        category: String(p.category || '').trim(),
        tags: uniq(toArray(p.tags)),
        status: p.status === 'draft' ? 'draft' : 'published',
        cover: String(p.cover || ''),
        summary: String(p.summary || ''),
        content: String(p.content || ''),
        createdAt: p.createdAt || nowISO(),
        updatedAt: p.updatedAt || p.createdAt || nowISO(),
        views: Math.max(0, parseInt(p.views, 10) || 0)
      };
    });

    // 让分类 / 标签集合覆盖文章里出现过的值
    out.posts.forEach(function (p) {
      if (p.category && out.categories.indexOf(p.category) === -1) out.categories.push(p.category);
      p.tags.forEach(function (tg) {
        if (out.tags.indexOf(tg) === -1) out.tags.push(tg);
      });
    });

    return out;
  }

  function load() {
    if (!memoryDb) {
      var raw = null;
      try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = null; }
      var parsed = null;
      if (raw) {
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      }
      memoryDb = parsed ? normalize(parsed) : persist(seed());
    }
    return memoryDb;
  }

  /* ---------- 站点设置 ---------- */

  function getSettings() {
    return load().settings;
  }

  function updateSettings(patch) {
    var db = load();
    Object.keys(patch || {}).forEach(function (k) {
      db.settings[k] = patch[k];
    });
    db.settings.pageSize = Math.max(1, Math.min(50, parseInt(db.settings.pageSize, 10) || 6));
    persist(db);
    return db.settings;
  }

  /* ---------- 文章 ---------- */

  function sortPosts(list, order) {
    var dir = order === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var ta = new Date(a.createdAt).getTime() || 0;
      var tb = new Date(b.createdAt).getTime() || 0;
      if (ta === tb) return String(a.title).localeCompare(String(b.title));
      return ta < tb ? -dir : dir;
    });
  }

  /**
   * @param {object} opts {status, category, tag, q, order, page, pageSize, paged}
   */
  function listPosts(opts) {
    opts = opts || {};
    var db = load();
    var list = db.posts.slice();

    var status = opts.status === undefined ? 'published' : opts.status;
    if (status && status !== 'all') {
      list = list.filter(function (p) { return p.status === status; });
    }
    if (opts.category) {
      list = list.filter(function (p) { return p.category === opts.category; });
    }
    if (opts.tag) {
      list = list.filter(function (p) { return p.tags.indexOf(opts.tag) !== -1; });
    }
    if (opts.q) {
      var q = String(opts.q).toLowerCase();
      list = list.filter(function (p) {
        return (p.title + ' ' + p.summary + ' ' + p.content + ' ' + p.tags.join(' '))
          .toLowerCase().indexOf(q) !== -1;
      });
    }

    list = sortPosts(list, opts.order);

    var total = list.length;
    var pageSize = Math.max(1, parseInt(opts.pageSize, 10) || db.settings.pageSize);
    var pages = Math.max(1, Math.ceil(total / pageSize));
    var page = Math.max(1, Math.min(pages, parseInt(opts.page, 10) || 1));

    var items = list;
    if (opts.paged !== false) {
      items = list.slice((page - 1) * pageSize, page * pageSize);
    }

    return {
      items: items,
      total: total,
      page: page,
      pages: pages,
      pageSize: pageSize
    };
  }

  function allPosts(status) {
    return listPosts({ status: status || 'all', paged: false }).items;
  }

  function getPost(id) {
    var db = load();
    for (var i = 0; i < db.posts.length; i++) {
      if (db.posts[i].id === id) return db.posts[i];
    }
    return null;
  }

  function savePost(input) {
    var db = load();
    var now = nowISO();
    var post = null;

    if (input && input.id) post = getPost(input.id);

    if (!post) {
      post = {
        id: uid('post'),
        createdAt: now,
        views: 0
      };
      db.posts.unshift(post);
    }

    post.title = String(input.title || '').trim() || '未命名文章';
    post.slug = String(input.slug || '').trim() ||
      post.title.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) ||
      post.id;
    post.category = String(input.category || '').trim();
    post.tags = uniq(toArray(input.tags));
    post.status = input.status === 'draft' ? 'draft' : 'published';
    post.cover = String(input.cover || '').trim();
    post.content = String(input.content || '');
    post.summary = String(input.summary || '').trim() || trimText(post.content, 80);
    post.updatedAt = now;

    // 自动登记分类 / 标签
    if (post.category && db.categories.indexOf(post.category) === -1) db.categories.push(post.category);
    post.tags.forEach(function (t) {
      if (db.tags.indexOf(t) === -1) db.tags.push(t);
    });

    persist(db);
    return post;
  }

  function deletePost(id) {
    var db = load();
    var before = db.posts.length;
    db.posts = db.posts.filter(function (p) { return p.id !== id; });
    persist(db);
    return db.posts.length < before;
  }

  function viewPost(id) {
    var db = load();
    for (var i = 0; i < db.posts.length; i++) {
      if (db.posts[i].id === id) {
        db.posts[i].views = (parseInt(db.posts[i].views, 10) || 0) + 1;
        persist(db);
        return db.posts[i];
      }
    }
    return null;
  }

  /** 相邻文章（按发布时间） */
  function neighbors(id) {
    var list = listPosts({ status: 'published', paged: false }).items;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return { prev: null, next: null };
    return {
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx < list.length - 1 ? list[idx + 1] : null
    };
  }

  /* ---------- 分类 / 标签 ---------- */

  function countBy(field) {
    var db = load();
    var map = Object.create(null);
    db.posts.forEach(function (p) {
      if (p.status !== 'published') return;
      var values = field === 'tags' ? p.tags : [p.category];
      values.forEach(function (v) {
        if (!v) return;
        map[v] = (map[v] || 0) + 1;
      });
    });
    return map;
  }

  function categories() {
    var db = load();
    var map = countBy('category');
    return db.categories
      .filter(function (c) { return c; })
      .map(function (c) { return { name: c, count: map[c] || 0 }; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  }

  function tags() {
    var db = load();
    var map = countBy('tags');
    return db.tags
      .filter(function (t) { return t; })
      .map(function (t) { return { name: t, count: map[t] || 0 }; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  }

  function addCategory(name) {
    name = String(name || '').trim();
    if (!name) return false;
    var db = load();
    if (db.categories.indexOf(name) === -1) {
      db.categories.push(name);
      persist(db);
    }
    return true;
  }

  function renameCategory(from, to) {
    to = String(to || '').trim();
    if (!to) return false;
    var db = load();
    var i = db.categories.indexOf(from);
    if (i !== -1) db.categories[i] = to;
    if (db.categories.indexOf(to) === -1) db.categories.push(to);
    db.posts.forEach(function (p) { if (p.category === from) p.category = to; });
    persist(db);
    return true;
  }

  function deleteCategory(name) {
    var db = load();
    db.categories = db.categories.filter(function (c) { return c !== name; });
    db.posts.forEach(function (p) { if (p.category === name) p.category = ''; });
    persist(db);
    return true;
  }

  function addTag(name) {
    name = String(name || '').trim();
    if (!name) return false;
    var db = load();
    if (db.tags.indexOf(name) === -1) {
      db.tags.push(name);
      persist(db);
    }
    return true;
  }

  function deleteTag(name) {
    var db = load();
    db.tags = db.tags.filter(function (t) { return t !== name; });
    db.posts.forEach(function (p) {
      p.tags = p.tags.filter(function (t) { return t !== name; });
    });
    persist(db);
    return true;
  }

  /* ---------- 统计 ---------- */

  function stats() {
    var db = load();
    var published = db.posts.filter(function (p) { return p.status === 'published'; });
    var drafts = db.posts.filter(function (p) { return p.status === 'draft'; });
    var views = db.posts.reduce(function (sum, p) { return sum + (parseInt(p.views, 10) || 0); }, 0);
    var words = db.posts.reduce(function (sum, p) { return sum + p.content.replace(/\s/g, '').length; }, 0);
    var recent = sortPosts(db.posts, 'desc').slice(0, 5);
    return {
      total: db.posts.length,
      published: published.length,
      drafts: drafts.length,
      categories: db.categories.length,
      tags: db.tags.length,
      views: views,
      words: words,
      recent: recent
    };
  }

  /* ---------- 导入 / 导出 ---------- */

  function exportJSON() {
    return JSON.stringify(load(), null, 2);
  }

  function importJSON(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.posts)) {
      throw new Error('数据结构不正确：缺少 posts 数组');
    }
    var db = normalize(parsed);
    persist(db);
    return db;
  }

  function reset() {
    var db = persist(seed());
    return db;
  }

  /* ---------- 登录 ---------- */

  function login(password) {
    var s = load().settings;
    return hash(SALT + String(password || '')) === s.passwordHash;
  }

  function changePassword(oldPwd, newPwd) {
    if (!login(oldPwd)) return false;
    if (String(newPwd).length < 4) throw new Error('新密码至少 4 位');
    var db = load();
    db.settings.passwordHash = hash(SALT + String(newPwd));
    persist(db);
    return true;
  }

  /* ---------- 导出 API ---------- */

  global.Blog = {
    storageAvailable: storageAvailable,
    isStorageOK: function () { return storageOK; },
    uid: uid,
    hash: hash,
    db: load,
    reset: reset,

    getSettings: getSettings,
    updateSettings: updateSettings,

    listPosts: listPosts,
    allPosts: allPosts,
    getPost: getPost,
    savePost: savePost,
    deletePost: deletePost,
    viewPost: viewPost,
    neighbors: neighbors,

    categories: categories,
    tags: tags,
    addCategory: addCategory,
    renameCategory: renameCategory,
    deleteCategory: deleteCategory,
    addTag: addTag,
    deleteTag: deleteTag,

    stats: stats,
    excerpt: trimText,

    exportJSON: exportJSON,
    importJSON: importJSON,

    login: login,
    changePassword: changePassword,
    DEFAULT_PASSWORD: DEFAULT_PASSWORD
  };

  // 初始化时探测一次存储能力
  storageOK = storageAvailable();
  if (!storageOK) memoryDb = null;
})(window);
