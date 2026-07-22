# Sysopolis — dev notes

Live isometric "ops-city" view of a running infrastructure. npm workspaces monorepo:

- `packages/core` — the locked IR contract (`src/ir.ts`), validator, deterministic
  layout, synthetic generator. Zero runtime deps; consumed **from source** by the other
  packages (vite alias + tsconfig paths), no build step.
- `packages/collector` — Node + tsx. `--synthetic` (fake enterprise + incident sim) or
  `--docker` (dockerode). Serves `GET /ir` + WS `/ws` on port 4400.
- `packages/app` — Vite + React 18 + R3F 8. Dev server on 5173, reads
  `VITE_COLLECTOR_URL` (default `http://localhost:4400`).

Commands: `npm run demo` (synthetic), `npm run demo:docker`, `npm run typecheck`,
`npm run build`, `npm run gen` (validate a synthetic city.json).

Conventions / invariants:
- The IR schema is **frozen** (documented in BUILD_PLAN + README). Any change to it must
  update `validate.ts` and the README together.
- Layout must stay deterministic: same IR in → same city out. No randomness outside the
  seeded generator.
- Hot path: `metrics` are mutated in place and read per-frame in `useFrame`; only status
  changes bump `statusVersion` and re-render React. Keep it that way.
- v2 ideas (nmap, k8s, security overlay…) are explicitly out of scope — see README roadmap.
