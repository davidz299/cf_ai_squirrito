// src/worker.ts
// Squirrito backend — generate-only /api/joke, save-on-consent /api/save (no weather)

export type Memory = {
  id: string;
  sessionId: string;
  locationText: string;
  lat: number;
  lng: number;
  joke: string;
  createdAt: number;
};

export type JokeRequest = {
  locationText: string;    // short label or summary of the scene
  surroundings?: string;   // what you see
  todayPlan?: string;      // what you're doing
  lat?: number;
  lng?: number;
};

export interface Env {
  AI: Ai;
  GEO_MEMORIES: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname.replace(/\/+$/, "");

    // CORS preflight
    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    if (path === "") {
      return withCors(
        new Response(
          "Squirrito API. Try POST /api/joke, POST /api/save, GET /api/memories, GET /api/memory/:id, GET /api/share/:id"
        )
      );
    }

    // --- Generate-only (DO NOT SAVE) ---
    if (path === "/api/joke" && method === "POST") {
      let body: JokeRequest;
      try { body = (await request.json()) as JokeRequest; }
      catch { return withCors(new Response("Invalid JSON", { status: 400 })); }

      if (!body.locationText || typeof body.locationText !== "string") {
        return withCors(new Response("locationText required", { status: 400 }));
      }

      // Optional, lightweight place enrichment (OK to fail silently)
      const placeInfo = await enrichPlace(body.lat, body.lng);

      const contextBits: string[] = [];
      if (placeInfo?.name) contextBits.push(`Nearby: ${placeInfo.name}`);
      if (placeInfo?.city) contextBits.push(`City: ${placeInfo.city}`);
      if (placeInfo?.country) contextBits.push(`Country: ${placeInfo.country}`);
      if (body.surroundings) contextBits.push(`Sees: ${body.surroundings}`);
      if (body.todayPlan) contextBits.push(`Doing: ${body.todayPlan}`);

      const system =
        "You are Squirrito 🐿️, a hyperactive, nut-hoarding comedy squirrel. " +
        "Make ONE funny, PG-13 joke based on the user’s immediate scene, landmarks, and situation. Don't include anything related to squirrels. " +
        "Use playful exaggeration, puns, and silly imagery. Ensure that the joke will make someone laugh. " +
        "Max 2 sentences. Avoid offensive stereotypes, politics, or tragedies. Act as if you're trying to make the reader smile. Add lighthearted jokes or playful remarks like (‘Let’s be real...’) or [funny comparison] (‘It’s like I'm Lionel Messi...’). Make sure the humor fits the context and doesn’t overshadow the main message, using relaxed and casual language to keep the tone fun and engaging. Balance the humor with helpful information, so the reader enjoys the content without losing the key point.";

      const prompt =
        `Scene label: "${body.locationText}"\n` +
        (contextBits.length ? `Context: ${contextBits.join(" • ")}\n` : "") +
        "Make one light, playful joke.";

      // Primary pass
      const base = await runWorkersAI(env, [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]);

      // Optional punch-up pass for extra fun
      const editorSys =
        "You are a comedy editor. Rewrite the joke to be sillier, pun-filled, and more surprising, " +
        "without being mean or offensive. Keep it 1–2 sentences.";
      const punched = await runWorkersAI(env, [
        { role: "system", content: editorSys },
        { role: "user", content: base }
      ]);

      const joke = punched || base;

      return withCors(new Response(JSON.stringify({ joke }), {
        headers: { "content-type": "application/json" },
      }));
    }

