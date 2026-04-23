// FILE: src/services/intelligence/domain-classifier.ts
// Adaptive domain taxonomy for the intelligence layer.
// Three classification tiers:
//   1. Built-in domains (30+ domains, 50-100 tokens each) — covers major verticals
//   2. File-path inference — directory names and extensions map to domains
//   3. Dynamic domain discovery — unmatched high-frequency tokens become new domains
// Falls back gracefully: if nothing matches, returns "general" with low confidence.

// ---------------------------------------------------------------------------
// Domain type — extensible via string union + dynamic domains
// ---------------------------------------------------------------------------

export type BuiltinDomain =
  | "api"
  | "auth"
  | "database"
  | "css"
  | "testing"
  | "infra"
  | "error-handling"
  | "state"
  | "ui"
  | "performance"
  | "security"
  | "networking"
  | "data-science"
  | "ml-ai"
  | "mobile"
  | "game-dev"
  | "systems"
  | "blockchain"
  | "devops"
  | "documentation"
  | "payments"
  | "search"
  | "messaging"
  | "media"
  | "i18n"
  | "accessibility"
  | "analytics"
  | "logging"
  | "caching"
  | "configuration"
  | "general";

export type Domain = BuiltinDomain | `custom:${string}`;

export interface DomainClassification {
  primary: Domain;
  secondary: Domain | null;
  confidence: number;
}

export interface DomainScore {
  domain: Domain;
  score: number;
  matchCount: number;
}

// ---------------------------------------------------------------------------
// Domain definition — keywords (substring match) + regex (fast-path)
// ---------------------------------------------------------------------------

interface DomainDef {
  regex: RegExp;
  keywords: string[];
}

