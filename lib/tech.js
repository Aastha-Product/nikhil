// Technology dictionary shared by every data source (GitHub, job posts, web research),
// so "kubernetes" found in a repo topic and "Kubernetes" in a job post count as the same signal.

export const TECH = [
  // Runtime / orchestration
  { key: "kubernetes", label: "Kubernetes", group: "runtime", re: /\bkubernetes\b|\bk8s\b|\bkubectl\b|\bgke\b|\beks\b|\baks\b/i },
  { key: "helm", label: "Helm", group: "runtime", re: /\bhelm\b/i },
  { key: "docker", label: "Docker", group: "runtime", re: /\bdocker(file)?\b|\bdocker[- ]compose\b/i },
  { key: "serverless", label: "Serverless", group: "runtime", re: /\bserverless\b|\blambda functions?\b|\bcloud run\b|\bcloud functions\b/i },
  // Clouds
  { key: "aws", label: "AWS", group: "cloud", re: /\baws\b|amazon web services|\bec2\b|\beks\b|\bs3\b|\bdynamodb\b|\baws lambda\b/i },
  { key: "gcp", label: "Google Cloud", group: "cloud", re: /\bgcp\b|google cloud|\bgke\b|\bbigquery\b|\bcloud run\b/i },
  { key: "azure", label: "Azure", group: "cloud", re: /\bazure\b|\baks\b/i },
  { key: "cloudflare", label: "Cloudflare", group: "cloud", re: /\bcloudflare\b/i },
  // Infrastructure as code
  { key: "terraform", label: "Terraform", group: "iac", re: /\bterraform\b|\bhcl\b/i },
  { key: "pulumi", label: "Pulumi", group: "iac", re: /\bpulumi\b/i },
  // Architecture
  { key: "microservices", label: "Microservices", group: "arch", re: /\bmicro-?services?\b|service mesh|\bistio\b|\blinkerd\b|\benvoy\b/i },
  { key: "grpc", label: "gRPC / Protobuf", group: "arch", re: /\bgrpc\b|\bprotobuf\b|protocol buffers/i },
  { key: "kafka", label: "Kafka", group: "arch", re: /\bkafka\b/i },
  // Build / monorepo tooling
  { key: "bazel", label: "Bazel", group: "build", re: /\bbazel\b|\bstarlark\b/i },
  { key: "nx", label: "Nx", group: "build", re: /\bnx monorepo\b|\bnrwl\b|\bnx\.dev\b/i },
  { key: "turborepo", label: "Turborepo", group: "build", re: /\bturbo-?repo\b/i },
  // CI/CD
  { key: "github-actions", label: "GitHub Actions", group: "ci", re: /\bgithub actions\b/i },
  { key: "circleci", label: "CircleCI", group: "ci", re: /\bcircle-?ci\b/i },
  { key: "buildkite", label: "Buildkite", group: "ci", re: /\bbuildkite\b/i },
  { key: "jenkins", label: "Jenkins", group: "ci", re: /\bjenkins\b/i },
  { key: "argocd", label: "Argo CD", group: "ci", re: /\bargo ?cd\b|\bargoproj\b/i },
  // Observability
  { key: "datadog", label: "Datadog", group: "observability", re: /\bdatadog\b/i },
  { key: "prometheus", label: "Prometheus", group: "observability", re: /\bprometheus\b/i },
  { key: "opentelemetry", label: "OpenTelemetry", group: "observability", re: /\bopentelemetry\b|\botel\b/i },
];

// Phrases in job posts that suggest the team feels CI / developer-experience pain.
export const CI_PAIN_RE = /\bci\/cd\b|build (times?|speed|performance)|slow builds?|test (flakiness|infrastructure)|flaky tests?|developer (experience|productivity|velocity)|\bdevex\b|build (system|infrastructure)|release engineering/i;

export const LANGUAGE_RE = {
  Go: /\bgolang\b|\bgo\b(?= |,|\/|\))/,
  TypeScript: /\btypescript\b/i,
  JavaScript: /\bjavascript\b|\bnode\.?js\b/i,
  Python: /\bpython\b/i,
  Java: /\bjava\b(?!script)/i,
  Kotlin: /\bkotlin\b/i,
  Rust: /\brust\b/i,
  Ruby: /\bruby\b|\brails\b/i,
  Scala: /\bscala\b/i,
  "C#": /\bc#|\.net\b/i,
  "C++": /\bc\+\+/i,
  Elixir: /\belixir\b/i,
  PHP: /\bphp\b/i,
  Swift: /\bswift\b/i,
};

// GitHub "languages" that are markup / config, not the language a team writes services in.
// Some still imply infra (Dockerfile → docker, HCL → terraform, Starlark → bazel).
export const NON_PROGRAMMING_LANGUAGES = {
  HTML: null, CSS: null, SCSS: null, Less: null, Makefile: null, Shell: null, PowerShell: null,
  Batchfile: null, Nix: null, Mustache: null, Handlebars: null, Jinja: null, TeX: null, Smarty: null,
  Procfile: null, MDX: null,
  Dockerfile: "docker", HCL: "terraform", Starlark: "bazel", Smithy: null, "Protocol Buffer": "grpc",
};

/** Return the TECH keys found in a piece of text. */
export function detectTech(text) {
  if (!text) return [];
  const t = String(text).replace(/[-_]/g, " ");
  return TECH.filter((x) => x.re.test(t) || x.re.test(String(text))).map((x) => x.key);
}

/** Return language names mentioned in a piece of text. */
export function detectLanguages(text) {
  if (!text) return [];
  return Object.entries(LANGUAGE_RE).filter(([, re]) => re.test(text)).map(([name]) => name);
}

export const techLabel = (key) => TECH.find((x) => x.key === key)?.label ?? key;
export const techGroup = (key) => TECH.find((x) => x.key === key)?.group ?? "other";
