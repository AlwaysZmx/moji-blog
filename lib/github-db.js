/*!
 * lib/github-db.js —— 服务端数据层（供 api/ 下的 Vercel Function 复用）
 *
 * 思路：把 GitHub 仓库里的一个 JSON 文件当作数据库。
 *   - 读：GitHub Contents API（文件大于 1MB 时 Contents API 不返回内容，回落 Git Blobs API）
 *   - 写：GitHub Contents API，带上 sha 做乐观并发控制，避免两台设备互相覆盖
 *
 * 约定：云端只保存「已发布」的文章。草稿始终留在写它的那台浏览器里，
 * 因此无论仓库是公开还是私有、无论静态站点是否会暴露 data/ 目录，
 * 草稿都不会被泄漏出去。
 *
 * 零依赖：只用 Node 内置的 crypto + 全局 fetch（Node 18+）。
 */
'use strict';

const crypto = require('crypto');

const API = 'https://api.github.com';
const USER_AGENT = 'dshm-blog';
const DEFAULT_DATA_PATH = 'data/blog-db.json';
const DEFAULT_PASSWORD = 'admin123';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 登录有效期 12 小时

/* ---------- 配置 ---------- */

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 仓库信息优先取显式的 GITHUB_REPO；
 * 没配的话就复用 Vercel 自动注入的 Git 环境变量，省掉一次手工配置。
 */
function config() {
  const owner = env('VERCEL_GIT_REPO_OWNER');
  const slug = env('VERCEL_GIT_REPO_SLUG');
  return {
    repo: env('GITHUB_REPO') || (owner && slug ? owner + '/' + slug : ''),
    token: env('GITHUB_TOKEN') || env('GH_TOKEN'),
    branch: env('GITHUB_BRANCH'),
    dataPath: env('GITHUB_DATA_PATH') || DEFAULT_DATA_PATH
  };
}

const branchCache = Object.create(null);

/**
 * 解析数据文件所在分支。
 *
 * 刻意**不**用 VERCEL_GIT_COMMIT_REF：预览部署里它是临时分支，
 * 在预览地址上发文章会把内容写到那个分支上，正式站点反而看不到 —— 正是这次要修的毛病。
 * 所以默认落在仓库的默认分支上，数据位置和「站点从哪个分支部署」解耦。
 */
async function resolveBranch(c) {
  if (c.branch) return c.branch;
  if (branchCache[c.repo]) return branchCache[c.repo];

  try {
    const res = await ghFetch(API + '/repos/' + c.repo, {
      headers: githubHeaders(c.token),
      cache: 'no-store'
    });
    const branch = (res.res.ok && res.data && res.data.default_branch) || 'main';
    branchCache[c.repo] = branch;
    return branch;
  } catch (e) {
    return 'main';
  }
}

function configProblems() {
  const c = config();
  const problems = [];
  if (!c.repo) problems.push('GITHUB_REPO（形如 your-name/your-blog）');
  if (!c.token) problems.push('GITHUB_TOKEN（细粒度 PAT，需要该仓库的 Contents 读写权限）');
  return problems;
}

function configErrorMessage() {
  return '云端存储尚未配置：请在 Vercel 项目的 Settings → Environment Variables 里添加 ' +
    configProblems().join(' 和 ') + '，保存后重新部署一次。';
}

/* ---------- 错误 ---------- */

class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (extra) Object.assign(this, extra);
  }
}

/* ---------- HTTP 小工具 ---------- */

function send(res, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 关键：绝不能让 CDN 缓存住数据接口，否则刚发布的文章在别的电脑上还是看不到
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

function githubHeaders(token) {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

function encodePath(p) {
  return String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

async function ghFetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = null; }
  }
  return { res, data, text };
}

function describeGithubError(res, data) {
  const raw = (data && (data.message || data.error)) || '';
  if (res.status === 401) return 'GitHub 拒绝了请求（401）：Token 无效或已过期。';
  if (res.status === 403) {
    return 'GitHub 拒绝了请求（403）：' + (raw || '权限不足或触发速率限制') +
      '。请确认 Token 对该仓库有 Contents 读写权限。';
  }
  if (res.status === 404) {
    return '找不到仓库或分支（404）：' + (raw || '') +
      '。请检查 GITHUB_REPO / GITHUB_BRANCH / GITHUB_DATA_PATH 是否正确，以及 Token 是否有权访问。';
  }
  return 'GitHub 接口返回 ' + res.status + (raw ? '：' + raw : '');
}

async function readBody(req) {
  const body = req.body;
  if (body !== undefined && body !== null) {
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch (e) { return null; }
    }
    if (typeof body === 'object') return body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function bearer(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h) return '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1].trim() : '';
}

/* ---------- 数据整形 ---------- */

/**
 * 云端存储 / 公开读取统一走这个投影：
 * 只保留已发布的文章，并去掉密码散列。
 * 写入与读取都用它，服务端永远不信任客户端传来的草稿。
 */
