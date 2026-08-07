"use client";

import * as React from "react";
import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useMemo, useLayoutEffect, forwardRef, ReactNode } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import {
  EARTH_RADIUS,
  EARTH_ROTATION_PERIOD_SECONDS,
  EARTH_AXIAL_TILT_DEG,
} from "@/lib/constants/earth";

/**
 * Sphere Primitive
 *
 * Reusable sphere geometry with automatic LOD, texture loading, and shader support.
 * Base primitive for planets, moons, and other spherical bodies.
 *
 * Features:
 * - Automatic LOD based on camera distance
 * - Normal map support for surface detail
 * - Bump mapping for displacement
 * - Specular highlights
 * - Composable with Atmosphere, Clouds, Rings
 *
 * @example
 * ```tsx
 * <Sphere radius={6.371} textureUrl="/earth.jpg">
 *   <Atmosphere />
 * </Sphere>
 * ```
 */

export interface SphereProps {
  /** Radius in scene units */
  radius: number;
  /** Main texture (diffuse/albedo) */
  textureUrl?: string;
  /** Normal map for surface detail */
  normalMapUrl?: string;
  /** Bump map for displacement */
  bumpMapUrl?: string;
  /** Roughness map (replaces specular for PBR) */
  specularMapUrl?: string;
  /** Emissive texture (for night lights) */
  emissiveMapUrl?: string;
  /** Base color if no texture */
  color?: THREE.ColorRepresentation;
  /** Emissive color */
  emissiveColor?: THREE.ColorRepresentation;
  /** Emissive intensity */
  emissiveIntensity?: number;
  /** Use unlit material (meshBasicMaterial) - ignores lighting for full brightness */
  unlit?: boolean;
  /** Rotation speed (radians per frame) */
  rotationSpeed?: number;
  /** Initial rotation offset */
  rotation?: [number, number, number];
  /** Segments for geometry (higher = smoother) */
  segments?: number;
  /** Enable automatic LOD */
  autoLOD?: boolean;
  /** Metalness (PBR) */
  metalness?: number;
  /** Roughness (PBR) */
  roughness?: number;
  /** Composable children (Atmosphere, Clouds, etc) */
  children?: ReactNode;
  /** Ref to mesh */
  ref?: React.Ref<THREE.Mesh>;
}

export const Sphere = forwardRef<THREE.Mesh, SphereProps>(
  (
    {
      radius,
      textureUrl,
      normalMapUrl,
      bumpMapUrl,
      specularMapUrl,
      emissiveMapUrl,
      color = 0xffffff,
      emissiveColor,
      emissiveIntensity,
      unlit = false,
      rotationSpeed = 0,
      rotation = [0, 0, 0],
      segments = 64,
      metalness = 0,
      children,
    },
    ref
  ) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const groupRef = useRef<THREE.Group>(null);

    // Load textures
    const textures = useMemo(() => {
      const loader = new THREE.TextureLoader();
      return {
        map: textureUrl ? loader.load(textureUrl) : null,
        normalMap: normalMapUrl ? loader.load(normalMapUrl) : null,
        bumpMap: bumpMapUrl ? loader.load(bumpMapUrl) : null,
        roughnessMap: specularMapUrl ? loader.load(specularMapUrl) : null,
        emissiveMap: emissiveMapUrl ? loader.load(emissiveMapUrl) : null,
      };
    }, [textureUrl, normalMapUrl, bumpMapUrl, specularMapUrl, emissiveMapUrl]);

    // Apply rotation
    useFrame(() => {
      if (meshRef.current && rotationSpeed !== 0) {
        meshRef.current.rotation.y += rotationSpeed;
      }
    });

    // Set initial rotation (refs are only attached after commit, so this must
    // run in a layout effect rather than during render).
    useLayoutEffect(() => {
      if (groupRef.current) {
        groupRef.current.rotation.set(...rotation);
      }
    }, [rotation]);

    // Expose the mesh through the forwarded ref.
    useLayoutEffect(() => {
      if (ref && meshRef.current) {
        if (typeof ref === "function") {
          ref(meshRef.current);
        } else {
          (ref as React.MutableRefObject<THREE.Mesh>).current = meshRef.current;
        }
      }
    }, [ref]);

    return (
      <group ref={groupRef}>
        <mesh ref={meshRef}>
          <sphereGeometry args={[radius, segments, segments / 2]} />
          {unlit ? (
            <meshBasicMaterial
              map={textures.map}
              color={color}
              toneMapped={false}
            />
          ) : (
            <meshStandardMaterial
              map={textures.map}
              normalMap={textures.normalMap}
              bumpMap={textures.bumpMap}
              roughnessMap={textures.roughnessMap}
              emissiveMap={textures.emissiveMap}
              color={color}
              metalness={metalness}
              roughness={0.6}
              emissive={emissiveColor ?? (emissiveMapUrl ? 0xffffff : 0x000000)}
              emissiveIntensity={
                emissiveIntensity ?? (emissiveMapUrl ? 2.0 : 0)
              }
            />
          )}
        </mesh>
        {children}
      </group>
    );
  }
);

