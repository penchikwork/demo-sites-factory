#!/usr/bin/env node
// Сборка демо-сайтов: content/{slug}.json + template/ → site/{slug}/
// Без зависимостей. Запуск: node build.js
// Синтаксис шаблона и поля данных — в template/README.md.

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const TEMPLATE_DIR = path.join(ROOT, 'template');
const CONTENT_DIR = path.join(ROOT, 'content');
const SITE_DIR = path.join(ROOT, 'site');

const DEMO_TEXT = 'Демо-концепт, не официальный сайт, удалим по первой просьбе';
const REQUIRED = ['slug', 'title', 'name'];

// ---------- Шаблонизатор ----------

const TAG = /{{\s*(#if|#each|\/if|\/each|else)?\s*([^}]*?)\s*}}/g;

function parse(src) {
  const root = { children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const out = () => (top().inElse ? top().elseChildren : top().children);
  let last = 0;
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(src))) {
    if (m.index > last) out().push({ type: 'text', value: src.slice(last, m.index) });
    last = TAG.lastIndex;
    const [, kw, arg] = m;
    if (kw === '#if' || kw === '#each') {
      const node = { type: kw.slice(1), key: arg, children: [], elseChildren: [] };
      out().push(node);
      stack.push(node);
    } else if (kw === 'else') {
      if (stack.length === 1) throw new Error('{{else}} вне блока');
      top().inElse = true;
    } else if (kw === '/if' || kw === '/each') {
      const node = stack.pop();
      if (!node || node.type !== kw.slice(1)) throw new Error(`Непарный тег {{${kw}}}`);
    } else {
      if (!arg) throw new Error('Пустой тег {{}}');
      out().push({ type: 'var', key: arg });
    }
  }
  if (last < src.length) out().push({ type: 'text', value: src.slice(last) });
  if (stack.length !== 1) throw new Error(`Не закрыт блок {{#${top().type} ${top().key}}}`);
  return root.children;
}

const MISSING = Symbol('missing');

function lookupOne(ctx, key) {
  if (key === 'this') return ctx[0];
  const [head, ...rest] = key.split('.');
  for (const scope of ctx) {
    if (scope && typeof scope === 'object' && Object.prototype.hasOwnProperty.call(scope, head)) {
      return rest.reduce((v, k) => (v == null ? undefined : v[k]), scope[head]);
    }
  }
  return MISSING;
}

const isFilled = (v) =>
  Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : Boolean(v) && v !== MISSING;

function lookup(ctx, key, file) {
  const keys = key.split('||').map((k) => k.trim());
  const values = keys.map((k) => {
    const v = lookupOne(ctx, k);
    if (v !== MISSING) return v;
    // Внутри {{#each}} поля элемента необязательны (label?, text?, rating?);
    // на верхнем уровне отсутствие поля — ошибка (ловит опечатки).
    if (ctx.length > 1) return undefined;
    throw new Error(`${file}: в данных нет поля «${k}» (нужно хотя бы пустое значение)`);
  });
  return keys.length > 1 ? values.find(isFilled) : values[0];
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(nodes, ctx, file) {
  let html = '';
  for (const n of nodes) {
    if (n.type === 'text') html += n.value;
    else if (n.type === 'var') {
      const v = lookup(ctx, n.key, file);
      if (v != null && typeof v === 'object') throw new Error(`${file}: «${n.key}» — объект, а нужна строка`);
      html += escapeHtml(v == null ? '' : v);
    } else if (n.type === 'if') {
      html += render(isFilled(lookup(ctx, n.key, file)) ? n.children : n.elseChildren, ctx, file);
    } else if (n.type === 'each') {
      const v = lookup(ctx, n.key, file);
      if (isFilled(v) && !Array.isArray(v)) throw new Error(`${file}: «${n.key}» должен быть массивом`);
      html += isFilled(v)
        ? v.map((item) => render(n.children, [item, ...ctx], file)).join('')
        : render(n.elseChildren, ctx, file);
    }
  }
  return html;
}

// ---------- Встраивание CSS и шрифтов ----------
// Страница должна открываться где угодно — локально (file://), в превью, одним файлом.
// Поэтому CSS кладём в <style>, а шрифты — внутрь CSS как data: URI.

const LINK_TAG = '<link rel="stylesheet" href="style.css">';

function inlineCss(html) {
  let css = fs.readFileSync(path.join(TEMPLATE_DIR, 'style.css'), 'utf8');
  // Подмножество latin-ext нужно только для знака ₽ — встраиваем, если он есть на странице.
  if (!html.includes('₽')) {
    css = css.replace(/@font-face\s*{[^}]*latin-ext[^}]*}\s*/g, '');
  }
  css = css.replace(/url\((fonts\/[^)]+\.woff2)\)/g, (_, rel) => {
    const file = path.join(TEMPLATE_DIR, rel);
    if (!fs.existsSync(file)) throw new Error(`Нет файла шрифта ${rel}`);
    return `url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})`;
  });
  if (!html.includes(LINK_TAG)) throw new Error(`В шаблоне нет строки ${LINK_TAG}`);
  return html.replace(LINK_TAG, () => `<style>\n${css}\n</style>`);
}

