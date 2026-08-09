#!/usr/bin/env node
/**
 * Regenerates profile/github-overview.svg from GitHub GraphQL stats.
 * Requires: GH_TOKEN or GITHUB_TOKEN
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_ACTOR || "BK201-Drama";

if (!token) {
  console.error("Missing GH_TOKEN / GITHUB_TOKEN");
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

const shades = ["#1a1a1a", "#4a4a4a", "#6e6e6e", "#929292", "#b6b6b6"];
const barX = 20;
const barW = 680;
let x = barX;
const segments = langs.map((lang, i) => {
  const w = Math.max(2, Math.round((lang.pct / 100) * barW));
  const seg = { ...lang, x, w, fill: shades[i] || "#b6b6b6", label: `${Math.round(lang.pct)}%` };
  x += w;
  return seg;
});

const legend = segments
  .map((s, i) => {
    const col = i < 3 ? i : i - 3;
    const row = i < 3 ? 0 : 1;
    const lx = 20 + col * 150;
    const ly = 138 + row * 0; // single row preferred
    // keep single row for <=5 by tighter spacing
    const sx = 20 + i * 136;
    const sy = 138;
    return `
  <circle cx="${sx + 4}" cy="${sy}" r="3.5" fill="${s.fill}"/>
  <text x="${sx + 14}" y="${sy + 4}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" fill="#333333">${s.name} ${s.label}</text>`;
  })
  .join("");

const bars = segments
  .map((s) => `<rect x="${s.x}" y="106" width="${s.w}" height="10" fill="${s.fill}"/>`)
  .join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="168" viewBox="0 0 720 168" role="img" aria-label="GitHub overview">
  <title>GitHub overview</title>
  <rect width="720" height="168" fill="#f6f6f4"/>
  <rect x="0.5" y="0.5" width="719" height="167" fill="none" stroke="#d4d4d0"/>

  <rect x="1" y="1" width="718" height="72" fill="#f0f0ec"/>
  <line x1="1" y1="73" x2="719" y2="73" stroke="#d4d4d0"/>
  <line x1="240" y1="1" x2="240" y2="73" stroke="#d4d4d0"/>
  <line x1="480" y1="1" x2="480" y2="73" stroke="#d4d4d0"/>

  <text x="20" y="40" font-family="Georgia, 'Times New Roman', serif" font-size="28" font-weight="600" fill="#141414">${contrib}</text>
  <text x="20" y="58" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" letter-spacing="0.08em" fill="#666666">CONTRIBUTIONS</text>

  <text x="260" y="40" font-family="Georgia, 'Times New Roman', serif" font-size="28" font-weight="600" fill="#141414">${commits}</text>
  <text x="260" y="58" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" letter-spacing="0.08em" fill="#666666">COMMITS</text>

  <text x="500" y="40" font-family="Georgia, 'Times New Roman', serif" font-size="28" font-weight="600" fill="#141414">${prs}</text>
  <text x="500" y="58" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" letter-spacing="0.08em" fill="#666666">PULL REQUESTS</text>

  <text x="20" y="96" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" letter-spacing="0.08em" fill="#666666">TOP LANGUAGES</text>

  <rect x="20" y="106" width="680" height="10" fill="#e4e4de"/>
  ${bars}
  ${legend}
</svg>
`;

const out = join(root, "profile", "github-overview.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log("Wrote", out, { contrib, commits, prs, langs });