Sphere.displayName = "Sphere";

/**
 * Atmosphere Primitive
 *
 * Composable atmospheric glow effect using custom shader.
 * Designed to be nested inside Sphere.
 *
 * @example
 * ```tsx
 * <Sphere radius={6.371}>
 *   <Atmosphere color="#4488ff" intensity={0.8} />
 * </Sphere>
 * ```
 */

const ATMOSPHERE_SHADER = {
  vertex: `
    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
      vNormal = normalize(normalMatrix * normal);
      vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: `
    uniform vec3 glowColor;
    uniform float intensity;
    uniform float falloff;

    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
      vec3 viewDir = normalize(-vPosition);
      float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), falloff);
      float alpha = fresnel * intensity;

      gl_FragColor = vec4(glowColor, alpha);
    }
  `,
};

export interface AtmosphereProps {
  color?: THREE.ColorRepresentation;
  intensity?: number;
  falloff?: number;
  scale?: number;
}

export function Atmosphere({
  color = 0x4488ff,
  intensity = 0.6,
  falloff = 3.0,
  scale = 1.015,
}: AtmosphereProps) {
  const uniforms = useMemo(
    () => ({
      glowColor: { value: new THREE.Color(color) },
      intensity: { value: intensity },
      falloff: { value: falloff },
    }),
    [color, intensity, falloff]
  );

  return (
    <mesh scale={scale}>
      <sphereGeometry args={[1, 64, 32]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={ATMOSPHERE_SHADER.vertex}
        fragmentShader={ATMOSPHERE_SHADER.fragment}
        transparent
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Clouds Primitive
 *
 * Rotating cloud layer with transparency.
 * Designed to be nested inside Sphere.
 *
 * @example
 * ```tsx
 * <Sphere radius={6.371}>
 *   <Clouds textureUrl="/clouds.jpg" height={1.005} />
 * </Sphere>
 * ```
 */

export interface CloudsProps {
  textureUrl: string;
  height?: number;
  opacity?: number;
  rotationSpeed?: number;
}

export function Clouds({
  textureUrl,
  height = 1.003,
  opacity = 0.4,
  rotationSpeed = 0.0001,
}: CloudsProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const texture = useLoader(THREE.TextureLoader, textureUrl);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += rotationSpeed;
    }
  });

  return (
    <mesh ref={meshRef} scale={height}>
      <sphereGeometry args={[1, 64, 32]} />
      <meshStandardMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Clouds with explicit radius (for use with Earth component)
 */
function CloudsWithRadius({
  textureUrl,
  radius,
  opacity = 0.4,
  rotationSpeed = 0.0001,
}: {
  textureUrl: string;
  radius: number;
  opacity?: number;
  rotationSpeed?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const texture = useLoader(THREE.TextureLoader, textureUrl);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += rotationSpeed;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[radius, 64, 32]} />
      <meshStandardMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Ring Primitive
 *
 * Flat ring geometry for Saturn-style rings or orbital paths.
 *
 * @example
 * ```tsx
 * <Ring innerRadius={1.5} outerRadius={2.5} textureUrl="/saturn-rings.png" />
 * ```
 */

export interface RingProps {
  innerRadius: number;
  outerRadius: number;
  textureUrl?: string;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  rotation?: [number, number, number];
  thetaSegments?: number;
}

function RingMesh({
  innerRadius,
  outerRadius,
  color = 0xffffff,
  opacity = 1,
  rotation = [Math.PI / 2, 0, 0],
  thetaSegments = 128,
  texture,
}: Omit<RingProps, "textureUrl"> & { texture: THREE.Texture | null }) {
  return (
    <mesh rotation={rotation}>
      <ringGeometry args={[innerRadius, outerRadius, thetaSegments]} />
      <meshBasicMaterial
        map={texture}
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// Loads the texture unconditionally (hooks must run in the same order every
// render), then renders the shared RingMesh.
function TexturedRing({
  textureUrl,
  ...rest
}: Omit<RingProps, "textureUrl"> & { textureUrl: string }) {
  const texture = useLoader(THREE.TextureLoader, textureUrl);
  return <RingMesh {...rest} texture={texture} />;
}

export function Ring({ textureUrl, ...rest }: RingProps) {
  if (textureUrl) {
    return <TexturedRing textureUrl={textureUrl} {...rest} />;
  }
  return <RingMesh {...rest} texture={null} />;
}

// ============================================================================
// Constants - re-exported from lib/constants/earth.ts to avoid Three.js leak
// ============================================================================

export {
  EARTH_RADIUS_KM,
  SCENE_SCALE,
  EARTH_RADIUS,
  EARTH_ROTATION_PERIOD_SECONDS,
  EARTH_ORBITAL_PERIOD_DAYS,
  EARTH_AXIAL_TILT_DEG,
} from "@/lib/constants/earth";

// ============================================================================
// Utilities
// ============================================================================

export function getCurrentDayOfYear(): {
  dayOfYear: number;
  fractionOfDay: number;
} {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  const fractionOfDay =
    (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
  return { dayOfYear, fractionOfDay };
}

export function calculateEarthRotation(timeScale: number = 1): number {
  const { fractionOfDay } = getCurrentDayOfYear();
  return fractionOfDay * 2 * Math.PI * timeScale;
}

// ============================================================================
// Context
// ============================================================================

interface EarthContext {
  radius: number;
  rotationSpeed: number;
  axialTilt: [number, number, number];
  brightness: number;
  timeScale: number;
  dayMapUrl?: string;
  nightMapUrl?: string;
  cloudsMapUrl?: string;
  normalMapUrl?: string;
  specularMapUrl?: string;
}

const EarthContext = React.createContext<EarthContext | null>(null);

function useEarth() {
  const ctx = React.useContext(EarthContext);
  if (!ctx) throw new Error("useEarth must be used within Earth.Root");
  return ctx;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Props for Earth.Root component
 * Root component that provides context for all Earth sub-components
 */
export interface EarthRootProps {
  /**
   * Texture URL for day map (Earth's surface in daylight)
   * @example "/textures/earth-day.jpg"
   */
  dayMapUrl?: string;
  /**
   * Texture URL for night lights map (city lights visible on night side)
   * @example "/textures/earth-night.jpg"
   */
  nightMapUrl?: string;
  /**
   * Texture URL for clouds map (cloud layer texture)
   * @example "/textures/earth-clouds.jpg"
   */
  cloudsMapUrl?: string;
  /**
   * Texture URL for normal map (surface detail and elevation)
   * @example "/textures/earth-normal.jpg"
   */
  normalMapUrl?: string;
  /**
   * Texture URL for specular map (controls reflectivity of oceans)
   * @example "/textures/earth-specular.jpg"
   */
  specularMapUrl?: string;
  /**
   * Earth radius in scene units
   * @default EARTH_RADIUS (6.371 scene units, representing 6371 km)
   * @example 5, 10, 15
   */
  radius?: number;
  /**
   * Enable automatic rotation based on Earth's actual rotation period
   * @default true
   */
  enableRotation?: boolean;
  /**
   * Time scale multiplier for rotation speed
   * 1 = real-time, 10 = 10x faster, 0.1 = 10x slower
   * @default 1
   * @range 0.1-1000
   * @example 1 (real-time), 10 (10x faster), 0.1 (10x slower)
   */
  timeScale?: number;
  /**
   * Overall brightness multiplier for lighting and emissive maps
   * @default 1.0
   * @range 0.0-2.0
   * @example 0.8 (dimmer), 1.2 (brighter)
   */
  brightness?: number;
  /**
   * Child components (Canvas, Globe, Atmosphere, etc.)
   */
  children?: React.ReactNode;
}

/**
 * Props for Earth.Canvas component
 * Three.js Canvas wrapper with camera configuration
 */
export interface EarthCanvasProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Camera position in 3D space [x, y, z]
   * @default [0, 5, 20]
   * @example [0, 10, 30], [10, 5, 15]
   */
  cameraPosition?: [number, number, number];
  /**
   * Camera field of view in degrees
   * @default 45
   * @range 20-120
   * @example 35 (narrow), 60 (wide)
   */
  cameraFov?: number;
  /**
   * Canvas height (CSS value)
   * @default "600px"
   * @example "400px", "100vh", "50%"
   */
  height?: string;
  /**
   * Canvas width (CSS value)
   * @default "100%"
   * @example "800px", "100vw", "50%"
   */
  width?: string;
}

/**
 * Props for Earth.Controls component
 * Orbit controls for camera manipulation
 */
export interface EarthControlsProps
  extends React.ComponentPropsWithRef<typeof OrbitControls> {
  /**
   * Minimum zoom distance from Earth center
   * @default 8
   * @example 5, 10, 15
   */
  minDistance?: number;
  /**
   * Maximum zoom distance from Earth center
   * @default 100
   * @example 50, 200, 500
   */
  maxDistance?: number;
  /**
   * Zoom speed multiplier
   * @default 0.6
   * @range 0.1-2.0
   */
  zoomSpeed?: number;
  /**
   * Pan speed multiplier
   * @default 0.5
   * @range 0.1-2.0
   */
  panSpeed?: number;
  /**
   * Rotation speed multiplier
   * @default 0.4
   * @range 0.1-2.0
   */
  rotateSpeed?: number;
  /**
   * Enable panning with right mouse button
   * @default true
   */
  enablePan?: boolean;
  /**
   * Enable zooming with mouse wheel
   * @default true
   */
  enableZoom?: boolean;
  /**
   * Enable rotation with left mouse button
   * @default true
   */
  enableRotate?: boolean;
  /**
   * Enable smooth camera damping
   * @default true
   */
  enableDamping?: boolean;
  /**
   * Damping inertia factor (lower = more damping)
   * @default 0.05
   * @range 0.01-0.3
   */
  dampingFactor?: number;
}

/**
 * Props for Earth.Globe component
 * Main Earth sphere with textures
 */
export interface EarthGlobeProps
  extends Omit<
    React.ComponentPropsWithRef<typeof Sphere>,
    | "radius"
    | "textureUrl"
    | "normalMapUrl"
    | "specularMapUrl"
    | "emissiveMapUrl"
    | "rotationSpeed"
    | "rotation"
  > {
  /**
   * Number of segments for sphere geometry (higher = smoother)
   * @default 128
   * @range 32-256
   * @example 64 (lower detail), 256 (highest detail)
   */
  segments?: number;
}

/**
 * Props for Earth.Atmosphere component
 * Atmospheric glow effect around Earth
 */
export interface EarthAtmosphereProps
  extends React.ComponentPropsWithRef<typeof Atmosphere> {
  /**
   * Atmosphere color (any CSS color format)
   * @default "#4488ff"
   * @example "#88ccff", "rgb(68, 136, 255)", "hsl(210, 100%, 64%)"
   */
  color?: string;
  /**
   * Atmosphere glow intensity
   * @default 0.8
   * @range 0.0-2.0
   * @example 0.5 (subtle), 1.5 (intense)
   */
  intensity?: number;
  /**
   * Atmosphere falloff exponent (higher = sharper edge)
   * @default 3.5
   * @range 1.0-6.0
   * @example 2.0 (soft edge), 5.0 (sharp edge)
   */
  falloff?: number;
  /**
   * Atmosphere size scale relative to globe
   * @default 1.02
   * @range 1.01-1.1
   * @example 1.01 (thin), 1.05 (thick)
   */
  scale?: number;
}

/**
 * Props for Earth.Clouds component
 * Cloud layer with independent rotation
 */
export interface EarthCloudsProps
  extends Omit<React.ComponentPropsWithRef<typeof Clouds>, "textureUrl"> {
  /**
   * Cloud layer height relative to Earth surface
   * @default 1.005
   * @range 1.001-1.02
   * @example 1.003, 1.01
   */
  height?: number;
  /**
   * Cloud layer opacity
   * @default 0.5
   * @range 0.0-1.0
   * @example 0.3 (transparent), 0.7 (opaque)
   */
  opacity?: number;
  /**
   * Cloud rotation speed relative to Earth rotation
   * @default 0.8
   * @range 0.0-2.0
   * @example 0.5 (slower), 1.5 (faster)
   */
  rotationSpeedMultiplier?: number;
}

// ============================================================================
// Primitives
// ============================================================================

/**
 * Root component - provides context for all child components
 */
const EarthRoot = React.forwardRef<HTMLDivElement, EarthRootProps>(
  (
    {
      dayMapUrl,
      nightMapUrl,
      cloudsMapUrl,
      normalMapUrl,
      specularMapUrl,
      radius = EARTH_RADIUS,
      enableRotation = true,
      timeScale = 1,
      brightness = 1.0,
      children,
    },
    ref
  ) => {
    const rotationSpeed = React.useMemo(() => {
      if (!enableRotation) return 0;
      return ((2 * Math.PI) / (EARTH_ROTATION_PERIOD_SECONDS * 60)) * timeScale;
    }, [enableRotation, timeScale]);

    const axialTilt: [number, number, number] = React.useMemo(
      () => [THREE.MathUtils.degToRad(EARTH_AXIAL_TILT_DEG), 0, 0],
      []
    );

    const contextValue: EarthContext = React.useMemo(
      () => ({
        radius,
        rotationSpeed,
        axialTilt,
        brightness,
        timeScale,
        dayMapUrl,
        nightMapUrl,
        cloudsMapUrl,
        normalMapUrl,
        specularMapUrl,
      }),
      [
        radius,
        rotationSpeed,
        axialTilt,
        brightness,
        timeScale,
        dayMapUrl,
        nightMapUrl,
        cloudsMapUrl,
        normalMapUrl,
        specularMapUrl,
      ]
    );

    return (
      <EarthContext.Provider value={contextValue}>
        <div ref={ref} className="earth-root relative h-full w-full">
          {children}
        </div>
      </EarthContext.Provider>
    );
  }
);

EarthRoot.displayName = "Earth.Root";

/**
 * Canvas component - wraps the Three.js canvas
 */
const EarthCanvas = React.forwardRef<HTMLDivElement, EarthCanvasProps>(
  (
    {
      cameraPosition = [0, 5, 20],
      cameraFov = 45,
      height = "600px",
      width = "100%",
      className,
      style,
      children,
      ...props
    },
    ref
  ) => {
    const { brightness } = useEarth();

    return (
      <div
        ref={ref}
        className={className}
        style={{ height, width, ...style }}
        {...props}
      >
        <Canvas
          style={{
            height: "100%",
            width: "100%",
          }}
          camera={{ position: cameraPosition, fov: cameraFov }}
          gl={{
            antialias: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 2.0,
          }}
        >
          <color attach="background" args={[0, 0, 0]} />

          <Suspense fallback={null}>
            <ambientLight intensity={1.2 * brightness} color={0xffffff} />
            {children}
          </Suspense>
        </Canvas>
      </div>
    );
  }
);

EarthCanvas.displayName = "Earth.Canvas";

/**
 * Controls component - adds orbit controls to the scene
 */
const EarthControls = React.forwardRef<
  React.ComponentRef<typeof OrbitControls>,
  EarthControlsProps
>(
  (
    {
      minDistance = 8,
      maxDistance = 100,
      zoomSpeed = 0.6,
      panSpeed = 0.5,
      rotateSpeed = 0.4,
      enablePan = true,
      enableZoom = true,
      enableRotate = true,
      enableDamping = true,
      dampingFactor = 0.05,
      ...props
    },
    ref
  ) => {
    return (
      <OrbitControls
        ref={ref}
        makeDefault
        enablePan={enablePan}
        enableZoom={enableZoom}
        enableRotate={enableRotate}
        zoomSpeed={zoomSpeed}
        panSpeed={panSpeed}
        rotateSpeed={rotateSpeed}
        minDistance={minDistance}
        maxDistance={maxDistance}
        enableDamping={enableDamping}
        dampingFactor={dampingFactor}
        {...props}
      />
    );
  }
);

EarthControls.displayName = "Earth.Controls";

/**
 * Globe component - renders the main Earth sphere
 */
const EarthGlobe = React.forwardRef<THREE.Mesh, EarthGlobeProps>(
  ({ segments = 128, children, ...props }, ref) => {
    const {
      radius,
      rotationSpeed,
      axialTilt,
      dayMapUrl,
      nightMapUrl,
      normalMapUrl,
      specularMapUrl,
    } = useEarth();

    return (
      <Sphere
        ref={ref}
        radius={radius}
        textureUrl={dayMapUrl}
        normalMapUrl={normalMapUrl}
        specularMapUrl={specularMapUrl}
        emissiveMapUrl={nightMapUrl}
        rotationSpeed={rotationSpeed}
        rotation={axialTilt}
        segments={segments}
        {...props}
      >
        {children}
      </Sphere>
    );
  }
);

EarthGlobe.displayName = "Earth.Globe";

/**
 * Atmosphere component - renders the atmospheric glow
 */
const EarthAtmosphere = React.forwardRef<THREE.Mesh, EarthAtmosphereProps>(
  (
    {
      color = "#4488ff",
      intensity = 0.8,
      falloff = 3.5,
      scale = 1.02,
      ...props
    }
  ) => {
    return (
      <Atmosphere
        color={color}
        intensity={intensity}
        falloff={falloff}
        scale={scale}
        {...props}
      />
    );
  }
);

EarthAtmosphere.displayName = "Earth.Atmosphere";

/**
 * Clouds component - renders the cloud layer
 */
const EarthClouds = React.forwardRef<THREE.Mesh, EarthCloudsProps>(
  (
    { height = 1.005, opacity = 0.5, rotationSpeedMultiplier = 0.8, ...props }
  ) => {
    const { cloudsMapUrl, rotationSpeed, radius } = useEarth();

    if (!cloudsMapUrl) return null;

    // Scale clouds to match Earth radius
    const cloudRadius = radius * height;

    return (
      <CloudsWithRadius
        textureUrl={cloudsMapUrl}
        radius={cloudRadius}
        opacity={opacity}
        rotationSpeed={rotationSpeed * rotationSpeedMultiplier}
        {...props}
      />
    );
  }
);

EarthClouds.displayName = "Earth.Clouds";

/**
 * Props for Earth.Axis component
 * Debug helper that displays XYZ coordinate axes
 */
export interface EarthAxisProps
  extends React.ComponentPropsWithRef<"axesHelper"> {
  /**
   * Axis line length in scene units
   * @default radius * 3
   * @example 10, 20, 50
   */
  size?: number;
}

/**
 * Axis helper component - shows coordinate axes (for debugging)
 */
const EarthAxis = React.forwardRef<THREE.AxesHelper, EarthAxisProps>(
  ({ size, ...props }, ref) => {
    const { radius } = useEarth();
    const axisSize = size ?? radius * 3;

    return <axesHelper ref={ref} args={[axisSize]} {...props} />;
  }
);

EarthAxis.displayName = "Earth.Axis";

// ============================================================================
// Exports
// ============================================================================

export const Earth = Object.assign(EarthRoot, {
  Root: EarthRoot,
  Canvas: EarthCanvas,
  Controls: EarthControls,
  Globe: EarthGlobe,
  Atmosphere: EarthAtmosphere,
  Clouds: EarthClouds,
  Axis: EarthAxis,
});
