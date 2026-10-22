import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const USER = "y-a-v-a";
const HANDLE = "vincent";
const W = 58;
const TOKEN = process.env.GITHUB_TOKEN;

const FACTS = [
  ["Kernel", "visual artist, coding since 2005"],
  ["Shell", "Claude Code, Codex, Pi"],
  ["Role", "Claude Community Ambassador"],
];

const PALETTES = {
  dark: {
    bg: "#0d1117", border: "#30363d", grout: "#010409", h: "#58a6ff", k: "#ffa657",
    v: "#c9d1d9", d: "#484f58", m: "#8b949e", g: "#3fb950", bar: "#26a641",
  },
  light: {
    bg: "#ffffff", border: "#d0d7de", grout: "#1f2328", h: "#0969da", k: "#953800",
    v: "#24292f", d: "#afb8c1", m: "#57606a", g: "#1a7f37", bar: "#2da44e",
  },
};

const FONT = `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;
const ART = { x: 24, y: 24, size: 296, grout: 5 };
const TEXT_X = 356;
const LINE = 21;

async function graphql(query, variables = {}, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": USER },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status >= 500 && attempt < attempts) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`GraphQL ${res.status}: ${await res.text()}`);
    const body = await res.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    return body.data;
  }
}

const REPOS_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 50, after: $cursor, ownerAffiliations: OWNER, privacy: PUBLIC) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name isFork isArchived stargazerCount createdAt pushedAt
        languages(first: 50) { edges { size node { name color } } }
      }
    }
  }
}`;

async function fetchRepos() {
  const repos = [];
  let cursor = null;
  let total;
  do {
    const page = (await graphql(REPOS_QUERY, { login: USER, cursor })).user.repositories;
    total = page.totalCount;
    repos.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  assert.equal(repos.length, total, "repository pagination incomplete");
  return repos;
}

async function fetchProfile() {
  const { user } = await graphql(
    `query($login: String!) { user(login: $login) { createdAt location followers { totalCount } } }`,
    { login: USER },
  );
  const joinYear = Number(user.createdAt.slice(0, 4));
  const thisYear = new Date().getUTCFullYear();
  const aliases = [];
  for (let y = joinYear; y <= thisYear; y++) {
    aliases.push(`y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
      totalPullRequestContributions
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }`);
  }
  const years = (await graphql(`query($login: String!) { user(login: $login) { ${aliases.join("\n")} } }`, { login: USER })).user;
  return { user, years };
}

async function fetchStats(today) {
  const [repos, { user, years }] = await Promise.all([fetchRepos(), fetchProfile()]);
  const own = repos.filter((r) => !r.isFork);
  const thisYear = today.slice(0, 4);

  const perYear = Object.entries(years).map(([k, v]) => ({
    year: Number(k.slice(1)),
    contributions: v.contributionCalendar.totalContributions,
    prs: v.totalPullRequestContributions,
  }));
  const days = new Map();
  for (const v of Object.values(years)) {
    for (const w of v.contributionCalendar.weeks) for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
  }

  return {
    today,
    joined: user.createdAt.slice(0, 10),
    location: user.location,
    followers: user.followers.totalCount,
    repos: own.length,
    forks: repos.length - own.length,
    newRepos: own.filter((r) => r.createdAt.startsWith(thisYear)).length,
    stars: own.reduce((n, r) => n + r.stargazerCount, 0),
    contributions: perYear.reduce((n, y) => n + y.contributions, 0),
    prs: perYear.reduce((n, y) => n + y.prs, 0),
    perYear,
    ...streaks(days, today),
    languages: rankLanguages(own),
    recent: own
      .filter((r) => !r.isArchived && r.name !== USER)
      .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
      .slice(0, 5)
      .map((r) => r.name),
  };
}

function rankLanguages(repos) {
  const langs = new Map();
  for (const r of repos) {
    for (const { size, node } of r.languages.edges) {
      const l = langs.get(node.name) ?? { name: node.name, color: hexOr(node.color, "#8b949e"), repos: 0, bytes: 0 };
      l.repos += 1;
      l.bytes += size;
      langs.set(node.name, l);
    }
  }
  return [...langs.values()].sort((a, b) => b.repos - a.repos || b.bytes - a.bytes || a.name.localeCompare(b.name));
}

const hexOr = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c.toLowerCase() : fallback);

