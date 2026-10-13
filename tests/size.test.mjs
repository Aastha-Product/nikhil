import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseStage, sizeCheck, toInrCrore } from "../lib/size.js";

const src = { title: "Source", url: "https://example.com" };
const check = (res, key) => res.checks.find((c) => c.key === key);

test("a mid-size software company with a published engineering team is in range", () => {
  const r = sizeCheck({
    employees: { value: 1200, as_of: "2025", source: src },
    engineers: { value: 450, as_of: "2025", source: src },
    funding_stage: { value: "Series C", source: src },
    company_type: "software",
  });
  assert.equal(r.status, "in_range");
  assert.equal(check(r, "engineers").basis, "reported");
  assert.equal(check(r, "money").result, "pass");
});

test("engineering team is estimated from staff when not published, and labelled as an estimate", () => {
  const r = sizeCheck({ employees: { value: 8300, source: src }, company_type: "software" });
  const eng = check(r, "engineers");
  assert.equal(eng.basis, "estimate");
  assert.match(eng.value, /≈ 2,905 engineers/);
  assert.equal(r.status, "enterprise"); // ~2,905 > 2,000
  assert.equal(r.label, "Enterprise: long sales cycle");
});

test("small startups are flagged as too small", () => {
  const r = sizeCheck({ employees: { value: 40, source: src }, engineers: { value: 12, source: src }, funding_stage: { value: "Seed", source: src } });
  assert.equal(r.status, "too_small");
  assert.equal(r.label, "Too small for FlowForge");
  assert.equal(check(r, "money").result, "below");
});

test("no figures at all → unknown, never guessed", () => {
  for (const f of [null, {}, { company_type: "software" }]) {
    const r = sizeCheck(f);
    assert.equal(r.status, "unknown");
    assert.ok(r.checks.every((c) => c.result === "unknown" && c.value === "Unknown"));
  }
});

test("no estimate for an unknown company type", () => {
  const r = sizeCheck({ employees: { value: 5000, source: src }, company_type: "unknown" });
  assert.equal(check(r, "engineers").result, "unknown");
  assert.equal(r.status, "partial");
});

test("revenue OR funding is enough; revenue is converted to ₹ crore", () => {
  assert.equal(Math.round(toInrCrore(10_000_000, "USD")), 88); // $10M ≈ ₹88 Cr
  assert.equal(toInrCrore(5, "XYZ"), null);
  const lowRevButSeriesB = sizeCheck({ revenue: { amount: 1_000_000, currency: "USD", source: src }, funding_stage: { value: "Series B", source: src } });
  assert.equal(check(lowRevButSeriesB, "money").result, "pass");
  const lowRevOnly = sizeCheck({ revenue: { amount: 1_000_000, currency: "USD", source: src } });
  assert.equal(check(lowRevOnly, "money").result, "below");
});

test("engineering team fits but company is below another limit → outside size range", () => {
  const r = sizeCheck({ employees: { value: 150, source: src }, engineers: { value: 80, source: src }, funding_stage: { value: "Series B", source: src } });
  assert.equal(r.status, "outside");
});

test("thresholds come from product_profile when set (editable without code)", () => {
  const firmo = { engineers: { value: 30, source: src } };
  assert.equal(sizeCheck(firmo).status, "too_small");
  assert.equal(sizeCheck(firmo, { min_engineers: 20 }).status, "in_range");
});

test("funding stage text is normalised", () => {
  assert.equal(normaliseStage("Series-B"), "Series B");
  assert.equal(normaliseStage("Series F"), "Series D+");
  assert.equal(normaliseStage("Listed on NSE and BSE"), "Public");
  assert.equal(normaliseStage("Subsidiary of Mahindra Group"), "Acquired");
  assert.equal(normaliseStage("software license"), null); // "nse" inside a word must not match
  assert.equal(normaliseStage(null), null);
});