const DOMAIN_DEFS: Record<Exclude<BuiltinDomain, "general">, DomainDef> = {
  api: {
    regex:
      /\b(?:api|endpoint|route|handler|rest(?:ful)?|graphql|resolver|middleware|controller|webhook|gateway|rpc|grpc|protobuf|openapi|swagger|cors|rate.limit)\b/i,
    keywords: [
      "endpoint",
      "route",
      "REST",
      "handler",
      "middleware",
      "controller",
      "request",
      "response",
      "API",
      "fetch",
      "HTTP",
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "graphql",
      "resolver",
      "openapi",
      "swagger",
      "webhook",
      "gateway",
      "rpc",
      "grpc",
      "protobuf",
      "cors",
      "rate limit",
      "status code",
      "content-type",
      "header",
      "query param",
      "path param",
      "body",
      "payload",
      "JSON",
      "XML",
      "SOAP",
      "REST API",
      "API key",
      "throttle",
      "pagination",
      "cursor",
      "offset",
      "tRPC",
      "Hono",
      "Express",
      "Fastify",
      "Koa",
      "NestJS",
      "Django REST",
      "FastAPI",
      "Flask",
      "Spring Boot",
      "gin",
      "fiber",
      "actix",
      "axum",
      "warp",
    ],
  },
  auth: {
    regex:
      /\b(?:auth(?:entication|orization)?|login|session|token|jwt|oauth|password|credential|permission|rbac|acl)\b/i,
    keywords: [
      "auth",
      "login",
      "logout",
      "session",
      "token",
      "JWT",
      "OAuth",
      "password",
      "credential",
      "permission",
      "role",
      "RBAC",
      "ACL",
      "signup",
      "register",
      "2FA",
      "MFA",
      "SSO",
      "SAML",
      "OIDC",
      "passkey",
      "WebAuthn",
      "FIDO",
      "biometric",
      "hash",
      "bcrypt",
      "argon2",
      "scrypt",
      "salt",
      "pepper",
      "refresh token",
      "access token",
      "bearer",
      "cookie",
      "CSRF",
      "XSS",
      "CORS",
      "identity",
      "claim",
      "scope",
      "tenant",
      "multi-tenant",
      "impersonate",
      "API key",
      "secret",
      "vault",
      "Better Auth",
      "NextAuth",
      "Auth.js",
      "Clerk",
      "Supabase Auth",
      "Firebase Auth",
      "Keycloak",
      "Okta",
      "Auth0",
    ],
  },
  database: {
    regex:
      /\b(?:database|sql|query|migration|orm|prisma|drizzle|schema|table|index|transaction|postgres|mysql|sqlite|mongo|redis|dynamo|supabase|fauna|planetscale|turso|neon)\b/i,
    keywords: [
      "database",
      "SQL",
      "query",
      "migration",
      "schema",
      "table",
      "index",
      "ORM",
      "Prisma",
      "Drizzle",
      "PostgreSQL",
      "MySQL",
      "SQLite",
      "MongoDB",
      "Redis",
      "DynamoDB",
      "transaction",
      "JOIN",
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "WHERE",
      "GROUP BY",
      "aggregate",
      "foreign key",
      "primary key",
      "constraint",
      "trigger",
      "stored procedure",
      "view",
      "materialized view",
      "Supabase",
      "PlanetScale",
      "Turso",
      "Neon",
      "CockroachDB",
      "Fauna",
      "Firestore",
      "Cassandra",
      "ScyllaDB",
      "ClickHouse",
      "DuckDB",
      "CozoDB",
      "Elasticsearch",
      "OpenSearch",
      "Pinecone",
      "Weaviate",
      "Qdrant",
      "connection pool",
      "replica",
      "shard",
      "partition",
      "ACID",
      "eventual consistency",
      "CAP theorem",
      "N+1",
      "batch insert",
      "upsert",
      "deadlock",
      "lock",
      "isolation level",
      "WAL",
    ],
  },
  css: {
    regex:
      /\b(?:css|scss|sass|style|layout|flex(?:box)?|grid|tailwind|theme|responsive|animation|keyframe|media.query|breakpoint)\b/i,
    keywords: [
      "CSS",
      "SCSS",
      "SASS",
      "style",
      "flex",
      "flexbox",
      "grid",
      "margin",
      "padding",
      "border",
      "layout",
      "responsive",
      "animation",
      "keyframe",
      "transition",
      "transform",
      "Tailwind",
      "theme",
      "dark mode",
      "className",
      "styled-components",
      "emotion",
      "vanilla-extract",
      "CSS modules",
      "PostCSS",
      "autoprefixer",
      "media query",
      "breakpoint",
      "container query",
      "aspect-ratio",
      "clamp",
      "calc",
      "var(--",
      "custom property",
      "z-index",
      "position",
      "display",
      "overflow",
      "shadow",
      "gradient",
      "font",
      "typography",
      "color",
      "opacity",
      "backdrop",
      "filter",
      "UnoCSS",
      "Panda CSS",
      "StyleX",
      "Linaria",
      "Stitches",
    ],
  },
  testing: {
    regex:
      /\b(?:test(?:ing)?|spec|mock|assert|expect|vitest|jest|cypress|playwright|coverage|tdd|bdd|fixture|snapshot)\b/i,
    keywords: [
      "test",
      "spec",
      "assert",
      "expect",
      "mock",
      "stub",
      "fixture",
      "Jest",
      "Vitest",
      "Mocha",
      "Cypress",
      "Playwright",
      "Puppeteer",
      "coverage",
      "describe",
      "it(",
      "beforeEach",
      "afterEach",
      "snapshot",
      "integration test",
      "unit test",
      "e2e",
      "end-to-end",
      "regression",
      "smoke test",
      "load test",
      "stress test",
      "TDD",
      "BDD",
      "test runner",
      "test suite",
      "assertion",
      "spy",
      "fake",
      "test double",
      "property-based",
      "fuzz",
      "mutation testing",
      "code coverage",
      "branch coverage",
      "MSW",
      "nock",
      "supertest",
      "Testing Library",
      "React Testing Library",
      "screen.getBy",
    ],
  },
  infra: {
    regex:
      /\b(?:deploy|docker|ci(?:\/cd)?|pipeline|infra|kubernetes|terraform|aws|gcp|azure|vercel|netlify|cloudflare|nginx|caddy|traefik)\b/i,
    keywords: [
      "Docker",
      "Kubernetes",
      "CI/CD",
      "pipeline",
      "deploy",
      "terraform",
      "AWS",
      "GCP",
      "Azure",
      "Vercel",
      "Netlify",
      "nginx",
      "container",
      "pod",
      "GitHub Actions",
      "workflow",
      "build",
      "Dockerfile",
      "docker-compose",
      "Helm",
      "ArgoCD",
      "FluxCD",
      "Pulumi",
      "CloudFormation",
      "CDK",
      "serverless",
      "Lambda",
      "Cloud Functions",
      "Edge Function",
      "Cloudflare Workers",
      "Deno Deploy",
      "Fly.io",
      "Railway",
      "Render",
      "DigitalOcean",
      "Linode",
      "Hetzner",
      "load balancer",
      "CDN",
      "DNS",
      "SSL",
      "TLS",
      "certificate",
      "reverse proxy",
      "Caddy",
      "Traefik",
      "Istio",
      "Envoy",
      "service mesh",
      "ingress",
      "ConfigMap",
      "Secret",
      "PVC",
    ],
  },
  "error-handling": {
    regex:
      /\b(?:error|exception|retry|fallback|timeout|circuit[\s.-]?breaker|catch|throw|stack.trace|crash|panic|recover)\b/i,
    keywords: [
      "error",
      "exception",
      "catch",
      "throw",
      "retry",
      "fallback",
      "timeout",
      "circuit breaker",
      "graceful",
      "stack trace",
      "crash",
      "panic",
      "recover",
      "try-catch",
      "finally",
      "error boundary",
      "unhandled rejection",
      "process.exit",
      "SIGTERM",
      "SIGINT",
      "dead letter",
      "poison message",
      "exponential backoff",
      "jitter",
      "health check",
      "liveness",
      "readiness",
      "graceful shutdown",
      "error code",
      "error message",
      "validation error",
      "not found",
      "unauthorized",
      "forbidden",
      "conflict",
      "rate limited",
      "Result type",
      "Option type",
      "Either",
      "Maybe",
      "unwrap",
    ],
  },
  state: {
    regex:
      /\b(?:state\s*management|store|redux|zustand|context|provider|useState|signal|observable|atom|jotai|recoil|mobx|pinia|vuex|ngrx|xstate)\b/i,
    keywords: [
      "state management",
      "store",
      "Redux",
      "Zustand",
      "context",
      "provider",
      "useReducer",
      "useState",
      "atom",
      "signal",
      "observable",
      "cache",
      "memoize",
      "hydrate",
      "persist",
      "Jotai",
      "Recoil",
      "MobX",
      "Pinia",
      "Vuex",
      "NgRx",
      "XState",
      "state machine",
      "finite state",
      "reducer",
      "dispatch",
      "action",
      "selector",
      "derived state",
      "computed",
      "effect",
      "subscription",
      "optimistic update",
      "pessimistic update",
      "offline first",
      "sync",
      "conflict resolution",
      "CRDT",
      "event sourcing",
    ],
  },
  ui: {
    regex:
      /\b(?:component|render|react|vue|svelte|angular|solid|qwik|next\.?js|nuxt|remix|astro|gatsby|modal|form|button|dashboard|widget|layout)\b/i,
    keywords: [
      "component",
      "render",
      "React",
      "Vue",
      "Svelte",
      "Angular",
      "Solid",
      "Qwik",
      "Next.js",
      "Nuxt",
      "Remix",
      "Astro",
      "Gatsby",
      "button",
      "modal",
      "form",
      "input",
      "dropdown",
      "select",
      "table",
      "list",
      "card",
      "page",
      "navigation",
      "sidebar",
      "dashboard",
      "JSX",
      "TSX",
      "template",
      "slot",
      "portal",
      "dialog",
      "toast",
      "notification",
      "tooltip",
      "popover",
      "accordion",
      "tabs",
      "breadcrumb",
      "pagination",
      "skeleton",
      "Radix",
      "shadcn",
      "Headless UI",
      "Ark UI",
      "Chakra",
      "MUI",
      "Ant Design",
      "Mantine",
      "DaisyUI",
      "Flowbite",
      "Storybook",
      "design system",
      "component library",
      "props",
      "children",
      "ref",
      "hook",
      "useEffect",
      "useMemo",
      "useCallback",
    ],
  },
  performance: {
    regex:
      /\b(?:performance|optimize|lazy|bundle|chunk|profiling|latency|throughput|bottleneck|cache|memoiz|virtual(?:ize|ization)|code.split|tree.shake|lighthouse)\b/i,
    keywords: [
      "performance",
      "optimize",
      "lazy",
      "bundle",
      "chunk",
      "tree-shake",
      "profiling",
      "memory",
      "latency",
      "throughput",
      "bottleneck",
      "debounce",
      "throttle",
      "memoization",
      "virtualize",
      "virtualization",
      "code splitting",
      "dynamic import",
      "prefetch",
      "preload",
      "service worker",
      "web worker",
      "SharedArrayBuffer",
      "WASM",
      "WebAssembly",
      "Lighthouse",
      "Core Web Vitals",
      "LCP",
      "FID",
      "CLS",
      "TTFB",
      "INP",
      "render blocking",
      "critical path",
      "CDN",
      "edge",
      "compression",
      "gzip",
      "brotli",
      "minify",
      "sourcemap",
      "bundle analyzer",
      "Turbopack",
      "Vite",
      "esbuild",
      "swc",
      "Rollup",
      "webpack",
      "Parcel",
      "rspack",
    ],
  },
  security: {
    regex:
      /\b(?:security|vulnerab|exploit|injection|xss|csrf|csp|cors|sanitize|escape|encrypt|decrypt|hash|hmac|pentest|audit|cve|owasp)\b/i,
    keywords: [
      "security",
      "vulnerability",
      "exploit",
      "injection",
      "XSS",
      "CSRF",
      "CSP",
      "CORS",
      "sanitize",
      "escape",
      "encrypt",
      "decrypt",
      "hash",
      "HMAC",
      "pentest",
      "audit",
      "CVE",
      "OWASP",
      "SQL injection",
      "command injection",
      "path traversal",
      "insecure deserialization",
      "broken access control",
      "cryptographic failure",
      "SSRF",
      "XXE",
      "RCE",
      "Content Security Policy",
      "Subresource Integrity",
      "rate limiting",
      "DDoS",
      "WAF",
      "firewall",
      "IDS",
      "IPS",
      "secret scanning",
      "dependency audit",
      "supply chain",
      "Snyk",
      "Dependabot",
      "Trivy",
      "SAST",
      "DAST",
    ],
  },
  networking: {
    regex:
      /\b(?:socket|websocket|tcp|udp|http2|http3|quic|dns|ssl|tls|proxy|tunnel|vpn|ssh|ftp|smtp|imap)\b/i,
    keywords: [
      "socket",
      "WebSocket",
      "TCP",
      "UDP",
      "HTTP/2",
      "HTTP/3",
      "QUIC",
      "DNS",
      "SSL",
      "TLS",
      "proxy",
      "tunnel",
      "VPN",
      "SSH",
      "FTP",
      "SMTP",
      "IMAP",
      "POP3",
      "gRPC",
      "protocol",
      "handshake",
      "keep-alive",
      "connection pool",
      "multiplexing",
      "streaming",
      "Server-Sent Events",
      "SSE",
      "long polling",
      "bidirectional",
      "peer-to-peer",
      "P2P",
      "NAT",
      "STUN",
      "TURN",
      "WebRTC",
      "MQTT",
      "AMQP",
      "ZeroMQ",
      "packet",
      "frame",
      "header",
    ],
  },
  "data-science": {
    regex:
      /\b(?:pandas|numpy|scipy|matplotlib|seaborn|plotly|jupyter|notebook|dataframe|dataset|csv|parquet|etl|pipeline|dbt|airflow|spark|hadoop|feature.engineering)\b/i,
    keywords: [
      "pandas",
      "numpy",
      "scipy",
      "matplotlib",
      "seaborn",
      "plotly",
      "Jupyter",
      "notebook",
      "DataFrame",
      "dataset",
      "CSV",
      "parquet",
      "ETL",
      "pipeline",
      "dbt",
      "Airflow",
      "Spark",
      "Hadoop",
      "feature engineering",
      "data cleaning",
      "data wrangling",
      "correlation",
      "regression",
      "histogram",
      "scatter plot",
      "time series",
      "anomaly detection",
      "statistical test",
      "p-value",
      "confidence interval",
      "hypothesis",
      "A/B test",
      "cohort analysis",
      "funnel",
      "retention",
      "churn analysis",
      "Polars",
      "DuckDB",
      "Arrow",
      "BigQuery",
      "Snowflake",
      "Databricks",
      "Redshift",
      "Fivetran",
      "Stitch",
      "Airbyte",
      "dbt",
    ],
  },
  "ml-ai": {
    regex:
      /\b(?:model|training|inference|transformer|llm|gpt|claude|embedding|vector|neural|tensor|pytorch|tensorflow|hugging.?face|fine.?tun|prompt.?engineer|rag|agent)\b/i,
    keywords: [
      "model",
      "training",
      "inference",
      "transformer",
      "LLM",
      "GPT",
      "Claude",
      "embedding",
      "vector",
      "neural network",
      "tensor",
      "PyTorch",
      "TensorFlow",
      "Hugging Face",
      "fine-tune",
      "fine-tuning",
      "prompt engineering",
      "RAG",
      "retrieval augmented",
      "agent",
      "chain of thought",
      "few-shot",
      "zero-shot",
      "RLHF",
      "DPO",
      "tokenizer",
      "attention",
      "BERT",
      "diffusion",
      "GAN",
      "classification",
      "NLP",
      "computer vision",
      "object detection",
      "segmentation",
      "OCR",
      "speech to text",
      "text to speech",
      "OpenAI",
      "Anthropic",
      "Gemini",
      "Mistral",
      "Llama",
      "Ollama",
      "LangChain",
      "LlamaIndex",
      "Vercel AI SDK",
      "semantic search",
      "ONNX",
      "TensorRT",
      "quantization",
      "pruning",
      "distillation",
    ],
  },
  mobile: {
    regex:
      /\b(?:react.native|flutter|swift|kotlin|xcode|android.studio|ios|android|expo|capacitor|ionic|nativescript|swiftui|jetpack.compose|uikit|cocoapod|gradle)\b/i,
    keywords: [
      "React Native",
      "Flutter",
      "Swift",
      "Kotlin",
      "Xcode",
      "Android Studio",
      "iOS",
      "Android",
      "Expo",
      "Capacitor",
      "Ionic",
      "NativeScript",
      "SwiftUI",
      "Jetpack Compose",
      "UIKit",
      "CocoaPods",
      "Gradle",
      "APK",
      "IPA",
      "App Store",
      "Play Store",
      "push notification",
      "deep link",
      "universal link",
      "app clip",
      "widget",
      "gesture",
      "touch",
      "haptic",
      "camera",
      "GPS",
      "geolocation",
      "accelerometer",
      "biometric",
      "keychain",
      "AsyncStorage",
      "Core Data",
      "Room",
      "Realm",
      "SQLite",
      "navigation",
      "stack navigator",
      "tab navigator",
      "responsive",
      "adaptive layout",
      "safe area",
      "notch",
      "Dart",
      "Objective-C",
      "Java",
      "React Navigation",
      "Tauri",
    ],
  },
  "game-dev": {
    regex:
      /\b(?:unity|unreal|godot|shader|vertex|pixel|mesh|sprite|physics|collider|rigidbody|game.loop|render.pipeline|texture|material|scene|level|npc|ai.pathfinding|ecs)\b/i,
    keywords: [
      "Unity",
      "Unreal",
      "Godot",
      "shader",
      "vertex",
      "pixel",
      "mesh",
      "sprite",
      "physics",
      "collider",
      "rigidbody",
      "game loop",
      "render pipeline",
      "texture",
      "material",
      "scene",
      "level",
      "NPC",
      "AI pathfinding",
      "ECS",
      "entity component system",
      "frame rate",
      "delta time",
      "tick",
      "update",
      "draw call",
      "batch",
      "instancing",
      "LOD",
      "occlusion",
      "culling",
      "ray casting",
      "ray tracing",
      "HLSL",
      "GLSL",
      "ShaderLab",
      "particle system",
      "animation",
      "skeletal",
      "blend tree",
      "state machine",
      "navmesh",
      "A*",
      "steering",
      "flocking",
      "Bevy",
      "Phaser",
      "PixiJS",
      "Three.js",
      "Babylon.js",
      "PlayCanvas",
      "WebGL",
      "WebGPU",
      "Vulkan",
      "DirectX",
      "Metal",
      "OpenGL",
    ],
  },
  systems: {
    regex:
      /\b(?:rust|cargo|unsafe|borrow.checker|lifetime|pointer|memory.alloc|heap|stack|mutex|semaphore|kernel|syscall|driver|interrupt|assembly|wasm|zig|c\+\+|cmake|makefile)\b/i,
    keywords: [
      "Rust",
      "cargo",
      "unsafe",
      "borrow checker",
      "lifetime",
      "pointer",
      "memory allocation",
      "heap",
      "stack",
      "mutex",
      "semaphore",
      "kernel",
      "syscall",
      "driver",
      "interrupt",
      "assembly",
      "WASM",
      "WebAssembly",
      "Zig",
      "C++",
      "CMake",
      "Makefile",
      "linker",
      "compiler",
      "ABI",
      "FFI",
      "binding",
      "native",
      "shared library",
      "static library",
      "NAPI",
      "N-API",
      "buffer",
      "stream",
      "pipe",
      "file descriptor",
      "epoll",
      "io_uring",
      "async runtime",
      "tokio",
      "rayon",
      "crossbeam",
      "thread pool",
      "atomics",
      "lock-free",
      "wait-free",
      "SIMD",
      "AVX",
      "SSE",
      "NEON",
      "vectorization",
      "embedded",
      "RTOS",
      "bare metal",
      "firmware",
      "microcontroller",
    ],
  },
  blockchain: {
    regex:
      /\b(?:blockchain|smart.contract|solidity|ethereum|web3|defi|nft|token|wallet|metamask|hardhat|foundry|wagmi|viem|ethers)\b/i,
    keywords: [
      "blockchain",
      "smart contract",
      "Solidity",
      "Ethereum",
      "Web3",
      "DeFi",
      "NFT",
      "token",
      "wallet",
      "MetaMask",
      "Hardhat",
      "Foundry",
      "wagmi",
      "viem",
      "ethers.js",
      "ERC-20",
      "ERC-721",
      "ERC-1155",
      "gas",
      "wei",
      "gwei",
      "abi",
      "bytecode",
      "Solana",
      "Rust",
      "Anchor",
      "Cosmos",
      "Move",
      "Aptos",
      "Sui",
      "Polygon",
      "Arbitrum",
      "Optimism",
      "zkSync",
      "IPFS",
      "Arweave",
      "The Graph",
      "Chainlink",
      "oracle",
      "staking",
      "governance",
      "DAO",
      "multisig",
      "proxy pattern",
    ],
  },
  devops: {
    regex:
      /\b(?:monitoring|observability|logging|metrics|tracing|alert|grafana|prometheus|datadog|sentry|pagerduty|incident|sla|slo|sli|uptime|healthcheck|runbook)\b/i,
    keywords: [
      "monitoring",
      "observability",
      "logging",
      "metrics",
      "tracing",
      "alert",
      "Grafana",
      "Prometheus",
      "Datadog",
      "Sentry",
      "PagerDuty",
      "incident",
      "SLA",
      "SLO",
      "SLI",
      "uptime",
      "healthcheck",
      "runbook",
      "postmortem",
      "on-call",
      "escalation",
      "dashboard",
      "OpenTelemetry",
      "Jaeger",
      "Zipkin",
      "Loki",
      "Fluentd",
      "Logstash",
      "ELK",
      "Splunk",
      "New Relic",
      "Honeycomb",
      "APM",
      "RUM",
      "synthetic monitoring",
      "canary deploy",
      "blue-green",
      "rolling update",
      "feature flag",
      "LaunchDarkly",
      "Unleash",
      "split testing",
      "rollback",
      "GitOps",
    ],
  },
  documentation: {
    regex:
      /\b(?:readme|documentation|docusaurus|mkdocs|sphinx|jsdoc|tsdoc|typedoc|storybook|changelog|api.reference|tutorial|guide)\b/i,
    keywords: [
      "README",
      "documentation",
      "Docusaurus",
      "MkDocs",
      "Sphinx",
      "JSDoc",
      "TSDoc",
      "TypeDoc",
      "Storybook",
      "changelog",
      "API reference",
      "tutorial",
      "guide",
      "how-to",
      "quickstart",
      "migration guide",
      "release notes",
      "contributing",
      "code of conduct",
      "architecture decision record",
      "ADR",
      "RFC",
      "spec",
      "diagram",
      "Mermaid",
      "PlantUML",
      "sequence diagram",
      "markdown",
      "MDX",
      "remark",
      "rehype",
      "frontmatter",
    ],
  },
  payments: {
    regex:
      /\b(?:payment|stripe|paypal|billing|invoice|subscription|checkout|cart|order|refund|charge|payout|ledger|accounting)\b/i,
    keywords: [
      "payment",
      "Stripe",
      "PayPal",
      "billing",
      "invoice",
      "subscription",
      "checkout",
      "cart",
      "order",
      "refund",
      "charge",
      "payout",
      "ledger",
      "accounting",
      "tax",
      "VAT",
      "currency",
      "exchange rate",
      "webhook",
      "idempotency",
      "PCI",
      "3D Secure",
      "SCA",
      "recurring",
      "metered",
      "usage-based",
      "credit",
      "debit",
      "Paddle",
      "Lemon Squeezy",
      "Braintree",
      "Adyen",
      "Square",
    ],
  },
  search: {
    regex:
      /\b(?:search|elasticsearch|opensearch|algolia|meilisearch|typesense|full.text|fuzzy|autocomplete|facet|index|ranking|relevance)\b/i,
    keywords: [
      "search",
      "Elasticsearch",
      "OpenSearch",
      "Algolia",
      "Meilisearch",
      "Typesense",
      "full-text",
      "fuzzy",
      "autocomplete",
      "facet",
      "index",
      "ranking",
      "relevance",
      "stemming",
      "tokenizer",
      "analyzer",
      "inverted index",
      "BM25",
      "TF-IDF",
      "vector search",
      "semantic search",
      "hybrid search",
      "filter",
      "sort",
      "pagination",
      "highlight",
      "suggestion",
    ],
  },
  messaging: {
    regex:
      /\b(?:queue|message|kafka|rabbitmq|sqs|pubsub|event.bus|broker|producer|consumer|topic|partition|offset|dead.letter|redis.stream|nats|pulsar)\b/i,
    keywords: [
      "queue",
      "message",
      "Kafka",
      "RabbitMQ",
      "SQS",
      "pub/sub",
      "event bus",
      "broker",
      "producer",
      "consumer",
      "topic",
      "partition",
      "offset",
      "dead letter",
      "Redis Streams",
      "NATS",
      "Pulsar",
      "BullMQ",
      "Celery",
      "Sidekiq",
      "event-driven",
      "async",
      "at-least-once",
      "exactly-once",
      "idempotent",
      "CQRS",
      "event sourcing",
      "saga",
      "choreography",
      "orchestration",
    ],
  },
  media: {
    regex:
      /\b(?:image|video|audio|upload|stream|transcode|ffmpeg|sharp|cloudinary|s3|blob|cdn|thumbnail|resize|crop|watermark|player|hls|dash|webrtc)\b/i,
    keywords: [
      "image",
      "video",
      "audio",
      "upload",
      "stream",
      "transcode",
      "FFmpeg",
      "Sharp",
      "Cloudinary",
      "S3",
      "blob",
      "CDN",
      "thumbnail",
      "resize",
      "crop",
      "watermark",
      "player",
      "HLS",
      "DASH",
      "WebRTC",
      "codec",
      "bitrate",
      "resolution",
      "responsive image",
      "srcset",
      "picture element",
      "lazy loading",
      "progressive JPEG",
      "WebP",
      "AVIF",
      "SVG",
      "canvas",
      "Mux",
      "Cloudflare Stream",
      "Vercel Blob",
      "uploadthing",
    ],
  },
  i18n: {
    regex:
      /\b(?:i18n|l10n|internation|localiz|translate|locale|plural|rtl|ltr|intl|icu|gettext|po.file|xliff|formatjs|next-intl|react-i18next)\b/i,
    keywords: [
      "i18n",
      "l10n",
      "internationalization",
      "localization",
      "translate",
      "locale",
      "plural",
      "RTL",
      "LTR",
      "Intl",
      "ICU",
      "gettext",
      "PO file",
      "XLIFF",
      "FormatJS",
      "next-intl",
      "react-i18next",
      "vue-i18n",
      "number format",
      "date format",
      "currency format",
      "time zone",
      "CLDR",
      "BCP 47",
      "language tag",
      "fallback locale",
      "namespace",
      "interpolation",
    ],
  },
  accessibility: {
    regex:
      /\b(?:a11y|accessibility|aria|screen.reader|wcag|aaa?|keyboard.nav|focus.trap|alt.text|semantic|landmark|role=|tabindex|voiceover|nvda|jaws)\b/i,
    keywords: [
      "a11y",
      "accessibility",
      "ARIA",
      "screen reader",
      "WCAG",
      "AA",
      "AAA",
      "keyboard navigation",
      "focus trap",
      "alt text",
      "semantic",
      "landmark",
      "role",
      "tabindex",
      "VoiceOver",
      "NVDA",
      "JAWS",
      "color contrast",
      "skip link",
      "live region",
      "announce",
      "dialog",
      "modal",
      "focus management",
      "roving tabindex",
      "axe",
      "Lighthouse",
      "pa11y",
      "radix",
      "headless",
    ],
  },
  analytics: {
    regex:
      /\b(?:analytics|tracking|event.track|page.view|conversion|funnel|cohort|segment|mixpanel|amplitude|posthog|plausible|umami|gtm|google.analytics)\b/i,
    keywords: [
      "analytics",
      "tracking",
      "event tracking",
      "page view",
      "conversion",
      "funnel",
      "cohort",
      "Segment",
      "Mixpanel",
      "Amplitude",
      "PostHog",
      "Plausible",
      "Umami",
      "GTM",
      "Google Analytics",
      "attribution",
      "UTM",
      "referrer",
      "session",
      "bounce rate",
      "DAU",
      "MAU",
      "retention",
      "LTV",
      "churn",
      "ARPU",
      "heatmap",
      "session replay",
      "FullStory",
      "Hotjar",
    ],
  },
  logging: {
    regex:
      /\b(?:logger|log.level|winston|pino|bunyan|debug|trace|info|warn|error|structured.log|json.log|log.rotation|syslog|journald)\b/i,
    keywords: [
      "logger",
      "log level",
      "Winston",
      "Pino",
      "Bunyan",
      "debug",
      "trace",
      "info",
      "warn",
      "error",
      "fatal",
      "structured logging",
      "JSON log",
      "log rotation",
      "syslog",
      "journald",
      "stderr",
      "stdout",
      "log aggregation",
      "log shipping",
      "context",
      "correlation ID",
      "request ID",
      "trace ID",
      "sensitive data",
      "PII",
      "redact",
      "mask",
      "filter",
    ],
  },
  caching: {
    regex:
      /\b(?:cache|redis|memcached|cdn.cache|stale.while|cache.invalidat|ttl|lru|memoiz|http.cache|etag|last.modified|cache.control|service.worker.cache)\b/i,
    keywords: [
      "cache",
      "Redis",
      "Memcached",
      "CDN cache",
      "stale-while-revalidate",
      "cache invalidation",
      "TTL",
      "LRU",
      "MRU",
      "LFU",
      "memoize",
      "HTTP cache",
      "ETag",
      "Last-Modified",
      "Cache-Control",
      "service worker cache",
      "browser cache",
      "server cache",
      "distributed cache",
      "cache aside",
      "read through",
      "write through",
      "write behind",
      "cache stampede",
      "thundering herd",
      "Upstash",
      "Vercel KV",
      "Cloudflare KV",
      "Durable Objects",
    ],
  },
  configuration: {
    regex:
      /\b(?:config|env|dotenv|environment.variable|feature.flag|remote.config|schema.valid|zod|yup|joi|ajv|json.schema|yaml|toml|ini)\b/i,
    keywords: [
      "config",
      "env",
      "dotenv",
      "environment variable",
      "feature flag",
      "remote config",
      "schema validation",
      "Zod",
      "Yup",
      "Joi",
      "AJV",
      "JSON Schema",
      "YAML",
      "TOML",
      "INI",
      "secret management",
      "vault",
      "Doppler",
      "Infisical",
      "runtime config",
      "build-time config",
      "public config",
      "server-only",
      "client-only",
      "edge config",
    ],
  },
};

