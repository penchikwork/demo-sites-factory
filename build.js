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
  // Иконка-бейдж услуги — по ключевым словам в названии (оформление, не данные).
  if (Array.isArray(data.services)) {
    data.services = data.services.map((sv) => {
      const icon = sv.icon || serviceIcon(sv.title);
      return { ...sv, icon, group: SERVICE_GROUPS.find(([, , icons]) => icons.includes(icon))[0] };
    });
  }
  // Табы фильтра: только группы, где есть услуги; сами табы — если групп хотя бы две.
  const groups = SERVICE_GROUPS.map(([id, label]) => ({
    id, label, count: String((data.services || []).filter((sv) => sv.group === id).length),
  })).filter((g) => g.count !== '0');
  data.service_groups = groups.length >= 2 ? groups : [];
  data.services_count = String((data.services || []).length);

  // «Как добраться»: маршрут в 2ГИС до точки организации и поиск адреса в Яндекс Картах.
  data.route_url = routeUrl(data.map_url);
  data.yandex_url = data.address
    ? 'https://yandex.ru/maps/?text=' + encodeURIComponent([data.city, data.address].filter(Boolean).join(', '))
    : '';
  // Мессенджеры компании: { type, phone } или { type, href } → ссылки и подписи кнопок.
  if (Array.isArray(data.messengers)) data.messengers = data.messengers.map(messenger);
  // «Частые вопросы»: свои в JSON (`faq`) или собранные из фактов карточки.
  if (!Array.isArray(data.faq) || !data.faq.length) data.faq = buildFaq(data);
  return data;
}

// Telegram и WhatsApp открывают чат по номеру; у Max ссылки на чат по номеру нет:
// без адреса профиля кнопка копирует заявку, открывает Max и подсказывает номер для поиска.
const MESSENGERS = {
  telegram: { name: 'Telegram', icon: 'i-send', url: (d) => `https://t.me/+${d}` },
  whatsapp: { name: 'WhatsApp', icon: 'i-chat', url: (d) => `https://wa.me/${d}` },
  max: { name: 'Max', icon: 'i-chat', url: () => 'https://max.ru/' },
};
function messenger(m) {
  const kind = MESSENGERS[m.type];
  // старый формат { label, href }: ссылка как есть, общая иконка чата
  if (!kind) return { type: '', name: '', find_by: '', icon: 'i-chat', send_label: m.label, ...m };
  const digits = String(m.phone || '').replace(/\D/g, '');
  const href = m.href || (digits ? kind.url(digits) : '');
  if (!href) throw new Error(`мессенджер ${m.type}: нужен phone или href`);
  // У Max по номеру — подсказка, где искать сервис после открытия приложения.
  const find = m.type === 'max' && !m.href && digits
    ? `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
    : '';
  return {
    ...m,
    href,
    label: m.label || `Написать в ${kind.name}`,
    send_label: `Отправить в ${kind.name}`,
    icon: kind.icon,
    name: kind.name,
    find_by: find,
  };
}

// Маршрут в 2ГИС: точка организации из data/2gis/{id}.json, начало маршрута — на выбор пользователя.
// Если точки нет — просто карточка организации.
function routeUrl(mapUrl) {
  const m = /2gis\.ru\/([a-z_-]+)\/firm\/(\d+)/.exec(mapUrl || '');
  if (!m) return mapUrl || '';
  const file = path.join(ROOT, 'data', '2gis', `${m[2]}.json`);
  if (!fs.existsSync(file)) return mapUrl;
  const point = (JSON.parse(fs.readFileSync(file, 'utf8')).item || {}).point;
  if (!point || point.lon == null || point.lat == null) return mapUrl;
  return `https://2gis.ru/${m[1]}/directions/points/${encodeURIComponent(`|${point.lon},${point.lat};${m[2]}`)}`;
}

