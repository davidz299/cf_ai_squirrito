# cf_ai_squirrito

GeoComedian is a tiny AI-powered app on Cloudflare that turns *where you are* into a joke. 
It also remembers jokes by location and plots them on a map you can share.

This repo satisfies the assignment requirements:

- **LLM**: Uses Workers AI (Llama 3.3) to generate location-based jokes.
- **Workflow / coordination**: Demonstrates Cloudflare **Workflows** and **Workers**, plus an **Agent** with callable methods.
- **User input via chat**: Simple chat UI on **Cloudflare Pages** (React + fetch).
- **Memory or state**: **Durable Objects** store per-user, per-location "memories" (jokes + coordinates).

Live components can be deployed with `wrangler`. You can also run locally with `wrangler dev`.

---

## Quick Start

### 1) Prereqs
- Node 18+
- `npm i -g wrangler` (or use `npx wrangler`)
- Cloudflare account with Workers AI access enabled

### 2) Install
```bash
npm install
```

### 3) Dev
Open two terminals:

**API / Worker + Durable Object + Workflows**
```bash
npx wrangler dev
```

**UI (Pages dev in /web)**
```bash
cd web
npm install
npm run dev
```

### 4) Deploy
```bash
# Deploy Worker + Durable Object + Workflows
npx wrangler deploy

# Deploy UI to Pages
cd web
npm run build
npx wrangler pages deploy dist --project-name geocomedian
```

---

## Repository Layout

```
cf_ai_geocomedian/
├─ src/
│  ├─ worker.ts              # Worker entry: routes, AI calls, DO alarms
│  ├─ agent.ts               # GeoComedianAgent (Agents API w/ callable methods)
│  └─ types.ts               # Shared types
├─ workflows/
│  └─ geocomedian.ts         # Cloudflare Workflows pipeline (generate + store)
├─ web/
│  ├─ index.html             # Vite entry for Pages
│  ├─ src/App.tsx            # Chat UI + Leaflet map
│  ├─ src/main.tsx
│  └─ package.json
├─ PROMPTS.md                # System/user prompts used for AI calls
├─ wrangler.toml             # Bindings for AI, DO, Workflows
├─ package.json              # Monorepo scripts
├─ tsconfig.json
└─ README.md
```

---

## Running Notes

- **Location input**: Type a city/neighborhood/landmark or click the map to pin. The app will reverse-use your typed location without external geocoding for the demo. Markers represent your *memories* (stored jokes) returned from the Worker.
- **State**: Durable Object `GeoMemoryDO` stores your memories keyed by a session id (cookie) and coarse lat/lng buckets.
- **Workflow**: `workflows/geocomedian.ts` composes steps: validate → call LLM → persist memory → return result.
- **Agent**: `src/agent.ts` shows how you can schedule and expose callable methods for external triggers (e.g., share daily “best local joke”).

> Tip: If you prefer KV or D1, swap the DO storage parts in `GeoMemoryDO` with KV/D1 calls.

---

## Assignment Checklist

- ✅ Repo name prefixed with `cf_ai_`
- ✅ README with **clear run/deploy instructions**
- ✅ LLM via **Workers AI**
- ✅ **Workflows/Workers/Durable Objects** for coordination and state
- ✅ **Pages** UI with chat + map
- ✅ **PROMPTS.md** included

---

## License

MIT
