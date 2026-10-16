/*!
 * api/auth.js —— 登录接口
 *
 *   POST /api/auth   { password }  → { token, expiresIn, isDefaultPassword }
 *   GET  /api/auth   Authorization: Bearer <token> → { valid: true }
 *
 * 密码保存在 Vercel 环境变量 ADMIN_PASSWORD 里，校验只发生在服务端，
 * 浏览器拿到的是一个 HMAC 签名的短期令牌，而不是密码本身。
 */
'use strict';

const gh = require('../lib/github-db');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const valid = gh.verifyToken(gh.bearer(req));
      if (!valid) return gh.send(res, 401, { valid: false, error: '登录已过期，请重新登录' });
      return gh.send(res, 200, { valid: true });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return gh.send(res, 405, { error: '只支持 GET 和 POST' });
    }

    const body = await gh.readBody(req);
    const password = body && body.password;

    if (!password) return gh.send(res, 400, { error: '请输入管理密码' });

    if (!gh.checkPassword(password)) {
      // 略微延迟，抬高暴力破解的成本
      await new Promise(function (r) { setTimeout(r, 600); });
      return gh.send(res, 401, { error: '密码不正确' });
    }

    return gh.send(res, 200, {
      token: gh.signToken(),
      expiresIn: gh.TOKEN_TTL_MS,
      isDefaultPassword: gh.isDefaultPassword()
    });
  } catch (err) {
    return gh.send(res, err.status || 500, { error: err.message || '服务器内部错误' });
  }
};
