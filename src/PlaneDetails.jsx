import React, { useEffect, useState } from "react";

/* ─────────────────────────────────
   HELPERS
───────────────────────────────── */
function fmt(val, dec = 0) {
    if (val == null) return "—";
    return Number(val).toLocaleString("en-US", { maximumFractionDigits: dec });
}

function getPhase(altFt, onGround) {
    if (onGround || !altFt || altFt < 50) return { label: "ON GROUND", color: "#8899aa" };
    if (altFt < 10000) return { label: "APPROACH", color: "#f5a623" };
    if (altFt < 25000) return { label: "CLIMBING", color: "#5bc8f5" };
    return { label: "CRUISING", color: "#4caf82" };
}

function degToCompass(deg) {
    if (deg == null) return "";
    const d = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return d[Math.round(deg / 45) % 8];
}

function mpsToKts(v) { return v ? Math.round(v * 1.94384) : null; }
function mpsToKmh(v) { return v ? Math.round(v * 3.6) : null; }
function mToFt(v) { return v ? Math.round(v * 3.28084) : null; }

/* ─────────────────────────────────
   AIRLINE DATABASE
   Maps ICAO airline prefix (first 3
   letters of callsign) → airline name
───────────────────────────────── */
const AIRLINES = {
    AAL: "American Airlines", UAL: "United Airlines", DAL: "Delta Air Lines",
    SWA: "Southwest Airlines", BAW: "British Airways", DLH: "Lufthansa",
    AFR: "Air France", KLM: "KLM Royal Dutch", UAE: "Emirates",
    QTR: "Qatar Airways", SIA: "Singapore Airlines", CPA: "Cathay Pacific",
    THA: "Thai Airways", MAS: "Malaysia Airlines", QFA: "Qantas",
    JAL: "Japan Airlines", ANA: "All Nippon Airways", KAL: "Korean Air",
    AAR: "Asiana Airlines", CSN: "China Southern", CCA: "Air China",
    CES: "China Eastern", SVA: "Saudia", THY: "Turkish Airlines",
    ETH: "Ethiopian Airlines", RYR: "Ryanair", EZY: "easyJet",
    VLG: "Vueling", IBE: "Iberia", TAP: "TAP Air Portugal",
    AZA: "Alitalia", AIC: "Air India", FIN: "Finnair",
    SAS: "Scandinavian Airlines", LOT: "LOT Polish Airlines",
    CFG: "Condor", TOM: "TUI Airways", EXS: "Jet2",
    AEE: "Aegean Airlines", TVS: "Transavia", VKG: "Thomas Cook",
    MSR: "EgyptAir", TUN: "Tunisair", RAM: "Royal Air Maroc",
    GFA: "Gulf Air", OMA: "Oman Air", ELY: "El Al",
    FDB: "flydubai", ABY: "Air Arabia", WZZ: "Wizz Air",
    NKS: "Spirit Airlines", FFT: "Frontier Airlines", SKY: "Skywest",
    ASA: "Alaska Airlines", HAL: "Hawaiian Airlines", JBU: "JetBlue",
    POE: "Porter Airlines", ACA: "Air Canada", WJA: "WestJet",
    VRD: "Virgin America", VIR: "Virgin Atlantic", GTI: "Atlas Air",
    FDX: "FedEx", UPS: "UPS Airlines", CLX: "Cargolux",
    MPH: "Martinair", SFJ: "Scandinavian Cargo",
};

function getAirline(callsign) {
    if (!callsign) return null;
    const prefix = callsign.trim().toUpperCase().replace(/[0-9]/g, "").slice(0, 3);
    return AIRLINES[prefix] || null;
}

/* ─────────────────────────────────
   ROUTE LOOKUP via Claude API (web search)
   Falls back gracefully if unavailable
───────────────────────────────── */
async function fetchRouteViaClaude(callsign) {
    if (!callsign?.trim()) return null;
    const cs = callsign.trim().toUpperCase();
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 600,
                tools: [{ type: "web_search_20250305", name: "web_search" }],
                system: `You are a flight data lookup assistant. Search for the flight route for the given callsign.
Return ONLY raw JSON (no markdown, no explanation):
{"airline":"Name","departure":{"iata":"XXX","icao":"XXXX","name":"Full Airport Name","city":"City","country":"Country"},"arrival":{"iata":"XXX","icao":"XXXX","name":"Full Airport Name","city":"City","country":"Country"}}
If not found: {"notFound":true}`,
                messages: [{ role: "user", content: `Flight route for callsign ${cs}` }]
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const text = data.content?.find(b => b.type === "text")?.text || "";
        const match = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);
        return parsed.notFound ? null : parsed;
    } catch { return null; }
}