    // --- Save ONLY when user consents ---
    if (path === "/api/save" && method === "POST") {
      type SaveBody = {
        locationText: string;
        lat: number;
        lng: number;
        joke: string;
      };
      let body: SaveBody;
      try { body = (await request.json()) as SaveBody; }
      catch { return withCors(new Response("Invalid JSON", { status: 400 })); }

      if (!body.locationText || typeof body.joke !== "string") {
        return withCors(new Response("locationText and joke required", { status: 400 }));
      }

      const sessionId = getOrSetSessionId(request);
      const doId = env.GEO_MEMORIES.idFromName("GLOBAL");
      const stub = env.GEO_MEMORIES.get(doId);
      const saveRes = await stub.fetch("https://do/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          locationText: body.locationText,
          lat: typeof body.lat === "number" ? body.lat : 0,
          lng: typeof body.lng === "number" ? body.lng : 0,
          joke: body.joke,
        }),
      });
      if (!saveRes.ok) return withCors(new Response("Failed to save", { status: 500 }));
      const saved: Memory = await saveRes.json();

      return withCors(new Response(JSON.stringify(saved), {
        headers: {
          "content-type": "application/json",
          "Set-Cookie": `geosid=${sessionId}; Path=/; SameSite=Lax`,
        },
      }));
    }

    // --- List memories ---
    if (path === "/api/memories" && method === "GET") {
      const id = env.GEO_MEMORIES.idFromName("GLOBAL");
      const stub = env.GEO_MEMORIES.get(id);
      const res = await stub.fetch("https://do/memories");
      return withCors(new Response(await res.text(), {
        headers: { "content-type": "application/json" },
        status: res.status,
      }));
    }

    // --- Read by id ---
    {
      const m = path.match(/^\/api\/memory\/([a-f0-9-]+)$/i);
      if (m && method === "GET") {
        const id = env.GEO_MEMORIES.idFromName("GLOBAL");
        const stub = env.GEO_MEMORIES.get(id);
        const res = await stub.fetch(`https://do/by-id?id=${m[1]}`);
        return withCors(new Response(await res.text(), {
          headers: { "content-type": "application/json" },
          status: res.status,
        }));
      }
    }

    // --- Share card ---
    {
      const m = path.match(/^\/api\/share\/([a-f0-9-]+)$/i);
      if (m && method === "GET") {
        const id = env.GEO_MEMORIES.idFromName("GLOBAL");
        const stub = env.GEO_MEMORIES.get(id);
        const r = await stub.fetch(`https://do/by-id?id=${m[1]}`);
        if (!r.ok) return new Response("Not found", { status: 404 });
        const mem: Memory = await r.json();
        const svg = renderShareSVG(mem);
        return new Response(svg, {
          headers: {
            "content-type": "image/svg+xml",
            "cache-control": "public, max-age=31536000, immutable",
            "access-control-allow-origin": "*",
          },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// ---------------------- Durable Object ----------------------
export class GeoMemoryDO implements DurableObject {
  state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/save") && request.method === "POST") {
      const { sessionId, locationText, lat, lng, joke } = (await request.json()) as any;
      const mem: Memory = {
        id: crypto.randomUUID(),
        sessionId,
        locationText,
        lat: typeof lat === "number" ? lat : 0,
        lng: typeof lng === "number" ? lng : 0,
        joke,
        createdAt: Date.now(),
      };
      const stored = (await this.state.storage.get<Memory[]>("memories")) || [];
      stored.push(mem);
      await this.state.storage.put("memories", stored);
      return new Response(JSON.stringify(mem), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname.endsWith("/memories")) {
      const stored = (await this.state.storage.get<Memory[]>("memories")) || [];
      return new Response(JSON.stringify(stored), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname.endsWith("/by-id")) {
      const id = url.searchParams.get("id") || "";
      const stored = (await this.state.storage.get<Memory[]>("memories")) || [];
      const found = stored.find((m) => m.id === id);
      if (!found) return new Response("Not found", { status: 404 });
      return new Response(JSON.stringify(found), { headers: { "content-type": "application/json" } });
    }

    // (Optional dev helper)
    if (url.pathname.endsWith("/clear") && request.method === "POST") {
      await this.state.storage.delete("memories");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }

    return new Response("DO: Not found", { status: 404 });
  }
}

// ---------------------- AI helper with model fallback ----------------------
async function runWorkersAI(
  env: Env,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const candidates = [
    "@cf/meta/llama-3.3-8b-instruct",
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/mistral/mistral-7b-instruct"
  ];
  const errs: string[] = [];
  for (const model of candidates) {
    try {
      const { response } = await env.AI.run(model as any, { messages, max_tokens: 160 });
      if (response && typeof response === "string") return response;
      errs.push(`Model ${model} returned empty response.`);
    } catch (e: any) {
      errs.push(`Model ${model} error: ${e?.message || e?.toString?.() || 'unknown'}`);
    }
  }
  throw new Error(`Workers AI failed. Tried: ${candidates.join(", ")}. Details: ${errs.join(" | ")}`);
}

// ---------------------- helpers ----------------------
function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}
function withCors(res: Response): Response {
  const hdrs = new Headers(res.headers);
  hdrs.set("Access-Control-Allow-Origin", "*");
  hdrs.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  hdrs.set("Access-Control-Allow-Headers", "content-type");
  return new Response(res.body, { headers: hdrs, status: res.status });
}

function getOrSetSessionId(request: Request): string {
  const cookie = request.headers.get("cookie") || "";
  const m = /geosid=([^;]+)/.exec(cookie);
  if (m) return m[1];
  return crypto.randomUUID();
}

// Reverse geocode (OpenStreetMap Nominatim). OK to fail silently.
async function enrichPlace(lat?: number, lng?: number) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  try {
    const u = new URL("https://nominatim.openstreetmap.org/reverse");
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lon", String(lng));
    u.searchParams.set("zoom", "14");
    const res = await fetch(u.toString(), { headers: { "User-Agent": "Squirrito/1.0" } });
    const j = await res.json<any>();
    return {
      name: j.name || j.display_name?.split(",")[0],
      city: j.address?.city || j.address?.town || j.address?.village || j.address?.suburb,
      country: j.address?.country,
    };
  } catch {
    return null;
  }
}

// SVG share card
function renderShareSVG(mem: Memory) {
  const esc = (s: string) => s.replace(/[&<>\"]+/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const subtitle = `${mem.locationText} • ${new Date(mem.createdAt).toLocaleString()}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/><stop offset="100%" stop-color="#0a0f1c"/>
    </linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="20"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <circle cx="980" cy="140" r="120" fill="#2a61bf" filter="url(#s)" opacity="0.35"/>
  <text x="60" y="120" fill="#9fb7ff" font-family="system-ui" font-size="34" font-weight="600">Squirrito • Comedy Capsule</text>
  <text x="60" y="170" fill="#c9d6ff" font-family="system-ui" font-size="22" opacity="0.9">${esc(subtitle)}</text>

  <foreignObject x="60" y="220" width="1080" height="260">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: system-ui; color:#e6f0ff; font-size: 36px; line-height: 1.25; font-weight: 700;">
      “${esc(mem.joke)}”
    </div>
  </foreignObject>

  <g transform="translate(950, 360)">
    <circle cx="0" cy="0" r="140" fill="#0f1a35" stroke="#2e3e7a" stroke-width="2"/>
    <circle cx="0" cy="0" r="2" fill="#62ffb4"/>
    <circle cx="${(mem.lng / 180) * 120}" cy="${(-mem.lat / 90) * 60}" r="5" fill="#ff5a5f" opacity="0.9"/>
    <text x="-100" y="160" fill="#9fb7ff" font-family="system-ui" font-size="16">(${mem.lat.toFixed(3)}, ${mem.lng.toFixed(3)})</text>
  </g>
</svg>`;
}
