// Company size check (firmographics). Separate from the fit score: the score says whether the stack
// matches FlowForge; this says whether the company is the size FlowForge sells to.
// The thresholds are OUR assumption for FlowForge (doc 10's ICP says 50–2,000 engineers) and can be
// changed in Supabase → product_profile without touching code. Pure functions, unit-tested.

export const SIZE_DEFAULTS = {
  min_engineers: 50,
  max_engineers: 2000,
  min_employees: 200,
  min_revenue_inr_cr: 50,
  min_funding_stage: "Series B",
};

/** Funding stages in order. "Public" and "Acquired" count as at least Series B. */
export const FUNDING_STAGES = ["Bootstrapped", "Pre-seed", "Seed", "Series A", "Series B", "Series C", "Series D+", "Public", "Acquired"];

// Approximate rates to convert reported revenue into ₹ (only used to compare against a threshold).
export const INR_PER = { INR: 1, USD: 88, EUR: 102, GBP: 117, CAD: 64, AUD: 58, SGD: 68, JPY: 0.58, CNY: 12.3, CHF: 110, SEK: 9.3, AED: 24 };

// Share of staff who are engineers, by company type. Used only when no engineering headcount is published.
// Non-software companies get no estimate: their "engineers" are often field or plant engineers, not software.
export const ENGINEER_SHARE = { software: 0.35, it_services: 0.6, tech_enabled: 0.15 };
const TYPE_TEXT = { software: "software", it_services: "IT services", tech_enabled: "tech-enabled" };

export const thresholdsFrom = (product) =>
  Object.fromEntries(Object.entries(SIZE_DEFAULTS).map(([k, v]) => [k, product?.[k] ?? v]));

/** Revenue in ₹ crore (1 Cr = 10 million), or null if the currency is unknown. */
export function toInrCrore(amount, currency) {
  const rate = INR_PER[String(currency ?? "").toUpperCase()];
  const n = Number(amount);
  if (!rate || !Number.isFinite(n) || n <= 0) return null;
  return (n * rate) / 1e7;
}

/** Normalise free text like "Series C", "series-b", "IPO", "listed on NSE" to a FUNDING_STAGES value. */
export function normaliseStage(text) {
  const s = String(text ?? "").toLowerCase();
  if (!s || s === "null" || s === "unknown") return null;
  if (/acqui|subsidiar/.test(s)) return "Acquired";
  if (/\b(public|ipo|listed|nasdaq|nyse|nse|bse|lse)\b|stock exchange/.test(s)) return "Public";
  if (/bootstrap|self-funded|no external funding/.test(s)) return "Bootstrapped";
  if (/pre-?seed/.test(s)) return "Pre-seed";
  if (/seed|angel/.test(s)) return "Seed";
  const m = s.match(/series[\s-]*([a-z])/);
  if (m) return m[1] === "a" ? "Series A" : m[1] === "b" ? "Series B" : m[1] === "c" ? "Series C" : "Series D+";
  if (/late stage|growth|private equity|pre-ipo/.test(s)) return "Series D+";
  return null;
}

const fmt = (n) => Math.round(n).toLocaleString("en-IN");
const crore = (n) => (n >= 1e5 ? `₹${(n / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 1 })} lakh Cr` : `₹${fmt(n)} Cr`);

/**
 * firmo (stored per company by the research job):
 *   { employees:{value, as_of, source}, engineers:{value, as_of, source}, revenue:{amount, currency, year, source},
 *     funding_stage:{value, source}, company_type, open_eng_roles, checked_at }
 *   Each `source` is { title, url }. Anything missing = unknown, never guessed silently.
 * Returns { status, label, reason, checks:[{key,label,threshold,value,basis,source,result}] }.
 */
