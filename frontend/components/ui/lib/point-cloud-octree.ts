/**
 * Point Cloud Octree with LOD (Level of Detail)
 *
 * Hierarchical spatial indexing for efficient rendering of massive point clouds
 * Based on Potree architecture: https://github.com/potree/potree
 *
 * Key concepts:
 * - Octree: Recursive subdivision of 3D space into 8 octants
 * - LOD: Points are organized by resolution levels
 * - Frustum culling: Only render visible octree nodes
 * - Distance-based LOD: Render higher detail for closer nodes
 */

import type { PointCloudData } from "../charts/point-cloud-viewer";
import * as THREE from "three";

// ============================================================================
// Types
// ============================================================================

export interface OctreeNode {
  /**
   * Bounding box of this node
   */
  boundingBox: THREE.Box3;

  /**
   * Center point of this node
   */
  center: THREE.Vector3;

  /**
   * Size (half-width) of this node
   */
  size: number;

  /**
   * Level in the octree (0 = root, higher = more detailed)
   */
  level: number;

  /**
   * Point data in this node
   */
  positions: Float32Array;

  /**
   * Optional color data
   */
  colors?: Uint8Array;

  /**
   * Optional intensity data
   */
  intensities?: Float32Array;

  /**
   * Optional classification data
   */
  classifications?: Uint8Array;

  /**
   * Number of points in this node
   */
  numPoints: number;

  /**
   * Child nodes (8 octants) - null if leaf node
   */
  children: (OctreeNode | null)[];

  /**
   * Is this a leaf node?
   */
  isLeaf: boolean;

  /**
   * Spacing (minimum distance between points) at this level
   */
  spacing: number;
}

export interface OctreeOptions {
  /**
   * Maximum points per node before subdivision
   */
  maxPointsPerNode?: number;

  /**
   * Maximum depth of octree
   */
  maxDepth?: number;

  /**
   * Minimum node size (stop subdivision if node gets too small)
   */
  minNodeSize?: number;

  /**
   * Initial spacing (computed from bounding box if not provided)
   */
  initialSpacing?: number;
}

export interface LODOptions {
  /**
   * Point budget (maximum total points to render)
   */
  pointBudget?: number;

  /**
   * Camera for frustum culling and distance calculations
   */
  camera: THREE.Camera;

  /**
   * LOD multiplier (higher = more aggressive LOD, lower quality)
   */
  lodMultiplier?: number;

  /**
   * Minimum screen space error threshold
   */
  minScreenSpaceError?: number;
}

// ============================================================================
// Octree Construction
// ============================================================================

/**
 * Build octree from point cloud data
 */
export function buildOctree(
  data: PointCloudData,
  options: OctreeOptions = {}
): OctreeNode {
  const {
    maxPointsPerNode = 10000,
    maxDepth = 8,
    minNodeSize = 0.01,
    initialSpacing,
  } = options;

  // Calculate bounding box
  const boundingBox = calculateBoundingBox(data.positions);
  const center = new THREE.Vector3();
  boundingBox.getCenter(center);

  const size = boundingBox.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const halfSize = maxSize / 2;

  // Calculate initial spacing if not provided
  const spacing =
    initialSpacing ||
    Math.sqrt((halfSize * halfSize * 2) / (data.positions.length / 3));

  // Create root node
  const root: OctreeNode = {
    boundingBox,
    center,
    size: halfSize,
    level: 0,
    positions: new Float32Array(0),
    numPoints: 0,
    children: Array(8).fill(null),
    isLeaf: true,
    spacing,
  };

  // Insert all points into octree
  const numPoints = data.positions.length / 3;
  for (let i = 0; i < numPoints; i++) {
    insertPoint(root, i, data, maxPointsPerNode, maxDepth, minNodeSize);
  }

  return root;
}

/**
 * Calculate bounding box from positions
 */
function calculateBoundingBox(positions: Float32Array | number[]): THREE.Box3 {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i]);
    min.y = Math.min(min.y, positions[i + 1]);
    min.z = Math.min(min.z, positions[i + 2]);
    max.x = Math.max(max.x, positions[i]);
    max.y = Math.max(max.y, positions[i + 1]);
    max.z = Math.max(max.z, positions[i + 2]);
  }

  return new THREE.Box3(min, max);
}

/**
 * Get octant index for a point
 */
function getOctantIndex(point: THREE.Vector3, center: THREE.Vector3): number {
  let index = 0;
  if (point.x >= center.x) index |= 1;
  if (point.y >= center.y) index |= 2;
  if (point.z >= center.z) index |= 4;
  return index;
}

/**
 * Calculate octant center
 */
