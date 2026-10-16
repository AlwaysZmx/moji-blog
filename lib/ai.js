/*!
 * lib/ai.js —— AI 写作助手（服务端）
 *
 * 只依赖标准的 OpenAI 兼容接口：
 *     POST {AI_BASE_URL}/chat/completions
 * 所以 OneAPI、DeepSeek、通义、智谱、Kimi、OpenRouter、Ollama 之类都能直接接。
 *
 * 密钥只存在服务端环境变量里，浏览器永远拿不到它。
 */
'use strict';

const { ApiError } = require('./github-db');

const MAX_TOPIC = 500;
const MAX_CONTENT = 20000;      // 一键排版的输入上限，超了宁可报错也不截断
const DEFAULT_TIMEOUT_MS = 55000;

/* ---------- 配置 ---------- */

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

function config() {
  let base = env('AI_BASE_URL');
  // 允许直接填完整的 chat/completions 地址，也允许只填到 /v1
  if (base && !/\/chat\/completions\/?$/.test(base)) {
    base = base.replace(/\/+$/, '') + '/chat/completions';
  }
  return {
    url: base,
    key: env('AI_API_KEY'),
    model: env('AI_MODEL'),
    maxTokens: parseInt(env('AI_MAX_TOKENS'), 10) || 0,
    timeoutMs: parseInt(env('AI_TIMEOUT_MS'), 10) || DEFAULT_TIMEOUT_MS
  };
}

function configProblems() {
  const c = config();
  const problems = [];
  if (!c.url) problems.push('AI_BASE_URL（例如 https://你的网关/v1）');
  if (!c.key) problems.push('AI_API_KEY');
  if (!c.model) problems.push('AI_MODEL（要填网关支持的模型名）');
  return problems;
}

function configErrorMessage() {
  return 'AI 功能尚未配置：请在 Vercel 项目的 Settings → Environment Variables 里设置 ' +
    configProblems().join('、') + '，保存后重新部署一次。';
}

/* ---------- 提示词 ---------- */

const SYSTEM = {
  content: [
    '你是一位中文博客作者，擅长写结构清晰、信息密度高的文章。',
    '请根据用户给出的主题或提纲写一篇完整的文章。',
    '',
    '硬性要求：',
    '1. 只输出 Markdown 正文本身，不要任何解释、寒暄、前言或结束语；',
    '2. 不要把整篇文章包在 ``` 代码块里；',
    '3. 不要重复输出文章大标题（标题由用户单独填写），直接从 `##` 级小节开始；',
    '4. 段落之间空一行；适当使用列表、表格、引用和带语言标注的代码块；',
    '5. 内容要具体、可执行；不确定的事实不要编造，宁可不写。'
  ].join('\n'),

  title: [
    '你是中文博客编辑。请根据用户提供的正文（或主题）拟标题候选。',
    '',
    '要求：',
    '1. 每行一个标题，不要编号、不要引号、不要任何解释或前后缀；',
    '2. 长度控制在 12–24 个汉字；',
    '3. 具体、克制、有信息量；避免「浅谈」「漫谈」「那些事」这类空泛词，也不要标题党；',
    '4. 只输出标题本身。'
  ].join('\n'),

  format: [
    '你是 Markdown 排版助手。请把用户给的文字整理成结构清晰的 Markdown。',
    '',
    '严格要求：',
    '1. 只调整排版，**不得改写、增删或润色任何句子和词语，不得改变原意**；',
    '2. 所有代码、命令、URL、数字、专有名词必须原样保留；',
    '3. 段落之间空一行；用 `##` / `###` 组织层级；并列内容整理成列表；',
    '   明显是表格的内容整理成 Markdown 表格；引用性内容用 `>` 引用；',
    '4. 已有的代码围栏必须保持代码内容和语言标注不变；',
    '5. 只输出 Markdown 本身，不要解释，也不要用 ``` 包裹整篇。'
  ].join('\n')
};

