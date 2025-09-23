// web/src/App.tsx
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { Map, Marker, LngLatLike } from 'maplibre-gl';
import React, { useEffect, useRef, useState } from 'react';

type Memory = {
  id: string;
  sessionId: string;
  locationText: string;
  lat: number;
  lng: number;
  joke: string;
  createdAt: number;
};

type ChatMsg = {
  id: string;
  role: 'bot' | 'user';
  text: string;
  kind?: 'plain' | 'joke' | 'consent' | 'again' | 'needLocation';
};

const API = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8787';
const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Record<string, Marker>>({});
  const [memories, setMemories] = useState<Memory[]>([]);

  const [selected, setSelected] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const [needLocationPending, setNeedLocationPending] = useState(false);

  const lastJokeRef = useRef<{ joke: string; sceneLabel: string } | null>(null);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: 'map',
      style: STYLE_DARK,
      center: [0, 20],
      zoom: 1.5,
      attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ showZoom: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.flyTo({
        center: [-98.35, 39.5],
        zoom: 3.8,
        speed: 0.6,
        curve: 1.4,
        essential: true
      });

      refreshMemories();

      map.on('click', (e) => {
        const ll = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        setSelected(ll);
        flyTo(ll);
      });
    });

    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    memories.forEach((m) => {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) return;
      const mk = new maplibregl.Marker({ color: '#ff5a5f' })
        .setLngLat([m.lng, m.lat])
        .setPopup(
          new maplibregl.Popup({ closeButton: false, maxWidth: '340px' }).setHTML(
            `<div style="font: 14px Nunito, system-ui, sans-serif; color:#0b1020; line-height:1.45;">
               <div style="opacity:.75">${escapeHtml(m.locationText)}</div>
               <div style="margin-top:8px;font-weight:800;line-height:1.35">${escapeHtml(m.joke)}</div>
             </div>`
          )
        )
        .addTo(map);
      markersRef.current[m.id] = mk;
    });
  }, [memories]);

  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/m\/([a-f0-9-]+)/i);
    if (!match) return;
    const id = match[1];
    (async () => {
      const res = await fetch(`${API}/api/memory/${id}`);
      if (!res.ok) return;
      const mem: Memory = await res.json();
      setMemories((prev) => (prev.find((x) => x.id === mem.id) ? prev : [...prev, mem]));
      const ll = { lng: mem.lng, lat: mem.lat };
      setSelected(ll);
      flyTo(ll, 11);
      setTimeout(() => markersRef.current[mem.id]?.togglePopup(), 400);
    })();
  }, []);

  useEffect(() => {
    setMessages([
      botMsg(
        `Hi I'm Squirrito! 🐿️ I'm here to make you LAUGH and brighten your day! ` +
          `Prepare yourself for boundless joy.\n\n` +
          `What are you doing right now? Or what is around you?`
      )
    ]);
  }, []);

  async function refreshMemories() {
    const res = await fetch(`${API}/api/memories`);
    setMemories(await res.json());
  }

  function flyTo(ll: { lng: number; lat: number }, z: number = 6) {
    mapRef.current?.flyTo({ center: [ll.lng, ll.lat] as LngLatLike, zoom: z, speed: 0.7, curve: 1.4, essential: true });
  }

  function getLocationOnce(): Promise<{ lat: number; lng: number } | null> {
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation not supported');
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const ll = { lng: pos.coords.longitude, lat: pos.coords.latitude };
          setSelected(ll);
          flyTo(ll, 10);
          setGeoError(null);
          resolve({ lat: ll.lat, lng: ll.lng });
        },
        (err) => {
          setGeoError(err.message || 'Unable to access location');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  async function forwardGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
    try {
      const u = new URL('https://nominatim.openstreetmap.org/search');
      u.searchParams.set('format', 'jsonv2');
      u.searchParams.set('q', query);
      u.searchParams.set('limit', '1');
      const res = await fetch(u.toString(), { headers: { 'User-Agent': 'Squirrito/1.0' } });
      const j = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (j && j[0]) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
    } catch {}
    return null;
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    append(userMsg(text));

    // If we were waiting for a location from the user, treat this input as a place query
    if (needLocationPending && lastJokeRef.current) {
      const hit = await forwardGeocode(text);
      if (hit) {
        setSelected(hit);
        flyTo(hit, 10);
        await actuallySave(lastJokeRef.current, hit);
        append(botMsg(`Thanks! Acorn planted at "${text}". 🌰📍`));
        append(botMsg(`Would you like another joke?`, 'again'));
      } else {
        append(botMsg(`Hmm, I couldn’t find that spot. You can also click the map to drop a pin and say “save it”.`));
      }
      setNeedLocationPending(false);
      return;
    }

    // Normal flow: generate-only
    await makeJokeFromScene(text);
  }

  async function makeJokeFromScene(sceneText: string) {
    setBusy(true);
    try {
      const thinkingId = crypto.randomUUID();
      append(botMsg('Squirrito is typing… 🐿️💭', 'plain', thinkingId));

      const ll =
        selected ??
        (mapRef.current
          ? { lng: mapRef.current.getCenter().lng, lat: mapRef.current.getCenter().lat }
          : { lng: 0, lat: 0 });

      const res = await fetch(`${API}/api/joke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locationText: sceneText.slice(0, 80),
          surroundings: sceneText,
          todayPlan: '',
          lat: ll.lat,
          lng: ll.lng
        })
      });

      removeMsg(thinkingId);

      if (!res.ok) {
        append(botMsg(`Hmm, the comedy acorn slipped. (Error ${res.status})`, 'plain'));
        return;
      }
      const data = await res.json();
      const joke = data.joke as string;

      append(botMsg(joke, 'joke'));
      lastJokeRef.current = { joke, sceneLabel: sceneText.slice(0, 80) };
      append(botMsg(`Can I hoard your joke like I hoard my nuts, and add it to the map of funny laughs?`, 'consent'));
    } finally {
      setBusy(false);
    }
  }

  async function actuallySave(j: { joke: string; sceneLabel: string }, ll: { lat: number; lng: number }) {
    const res = await fetch(`${API}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        locationText: j.sceneLabel,
        lat: ll.lat,
        lng: ll.lng,
        joke: j.joke
      })
    });
    if (res.ok) {
      await refreshMemories();
    } else {
      append(botMsg(`Uh-oh, I dropped the acorn while saving. Try again?`));
    }
  }

  async function onConsent(yes: boolean) {
    if (!lastJokeRef.current) {
      append(botMsg(`No joke to hoard yet! Tell me what you’re seeing and I’ll make one. 😅`));
      return;
    }

    if (yes) {
      // If we already have a selected pin, save right away
      if (selected) {
        await actuallySave(lastJokeRef.current, selected);
        append(botMsg(`Acorn acquired! Your laugh is safely hoarded on the map. 🌰🗺️`));
        append(botMsg(`Would you like another joke?`, 'again'));
        return;
      }

      // Try geolocation
      const ll = await getLocationOnce();
      if (ll) {
        await actuallySave(lastJokeRef.current, ll);
        append(botMsg(`Acorn acquired! Your laugh is safely hoarded on the map. 🌰🗺️`));
        append(botMsg(`Would you like another joke?`, 'again'));
        return;
      }

      // Couldn’t get location → ask in chat (no browser prompt)
      append(
        botMsg(
          `I couldn’t get your current location to save the joke. 🌍 Can you type where this joke happened (like "Eiffel Tower" or "Toronto, Canada")?`,
          'needLocation'
        )
      );
      setNeedLocationPending(true);
      return;
    } else {
      append(botMsg(`No worries! I’ll keep this one in my cheek pouches only. 😇`));
      append(botMsg(`Would you like another joke?`, 'again'));
    }
  }

  function onAskAgain(yes: boolean) {
    if (yes) {
      append(botMsg(`Awesome! Tell me what you’re doing or what’s around you.`));
    } else {
      append(botMsg(`I’ll be here, polishing my acorns. Come back anytime! 🌰`));
    }
  }

  function append(msg: ChatMsg) {
    setMessages((m) => [...m, msg]);
    setTimeout(scrollChatToBottom, 0);
  }
  function removeMsg(id: string) {
    setMessages((m) => m.filter((x) => x.id !== id));
  }
  function botMsg(text: string, kind: ChatMsg['kind'] = 'plain', id?: string): ChatMsg {
    return { id: id || crypto.randomUUID(), role: 'bot', text, kind };
  }
  function userMsg(text: string): ChatMsg {
    return { id: crypto.randomUUID(), role: 'user', text, kind: 'plain' };
  }
  function scrollChatToBottom() {
    const el = document.getElementById('chat-scroll');
    if (el) el.scrollTop = el.scrollHeight;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateColumns: '460px 1fr' }}>
      <div style={panelStyle}>
        <div style={brandRow}>
          <div style={avatarCircle} aria-hidden>
            <span style={{ fontSize: 30, transform: 'translateY(1px)' }}>🐿️</span>
          </div>
          <div>
            <div style={brandTitle}>Squirrito</div>
            <div style={brandSub}>Your cheerful joke-hoarding agent</div>
          </div>
        </div>

        <div id="chat-scroll" style={chatScroll}>
          {messages.map((m) =>
            m.role === 'bot' ? (
              <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '10px 0' }}>
                <div style={avatarSm}><span style={{ fontSize: 18 }}>🐿️</span></div>
                <div style={{ ...bubble, ...(m.kind === 'joke' ? bubbleJoke : {}), fontSize: 16 }}>
                  {m.text.split('\n').map((line, i) => (<div key={i}>{line}</div>))}
                  {m.kind === 'consent' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => onConsent(true)} style={btnPrimarySm}>Yes, hoard it!</button>
                      <button onClick={() => onConsent(false)} style={btnGhostSm}>No thanks</button>
                    </div>
                  )}
                  {m.kind === 'again' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => onAskAgain(true)} style={btnPrimarySm}>Yes, another!</button>
                      <button onClick={() => onAskAgain(false)} style={btnGhostSm}>No, I’m good</button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
                <div style={bubbleMe}>{m.text}</div>
              </div>
            )
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Describe your moment… e.g., campus Starbucks line, laptop at 3%, sticky notes"
            style={inputStyle}
            disabled={busy}
          />
          <button onClick={handleSend} style={btnPrimary} disabled={busy}>Send</button>
        </div>

        {geoError && <p style={{ color: '#ffb4b4', marginTop: 8, fontSize: 13 }}>Location: {geoError}</p>}

        <div style={miniCard}>
          <div style={miniTitle}>Selected coordinates</div>
          <div style={miniBody}>
            {selected ? `(${selected.lat.toFixed(4)}, ${selected.lng.toFixed(4)})` : 'Click the map to set a pin (I’ll ask when needed).'}
          </div>
        </div>
      </div>

      <div id="map" />
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const panelStyle: React.CSSProperties = {
  padding: 18,
  background: 'linear-gradient(180deg, #0b1020 0%, #070c18 100%)',
  color: '#e6f0ff',
  borderRight: '1px solid rgba(255,255,255,0.08)',
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: 'auto 1fr auto auto',
  gap: 12,
  fontFamily: "'Nunito', system-ui, sans-serif"
};

const brandRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 2 };
const brandTitle: React.CSSProperties = { fontSize: 24, fontWeight: 900, letterSpacing: '-0.01em' };
const brandSub: React.CSSProperties = { fontSize: 13, opacity: 0.8 };
const avatarCircle: React.CSSProperties = {
  width: 48, height: 48, borderRadius: 999,
  display: 'grid', placeItems: 'center',
  background: 'linear-gradient(135deg,#8ef1ff,#a58bff)'
};
const avatarSm: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 999,
  display: 'grid', placeItems: 'center',
  background: 'linear-gradient(135deg,#8ef1ff,#a58bff)',
  flex: '0 0 auto', marginTop: 2
};

const chatScroll: React.CSSProperties = {
  overflowY: 'auto',
  paddingRight: 6,
  margin: '4px 0 10px',
  borderRadius: 12
};

const bubble: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid rgba(255,255,255,0.08)',
  padding: '12px 14px',
  borderRadius: 16,
  maxWidth: 340,
  fontSize: 16,
  lineHeight: 1.55
};
const bubbleJoke: React.CSSProperties = {
  background: '#0f1c2f',
  borderColor: 'rgba(110,190,255,0.25)',
  fontWeight: 800
};
const bubbleMe: React.CSSProperties = {
  background: '#14233a',
  border: '1px solid rgba(255,255,255,0.08)',
  padding: '12px 14px',
  borderRadius: 16,
  maxWidth: 340,
  fontSize: 16,
  lineHeight: 1.55
};

const inputStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#0e1524',
  color: '#e6f0ff',
  fontSize: 15,
  outline: 'none',
  fontFamily: "'Nunito', system-ui, sans-serif"
};
const btnPrimary: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 14, border: '1px solid #1f2b4a', background: '#2c5fff', color: '#eef4ff',
  cursor: 'pointer', fontWeight: 800, fontSize: 15, fontFamily: "'Nunito', system-ui, sans-serif"
};
const btnPrimarySm: React.CSSProperties = { ...btnPrimary, padding: '9px 12px', fontSize: 14 };
const btnGhostSm: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)', background: '#0f1626', color: '#eef4ff',
  cursor: 'pointer', fontWeight: 700, fontSize: 14, fontFamily: "'Nunito', system-ui, sans-serif"
};

const miniCard: React.CSSProperties = {
  background: '#0f1626',
  border: '1px solid rgba(255,255,255,0.08)',
  padding: 10,
  borderRadius: 12,
  marginTop: 8
};
const miniTitle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(200,220,255,0.8)',
  marginBottom: 2
};
const miniBody: React.CSSProperties = { fontSize: 14, opacity: 0.9 };