/* ─────────────────────────────────
   REVERSE GEOCODE via Nominatim
───────────────────────────────── */
async function reverseGeocode(lat, lon) {
    if (lat == null || lon == null) return null;
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=8`,
            { headers: { "Accept-Language": "en-US,en" } }
        );
        if (!res.ok) return null;
        const d = await res.json();
        const a = d.address || {};
        return {
            city: a.city || a.town || a.village || a.county || a.state || "",
            country: a.country || "",
            isOcean: !a.city && !a.town && !a.village && !a.county && !a.country,
        };
    } catch { return null; }
}

/* ─────────────────────────────────
   UI ATOMS
───────────────────────────────── */
function Dots() {
    return (
        <span style={{ display: "inline-flex", gap: 4 }}>
            {[0, 1, 2].map(i => (
                <span key={i} className="ac-dot"
                    style={{ animationDelay: `${i * 0.2}s`, width: 5, height: 5 }} />
            ))}
        </span>
    );
}

function AptCard({ icon, label, apt }) {
    return (
        <div className="airport-card">
            <div className="apt-label">{icon} {label}</div>
            {apt ? (
                <>
                    <div className="apt-iata">{apt.iata || apt.icao || "—"}</div>
                    <div className="apt-name">{apt.name || "Unknown Airport"}</div>
                    <div className="apt-city">{[apt.city, apt.country].filter(Boolean).join(", ") || "—"}</div>
                </>
            ) : (
                <div className="apt-iata" style={{ color: "#445566", fontSize: 13 }}>—</div>
            )}
        </div>
    );
}

function Row({ label, children }) {
    return (
        <div className="details-row">
            <span className="dr-label">{label}</span>
            <span className="dr-value">{children}</span>
        </div>
    );
}

function Gauge({ pct, color }) {
    return (
        <div className="gauge-track">
            <div className="gauge-fill" style={{ width: `${pct}%`, background: color }} />
            <div className="gauge-glow" style={{ width: `${pct}%`, background: color }} />
        </div>
    );
}

function MiniCard({ label, children, highlight }) {
    return (
        <div className="mini-card" style={highlight ? { borderColor: highlight } : {}}>
            <div className="mini-label">{label}</div>
            <div className="mini-value">{children}</div>
        </div>
    );
}

/* ─────────────────────────────────
   MAIN
───────────────────────────────── */
export default function PlaneDetails({ plane, onClose }) {
    const [show, setShow] = useState(false);
    const [routeData, setRouteData] = useState(null);
    const [routeState, setRouteState] = useState("idle");
    const [geoData, setGeoData] = useState(null);
    const [geoState, setGeoState] = useState("idle");
    // Keep last known plane so panel content doesn't blank during slide-out
    const [lastPlane, setLastPlane] = useState(null);

    useEffect(() => {
        if (plane) {
            setLastPlane(plane);
            setShow(false);
            const t = setTimeout(() => setShow(true), 20);
            return () => clearTimeout(t);
        } else {
            setShow(false);
        }
    }, [plane]);

    useEffect(() => {
        if (!plane) { setRouteData(null); setRouteState("idle"); return; }
        setRouteData(null); setRouteState("loading");
        fetchRouteViaClaude(plane[1]).then(r => {
            setRouteData(r); setRouteState(r ? "done" : "error");
        });
    }, [plane]);

    useEffect(() => {
        if (!plane) { setGeoData(null); setGeoState("idle"); return; }
        setGeoData(null); setGeoState("loading");
        reverseGeocode(plane[6], plane[5]).then(g => {
            setGeoData(g); setGeoState("done");
        });
    }, [plane]);

    // Use lastPlane so content doesn't disappear during slide-out animation
    const p = plane || lastPlane;
    // Render nothing at all on very first load before any plane is clicked
    if (!p) return null;

    /* ── Raw OpenSky fields — use p (which falls back to lastPlane) ── */
    const icao24 = (p[0] || "").toUpperCase();
    const callsign = (p[1] || "").trim() || "UNKNOWN";
    const regCountry = p[2] || "—";
    const lon = p[5];
    const lat = p[6];
    const baroAlt = p[7];
    const onGround = !!p[8];
    const velocity = p[9];
    const heading = p[10];
    const vertRate = p[11];
    const geoAlt = p[13];
    const squawk = p[14] || "—";
    const posSource = p[16];

    /* ── Computed ── */
    const altFt = mToFt(baroAlt);
    const geoAltFt = mToFt(geoAlt);
    const velKts = mpsToKts(velocity);
    const velKmh = mpsToKmh(velocity);
    const phase = getPhase(altFt, onGround);
    const compass = degToCompass(heading);
    const airline = routeState === "done" && routeData?.airline
        ? routeData.airline : getAirline(callsign);
    const altPct = Math.min(100, ((altFt || 0) / 45000) * 100);
    const velPct = Math.min(100, ((velKts || 0) / 600) * 100);
    const srcLabel = ["ADS-B", "ASTERIX", "MLAT", "FLARM"][posSource] || "—";
    const isEmerg = squawk === "7700";
    const isRadio = squawk === "7600";

    const flyingOver = geoState === "loading" ? null
        : geoData
            ? (geoData.isOcean ? "Ocean / Remote"
                : [geoData.city, geoData.country].filter(Boolean).join(", ") || "Unknown")
            : regCountry;

    return (
        <>
            <div className={`panel-backdrop ${show ? "visible" : ""}`} onClick={onClose} />
            <div className={`details-panel ${show ? "visible" : ""}`}>
                <div className="dp-corner tl" /><div className="dp-corner tr" />
                <div className="dp-corner bl" /><div className="dp-corner br" />

                {isEmerg && <div className="emergency-banner">⚠ EMERGENCY — SQUAWK 7700</div>}

                <button className="details-close" onClick={onClose}>✕</button>

                {/* ══ HEADER ══ */}
                <div className="details-header">
                    <div className="details-icon">✈</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="details-callsign">{callsign}</div>
                        <div className="details-icao">{airline || `ICAO · ${icao24}`}</div>
                    </div>
                    <div className="details-phase" style={{ borderColor: phase.color, color: phase.color }}>
                        <span className="phase-dot" style={{ background: phase.color, boxShadow: `0 0 6px ${phase.color}` }} />
                        {phase.label}
                    </div>
                </div>

                <div className="details-hr" />

                {/* ══ ROUTE ══ */}
                <div className="details-section">
                    <div className="details-sec-label">🛫 FLIGHT ROUTE</div>
                    {routeState === "loading" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                            <Dots />
                            <span style={{ fontSize: 10, color: "#7a8fa8" }}>Searching route…</span>
                        </div>
                    )}
                    {routeState === "done" && routeData && (
                        <>
                            {routeData.airline && (
                                <div className="airline-badge">✈ {routeData.airline}</div>
                            )}
                            <div className="route-row">
                                <AptCard icon="🛫" label="FROM" apt={routeData.departure} />
                                <div className="route-arrow">
                                    <div className="route-line" />
                                    <span style={{ fontSize: 13 }}>✈</span>
                                    <div className="route-line" />
                                </div>
                                <AptCard icon="🛬" label="TO" apt={routeData.arrival} />
                            </div>
                        </>
                    )}
                    {(routeState === "error" || (routeState === "done" && !routeData)) && (
                        <div className="route-unavailable">
                            No route on record for <strong style={{ color: "#aabbcc" }}>{callsign}</strong>
                        </div>
                    )}
                </div>

                <div className="details-hr" />

                {/* ══ POSITION ══ */}
                <div className="details-section">
                    <div className="details-sec-label">📍 CURRENT POSITION</div>
                    <Row label="FLYING OVER">
                        <span style={{ color: "#d4c4a0" }}>
                            {geoState === "loading" ? <Dots /> : (flyingOver || "—")}
                        </span>
                    </Row>
                    <Row label="COORDINATES">
                        <span style={{ color: "#7a8fa8", fontSize: 10 }}>
                            {lat != null ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "—"}
                        </span>
                    </Row>
                    <Row label="REG. COUNTRY">
                        <span style={{ color: "#c8a84b" }}>{regCountry}</span>
                    </Row>
                </div>

                <div className="details-hr" />

                {/* ══ ALTITUDE ══ */}
                <div className="details-section">
                    <div className="details-sec-label">▲ ALTITUDE</div>
                    <Row label="BAROMETRIC">
                        <span style={{
                            color: !altFt ? "#8899aa" : altFt > 30000 ? "#4caf82" : "#c8a84b",
                            fontSize: 16, fontWeight: 700,
                        }}>
                            {altFt ? `${fmt(altFt)} ft` : "ON GROUND"}
                        </span>
                    </Row>
                    {geoAltFt && (
                        <Row label="GEOMETRIC">
                            <span style={{ color: "#7a8fa8", fontSize: 11 }}>{fmt(geoAltFt)} ft</span>
                        </Row>
                    )}
                    <Gauge pct={altPct} color={altFt > 30000 ? "#4caf82" : "#c8a84b"} />
                    <div className="gauge-scale">
                        <span>0</span><span>15K</span><span>30K</span><span>45K ft</span>
                    </div>
                </div>

                <div className="details-hr" />

                {/* ══ VELOCITY ══ */}
                <div className="details-section">
                    <div className="details-sec-label">◈ VELOCITY</div>
                    <Row label="AIRSPEED">
                        <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                            <span style={{ color: "#5bc8f5", fontSize: 16, fontWeight: 700 }}>
                                {velKts != null ? `${fmt(velKts)} kts` : "—"}
                            </span>
                            {velKmh != null && (
                                <span style={{ fontSize: 10, color: "#7a8fa8" }}>{fmt(velKmh)} km/h</span>
                            )}
                        </span>
                    </Row>
                    <Gauge pct={velPct} color="#5bc8f5" />
                    <div className="gauge-scale">
                        <span>0</span><span>200</span><span>400</span><span>600 kts</span>
                    </div>
                </div>

                <div className="details-hr" />

                {/* ══ NAVIGATION ══ */}
                <div className="details-section">
                    <div className="details-sec-label">🧭 NAVIGATION</div>
                    <div className="mini-grid">

                        <MiniCard label="HEADING">
                            <span style={{ color: "var(--gold)" }}>
                                {heading != null ? `${Math.round(heading)}°` : "—"}
                            </span>
                            {compass && <span style={{ fontSize: 9, color: "#7a8fa8", marginLeft: 4 }}>{compass}</span>}
                        </MiniCard>

                        <MiniCard label="VERT RATE">
                            <span style={{ color: vertRate > 0 ? "#4caf82" : vertRate < 0 ? "#f5a623" : "#8899aa" }}>
                                {vertRate != null
                                    ? `${vertRate > 0 ? "▲" : vertRate < 0 ? "▼" : "—"} ${Math.abs(Math.round(vertRate * 196.85))} fpm`
                                    : "—"}
                            </span>
                        </MiniCard>

                        <MiniCard label="SQUAWK" highlight={isEmerg ? "rgba(255,68,68,0.5)" : isRadio ? "rgba(245,166,35,0.4)" : null}>
                            <span style={{ color: isEmerg ? "#ff4444" : isRadio ? "#f5a623" : "var(--gold)" }}>
                                {squawk}
                            </span>
                            {isEmerg && <div style={{ fontSize: 8, color: "#ff4444", marginTop: 2 }}>EMERGENCY</div>}
                            {isRadio && <div style={{ fontSize: 8, color: "#f5a623", marginTop: 2 }}>RADIO FAIL</div>}
                        </MiniCard>

                        <MiniCard label="SOURCE">
                            <span style={{ fontSize: 10, color: "var(--gold)" }}>{srcLabel}</span>
                        </MiniCard>

                    </div>
                </div>

                <div className="details-hr" />
                <div className="details-footer">
                    <span className="blink">●</span>&nbsp;LIVE · OPENSKY NETWORK
                </div>
            </div>
        </>
    );
}