function streaks(days, today) {
  let best = 0;
  let run = 0;
  for (const date of [...days.keys()].sort()) {
    if (date > today) break;
    run = days.get(date) > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const d = new Date(`${today}T00:00:00Z`);
  if (!(days.get(today) > 0)) d.setUTCDate(d.getUTCDate() - 1);
  let current = 0;
  while (days.get(d.toISOString().slice(0, 10)) > 0) {
    current++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return { streak: current, bestStreak: best };
}

function age(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const years = ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
  const months = (tm - fm - (td < fd ? 1 : 0) + 12) % 12;
  const daysInPrevMonth = new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate();
  const days = td >= fd ? td - fd : daysInPrevMonth - fd + td;
  return { years, months, days };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const weightOf = (items) => items.reduce((n, it) => n + it.weight, 0);

function split(items, x, y, w, h, rand, out) {
  if (items.length === 1) {
    out.push({ ...items[0], x, y, w, h });
    return;
  }
  const total = weightOf(items);
  const target = total * (0.35 + rand() * 0.3);
  let i = 1;
  let acc = items[0].weight;
  while (i < items.length - 1 && Math.abs(acc + items[i].weight - target) < Math.abs(acc - target)) {
    acc += items[i++].weight;
  }
  let [a, b] = [items.slice(0, i), items.slice(i)];
  if (rand() < 0.5) [a, b] = [b, a];
  const f = weightOf(a) / total;
  if (w > h * (0.85 + rand() * 0.3)) {
    split(a, x, y, w * f, h, rand, out);
    split(b, x + w * f, y, w * (1 - f), h, rand, out);
  } else {
    split(a, x, y, w, h * f, rand, out);
    split(b, x, y + h * f, w, h * (1 - f), rand, out);
  }
}

function compose(items, size, seed, minSide = ART.grout + 11) {
  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  let best;
  for (let attempt = 0; attempt < 200; attempt++) {
    const blocks = [];
    split(sorted, 0, 0, size, size, mulberry32(seed + attempt * 7919), blocks);
    const score = Math.min(...blocks.map((b) => Math.min(b.w, b.h)));
    if (!best || score > best.score) best = { blocks, score };
    if (score >= minSide) break;
  }
  return best.blocks;
}

const daySeed = (date) => Number(date.replaceAll("-", ""));

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (n) => n.toLocaleString("en-US");
const r1 = (n) => Math.round(n * 10) / 10;

function kv(key, val, width = W) {
  const room = width - key.length - 4;
  const v = String(val).length > room ? `${String(val).slice(0, room - 1)}…` : String(val);
  const dots = ".".repeat(Math.max(width - key.length - v.length - 3, 1));
  return [[`${key}: `, "k"], [`${dots} `, "d"], [v, "v"]];
}

const kv2 = (k1, v1, k2, v2) => [...kv(k1, v1, 30), [" | ", "d"], ...kv(k2, v2, W - 33)];

function rule(title = "") {
  const label = title ? `─ ${title} ` : "";
  return [[label, "h"], ["─".repeat(W - label.length), "d"]];
}

function fitList(names, room) {
  const out = [];
  for (const n of names) {
    if ([...out, n].join(", ").length > room) break;
    out.push(n);
  }
  return out.join(", ");
}

function infoLines(s) {
  const up = age(s.joined, s.today);
  const year = s.today.slice(0, 4);
  return [
    [[`${HANDLE}@${USER} `, "h"], ["─".repeat(W - HANDLE.length - USER.length - 2), "d"]],
    [],
    kv("Uptime", `${plural(up.years, "year")}, ${plural(up.months, "month")}, ${plural(up.days, "day")} on GitHub`),
    ...FACTS.map(([k, v]) => kv(k, v)),
    ...(s.location ? [kv("Location", s.location)] : []),
    [],
    rule("GitHub Stats"),
    kv2("Repos", `${s.repos} {+${s.forks} forks}`, "Stars", num(s.stars)),
    kv2("Contributions", num(s.contributions), "Followers", num(s.followers)),
    kv2("Pull requests", num(s.prs), "Languages", s.languages.length),
    kv2(`New repos ${year}`, s.newRepos, "Streak", `${s.streak}d {best ${s.bestStreak}d}`),
    kv("Recently pushed", fitList(s.recent, W - "Recently pushed".length - 5)),
    [],
    rule("Contributions per year"),
  ];
}

function renderArt(s, p) {
  const { x, y, size, grout } = ART;
  const items = s.languages.map((l) => ({ ...l, weight: l.repos }));
  const blocks = compose(items, size, daySeed(s.today));
  const out = [`<rect x="${x - grout / 2}" y="${y - grout / 2}" width="${size + grout}" height="${size + grout}" fill="${p.grout}"/>`];
  for (const b of blocks) {
    out.push(
      `<rect x="${r1(x + b.x + grout / 2)}" y="${r1(y + b.y + grout / 2)}" width="${r1(b.w - grout)}" height="${r1(b.h - grout)}" ` +
        `fill="${b.color}"${outline(b.color, p)}><title>${esc(b.name)}: ${plural(b.repos, "repo")}</title></rect>`,
    );
  }
  return out;
}

const outline = (color, p) => (contrast(color, p.grout) < 1.4 ? ` stroke="${p.m}" stroke-width="1"` : "");

function renderLegend(s, p, top) {
  const out = [];
  const shown = s.languages.slice(0, 12);
  const colW = ART.size / 2;
  shown.forEach((l, i) => {
    const cx = ART.x + Math.floor(i / 6) * (colW + 4);
    const cy = top + (i % 6) * 20;
    out.push(
      `<rect x="${cx}" y="${cy - 10}" width="11" height="11" fill="${l.color}"${outline(l.color, p)}/>`,
      `<text x="${cx + 18}" y="${cy}" fill="${p.v}">${esc(l.name)}</text>`,
      `<text x="${cx + colW - 12}" y="${cy}" fill="${p.m}" text-anchor="end">${l.repos}</text>`,
    );
  });
  const rest = s.languages.length - shown.length;
  const caption = `${rest > 0 ? `+${rest} more · ` : ""}repos per language`;
  out.push(`<text x="${ART.x}" y="${top + 6 * 20 + 4}" fill="${p.m}" font-size="12px">${esc(caption)}</text>`);
  return out;
}

function renderBars(s, p, top, bottom) {
  const left = TEXT_X;
  const width = W * 7.8;
  const slot = width / s.perYear.length;
  const barW = Math.max(slot * 0.62, 2);
  const max = Math.max(...s.perYear.map((y) => y.contributions), 1);
  const height = bottom - top - 20;
  const last = s.perYear.at(-1).year;
  const out = [`<line x1="${left}" y1="${bottom - 20}" x2="${r1(left + width)}" y2="${bottom - 20}" stroke="${p.border}"/>`];
  s.perYear.forEach((y, i) => {
    const h = (y.contributions / max) * height;
    const bx = left + i * slot + (slot - barW) / 2;
    out.push(
      `<rect x="${r1(bx)}" y="${r1(bottom - 20 - h)}" width="${r1(barW)}" height="${r1(h)}" fill="${p.bar}" rx="1.5">` +
        `<title>${y.year}: ${num(y.contributions)} contributions</title></rect>`,
    );
    if ((last - y.year) % 4 === 0) {
      out.push(`<text x="${r1(bx + barW / 2)}" y="${bottom}" fill="${p.m}" font-size="12px" text-anchor="middle">${y.year}</text>`);
    }
    if (y.contributions >= max / 4) {
      const label = y.year === last ? `${num(y.contributions)} so far` : num(y.contributions);
      out.push(`<text x="${r1(bx + barW)}" y="${r1(bottom - 26 - h)}" fill="${p.v}" font-size="12px" text-anchor="end">${label}</text>`);
    }
  });
  return out;
}

const CARD = { w: 840, h: 520 };

function render(mode, s) {
  const p = PALETTES[mode];
  const lines = infoLines(s);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.w}" height="${CARD.h}" viewBox="0 0 ${CARD.w} ${CARD.h}" font-family='${FONT}' font-size="13px">`,
    `<title>${esc(`${HANDLE}@${USER}: ${s.repos} repos, ${s.languages.length} languages, ${num(s.contributions)} contributions`)}</title>`,
    `<rect x="0.5" y="0.5" width="${CARD.w - 1}" height="${CARD.h - 1}" rx="10" fill="${p.bg}" stroke="${p.border}"/>`,
    ...renderArt(s, p),
    ...renderLegend(s, p, ART.y + ART.size + 30),
  ];
  lines.forEach((segs, i) => {
    if (!segs.length) return;
    const spans = segs.map(([t, c]) => `<tspan fill="${p[c]}">${esc(t)}</tspan>`).join("");
    out.push(`<text x="${TEXT_X}" y="${40 + i * LINE}" xml:space="preserve">${spans}</text>`);
  });
  out.push(...renderBars(s, p, 40 + lines.length * LINE - 4, CARD.h - 22));
  out.push("</svg>");
  return out.join("\n");
}

function selfcheck() {
  assert.deepEqual(age("2010-08-25", "2026-10-22"), { years: 16, months: 1, days: 27 });
  assert.deepEqual(age("2000-03-31", "2026-04-01"), { years: 26, months: 0, days: 1 });
  assert.deepEqual(age("2000-01-01", "2026-01-01"), { years: 26, months: 0, days: 0 });
  assert.equal(kv("Kernel", "visual artist").map(([t]) => t).join("").length, W);
  assert.equal(kv2("Repos", "1", "Stars", "2").map(([t]) => t).join("").length, W);
  assert.equal(kv("Location", "x".repeat(80)).map(([t]) => t).join("").length, W);

  const days = new Map([["2026-01-01", 1], ["2026-01-02", 3], ["2026-01-03", 0], ["2026-01-04", 2], ["2026-01-05", 0]]);
  assert.deepEqual(streaks(days, "2026-01-05"), { streak: 1, bestStreak: 2 });
  assert.deepEqual(streaks(days, "2026-01-03"), { streak: 2, bestStreak: 2 });

  const items = [5, 3, 1, 1, 8].map((weight, i) => ({ name: `l${i}`, weight }));
  const blocks = compose(items, 100, 20261022);
  assert.equal(blocks.length, items.length);
  for (const b of blocks) assert.ok(Math.abs((b.w * b.h) / 10000 - b.weight / 18) < 1e-9, "block area must match weight");
}

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

selfcheck();
const today = new Date().toISOString().slice(0, 10);
const stats = await fetchStats(today);
assert.ok(stats.repos > 0 && stats.languages.length > 0, "no public repositories returned");
console.log("stats:", JSON.stringify({ ...stats, perYear: stats.perYear.map((y) => `${y.year}:${y.contributions}`).join(" "), languages: stats.languages.map((l) => `${l.name}:${l.repos}`).join(" ") }));
const files = Object.keys(PALETTES).map((mode) => [`stats-${mode}.svg`, render(mode, stats)]);
for (const [name, svg] of files) writeFileSync(name, svg);
console.log(`wrote ${files.map(([name]) => name).join(", ")}`);