// ---------- Проверки данных и результата ----------

function prepare(data, file) {
  for (const k of REQUIRED) {
    if (!isFilled(data[k])) throw new Error(`${file}: обязательное поле «${k}» пустое`);
  }
  const expected = path.basename(file, '.json');
  if (data.slug !== expected) throw new Error(`${file}: slug «${data.slug}» не совпадает с именем файла`);
  if (!/^[a-z0-9-]+$/.test(data.slug)) throw new Error(`${file}: slug только из a-z, 0-9 и дефиса`);

  const raw = JSON.stringify(data);
  if (/inv_by|inv_ts/.test(raw)) throw new Error(`${file}: уберите из ссылок 2ГИС параметры inv_by/inv_ts`);

  // Неразрывный пробел внутри чисел в ценах: «1 500 ₽» не должно рваться.
  const nbsp = (v) => String(v).replace(/(\d) (?=\d)/g, "$1\u00A0").replace(/ ₽/g, "\u00A0₽");
  for (const key of ["prices", "services"]) {
    if (Array.isArray(data[key])) data[key] = data[key].map((p) => (p.price ? { ...p, price: nbsp(p.price) } : p));
  }
  return data;
}

function verify(html, file) {
  const problems = [];
  if (/{{|}}/.test(html)) problems.push('остались теги {{…}}');
  if (html.split(DEMO_TEXT).length - 1 < 2) problems.push('плашка «Демо-концепт» должна быть сверху и снизу');
  if (!/<meta name="robots" content="noindex/.test(html)) problems.push('нет noindex');
  if (/<link[^>]+stylesheet/.test(html) || /url\(fonts\//.test(html)) problems.push('остались внешние CSS/шрифты');
  if (!html.includes('<style>')) problems.push('нет встроенного CSS');
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
}

// ---------- Сборка ----------

function build() {
  const template = parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf8'));
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('В content/ нет JSON-файлов');

  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SITE_DIR, { recursive: true });

  const built = [];
  for (const f of files) {
    const rel = path.join('content', f);
    const data = prepare(JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8')), rel);
    const html = inlineCss(
      render(template, [data], rel)
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
    );
    verify(html, rel);

    const out = path.join(SITE_DIR, data.slug);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'index.html'), html);
    built.push(data);
    console.log(`✓ site/${data.slug}/index.html (${Math.round(Buffer.byteLength(html) / 1024)} КБ, всё внутри)`);
  }

  // Запрет индексации для всего сайта.
  fs.writeFileSync(path.join(SITE_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  // GitHub Pages: не обрабатывать сайт Jekyll'ом.
  fs.writeFileSync(path.join(SITE_DIR, '.nojekyll'), '');
  const index = inlineCss(indexPage());
  verify(index, 'site/index.html');
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), index);
  console.log(`✓ site/index.html, site/robots.txt — готово: ${built.length} стр.`);
}

// Корень сайта — заглушка без списка: каждая демо-страница открывается
// только по своей прямой ссылке (/{slug}/), и сервисы не видят друг друга.
function indexPage() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="googlebot" content="noindex, nofollow">
  <meta name="yandex" content="noindex, nofollow">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0E1013">
  <title>Демо-концепт</title>
  ${LINK_TAG}
</head>
<body>
  <div class="demo-bar" role="note"><p class="demo-bar__text">${DEMO_TEXT}</p></div>
  <main class="stub">
    <h1 class="stub__title">Страница открывается по прямой ссылке</h1>
    <p class="stub__text">Каждый демо-сайт доступен только по своему адресу. Общего списка здесь нет.</p>
  </main>
  <footer class="footer">
    <div class="demo-plate" role="note">
      <p class="demo-plate__title">${DEMO_TEXT}</p>
      <p class="demo-plate__text">Страницы сделаны как примеры и не связаны с организациями.</p>
    </div>
  </footer>
</body>
</html>
`;
}

try {
  build();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
