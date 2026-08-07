"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { AddSatelliteModal } from "@/components/data/add-satellite-modal";
import { Earth } from "@/components/earth";
import { lazy, Suspense } from "react";

const RealisticEarthGlobe = lazy(() =>
  import("@/components/earth/realistic-earth-globe").then((m) => ({
    default: m.RealisticEarthGlobe,
  })),
);
import { useOrbitalDevices } from "@/hooks/use-orbital-devices";
import type { Satellite } from "@/lib/db/types";
import * as sat from "satellite.js";
import { SCENE_SCALE } from "@/lib/constants/earth";
import {
  propagateSGP4,
  generateOrbitalPath,
  calculateKeplerianPosition,
  generateKeplerianPath,
  latLngAltToPosition,
  orbitKey,
  propagateStateVector,
  eciToScenePosition,
  generateOrbitalPathFromStateVector,
  type StateVector,
} from "@/lib/orbital/propagation";
import { usePropagationWorker } from "@/hooks/use-propagation-worker";
import { SatelliteDetailPanel } from "@/components/dashboard/orbital/satellite-detail-sheet";

// ─── Constants ──────────────────────────────────────────────────────────────

/** How often (ms) to re-run SGP4 propagation. Satellites move ~7.5 km/s;
 *  at 200ms intervals positions shift ~1.5km — imperceptible at globe scale. */
const PROPAGATION_INTERVAL_MS = 200;

/** Default: max satellites to render before switching to Points rendering */
const DEFAULT_POINTS_THRESHOLD = 30;

/** Default: max satellites for which orbital paths are computed */
const DEFAULT_CATALOG_PATH_LIMIT = 100;

// ─── Types ──────────────────────────────────────────────────────────────────

interface EarthPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

interface SatelliteConfig {
  sourceId: string;
  name: string;
  color: string;
  orbitalPeriod: number;
  inclination: number;
  raan: number;
  initialPhase: number;
  tle?: { name: string; line1: string; line2: string };
}

interface GroundStationConfig {
  name: string;
  lat: number;
  lng: number;
  color: string;
}

interface EarthConfig {
  enableRotation?: boolean;
  timeScale?: number;
  brightness?: number;
  showAtmosphere?: boolean;
  showClouds?: boolean;
  dayMapUrl?: string;
  nightMapUrl?: string;
  cloudsMapUrl?: string;
  normalMapUrl?: string;
  specularMapUrl?: string;
  satellites?: SatelliteConfig[];
  groundStations?: GroundStationConfig[];
  showOrbitalPaths?: boolean;
  showGroundTracks?: boolean;
  colors?: string[];
  deviceIds?: string[];
  deviceGroups?: string[];
  noradIds?: string[];
  pointsThreshold?: number;
  maxOrbitalPaths?: number;
  epochOverride?: number;
  showSunLighting?: boolean;
  stateVectors?: Array<{
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    epoch: number;
    id: string;
    color: string;
  }>;
}

// ─── Points Satellite Markers (GPU points for large counts) ─────────────────

/** Renders satellites as GPU points with off-thread SGP4 propagation.
 *  Single draw call, 1 vertex per satellite. */
