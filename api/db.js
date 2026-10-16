/*!
 * api/db.js —— 博客数据接口（读写 GitHub 仓库里的 JSON 文件）
 *
 *   GET  /api/db                     → { db, exists, sha }
 *   PUT  /api/db   Authorization: Bearer <token>
 *        body: { db, sha, message }  → { ok, sha, commit }
 *
 * 读是公开的（前台要渲染文章），写必须带登录令牌。
 * 两个方向都会经过 sanitize()：云端永远不保存草稿，也不会保存密码散列。
 */
'use strict';

const gh = require('../lib/github-db');

module.exports = async function handler(req, res) {
  try {
    /* ---------- 读取 ---------- */
    if (req.method === 'GET') {
      const problems = gh.configProblems();
      if (problems.length) {
        return gh.send(res, 503, {
          error: gh.configErrorMessage(),
          problems: problems
        });
      }

      const file = await gh.getFile();
      if (!file) {
        // 云端还没有数据文件 —— 这是首次部署的正常状态
        return gh.send(res, 200, { db: null, exists: false, sha: null });
      }

      let parsed;
      try {
        parsed = JSON.parse(file.text);
      } catch (e) {
        return gh.send(res, 502, { error: '云端数据文件不是合法的 JSON，请检查 ' + gh.config().dataPath });
      }

      return gh.send(res, 200, {
        db: gh.sanitize(parsed),
        exists: true,
        sha: file.sha
      });
    }

    /* ---------- 写入 ---------- */
    if (req.method === 'PUT') {
      if (!gh.verifyToken(gh.bearer(req))) {
        return gh.send(res, 401, { error: '登录已过期，请重新登录后再保存' });
      }

      const problems = gh.configProblems();
      if (problems.length) {
        return gh.send(res, 503, { error: gh.configErrorMessage(), problems: problems });
      }

      const body = await gh.readBody(req);
      const db = body && body.db;

      if (!db || typeof db !== 'object' || !Array.isArray(db.posts)) {
        return gh.send(res, 400, { error: '提交的数据结构不正确：缺少 posts 数组' });
      }

      const result = await gh.putFile(db, body.sha || null, body.message);
      return gh.send(res, 200, {
        ok: true,
        sha: result.sha,
        commit: result.commit,
        commitUrl: result.commitUrl
      });
    }

    res.setHeader('Allow', 'GET, PUT');
    return gh.send(res, 405, { error: '只支持 GET 和 PUT' });
  } catch (err) {
    return gh.send(res, err.status || 500, {
      error: err.message || '服务器内部错误',
      currentSha: err.currentSha || null
    });
  }
};
