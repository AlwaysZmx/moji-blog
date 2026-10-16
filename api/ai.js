/*!
 * api/ai.js —— AI 写作助手接口
 *
 *   POST /api/ai   Authorization: Bearer <token>
 *        body: { action: 'content' | 'title' | 'format', ... }
 *        → { ok, text, titles?, model }
 *
 * 必须登录才能调用：这个接口会消耗你的模型额度，不能对公网开放。
 */
'use strict';

const gh = require('../lib/github-db');
const ai = require('../lib/ai');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return gh.send(res, 405, { error: '只支持 POST' });
    }

    if (!gh.verifyToken(gh.bearer(req))) {
      return gh.send(res, 401, { error: '登录已过期，请重新登录后再使用 AI 功能' });
    }

    const body = await gh.readBody(req);
    const result = await ai.run(body || {});

    return gh.send(res, 200, {
      ok: true,
      text: result.text,
      titles: result.titles || null,
      model: result.model || null
    });
  } catch (err) {
    return gh.send(res, err.status || 500, { error: err.message || '服务器内部错误' });
  }
};
