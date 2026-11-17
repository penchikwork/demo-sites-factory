#!/usr/bin/env node
// Загрузка карточек организаций из официального Catalog API 2ГИС.
// Берёт ID из ссылок в local_businesses.md, сохраняет ответы API в data/2gis/{id}.json
// и переписывает в local_businesses.md раздел «Данные 2ГИС» (между маркерами).
//
// Ключ API в репозитории не хранится — только в переменной окружения:
//   DGIS_KEY=ваш-ключ node scripts/fetch-2gis.js
// Без зависимостей, Node 18+ (глобальный fetch).

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIST = path.join(ROOT, 'local_businesses.md');
const RAW_DIR = path.join(ROOT, 'data', '2gis');
const API = 'https://catalog.api.2gis.com/3.0/items/byid';
const FIELDS = [
  'items.point', 'items.address', 'items.contact_groups', 'items.schedule',
  'items.reviews', 'items.rubrics', 'items.attribute_groups', 'items.full_address_name', 'items.adm_div',
].join(',');
const START = '<!-- 2gis:start — раздел генерирует scripts/fetch-2gis.js, руками не править -->';
const END = '<!-- 2gis:end -->';

const KEY = process.env.DGIS_KEY;
if (!KEY) {
  console.error('✗ Нет ключа: запустите как DGIS_KEY=… node scripts/fetch-2gis.js');
  process.exit(1);
}

const DAYS = [
  ['Mon', 'Пн'], ['Tue', 'Вт'], ['Wed', 'Ср'], ['Thu', 'Чт'], ['Fri', 'Пт'], ['Sat', 'Сб'], ['Sun', 'Вс'],
];

// Ключ не должен попасть ни в файлы, ни в логи.
const scrub = (s) => String(s).split(KEY).join('***');

async function fetchItem(id) {
  const url = `${API}?id=${id}&fields=${FIELDS}&key=${encodeURIComponent(KEY)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.meta?.code !== 200) {
    const msg = body?.meta?.error?.message || `HTTP ${res.status}`;
    throw new Error(scrub(msg));
  }
  const item = body.result?.items?.[0];
  if (!item) throw new Error('организация не найдена');
  return item;
}

function scheduleLines(schedule) {
  if (!schedule) return [];
  if (schedule.is_24x7) return ['Круглосуточно'];
  return DAYS.map(([en, ru]) => {
    const d = schedule[en];
    const hours = d?.working_hours?.map((h) => `${h.from}–${h.to}`).join(', ');
    return `${ru}: ${hours || 'выходной'}`;
  });
}

function summarize(id, item) {
  const contacts = (item.contact_groups || []).flatMap((g) => g.contacts || []);
  const phones = contacts.filter((c) => c.type === 'phone').map((c) => c.text || c.value);
  const sites = contacts
    .filter((c) => c.type !== 'phone' && c.type !== 'email')
    .map((c) => `${c.type}: ${c.text || c.url || c.value}`);
  const r = item.reviews || {};
  const city = (item.adm_div || []).find((a) => a.type === 'city')?.name;
  const lines = [
    `### ${item.name || `ID ${id}`}`,
    `- ID 2ГИС: ${id}`,
    `- Ссылка: https://2gis.ru/firm/${id}`,
    `- Город: ${city || '—'}`,
    `- Адрес: ${item.address_name || '—'}${item.address_comment ? ` (${item.address_comment})` : ''}`,
    `- Индекс: ${item.address?.postcode || '—'}`,
    `- Телефоны: ${phones.join(', ') || (item.contact_groups ? '—' : 'API не вернул контакты')}`,
    `- Сайт и соцсети: ${sites.join(', ') || (item.contact_groups ? '—' : 'API не вернул контакты')}`,
    // general_review_count — отзывы с текстом, general_review_count_with_stars — все оценки
    `- Рейтинг: ${r.general_rating ?? '—'}; отзывов: ${r.general_review_count ?? '—'}; оценок: ${r.general_review_count_with_stars ?? '—'}`,
    `- Рубрики: ${(item.rubrics || []).map((x) => x.name).join(', ') || '—'}`,
  ];
  for (const g of item.attribute_groups || []) {
    const names = (g.attributes || []).map((a) => a.name).filter(Boolean);
    if (names.length) lines.push(`- ${g.name || 'Атрибуты'}: ${names.join(', ')}`);
  }
  const sched = scheduleLines(item.schedule);
  lines.push(`- График: ${sched.join('; ') || '—'}`);
  if (item.schedule?.comment) lines.push(`- Комментарий к графику: ${item.schedule.comment}`);
  return lines.join('\n');
}

async function main() {
  const md = fs.readFileSync(LIST, 'utf8');
  const ids = [...new Set([...md.matchAll(/2gis\.ru\/[a-z_]+\/(?:geo|firm)\/(\d{10,})/g)].map((m) => m[1]))];
  if (!ids.length) throw new Error('В local_businesses.md нет ссылок 2ГИС');

  fs.mkdirSync(RAW_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const blocks = [];
  for (const id of ids) {
    try {
      const item = await fetchItem(id);
      fs.writeFileSync(path.join(RAW_DIR, `${id}.json`), JSON.stringify({ fetched: date, item }, null, 2) + '\n');
      blocks.push(summarize(id, item));
      console.log(`✓ ${id} — ${item.name}`);
    } catch (err) {
      blocks.push(`### ID ${id}\n- Не удалось получить данные: ${err.message}`);
      console.error(`✗ ${id} — ${err.message}`);
    }
  }

  const section = [
    START,
    `## Данные 2ГИС (Catalog API, ${date})`,
    '',
    'Сырые ответы API — в `data/2gis/{id}.json`. Тексты отзывов API не отдаёт, только рейтинг и счётчики. Телефоны и сайты (`contact_groups`) для этого ключа API не возвращает.',
    '',
    blocks.join('\n\n'),
    END,
  ].join('\n');
  const re = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}`);
  const out = re.test(md) ? md.replace(re, () => section) : `${md.trimEnd()}\n\n${section}\n`;
  fs.writeFileSync(LIST, out);
  console.log(`local_businesses.md обновлён: ${ids.length} организаций`);
}

main().catch((err) => {
  console.error(`✗ ${scrub(err.message)}`);
  process.exit(1);
});
