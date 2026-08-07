/**
 * Scatter point geometry.
 */

interface ScatterDataPoint {
	x: number;
	y: number;
	size?: number;
}

/**
 * WebGL point geometry — uses gl.POINTS with per-vertex size.
 */
export function createPointGeometry(
	points: ScatterDataPoint[],
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	color: [number, number, number],
	defaultSize: number,
	opacity: number,
) {
	const positions: number[] = [];
	const colors: number[] = [];
	const sizes: number[] = [];

	for (const point of points) {
		const x = xScale(point.x);
		const y = yScale(point.y);
		const size = (point.size || 1) * defaultSize;

		positions.push(x, y);
		colors.push(...color, opacity);
		sizes.push(size);
	}

	return { positions, colors, sizes };
}

/**
 * WebGPU point geometry — uses quad triangles with pointCoord for SDF circle.
 */
export function createPointGeometryQuads(
	points: ScatterDataPoint[],
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	color: [number, number, number],
	defaultSize: number,
	opacity: number,
) {
	const positions: number[] = [];
	const colors: number[] = [];
	const pointCoords: number[] = [];

	for (const point of points) {
		const x = xScale(point.x);
		const y = yScale(point.y);
		const size = (point.size || 1) * defaultSize;
		const halfSize = size / 2;

		// Triangle 1
		positions.push(x - halfSize, y - halfSize);
		pointCoords.push(0, 0);
		colors.push(...color, opacity);

		positions.push(x + halfSize, y - halfSize);
		pointCoords.push(1, 0);
		colors.push(...color, opacity);

		positions.push(x - halfSize, y + halfSize);
		pointCoords.push(0, 1);
		colors.push(...color, opacity);

		// Triangle 2
		positions.push(x + halfSize, y - halfSize);
		pointCoords.push(1, 0);
		colors.push(...color, opacity);

		positions.push(x + halfSize, y + halfSize);
		pointCoords.push(1, 1);
		colors.push(...color, opacity);

		positions.push(x - halfSize, y + halfSize);
		pointCoords.push(0, 1);
		colors.push(...color, opacity);
	}

	return { positions, colors, pointCoords };
}
