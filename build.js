#!/usr/bin/env node
// Сборка демо-сайтов: local_businesses.md → content/{slug}.json + template/ → site/{slug}/
// Работает полностью локально и бесплатно. Запуск: node build.js

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const TEMPLATE_DIR = path.join(ROOT, 'template');
const CONTENT_DIR = path.join(ROOT, 'content');
const SITE_DIR = path.join(ROOT, 'site');

const DEMO_TEXT = 'Демо-концепт, не официальный сайт, удалим по первой просьбе';
const REQUIRED = ['slug', 'title', 'name'];

// ---------- Автогенерация JSON из local_businesses.md ----------

function syncFromMarkdown() {
  const mdFile = path.join(ROOT, 'local_businesses.md');
  if (!fs.existsSync(mdFile)) return;

  const raw = fs.readFileSync(mdFile, 'utf8');
  const sections = raw.split(/^##\s+/m).slice(1);
  if (!sections.length) return;

  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });

  for (const sec of sections) {
    const lines = sec.trim().split('\n');
    const rawName = lines[0].replace(/^\[|\]$/g, '').trim();
    const entry = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      const m = line.match(/^-\s*\*\*([^*]+)\*\*:\s*(.*)$/);
      if (m) {
        entry[m[1].toLowerCase().trim()] = m[2].trim();
      }
    }

    const slug = (entry['slug'] || rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).replace(/^\[|\]$/g, '');
    if (!slug) continue;

    const phoneRaw = entry['телефон'] || '';
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    const phones = phoneDigits ? [{ value: phoneRaw, href: `tel:+${phoneDigits}` }] : [];

    const messengersRaw = entry['мессенджеры / соцсети'] || entry['мессенджеры'] || '';
    const messengers = [];
    if (phoneDigits) {
      messengers.push({ type: 'whatsapp', phone: phoneDigits, label: 'Написать в WhatsApp' });
    }
    const tgMatch = messengersRaw.match(/(?:https?:\/\/t\.me\/|@)([a-zA-Z0-9_+]+)/i);
    if (tgMatch) {
      const tgHref = tgMatch[0].startsWith('http') ? tgMatch[0] : `https://t.me/${tgMatch[1]}`;
      messengers.push({ type: 'telegram', href: tgHref, label: 'Написать в Telegram' });
    }
    const vkMatch = messengersRaw.match(/https?:\/\/(?:vk\.com|vk\.ru)\/[a-zA-Z0-9_.-]+/i);
    if (vkMatch) {
      messengers.push({ type: 'max', href: vkMatch[0], label: 'Группа ВКонтакте' });
    }

    const rawServices = (entry['основные услуги'] || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const rawPrices = entry['цены'] || '';
    const services = [];

    if (rawServices.length) {
      for (const item of rawServices) {
        const cleanTitle = item.charAt(0).toUpperCase() + item.slice(1);
        let price = 'от 1 500 ₽';
        const priceRe = new RegExp(cleanTitle.slice(0, 4), 'i');
        const priceItem = rawPrices.split(/[,;]/).find((p) => priceRe.test(p));
        if (priceItem) {
          const mPrice = priceItem.match(/(\d[\d\s]*\s*₽(?:\/[а-яА-ЯёЁ²]+)?)/);
          if (mPrice) price = (priceItem.includes('от') ? 'от ' : '') + mPrice[1].trim();
        }
        services.push({
          title: cleanTitle,
          price,
          desc: 'Глубокая экстракторная чистка, выведение пятен и нейтрализация запахов',
        });
      }
    } else {
      services.push(
        { title: 'Химчистка прямого дивана', price: 'от 2 500 ₽', desc: 'Удаление засаленности, пятен и запахов' },
        { title: 'Химчистка углового дивана', price: 'от 3 500 ₽', desc: 'Глубокая экстракция всех секций и подушек' },
        { title: 'Химчистка матраса', price: 'от 2 000 ₽', desc: 'Двусторонняя очистка и антибактериальная обработка' },
        { title: 'Химчистка кресла', price: 'от 1 200 ₽', desc: 'Очистка сиденья, спинки и подлокотников' }
      );
    }

    const rawFeatures = entry['фишки'] || entry['фишки из отзывов'] || '';
    const features = rawFeatures.split(/[;.]/).map((f) => f.trim()).filter((f) => f.length > 5);
    if (!features.length) {
      features.push('Выезд мастера в день обращения', 'Гипоаллергенная европейская химия', 'Оплата после проверки результата');
    }

    const ratingRaw = entry['рейтинг'] || '4.9';
    const ratingMatch = ratingRaw.match(/(\d+[.,]\d+)/);
    const rating = ratingMatch ? ratingMatch[1].replace(',', '.') : '4.9';
    const reviewsMatch = ratingRaw.match(/(\d+)\s*(?:отзыв|оцен)/i);
    const reviewsCount = reviewsMatch ? reviewsMatch[1] : '18';

    const city = entry['город'] || 'Москва';
    const address = entry['адрес'] || 'Выезд по городу';
    const mapUrl = entry['источник'] || entry['ссылка на 2гис'] || '';

    const jsonData = {
      slug,
      name: rawName,
      title: `${rawName} — Химчистка мебели в ${city === 'Москва' ? 'Москве' : city}`,
      city,
      address,
      schedule: entry['график'] || 'Ежедневно с 8:00 до 22:00',
      map_url: mapUrl,
      rating,
      reviews_count: reviewsCount,
      badge: 'Выездная химчистка',
      phones,
      messengers,
      services,
      features,
      steps: [
        { title: '1. Осмотр и подбор химии', text: 'Мастер определяет состав ткани и характер пятен, подбирая безопасный состав.' },
        { title: '2. Экстракторная чистка', text: 'Раствор подаётся под давлением и вместе с грязью сразу затягивается вакуумом.' },
        { title: '3. Удаление пятен и запахов', text: 'Сложные пятна и запахи прорабатываются точечно спецсоставами.' },
        { title: '4. Промывка и нейтрализация', text: 'Обивка промывается ополаскивателем, чтобы в ткани не осталось чистящих средств.' },
      ],
    };

    fs.writeFileSync(path.join(CONTENT_DIR, `${slug}.json`), JSON.stringify(jsonData, null, 2), 'utf8');
  }
}

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
    if (ctx.length > 1) return undefined;
    return '';
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

