#!/usr/bin/env node
/**
 * Regenerates profile/github-overview.svg from GitHub GraphQL stats.
 * Prefer GH_PAT (private-aware). Falls back to GITHUB_TOKEN / GH_TOKEN.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const token = process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_ACTOR || "BK201-Drama";
const FONT = "Arial, Helvetica, sans-serif";

/** GitHub linguist-ish colors for common languages */
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

const barX = 16;
const barW = 688;
let x = barX;
const segments = langs.map((lang, i) => {
  const w = Math.max(3, Math.round((lang.pct / 100) * barW));
  const fill = LANG_COLORS[lang.name] || FALLBACK_COLORS[i] || "#d0d7de";
  const seg = {
    name: lang.name,
    pct: lang.pct,
    x,
    w,
    fill,
    label: `${Math.round(lang.pct)}%`,
  };
  x += w;
  return seg;
});

const legendW = Math.floor(688 / Math.max(segments.length, 1));
const legend = segments
  .map((s, i) => {
    const sx = 14 + i * legendW;
    return [
      `<circle cx="${sx + 4}" cy="98" r="3" fill="${s.fill}"/>`,
      `<text x="${sx + 12}" y="101" font-family="${FONT}" font-size="11" fill="#57606a">${escapeXml(s.name)} ${s.label}</text>`,
    ].join("\n  ");
  })
  .join("\n  ");

const bars = segments
  .map((s) => `<rect x="${s.x}" y="80" width="${s.w}" height="7" fill="${s.fill}"/>`)
  .join("\n  ");

const cols = [
  { value: contrib, label: "Contributions", x: 14 },
  { value: commits, label: "Commits", x: 246 },
  { value: prs, label: "Pull requests", x: 478 },
];

const metricTexts = cols
  .map(
    (m) =>
      [
        `<text x="${m.x}" y="28" font-family="${FONT}" font-size="22" font-weight="700" fill="#24292f">${m.value}</text>`,
        `<text x="${m.x}" y="44" font-family="${FONT}" font-size="11" fill="#656d76">${m.label}</text>`,
      ].join("\n  ")
  )
  .join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="114" viewBox="0 0 720 114" role="img" aria-label="GitHub overview">
  <title>GitHub overview</title>
  <rect width="720" height="114" rx="6" fill="#ffffff"/>
  <rect x="0.5" y="0.5" width="719" height="113" rx="6" fill="none" stroke="#d0d7de"/>
  ${metricTexts}
  <line x1="14" y1="56" x2="706" y2="56" stroke="#d0d7de"/>
  <text x="14" y="72" font-family="${FONT}" font-size="11" font-weight="700" fill="#24292f">Top languages</text>
  <rect x="14" y="80" width="692" height="7" rx="2" fill="#f6f8fa"/>
  ${bars}
  ${legend}
</svg>
`;

const out = join(root, "profile", "github-overview.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log("Wrote", out, { contrib, commits, prs, langs });

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
