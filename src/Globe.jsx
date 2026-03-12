import React, { useEffect, useState, useRef, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import Planes from "./Plane";

/* ══════════════════════════════════════════
   WHY DATA DISAPPEARS ON RESTART:

   1. OpenSky rate-limits anonymous IPs to
      ~1 request per 10 seconds. On restart
      the first request hits a 429 and the
      app shows nothing — no fallback, no cache.

   2. corsproxy.io is unreliable and often
      returns 503/timeout on first load.

   3. RETRY_DELAY was only 5s — too fast,
      triggers another 429 immediately.

   FIXES:
   ✓ sessionStorage cache — survives refresh,
     shows last known data instantly
   ✓ 5 different CORS proxy fallbacks
   ✓ Rate-limit detection (429) with 60s backoff
   ✓ Exponential backoff on repeated failures
   ✓ Shows cached data while fetching fresh
══════════════════════════════════════════ */

const CACHE_KEY = "liveflights_cache";
const LIVE_DELAY = 12000;   // refresh every 12s when live
const RATE_DELAY = 65000;   // wait 65s after 429
const RETRY_DELAY = 8000;    // wait 8s on other errors
const TIMEOUT_MS = 10000;

/* ── Multiple CORS-capable endpoints ── */
const ENDPOINTS = [
    // Direct (works when not rate-limited)
    "https://opensky-network.org/api/states/all",
    // CORS proxies — tried in order
    `https://corsproxy.io/?${encodeURIComponent("https://opensky-network.org/api/states/all")}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent("https://opensky-network.org/api/states/all")}`,
    `https://thingproxy.freeboard.io/fetch/https://opensky-network.org/api/states/all`,
];

/* ── Save/load from sessionStorage ── */
function saveCache(states) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            states: states.slice(0, 8000), // cap at 8000 to stay under storage limit
        }));
    } catch { }
}

function loadCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { ts, states } = JSON.parse(raw);
        // Cache valid for 5 minutes
        if (Date.now() - ts > 5 * 60 * 1000) return null;
        return states;
    } catch { return null; }
}

/* ── Fetch with timeout + rate-limit detection ── */
async function tryFetch(url) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { Accept: "application/json" },
        });
        clearTimeout(tid);

        if (res.status === 429) throw Object.assign(new Error("Rate limited"), { rateLimited: true });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();

        // allorigins wraps in { contents }
        const actual = data?.contents ? JSON.parse(data.contents) : data;
        if (actual?.states?.length) return actual.states;
        return null;
    } catch (e) {
        clearTimeout(tid);
        throw e;
    }
}

/* ── Main fetch — tries all endpoints ── */
async function fetchPlaneData() {
    let lastErr = null;
    for (const url of ENDPOINTS) {
        try {
            const states = await tryFetch(url);
            if (states) return { states, rateLimited: false };
        } catch (e) {
            lastErr = e;
            if (e.rateLimited) {
                // Don't try more proxies on 429 — we're the problem, not the proxy
                return { states: null, rateLimited: true };
            }
            // Otherwise try next proxy
        }
    }
    return { states: null, rateLimited: false };
}

/* ══════ LIGHTING ══════ */
function Lighting() {
    return (
        <>
            <ambientLight intensity={0.55} color="#90b8e0" />
            <directionalLight position={[12, 6, 8]} intensity={2.0} color="#ffeebb" />
            <pointLight position={[-10, -4, -6]} intensity={0.3} color="#1a3a80" />
            <hemisphereLight skyColor="#1a4a80" groundColor="#000510" intensity={0.3} />
        </>
    );
}

/* ══════ EARTH VISUAL (rotates on its own axis for looks) ══════ */
function EarthVisual({ rotRef }) {
    const goldRef = useRef();
    const atmosRef = useRef();

    useFrame((_, delta) => {
        // Only the visual earth shell rotates — NOT the planes
        if (rotRef.current != null) {
            rotRef.current += delta * 0.09;
        }
        if (goldRef.current) goldRef.current.rotation.y -= delta * 0.025;
        if (atmosRef.current) atmosRef.current.rotation.y += delta * 0.02;
    });

    return (
        <>
            {/* Atmosphere — always centered */}
            <mesh ref={atmosRef}>
                <sphereGeometry args={[3.35, 32, 32]} />
                <meshPhongMaterial color="#1a6aaf" transparent opacity={0.07}
                    side={THREE.BackSide} depthWrite={false} />
            </mesh>

            {/* Earth shell group — uses rotRef.current for Y rotation */}
            <EarthMeshes rotRef={rotRef} goldRef={goldRef} />
        </>
    );
}

