/**
 * Headlessly load a GLTF/GLB and extract its scene-graph metadata.
 *
 * Used by the Model 3D config sidebar so the user doesn't have to type
 * mesh / group names by hand — we load the GLB, walk it, and surface
 * the layer-toggle candidates and mesh-anchor candidates.
 *
 * Lazy-imports three.js loaders so this never lands in the eager
 * config-section bundle.
 */

export interface GltfDiscovery {
  /** Names of meshes — candidates for callout-binding anchors. */
  meshes: string[];
  /** Names of top-level groups containing meshes — candidates for layer toggles. */
  groups: string[];
}

type Mesh = { isMesh?: boolean; name: string };

export async function discoverGltf(url: string): Promise<GltfDiscovery> {
  const { GLTFLoader } = await import(
    "three/examples/jsm/loaders/GLTFLoader.js"
  );
  const { DRACOLoader } = await import(
    "three/examples/jsm/loaders/DRACOLoader.js"
  );

  return await new Promise<GltfDiscovery>((resolve, reject) => {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
    );
    loader.setDRACOLoader(draco);
    loader.load(
      url,
      (gltf) => {
        const meshes: string[] = [];
        const groups: string[] = [];
        gltf.scene.traverse((child) => {
          const isMesh = (child as unknown as Mesh).isMesh === true;
          if (isMesh && child.name) meshes.push(child.name);
          if (
            !isMesh &&
            child.name &&
            child.parent === gltf.scene &&
            child !== gltf.scene
          ) {
            let containsMesh = false;
            child.traverse((d) => {
              if ((d as unknown as Mesh).isMesh === true) containsMesh = true;
            });
            if (containsMesh) groups.push(child.name);
          }
        });
        resolve({ meshes, groups });
      },
      undefined,
      (err) => reject(err),
    );
  });
}