export function sizeCheck(firmo, product) {
  const t = thresholdsFrom(product);
  const f = firmo ?? {};

  // 1. Engineering team (main criterion): published figure first, else an estimate from total staff.
  let eng = { value: null, basis: "unknown", source: null, note: null };
  if (f.engineers?.value > 0) {
    eng = { value: f.engineers.value, basis: "reported", source: f.engineers.source ?? null, note: f.engineers.as_of ? `as of ${f.engineers.as_of}` : null };
  } else if (f.employees?.value > 0 && ENGINEER_SHARE[f.company_type]) {
    const share = ENGINEER_SHARE[f.company_type];
    eng = {
      value: Math.round(f.employees.value * share),
      basis: "estimate",
      source: f.employees.source ?? null,
      note: `estimated as ~${Math.round(share * 100)}% of ${fmt(f.employees.value)} staff, typical for ${TYPE_TEXT[f.company_type]} companies`,
    };
  }
  const engResult = eng.value == null ? "unknown" : eng.value < t.min_engineers ? "below" : eng.value > t.max_engineers ? "above" : "pass";

  // 2. Total employees.
  const emp = f.employees?.value > 0 ? f.employees.value : null;
  const empResult = emp == null ? "unknown" : emp >= t.min_employees ? "pass" : "below";

  // 3. Revenue OR funding stage (either one is enough).
  const revCr = f.revenue ? toInrCrore(f.revenue.amount, f.revenue.currency) : null;
  const stage = normaliseStage(f.funding_stage?.value);
  const stageIdx = stage ? FUNDING_STAGES.indexOf(stage) : -1;
  const minIdx = FUNDING_STAGES.indexOf(normaliseStage(t.min_funding_stage) ?? "Series B");
  const revPass = revCr != null && revCr >= t.min_revenue_inr_cr;
  const stagePass = stageIdx >= minIdx;
  const moneyResult = revPass || stagePass ? "pass" : revCr == null && stage == null ? "unknown" : "below";
  const moneyValue = [
    revCr != null && `${crore(revCr)} revenue${f.revenue.year ? ` (${f.revenue.year})` : ""}${f.revenue.currency !== "INR" ? `, from ${f.revenue.currency} ${compact(f.revenue.amount)}` : ""}`,
    stage && stage,
  ].filter(Boolean).join(" · ");

  const checks = [
    {
      key: "engineers",
      label: "Engineering team",
      threshold: `${fmt(t.min_engineers)}–${fmt(t.max_engineers)} engineers`,
      value: eng.value == null ? "Unknown" : `${eng.basis === "estimate" ? "≈ " : ""}${fmt(eng.value)} engineers`,
      note: eng.note,
      basis: eng.basis,
      source: eng.source,
      result: engResult,
    },
    {
      key: "employees",
      label: "Company size",
      threshold: `${fmt(t.min_employees)}+ employees`,
      value: emp == null ? "Unknown" : `${fmt(emp)} employees`,
      note: f.employees?.as_of ? `as of ${f.employees.as_of}` : null,
      basis: emp == null ? "unknown" : "reported",
      source: f.employees?.source ?? null,
      result: empResult,
    },
    {
      key: "money",
      label: "Revenue or funding",
      threshold: `${crore(t.min_revenue_inr_cr)}+ revenue or ${t.min_funding_stage}+`,
      value: moneyValue || "Unknown",
      note: revCr != null && f.revenue.currency !== "INR" ? "converted at approximate exchange rates" : null,
      basis: moneyValue ? "reported" : "unknown",
      source: (revPass || !stagePass ? f.revenue?.source : f.funding_stage?.source) ?? f.revenue?.source ?? f.funding_stage?.source ?? null,
      result: moneyResult,
    },
  ];

  // Overall: the engineering band decides; the two secondary checks can only flag "too small".
  const secondaryBelow = checks.slice(1).filter((c) => c.result === "below");
  const known = checks.filter((c) => c.result !== "unknown");
  let status;
  let reason;
  if (engResult === "above") {
    status = "enterprise";
    reason = `About ${fmt(eng.value)} engineers is above the ${fmt(t.max_engineers)} upper limit: expect a long, multi-team sales cycle, and they may already run their own build platform.`;
  } else if (engResult === "below" || (engResult === "unknown" && secondaryBelow.length)) {
    status = "too_small";
    reason = engResult === "below"
      ? `About ${fmt(eng.value)} engineers is below the ${fmt(t.min_engineers)} minimum: build times are rarely a big enough problem yet.`
      : `${secondaryBelow.map((c) => `${c.label.toLowerCase()} is ${c.value.toLowerCase()}`).join(" and ")}, below the minimum.`;
  } else if (engResult === "pass" && secondaryBelow.length) {
    status = "outside";
    reason = `The engineering team fits, but ${secondaryBelow.map((c) => `${c.label.toLowerCase()} (${c.value}) is below ${c.threshold}`).join(" and ")}.`;
  } else if (engResult === "pass") {
    status = "in_range";
    reason = `About ${fmt(eng.value)} engineers is inside the ${checks[0].threshold} range${eng.basis === "estimate" ? " (estimated)" : ""}.`;
  } else if (known.length) {
    status = "partial";
    reason = "The engineering team size isn’t published; the other checks pass.";
  } else {
    status = "unknown";
    reason = "No public headcount, revenue or funding figures found. Check LinkedIn before calling.";
  }

  return { status, label: SIZE_LABELS[status], reason, checks, thresholds: t };
}

export const SIZE_LABELS = {
  in_range: "In FlowForge’s size range",
  too_small: "Too small for FlowForge",
  enterprise: "Enterprise: long sales cycle",
  outside: "Outside size range",
  partial: "Size partly verified",
  unknown: "Size unknown",
};

function compact(n) {
  const v = Number(n);
  if (v >= 1e9) return `${(v / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  return v.toLocaleString("en-US");
}
