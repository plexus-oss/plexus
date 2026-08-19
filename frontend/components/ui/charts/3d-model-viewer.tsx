"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls, Environment, Stars } from "@react-three/drei";
import { RealisticEarthGlobe } from "@/components/earth/realistic-earth-globe";
import {
  createContext,
  useContext,
  useRef,
  useState,
  useMemo,
  useEffect,
  forwardRef,
  Suspense,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { viridis } from "@/components/ui/lib/color-scales";

// ============================================================================
// Types
// ============================================================================

export interface ModelViewerProps {
  modelUrl?: string;
  modelType?: "stl" | "obj" | "gltf" | "glb";
  /** Built-in primitive body — rendered instead of a loaded model when set. */
  shape?: "cylinder" | "box" | "cone" | "capsule";
  /**
   * Live attitude from telemetry, in degrees. When set, the whole model
   * tracks it (smoothed): yaw spins about the vertical axis, pitch tips
   * fore/aft, roll tips side to side. Overrides autoRotate.
   */
  orientationDeg?: { pitch: number; roll: number; yaw: number } | null;
  /**
   * Live attitude as a normalized quaternion [x, y, z, w]. Takes precedence
   * over orientationDeg — no Euler conversion, no gimbal artifacts.
   */
  orientationQuat?: [number, number, number, number] | null;
  modelData?: Float32Array | ArrayBuffer;
  vertexColors?: number[]; // Per-vertex color values (0-1)
  colorScale?: (value: number) => string;
  minValue?: number;
  maxValue?: number;
  width?: number | string;
  height?: number | string;
  showGrid?: boolean;
  showAxes?: boolean;
  cameraPosition?: [number, number, number];
  backgroundColor?: string;
  className?: string;
  autoRotate?: boolean;
  wireframe?: boolean;
  metalness?: number;
  roughness?: number;
  /** Callback when GLTF parts are discovered */
  onPartsDiscovered?: (parts: string[]) => void;
  /** Callback when named GLTF groups (parents of meshes) are discovered. Used for layer toggles. */
  onGroupsDiscovered?: (groups: string[]) => void;
  /** Per-object visibility map keyed by Object3D name. Missing entries default to visible. */
  visibilityMap?: Record<string, boolean>;
  /** Fires when a named mesh is clicked (raycast hit). */
  onPartClick?: (name: string, screen: { x: number; y: number }) => void;
  /** Fires when the hovered mesh changes. Passes null on pointer-out. */
  onPartHover?: (name: string | null) => void;
  /** Name of the part to highlight with a hover outline (emissive boost). */
  hoveredPartName?: string | null;
  /**
   * Per-frame callback that emits the 2D screen position of every named GLTF
   * part. Throttled to ~10 Hz to keep React renders cheap. Used by features
   * that draw leader lines / floating labels anchored to model parts.
   */
  onPartScreenPositions?: (
    positions: Record<string, { x: number; y: number; depth: number }>,
  ) => void;
  /** Per-part color mapping (part name → hex/rgb color string) */
  partColors?: Record<string, string>;
  /** Base tint for built-in primitive shapes (hologram wire / body color). */
  modelColor?: string;
  /**
   * Paint the capsule hull with the color scale as a linear fore→aft
   * gradient — rotation (especially roll) reads as moving color.
   */
  hullGradient?: boolean;
  /** Per-part emissive glow (part name → { color, intensity }) */
  partEmissive?: Record<string, { color: string; intensity: number }>;
  /** Per-part local scale multipliers (applied to named child nodes) */
  partScales?: Record<string, number>;
  /** Per-part continuous spin (part name → { axis, speed rad/s }) */
  partSpins?: Record<string, { axis: "x" | "y" | "z"; speed: number }>;
  /** Names of parts that stay pinned (not moved by bodyPosition) — e.g. bin walls */
  fixedParts?: string[];
  /** Position of the movable body (non-fixed parts) in scaled scene units */
  bodyPosition?: [number, number, number];
  /** Base rotation applied to the entire model (radians) — fix orientation */
  modelRotationOffset?: [number, number, number];
  /** Enable CAD-style rendering: edge overlay, matte metal, neutral lighting */
  cadStyle?: boolean;
  /** Enable space-scene background: starfield + Earth backdrop + dramatic sun light. */
  spaceScene?: boolean;
  /** Earth backdrop position [x, y, z] (large units — the sphere is big). */
  earthBackdropPosition?: [number, number, number];
  /** Earth backdrop radius. Default 120. */
  earthBackdropRadius?: number;
}

interface ModelViewerContextType {
  modelUrl?: string;
  modelType: "stl" | "obj" | "gltf" | "glb";
  shape?: "cylinder" | "box" | "cone" | "capsule";
  orientationDeg?: { pitch: number; roll: number; yaw: number } | null;
  orientationQuat?: [number, number, number, number] | null;
  modelData?: Float32Array | ArrayBuffer;
  vertexColors?: number[];
  colorScale: (value: number) => string;
  minValue: number;
  maxValue: number;
  showGrid: boolean;
  showAxes: boolean;
  cameraPosition: [number, number, number];
  backgroundColor: string;
  autoRotate: boolean;
  wireframe: boolean;
  metalness: number;
  roughness: number;
  onPartsDiscovered?: (parts: string[]) => void;
  onGroupsDiscovered?: (groups: string[]) => void;
  onPartScreenPositions?: (
    positions: Record<string, { x: number; y: number; depth: number }>,
  ) => void;
  onPartClick?: (name: string, screen: { x: number; y: number }) => void;
  onPartHover?: (name: string | null) => void;
  hoveredPartName?: string | null;
  visibilityMap?: Record<string, boolean>;
  partColors?: Record<string, string>;
  modelColor?: string;
  hullGradient?: boolean;
  partEmissive?: Record<string, { color: string; intensity: number }>;
  partScales?: Record<string, number>;
  partSpins?: Record<string, { axis: "x" | "y" | "z"; speed: number }>;
  fixedParts?: string[];
  bodyPosition?: [number, number, number];
  modelRotationOffset?: [number, number, number];
  cadStyle: boolean;
  spaceScene?: boolean;
  earthBackdropPosition?: [number, number, number];
  earthBackdropRadius?: number;
}

const ModelViewerContext = createContext<ModelViewerContextType | null>(null);

function useModelViewerData() {
  const ctx = useContext(ModelViewerContext);
  if (!ctx) {
    throw new Error(
      "ModelViewer components must be used within ModelViewer.Root",
    );
  }
  return ctx;
}

// ============================================================================
// Resource disposal
//
// Three.js GPU resources (geometries, materials, textures) are not garbage-
// collected — they must be released explicitly. R3F also does NOT auto-dispose
// an object handed to <primitive object={...} />, so when a model is swapped or
// the panel unmounts we have to walk the graph ourselves. Skipping this leaks
// tens of MB of GPU memory per load (geometry + textures + the Earth backdrop
// maps), which is enough to trip Safari's "page using significant memory"
// reload after a handful of model views.
// ============================================================================

function disposeMaterial(material: THREE.Material) {
  // Textures hang off material properties (map, normalMap, …). Dispose any we
  // find before the material itself.
  for (const value of Object.values(
    material as unknown as Record<string, unknown>,
  )) {
    if (value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const m of material) disposeMaterial(m);
    } else if (material) {
      disposeMaterial(material as THREE.Material);
    }
  });
}

