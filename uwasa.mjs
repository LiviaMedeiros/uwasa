const {
  UWASA_ANNOUNCEMENTS,
  UWASA_AVATAR,
  UWASA_NAME,
  UWASA_ORIGIN,
  UWASA_WEBHOOK,
} = Bun.env;

const PATH_TO_ANNOUNCEMENTS_FILE = new URL(UWASA_ANNOUNCEMENTS, UWASA_ORIGIN);
const USER_AGENT = 'UoSM';
const WEBHOOK_URL = new URL(UWASA_WEBHOOK, 'https://discord.com/api/webhooks/');
const DISCORD_META = Object.freeze({
  username: UWASA_NAME,
  avatar_url: UWASA_AVATAR,
});

const writeJSON = async (url, data) => Bun.write(url, JSON.stringify(data, null, 1));

class announcements {
  static id = 0;
  static rMaintenance = /<p[^>]*newsHeadUnder[^>]*>[^<]*■日時[^<]*<\/p>\s*(?<year>[0-9]*)年(?<month>[0-9]*)月(?<day>[0-9]*)日(?<startHour>[0-9]*):(?<startMinute>[0-9]*)～(?<endHour>[0-9]*):(?<endMinute>[0-9]*)\s*<br \/>/;
  static rAppVersion = /バージョン(?<version>[0-9.]*)への強制アップデートは(?<year>[0-9]*)年(?<month>[0-9]*)月(?<day>[0-9]*)日(?<hour>[0-9]*):(?<minute>[0-9]*)に実施いたします。/;
  static rMagiRepo = /「マギア☆レポート[^」]*」第(?<number>[0-9]*)回を掲載いたしました.*(?<url>\/magica\/resource\/image_web\/announce\/[^"]*\.png)/s;
  constructor() {
    return getAnnouncements()
      .then(data => data.filter(({ id }) => id > announcements.id));
  }
  static async init(news = getAnnouncements()) {
    this.id = Math.max(this.id, ...(await news).map(({ id }) => id));
  }
}

const last = new URL('last.json', import.meta.url);

let { default: { id = 0, etag = '' } } = await import(last, { assert: { type: 'json' } });

Object.assign(announcements, { id });

const getAnnouncements = async () => {
  const response = await fetch(PATH_TO_ANNOUNCEMENTS_FILE, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'gzip',
      'If-None-Match': etag,
    }
  });
  if (response.status === 304) return [{ id }];
  if (!(response.ok && response.headers.get('Content-Type')?.startsWith('application/json'))) throw response;
  const data = await response.json();
  etag = response.headers.get('ETag');
  await Promise.all(data.map(item => {
    if (item.id > id) id = item.id;
    return writeJSON(new URL(`announcements/${item.id}.json`, import.meta.url), item);
  }));
  await writeJSON(last, { id, etag });
  return data;
};

const normalDate = (y, m, d, ...t) => Date.UTC(+y, +m -1, +d, ...t) /1000 -32400;

const parseCategory = async (news, cat, re, maxId = announcements.id, result = null) => {
  news
    .filter(({ category }) => category === cat)
    .map(({ id, text }) => ({ id, parsed: re.exec(text) }))
    .filter(({ parsed }) => parsed?.groups)
    .forEach(({ id, parsed: { groups } }) => id > maxId && ([maxId, result] = [id, groups]));
  return result;
};

const postMaintenance = async news => {
  const m = await parseCategory(news, 'MNT', announcements.rMaintenance);
  if (!m)
    return false;

  const startDate = normalDate(m.year, m.month, m.day, m.startHour, m.startMinute);
  const endDate = normalDate(m.year, m.month, m.day, m.endHour, m.endMinute);

  const message = `Maintenance scheduled to start at <t:${startDate}:f> (<t:${startDate}:R>) and end at <t:${endDate}:t> (<t:${endDate}:R>).`;

  return postDiscord(message);
};

const postAppVersion = async news => {
  const m = await parseCategory(news, 'UPD', announcements.rAppVersion);
  if (!m)
    return false;

  const mandatoryDate = normalDate(m.year, m.month, m.day, m.hour, m.minute);

  const message = `New app version available: \`${m.version}\`. It becomes mandatory on <t:${mandatoryDate}:f> (<t:${mandatoryDate}:R>).`;

  return postDiscord(message);
};

const postMagiRepo = async news => {
  const m = await parseCategory(news, 'NEW', announcements.rMagiRepo);
  if (!m)
    return false;

  const message = `Magia Report Issue \`#${m.number}\` is available!`;

  return postDiscord({
    content: message,
    embeds: [{ image: { url: new URL(m.url, UWASA_ORIGIN).href } }]
  });
};

const postDiscord = async (
  content = null,
  webhook = WEBHOOK_URL,
) => content && fetch(
  webhook, {
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
  }
).then(response => response.text());

const tick = async () => {
  const news = await new announcements;

  return news?.length && Promise.all([
    postMaintenance(news),
    postAppVersion(news),
    postMagiRepo(news),
  ])
    .then(() => announcements.id = Math.max(announcements.id, ...news.map(({ id }) => id)));
};

const lastId = await tick();

await Bun.write(Bun.stdout, `
UWASA_LAST=${lastId}
UWASA_ETAG=${etag}
`);
