/*!
 * store.js —— 博客数据层
 *
 * 数据存在两个地方：
 *   1. 云端（GitHub 仓库里的一个 JSON 文件，经 /api/db 中转）—— 已发布的文章，
 *      所有设备共享，这是修复「换台电脑就看不到文章」的关键；
 *   2. 本机 localStorage —— 离线缓存 + 草稿。接口不可用时自动降级成纯本地模式，
 *      直接双击 index.html 也能照常使用。
 *
 * 同步策略：
 *   - 读取用同步 API（listPosts / getPost / stats …），它们只读内存，页面渲染不用改成异步；
 *   - 写入方法返回 Promise，先改内存和本地缓存，再把整份文档推给云端；
 *   - 云端只存「已发布」的文章，草稿永远不离开写它的那台浏览器（服务端也会再兜一次底）。
 */
(function (global) {
  'use strict';

  var KEY = 'dshm_blog_db_v1';
  var SEEDED_KEY = 'dshm_blog_seeded';
  var TOKEN_KEY = 'dshm_blog_token';
  var SALT = 'dshm-blog::';
  var DEFAULT_PASSWORD = 'admin123';
  var API_BASE = 'api/';

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
        description: '一个小巧的博客系统：静态页面 + GitHub 仓库当数据库。',
        footer: '© ' + new Date().getFullYear() + ' 墨迹',
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
          summary: '没有服务器、没有数据库，只靠静态文件加一个 JSON 数据文件，能不能跑起一个像样的博客？可以。',
          content: [
            '# 为什么是纯静态',
            '',
            '传统博客至少需要三样东西：**服务器**、**数据库**、**渲染层**。',
            '而这个项目把「数据库」换成了一个放在 GitHub 仓库里的 JSON 文件：',
            '',
            '1. 页面是静态文件，扔到任何地方都能打开；',
            '2. 内容通过 `/api/db` 读写，后台一保存就提交到仓库；',
            '3. 渲染由 JavaScript 完成，不需要任何构建工具。',
            '',
            '> 好处是内容跟着仓库走，换台电脑、换个浏览器都能看到同一批文章。',
            '',
            '## 分层设计',
            '',
            '整个系统只有几层，边界很清楚：',
            '',
            '| 层 | 文件 | 职责 |',
            '| --- | --- | --- |',
            '| 数据层 | `store.js` | 本地缓存 + 云端同步、增删改查、导入导出 |',
            '| 接口层 | `api/db.js` | 读写 GitHub 仓库里的 JSON 文件 |',
            '| 渲染层 | `markdown.js` | 把 Markdown 变成安全的 HTML |',
            '| 视图层 | `app.js` / `admin.js` | 路由、界面、交互 |',
            '',
            '## 发布一篇文章',
            '',
            '```js',
            '// 后台点一下「保存文章」，数据层会把整份文档推给云端',
            'await Blog.savePost({',
            '  title: "你好，世界",',
            '  content: "# 标题\\n\\n正文",',
            '  status: "published"',
            '});',
            '```',
            '',
            '## 它适合谁',
            '',
            '- 想写点东西、又不想折腾服务器和数据库的人',
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
          title: 'localStorage 当缓存，而不是数据库',
          slug: 'localstorage-as-cache',
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
            '| 接口不可用 | 拿不到云端数据 | 用本地缓存渲染，提示用户 |',
            '',
            '## 4. 换设备要靠云端',
            '',
            '浏览器存储天生只属于当前浏览器。解决办法不是「更努力地同步 localStorage」，',
            '而是把**已发布的内容**放到一个所有设备都能读到的地方 —— 本项目用的是 GitHub 仓库。',
            '',
            '草稿则刻意留在本机：没写完的东西没必要推到公网。'
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
            '（这是一篇草稿：只存在于本机浏览器，点击「保存」并设为已发布后才会同步到云端。）'
          ].join('\n'),
          createdAt: t,
          updatedAt: t,
          views: 0
        }
      ]
    };
  }

  /* ---------- 本地持久化 ---------- */

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

  function readLocalRaw() {
    try { return global.localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function markSeeded() {
    try { global.localStorage.setItem(SEEDED_KEY, '1'); } catch (e) { /* ignore */ }
  }

  function clearSeeded() {
    try { global.localStorage.removeItem(SEEDED_KEY); } catch (e) { /* ignore */ }
  }

  /**
   * 本地内容是否只是「从没被动过的演示数据」。
   * 用来区分「这个浏览器里真有用户写的东西」和「刚打开页面自动灌进去的种子」，
   * 避免新设备把演示文章推到云端。
   */
  function isUntouchedSeed() {
    try {
      return readLocalRaw() !== null && global.localStorage.getItem(SEEDED_KEY) === '1';
    } catch (e) {
      return false;
    }
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
      var raw = readLocalRaw();
      var parsed = null;
      if (raw) {
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      }
      if (parsed) {
        memoryDb = normalize(parsed);
      } else {
        // 本地还没有任何数据：先灌一份演示数据，并打上「种子」标记
        memoryDb = persist(seed());
        markSeeded();
      }
    }
    return memoryDb;
  }

  /* ============================================================
     云端同步
     ============================================================ */

  var remote = {
    checked: false,        // 是否已经尝试过访问 /api/db
    available: false,      // /api/db 是否可用
    exists: false,         // 云端是否已经有数据文件
    sha: null,             // 云端当前版本的 sha，用于并发控制
    lastError: null,
    lastSyncAt: 0,
    dirty: false,          // 本地有尚未推送成功的改动
    pendingLocalPosts: []  // 本地有、云端没有的已发布文章
  };

  var readyPromise = null;

  /**
   * 带超时的 fetch 包装。
   * 超时是必要的：否则网络半死不活时，首页会一直停在「正在加载…」。
   */
  function apiFetch(path, opts, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof global.fetch !== 'function') {
        var e = new Error('当前环境不支持 fetch，已切换为纯本地模式');
        e.status = 0;
        return reject(e);
      }

      var limit = timeoutMs || 12000;
      var timer = null;
      var options = opts;
      var controller = null;

      if (typeof global.AbortController === 'function') {
        controller = new global.AbortController();
        options = Object.assign({}, opts, { signal: controller.signal });
        timer = setTimeout(function () { controller.abort(); }, limit);
      }

      function settle(fn, arg) {
        if (timer) { clearTimeout(timer); timer = null; }
        fn(arg);
      }

      var request;
      try {
        request = global.fetch(API_BASE + path, options);
      } catch (err) {
        var e2 = new Error('无法连接数据接口：' + (err && err.message ? err.message : '未知错误'));
        e2.status = 0;
        return settle(reject, e2);
      }

      request.then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          if (text) {
            try { data = JSON.parse(text); } catch (e) { data = null; }
          }
          if (!res.ok) {
            var msg = (data && data.error) || ('请求失败（HTTP ' + res.status + '）');
            var err = new Error(msg);
            err.status = res.status;
            err.data = data;
            return settle(reject, err);
          }
          settle(resolve, data);
        });
      }, function (netErr) {
        var aborted = netErr && netErr.name === 'AbortError';
        var e3 = new Error(aborted
          ? '请求超时（超过 ' + Math.round(limit / 1000) + ' 秒），已切换为纯本地模式'
          : '无法连接数据接口：' + (netErr && netErr.message ? netErr.message : '网络错误'));
        e3.status = 0;
        settle(reject, e3);
      });
    });
  }

  /* ---------- 登录令牌 ---------- */

  function getToken() {
    try { return global.sessionStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }

  function setToken(token) {
    try {
      if (token) global.sessionStorage.setItem(TOKEN_KEY, token);
      else global.sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
  }

  function isAuthed() {
    return !!getToken();
  }

  /**
   * 校验当前令牌是否仍然有效（页面刷新后确认登录态用）。
   * 网络异常不算登录失效，避免一断网就把人踢出去。
   */
  function checkAuth() {
    var token = getToken();
    if (!token) return Promise.resolve(false);
    if (!remote.available) return Promise.resolve(true); // 纯本地模式，信任本地令牌
    if (token === 'local') return Promise.resolve(false);

    return apiFetch('auth', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function () {
      return true;
    }, function (err) {
      if (err && err.status === 401) { setToken(null); return false; }
      return true;
    });
  }

  /* ---------- 载入并合并云端数据 ---------- */

  function summarize() {
    return {
      checked: remote.checked,
      remote: remote.available,
      exists: remote.exists,
      error: remote.lastError ? remote.lastError.message : null,
      pendingCount: remote.pendingLocalPosts.length,
      pendingTitles: remote.pendingLocalPosts.map(function (p) { return p.title; })
    };
  }

  /**
   * 页面启动时必须先 await 一次 ready()，之后所有同步读方法才拿得到正确数据。
   * 结果会缓存，重复调用只会返回同一个 Promise。
   */
  function ready() {
    if (readyPromise) return readyPromise;

    // 注意顺序：load() 在本地为空时会写入种子数据，所以「是不是没动过的种子」要先判断
    var hadRaw = readLocalRaw() !== null;
    var untouchedSeed = !hadRaw || isUntouchedSeed();
    var local = load();

    readyPromise = apiFetch('db').then(function (payload) {
      remote.checked = true;
      remote.available = true;
      remote.lastError = null;

      var cloudDb = payload && payload.db ? normalize(payload.db) : null;
      var cloudExists = !!(payload && payload.exists && cloudDb);

      // 清掉纯本地模式下遗留的假令牌，避免拿着它去请求云端
      if (getToken() === 'local') setToken(null);

      remote.exists = cloudExists;
      remote.sha = (payload && payload.sha) || null;
      remote.pendingLocalPosts = [];

      if (!cloudExists) {
        // 云端还是空的（首次部署）：先完整保留本地内容，登录后可以一键推上去
        memoryDb = local;
        return summarize();
      }

      if (untouchedSeed) {
        // 这台设备上没有任何用户内容，云端就是唯一事实来源
        memoryDb = persist(cloudDb);
        return summarize();
      }

      // 本地有内容：已发布的文章以云端为准（可能是在别的设备上改过），
      // 本地草稿一律保留，绝不因为同步而丢稿
      var cloudIds = Object.create(null);
      cloudDb.posts.forEach(function (p) { cloudIds[p.id] = 1; });

      var localDrafts = local.posts.filter(function (p) {
        return p.status === 'draft' && !cloudIds[p.id];
      });

      // 本机有、云端没有的已发布文章（升级前写下的老内容，或离线时写的）。
      // 只有已登录的后台会话才把它们合进来：普通访客的缓存里可能只是过期的演示数据，
      // 合进来会让早就删掉的文章「复活」到公开站点上。
      var isAdmin = !!getToken();
      var localExtras = isAdmin ? local.posts.filter(function (p) {
        return p.status === 'published' && !cloudIds[p.id];
      }) : [];

      remote.pendingLocalPosts = localExtras.map(function (p) {
        return { id: p.id, title: p.title };
      });

      var merged = normalize({
        version: 1,
        settings: cloudDb.settings,
        categories: cloudDb.categories,
        tags: cloudDb.tags,
        posts: cloudDb.posts.concat(localExtras).concat(localDrafts)
      });

      if (isAdmin) {
        // 后台会话：把合并结果（含本机独有的文章）写回缓存，别弄丢
        memoryDb = persist(merged);
      } else {
        // 普通访客：只放内存，不回写缓存 —— 否则会把本机独有的文章从缓存里冲掉
        memoryDb = merged;
      }

      return summarize();
    }).catch(function (err) {
      // 接口不可用（没配置、没网络、file:// 直接打开）—— 退回纯本地模式，页面照常能用
      remote.checked = true;
      remote.available = false;
      remote.lastError = err;
      memoryDb = local;
      return summarize();
    });

    return readyPromise;
  }

  /** 丢掉缓存，重新从云端拉一次（保存冲突时用它恢复） */
  function reload() {
    readyPromise = null;
    memoryDb = null;
    return ready();
  }

  /* ---------- 推送 ---------- */

  function push(message) {
    var db = load();
    return apiFetch('db', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken()
      },
      body: JSON.stringify({
        db: db,
        sha: remote.sha,
        message: message || 'chore(blog): 更新文章数据'
      })
    }, 25000).then(function (res) {
      remote.exists = true;
      remote.sha = (res && res.sha) || remote.sha;
      remote.lastSyncAt = Date.now();
      remote.dirty = false;
      remote.lastError = null;
      remote.pendingLocalPosts = [];
      return res || {};
    }, function (err) {
      remote.lastError = err;
      if (err && err.status === 401) setToken(null);
      throw err;
    });
  }

  /**
   * 所有写操作的统一出口：先落本地，再推云端。
   * 永远 resolve，用返回值告诉调用方「云端到底成没成功」，避免界面谎报「已发布」。
   */
  function commit(message, fn) {
    var db = load();
    var value = fn(db);
    clearSeeded();
    persist(db);
    remote.dirty = true;

    if (!remote.available) {
      return Promise.resolve({ ok: true, synced: false, offline: true, value: value });
    }
    if (!getToken() || getToken() === 'local') {
      return Promise.resolve({
        ok: false, synced: false, value: value,
        error: new Error('登录已过期，请重新登录后再保存')
      });
    }

    return push(message).then(function (res) {
      return { ok: true, synced: true, value: value, commitUrl: res.commitUrl || null };
    }, function (err) {
      return { ok: false, synced: false, value: value, error: err };
    });
  }

  /* ---------- 站点设置 ---------- */

  function getSettings() {
    return load().settings;
  }

  function updateSettings(patch) {
    return commit('chore(blog): 更新站点设置', function (db) {
      Object.keys(patch || {}).forEach(function (k) {
        db.settings[k] = patch[k];
      });
      db.settings.pageSize = Math.max(1, Math.min(50, parseInt(db.settings.pageSize, 10) || 6));
      return db.settings;
    });
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
    input = input || {};
    var isNew = !input.id || !getPost(input.id);
    var title = String(input.title || '').trim() || '未命名文章';

    return commit(
      (isNew ? 'feat(blog): 新增文章《' : 'docs(blog): 更新文章《') + title + '》',
      function (db) {
        var now = nowISO();
        var post = null;

        if (!isNew) {
          for (var i = 0; i < db.posts.length; i++) {
            if (db.posts[i].id === input.id) { post = db.posts[i]; break; }
          }
        }

        if (!post) {
          post = { id: uid('post'), createdAt: now, views: 0 };
          db.posts.unshift(post);
        }

        post.title = title;
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

        return post;
      }
    );
  }

  function deletePost(id) {
    var post = getPost(id);
    return commit('chore(blog): 删除文章《' + (post ? post.title : id) + '》', function (db) {
      var before = db.posts.length;
      db.posts = db.posts.filter(function (p) { return p.id !== id; });
      return db.posts.length < before;
    });
  }

  /**
   * 阅读量只在本地累加，不触发推送 —— 否则每来一个访客就往仓库提交一次。
   * 后台下次保存时会把当前数值一并带上。
   */
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
    if (!name) return Promise.resolve({ ok: true, synced: false, value: false });
    if (load().categories.indexOf(name) !== -1) {
      return Promise.resolve({ ok: true, synced: true, value: true, unchanged: true });
    }
    return commit('chore(blog): 新增分类 ' + name, function (db) {
      if (db.categories.indexOf(name) === -1) db.categories.push(name);
      return true;
    });
  }

  function renameCategory(from, to) {
    to = String(to || '').trim();
    if (!to) return Promise.resolve({ ok: false, synced: false, value: false, error: new Error('分类名不能为空') });
    return commit('chore(blog): 重命名分类 ' + from + ' → ' + to, function (db) {
      var i = db.categories.indexOf(from);
      if (i !== -1) db.categories[i] = to;
      if (db.categories.indexOf(to) === -1) db.categories.push(to);
      db.posts.forEach(function (p) { if (p.category === from) p.category = to; });
      return true;
    });
  }

  function deleteCategory(name) {
    return commit('chore(blog): 删除分类 ' + name, function (db) {
      db.categories = db.categories.filter(function (c) { return c !== name; });
      db.posts.forEach(function (p) { if (p.category === name) p.category = ''; });
      return true;
    });
  }

  function addTag(name) {
    name = String(name || '').trim();
    if (!name) return Promise.resolve({ ok: true, synced: false, value: false });
    if (load().tags.indexOf(name) !== -1) {
      return Promise.resolve({ ok: true, synced: true, value: true, unchanged: true });
    }
    return commit('chore(blog): 新增标签 ' + name, function (db) {
      if (db.tags.indexOf(name) === -1) db.tags.push(name);
      return true;
    });
  }

  function deleteTag(name) {
    return commit('chore(blog): 删除标签 ' + name, function (db) {
      db.tags = db.tags.filter(function (t) { return t !== name; });
      db.posts.forEach(function (p) {
        p.tags = p.tags.filter(function (t) { return t !== name; });
      });
      return true;
    });
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
    var next = normalize(parsed);
    return commit('chore(blog): 导入数据备份', function (db) {
      Object.keys(db).forEach(function (k) { delete db[k]; });
      Object.keys(next).forEach(function (k) { db[k] = next[k]; });
      return db;
    });
  }

  function reset() {
    return commit('chore(blog): 恢复演示数据', function (db) {
      var fresh = seed();
      Object.keys(db).forEach(function (k) { delete db[k]; });
      Object.keys(fresh).forEach(function (k) { db[k] = fresh[k]; });
      return db;
    });
  }

  /* ---------- 登录 ---------- */

  /**
   * @returns {Promise<{ok:boolean, isDefaultPassword?:boolean, local?:boolean, error?:Error}>}
   */
  function login(password) {
    var pwd = String(password || '');

    // 必须先确认数据层已经判断过 /api 是否可用，否则会把「接口还没探测完」当成纯本地模式
    return ready().then(function () {
      if (remote.available) {
        return apiFetch('auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        }).then(function (res) {
          setToken(res && res.token);
          return { ok: true, isDefaultPassword: !!(res && res.isDefaultPassword) };
        }, function (err) {
          return { ok: false, error: err };
        });
      }

      // 纯本地模式（直接双击打开页面 / 接口没配置）：退回本地散列校验，
      // 保证离线也能进后台改东西
      var settings = load().settings;
      if (hash(SALT + pwd) === settings.passwordHash) {
        setToken('local');
        return { ok: true, local: true };
      }
      return { ok: false, error: new Error('密码不正确') };
    });
  }

  function logout() {
    setToken(null);
  }

  function changePassword() {
    return Promise.reject(new Error(
      '密码现在由服务端保管，不能在本页修改。请到 Vercel 项目的 Settings → Environment Variables 里修改 ADMIN_PASSWORD，然后重新部署。'
    ));
  }

  /* ---------- 同步状态 / 手动上传 ---------- */

  function syncState() {
    return {
      checked: remote.checked,
      available: remote.available,
      exists: remote.exists,
      dirty: remote.dirty,
      lastSyncAt: remote.lastSyncAt,
      error: remote.lastError ? remote.lastError.message : null,
      pendingCount: remote.pendingLocalPosts.length,
      pendingTitles: remote.pendingLocalPosts.map(function (p) { return p.title; })
    };
  }

  /** 把当前本地文档整体推给云端（首次部署把老文章搬上去时用） */
  function pushLocal(message) {
    if (!remote.available) {
      return Promise.resolve({
        ok: false, synced: false,
        error: new Error('云端接口不可用，无法上传')
      });
    }
    if (!getToken() || getToken() === 'local') {
      return Promise.resolve({
        ok: false, synced: false,
        error: new Error('请先登录再上传')
      });
    }
    remote.dirty = true;
    return push(message || 'chore(blog): 上传本地文章到云端').then(function (res) {
      return { ok: true, synced: true, commitUrl: res.commitUrl || null };
    }, function (err) {
      return { ok: false, synced: false, error: err };
    });
  }

  /* ---------- AI 助手 ---------- */

  /**
   * 调用服务端的 AI 接口。模型密钥只存在服务端环境变量里，浏览器拿不到。
   * AI 与 GitHub 配置相互独立：仓库没配好也不影响用 AI 写稿。
   *
   * @param {string} action 'content' | 'title' | 'format'
   * @param {object} payload
   * @returns {Promise<{text:string, titles?:string[], model?:string}>}
   */
  function ai(action, payload) {
    var token = getToken();
    if (!token || token === 'local') {
      return Promise.reject(new Error('请先登录再使用 AI 功能'));
    }
    return apiFetch('ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }, 90000);
  }

  /* ---------- 导出 API ---------- */

  global.Blog = {
    storageAvailable: storageAvailable,
    isStorageOK: function () { return storageOK; },
    uid: uid,
    hash: hash,
    db: load,
    reset: reset,

    // 云端同步
    ready: ready,
    reload: reload,
    syncState: syncState,
    pushLocal: pushLocal,
    ai: ai,
    isRemote: function () { return remote.available; },

    // 登录
    login: login,
    logout: logout,
    isAuthed: isAuthed,
    checkAuth: checkAuth,
    getToken: getToken,
    changePassword: changePassword,
    DEFAULT_PASSWORD: DEFAULT_PASSWORD,

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
    importJSON: importJSON
  };

  // 初始化时探测一次存储能力
  storageOK = storageAvailable();
  if (!storageOK) memoryDb = null;
})(window);