const LENGTH_TEXT = {
  short: '约 600 字',
  medium: '约 1200 字',
  long: '约 2000 字'
};

function buildMessages(action, body) {
  if (action === 'content') {
    const topic = clamp(body.topic, MAX_TOPIC);
    const outline = clamp(body.outline, MAX_TOPIC);
    const lines = ['主题：' + topic];
    if (outline) lines.push('提纲：\n' + outline);
    if (body.category) lines.push('分类：' + clamp(body.category, 60));
    if (body.tags) lines.push('标签：' + clamp(body.tags, 200));
    lines.push('篇幅：' + (LENGTH_TEXT[body.length] || LENGTH_TEXT.medium));
    return [
      { role: 'system', content: SYSTEM.content },
      { role: 'user', content: lines.join('\n') }
    ];
  }

  if (action === 'title') {
    const content = clamp(body.content, MAX_CONTENT);
    const topic = clamp(body.topic, MAX_TOPIC);
    const count = Math.min(6, Math.max(1, parseInt(body.count, 10) || 4));
    const source = content
      ? '【正文】\n' + content
      : '【主题】\n' + topic;
    return [
      { role: 'system', content: SYSTEM.title },
      { role: 'user', content: '请给出 ' + count + ' 个标题候选。\n\n' + source }
    ];
  }

  return [
    { role: 'system', content: SYSTEM.format },
    { role: 'user', content: '请把下面的内容整理成规范 Markdown：\n\n' + clamp(body.content, MAX_CONTENT) }
  ];
}

/* ---------- 工具 ---------- */

function clamp(value, max) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * 去掉模型习惯性套上的「整篇代码围栏」。
 * 只在围栏语言像文档（或没写语言）时才剥，避免把「整篇就是一段代码」误伤。
 */
function cleanMarkdown(text) {
  let t = String(text || '').replace(/\r\n/g, '\n').trim();
  const lines = t.split('\n');
  if (lines.length < 3) return t;

  const first = lines[0].trim();
  const m = /^```([A-Za-z0-9_+-]*)$/.exec(first);
  if (!m) return t;
  if (lines[lines.length - 1].trim() !== '```') return t;

  const lang = (m[1] || '').toLowerCase();
  const isDocFence = lang === '' || ['markdown', 'md', 'gfm', 'text', 'txt'].indexOf(lang) !== -1;
  if (!isDocFence) return t;

  const stripped = lines.slice(1, -1).join('\n').trim();
  return stripped || t;
}

