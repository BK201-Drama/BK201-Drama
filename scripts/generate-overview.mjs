#!/usr/bin/env node
/**
 * Regenerates profile/github-overview.svg from GitHub GraphQL stats.
 * Requires: GH_TOKEN or GITHUB_TOKEN
 *
 * Tip: Actions' GITHUB_TOKEN only sees public activity. For numbers that
 * match your profile (incl. private), set repo secret GH_PAT and pass it in.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const token = process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_ACTOR || "BK201-Drama";

if (!token) {
  console.error("Missing GH_PAT / GH_TOKEN / GITHUB_TOKEN");
  process.exit(1);
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

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

const shades = ["#24292f", "#57606a", "#8c959f", "#afb8c1", "#d0d7de"];
const barX = 16;
const barW = 688;
let x = barX;
const segments = langs.map((lang, i) => {
  const w = Math.max(3, Math.round((lang.pct / 100) * barW));
  const seg = {
    ...lang,
    x,
    w,
    fill: shades[i] || "#d0d7de",
    label: `${Math.round(lang.pct)}%`,
  };
  x += w;
  return seg;
});

// equal-ish legend columns
const legendW = 688 / Math.max(segments.length, 1);
const legend = segments
  .map((s, i) => {
    const sx = 16 + i * legendW;
    return `
  <circle cx="${sx + 5}" cy="118" r="3.5" fill="${s.fill}"/>
  <text x="${sx + 14}" y="122" font-family="${FONT}" font-size="12" fill="#57606a">${escapeXml(s.name)} ${s.label}</text>`;
  })
  .join("");

const bars = segments
  .map((s) => `<rect x="${s.x}" y="96" width="${s.w}" height="8" fill="${s.fill}"/>`)
  .join("\n  ");

const metrics = [
  { value: contrib, label: "Contributions", x: 16 },
  { value: commits, label: "Commits", x: 248 },
  { value: prs, label: "Pull requests", x: 480 },
];

const metricTexts = metrics
  .map(
    (m) => `
  <text x="${m.x}" y="36" font-family="${FONT}" font-size="26" font-weight="600" fill="#24292f">${m.value}</text>
  <text x="${m.x}" y="54" font-family="${FONT}" font-size="12" fill="#656d76">${m.label}</text>`
  )
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="140" viewBox="0 0 720 140" role="img" aria-label="GitHub overview">
  <title>GitHub overview</title>
  <rect width="720" height="140" rx="6" fill="#ffffff"/>
  <rect x="0.5" y="0.5" width="719" height="139" rx="6" fill="none" stroke="#d0d7de"/>

  ${metricTexts}

  <line x1="16" y1="70" x2="704" y2="70" stroke="#d0d7de"/>

  <text x="16" y="88" font-family="${FONT}" font-size="12" font-weight="600" fill="#24292f">Top languages</text>
  <rect x="16" y="96" width="688" height="8" rx="2" fill="#f6f8fa"/>
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