function EarthMeshes({ rotRef, goldRef }) {
    const groupRef = useRef();

    useFrame(() => {
        if (groupRef.current && rotRef.current != null) {
            groupRef.current.rotation.y = rotRef.current;
        }
    });

    return (
        <group ref={groupRef}>
            {/* Core */}
            <mesh>
                <sphereGeometry args={[2.96, 64, 64]} />
                <meshPhongMaterial color="#020c18" emissive="#040f1e" shininess={15} />
            </mesh>
            {/* Ocean */}
            <mesh>
                <sphereGeometry args={[2.972, 64, 64]} />
                <meshPhongMaterial color="#0b2845" emissive="#051525"
                    transparent opacity={0.88} shininess={90} />
            </mesh>
            {/* Land */}
            <mesh>
                <sphereGeometry args={[2.978, 32, 32]} />
                <meshPhongMaterial color="#1a3a20" emissive="#0d1f10"
                    transparent opacity={0.28} shininess={4} />
            </mesh>
            {/* Blue grid */}
            <mesh>
                <sphereGeometry args={[3.0, 28, 28]} />
                <meshBasicMaterial color="#1e7acc" wireframe transparent opacity={0.38} />
            </mesh>
            {/* Gold grid */}
            <mesh ref={goldRef}>
                <sphereGeometry args={[3.005, 48, 48]} />
                <meshBasicMaterial color="#c8a84b" wireframe transparent opacity={0.08} />
            </mesh>
            {/* Equatorial ring */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[3.06, 0.006, 8, 200]} />
                <meshBasicMaterial color="#c8a84b" transparent opacity={0.5} />
            </mesh>
            {/* Prime meridian */}
            <mesh>
                <torusGeometry args={[3.06, 0.004, 8, 200]} />
                <meshBasicMaterial color="#c8a84b" transparent opacity={0.22} />
            </mesh>
            {/* Tropics */}
            {[23.5, -23.5, 66.5, -66.5].map((deg, i) => {
                const r = 3.06 * Math.cos(deg * Math.PI / 180);
                const yPos = 3.06 * Math.sin(deg * Math.PI / 180);
                return (
                    <mesh key={i} position={[0, yPos, 0]} rotation={[Math.PI / 2, 0, 0]}>
                        <torusGeometry args={[r, 0.003, 8, 100]} />
                        <meshBasicMaterial color="#c8a84b" transparent opacity={0.11} />
                    </mesh>
                );
            })}
        </group>
    );
}