// ============================================================================
// GLTF Model Component
// ============================================================================

function GltfModel() {
  const {
    modelUrl,
    onPartsDiscovered,
    onGroupsDiscovered,
    onPartScreenPositions,
    onPartClick,
    onPartHover,
    hoveredPartName,
    visibilityMap,
    partColors,
    hullGradient,
    colorScale,
    partEmissive,
    partScales,
    partSpins,
    fixedParts,
    bodyPosition,
    modelRotationOffset,
    cadStyle,
    wireframe,
  } = useModelViewerData();

  const [scene, setScene] = useState<THREE.Group | null>(null);
  const movableNodesRef = useRef<THREE.Object3D[]>([]);
  const movableOriginsRef = useRef<Map<THREE.Object3D, THREE.Vector3>>(
    new Map(),
  );
  const spinNodesRef = useRef<
    { node: THREE.Object3D; axis: "x" | "y" | "z"; speed: number }[]
  >([]);

  // Load GLTF/GLB
  useEffect(() => {
    if (!modelUrl) return;
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
    );
    loader.setDRACOLoader(dracoLoader);
    let cancelled = false;
    let loaded: THREE.Group | null = null;
    loader.load(
      modelUrl,
      (gltf) => {
        // URL changed / panel unmounted mid-load: free what we just parsed
        // (it will never be shown) instead of leaking it.
        if (cancelled) {
          disposeObject3D(gltf.scene);
          return;
        }
        // Apply base rotation offset BEFORE scaling/centering
        if (modelRotationOffset) {
          gltf.scene.rotation.set(...modelRotationOffset);
        }

        // Apply per-part scale overrides (e.g. shrink oversized rotors)
        if (partScales) {
          gltf.scene.traverse((child) => {
            const s = partScales[child.name];
            if (s !== undefined) child.scale.multiplyScalar(s);
          });
        }

        gltf.scene.updateMatrixWorld(true);

        // Scale whole model to fit in a 2-unit box
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          const s = 2 / maxDim;
          gltf.scene.scale.multiplyScalar(s);
        }

        // Recompute bounds after scaling, then center
        gltf.scene.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(gltf.scene);
        const center = new THREE.Vector3();
        scaledBox.getCenter(center);
        gltf.scene.position.sub(center);

        // Discover named meshes; track movable + spinning nodes
        const parts: string[] = [];
        const groups: string[] = [];
        const fixedSet = new Set(fixedParts ?? []);
        const movable: THREE.Object3D[] = [];
        const origins = new Map<THREE.Object3D, THREE.Vector3>();
        const spins: {
          node: THREE.Object3D;
          axis: "x" | "y" | "z";
          speed: number;
        }[] = [];

        gltf.scene.traverse((child) => {
          const isMesh = (child as THREE.Mesh).isMesh;
          if (isMesh && child.name) {
            parts.push(child.name);
          }
          // A "group" for layer purposes = a named Object3D that contains at
          // least one mesh descendant. Top-level scene children only — deeper
          // levels create UI clutter.
          if (
            !isMesh &&
            child.name &&
            child.parent === gltf.scene &&
            child !== gltf.scene
          ) {
            let containsMesh = false;
            child.traverse((d) => {
              if ((d as THREE.Mesh).isMesh) containsMesh = true;
            });
            if (containsMesh) groups.push(child.name);
          }
          if (child.name && !fixedSet.has(child.name) && child !== gltf.scene) {
            // Only track direct children of the scene root as movable units
            if (child.parent === gltf.scene) {
              movable.push(child);
              origins.set(child, child.position.clone());
            }
          }
          const spin = partSpins?.[child.name];
          if (spin) spins.push({ node: child, ...spin });
        });
        movableNodesRef.current = movable;
        movableOriginsRef.current = origins;
        spinNodesRef.current = spins;

        onPartsDiscovered?.(parts);
        onGroupsDiscovered?.(groups);
        loaded = gltf.scene;
        setScene(gltf.scene);
      },
      undefined,
      (err) => {
        console.error("GLTF load error:", err);
      },
    );
    return () => {
      cancelled = true;
      // Drop the previous model from the scene graph so the render loop never
      // references a model we're about to dispose; the next load sets it again.
      setScene(null);
      if (loaded) disposeObject3D(loaded);
      dracoLoader.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  const renderedBodyRef = useRef(new THREE.Vector3());
  const lastPositionEmitRef = useRef(0);
  useFrame((state, delta) => {
    const [bx, by, bz] = bodyPosition ?? [0, 0, 0];
    const target = renderedBodyRef.current;
    const targetNext = new THREE.Vector3(bx, by, bz);
    // Exponential smoothing: position += (target - position) * (1 - exp(-k*dt))
    // k=2 → ~350ms to cover half the remaining distance each step
    const k = 2.0;
    const alpha = 1 - Math.exp(-k * Math.max(0, Math.min(0.1, delta)));
    target.lerp(targetNext, alpha);
    for (const node of movableNodesRef.current) {
      const origin = movableOriginsRef.current.get(node);
      if (!origin) continue;
      node.position.set(
        origin.x + target.x,
        origin.y + target.y,
        origin.z + target.z,
      );
    }
    for (const { node, axis, speed } of spinNodesRef.current) {
      const rot = node.rotation;
      rot.set(
        rot.x + (axis === "x" ? speed * delta : 0),
        rot.y + (axis === "y" ? speed * delta : 0),
        rot.z + (axis === "z" ? speed * delta : 0),
      );
    }

    // Emit screen-space positions for named meshes — used by callers that
    // draw leader lines / floating labels anchored to specific parts.
    // Throttled to ~30 Hz so chips track the camera smoothly without
    // re-rendering React on every Three.js frame.
    if (onPartScreenPositions && scene) {
      const now = performance.now();
      if (now - lastPositionEmitRef.current >= 33) {
        lastPositionEmitRef.current = now;
        const camera = state.camera;
        const sizeObj = state.size;
        const out: Record<string, { x: number; y: number; depth: number }> = {};
        const tmpBox = new THREE.Box3();
        const tmpCenter = new THREE.Vector3();
        scene.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || !child.name) return;
          // World-space bounding box center — works for models where the
          // mesh's transform is identity and the geometry lives in vertex
          // coordinates (very common in DCC tool exports). Using the object
          // transform alone collapses every mesh to the scene origin.
          tmpBox.setFromObject(mesh);
          if (tmpBox.isEmpty()) return;
          tmpBox.getCenter(tmpCenter);
          if (!Number.isFinite(tmpCenter.x)) return;
          const projected = tmpCenter.clone().project(camera);
          // Skip parts behind the camera or way off-screen.
          if (projected.z < -1 || projected.z > 1) return;
          out[child.name] = {
            x: (projected.x * 0.5 + 0.5) * sizeObj.width,
            y: (1 - (projected.y * 0.5 + 0.5)) * sizeObj.height,
            depth: projected.z,
          };
        });
        onPartScreenPositions(out);
      }
    }
  });

  // Apply data coloring — tints the base color + adds emissive for visibility
  useEffect(() => {
    if (!scene) return;
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.name) return;

      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat?.color) return;

      // Clone material once; stash originals for blending / restore
      if (!mesh.userData._cloned) {
        mesh.userData._originalColor = mat.color.clone();
        mesh.userData._originalOpacity = mat.opacity;
        mesh.userData._originalTransparent = mat.transparent;
        mesh.material = mat.clone();
        mesh.userData._cloned = true;

        if (cadStyle) {
          const m = mesh.material as THREE.MeshStandardMaterial;
          m.metalness = 0.35;
          m.roughness = 0.55;
          m.flatShading = false;

          // Crisp edge overlay (the single biggest "CAD look" upgrade)
          if (mesh.geometry && !mesh.userData._edges) {
            const edges = new THREE.EdgesGeometry(mesh.geometry, 20);
            const line = new THREE.LineSegments(
              edges,
              new THREE.LineBasicMaterial({
                color: 0x1a1a1a,
                transparent: true,
                opacity: 0.55,
              }),
            );
            line.renderOrder = 1;
            mesh.add(line);
            mesh.userData._edges = line;
          }
        }
      }
      // Hover outline — boost emissive on the hovered mesh (or any
      // ancestor with that name) over the threshold/data tint below.
      let isHovered = false;
      if (hoveredPartName) {
        let cursor: THREE.Object3D | null = mesh;
        while (cursor) {
          if (cursor.name === hoveredPartName) {
            isHovered = true;
            break;
          }
          cursor = cursor.parent;
        }
      }
      // Layer visibility — applies to any named ancestor.
      if (visibilityMap) {
        let cursor: THREE.Object3D | null = mesh;
        let hidden = false;
        while (cursor && !hidden) {
          if (cursor.name && visibilityMap[cursor.name] === false)
            hidden = true;
          cursor = cursor.parent;
        }
        mesh.visible = !hidden;
      } else {
        mesh.visible = true;
      }
      const cloned = mesh.material as THREE.MeshStandardMaterial;
      const original = mesh.userData._originalColor as THREE.Color;
      cloned.wireframe = wireframe;

      const dataColor = partColors?.[mesh.name];
      const threshold = partEmissive?.[mesh.name];

      // Wireframe mode: lines colored by the same heatmap data the
      // solid path uses. Threshold > data > white. Keeps the engineered
      // see-inside look while still showing telemetry through color.
      // Force full opacity — hologram-style GLBs (e.g. the exported pod)
      // use near-transparent shells whose wireframe would otherwise be
      // invisible, making the toggle look broken.
      if (wireframe) {
        cloned.opacity = 1;
        cloned.transparent = false;
        if (threshold) {
          cloned.color.set(threshold.color);
          cloned.emissive.set(threshold.color);
          cloned.emissiveIntensity = Math.min(threshold.intensity, 0.6);
        } else if (dataColor) {
          cloned.color.set(dataColor);
          cloned.emissive.set(dataColor);
          cloned.emissiveIntensity = 0.15;
        } else {
          cloned.color.set(0xffffff);
          cloned.emissive.set(0x000000);
          cloned.emissiveIntensity = 0;
        }
        const edgeLine = mesh.userData._edges as THREE.LineSegments | undefined;
        if (edgeLine) edgeLine.visible = false;
        if (isHovered) {
          cloned.emissive.set("#ffffff");
          cloned.emissiveIntensity = Math.max(cloned.emissiveIntensity, 0.5);
        }
        return;
      } else {
        const edgeLine = mesh.userData._edges as THREE.LineSegments | undefined;
        if (edgeLine) edgeLine.visible = true;
        cloned.opacity = mesh.userData._originalOpacity as number;
        cloned.transparent = mesh.userData._originalTransparent as boolean;
      }

      if (threshold) {
        // Threshold: strong tint + bright emissive pulse
        const tint = new THREE.Color(threshold.color);
        cloned.color.copy(original).lerp(tint, 0.6);
        cloned.emissive.set(threshold.color);
        cloned.emissiveIntensity = threshold.intensity;
      } else if (dataColor) {
        // Data-driven: subtle tint so base color (matte black on the real
        // Grain Weevil) reads through; critical thresholds use the louder
        // path above for attention.
        const tint = new THREE.Color(dataColor);
        cloned.color.copy(original).lerp(tint, 0.22);
        cloned.emissive.set(dataColor);
        cloned.emissiveIntensity = 0.25;
      } else {
        // No data: restore original
        cloned.color.copy(original);
        cloned.emissive.set("#000000");
        cloned.emissiveIntensity = 0;
      }

      if (isHovered) {
        // Subtle white emissive ring — keeps the data coloring intact
        // but adds a clear "this is hovered" affordance.
        cloned.emissive.set("#ffffff");
        cloned.emissiveIntensity = Math.max(cloned.emissiveIntensity, 0.35);
      }
    });
  }, [
    scene,
    partColors,
    partEmissive,
    wireframe,
    cadStyle,
    visibilityMap,
    hoveredPartName,
  ]);

  // Attitude gradient — paint every mesh with the color scale as a linear
  // gradient along the model's SHORTEST axis (world space at load pose).
  // Shortest, not longest: elongated vehicles are near-symmetric about
  // their long axis, so a lengthwise gradient never moves under roll —
  // the cross-axis bands sweep visibly instead, exactly like the built-in
  // pod's vertical hull gradient. Vertex colors multiply the base
  // material, so textures still read through. Toggling off restores the
  // original material.
  useEffect(() => {
    if (!scene) return;
    scene.updateMatrixWorld(true);
    if (!hullGradient) {
      // Undo ONLY what we painted — models like the exported pod ship
      // their own baked vertex colors, which must survive gradient-off.
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.userData._agOrig) return;
        const orig = mesh.userData._agOrig as {
          attr: THREE.BufferAttribute | null;
          vertexColors: boolean;
        };
        if (orig.attr) mesh.geometry.setAttribute("color", orig.attr);
        else mesh.geometry.deleteAttribute("color");
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (m) {
          m.vertexColors = orig.vertexColors;
          m.needsUpdate = true;
        }
        delete mesh.userData._agOrig;
      });
      return;
    }
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const axis: "x" | "y" | "z" =
      size.x <= size.y && size.x <= size.z
        ? "x"
        : size.y <= size.z
          ? "y"
          : "z";
    const min = box.min[axis];
    const span = Math.max(size[axis], 1e-6);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const pos = mesh.geometry.attributes.position;
      if (!pos) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (!mesh.userData._agOrig) {
        mesh.userData._agOrig = {
          attr: mesh.geometry.getAttribute("color") ?? null,
          vertexColors: m?.vertexColors ?? false,
        };
      }
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(
          mesh.matrixWorld,
        );
        c.set(colorScale((v[axis] - min) / span));
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      mesh.geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colors, 3),
      );
      if (m) {
        m.vertexColors = true;
        m.needsUpdate = true;
      }
    });
  }, [scene, hullGradient, colorScale]);

  if (!scene) return null;
  return (
    <primitive
      object={scene}
      onClick={
        onPartClick
          ? (e: {
              stopPropagation: () => void;
              object?: { name?: string };
              nativeEvent?: { clientX: number; clientY: number };
            }) => {
              e.stopPropagation();
              const name = e.object?.name;
              if (!name || !e.nativeEvent) return;
              onPartClick(name, {
                x: e.nativeEvent.clientX,
                y: e.nativeEvent.clientY,
              });
            }
          : undefined
      }
      onPointerOver={
        onPartHover
          ? (e: {
              stopPropagation: () => void;
              object?: { name?: string };
            }) => {
              e.stopPropagation();
              if (e.object?.name) onPartHover(e.object.name);
            }
          : undefined
      }
      onPointerOut={
        onPartHover
          ? (e: { stopPropagation: () => void }) => {
              e.stopPropagation();
              onPartHover(null);
            }
          : undefined
      }
    />
  );
}

