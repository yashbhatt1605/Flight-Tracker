import React, { useRef, useMemo, useEffect, useCallback } from "react";
import * as THREE from "three";

/* ─────────────────────────────────────────
   Draw airplane silhouette in given color
───────────────────────────────────────── */
function makeTex(color) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const ctx = cv.getContext("2d");

    // soft glow behind icon
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 26);
    g.addColorStop(0, color + "99");
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);

    ctx.save();
    ctx.translate(32, 32);
    ctx.fillStyle = color;

    // fuselage
    ctx.beginPath();
    ctx.ellipse(0, 0, 3, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // wings
    ctx.beginPath();
    ctx.moveTo(0, -2); ctx.lineTo(-17, 6); ctx.lineTo(-13, 8);
    ctx.lineTo(0, 2); ctx.lineTo(13, 8); ctx.lineTo(17, 6);
    ctx.closePath();
    ctx.fill();

    // tail fins
    ctx.beginPath();
    ctx.moveTo(0, 9); ctx.lineTo(-7, 15); ctx.lineTo(-4, 15);
    ctx.lineTo(0, 11); ctx.lineTo(4, 15); ctx.lineTo(7, 15);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    return new THREE.CanvasTexture(cv);
}

/* ─────────────────────────────────────────
   One pre-baked texture per altitude band
   No vertexColors needed — no black planes
───────────────────────────────────────── */
const TEXTURES = {
    gold: makeTex("#c8a84b"),  // cruising  > 10 000 m
    blue: makeTex("#5bc8f5"),  // climbing  > 3 000 m
    amber: makeTex("#f5a623"),  // low       < 3 000 m
    grey: makeTex("#99aabb"),  // on ground
};

function getBand(alt, ground) {
    if (ground || !alt || alt < 100) return "grey";
    if (alt > 10000) return "gold";
    if (alt > 3000) return "blue";
    return "amber";
}

/* ─────────────────────────────────────────
   Shared math objects — never reallocated
───────────────────────────────────────── */
const _M = new THREE.Matrix4();
const _P = new THREE.Vector3();
const _Q = new THREE.Quaternion();
const _S = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _AX = new THREE.Vector3();
const _HQ = new THREE.Quaternion();
const SZ = 0.15;

function toXYZ(lat, lon, alt) {
    const r = 3.1 + Math.min((alt || 0) / 200000, 0.12);
    const phi = (90 - lat) * (Math.PI / 180);
    const th = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(th),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(th),
    );
}

/* ─────────────────────────────────────────
   One instanced mesh per band (4 total).
   Each mesh has its own colored texture —
   NO vertexColors, NO instanceColor buffer,
   NO black planes.

   instanceId maps directly into the band's
   own array. A global lookup ref lets the
   click handler find the original plane.
───────────────────────────────────────── */
const BANDS = ["gold", "blue", "amber", "grey"];
const MAX_PER_BAND = 8000; // safe upper bound per band

function BandMesh({ band, planeList, lookupRef, onPlaneClick }) {
    const meshRef = useRef();

    const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
    const mat = useMemo(() => new THREE.MeshBasicMaterial({
        map: TEXTURES[band],
        transparent: true,
        depthWrite: false,
        alphaTest: 0.05,
        side: THREE.DoubleSide,
        // NO vertexColors — color is baked into the texture
    }), [band]);

    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;

        const n = planeList.length;

        for (let i = 0; i < n; i++) {
            const p = planeList[i];
            const pos = toXYZ(p[6], p[5], p[7] || 0);

            _P.copy(pos);
            _Q.setFromUnitVectors(_UP, pos.clone().normalize());

            if (p[10] != null) {
                _AX.copy(pos).normalize();
                _HQ.setFromAxisAngle(_AX, -p[10] * Math.PI / 180);
                _Q.premultiply(_HQ);
            }

            _S.setScalar(SZ);
            _M.compose(_P, _Q, _S);
            mesh.setMatrixAt(i, _M);
        }

        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
    }, [planeList]);

    const handleClick = useCallback((e) => {
        e.stopPropagation();
        const id = e.instanceId;
        if (id == null) return;
        // Find this plane in the global lookup ref
        const plane = lookupRef.current[band]?.[id];
        if (plane) onPlaneClick(plane);
    }, [band, lookupRef, onPlaneClick]);

    return (
        <instancedMesh
            ref={meshRef}
            args={[geo, mat, MAX_PER_BAND]}
            onClick={handleClick}
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
            onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = "auto"; }}
            frustumCulled={false}
        />
    );
}

/* ─────────────────────────────────────────
   Main export
───────────────────────────────────────── */
export default function Planes({ planes, onPlaneClick }) {
    // Ref that BandMesh click handlers read — always up to date
    const lookupRef = useRef({});

    const bands = useMemo(() => {
        const valid = planes.filter(p => p[6] != null && p[5] != null);
        const b = { gold: [], blue: [], amber: [], grey: [] };
        for (const p of valid) b[getBand(p[7], p[8])].push(p);
        return b;
    }, [planes]);

    // Keep lookupRef in sync so clicks always find correct plane
    useEffect(() => { lookupRef.current = bands; }, [bands]);

    return (
        <>
            {BANDS.map(band => (
                <BandMesh
                    key={band}
                    band={band}
                    planeList={bands[band]}
                    lookupRef={lookupRef}
                    onPlaneClick={onPlaneClick}
                />
            ))}
        </>
    );
}