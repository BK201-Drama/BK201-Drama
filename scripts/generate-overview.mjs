#!/usr/bin/env node
/**
 * Regenerates profile SVGs from GitHub GraphQL stats.
 * Prefer GH_PAT (private-aware). Falls back to GITHUB_TOKEN / GH_TOKEN.
 *
 * Each SVG self-themes with prefers-color-scheme (works when loaded as <img>).
 * Dark variants also get an opaque canvas so GitHub cannot show a white box.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const token = process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_ACTOR || "BK201-Drama";
const FONT = "Arial, Helvetica, sans-serif";

const LANG_COLORS = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  HTML: "#e34c26",
  Vue: "#41b883",
  CSS: "#563d7c",
  Go: "#00add8",
  Rust: "#dea584",
  Java: "#b07219",
  Shell: "#89e051",
  C: "#555555",
  "C++": "#f34b7d",
};

const FALLBACK_COLORS = ["#24292f", "#57606a", "#8c959f", "#afb8c1", "#d0d7de"];

const THEMES = {
  light: { fg: "#141414", muted: "#666666", track: "#e4e4de", rule: "#e4e4de", bg: "none" },
  dark: { fg: "#e6edf3", muted: "#8b949e", track: "#30363d", rule: "#30363d", bg: "#0d1117" },
};

if (!token) {
  console.error("Missing GH_PAT / GH_TOKEN / GITHUB_TOKEN");
  process.exit(1);
}

const query = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalRepositoriesWithContributedCommits
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      nodes { primaryLanguage { name } }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "bk201-overview-generator",
  },
  body: JSON.stringify({ query, variables: { login } }),
});

if (!res.ok) {
  console.error("GraphQL HTTP", res.status, await res.text());
  process.exit(1);
}

const payload = await res.json();
if (payload.errors) {
  console.error(JSON.stringify(payload.errors, null, 2));
  process.exit(1);
}

const user = payload.data.user;
const cc = user.contributionsCollection;
const contrib = cc.contributionCalendar.totalContributions;
const commits = cc.totalCommitContributions;
const prs = cc.totalPullRequestContributions;
const reposTouched = cc.totalRepositoriesWithContributedCommits;

const counts = new Map();
for (const node of user.repositories.nodes) {
  const name = node.primaryLanguage?.name;
  if (!name) continue;
  counts.set(name, (counts.get(name) || 0) + 1);
}
const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
const langs = [...counts.entries()]
  .map(([name, n]) => ({ name, pct: (n / total) * 100 }))
  .sort((a, b) => b.pct - a.pct)
  .slice(0, 5);

const WIDTH = 920;
const PAD = 16;

function themeStyle(withCanvas) {
  return `<style>
  :root { color-scheme: light dark; }
  .bg { fill: none; }
  .fg { fill: #141414; }
  .muted { fill: #666666; }
  .track { fill: #e4e4de; }
  .rule { stroke: #e4e4de; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: ${withCanvas ? "#0d1117" : "none"}; }
    .fg { fill: #e6edf3; }
    .muted { fill: #8b949e; }
    .track { fill: #30363d; }
    .rule { stroke: #30363d; }
  }
</style>`;
}

function themeSuffix(themeName) {
  return themeName === "dark" ? "-dark" : "";
}

function writeMetrics(themeName) {
  const theme = THEMES[themeName];
  const adaptive = themeName === "light";
  const items = [
    { value: contrib, label: "CONTRIBUTIONS" },
    { value: commits, label: "COMMITS" },
    { value: prs, label: "PULL REQUESTS" },
    { value: reposTouched, label: "REPOS TOUCHED" },
  ];
  const colW = Math.floor(WIDTH / items.length);
  const cells = items
    .map((item, i) => {
      const x = i * colW;
      const divider =
        i === 0
          ? ""
          : adaptive
            ? `
  <line class="rule" x1="${x}" y1="8" x2="${x}" y2="64"/>`
            : `
  <line x1="${x}" y1="8" x2="${x}" y2="64" stroke="${theme.rule}"/>`;
      if (adaptive) {
        return `${divider}
  <text class="fg" x="${x + 14}" y="34" font-family="${FONT}" font-size="26" font-weight="700">${item.value}</text>
  <text class="muted" x="${x + 14}" y="52" font-family="${FONT}" font-size="10" letter-spacing="0.06em">${item.label}</text>`;
      }
      return `${divider}
  <text x="${x + 14}" y="34" font-family="${FONT}" font-size="26" font-weight="700" fill="${theme.fg}">${item.value}</text>
  <text x="${x + 14}" y="52" font-family="${FONT}" font-size="10" letter-spacing="0.06em" fill="${theme.muted}">${item.label}</text>`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="72" viewBox="0 0 ${WIDTH} 72" role="img" aria-label="Selected metrics">
  <title>Selected metrics</title>
  ${adaptive ? themeStyle(false) : ""}
  ${cells}
</svg>
`;
  writeFileSync(join(root, "profile", `metrics${themeSuffix(themeName)}.svg`), svg);
}

function writeLanguages(themeName) {
  const theme = THEMES[themeName];
  const adaptive = themeName === "light";
  const rowH = 22;
  const top = 8;
  const height = top + langs.length * rowH + 8;
  const labelW = 86;
  const pctW = 36;
  const trackX = PAD + labelW;
  const trackW = WIDTH - PAD * 2 - labelW - pctW;
  const rows = langs
    .map((lang, i) => {
      const y = top + i * rowH;
      const fill = LANG_COLORS[lang.name] || FALLBACK_COLORS[i] || "#d0d7de";
      const w = Math.max(4, Math.round((lang.pct / 100) * trackW));
      const pct = `${Math.round(lang.pct)}%`;
      if (adaptive) {
        return `
  <text class="fg" x="${PAD}" y="${y + 12}" font-family="${FONT}" font-size="12">${escapeXml(lang.name)}</text>
  <rect class="track" x="${trackX}" y="${y + 5}" width="${trackW}" height="6"/>
  <rect x="${trackX}" y="${y + 5}" width="${w}" height="6" fill="${fill}"/>
  <text class="muted" x="${WIDTH - PAD}" y="${y + 12}" font-family="${FONT}" font-size="12" text-anchor="end">${pct}</text>`;
      }
      return `
  <text x="${PAD}" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${theme.fg}">${escapeXml(lang.name)}</text>
  <rect x="${trackX}" y="${y + 5}" width="${trackW}" height="6" fill="${theme.track}"/>
  <rect x="${trackX}" y="${y + 5}" width="${w}" height="6" fill="${fill}"/>
  <text x="${WIDTH - PAD}" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${theme.muted}" text-anchor="end">${pct}</text>`;
    })
    .join("");

  const bg = adaptive
    ? `<rect class="bg" width="${WIDTH}" height="${height}"/>`
    : `<rect width="${WIDTH}" height="${height}" fill="${theme.bg}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="Languages">
  <title>Languages</title>
  ${adaptive ? themeStyle(true) : ""}
  ${bg}
  ${rows}
</svg>
`;
  const sideW = 520;
  const sideLabelW = 96;
  const sidePctW = 40;
  const sideTrackX = sideLabelW + 8;
  const sideTrackW = sideW - sideTrackX - sidePctW;
  const sideRows = langs
    .map((lang, i) => {
      const y = top + i * rowH;
      const fill = LANG_COLORS[lang.name] || FALLBACK_COLORS[i] || "#d0d7de";
      const w = Math.max(4, Math.round((lang.pct / 100) * sideTrackW));
      const pct = `${Math.round(lang.pct)}%`;
      if (adaptive) {
        return `
  <text class="fg" x="0" y="${y + 12}" font-family="${FONT}" font-size="12">${escapeXml(lang.name)}</text>
  <rect class="track" x="${sideTrackX}" y="${y + 5}" width="${sideTrackW}" height="7"/>
  <rect x="${sideTrackX}" y="${y + 5}" width="${w}" height="7" fill="${fill}"/>
  <text class="muted" x="${sideW}" y="${y + 12}" font-family="${FONT}" font-size="12" text-anchor="end">${pct}</text>`;
      }
      return `
  <text x="0" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${theme.fg}">${escapeXml(lang.name)}</text>
  <rect x="${sideTrackX}" y="${y + 5}" width="${sideTrackW}" height="7" fill="${theme.track}"/>
  <rect x="${sideTrackX}" y="${y + 5}" width="${w}" height="7" fill="${fill}"/>
  <text x="${sideW}" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${theme.muted}" text-anchor="end">${pct}</text>`;
    })
    .join("");

  const sideBg = adaptive
    ? `<rect class="bg" width="${sideW}" height="${height}"/>`
    : `<rect width="${sideW}" height="${height}" fill="${theme.bg}"/>`;
  const sideSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sideW}" height="${height}" viewBox="0 0 ${sideW} ${height}" role="img" aria-label="Languages">
  <title>Languages</title>
  ${adaptive ? themeStyle(true) : ""}
  ${sideBg}
  ${sideRows}
</svg>
`;
  writeFileSync(join(root, "profile", `languages${themeSuffix(themeName)}.svg`), sideSvg);
  writeFileSync(join(root, "profile", `github-overview${themeSuffix(themeName)}.svg`), svg);
}

mkdirSync(join(root, "profile"), { recursive: true });
for (const themeName of Object.keys(THEMES)) {
  writeMetrics(themeName);
  writeLanguages(themeName);
}
console.log("Wrote light/dark metrics + languages cards", {
  contrib,
  commits,
  prs,
  reposTouched,
  langs,
});

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