// ---------------------------------------------------------------------------
// Dynamic domain tracking
// ---------------------------------------------------------------------------

interface DynamicDomainEntry {
  name: string;
  tokens: string[];
  seenCount: number;
  firstSeen: number;
}

const dynamicDomains = new Map<string, DynamicDomainEntry>();
const unmatchedTokenFrequency = new Map<string, number>();

const DYNAMIC_DOMAIN_THRESHOLD = 20;
const DYNAMIC_TOKEN_MIN_FREQ = 5;
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "where",
  "when",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "not",
  "only",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "because",
  "as",
  "until",
  "while",
  "of",
  "at",
  "by",
  "for",
  "with",
  "about",
  "against",
  "between",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "to",
  "from",
  "up",
  "down",
  "in",
  "out",
  "on",
  "off",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "and",
  "but",
  "or",
  "nor",
  "if",
  "else",
  "also",
  "use",
  "using",
  "used",
  "make",
  "made",
  "get",
  "got",
  "set",
  "new",
  "old",
  "like",
  "want",
  "code",
  "file",
  "add",
  "change",
  "update",
  "create",
  "delete",
  "remove",
  "fix",
  "work",
  "function",
  "class",
  "method",
  "variable",
  "const",
  "let",
  "var",
  "import",
  "export",
  "return",
  "type",
  "interface",
  "string",
  "number",
  "boolean",
  "null",
  "undefined",
  "true",
  "false",
  "async",
  "await",
  "try",
  "catch",
  "throw",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "default",
  "void",
  "any",
  "object",
  "array",
  "map",
  "set",
  "promise",
  "callback",
]);