function sanitize(db) {
  const src = db && typeof db === 'object' ? db : {};
  const settings = Object.assign({}, src.settings && typeof src.settings === 'object' ? src.settings : {});
  delete settings.passwordHash;

  return {
    version: 1,
    settings: settings,
    categories: Array.isArray(src.categories) ? src.categories : [],
    tags: Array.isArray(src.tags) ? src.tags : [],
    posts: (Array.isArray(src.posts) ? src.posts : []).filter(function (p) {
      return p && typeof p === 'object' && p.status === 'published';
    })
  };
}

/* ---------- 读写 GitHub ---------- */

/** @returns {Promise<null|{text:string, sha:string}>} 文件不存在时返回 null */
async function getFile() {
  const c = config();
  if (!c.repo || !c.token) throw new ApiError(500, configErrorMessage());

  const branch = await resolveBranch(c);
  const url = API + '/repos/' + c.repo + '/contents/' + encodePath(c.dataPath) +
    '?ref=' + encodeURIComponent(branch);
  const { res, data } = await ghFetch(url, { headers: githubHeaders(c.token), cache: 'no-store' });

  // 文件还没被创建过，是完全正常的状态
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(502, describeGithubError(res, data));
  if (!data || typeof data !== 'object' || !data.sha) {
    throw new ApiError(502, 'GitHub 返回了意料之外的响应结构。');
  }

  // Contents API 对超过 1MB 的文件不返回 content，改用 Blobs API 取原始内容
  if (data.encoding === 'base64' && data.content) {
    const text = Buffer.from(String(data.content).replace(/\s+/g, ''), 'base64').toString('utf8');
    return { text: text, sha: data.sha };
  }

  const blobUrl = API + '/repos/' + c.repo + '/git/blobs/' + data.sha;
  const blobHeaders = githubHeaders(c.token);
  blobHeaders.Accept = 'application/vnd.github.raw';
  const blob = await ghFetch(blobUrl, { headers: blobHeaders, cache: 'no-store' });
  if (!blob.res.ok) throw new ApiError(502, describeGithubError(blob.res, blob.data));
  return { text: blob.text, sha: data.sha };
}

async function putFile(db, sha, message) {
  const c = config();
  if (!c.repo || !c.token) throw new ApiError(500, configErrorMessage());

  const payload = {
    message: message || ('chore(blog): 更新文章数据 ' + new Date().toISOString()),
    content: Buffer.from(JSON.stringify(sanitize(db), null, 2), 'utf8').toString('base64'),
    branch: await resolveBranch(c)
  };
  if (sha) payload.sha = sha;

  const url = API + '/repos/' + c.repo + '/contents/' + encodePath(c.dataPath);
  const { res, data } = await ghFetch(url, {
    method: 'PUT',
    headers: Object.assign(githubHeaders(c.token), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    cache: 'no-store'
  });

  if (res.ok) {
    return {
      sha: (data && data.content && data.content.sha) || null,
      commit: (data && data.commit && data.commit.sha) || null,
      commitUrl: (data && data.commit && data.commit.html_url) || null
    };
  }

  // 409 / 422 基本都意味着「我们手上的 sha 过期了」：期间有别的设备写过
  if (res.status === 409 || res.status === 422) {
    const latest = await getFile().catch(function () { return null; });
    throw new ApiError(409,
      sha
        ? '云端数据已被其他设备修改，这次保存没有写入。请刷新页面、确认最新内容后重新编辑。'
        : '云端已经存在数据文件（可能刚被其他设备创建）。请刷新页面后重新编辑。',
      { currentSha: latest ? latest.sha : null });
  }

  throw new ApiError(502, describeGithubError(res, data));
}

/* ---------- 登录态 ---------- */

function authSecret() {
  return env('AUTH_SECRET') || env('ADMIN_PASSWORD') || 'dshm-blog-fallback-secret';
}

function adminPassword() {
  return env('ADMIN_PASSWORD') || DEFAULT_PASSWORD;
}

/** 是否还在用默认密码 —— 用于在后台醒目地提醒用户尽快改掉 */
function isDefaultPassword() {
  return env('ADMIN_PASSWORD') === '';
}

function signToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  const sig = crypto.createHmac('sha256', authSecret()).update(exp).digest('base64url');
  return exp + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const i = token.lastIndexOf('.');
  if (i <= 0) return false;

  const payload = token.slice(0, i);
  const provided = token.slice(i + 1);
  const expected = crypto.createHmac('sha256', authSecret()).update(payload).digest('base64url');

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  const exp = parseInt(payload, 10);
  return Number.isFinite(exp) && Date.now() < exp;
}

function checkPassword(password) {
  const a = Buffer.from(String(password === undefined || password === null ? '' : password));
  const b = Buffer.from(adminPassword());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  ApiError: ApiError,
  config: config,
  configProblems: configProblems,
  configErrorMessage: configErrorMessage,
  send: send,
  readBody: readBody,
  bearer: bearer,
  sanitize: sanitize,
  getFile: getFile,
  putFile: putFile,
  signToken: signToken,
  verifyToken: verifyToken,
  checkPassword: checkPassword,
  isDefaultPassword: isDefaultPassword,
  TOKEN_TTL_MS: TOKEN_TTL_MS,
  DEFAULT_PASSWORD: DEFAULT_PASSWORD
};
