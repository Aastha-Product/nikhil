// Unit tests for matching a company to its GitHub org (no network). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchOwner } from "../lib/github.js";

const org = (login, blog, repos = 100, is_verified = false) => ({ login, blog, public_repos: repos, is_verified });

test("same domain or a subdomain is verified", () => {
  assert.equal(matchOwner({ name: "Vercel", domain: "vercel.com" }, org("vercel", "https://vercel.com")), "domain_verified");
  assert.equal(matchOwner({ name: "Microsoft", domain: "microsoft.com" }, org("microsoft", "https://opensource.microsoft.com")), "domain_verified");
});

test("same brand on another domain is verified (Shopify, Stripe)", () => {
  assert.equal(matchOwner({ name: "Shopify", domain: "shopify.com" }, org("Shopify", "https://shopify.engineering/")), "domain_verified");
  assert.equal(matchOwner({ name: "Stripe", domain: "stripe.com" }, org("stripe", "https://stripe.dev")), "domain_verified");
});

test("GitHub-verified org whose handle is the brand is verified", () => {
  assert.equal(matchOwner({ name: "Acme", domain: "acme.io" }, org("acme", "https://blog.somewhere.com", 10, true)), "domain_verified");
});

test("empty orgs never match (Mitie)", () => {
  assert.equal(matchOwner({ name: "Mitie", domain: "mitie.com" }, org("mitie", "", 0)), null);
});

test("handle-only match is flagged as name_only; unrelated orgs don't match", () => {
  assert.equal(matchOwner({ name: "Acme", domain: "acme.io" }, org("acme", "https://other.com")), "name_only");
  assert.equal(matchOwner({ name: "Acme", domain: "acme.io" }, org("acme-labs", "https://acmelabs.net")), null);
  assert.equal(matchOwner({ name: "Basecamp", domain: null }, org("basecamp", "")), "name_only");
});

test("UK-style domains use the right brand", () => {
  assert.equal(matchOwner({ name: "Ocado", domain: "ocado.co.uk" }, org("ocado", "https://ocadogroup.com")), "name_only");
  assert.equal(matchOwner({ name: "Ocado", domain: "ocado.co.uk" }, org("ocado", "https://tech.ocado.co.uk")), "domain_verified");
});