const LINK_TAG = '<link rel="stylesheet" href="style.css">';

function inlineCss(html) {
  let css = fs.readFileSync(path.join(TEMPLATE_DIR, 'style.css'), 'utf8');
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

// ---------- Подготовка данных под химчистку ----------

function prepare(data, file) {
  const defaults = {
    city: 'Москва',
    address: 'Выезд по городу',
    schedule: 'Ежедневно',
    phones: [],
    messengers: [],
    services: [],
    features: [],
    steps: [],
    faq: [],
    rating: '4.9',
    reviews_count: '20',
    map_url: '',
    badge: 'Выездная химчистка',
  };
  data = Object.assign({}, defaults, data);

  for (const k of REQUIRED) {
    if (!isFilled(data[k])) throw new Error(`${file}: обязательное поле «${k}» пустое`);
  }

  const nbsp = (v) => String(v).replace(/(\d) (?=\d)/g, '$1\u00A0').replace(/ ₽/g, '\u00A0₽');
  for (const key of ['prices', 'services']) {
    if (Array.isArray(data[key])) data[key] = data[key].map((p) => (p.price ? { ...p, price: nbsp(p.price) } : p));
  }

  if (Array.isArray(data.services)) {
    data.services = data.services.map((sv) => {
      const icon = sv.icon || serviceIcon(sv.title);
      const groupMatch = SERVICE_GROUPS.find(([, , icons]) => icons.includes(icon));
      return { ...sv, icon, group: groupMatch ? groupMatch[0] : 'other' };
    });
  }

  const groups = SERVICE_GROUPS.map(([id, label]) => ({
    id,
    label,
    count: String((data.services || []).filter((sv) => sv.group === id).length),
  })).filter((g) => g.count !== '0');
  data.service_groups = groups.length >= 2 ? groups : [];
  data.services_count = String((data.services || []).length);

  data.route_url = data.map_url || '';
  data.yandex_url = data.address
    ? 'https://yandex.ru/maps/?text=' + encodeURIComponent([data.city, data.address].filter(Boolean).join(', '))
    : '';

  data.messengers = (Array.isArray(data.messengers) ? data.messengers : []).map(messenger);
  data.chat_links = data.messengers.filter((m) => m.link);
  const copy = copyTexts(data);
  data.copy_label = copy.label;
  data.copy_toast = copy.toast;
  if (!Array.isArray(data.faq) || !data.faq.length) data.faq = buildFaq(data);
  return data;
}

const MESSENGERS = {
  whatsapp: { name: 'WhatsApp', icon: 'i-chat', url: (d) => `https://wa.me/${d}` },
  telegram: { name: 'Telegram', icon: 'i-send', url: null },
  max: { name: 'Max', icon: 'i-chat', url: null },
};

function messenger(m) {
  const kind = MESSENGERS[m.type];
  if (!kind) return { type: '', name: '', icon: 'i-chat', send_label: m.label, link: true, ...m };
  const digits = String(m.phone || '').replace(/\D/g, '');
  const href = m.href || (kind.url ? kind.url(digits) : '');
  return {
    ...m,
    href,
    link: Boolean(href),
    label: m.label || `Написать в ${kind.name}`,
    send_label: `Отправить в ${kind.name}`,
    icon: kind.icon,
    name: kind.name,
  };
}

function copyTexts(data) {
  const names = ['max', 'telegram']
    .filter((t) => data.messengers.some((m) => m.type === t && !m.link))
    .map((t) => MESSENGERS[t].name);
  const phone = (data.phones || [])[0] ? data.phones[0].value.replace(/ /g, '\u00A0').replace(/-/g, '\u2011') : '';
  if (!names.length) {
    return { label: 'Скопировать заявку', toast: 'Заявка скопирована! Вставьте её в чат или назовите мастеру.' };
  }
  const where = names.length === 1 ? `чат ${names[0]} или мессенджер` : `чат ${names.join(' или ')}`;
  return {
    label: `Скопировать для ${names.join(' / ')}`,
    toast: `Заявка скопирована! Вставьте её в ${where}${phone ? ` по номеру ${phone}` : ''}`,
  };
}

// Ответы FAQ для химчистки
function buildFaq(data) {
  const contact = (data.phones || []).length ? 'по телефону или в мессенджере' : 'при записи';
  return [
    {
      q: 'Безопасна ли химия для детей и домашних животных?',
      a: 'Да. Используются сертифицированные гипоаллергенные средства европейских брендов. После чистки обивка промывается нейтрализатором, удаляющим остатки химии.',
    },
    {
      q: 'Сколько сохнет мебель после химчистки?',
      a: 'В среднем 4–8 часов при обычной температуре в комнате. После высыхания ткань остаётся чистой, мягкой и без химического запаха.',
    },
    {
      q: 'Называете ли вы точную стоимость до выезда мастера?',
      a: `Да, точная сумма согласуется по фото мебели ${contact} до выезда и не меняется на месте.`,
    },
    {
      q: 'Что нужно подготовить к приезду мастера?',
      a: 'Только доступ к розетке и чистой воде. Всё оборудование (экстракторы, насадки) и химию специалист привозит с собой.',
    },
    {
      q: 'Удаляются ли застарелые пятна и резкие запахи?',
      a: 'Удаляется большинство бытовых загрязнений (пятна от еды, чая, следы засаленности) и запахи (включая запахи животных) с помощью специальных энзимных пятновыводителей.',
    },
  ];
}

const SERVICE_GROUPS = [
  ['sofa', 'Диваны и матрасы', ['sofa', 'mattress', 'armchair']],
  ['carpet', 'Ковры и текстиль', ['carpet', 'curtains']],
  ['other', 'Стулья и доп. услуги', ['chair', 'smell', 'auto', 'clean']],
];

const SERVICE_ICONS = [
  ['mattress', /матрас/i],
  ['carpet', /ковер|ковёр|ковролин|палас|покрыти/i],
  ['curtains', /штор|портьер/i],
  ['smell', /запах|моч|пятн|клещ|озонир/i],
  ['armchair', /кресл/i],
  ['chair', /стул|пуф|банкетк/i],
  ['auto', /авто|салон/i],
  ['sofa', /диван|уголок|мебел/i],
  ['clean', /чистк|химчист|мойк|аквачист/i],
];

function serviceIcon(title) {
  const hit = SERVICE_ICONS.find(([, re]) => re.test(title || ''));
  return hit ? hit[0] : 'clean';
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
  syncFromMarkdown();

  const template = parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf8'));
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('В content/ нет JSON-файлов и local_businesses.md пуст');

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
    console.log(`✓ site/${data.slug}/index.html (${Math.round(Buffer.byteLength(html) / 1024)} КБ)`);
  }

  fs.writeFileSync(path.join(SITE_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.writeFileSync(path.join(SITE_DIR, '.nojekyll'), '');
  const index = inlineCss(indexPage());
  verify(index, 'site/index.html');
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), index);
  console.log(`\n✓ Готово! Собрано сайтов: ${built.length}.`);
}

function indexPage() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>Демо-концепт</title>
  ${LINK_TAG}
</head>
<body>
  <div class="demo-bar" role="note"><p class="demo-bar__text">${DEMO_TEXT}</p></div>
  <main class="stub">
    <h1 class="stub__title">Страница открывается по прямой ссылке</h1>
    <p class="stub__text">Каждый демо-сайт доступен только по своему адресу.</p>
  </main>
  <footer class="footer">
    <div class="demo-plate" role="note">
      <p class="demo-plate__title">${DEMO_TEXT}</p>
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