// ---------------------------------------------------------------------------
// Precomputed lookup structures
// ---------------------------------------------------------------------------

const DOMAIN_ENTRIES = Object.entries(DOMAIN_DEFS) as Array<
  [Exclude<BuiltinDomain, "general">, DomainDef]
>;

// ---------------------------------------------------------------------------
// Fast classification (hot path)
// ---------------------------------------------------------------------------

export function classifyDomainFast(text: string): Domain {
  if (!text) return "general";
  const lower = text.toLowerCase();
  for (const [domain, { regex }] of DOMAIN_ENTRIES) {
    if (regex.test(lower)) return domain;
  }
  for (const [name] of dynamicDomains) {
    const entry = dynamicDomains.get(name)!;
    for (const token of entry.tokens) {
      if (lower.includes(token)) return `custom:${name}` as Domain;
    }
  }
  return "general";
}

// ---------------------------------------------------------------------------
// Rich classification with confidence
// ---------------------------------------------------------------------------

export function classifyDomain(text: string): DomainClassification {
  if (!text) return { primary: "general", secondary: null, confidence: 0 };

  const scores = scoreDomains(text);
  if (scores.length === 0) {
    trackUnmatchedTokens(text);
    return { primary: "general", secondary: null, confidence: 0 };
  }

  const primary = scores[0];
  const secondary = scores.length > 1 && scores[1].score > 0.3 ? scores[1] : null;

  return {
    primary: primary.domain,
    secondary: secondary?.domain ?? null,
    confidence: primary.score,
  };
}