/* ══════ CAMERA CONTROLLER
   — Drag rotates the CAMERA around the globe (not the globe itself)
     so planes stay in correct world positions and clicks always work
   — Smooth inertia on release
   — Scroll to zoom
══════ */
function CameraController() {
    const { camera, gl } = useThree();

    const isDragging = useRef(false);
    const prevMouse = useRef({ x: 0, y: 0 });
    const spherical = useRef(new THREE.Spherical(8.5, Math.PI / 2, 0));
    const velTheta = useRef(0);
    const velPhi = useRef(0);
    const targetR = useRef(8.5);
    const lastDragAt = useRef(0);   // timestamp of last drag event

    useEffect(() => {
        const el = gl.domElement;

        const getXY = (e) => ({
            x: e.touches ? e.touches[0].clientX : e.clientX,
            y: e.touches ? e.touches[0].clientY : e.clientY,
        });

        const onDown = (e) => {
            isDragging.current = true;
            lastDragAt.current = performance.now();
            const { x, y } = getXY(e);
            prevMouse.current = { x, y };
            velTheta.current = 0;
            velPhi.current = 0;
        };

        const onMove = (e) => {
            if (!isDragging.current) return;
            const { x, y } = getXY(e);
            const dx = x - prevMouse.current.x;
            const dy = y - prevMouse.current.y;
            prevMouse.current = { x, y };
            lastDragAt.current = performance.now();

            velTheta.current = -dx * 0.006;
            velPhi.current = dy * 0.006;

            spherical.current.theta += velTheta.current;
            spherical.current.phi = Math.max(0.2, Math.min(
                Math.PI - 0.2,
                spherical.current.phi + velPhi.current
            ));
        };

        const onUp = () => {
            isDragging.current = false;
            lastDragAt.current = performance.now();
        };

        const onWheel = (e) => {
            targetR.current = Math.max(4.5, Math.min(18, targetR.current + e.deltaY * 0.012));
        };

        el.addEventListener("mousedown", onDown);
        el.addEventListener("touchstart", onDown, { passive: true });
        window.addEventListener("mousemove", onMove);
        window.addEventListener("touchmove", onMove, { passive: true });
        window.addEventListener("mouseup", onUp);
        window.addEventListener("touchend", onUp);
        el.addEventListener("wheel", onWheel, { passive: true });

        return () => {
            el.removeEventListener("mousedown", onDown);
            el.removeEventListener("touchstart", onDown);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("touchmove", onMove);
            window.removeEventListener("mouseup", onUp);
            window.removeEventListener("touchend", onUp);
            el.removeEventListener("wheel", onWheel);
        };
    }, [gl]);

    useFrame((_, delta) => {
        const sph = spherical.current;
        const idleMs = performance.now() - lastDragAt.current;
        const isIdle = !isDragging.current && idleMs > 1800;

        if (isDragging.current) {
            // While dragging: position already updated in onMove, nothing extra needed
        } else if (idleMs < 1800) {
            // Just released: apply inertia, decay toward zero
            velTheta.current *= 0.90;
            velPhi.current *= 0.90;
            sph.theta += velTheta.current;
            sph.phi = Math.max(0.2, Math.min(Math.PI - 0.2, sph.phi + velPhi.current));
        } else {
            // Idle: smooth auto-rotate, kill any leftover velocity
            velTheta.current = 0;
            velPhi.current = 0;
            sph.theta += delta * 0.09;
        }

        // Smooth zoom lerp
        sph.radius += (targetR.current - sph.radius) * 0.08;

        // Apply spherical → camera position
        camera.position.setFromSpherical(sph);
        camera.lookAt(0, 0, 0);
    });

    return null;
}