function getOctantCenter(
  parentCenter: THREE.Vector3,
  parentSize: number,
  octantIndex: number
): THREE.Vector3 {
  const offset = parentSize / 2;
  const center = parentCenter.clone();

  center.x += octantIndex & 1 ? offset : -offset;
  center.y += octantIndex & 2 ? offset : -offset;
  center.z += octantIndex & 4 ? offset : -offset;

  return center;
}

/**
 * Insert a point into the octree
 */
function insertPoint(
  node: OctreeNode,
  pointIndex: number,
  data: PointCloudData,
  maxPointsPerNode: number,
  maxDepth: number,
  minNodeSize: number
): void {
  const point = new THREE.Vector3(
    data.positions[pointIndex * 3],
    data.positions[pointIndex * 3 + 1],
    data.positions[pointIndex * 3 + 2]
  );

  // Check if point is within this node's bounds
  if (!node.boundingBox.containsPoint(point)) {
    return;
  }

  // If this is a leaf node and below capacity, add point
  if (node.isLeaf) {
    addPointToNode(node, pointIndex, data);

    // Subdivide if necessary
    if (
      node.numPoints > maxPointsPerNode &&
      node.level < maxDepth &&
      node.size > minNodeSize
    ) {
      subdivideNode(node, data, maxPointsPerNode, maxDepth, minNodeSize);
    }
  } else {
    // Find appropriate child octant
    const octantIndex = getOctantIndex(point, node.center);
    let child = node.children[octantIndex];

    // Create child if it doesn't exist
    if (!child) {
      const childCenter = getOctantCenter(node.center, node.size, octantIndex);
      const childSize = node.size / 2;
      const childSpacing = node.spacing / 2;

      const childMin = new THREE.Vector3(
        childCenter.x - childSize,
        childCenter.y - childSize,
        childCenter.z - childSize
      );
      const childMax = new THREE.Vector3(
        childCenter.x + childSize,
        childCenter.y + childSize,
        childCenter.z + childSize
      );

      child = {
        boundingBox: new THREE.Box3(childMin, childMax),
        center: childCenter,
        size: childSize,
        level: node.level + 1,
        positions: new Float32Array(0),
        numPoints: 0,
        children: Array(8).fill(null),
        isLeaf: true,
        spacing: childSpacing,
      };

      node.children[octantIndex] = child;
    }

    // Recursively insert into child
    insertPoint(
      child,
      pointIndex,
      data,
      maxPointsPerNode,
      maxDepth,
      minNodeSize
    );
  }
}

/**
 * Add point data to node
 */
function addPointToNode(
  node: OctreeNode,
  pointIndex: number,
  data: PointCloudData
): void {
  const oldSize = node.positions.length;
  const newSize = oldSize + 3;

  // Resize positions array
  const newPositions = new Float32Array(newSize);
  newPositions.set(node.positions);
  newPositions[oldSize] = data.positions[pointIndex * 3];
  newPositions[oldSize + 1] = data.positions[pointIndex * 3 + 1];
  newPositions[oldSize + 2] = data.positions[pointIndex * 3 + 2];
  node.positions = newPositions;

  // Copy colors if present
  if (data.colors) {
    const newColors = new Uint8Array(newSize);
    if (node.colors) newColors.set(node.colors);
    newColors[oldSize] = data.colors[pointIndex * 3];
    newColors[oldSize + 1] = data.colors[pointIndex * 3 + 1];
    newColors[oldSize + 2] = data.colors[pointIndex * 3 + 2];
    node.colors = newColors;
  }

  // Copy intensities if present
  if (data.intensities) {
    const newIntensities = new Float32Array(node.numPoints + 1);
    if (node.intensities) newIntensities.set(node.intensities);
    newIntensities[node.numPoints] = data.intensities[pointIndex];
    node.intensities = newIntensities;
  }

  // Copy classifications if present
  if (data.classifications) {
    const newClassifications = new Uint8Array(node.numPoints + 1);
    if (node.classifications) newClassifications.set(node.classifications);
    newClassifications[node.numPoints] = data.classifications[pointIndex];
    node.classifications = newClassifications;
  }

  node.numPoints++;
}

/**
 * Subdivide a leaf node into 8 children
 */
function subdivideNode(
  node: OctreeNode,
  data: PointCloudData,
  maxPointsPerNode: number,
  maxDepth: number,
  minNodeSize: number
): void {
  node.isLeaf = false;

  // Re-insert all points in this node into children
  const numPoints = node.numPoints;
  const tempPositions = node.positions.slice();
  const tempColors = node.colors?.slice();
  const tempIntensities = node.intensities?.slice();
  const tempClassifications = node.classifications?.slice();

  // Clear current node data (points will be in children)
  node.positions = new Float32Array(0);
  node.colors = undefined;
  node.intensities = undefined;
  node.classifications = undefined;
  node.numPoints = 0;

  // Create temporary data object for re-insertion
  const tempData: PointCloudData = {
    positions: tempPositions,
    colors: tempColors,
    intensities: tempIntensities,
    classifications: tempClassifications,
  };

  for (let i = 0; i < numPoints; i++) {
    insertPoint(node, i, tempData, maxPointsPerNode, maxDepth, minNodeSize);
  }
}