function PointsSatelliteMarkers({
  satellites,
  onSelect,
  propagationTime,
}: {
  satellites: Satellite[];
  onSelect?: (sat: Satellite) => void;
  propagationTime?: number;
}) {
  const count = satellites.length;
  const pointsRef = useRef<THREE.Points>(null);
  const lastPropTime = useRef(0);

  // Worker handles all SGP4 propagation off the main thread
  const workerInput = useMemo(
    () =>
      satellites
        .filter((s) => s.tle_line1 && s.tle_line2)
        .map((s) => ({
          id: s.id,
          tle_line1: s.tle_line1!,
          tle_line2: s.tle_line2!,
        })),
    [satellites],
  );
  const { positionsRef, propagate, ready } = usePropagationWorker(workerInput);

  // Build color buffer once from satellite colors
  const colorArray = useMemo(() => {
    const arr = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.set(satellites[i].color);
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    return arr;
  }, [satellites, count]);

  // Initial position buffer (zeros — gets filled by worker)
  const positionArray = useMemo(() => new Float32Array(count * 3), [count]);

  // Circular alpha texture so GPU points render as soft round dots, not squares.
  // PointsMaterial uses gl.POINTS quads by default; the texture's alpha channel
  // shapes them into a feathered circle, and alphaTest crops the corners.
  const circleTexture = useMemo(() => {
    if (typeof document === "undefined") return null;
    const SIZE = 64;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const grad = ctx.createRadialGradient(
      SIZE / 2,
      SIZE / 2,
      0,
      SIZE / 2,
      SIZE / 2,
      SIZE / 2,
    );
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.55, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  useFrame((state) => {
    if (!pointsRef.current || !ready) return;

    // Throttle propagation requests
    const now = state.clock.elapsedTime * 1000;
    if (now - lastPropTime.current >= PROPAGATION_INTERVAL_MS) {
      lastPropTime.current = now;
      propagate(propagationTime ?? Date.now());
    }

    // Zoom-aware point sizing (pixel-space). With sizeAttenuation=false the
    // size is in screen pixels regardless of camera distance, so we drive it
    // ourselves with a curve tuned for the density story:
    //   zoomed in  (dist ~  8): small dots, individuals are distinguishable
    //   zoomed out (dist > 120): larger dots, the swarm reads as a swarm
    const material = pointsRef.current.material as THREE.PointsMaterial;
    if (material) {
      const dist = state.camera.position.length();
      const t = THREE.MathUtils.clamp((dist - 8) / (150 - 8), 0, 1);
      material.size = THREE.MathUtils.lerp(3.0, 7.5, t);
    }

    // Copy latest worker positions into the buffer attribute
    const positions = positionsRef.current;
    if (!positions) return;

    const geo = pointsRef.current.geometry;
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    attr.set(positions);
    attr.needsUpdate = true;
  });

  return (
    <points
      ref={pointsRef}
      onClick={(e) => {
        e.stopPropagation();
        if (onSelect && e.index !== undefined && e.index < satellites.length) {
          onSelect(satellites[e.index]);
        }
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positionArray, 3]}
        />
        <bufferAttribute attach="attributes-color" args={[colorArray, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={4}
        vertexColors
        sizeAttenuation={false}
        transparent
        opacity={0.95}
        map={circleTexture ?? undefined}
        alphaTest={0.5}
        depthWrite={false}
      />
    </points>
  );
}

// State vector marker in ECI (place inside OrbitalPath group for alignment)
function StateVectorEciMarker({
  sv,
  color,
  propagationTime,
}: {
  sv: StateVector;
  color: string;
  propagationTime?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const lastPropTime = useRef(0);

  useFrame((state) => {
    const now = state.clock.elapsedTime * 1000;
    if (now - lastPropTime.current > PROPAGATION_INTERVAL_MS) {
      lastPropTime.current = now;
      if (groupRef.current) {
        const eci = propagateStateVector(sv, propagationTime ?? Date.now());
        const pos = eciToScenePosition(eci);
        groupRef.current.position.copy(pos);
      }
    }

    if (groupRef.current) {
      const camDist = state.camera.position.distanceTo(
        groupRef.current.position,
      );
      const scale = Math.max(0.3, Math.min(1, camDist / 20));
      if (meshRef.current) meshRef.current.scale.setScalar(scale);
      if (glowRef.current) glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

// Legacy satellite marker (for inline config without catalog)
function LegacySatelliteMarker({
  position,
  color,
}: {
  position: THREE.Vector3;
  color: string;
  name: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.scale.setScalar(
        1 + Math.sin(state.clock.elapsedTime * 2) * 0.1,
      );
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(
        1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.08,
      );
    }
  });

  return (
    <group position={position}>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} />
      </mesh>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// ─── Ground Station ─────────────────────────────────────────────────────────

function GroundStationMarker({
  lat,
  lng,
  color,
}: {
  lat: number;
  lng: number;
  color: string;
  name: string;
}) {
  const position = latLngAltToPosition(lat, lng, 0);
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.scale.setScalar(
        1 + Math.sin(state.clock.elapsedTime * 2) * 0.15,
      );
    }
  });

  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// ─── Orbital Path ───────────────────────────────────────────────────────────

/** Renders an orbital path in ECI coordinates, rotated by -GMST to align with
 *  the ECEF globe. Satellite markers should be placed INSIDE this group
 *  (also in ECI) so they're always perfectly aligned with the path. */
function OrbitalPath({
  points,
  color,
  propagationTime,
  children,
}: {
  points: THREE.Vector3[];
  color: string;
  propagationTime?: number;
  children?: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);

  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
    });
    return new THREE.LineLoop(geometry, material);
  }, [points, color]);

  useFrame(() => {
    if (!groupRef.current) return;
    const gmst = sat.gstime(new Date(propagationTime ?? Date.now()));
    groupRef.current.rotation.y = -gmst;
  });

  return (
    <group ref={groupRef}>
      <primitive object={line} />
      {children}
    </group>
  );
}

/** Satellite marker rendered in ECI coordinates (place inside an OrbitalPath group). */
function EciSatelliteMarker({
  tle,
  color,
  propagationTime,
  isSelected,
  onSelect,
}: {
  tle: { line1: string; line2: string };
  color: string;
  propagationTime?: number;
  isSelected?: boolean;
  onSelect?: () => void;
  satellite?: Satellite;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const lastPropTime = useRef(0);

  useFrame((state) => {
    const now = state.clock.elapsedTime * 1000;
    if (now - lastPropTime.current > PROPAGATION_INTERVAL_MS) {
      lastPropTime.current = now;
      if (groupRef.current) {
        // Propagate in ECI — position directly in ECI scene space (no geodetic conversion)
        try {
          const satrec = sat.twoline2satrec(tle.line1, tle.line2);
          const pv = sat.propagate(
            satrec,
            new Date(propagationTime ?? Date.now()),
          );
          if (pv && pv.position && typeof pv.position !== "boolean") {
            const posEci = pv.position as sat.EciVec3<number>;
            groupRef.current.position.set(
              posEci.x * SCENE_SCALE,
              posEci.z * SCENE_SCALE,
              -posEci.y * SCENE_SCALE,
            );
          }
        } catch {
          // SGP4 failure — keep last position
        }
      }
    }

    // Scale based on camera distance
    if (groupRef.current) {
      const camDist = state.camera.position.distanceTo(
        groupRef.current.position,
      );
      const scale = Math.max(0.3, Math.min(1, camDist / 20));
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      if (meshRef.current) meshRef.current.scale.setScalar(scale * pulse);
      if (glowRef.current) glowRef.current.scale.setScalar(scale * pulse * 0.8);
    }
  });

  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <mesh ref={glowRef}>
        <sphereGeometry args={[isSelected ? 0.25 : 0.15, 12, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isSelected ? 0.4 : 0.2}
        />
      </mesh>
      <mesh ref={meshRef}>
        <sphereGeometry args={[isSelected ? 0.09 : 0.06, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// ─── Camera Animator ────────────────────────────────────────────────────────

/** Smoothly animates the OrbitControls target toward the selected satellite. */
function CameraAnimator({ satellite }: { satellite: Satellite | null }) {
  const { controls } = useThree((s) => ({
    controls: s.controls,
  }));
  const targetPos = useRef(new THREE.Vector3());
  const isAnimating = useRef(false);

  // When satellite changes, compute its position and start animating.
  // When deselected (null), animate back to origin.
  useEffect(() => {
    if (!satellite) {
      targetPos.current.set(0, 0, 0);
      isAnimating.current = true;
      return;
    }
    if (satellite.tle_line1 && satellite.tle_line2) {
      const result = propagateSGP4(
        { line1: satellite.tle_line1, line2: satellite.tle_line2 },
        new Date(),
      );
      if (result) {
        targetPos.current.copy(result.position);
        isAnimating.current = true;
      }
    }
  }, [satellite]);

  useFrame(() => {
    if (!isAnimating.current || !controls) return;
    const orbitControls = controls as unknown as {
      target: THREE.Vector3;
      update: () => void;
    };

    // Lerp the controls target toward the satellite position
    orbitControls.target.lerp(targetPos.current, 0.06);
    orbitControls.update();

    // Stop animating once close enough
    if (orbitControls.target.distanceTo(targetPos.current) < 0.01) {
      isAnimating.current = false;
    }
  });

  return null;
}

// ─── Scene Content ──────────────────────────────────────────────────────────

function EarthSceneContent({
  config,
  elapsedMs,
  catalogSatellites,
  onSelectSatellite,
  selectedSatellite,
  selectedSatelliteId,
  groundStations,
  propagationTime,
}: {
  config: EarthConfig;
  elapsedMs: number;
  catalogSatellites: Satellite[];
  onSelectSatellite?: (sat: Satellite) => void;
  selectedSatellite?: Satellite | null;
  selectedSatelliteId?: string | null;
  groundStations: GroundStationConfig[];
  propagationTime?: number;
}) {
  const showAtmosphere = config.showAtmosphere ?? true;
  const showClouds = config.showClouds ?? true;
  const showOrbitalPaths = config.showOrbitalPaths ?? true;
  const legacySatellites = config.satellites || [];

  // Satellites with valid TLE data
  const catalogWithTle = useMemo(
    () => catalogSatellites.filter((s) => s.tle_line1 && s.tle_line2),
    [catalogSatellites],
  );

  // Use GPU points rendering above threshold
  const pointsThreshold = config.pointsThreshold ?? DEFAULT_POINTS_THRESHOLD;
  const usePoints = catalogWithTle.length > pointsThreshold;

  // Catalog satellite orbital paths (ECI-based) — computed progressively
  // to avoid blocking the main thread on mount with large counts
  const [catalogPaths, setCatalogPaths] = useState<
    Array<{ id: string; color: string; points: THREE.Vector3[] }>
  >([]);

  // Fallback time for the rare case the parent doesn't supply a propagation
  // time (it always does). Captured once so render stays pure.
  const [nowFallback] = useState(() => Date.now());

  // Stable ID string to detect real changes (avoid recomputing on every render)
  const catalogIdKey = useMemo(
    () => catalogWithTle.map((s) => s.id).join(","),
    [catalogWithTle],
  );

  useEffect(() => {
    const maxPaths = config.maxOrbitalPaths ?? DEFAULT_CATALOG_PATH_LIMIT;
    if (catalogWithTle.length === 0 || catalogWithTle.length > maxPaths) {
      // Deferred so the reset isn't a synchronous setState cascade in the effect.
      queueMicrotask(() => setCatalogPaths([]));
      return;
    }

    let cancelled = false;

    // Generate paths in chunks to avoid blocking
    const CHUNK_SIZE = 10;
    const results: Array<{
      id: string;
      color: string;
      points: THREE.Vector3[];
    }> = [];
    let idx = 0;

    // Track which orbits we've already generated paths for
    const seenOrbits = new Set<string>();

    function processChunk() {
      if (cancelled) return;
      const end = Math.min(idx + CHUNK_SIZE, catalogWithTle.length);
      for (let i = idx; i < end; i++) {
        const s = catalogWithTle[i];
        const key = orbitKey(s.tle_line1!, s.tle_line2!);
        if (seenOrbits.has(key)) continue;
        seenOrbits.add(key);
        results.push({
          id: s.id,
          color: s.color,
          points: generateOrbitalPath(
            { line1: s.tle_line1!, line2: s.tle_line2! },
            120,
            propagationTime,
          ),
        });
      }
      idx = end;
      if (idx < catalogWithTle.length) {
        requestAnimationFrame(processChunk);
      } else {
        if (!cancelled) setCatalogPaths(results);
      }
    }

    processChunk();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogIdKey, Math.round((propagationTime ?? 0) / 60000)]); // Regenerate paths when epoch shifts by >1 minute

  // Legacy satellite orbital paths. Regenerate only when the epoch shifts by
  // more than a minute (paths are coarse), hence the rounded-minute dep.
  const legacyEpochMinute = Math.round((propagationTime ?? 0) / 60000);
  const legacyPaths = useMemo(() => {
    return legacySatellites.map((sat) => {
      const points = sat.tle
        ? generateOrbitalPath(
            { line1: sat.tle.line1, line2: sat.tle.line2 },
            120,
            propagationTime,
          )
        : generateKeplerianPath(sat.inclination, sat.raan);
      return { sourceId: sat.sourceId, points, color: sat.color };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacySatellites, legacyEpochMinute]);

  // Sun position is always "now" — the day/night terminator reflects real time,
  // even on dashboards with a frozen epochOverride (e.g. historical satellite
  // snapshots). Keeping the sun locked to a 2020 timestamp made the globe look
  // wrong; the lighting should match the user's wall clock regardless of what
  // epoch the satellites are propagated to.
  const [sunTick, setSunTick] = useState(0);
  useEffect(() => {
    if (!config.showSunLighting) return;
    const interval = setInterval(() => setSunTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [config.showSunLighting]);

  const sunPosition = useMemo(() => {
    if (!config.showSunLighting) return undefined;
    const d = new Date();
    const dayOfYear =
      (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
        Date.UTC(d.getUTCFullYear(), 0, 0)) /
      86400000;
    const declination =
      -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
    const decRad = (declination * Math.PI) / 180;
    const hourFraction =
      (d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600) /
      24;
    const hourAngle = hourFraction * 2 * Math.PI;
    return new THREE.Vector3(
      -Math.cos(decRad) * Math.cos(hourAngle),
      Math.sin(decRad),
      -Math.cos(decRad) * Math.sin(hourAngle),
    ).normalize();
    // sunTick (a 30s interval counter) is intentionally a dependency so the
    // sun position recomputes from the current time even though it isn't read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.showSunLighting, sunTick]);

  return (
    <>
      {config.showSunLighting ? (
        <Suspense
          fallback={
            <Earth.Globe>{showAtmosphere && <Earth.Atmosphere />}</Earth.Globe>
          }
        >
          <RealisticEarthGlobe
            dayMapUrl={config.dayMapUrl ?? "/day.webp"}
            nightMapUrl="/night.webp"
            cloudsMapUrl={
              showClouds
                ? (config.cloudsMapUrl ?? "/clouds.webp")
                : "/black.png"
            }
            bumpMapUrl={config.specularMapUrl ?? "/bump.webp"}
            rotationSpeed={0}
            sunPosition={sunPosition}
          />
        </Suspense>
      ) : (
        <Earth.Globe>{showAtmosphere && <Earth.Atmosphere />}</Earth.Globe>
      )}
      {!config.showSunLighting && showClouds && <Earth.Clouds />}

      {/* Catalog satellites: path + marker in same ECI group for perfect alignment */}
      {usePoints ? (
        <>
          {showOrbitalPaths &&
            catalogPaths.map((path) => (
              <OrbitalPath
                key={`catalog-path-${path.id}`}
                points={path.points}
                color={path.color}
                propagationTime={propagationTime}
              />
            ))}
          <PointsSatelliteMarkers
            satellites={catalogWithTle}
            onSelect={onSelectSatellite}
            propagationTime={propagationTime}
          />
        </>
      ) : (
        catalogWithTle.map((s) => {
          const path = catalogPaths.find((p) => p.id === s.id);
          return (
            <OrbitalPath
              key={`catalog-orbit-${s.id}`}
              points={path?.points ?? []}
              color={s.color}
              propagationTime={propagationTime}
            >
              {s.tle_line1 && s.tle_line2 && (
                <EciSatelliteMarker
                  tle={{ line1: s.tle_line1, line2: s.tle_line2 }}
                  color={s.color}
                  propagationTime={propagationTime}
                  isSelected={selectedSatelliteId === s.id}
                  onSelect={() => onSelectSatellite?.(s)}
                  satellite={s}
                />
              )}
            </OrbitalPath>
          );
        })
      )}
      {showOrbitalPaths &&
        legacyPaths.map((path) => (
          <OrbitalPath
            key={`legacy-path-${path.sourceId}`}
            points={path.points}
            color={path.color}
            propagationTime={propagationTime}
          />
        ))}

      {/* Legacy satellite markers */}
      {legacySatellites.map((sat) => {
        let position3D: THREE.Vector3;
        if (sat.tle) {
          const result = propagateSGP4(
            { line1: sat.tle.line1, line2: sat.tle.line2 },
            new Date(propagationTime ?? nowFallback),
          );
          position3D =
            result?.position ??
            calculateKeplerianPosition(
              elapsedMs,
              sat.orbitalPeriod,
              sat.inclination,
              sat.raan,
              sat.initialPhase,
            );
        } else {
          position3D = calculateKeplerianPosition(
            elapsedMs,
            sat.orbitalPeriod,
            sat.inclination,
            sat.raan,
            sat.initialPhase,
          );
        }
        return (
          <LegacySatelliteMarker
            key={sat.sourceId}
            position={position3D}
            color={sat.color}
            name={sat.name}
          />
        );
      })}
      {config.stateVectors?.map((sv) => {
        const svData: StateVector = {
          x: sv.x,
          y: sv.y,
          z: sv.z,
          vx: sv.vx,
          vy: sv.vy,
          vz: sv.vz,
          epoch: sv.epoch,
        };
        const points = showOrbitalPaths
          ? generateOrbitalPathFromStateVector(svData)
          : [];
        return (
          <OrbitalPath
            key={`sv-orbit-${sv.id}`}
            points={points}
            color={sv.color}
            propagationTime={propagationTime}
          >
            <StateVectorEciMarker
              sv={svData}
              color={sv.color}
              propagationTime={propagationTime}
            />
          </OrbitalPath>
        );
      })}
      {groundStations.map((gs) => (
        <GroundStationMarker
          key={gs.name}
          lat={gs.lat}
          lng={gs.lng}
          color={gs.color}
          name={gs.name}
        />
      ))}

      <CameraAnimator satellite={selectedSatellite ?? null} />
      <Earth.Controls minDistance={7} maxDistance={300} />
    </>
  );
}

export function EarthPanel({ panel }: EarthPanelProps) {
  const config = panel.config as unknown as EarthConfig;

  const enableRotation = config.enableRotation ?? true;
  const timeScale = config.timeScale ?? 1;
  const brightness = config.brightness ?? 1;
  const showClouds = config.showClouds ?? true;
  const legacySatellites = config.satellites || [];

  const dayMapUrl = config.dayMapUrl ?? "/day.webp";
  const cloudsMapUrl = config.cloudsMapUrl ?? "/clouds.webp";
  const normalMapUrl = config.normalMapUrl ?? "/day.webp";
  const specularMapUrl = config.specularMapUrl ?? "/bump.webp";

  const { orbitalDevices, refreshTles } = useOrbitalDevices();
  const [showAddSatellite, setShowAddSatellite] = useState(false);
  const [selectedSatellite, setSelectedSatellite] = useState<Satellite | null>(
    null,
  );

  const catalogSatellites = useMemo(() => {
    const ids = config.deviceIds || [];
    const groups = config.deviceGroups || [];
    const noradIds = config.noradIds || [];
    if (ids.length === 0 && groups.length === 0 && noradIds.length === 0)
      return [];
    const idSet = new Set(ids);
    const groupSet = new Set(groups);
    const noradSet = new Set(noradIds.map(Number));
    return orbitalDevices.filter(
      (s) =>
        idSet.has(s.id) ||
        (s.group_name != null && groupSet.has(s.group_name)) ||
        (noradSet.size > 0 && noradSet.has(s.norad_id)),
    );
  }, [orbitalDevices, config.deviceIds, config.deviceGroups, config.noradIds]);

  useEffect(() => {
    const hasStale = catalogSatellites.some((s) => {
      if (!s.tle_epoch) return true;
      return Date.now() - new Date(s.tle_epoch).getTime() > 7 * 86400000;
    });
    if (hasStale && catalogSatellites.length > 0) {
      refreshTles().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [propagationTime, setPropagationTime] = useState(
    () => config.epochOverride ?? Date.now(),
  );

  useEffect(() => {
    const override = config.epochOverride;
    if (override != null) {
      // Deferred so the sync isn't a synchronous setState cascade in the effect.
      queueMicrotask(() => setPropagationTime(override));
      return;
    }
    if (legacySatellites.length === 0 && catalogSatellites.length === 0) return;
    const interval = setInterval(() => {
      setPropagationTime(Date.now());
    }, 50);
    return () => clearInterval(interval);
  }, [config.epochOverride, legacySatellites.length, catalogSatellites.length]);

  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (legacySatellites.length === 0 && catalogSatellites.length === 0) return;
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 50);
    return () => clearInterval(interval);
  }, [legacySatellites.length, catalogSatellites.length]);

  const groundStations = config.groundStations || [];

  const hasSatellites =
    legacySatellites.length > 0 || catalogSatellites.length > 0;

  if (!hasSatellites) {
    const emptySunPos = config.showSunLighting
      ? (() => {
          const d = new Date();
          const doy =
            (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
              Date.UTC(d.getUTCFullYear(), 0, 0)) /
            86400000;
          const dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
          const decR = (dec * Math.PI) / 180;
          const hf =
            (d.getUTCHours() +
              d.getUTCMinutes() / 60 +
              d.getUTCSeconds() / 3600) /
            24;
          const ha = hf * 2 * Math.PI;
          return new THREE.Vector3(
            -Math.cos(decR) * Math.cos(ha),
            Math.sin(decR),
            -Math.cos(decR) * Math.sin(ha),
          ).normalize();
        })()
      : undefined;

    return (
      <div className="relative w-full h-full">
        <Earth.Root
          dayMapUrl={dayMapUrl}
          cloudsMapUrl={showClouds ? cloudsMapUrl : undefined}
          normalMapUrl={normalMapUrl}
          specularMapUrl={specularMapUrl}
          enableRotation={enableRotation}
          timeScale={timeScale}
          brightness={brightness}
        >
          <Earth.Canvas height="100%" width="100%" cameraPosition={[0, 5, 20]}>
            {config.showSunLighting ? (
              <Suspense
                fallback={
                  <Earth.Globe>
                    {config.showAtmosphere !== false && <Earth.Atmosphere />}
                  </Earth.Globe>
                }
              >
                <RealisticEarthGlobe
                  dayMapUrl={dayMapUrl}
                  nightMapUrl="/night.webp"
                  cloudsMapUrl={showClouds ? cloudsMapUrl : "/black.png"}
                  bumpMapUrl={specularMapUrl}
                  rotationSpeed={enableRotation ? 0.0001 : 0}
                  sunPosition={emptySunPos}
                />
              </Suspense>
            ) : (
              <>
                <Earth.Globe>
                  {config.showAtmosphere !== false && <Earth.Atmosphere />}
                </Earth.Globe>
                {showClouds && <Earth.Clouds />}
              </>
            )}
            <Earth.Controls minDistance={7} maxDistance={300} />
          </Earth.Canvas>
        </Earth.Root>
        <AddSatelliteModal
          open={showAddSatellite}
          onOpenChange={setShowAddSatellite}
        />
      </div>
    );
  }

  const panelOpen = !!selectedSatellite;

  return (
    <div className="flex w-full h-full">
      <div
        className="relative h-full transition-all duration-500 ease-in-out"
        style={{ width: panelOpen ? "60%" : "100%" }}
      >
        <Earth.Root
          dayMapUrl={dayMapUrl}
          cloudsMapUrl={showClouds ? cloudsMapUrl : undefined}
          normalMapUrl={normalMapUrl}
          specularMapUrl={specularMapUrl}
          enableRotation={false}
          timeScale={timeScale}
          brightness={brightness}
        >
          <Earth.Canvas
            height="100%"
            width="100%"
            cameraPosition={[0, 2, 16]}
            cameraFov={55}
          >
            <EarthSceneContent
              config={config}
              elapsedMs={elapsedMs}
              propagationTime={propagationTime}
              catalogSatellites={catalogSatellites}
              onSelectSatellite={setSelectedSatellite}
              selectedSatellite={selectedSatellite}
              selectedSatelliteId={selectedSatellite?.id ?? null}
              groundStations={groundStations}
            />
          </Earth.Canvas>
        </Earth.Root>
        <AddSatelliteModal
          open={showAddSatellite}
          onOpenChange={setShowAddSatellite}
        />
      </div>

      {/* Satellite detail panel — slides in from right */}
      <div
        className="h-full overflow-hidden transition-all duration-500 ease-in-out"
        style={{ width: panelOpen ? "40%" : "0%" }}
      >
        {panelOpen && (
          <SatelliteDetailPanel
            satellite={selectedSatellite}
            onClose={() => setSelectedSatellite(null)}
          />
        )}
      </div>
    </div>
  );
}
