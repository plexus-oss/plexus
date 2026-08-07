"use client";

/**
 * RealisticEarthGlobe - Custom Earth with accurate day/night shading
 *
 * Uses a custom shader that:
 * - Shows the day texture on the sun-lit side
 * - Shows city lights (night texture) only on the dark side
 * - Smoothly blends at the terminator (day/night boundary)
 * - Supports bump mapping for terrain elevation
 */

import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { EARTH_RADIUS } from "@/lib/constants/earth";

// Custom shader for day/night Earth with proper terminator
const EARTH_SHADER = {
  vertex: `
    varying vec2 vUv;
    varying vec3 vNormalWorld;
    varying vec3 vPositionWorld;
    varying vec3 vTangent;
    varying vec3 vBitangent;

    void main() {
      vUv = uv;
      // Transform normal to world space (not view space)
      vNormalWorld = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vPositionWorld = (modelMatrix * vec4(position, 1.0)).xyz;

      // Calculate tangent and bitangent for bump mapping
      vec3 tangent = normalize(cross(vec3(0.0, 1.0, 0.0), normal));
      if (length(tangent) < 0.01) {
        tangent = normalize(cross(vec3(1.0, 0.0, 0.0), normal));
      }
      vec3 bitangent = normalize(cross(normal, tangent));
      vTangent = normalize((modelMatrix * vec4(tangent, 0.0)).xyz);
      vBitangent = normalize((modelMatrix * vec4(bitangent, 0.0)).xyz);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: `
    uniform sampler2D dayMap;
    uniform sampler2D nightMap;
    uniform sampler2D cloudsMap;
    uniform sampler2D bumpMap;
    uniform vec3 sunDirection;
    uniform float cloudOpacity;

    varying vec2 vUv;
    varying vec3 vNormalWorld;
    varying vec3 vPositionWorld;
    varying vec3 vTangent;
    varying vec3 vBitangent;

    void main() {
      // Sample textures
      vec4 dayColor = texture2D(dayMap, vUv);
      vec4 nightColor = texture2D(nightMap, vUv);
      vec4 clouds = texture2D(cloudsMap, vUv);

      // Bump mapping - perturb normal based on height map gradient
      float bumpScale = 0.02;
      vec2 texelSize = vec2(1.0 / 2048.0); // Assuming 2k texture
      float heightL = texture2D(bumpMap, vUv - vec2(texelSize.x, 0.0)).r;
      float heightR = texture2D(bumpMap, vUv + vec2(texelSize.x, 0.0)).r;
      float heightD = texture2D(bumpMap, vUv - vec2(0.0, texelSize.y)).r;
      float heightU = texture2D(bumpMap, vUv + vec2(0.0, texelSize.y)).r;

      vec3 bumpNormal = normalize(vNormalWorld);
      bumpNormal += vTangent * (heightL - heightR) * bumpScale;
      bumpNormal += vBitangent * (heightD - heightU) * bumpScale;
      bumpNormal = normalize(bumpNormal);

      // Calculate sun illumination using bump-perturbed normal
      vec3 sunDir = normalize(sunDirection);
      float sunDot = dot(bumpNormal, sunDir);
      float sunDotBase = dot(normalize(vNormalWorld), sunDir); // For terminator

      // Soft terminator transition (use base normal for consistent terminator)
      float dayFactor = smoothstep(-0.1, 0.2, sunDotBase);

      // Day side: full color with diffuse lighting (use bump normal for detail)
      vec3 dayLit = dayColor.rgb * (0.15 + 0.85 * max(0.0, sunDot));

      // Night side: dark base with subtle ambient + dim city lights
      float nightLightIntensity = max(nightColor.r, max(nightColor.g, nightColor.b));
      vec3 cityLights = nightColor.rgb * nightLightIntensity * 0.5;
      vec3 nightAmbient = dayColor.rgb * 0.03;
      vec3 nightLit = nightAmbient + cityLights;

      // Blend day and night
      vec3 earthColor = mix(nightLit, dayLit, dayFactor);

      // Add clouds - light and wispy on day side, faintly visible on night side
      float cloudAlpha = clouds.r * cloudOpacity;
      float cloudBrightness = 0.95 + 0.05 * max(0.0, sunDotBase); // Bright white clouds
      vec3 cloudColor = vec3(cloudBrightness);
      // Clouds visible on day side, very faint on night side
      float cloudVisibility = mix(0.15, 1.0, dayFactor);
      earthColor = mix(earthColor, cloudColor, cloudAlpha * cloudVisibility);

      // Very subtle rim on day side only
      vec3 viewDir = normalize(cameraPosition - vPositionWorld);
      float rim = 1.0 - max(0.0, dot(viewDir, bumpNormal));
      rim = pow(rim, 4.0);
      vec3 rimColor = vec3(0.2, 0.4, 0.8) * rim * 0.2 * dayFactor;

      gl_FragColor = vec4(earthColor + rimColor, 1.0);
    }
  `,
};

interface RealisticEarthGlobeProps {
  dayMapUrl: string;
  nightMapUrl: string;
  cloudsMapUrl: string;
  bumpMapUrl: string;
  radius?: number;
  rotationSpeed?: number;
  cloudOpacity?: number;
  sunPosition?: THREE.Vector3;
}

export function RealisticEarthGlobe({
  dayMapUrl,
  nightMapUrl,
  cloudsMapUrl,
  bumpMapUrl,
  radius = EARTH_RADIUS,
  rotationSpeed = 0.0001,
  cloudOpacity = 0.55,
  sunPosition,
}: RealisticEarthGlobeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Load all textures
  const [dayMap, nightMap, cloudsMap, bumpMap] = useLoader(THREE.TextureLoader, [
    dayMapUrl,
    nightMapUrl,
    cloudsMapUrl,
    bumpMapUrl,
  ]);

  // Shader uniforms
  const uniforms = useMemo(
    () => ({
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      cloudsMap: { value: cloudsMap },
      bumpMap: { value: bumpMap },
      // Sun pointing toward camera (positive Z) initially
      sunDirection: { value: new THREE.Vector3(0, 0.3, 1).normalize() },
      cloudOpacity: { value: cloudOpacity },
    }),
    [dayMap, nightMap, cloudsMap, bumpMap, cloudOpacity]
  );

  // Update sun direction and rotation each frame
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += rotationSpeed;
    }

    if (materialRef.current) {
      if (sunPosition) {
        // Use provided sun position
        materialRef.current.uniforms.sunDirection.value.copy(sunPosition.normalize());
      } else {
        // Calculate astronomically accurate sun position
        const now = new Date();

        // Day of year (0-365)
        const start = new Date(now.getFullYear(), 0, 0);
        const diff = now.getTime() - start.getTime();
        const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

        // Solar declination (angle of sun above/below equator)
        // Varies from +23.44° at summer solstice to -23.44° at winter solstice
        const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
        const declinationRad = (declination * Math.PI) / 180;

        // Hour angle based on UTC time (0-2π over 24 hours)
        // Three.js SphereGeometry UV mapping:
        //   u=0 (180°W, Date Line): normal toward -X
        //   u=0.5 (0°, Prime Meridian): normal toward +X
        // At noon UTC, sun is over Prime Meridian, so sun should point toward +X
        const hourFraction = (now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600) / 24;
        const hourAngle = hourFraction * 2 * Math.PI;

        // Sun direction aligned with Three.js SphereGeometry coordinates:
        // - At noon UTC (hourAngle = π): sun points +X (Prime Meridian lit)
        // - At midnight UTC (hourAngle = 0): sun points -X (Date Line lit)
        // - At 6am UTC (hourAngle = π/2): sun points -Z (90°E lit)
        // - At 6pm UTC (hourAngle = 3π/2): sun points +Z (90°W lit)
        const sunDir = new THREE.Vector3(
          -Math.cos(declinationRad) * Math.cos(hourAngle),
          Math.sin(declinationRad),
          -Math.cos(declinationRad) * Math.sin(hourAngle)
        ).normalize();

        materialRef.current.uniforms.sunDirection.value.copy(sunDir);
      }
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[radius, 128, 64]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={EARTH_SHADER.vertex}
        fragmentShader={EARTH_SHADER.fragment}
        transparent={false}
      />
    </mesh>
  );
}
