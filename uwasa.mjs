const {
  GITHUB_API_URL,
  GITHUB_REPOSITORY,
  UWASA_GH_TOKEN,
  UWASA_ANNOUNCEMENTS,
  UWASA_AVATAR,
  UWASA_NAME,
  UWASA_ORIGINS,
  UWASA_WEBHOOK,
  UWASA_RE_MAINTENANCE,
  UWASA_RE_APPVERSION,
  UWASA_RE_MAGIREPO,
  UWASA_LAST,
  UWASA_ETAG,
} = Bun.env;

const ORIGINS = UWASA_ORIGINS.split('|');
const [ORIGIN] = ORIGINS;
const USER_AGENT = 'UoSM';
const DISCORD_META = Object.freeze({
  username: UWASA_NAME,
  avatar_url: UWASA_AVATAR,
});
const NOT_MODIFIED = Symbol('NOT_MODIFIED');

const writeJSON = async (url, data) => Bun.write(url, JSON.stringify(data, null, 1));

const updateVariable = async ([name, value]) =>
  fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/variables/${name}`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${UWASA_GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ value }),
  }).then(({ ok, status }) => {
    if (!ok) throw status;
  });

class announcements {
  static id = UWASA_LAST |0;
  constructor() {
    return getAnnouncements()
      .then(data => data.filter(({ id }) => id > this.constructor.id));
  }
}

// TODO: remove this if variable method is stable
//const last = new URL('last.json', import.meta.url);
//let { default: { id = 0, etag = '' } } = await import(last, { assert: { type: 'json' } });

let id = announcements.id;
let etag = UWASA_ETAG ?? '';

console.info('get', { id, etag });

const getResponse = async () => {
  return Promise.any(ORIGINS.map(async $ => {
    const response = await fetch(new URL(UWASA_ANNOUNCEMENTS, $), {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip',
        'If-None-Match': etag,
      },
      signal: AbortSignal.timeout(9999),
    });
    if (response.status === 304)
      return NOT_MODIFIED;
    if (!response.ok)
      throw new Error('Bad response', { cause: response.status });
    if (!response.headers.get('Content-Type')?.startsWith('application/json')) {
      // Assume:
      // Last-Modified: Mon, 26 Nov 2018 06:45:05 GMT
      // Content-Type: text/html
      // Content-Length: 6351 # not included but whatever
      throw Error;
    }
    return response;
  }));
};

const getAnnouncements = async () => {
  const response = await getResponse();
  if (response === NOT_MODIFIED)
    return console.info('skip'), [{ id }];

  const data = await response.json();
  etag = response.headers.get('ETag');
  await Promise.all(data.map(item => {
    if (item.id > id) id = item.id;
    return writeJSON(new URL(`announcements/${item.id}.json`, import.meta.url), item);
  }));

  // TODO: remove this if variable method is stable
  //await writeJSON(last, { id, etag });

  // TODO: move this down so it triggers only at full success
  console.info('set', { id, etag });
  await Promise.all(Object.entries({
    LAST: `${id}`,
    ETAG: etag,
  }).map(updateVariable));

  return data;
};

const normalDate = (y, m, d, ...t) => Date.UTC(+y, +m -1, +d, ...t) /1000 -32400;

const parseCategory = async (news, cat, re, maxId = announcements.id) =>
  news
    .filter(({ category }) => category === cat)
    .map(({ id, text }) => ({ id, parsed: re.exec(text) }))
    .filter(({ parsed }) => parsed?.groups)
    .reduce(($, { id, parsed: { groups } }) => id > maxId ? (maxId = id, groups) : $, null);

const postDiscord = async (
  content = null,
  webhook = UWASA_WEBHOOK,
) =>
  content && fetch(new URL(webhook, 'https://discord.com/api/webhooks/'), {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      ...typeof content === 'string' ? { content } : content,
      ...DISCORD_META,
    }),
  });

const postMaintenance = async news => {
  const m = await parseCategory(news, 'MNT', new RegExp(UWASA_RE_MAINTENANCE));
  if (!m)
    return false;

  const startDate = normalDate(m.year, m.month, m.day, m.startHour, m.startMinute);
  const endDate = normalDate(m.year, m.month, m.day, m.endHour, m.endMinute);

  const message = `Maintenance scheduled to start at <t:${startDate}:f> (<t:${startDate}:R>) and end at <t:${endDate}:t> (<t:${endDate}:R>).`;

  return postDiscord(message);
};

const postAppVersion = async news => {
  const m = await parseCategory(news, 'UPD', new RegExp(UWASA_RE_APPVERSION));
  if (!m)
    return false;

  const mandatoryDate = normalDate(m.year, m.month, m.day, m.hour, m.minute);

  const message = `New app version available: \`${m.version}\`. It becomes mandatory on <t:${mandatoryDate}:f> (<t:${mandatoryDate}:R>).`;

  return postDiscord(message);
};

const postMagiRepo = async news => {
  const m = await parseCategory(news, 'NEW', new RegExp(UWASA_RE_MAGIREPO, 's'));
  if (!m)
    return false;

  const message = `Magia Report Issue \`#${m.issue}\` is available!`;

  return postDiscord({
    content: message,
    embeds: [{ image: { url: new URL(m.url, ORIGIN).href } }],
  });
};

const tick = async () => {
  const news = await new announcements;

  return news?.length ? Promise.all([
    postMaintenance(news),
    postAppVersion(news),
    postMagiRepo(news),
  ])
    .then(() => announcements.id = Math.max(announcements.id, ...news.map(({ id }) => id))) : false;
};

const lastId = await tick();

await Bun.write(Bun.stdout, `
UWASA_LAST=${lastId}
UWASA_ETAG=${etag}
`);