// ============================================================================
// LOD Selection
// ============================================================================

/**
 * Select nodes to render based on LOD criteria
 */
export function selectNodesLOD(
  root: OctreeNode,
  options: LODOptions
): OctreeNode[] {
  const {
    pointBudget = 1000000,
    camera,
    lodMultiplier = 1.0,
    minScreenSpaceError = 1.0,
  } = options;

  const frustum = new THREE.Frustum();
  const projectionMatrix = new THREE.Matrix4();

  if (
    camera instanceof THREE.PerspectiveCamera ||
    camera instanceof THREE.OrthographicCamera
  ) {
    projectionMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(projectionMatrix);
  }

  const cameraPosition = new THREE.Vector3();
  camera.getWorldPosition(cameraPosition);

  const selectedNodes: OctreeNode[] = [];
  let totalPoints = 0;

  // Priority queue for traversal (sorted by screen space error)
  const queue: { node: OctreeNode; priority: number }[] = [
    { node: root, priority: Number.MAX_VALUE },
  ];

  while (queue.length > 0 && totalPoints < pointBudget) {
    // Sort by priority (higher = render first)
    queue.sort((a, b) => b.priority - a.priority);
    const { node } = queue.shift()!;

    // Frustum culling
    if (!frustum.intersectsBox(node.boundingBox)) {
      continue;
    }

    // Calculate screen space error (simplified)
    const distance = cameraPosition.distanceTo(node.center);
    const screenSpaceError = (node.spacing / distance) * 1000 * lodMultiplier;

    // If error is below threshold or leaf node, render this node
    if (screenSpaceError < minScreenSpaceError || node.isLeaf) {
      if (node.numPoints > 0) {
        selectedNodes.push(node);
        totalPoints += node.numPoints;
      }
    } else {
      // Otherwise, traverse children
      for (const child of node.children) {
        if (child) {
          const childDistance = cameraPosition.distanceTo(child.center);
          const childPriority = (child.spacing / childDistance) * 1000;
          queue.push({ node: child, priority: childPriority });
        }
      }
    }

    // Stop if we've exceeded point budget
    if (totalPoints >= pointBudget) {
      break;
    }
  }

  return selectedNodes;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all leaf nodes from octree
 */
export function getLeafNodes(node: OctreeNode): OctreeNode[] {
  if (node.isLeaf) {
    return [node];
  }

  const leaves: OctreeNode[] = [];
  for (const child of node.children) {
    if (child) {
      leaves.push(...getLeafNodes(child));
    }
  }
  return leaves;
}

/**
 * Get total point count in octree
 */
export function getTotalPoints(node: OctreeNode): number {
  if (node.isLeaf) {
    return node.numPoints;
  }

  let total = node.numPoints;
  for (const child of node.children) {
    if (child) {
      total += getTotalPoints(child);
    }
  }
  return total;
}

/**
 * Get octree depth
 */
export function getMaxDepth(node: OctreeNode): number {
  if (node.isLeaf) {
    return node.level;
  }

  let maxDepth = node.level;
  for (const child of node.children) {
    if (child) {
      maxDepth = Math.max(maxDepth, getMaxDepth(child));
    }
  }
  return maxDepth;
}

/**
 * Merge point cloud data from selected nodes
 */
export function mergeNodeData(nodes: OctreeNode[]): PointCloudData {
  let totalPoints = 0;
  for (const node of nodes) {
    totalPoints += node.numPoints;
  }

  const positions = new Float32Array(totalPoints * 3);
  let colors: Uint8Array | undefined;
  let intensities: Float32Array | undefined;
  let classifications: Uint8Array | undefined;

  // Check if we have attribute data
  const hasColors = nodes.some((n) => n.colors);
  const hasIntensities = nodes.some((n) => n.intensities);
  const hasClassifications = nodes.some((n) => n.classifications);

  if (hasColors) colors = new Uint8Array(totalPoints * 3);
  if (hasIntensities) intensities = new Float32Array(totalPoints);
  if (hasClassifications) classifications = new Uint8Array(totalPoints);

  let offset = 0;
  for (const node of nodes) {
    positions.set(node.positions, offset * 3);

    if (colors && node.colors) {
      colors.set(node.colors, offset * 3);
    }

    if (intensities && node.intensities) {
      intensities.set(node.intensities, offset);
    }

    if (classifications && node.classifications) {
      classifications.set(node.classifications, offset);
    }

    offset += node.numPoints;
  }

  return {
    positions,
    colors,
    intensities,
    classifications,
  };
}
