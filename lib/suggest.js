// Company name → website suggestions for the "New research" form.
// 1) Your own watchlist (so you don't research the same company twice)
// 2) Clearbit's public company autocomplete (no key) — fast, name + domain
// 3) Wikidata (official website, P856) — fallback if Clearbit is down or finds nothing

import "server-only";
import { db } from "./supabaseAdmin.js";

const CACHE = new Map(); // query → { at, items }
const TTL_MS = 10 * 60 * 1000;
const UA = { "User-Agent": "tech-stack-scout/1.0 (sales research tool)" };
// Keep a professional tool professional: drop adult sites the public autocomplete sometimes returns.
const BLOCK_RE = /porn|xxx|xhamster|stripchat|chaturbate|onlyfans|escort|camgirl|\bsex|adult|nsfw|hentai/i;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const cleanDomain = (d) => String(d ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

async function fetchJson(url, ms = 2500) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function fromClearbit(q) {
  const list = await fetchJson(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`);
  return (Array.isArray(list) ? list : []).map((c) => ({ name: c.name, domain: cleanDomain(c.domain), source: "clearbit" }));
}

async function fromWikidata(q) {
  const search = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&type=item&limit=8&format=json&origin=*`
  );
  const ids = (search.search ?? []).map((s) => s.id).slice(0, 8);
  if (!ids.length) return [];
  const ents = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims|labels&languages=en&format=json&origin=*`
  );
  return ids
    .map((id) => ents.entities?.[id])
    .map((e) => ({ name: e?.labels?.en?.value, domain: cleanDomain(e?.claims?.P856?.[0]?.mainsnak?.datavalue?.value), source: "wikidata" }))
    .filter((c) => c.name && c.domain);
}

async function fromWatchlist(q) {
  const { data } = await db().from("companies").select("id, name, website, active").ilike("name", `%${q.replace(/[%_]/g, "")}%`).limit(5);
  return (data ?? []).map((c) => ({ name: c.name, domain: cleanDomain(c.website), source: "watchlist", existingId: c.id, active: c.active }));
}

/** @returns {Promise<Array<{name, domain, source, existingId?, active?}>>} up to 6 suggestions */
export async function suggestCompanies(query) {
  const q = String(query ?? "").trim().slice(0, 60);
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;

  const [own, clearbit] = await Promise.all([
    fromWatchlist(q).catch(() => []),
    fromClearbit(q).catch(() => null),
  ]);
  let external = clearbit ?? [];
  if (!external.length) external = await fromWikidata(q).catch(() => []);

  // Own watchlist first, then external results that start with what was typed, then the rest.
  const qn = norm(q);
  const seen = new Set(own.map((c) => norm(c.name)));
  const ranked = external
    .filter((c) => c.name && c.domain && !BLOCK_RE.test(`${c.name} ${c.domain}`))
    .filter((c) => !seen.has(norm(c.name)) && seen.add(norm(c.name)))
    .sort((a, b) => Number(norm(b.name).startsWith(qn)) - Number(norm(a.name).startsWith(qn)));

  const items = [...own, ...ranked].slice(0, 6);
  CACHE.set(key, { at: Date.now(), items });
  if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value);
  return items;
}