// Ответы нейтральные: факты (оплата, гарантия, цены) — только из данных страницы,
// чего в данных нет — предлагаем уточнить у мастера. Сроки и суммы не придумываем.
function buildFaq(data) {
  const steps = data.steps || [];
  const services = data.services || [];
  const contact = (data.phones || []).length ? 'по телефону' : 'в сервисе';

  const parts = services.some((s) => s.icon === 'parts')
    ? 'Подходят оба варианта, но договориться лучше заранее. Сервис продаёт запчасти сам — мастер подберёт их по автомобилю. Если хотите приехать со своими, предупредите при записи: мастер скажет, подойдут ли они для ремонта.'
    : `Договоритесь об этом заранее ${contact}: назовите автомобиль и работу, и мастер скажет, можно ли поставить ваши запчасти или сервис подберёт их сам.`;

  const warrantyStep = steps.find((s) => /гарант/i.test(`${s.title} ${s.text}`));
  const warranty = warrantyStep && warrantyStep.text
    ? `${warrantyStep.text.replace(/\.?$/, '.')} Точные условия мастер назовёт при приёме автомобиля — сохраните заказ-наряд.`
    : 'Условия гарантии мастер назовёт до начала ремонта — спросите о них при приёме автомобиля. Сохраните заказ-наряд: в нём указаны выполненные работы.';

  const timing = `Это зависит от автомобиля, неисправности и загрузки сервиса. Примерное время мастер подскажет ${contact}, точное — после осмотра.`;

  const agreeStep = steps.find((s) => /согласован/i.test(s.title) && s.text);
  const hasPrices = services.some((s) => s.price);
  const price = [
    agreeStep ? agreeStep.text.replace(/\.?$/, '.') : '',
    hasPrices ? 'Цены «от» в разделе «Услуги и цены» — нижняя граница.' : '',
    'Итог зависит от автомобиля и состояния деталей: попросите мастера назвать сумму после осмотра и согласовать её до начала работ.',
  ].filter(Boolean).join(' ');

  const pay = (data.features || []).filter((f) => /оплат|наличн|перевод|рассрочк|кредит/i.test(f));
  const payment = pay.length
    ? `По данным карточки компании: ${pay.map((f) => f.charAt(0).toLowerCase() + f.slice(1)).join(', ')}.`
    : `Способы оплаты уточните ${contact} перед визитом.`;

  return [
    { q: 'Можно ли приехать со своими запчастями или вы подберёте сами?', a: parts },
    { q: 'Даёте ли вы гарантию на выполненные работы?', a: warranty },
    { q: 'Сколько времени занимает диагностика и базовый ремонт?', a: timing },
    { q: 'Называете ли точную стоимость до начала работ?', a: price },
    { q: 'Какие способы оплаты принимаете?', a: payment },
  ];
}

// Группы для табов «Услуги и цены» — по иконке услуги.
const SERVICE_GROUPS = [
  ['to', 'ТО и диагностика', ['diagnostics', 'oil', 'service', 'climate', 'car']],
  ['engine', 'Двигатель и КПП', ['engine', 'transmission', 'exhaust', 'tuning']],
  ['chassis', 'Подвеска и тормоза', ['suspension', 'brakes', 'tires']],
  ['other', 'Кузов и другое', ['body', 'wash', 'electrics', 'parts']],
];

// Порядок важен: «Замена масла в АКПП» — КПП, а не масло; «Диагностика подвески» — диагностика.
const SERVICE_ICONS = [
  ['diagnostics', /диагност|вибростенд/i],
  ['transmission', /акпп|мкпп|кпп|сцеплен|кардан|трансмис|вариатор/i],
  ['brakes', /тормоз|колод/i],
  ['tires', /шин|колёс|колес/i],
  ['climate', /кондиц|климат|отопит|печк|охлажд/i],
  ['wash', /мойк|химчист|полиров/i],
  ['electrics', /электр|стартер|генератор|сигнализ|автооптик/i],
  ['suspension', /ходов|подвес|амортиз|рулев|сход|развал|стоек|ступиц/i],
  ['exhaust', /выхлоп|катализ/i],
  ['tuning', /тюнинг/i],
  ['body', /кузов|сварочн|окраск/i],
  ['oil', /масл|фильтр/i],
  ['engine', /двигат|двс|гбц|грм|инжектор|свеч/i],
  ['parts', /запчаст/i],
  ['car', /легковой автосервис/i],
];
function serviceIcon(title) {
  const hit = SERVICE_ICONS.find(([, re]) => re.test(title || ''));
  return hit ? hit[0] : 'service';
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