function parseTitles(text, count) {
  const out = [];
  String(text || '').split('\n').forEach(function (raw) {
    let t = raw.trim();
    if (!t) return;
    if (/^```/.test(t)) return;               // 模型偶尔会把候选包在代码块里
    t = t.replace(/^[-*+]\s+/, '')
      .replace(/^\d+\s*[.、)）]\s*/, '')
      .replace(/^#+\s*/, '')
      .replace(/^[「『"'“”‘’《【\[]+/, '')
      .replace(/[」』"'“”‘’》】\]]+$/, '')
      .trim();
    if (!t) return;
    if (t.length > 60) return;                 // 多半是解释性句子，丢掉
    if (!/[A-Za-z0-9\u4e00-\u9fa5]/.test(t)) return;  // 纯符号，丢掉
    if (out.indexOf(t) === -1) out.push(t);
  });
  return out.slice(0, count);
}

/* ---------- 调用模型 ---------- */

function describeProviderError(status, data) {
  const raw = (data && data.error && (data.error.message || data.error.code)) ||
    (data && data.message) || '';
  if (status === 401 || status === 403) {
    return 'AI 服务拒绝了这个密钥（HTTP ' + status + '）：' + (raw || 'AI_API_KEY 可能不对或没有权限');
  }
  if (status === 404) {
    return 'AI 接口地址不对（404）：请检查 AI_BASE_URL 是否包含正确的路径（通常是 /v1）。' +
      (raw ? ' 原始信息：' + raw : '');
  }
  if (status === 429) {
    return 'AI 服务限流或额度不足（429）：' + (raw || '请稍后重试，或检查账户余额');
  }
  return 'AI 服务返回 HTTP ' + status + (raw ? '：' + raw : '');
}

async function complete(messages, options) {
  const c = config();
  if (configProblems().length) throw new ApiError(503, configErrorMessage());

  const payload = {
    model: c.model,
    messages: messages,
    temperature: options.temperature,
    stream: false
  };
  const maxTokens = c.maxTokens || options.maxTokens;
  if (maxTokens) payload.max_tokens = maxTokens;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(function () { controller.abort(); }, c.timeoutMs) : null;

  let res;
  try {
    res = await fetch(c.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + c.key
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new ApiError(504, 'AI 服务响应超时（超过 ' + Math.round(c.timeoutMs / 1000) +
        ' 秒）。可以试试把篇幅调短，或稍后重试。');
    }
    throw new ApiError(502, '连不上 AI 服务：' + (err && err.message ? err.message : '网络错误') +
      '。请检查 AI_BASE_URL 是否正确、以及该地址能否从 Vercel 访问。');
  }
  if (timer) clearTimeout(timer);

  const raw = await res.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch (e) { data = null; }
  }

  // 注意：这里一律不把上游的状态码原样透出（尤其 401），
  // 否则前端会误以为自己的登录失效而清掉令牌。
  if (!res.ok) throw new ApiError(502, describeProviderError(res.status, data));

  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const text = choice && choice.message && choice.message.content;
  if (!text || !String(text).trim()) {
    throw new ApiError(502, 'AI 返回了空内容，请换个说法或换个模型再试一次。');
  }

  return { text: String(text), model: (data && data.model) || c.model, usage: (data && data.usage) || null };
}

/* ---------- 对外入口 ---------- */

async function run(body) {
  const action = String(body.action || '');

  if (action === 'content') {
    const topic = clamp(body.topic, MAX_TOPIC);
    if (!topic) throw new ApiError(400, '请先填写主题或提纲');

    const result = await complete(buildMessages('content', body), {
      temperature: 0.7,
      maxTokens: 4000
    });
    return { text: cleanMarkdown(result.text), model: result.model, usage: result.usage };
  }

  if (action === 'title') {
    const content = clamp(body.content, MAX_CONTENT);
    const topic = clamp(body.topic, MAX_TOPIC);
    if (!content && !topic) throw new ApiError(400, '请先写一点正文，或填写主题');

    const count = Math.min(6, Math.max(1, parseInt(body.count, 10) || 4));
    const result = await complete(buildMessages('title', body), {
      temperature: 0.85,
      maxTokens: 400
    });

    const titles = parseTitles(cleanMarkdown(result.text), count);
    if (!titles.length) throw new ApiError(502, 'AI 没有给出可用的标题，请再试一次。');
    return { text: titles.join('\n'), titles: titles, model: result.model, usage: result.usage };
  }

  if (action === 'format') {
    const raw = String(body.content || '');
    if (!raw.trim()) throw new ApiError(400, '正文是空的，没有可以排版的内容');
    if (raw.length > MAX_CONTENT) {
      throw new ApiError(400, '正文太长了（超过 ' + MAX_CONTENT + ' 字符），建议分成几段分别排版。');
    }

    const result = await complete(buildMessages('format', body), {
      temperature: 0.2,
      maxTokens: 8000
    });
    const cleaned = cleanMarkdown(result.text);
    if (!cleaned) throw new ApiError(502, 'AI 返回了空内容，请再试一次。');
    return { text: cleaned, model: result.model, usage: result.usage };
  }

  throw new ApiError(400, '不支持的 AI 操作：' + (action || '(空)'));
}

module.exports = {
  run: run,
  config: config,
  configProblems: configProblems,
  configErrorMessage: configErrorMessage,
  cleanMarkdown: cleanMarkdown,
  parseTitles: parseTitles,
  MAX_CONTENT: MAX_CONTENT,
  MAX_TOPIC: MAX_TOPIC
};
