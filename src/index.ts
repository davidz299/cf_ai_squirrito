// UI (inline HTML+JS) + API + Durable Object + Workers AI

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
    locationText: string;
    surroundings?: string;
    todayPlan?: string;
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
      const path = url.pathname.replace(/\/+$/, "");
      const method = request.method;
  
      // CORS preflight
      if (method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  
      // -------- API --------
      if (path === "/api/ping" && method === "GET") {
        return withCors(json({ ok: true }));
      }
  
      if (path === "/api/joke" && method === "POST") {
        let body: JokeRequest;
        try { body = (await request.json()) as JokeRequest; }
        catch { return withCors(text("Invalid JSON", 400)); }
        if (!body.locationText || typeof body.locationText !== "string") {
          return withCors(text("locationText required", 400));
        }
  
        const placeInfo = await enrichPlace(body.lat, body.lng);
        const bits: string[] = [];
        if (placeInfo?.name) bits.push(`Nearby: ${placeInfo.name}`);
        if (placeInfo?.city) bits.push(`City: ${placeInfo.city}`);
        if (placeInfo?.country) bits.push(`Country: ${placeInfo.country}`);
        if (body.surroundings) bits.push(`Sees: ${body.surroundings}`);
        if (body.todayPlan) bits.push(`Doing: ${body.todayPlan}`);
  
        const system =
          "You are Squirrito 🐿️, a hyperactive, nut-hoarding comedy squirrel. " +
          "Make ONE funny, PG-13 joke about the user’s immediate scene/landmarks/situation. Do NOT mention squirrels. " +
          "Keep it 1–2 sentences, kind, playful, surprising; avoid stereotypes/politics/tragedies. Do NOT assume the location of the user, do not mention which county you think the user, do not mention that the user is from the States, or weather." +
          "Casual tone allowed (e.g., 'Let’s be real…', fun comparisons).";
        const prompt =
          `Scene label: "${body.locationText}"\n` +
          (bits.length ? `Context: ${bits.join(" • ")}\n` : "") +
          "Produce exactly one short, playful joke.";
  
        let joke: string;
        try {
          joke = await runWorkersAI(env, [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ]);
        } catch {
          joke = "Let’s be real—this line is longer than the coffee queue ☕️. Here’s a smile while we connect!";
        }
        return withCors(json({ joke }));
      }
  
      if (path === "/api/save" && method === "POST") {
        type SaveBody = { locationText: string; lat: number; lng: number; joke: string };
        let body: SaveBody;
        try { body = (await request.json()) as SaveBody; }
        catch { return withCors(text("Invalid JSON", 400)); }
        if (!body.locationText || typeof body.joke !== "string") {
          return withCors(text("locationText and joke required", 400));
        }
        const sessionId = getOrSetSessionId(request);
        const id = env.GEO_MEMORIES.idFromName("GLOBAL");
        const stub = env.GEO_MEMORIES.get(id);
        const r = await stub.fetch("https://do/save", {
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
        if (!r.ok) return withCors(text("Failed to save", 500));
        const saved: Memory = await r.json();
        const res = json(saved);
        res.headers.set("Set-Cookie", `geosid=${sessionId}; Path=/; SameSite=Lax`);
        return withCors(res);
      }
  
      if (path === "/api/memories" && method === "GET") {
        const id = env.GEO_MEMORIES.idFromName("GLOBAL");
        const stub = env.GEO_MEMORIES.get(id);
        const r = await stub.fetch("https://do/memories");
        return withCors(new Response(await r.text(), {
          headers: { "content-type": "application/json" },
          status: r.status,
        }));
      }
  
      {
        const m = path.match(/^\/api\/memory\/([a-f0-9-]+)$/i);
        if (m && method === "GET") {
          const id = env.GEO_MEMORIES.idFromName("GLOBAL");
          const stub = env.GEO_MEMORIES.get(id);
          const r = await stub.fetch(`https://do/by-id?id=${m[1]}`);
          return withCors(new Response(await r.text(), {
            headers: { "content-type": "application/json" },
            status: r.status,
          }));
        }
      }
  
      {
        const m = path.match(/^\/api\/share\/([a-f0-9-]+)$/i);
        if (m && method === "GET") {
          const id = env.GEO_MEMORIES.idFromName("GLOBAL");
          const stub = env.GEO_MEMORIES.get(id);
          const r = await stub.fetch(`https://do/by-id?id=${m[1]}`);
          if (!r.ok) return text("Not found", 404);
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
  
      // -------- UI (inline) --------
      if (method === "GET" && !path.startsWith("/api/")) {
        return new Response(renderHTML(), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
  
      return text("Not found", 404);
    },
  } satisfies ExportedHandler<Env>;
  
  // ---------------- Durable Object ----------------
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
        return json(mem);
      }
  
      if (url.pathname.endsWith("/memories")) {
        const stored = (await this.state.storage.get<Memory[]>("memories")) || [];
        return json(stored);
      }
  
      if (url.pathname.endsWith("/by-id")) {
        const id = url.searchParams.get("id") || "";
        const stored = (await this.state.storage.get<Memory[]>("memories")) || [];
        const found = stored.find((m) => m.id === id);
        if (!found) return text("Not found", 404);
        return json(found);
      }
  
      if (url.pathname.endsWith("/clear") && request.method === "POST") {
        await this.state.storage.delete("memories");
        return json({ ok: true });
      }
  
      return text("DO: Not found", 404);
    }
  }
  
  // ---------------- Workers AI helper ----------------
  async function runWorkersAI(
    env: Env,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  ): Promise<string> {
    const models = [
      "@cf/meta/llama-3.3-8b-instruct",
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/mistral/mistral-7b-instruct",
    ];
    const errs: string[] = [];
    for (const model of models) {
      try {
        const p = env.AI.run(model as any, { messages, max_tokens: 120, temperature: 0.9 });
        const { response } = await withTimeout(p, 8000);
        if (typeof response === "string" && response.trim()) return response.trim();
        errs.push(`Empty response from ${model}`);
      } catch (e: any) {
        errs.push(`${model} error: ${e?.message || String(e)}`);
      }
    }
    throw new Error(errs.join(" | "));
  }
  
  // ---------------- Utilities ----------------
  function corsHeaders(): HeadersInit {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    };
  }
  function withCors(res: Response): Response {
    const h = new Headers(res.headers);
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    h.set("Access-Control-Allow-Headers", "content-type");
    return new Response(res.body, { headers: h, status: res.status });
  }
  function json(data: any, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  }
  function text(msg: string, status = 200) {
    return new Response(msg, { status, headers: { "content-type": "text/plain;charset=UTF-8" } });
  }
  function getOrSetSessionId(request: Request): string {
    const cookie = request.headers.get("cookie") || "";
    const m = /geosid=([^;]+)/.exec(cookie);
    if (m) return m[1];
    return crypto.randomUUID();
  }
  async function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
    const t = setTimeout(() => { /* guard only */ }, ms);
    try { return await p; } finally { clearTimeout(t); }
  }
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
  function renderShareSVG(mem: Memory) {
    const esc = (s: string) => s.replace(/[&<>\"]+/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const subtitle = `${mem.locationText} • ${new Date(mem.createdAt).toLocaleString()}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0b1020"/><stop offset="100%" stop-color="#0a0f1c"/>
      </linearGradient>
      <filter id="s" x="-20%" y="-20%" width="140%">
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
  
  // ---------------- Inline UI (no build) ----------------
  function renderHTML() {
    // Uses MapLibre from CDN and vanilla JS. Chat on left, map on right.
    return /* html */ `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Squirrito</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🐿️%3C/text%3E%3C/svg%3E">
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.css" />
    <style>
      :root { --bg1:#0b1020; --bg2:#070c18; --text:#e6f0ff; --muted:#a9b8d9; }
      html, body { height:100%; margin:0; }
      body { background: radial-gradient(ellipse at center, var(--bg1) 0%, var(--bg2) 70%); color:var(--text); font-family:'Nunito', system-ui, sans-serif; }
      #app { position:fixed; inset:0; display:grid; grid-template-columns: 460px 1fr; }
    #panel { padding:18px; background:linear-gradient(180deg, var(--bg1), var(--bg2)); border-right:1px solid rgba(255,255,255,.08); display:grid; grid-template-rows:auto minmax(0,1fr) auto auto; gap:12px; overflow:hidden; }
    .brand { display:flex; align-items:center; gap:12px; }
    .avatar { width:50px; height:50px; border-radius:999px; display:grid; place-items:center; background:linear-gradient(135deg,#8ef1ff,#a58bff); }
    .brandTitle { font-size:26px; font-weight:900; letter-spacing:-.01em; }
    .brandSub { font-size:13px; opacity:.85; }
    #chat { overflow-y:auto; min-height:0; padding-right:6px; border-radius:12px; }
    .row { display:flex; gap:10px; align-items:flex-start; margin:10px 0; }
    .row.me { justify-content:flex-end; }
    .row.me .avSm { display:none; }
    .avSm { width:30px; height:30px; border-radius:999px; display:grid; place-items:center; background:linear-gradient(135deg,#8ef1ff,#a58bff); flex:0 0 auto; margin-top:2px;}
    .bubble { background:#0f172a; border:1px solid rgba(255,255,255,.08); padding:10px 12px; border-radius:16px; max-width:340px; font-size:14px; line-height:1.5; }
    .joke { background:#0f1c2f; border-color:rgba(110,190,255,.25); font-weight:800; }
    .bubble.me { background:rgba(255,255,255,.035); border:1px solid rgba(255,255,255,.14); color:var(--text); }
    .controls { display:grid; grid-template-columns:1fr 116px; gap:10px; width:100%; }
    .controls > * { width:100%; box-sizing:border-box; }
    input { padding:12px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.1); background:#0e1524; color:var(--text); font-size:15px; outline:none; }
    button { padding:12px 16px; border-radius:14px; border:1px solid #1f2b4a; background:#2c5fff; color:#eef4ff; cursor:pointer; font-weight:800; font-size:15px; }
    button.ghost { background:#0f1626; border:1px solid rgba(255,255,255,.14); font-weight:700; }
    .mini { background:#0f1626; border:1px solid rgba(255,255,255,.08); padding:10px; border-radius:12px; margin-top:8px; }
    .mini .t { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:rgba(200,220,255,.8); margin-bottom:2px; }
    #chat::-webkit-scrollbar { width:10px; }
    #chat::-webkit-scrollbar-track { background:transparent; }
    #chat::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:8px; }
    #chat::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,.22); }

      input { padding:12px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.1); background:#0e1524; color:var(--text); font-size:15px; outline:none; }
      button { padding:12px 16px; border-radius:14px; border:1px solid #1f2b4a; background:#2c5fff; color:#eef4ff; cursor:pointer; font-weight:800; font-size:15px; }
      button.ghost { background:#0f1626; border:1px solid rgba(255,255,255,.14); font-weight:700; }
      .mini { background:#0f1626; border:1px solid rgba(255,255,255,.08); padding:10px; border-radius:12px; margin-top:8px; }
      .mini .t { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:rgba(200,220,255,.8); margin-bottom:2px; }
      #map { height:100vh; }
      .popup { font:14px Nunito, system-ui, sans-serif; color:#0b1020; line-height:1.45; }
      .popup .loc { opacity:.75; }
      .popup .jk { margin-top:8px; font-weight:800; line-height:1.35; }
    </style>
  </head>
  <body>
    <div id="app">
      <div id="panel">
        <div class="brand">
          <div class="avatar"><span style="font-size:30px; transform:translateY(1px)">🐿️</span></div>
          <div>
            <div class="brandTitle">Squirrito</div>
            <div class="brandSub">Your cheerful joke-hoarding agent</div>
          </div>
        </div>
  
        <div id="chat"></div>
  
        <div class="controls">
          <input id="input" placeholder="Where are you and what are you doing?" />
          <button id="send">Send</button>
        </div>
  
        <div class="mini">
          <div class="t">Selected coordinates</div>
          <div id="coords" class="b">Click the map to set a pin (I’ll ask when needed).</div>
        </div>
      </div>
      <div id="map"></div>
    </div>
  
    <script src="https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js"></script>
    <script>
    (function(){
      const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
      const $chat = document.getElementById('chat');
      const $input = document.getElementById('input');
      const $send = document.getElementById('send');
      const $coords = document.getElementById('coords');
  
      let map, selected = null, markers = {}, busy = false, needLocation = false;
      let lastJoke = null;
  
      function esc(s){ return s.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  
      function addMsg(role, text, kind){
        const row = document.createElement('div');
        row.className = 'row' + (role==='me' ? ' me':'');
        if(role==='bot'){
          const av = document.createElement('div');
          av.className = 'avSm';
          av.innerHTML = '<span style="font-size:18px">🐿️</span>';
          row.appendChild(av);
        }
        const b = document.createElement('div');
        b.className = 'bubble ' + (role==='me' ? 'me' : (kind==='joke' ? 'joke' : ''));
        (text||'').split('\\n').forEach(line => {
          const d = document.createElement('div'); d.textContent = line; b.appendChild(d);
        });
        if(kind==='consent'){
          const c = document.createElement('div'); c.style='display:flex;gap:8px;margin-top:10px';
          const y = document.createElement('button'); y.textContent='Yes, hoard it!'; y.onclick=()=>onConsent(true); c.appendChild(y);
          const n = document.createElement('button'); n.textContent='No thanks'; n.className='ghost'; n.onclick=()=>onConsent(false); c.appendChild(n);
          b.appendChild(c);
        }
        if(kind==='again'){
          const c = document.createElement('div'); c.style='display:flex;gap:8px;margin-top:10px';
          const y = document.createElement('button'); y.textContent='Yes, another!'; y.onclick=()=>onAskAgain(true); c.appendChild(y);
          const n = document.createElement('button'); n.textContent='No, I’m good'; n.className='ghost'; n.onclick=()=>onAskAgain(false); c.appendChild(n);
          b.appendChild(c);
        }
        row.appendChild(b);
        $chat.appendChild(row);
        $chat.scrollTop = $chat.scrollHeight;
      }
  
      function setCoords(ll){
        selected = ll;
        if(ll) $coords.textContent = '('+ll.lat.toFixed(4)+', '+ll.lng.toFixed(4)+')';
        else $coords.textContent = 'Click the map to set a pin (I’ll ask when needed).';
      }
  
      function flyTo(ll, z){ map && map.flyTo({ center:[ll.lng,ll.lat], zoom: z||6, speed:0.7, curve:1.4, essential:true }); }
  
      async function forwardGeocode(q){
        try{
          const u = new URL('https://nominatim.openstreetmap.org/search');
          u.searchParams.set('format','jsonv2'); u.searchParams.set('q', q); u.searchParams.set('limit','1');
          const r = await fetch(u.toString(), { headers:{'User-Agent':'Squirrito/1.0'} });
          const j = await r.json();
          if(j && j[0]) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
        }catch(e){}
        return null;
      }
  
      async function handleSend(){
        const text = ($input.value||'').trim();
        if(!text || busy) return;
        $input.value=''; addMsg('me', text);
  
        if(needLocation && lastJoke){
          const hit = await forwardGeocode(text);
          if(hit){
            setCoords(hit); flyTo(hit,10);
            await actuallySave(lastJoke, hit);
            addMsg('bot', 'Thanks! Acorn planted at "'+text+'". 🌰📍');
            addMsg('bot', 'Would you like another joke?', 'again');
          }else{
            addMsg('bot', 'Hmm, I couldn’t find that spot. You can also click the map to drop a pin and say “save it”.');
          }
          needLocation = false;
          return;
        }
  
        await makeJoke(text);
      }
  
      async function makeJoke(sceneText){
        busy = true;
        addMsg('bot', 'Squirrito is typing… 🐿️💭');
        const thinking = $chat.lastElementChild;
  
        const ll = selected || (map ? { lng: map.getCenter().lng, lat: map.getCenter().lat } : { lng:0, lat:0 });
        let res;
        try{
          res = await fetch('/api/joke', {
            method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({
              locationText: sceneText.slice(0,80),
              surroundings: sceneText,
              todayPlan: '',
              lat: ll.lat, lng: ll.lng
            })
          });
        }catch(e){
          thinking.remove();
          addMsg('bot','Network hiccup. Kick the router gently and try again?');
          busy = false; return;
        }
        thinking.remove();
        if(!res.ok){ addMsg('bot','Hmm, the comedy acorn slipped. (Error '+res.status+')'); busy = false; return; }
        const data = await res.json();
        const joke = data.joke || 'Coffee first, punchlines later ☕️';
        addMsg('bot', joke, 'joke');
        lastJoke = { joke, sceneLabel: sceneText.slice(0,80) };
        addMsg('bot','Can I hoard your joke like I hoard my nuts, and add it to the map of funny laughs?','consent');
        busy = false;
      }
  
      async function actuallySave(j, ll){
        try{
          const r = await fetch('/api/save', {
            method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({ locationText: j.sceneLabel, lat: ll.lat, lng: ll.lng, joke: j.joke })
          });
          if(r.ok){ await refreshMemories(); }
          else addMsg('bot','Uh-oh, I dropped the acorn while saving. Try again?');
        }catch{ addMsg('bot','Uh-oh, I dropped the acorn while saving. Try again?'); }
      }
  
      async function onConsent(yes){
        if(!lastJoke){ addMsg('bot','No joke to hoard yet! Tell me what you’re seeing and I’ll make one. 😅'); return; }
        if(yes){
          if(selected){
            await actuallySave(lastJoke, selected);
            addMsg('bot','Acorn acquired! Your laugh is safely hoarded on the map. 🌰🗺️');
            addMsg('bot','Would you like another joke?','again'); return;
          }
          // try geolocation
          try{
            await new Promise(res => navigator.geolocation.getCurrentPosition(
              pos => { const ll = { lat:pos.coords.latitude, lng:pos.coords.longitude };
                       setCoords(ll); flyTo(ll,10); res(null); },
              _ => res(null), { enableHighAccuracy:true, timeout:8000, maximumAge:30000 }
            ));
          }catch{}
          if(selected){
            await actuallySave(lastJoke, selected);
            addMsg('bot','Acorn acquired! Your laugh is safely hoarded on the map. 🌰🗺️');
            addMsg('bot','Would you like another joke?','again'); return;
          }
          addMsg('bot','I couldn’t get your location. Type where this joke happened (like "Eiffel Tower" or "Toronto, Canada").');
          needLocation = true; return;
        }else{
          addMsg('bot', 'No worries! I’ll keep this one in my cheek pouches only.');
          addMsg('bot','Would you like another joke?','again');
        }
      }
      function onAskAgain(yes){
        if(yes) addMsg('bot','Awesome! Tell me what you’re doing or what’s around you.');
        else addMsg('bot','I’ll be here, polishing my acorns. Come back anytime! 🌰');
      }
  
      async function refreshMemories(){
        try{
          const r = await fetch('/api/memories'); if(!r.ok) return;
          const list = await r.json();
          // clear existing markers
          Object.values(markers).forEach(m=>m.remove()); markers = {};
          for(const m of list){
            if(!isFinite(m.lat)||!isFinite(m.lng)) continue;
            const mk = new maplibregl.Marker({ color:'#ff5a5f' })
              .setLngLat([m.lng, m.lat])
              .setPopup(new maplibregl.Popup({ closeButton:false, maxWidth:'340px' })
                .setHTML('<div class="popup"><div class="loc">'+esc(m.locationText)+'</div><div class="jk">'+esc(m.joke)+'</div></div>'))
              .addTo(map);
            markers[m.id] = mk;
          }
        }catch{}
      }
  
      // init UI
      addMsg('bot', "Hi I'm Squirrito! 🐿️ I'm here to make you LAUGH and brighten your day!\\n\\nWhat are you doing right now? Or what is around you?");
      $send.addEventListener('click', handleSend);
      $input.addEventListener('keydown', e => { if(e.key==='Enter') handleSend(); });
  
      // init map
      map = new maplibregl.Map({ container:'map', style: STYLE_DARK, center:[0,20], zoom:1.5, attributionControl:false });
      map.addControl(new maplibregl.NavigationControl({ showZoom:true }), 'bottom-right');
      map.addControl(new maplibregl.ScaleControl({ maxWidth:100, unit:'metric' }), 'bottom-left');
  
      map.on('load', async () => {
        map.flyTo({ center:[-98.35,39.5], zoom:3.8, speed:0.6, curve:1.4, essential:true });
        await refreshMemories();
        map.on('click', e => {
          const ll = { lng:e.lngLat.lng, lat:e.lngLat.lat };
          setCoords(ll); flyTo(ll);
        });
      });
  
      // deep link: /m/:id
      const mm = location.pathname.match(/^\\/m\\/([a-f0-9-]+)/i);
      if(mm){
        fetch('/api/memory/'+mm[1]).then(async r=>{
          if(!r.ok) return; const mem = await r.json();
          setCoords({lat: mem.lat, lng: mem.lng}); map && map.flyTo({ center:[mem.lng, mem.lat], zoom:11, speed:0.7, curve:1.4 });
          setTimeout(()=>{ const mk = markers[mem.id]; if(mk) mk.togglePopup(); }, 600);
        });
      }
    })();
    </script>
  </body>
  </html>`;
}
  