/* ══════ MAIN GLOBE ══════ */
export default function Globe({ setSelectedPlane }) {
    // Load cached planes immediately so globe isn't empty on restart
    const [planes, setPlanes] = useState(() => loadCache() || []);
    const [loading, setLoading] = useState(true);
    const [airborne, setAirborne] = useState(0);
    const [status, setStatus] = useState("Connecting…");
    const [statusMsg, setStatusMsg] = useState("");
    const [lastUpdate, setLastUpdate] = useState(null);
    const [retryCount, setRetryCount] = useState(0);
    const intervalRef = useRef(null);
    const earthRotY = useRef(0);
    const retryCountRef = useRef(0);

    const handlePlaneClick = useCallback((plane) => {
        setSelectedPlane(plane);
    }, [setSelectedPlane]);

    const startFetching = useCallback(() => {
        if (intervalRef.current) {
            clearTimeout(intervalRef.current);
            intervalRef.current = null;
        }
        retryCountRef.current = 0;
        setRetryCount(0);

        async function doFetch() {
            setStatus(retryCountRef.current > 0 ? `Retrying (${retryCountRef.current})…` : "Connecting…");

            const { states, rateLimited } = await fetchPlaneData();

            if (states && states.length > 0) {
                // ✅ Success
                setPlanes(states);
                saveCache(states);
                setAirborne(states.filter(p => !p[8]).length);
                setStatus("Live");
                setStatusMsg("");
                setLoading(false);
                setLastUpdate(new Date());
                retryCountRef.current = 0;
                setRetryCount(0);
                // Schedule next refresh
                intervalRef.current = setTimeout(doFetch, LIVE_DELAY);

            } else if (rateLimited) {
                // ⚠ Rate limited — show cached data, wait 65s
                setStatus("Rate limited");
                setStatusMsg("OpenSky limit hit — retrying in 60s");
                setLoading(false);
                retryCountRef.current += 1;
                setRetryCount(retryCountRef.current);
                intervalRef.current = setTimeout(doFetch, RATE_DELAY);

            } else {
                // ❌ All proxies failed
                const delay = Math.min(RETRY_DELAY * Math.pow(1.5, retryCountRef.current), 60000);
                setStatus("Reconnecting…");
                setStatusMsg(`All sources failed — retrying in ${Math.round(delay / 1000)}s`);
                setLoading(planes.length === 0); // only show spinner if we have NO data
                retryCountRef.current += 1;
                setRetryCount(retryCountRef.current);
                intervalRef.current = setTimeout(doFetch, delay);
            }
        }

        doFetch();
    }, []); // eslint-disable-line

    useEffect(() => {
        // If we have cached data, show it immediately and fetch fresh in background
        const cached = loadCache();
        if (cached && cached.length > 0) {
            setPlanes(cached);
            setAirborne(cached.filter(p => !p[8]).length);
            setLoading(false);
            setStatus("Cached");
            setStatusMsg("Showing cached data — fetching live…");
        }
        startFetching();
        return () => {
            if (intervalRef.current) clearTimeout(intervalRef.current);
        };
    }, [startFetching]);

    const isLive = status === "Live";
    const isCached = status === "Cached";
    const isLimited = status === "Rate limited";
    const now = lastUpdate?.toLocaleTimeString("en-GB", { hour12: false }) ?? "—";

    return (
        <div className="globe-root">

            <nav className="navbar">
                <div className="nav-brand">
                    <span className="nav-logo">✈</span>
                    <div className="nav-brand-text">
                        <span className="nav-title">GLOBAL FLIGHT TRACKER</span>
                        <span className={`nav-status ${isLive ? "live" : isCached ? "cached" : "reconnecting"}`}>
                            <span className="nav-status-dot" />
                            {status}
                        </span>
                    </div>
                </div>
                <div className="nav-stats">
                    <div className="nav-stat">
                        <span className="ns-label">TRACKED</span>
                        <span className="ns-value">{planes.length.toLocaleString()}</span>
                    </div>
                    <div className="ns-divider" />
                    <div className="nav-stat">
                        <span className="ns-label">AIRBORNE</span>
                        <span className="ns-value">{airborne.toLocaleString()}</span>
                    </div>
                    <div className="ns-divider" />
                    <div className="nav-stat">
                        <span className="ns-label">UPDATED</span>
                        <span className="ns-value">{now}</span>
                    </div>
                    <div className="ns-divider" />
                    <button className="btn-refresh" onClick={startFetching} title="Force refresh">⟳</button>
                </div>
            </nav>

            <div className="canvas-container">
                <Canvas
                    camera={{ position: [0, 0, 8.5], fov: 45 }}
                    gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                    style={{ background: "transparent" }}
                    dpr={Math.min(window.devicePixelRatio, 1.5)}
                    frameloop="always"
                >
                    <Lighting />
                    <Stars radius={140} depth={60} count={3000} factor={4}
                        saturation={0} fade speed={0.2} />

                    <EarthVisual rotRef={earthRotY} />

                    {planes.length > 0 && (
                        <Planes planes={planes} onPlaneClick={handlePlaneClick} />
                    )}

                    <CameraController />
                </Canvas>

                <div className="vignette" />

                {/* Only show full-screen spinner when we have ZERO data */}
                {loading && planes.length === 0 && (
                    <div className="loading-overlay">
                        <div className="spinner" />
                        <p className="loading-label">Connecting to OpenSky Network…</p>
                        <p className="loading-sub">Trying {ENDPOINTS.length} sources…</p>
                    </div>
                )}

                {/* Status banner — shown when not live but we have data to display */}
                {!isLive && !loading && planes.length > 0 && (
                    <div className={`api-banner ${isLimited ? "rate-limited" : ""}`}>
                        {isLimited
                            ? <span>⏳ OpenSky rate limit — showing {isCached ? "cached" : "last known"} data</span>
                            : isCached
                                ? <span>📡 Showing cached data — fetching live…</span>
                                : <span>⚠ Connection issue — {statusMsg || "retrying…"}</span>
                        }
                        <button className="btn-banner-retry" onClick={startFetching}>Retry now</button>
                    </div>
                )}
            </div>

            <div className="statusbar">
                <div className="statusbar-left">
                    <span className={`sb-dot ${isLive ? "live" : isCached ? "cached" : "reconnecting"}`} />
                    <span className="sb-label">
                        {isLive
                            ? `Live · ${planes.length.toLocaleString()} flights tracked`
                            : planes.length > 0
                                ? `${planes.length.toLocaleString()} flights (${isCached ? "cached" : status.toLowerCase()})`
                                : statusMsg || "Connecting…"}
                    </span>
                </div>
                <div className="statusbar-right">
                    <span className="sb-hint">✈ Click plane for details</span>
                    <span className="sb-sep">·</span>
                    <span className="sb-hint">🖱 Scroll to zoom</span>
                    <span className="sb-sep">·</span>
                    <span className="sb-hint">⟳ Drag to rotate</span>
                </div>
            </div>
        </div>
    );
}