// ============================================================================
// STL/OBJ Model Component (original)
// ============================================================================

function StlObjModel() {
  const {
    modelUrl,
    modelType,
    modelData,
    vertexColors,
    colorScale,
    minValue,
    maxValue,
    wireframe,
    metalness,
    roughness,
  } = useModelViewerData();

  const meshRef = useRef<THREE.Mesh>(null);

  // Inline model data parses synchronously — derive it during render so we
  // don't setState in an effect.
  const dataGeometry = useMemo<THREE.BufferGeometry | null>(() => {
    if (!modelData) return null;
    if (modelType === "stl") {
      return new STLLoader().parse(modelData as ArrayBuffer);
    }
    if (modelType === "obj") {
      const object = new OBJLoader().parse(
        new TextDecoder().decode(modelData as ArrayBuffer),
      );
      const firstMesh = object.children.find(
        (child) => child instanceof THREE.Mesh,
      ) as THREE.Mesh | undefined;
      return firstMesh?.geometry ?? null;
    }
    return null;
  }, [modelData, modelType]);

  // URL models load asynchronously — keep those in state.
  const [urlGeometry, setUrlGeometry] = useState<THREE.BufferGeometry | null>(
    null,
  );
  useEffect(() => {
    if (modelData || !modelUrl) return;
    let cancelled = false;
    if (modelType === "stl") {
      const loader = new STLLoader();
      loader.load(modelUrl, (geo) => {
        if (!cancelled) setUrlGeometry(geo);
      });
    } else if (modelType === "obj") {
      const loader = new OBJLoader();
      loader.load(modelUrl, (object) => {
        const firstMesh = object.children.find(
          (child) => child instanceof THREE.Mesh,
        ) as THREE.Mesh | undefined;
        if (firstMesh && !cancelled) setUrlGeometry(firstMesh.geometry);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [modelUrl, modelType, modelData]);

  const geometry = modelData ? dataGeometry : urlGeometry;

  // Apply vertex colors if provided
  useEffect(() => {
    if (!geometry || !vertexColors) return;

    const positions = geometry.attributes.position;
    const vertexCount = positions.count;
    const colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
      const value = vertexColors[i] || 0;
      const normalized = (value - minValue) / (maxValue - minValue);
      const colorHex = colorScale(normalized);
      const color = new THREE.Color(colorHex);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    colorAttribute.needsUpdate = true;
    geometry.setAttribute("color", colorAttribute);
  }, [geometry, vertexColors, colorScale, minValue, maxValue]);

  // Center and scale the model
  useEffect(() => {
    if (!geometry) return;
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();

    const boundingBox = geometry.boundingBox;
    if (boundingBox) {
      const center = new THREE.Vector3();
      boundingBox.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);

      const size = new THREE.Vector3();
      boundingBox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2 / maxDim;
      geometry.scale(scale, scale, scale);
    }
  }, [geometry]);

  // Free the geometry's GPU buffers when it's replaced or the panel unmounts.
  // The material is declarative so R3F disposes it; the geometry is created
  // imperatively above, so we own its disposal.
  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  if (!geometry) {
    return null;
  }

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        vertexColors={!!vertexColors}
        wireframe={wireframe}
        metalness={metalness}
        roughness={roughness}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ============================================================================
// Primitive Model Component
//
// Built-in bodies (cylinder / box / cone / capsule) so an orientation panel
// needs zero CAD files. Cylinder/box/cone carry a nose cap (up) and a heading
// fin (forward) so orientation reads on symmetric bodies. Capsule is the
// "pod" body: a horizontal hologram-wireframe hull with four internal rack
// discs and a small tail fin — the anatomy submersible/enclosure pods tend
// to have — and every named part accepts callout bindings.
//
// Named meshes announce themselves (onPartsDiscovered), emit throttled
// screen positions (for callout leader lines), and forward hover/click —
// the same contract GltfModel provides for loaded models.
// ============================================================================

const PRIMITIVE_DIMS = {
  cylinder: { noseY: 1.06, finY: -0.5, finZ: 0.72 },
  box: { noseY: 0.92, finY: -0.55, finZ: 0.66 },
  cone: { noseY: 1.04, finY: -0.7, finZ: 0.42 },
} as const;

const HOLO_WIRE = "#22c55e"; // hologram wireframe green
const CAPSULE_RACK_XS = [-0.49, -0.16, 0.16, 0.49] as const;
const CAPSULE_RACK_NAMES = ["rack_a", "rack_b", "rack_c", "rack_d"] as const;

const PRIMITIVE_PART_NAMES: Record<string, string[]> = {
  cylinder: ["body", "nose", "fin"],
  box: ["body", "nose", "fin"],
  cone: ["body", "nose", "fin"],
  capsule: ["hull", "fin", ...CAPSULE_RACK_NAMES],
};

function PrimitiveModel() {
  const {
    shape,
    wireframe,
    metalness,
    roughness,
    modelRotationOffset,
    partColors,
    modelColor,
    hullGradient,
    colorScale,
    onPartsDiscovered,
    onPartScreenPositions,
    onPartClick,
    onPartHover,
  } = useModelViewerData();
  const kind = shape ?? "cylinder";
  const groupRef = useRef<THREE.Group>(null);

  // Capsule hull geometry, optionally vertex-colored with the color scale
  // as a vertical (dorsal→ventral) gradient. Deliberately ACROSS the hull,
  // not along it: roll is rotation about the long axis, so a fore→aft
  // gradient never moves under roll — the vertical bands sweep around the
  // hull instead, which is what makes roll legible. In the capsule's local
  // frame (before the lie-on-side Z rotation) world-up is local X.
  const hullGeometry = useMemo(() => {
    const geo = new THREE.CapsuleGeometry(0.45, 1.3, 8, 24);
    if (!hullGradient || kind !== "capsule") return geo;
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const radius = 0.45;
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(
        (pos.getX(i) / radius + 1) / 2,
        0,
        1,
      );
      c.set(colorScale(t));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [hullGradient, kind, colorScale]);
  useEffect(() => () => hullGeometry.dispose(), [hullGeometry]);

  // Small swept-back dorsal tail fin at the aft (-X) end — the one asymmetry
  // on an otherwise symmetric hull, so yaw/heading reads at a glance. A thin
  // triangular prism: vertical trailing edge aft, leading edge sloping down
  // to the hull.
  const finGeometry = useMemo(() => {
    const outline = new THREE.Shape();
    outline.moveTo(0, 0);
    outline.lineTo(-0.34, 0);
    outline.lineTo(-0.34, 0.24);
    outline.closePath();
    const geo = new THREE.ExtrudeGeometry(outline, {
      depth: 0.03,
      bevelEnabled: false,
    });
    geo.translate(0, 0, -0.015);
    return geo;
  }, []);
  useEffect(() => () => finGeometry.dispose(), [finGeometry]);

  // Announce named parts so config UIs and drop-to-bind callouts see them.
  useEffect(() => {
    onPartsDiscovered?.(PRIMITIVE_PART_NAMES[kind] ?? []);
  }, [kind, onPartsDiscovered]);

  // Screen positions for callout anchors — same projection + ~30 Hz
  // throttle as GltfModel's emitter.
  const lastEmitRef = useRef(0);
  useFrame((state) => {
    const root = groupRef.current;
    if (!onPartScreenPositions || !root) return;
    const now = performance.now();
    if (now - lastEmitRef.current < 33) return;
    lastEmitRef.current = now;
    const out: Record<string, { x: number; y: number; depth: number }> = {};
    const tmpBox = new THREE.Box3();
    const tmpCenter = new THREE.Vector3();
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !child.name) return;
      tmpBox.setFromObject(mesh);
      if (tmpBox.isEmpty()) return;
      tmpBox.getCenter(tmpCenter);
      if (!Number.isFinite(tmpCenter.x)) return;
      const projected = tmpCenter.clone().project(state.camera);
      if (projected.z < -1 || projected.z > 1) return;
      out[child.name] = {
        x: (projected.x * 0.5 + 0.5) * state.size.width,
        y: (1 - (projected.y * 0.5 + 0.5)) * state.size.height,
        depth: projected.z,
      };
    });
    onPartScreenPositions(out);
  });

  // Hover/click forwarding for a named mesh — the same contract the panel
  // relies on for GLTF parts (click-to-bind, hover chip).
  const partEvents = (name: string) => ({
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onPartHover?.(name);
    },
    onPointerOut: () => onPartHover?.(null),
    onClick: (e: {
      stopPropagation: () => void;
      nativeEvent: MouseEvent;
    }) => {
      e.stopPropagation();
      onPartClick?.(name, {
        x: e.nativeEvent.clientX,
        y: e.nativeEvent.clientY,
      });
    },
  });

  if (kind === "capsule") {
    // Lying along X. Hull rendered twice: translucent shell + dense
    // wireframe overlay (the hologram look), racks visible through it.
    // Part-binding state colors override the base tint per part; the
    // vertical hull gradient (see hullGeometry) is what makes roll read.
    const lieOnSide: [number, number, number] = [0, 0, Math.PI / 2];
    const wire = modelColor ?? HOLO_WIRE;
    const hullTint = partColors?.hull;
    const finTint = partColors?.fin;
    const gradient = hullGradient && !hullTint;
    return (
      <group ref={groupRef} rotation={modelRotationOffset ?? [0, 0, 0]}>
        <mesh
          name="hull"
          rotation={lieOnSide}
          geometry={hullGeometry}
          {...partEvents("hull")}
        >
          <meshStandardMaterial
            key={gradient ? "hull-grad" : "hull-solid"}
            color={gradient ? "#ffffff" : (hullTint ?? "#0c1210")}
            vertexColors={gradient}
            transparent
            opacity={wireframe ? 0 : gradient ? 0.22 : 0.32}
            depthWrite={false}
            roughness={roughness}
            metalness={metalness}
          />
        </mesh>
        <mesh rotation={lieOnSide} geometry={hullGeometry}>
          <meshBasicMaterial
            key={gradient ? "wire-grad" : "wire-solid"}
            color={gradient ? "#ffffff" : (hullTint ?? wire)}
            vertexColors={gradient}
            wireframe
            transparent
            opacity={wireframe ? 0.9 : gradient ? 0.55 : 0.28}
          />
        </mesh>
        {/* Tail fin — same hologram shell + wire pairing as the racks, so
            the wireframe toggle treats it like the rest of the pod. */}
        <group position={[-0.55, 0.38, 0]}>
          <mesh name="fin" geometry={finGeometry} {...partEvents("fin")}>
            <meshStandardMaterial
              color={finTint ?? "#102415"}
              transparent
              opacity={wireframe ? 0 : 0.55}
            />
          </mesh>
          <mesh geometry={finGeometry}>
            <meshBasicMaterial
              color={finTint ?? wire}
              wireframe
              transparent
              opacity={wireframe ? 0.9 : 0.5}
            />
          </mesh>
        </group>
        {CAPSULE_RACK_XS.map((x, i) => {
          const rackTint = partColors?.[CAPSULE_RACK_NAMES[i]];
          return (
            <group key={CAPSULE_RACK_NAMES[i]} position={[x, 0, 0]}>
              <mesh
                name={CAPSULE_RACK_NAMES[i]}
                rotation={lieOnSide}
                {...partEvents(CAPSULE_RACK_NAMES[i])}
              >
                <cylinderGeometry args={[0.36, 0.36, 0.08, 24]} />
                <meshStandardMaterial
                  color={rackTint ?? "#102415"}
                  transparent
                  opacity={wireframe ? 0 : 0.55}
                />
              </mesh>
              <mesh rotation={lieOnSide}>
                <cylinderGeometry args={[0.36, 0.36, 0.08, 24]} />
                <meshBasicMaterial
                  color={rackTint ?? wire}
                  wireframe
                  transparent
                  opacity={wireframe ? 0.9 : 0.5}
                />
              </mesh>
            </group>
          );
        })}
      </group>
    );
  }

  const dims = PRIMITIVE_DIMS[kind as keyof typeof PRIMITIVE_DIMS];
  return (
    <group ref={groupRef} rotation={modelRotationOffset ?? [0, 0, 0]}>
      {/* Named meshes so callout bindings and click-to-bind work on
          primitives exactly like on named GLTF parts. */}
      <mesh name="body" {...partEvents("body")}>
        {kind === "cylinder" ? (
          <cylinderGeometry args={[0.65, 0.65, 2, 48]} />
        ) : kind === "box" ? (
          <boxGeometry args={[1.2, 1.7, 1.2]} />
        ) : (
          <coneGeometry args={[0.75, 2, 48]} />
        )}
        <meshStandardMaterial
          color={partColors?.body ?? modelColor ?? "#94a3b8"}
          wireframe={wireframe}
          metalness={metalness}
          roughness={roughness}
        />
      </mesh>
      {/* Nose cap — makes pitch/roll legible */}
      <mesh name="nose" position={[0, dims.noseY, 0]} {...partEvents("nose")}>
        <sphereGeometry args={[0.16, 24, 16]} />
        <meshStandardMaterial
          color={partColors?.nose ?? "#f59e0b"}
          roughness={0.4}
        />
      </mesh>
      {/* Heading fin — makes yaw legible on a symmetric body */}
      <mesh
        name="fin"
        position={[0, dims.finY, dims.finZ]}
        {...partEvents("fin")}
      >
        <boxGeometry args={[0.05, 0.65, 0.3]} />
        <meshStandardMaterial
          color={partColors?.fin ?? "#f59e0b"}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}

// ============================================================================
// Scene Component
// ============================================================================

// ── Earth backdrop using the same shader the earth-panel renders ─────────
//
// Day/night/clouds/bump-mapped Earth with astronomical sun direction.
// No atmospheric rim (intentional — cleaner silhouette against stars).
// Rotation rate close to realistic: ~3.7e-3 rad/s at 60fps (a bit faster
// than Earth's true 7.27e-5 rad/s sidereal so the rotation is visible
// within a 30-second viewing — but not whiplashed). Stars live in the
// inertial frame and stay fixed relative to the scene root.

const TexturedEarth = forwardRef<
  THREE.Group,
  {
    position: [number, number, number];
    radius: number;
  }
>(function TexturedEarth({ position, radius }, ref) {
  return (
    <group ref={ref} position={position}>
      <RealisticEarthGlobe
        dayMapUrl="/day.webp"
        nightMapUrl="/night.webp"
        cloudsMapUrl="/clouds.webp"
        bumpMapUrl="/bump.webp"
        radius={radius}
        rotationSpeed={0.00006}
        cloudOpacity={0.45}
      />
    </group>
  );
});
TexturedEarth.displayName = "TexturedEarth";

function Scene() {
  const {
    showGrid,
    showAxes,
    autoRotate,
    modelType,
    shape,
    orientationDeg,
    orientationQuat,
    cadStyle,
    spaceScene,
    earthBackdropPosition,
    earthBackdropRadius,
  } = useModelViewerData();
  const meshRef = useRef<THREE.Group>(null);

  // Latest telemetry attitude as a quaternion target. A quaternion binding
  // is used directly (normalized defensively); euler input is "YXZ" = yaw
  // about the vertical axis first, then pitch (fore/aft), then roll (side
  // to side) — heading-pitch-roll. Either way the target is a quaternion so
  // yaw wrapping 359°→0° slerps the short way instead of spinning backwards.
  const targetQuat = useMemo(() => {
    if (orientationQuat) {
      const [x, y, z, w] = orientationQuat;
      return new THREE.Quaternion(x, y, z, w).normalize();
    }
    if (!orientationDeg) return null;
    const d = Math.PI / 180;
    const euler = new THREE.Euler(
      orientationDeg.pitch * d,
      orientationDeg.yaw * d,
      orientationDeg.roll * d,
      "YXZ",
    );
    return new THREE.Quaternion().setFromEuler(euler);
  }, [orientationDeg, orientationQuat]);

  useFrame((_, delta) => {
    const group = meshRef.current;
    if (!group) return;
    if (targetQuat) {
      // Frame-rate-independent easing toward the latest sample, so motion
      // stays smooth between telemetry updates.
      group.quaternion.slerp(targetQuat, 1 - Math.exp(-delta * 8));
    } else if (autoRotate) {
      group.rotation.y += 0.005;
    }
    // Earth rotation is driven by RealisticEarthGlobe itself (astronomical
    // sun direction + internal rotationSpeed). No need to rotate here.
  });

  const isGltf = modelType === "gltf" || modelType === "glb";
  const earthPos = earthBackdropPosition ?? [0, -140, -120];
  const earthR = earthBackdropRadius ?? 120;

  return (
    <>
      {spaceScene ? (
        <>
          {/* Force pure-black scene background (Canvas default can tint) */}
          <color attach="background" args={[0, 0, 0]} />
          {/* Stark orbital sunlight — one directional sun, near-zero ambient */}
          <ambientLight intensity={0.08} color="#ffffff" />
          <directionalLight
            position={[30, 18, 10]}
            intensity={3.2}
            color="#fff6e6"
            castShadow
          />
          <Stars
            radius={300}
            depth={80}
            count={6000}
            factor={4}
            saturation={0}
            fade
            speed={0.6}
          />
          {/* Earth backdrop — same shader the earth-panel uses */}
          <Suspense fallback={null}>
            <TexturedEarth position={earthPos} radius={earthR} />
          </Suspense>
        </>
      ) : cadStyle ? (
        <>
          {/* 3-point CAD lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight
            position={[8, 12, 6]}
            intensity={1.0}
            color="#ffffff"
          />
          <directionalLight
            position={[-10, 4, -6]}
            intensity={0.45}
            color="#cfd8e3"
          />
          <directionalLight
            position={[0, -6, 8]}
            intensity={0.25}
            color="#ffffff"
          />
          <Environment preset="studio" background={false} />
        </>
      ) : (
        <>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <directionalLight position={[-10, -10, -5]} intensity={0.3} />
        </>
      )}
      <group ref={meshRef}>
        {shape ? <PrimitiveModel /> : isGltf ? <GltfModel /> : <StlObjModel />}
      </group>
      {showGrid && !spaceScene && (
        <Grid args={[10, 10]} cellColor="#6B7280" sectionColor="#374151" />
      )}
      {showAxes && <axesHelper args={[3]} />}
    </>
  );
}

// ============================================================================
// Canvas Container Component
// ============================================================================

function ModelCanvas() {
  const { cameraPosition, backgroundColor } = useModelViewerData();

  return (
    <div style={{ width: "100%", height: "100%", backgroundColor }}>
      <Canvas
        camera={{ position: cameraPosition, fov: 50 }}
        style={{ width: "100%", height: "100%" }}
        gl={{
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
      >
        <Suspense fallback={null}>
          <Scene />
          <OrbitControls enableDamping dampingFactor={0.05} />
        </Suspense>
      </Canvas>
    </div>
  );
}

// ============================================================================
// Root Component
// ============================================================================

function Root({
  children,
  modelUrl,
  modelType = "stl",
  shape,
  orientationDeg,
  orientationQuat,
  modelData,
  vertexColors,
  colorScale = viridis,
  minValue = 0,
  maxValue = 100,
  showGrid = true,
  showAxes = false,
  cameraPosition = [3, 3, 3],
  backgroundColor = "#111111",
  autoRotate = false,
  wireframe = false,
  metalness = 0.5,
  roughness = 0.5,
  width = 800,
  height = 600,
  className = "",
  onPartsDiscovered,
  onGroupsDiscovered,
  onPartScreenPositions,
  onPartClick,
  onPartHover,
  hoveredPartName,
  visibilityMap,
  partColors,
  modelColor,
  hullGradient = false,
  partEmissive,
  partScales,
  partSpins,
  fixedParts,
  bodyPosition,
  modelRotationOffset,
  cadStyle = false,
  spaceScene = false,
  earthBackdropPosition,
  earthBackdropRadius,
}: ModelViewerProps & { children?: ReactNode }) {
  // In space-scene mode, force the canvas background to deep space black
  // so stars + Earth read correctly.
  const effectiveBg = spaceScene ? "#020612" : backgroundColor;
  const contextValue: ModelViewerContextType = {
    modelUrl,
    modelType,
    shape,
    orientationDeg,
    orientationQuat,
    modelData,
    vertexColors,
    colorScale,
    minValue,
    maxValue,
    showGrid,
    showAxes,
    cameraPosition,
    backgroundColor: effectiveBg,
    autoRotate,
    wireframe,
    metalness,
    roughness,
    onPartsDiscovered,
    onGroupsDiscovered,
    onPartScreenPositions,
    onPartClick,
    onPartHover,
    hoveredPartName,
    visibilityMap,
    partColors,
    modelColor,
    hullGradient,
    partEmissive,
    partScales,
    partSpins,
    fixedParts,
    bodyPosition,
    modelRotationOffset,
    cadStyle,
    spaceScene,
    earthBackdropPosition,
    earthBackdropRadius,
  };

  return (
    <ModelViewerContext.Provider value={contextValue}>
      <div
        className={className}
        style={{
          width: typeof width === "number" ? `${width}px` : width,
          height: typeof height === "number" ? `${height}px` : height,
        }}
      >
        {children || <ModelCanvas />}
      </div>
    </ModelViewerContext.Provider>
  );
}

// ============================================================================
// Compound Component Export
// ============================================================================

export const ModelViewer = Object.assign(
  function ModelViewer(props: ModelViewerProps) {
    return (
      <Root {...props}>
        <ModelCanvas />
      </Root>
    );
  },
  {
    Root,
    Canvas: ModelCanvas,
    Scene,
  },
);

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a simple cube STL for testing
 */
export function generateCubeSTL(): ArrayBuffer {
  const vertices = [
    // Front face
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, 1, 1,
    // Back face
    -1, -1, -1, -1, 1, -1, 1, 1, -1, -1, -1, -1, 1, 1, -1, 1, -1, -1,
    // Top face
    -1, 1, -1, -1, 1, 1, 1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1, -1,
    // Bottom face
    -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, -1, 1, -1, 1, -1, -1, 1,
    // Right face
    1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, 1,
    // Left face
    -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, -1, -1, -1, 1, 1, -1, 1, -1,
  ];

  const triangleCount = vertices.length / 9;
  const headerSize = 80;
  const triangleDataSize = 50; // 12 floats (normal + 3 vertices) + 2 bytes attribute
  const bufferSize = headerSize + 4 + triangleCount * triangleDataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Write triangle count
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const i0 = i * 9;

    // Calculate normal
    const v1 = [
      vertices[i0 + 3] - vertices[i0],
      vertices[i0 + 4] - vertices[i0 + 1],
      vertices[i0 + 5] - vertices[i0 + 2],
    ];
    const v2 = [
      vertices[i0 + 6] - vertices[i0],
      vertices[i0 + 7] - vertices[i0 + 1],
      vertices[i0 + 8] - vertices[i0 + 2],
    ];

    // Cross product for normal
    const normal = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
    ];
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
    normal[0] /= len;
    normal[1] /= len;
    normal[2] /= len;

    // Write normal
    view.setFloat32(offset, normal[0], true);
    view.setFloat32(offset + 4, normal[1], true);
    view.setFloat32(offset + 8, normal[2], true);
    offset += 12;

    // Write 3 vertices
    for (let j = 0; j < 3; j++) {
      view.setFloat32(offset, vertices[i0 + j * 3], true);
      view.setFloat32(offset + 4, vertices[i0 + j * 3 + 1], true);
      view.setFloat32(offset + 8, vertices[i0 + j * 3 + 2], true);
      offset += 12;
    }

    // Write attribute byte count (unused, typically 0)
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Generate a beam/bracket STL with realistic stress distribution
 */
export function generateBeamSTL(divisions = 20): {
  buffer: ArrayBuffer;
  stressValues: number[];
} {
  const vertices: number[] = [];
  const stressValues: number[] = [];
  const length = 10;
  const width = 2;
  const height = 1;

  // Generate a simple beam mesh (rectangle)
  // We'll create a grid of quads along the length
  for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < divisions; j++) {
      const x1 = (i / divisions) * length - length / 2;
      const x2 = ((i + 1) / divisions) * length - length / 2;
      const y1 = (j / divisions) * width - width / 2;
      const y2 = ((j + 1) / divisions) * width - width / 2;

      // Top face (two triangles per quad)
      // Triangle 1
      vertices.push(x1, y1, height / 2);
      vertices.push(x2, y1, height / 2);
      vertices.push(x2, y2, height / 2);
      // Triangle 2
      vertices.push(x1, y1, height / 2);
      vertices.push(x2, y2, height / 2);
      vertices.push(x1, y2, height / 2);

      // Calculate stress - higher at ends (cantilever beam)
      // For simplicity, stress is proportional to distance from center
      const centerX = (x1 + x2) / 2;
      const distFromCenter = Math.abs(centerX);
      const stress = (distFromCenter / (length / 2)) * 100; // 0-100 MPa

      // Each triangle = 3 vertices, so add stress 6 times (2 triangles)
      for (let k = 0; k < 6; k++) {
        stressValues.push(stress);
      }
    }
  }

  // Convert to STL
  const triangleCount = vertices.length / 9;
  const headerSize = 80;
  const triangleDataSize = 50;
  const bufferSize = headerSize + 4 + triangleCount * triangleDataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Write triangle count
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const i0 = i * 9;

    // Calculate normal (pointing up for all top faces)
    view.setFloat32(offset, 0, true);
    view.setFloat32(offset + 4, 0, true);
    view.setFloat32(offset + 8, 1, true);
    offset += 12;

    // Write 3 vertices
    for (let j = 0; j < 3; j++) {
      view.setFloat32(offset, vertices[i0 + j * 3], true);
      view.setFloat32(offset + 4, vertices[i0 + j * 3 + 1], true);
      view.setFloat32(offset + 8, vertices[i0 + j * 3 + 2], true);
      offset += 12;
    }

    // Write attribute byte count
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return { buffer, stressValues };
}