// ---------------------------------------------------------------------------
// Scoring (all domains)
// ---------------------------------------------------------------------------

export function scoreDomains(text: string): DomainScore[] {
  if (!text) return [];

  const lowerText = text.toLowerCase();
  const scores: DomainScore[] = [];

  for (const [domain, { keywords }] of DOMAIN_ENTRIES) {
    let matchCount = 0;
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      let idx = lowerText.indexOf(kwLower);
      while (idx !== -1) {
        matchCount++;
        idx = lowerText.indexOf(kwLower, idx + kwLower.length);
      }
    }

    if (matchCount > 0) {
      const normalizedScore = Math.min(matchCount / Math.max(keywords.length * 0.15, 1), 1.0);
      scores.push({
        domain,
        score: Math.round(normalizedScore * 1000) / 1000,
        matchCount,
      });
    }
  }

  for (const [name, entry] of dynamicDomains) {
    let matchCount = 0;
    for (const token of entry.tokens) {
      if (lowerText.includes(token)) matchCount++;
    }
    if (matchCount > 0) {
      scores.push({
        domain: `custom:${name}` as Domain,
        score: Math.round((matchCount / Math.max(entry.tokens.length * 0.3, 1)) * 1000) / 1000,
        matchCount,
      });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

// ---------------------------------------------------------------------------
// File-path inference
// ---------------------------------------------------------------------------

export function domainFromFiles(files: string[]): Domain {
  if (!files || files.length === 0) return "general";

  const joined = files.join(" ").toLowerCase();

  if (/\.test\.|\.spec\.|__tests__|test\/|tests\/|\.cy\.|\.pw\./.test(joined)) return "testing";
  if (/\.css|\.scss|\.sass|tailwind|styles\/|\.less/.test(joined)) return "css";
  if (/docker|\.yml|\.yaml|ci\/|\.github\/|deploy|infra\/|terraform|\.tf$/.test(joined))
    return "infra";
  if (/migration|schema\.prisma|\.sql|drizzle\/|prisma\//.test(joined)) return "database";
  if (/auth\/|login|session|permission|rbac/.test(joined)) return "auth";
  if (/api\/|routes\/|handler|controller|middleware|trpc/.test(joined)) return "api";
  if (/component|\.tsx|\.jsx|\.vue|\.svelte|pages\/|app\//.test(joined)) return "ui";
  if (/\.swift|\.kt|\.dart|android|ios\/|\.xcodeproj/.test(joined)) return "mobile";
  if (/\.shader|\.hlsl|\.glsl|unity|unreal|godot|\.gd/.test(joined)) return "game-dev";
  if (/\.py|notebook|\.ipynb|pandas|numpy|sklearn/.test(joined)) return "data-science";
  if (/model|training|\.onnx|\.pt|\.h5|huggingface/.test(joined)) return "ml-ai";
  if (/\.rs|cargo\.toml|\.zig|\.c$|\.cpp|\.h$|makefile/i.test(joined)) return "systems";
  if (/\.sol|hardhat|foundry|wagmi|web3/.test(joined)) return "blockchain";
  if (/grafana|prometheus|alert|monitor|observ/.test(joined)) return "devops";
  if (/\.md$|docs\/|readme|changelog/.test(joined)) return "documentation";
  if (/security|audit|vuln|cve|\.snyk/.test(joined)) return "security";
  if (/payment|stripe|billing|invoice|checkout/.test(joined)) return "payments";
  if (/search|elastic|algolia|meili/.test(joined)) return "search";
  if (/queue|kafka|rabbitmq|bull|worker/.test(joined)) return "messaging";
  if (/upload|media|image|video|stream/.test(joined)) return "media";
  if (/i18n|l10n|locale|translate|lang\//.test(joined)) return "i18n";
  if (/a11y|aria|accessibility/.test(joined)) return "accessibility";
  if (/analytics|tracking|segment|mixpanel|posthog/.test(joined)) return "analytics";
  if (/log|winston|pino|bunyan/.test(joined)) return "logging";
  if (/cache|redis|memcache/.test(joined)) return "caching";
  if (/config|\.env|dotenv|\.toml|\.ini/.test(joined)) return "configuration";

  return "general";
}

// ---------------------------------------------------------------------------
// Top domain convenience
// ---------------------------------------------------------------------------

export function topDomain(text: string): Domain {
  return classifyDomainFast(text);
}

// ---------------------------------------------------------------------------
// Batch classification
// ---------------------------------------------------------------------------

export function aggregateDomains(
  texts: string[],
): Array<{ domain: Domain; eventCount: number; totalScore: number }> {
  const domainMap = new Map<Domain, { eventCount: number; totalScore: number }>();

  for (const text of texts) {
    const scores = scoreDomains(text);
    if (scores.length === 0) continue;

    const best = scores[0];
    const existing = domainMap.get(best.domain);
    if (existing) {
      existing.eventCount++;
      existing.totalScore += best.score;
    } else {
      domainMap.set(best.domain, { eventCount: 1, totalScore: best.score });
    }
  }

  return Array.from(domainMap.entries())
    .map(([domain, stats]) => ({ domain, ...stats }))
    .sort((a, b) => b.eventCount - a.eventCount);
}

// ---------------------------------------------------------------------------
// Dynamic domain learning
// ---------------------------------------------------------------------------

function trackUnmatchedTokens(text: string): void {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  for (const word of words) {
    unmatchedTokenFrequency.set(word, (unmatchedTokenFrequency.get(word) ?? 0) + 1);
  }

  if (unmatchedTokenFrequency.size > 500) {
    promoteFrequentTokens();
  }
}

function promoteFrequentTokens(): void {
  const candidates: Array<[string, number]> = [];
  for (const [token, freq] of unmatchedTokenFrequency) {
    if (freq >= DYNAMIC_TOKEN_MIN_FREQ) {
      candidates.push([token, freq]);
    }
  }

  if (candidates.length < 3) {
    pruneInfrequent();
    return;
  }

  candidates.sort((a, b) => b[1] - a[1]);
  const topTokens = candidates.slice(0, 10).map(([t]) => t);
  const domainName = topTokens.slice(0, 3).join("-");

  const existing = dynamicDomains.get(domainName);
  if (existing) {
    existing.seenCount += candidates.reduce((s, [, f]) => s + f, 0);
    const newTokens = topTokens.filter((t) => !existing.tokens.includes(t));
    existing.tokens.push(...newTokens);
    if (existing.tokens.length > 30) existing.tokens = existing.tokens.slice(0, 30);
  } else if (candidates.reduce((s, [, f]) => s + f, 0) >= DYNAMIC_DOMAIN_THRESHOLD) {
    dynamicDomains.set(domainName, {
      name: domainName,
      tokens: topTokens,
      seenCount: candidates.reduce((s, [, f]) => s + f, 0),
      firstSeen: Date.now(),
    });
  }

  for (const [token] of candidates) {
    unmatchedTokenFrequency.delete(token);
  }

  pruneInfrequent();
}

function pruneInfrequent(): void {
  for (const [token, freq] of unmatchedTokenFrequency) {
    if (freq < 2) unmatchedTokenFrequency.delete(token);
  }
}

export function getDynamicDomains(): Array<{ name: string; tokens: string[]; seenCount: number }> {
  return [...dynamicDomains.values()].map((d) => ({
    name: d.name,
    tokens: d.tokens,
    seenCount: d.seenCount,
  }));
}

export function getUnmatchedTokenStats(): {
  totalTokens: number;
  topTokens: Array<[string, number]>;
} {
  const sorted = [...unmatchedTokenFrequency.entries()].sort((a, b) => b[1] - a[1]);
  return {
    totalTokens: unmatchedTokenFrequency.size,
    topTokens: sorted.slice(0, 20),
  };
}
