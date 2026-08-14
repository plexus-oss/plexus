/**
 * Line geometry — used by line chart and area chart strokes.
 */
import type { Point } from "../base-chart";

// ── Catmull-Rom interpolation for smooth curves ──

function interpolateCatmullRom(
	points: Point[],
	tension = 0.3,
	segments = 12,
): Point[] {
	if (points.length < 3) return points;
	const result: Point[] = [];
	const alpha = tension;

	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[Math.min(points.length - 1, i + 2)];

		if (i === 0) result.push({ x: p1.x, y: p1.y });

		for (let t = 1; t <= segments; t++) {
			const tNorm = t / segments;
			const tSq = tNorm * tNorm;
			const tCube = tSq * tNorm;

			const h1 = -alpha * tCube + 2 * alpha * tSq - alpha * tNorm;
			const h2 = (2 - alpha) * tCube + (alpha - 3) * tSq + 1;
			const h3 = (alpha - 2) * tCube + (3 - 2 * alpha) * tSq + alpha * tNorm;
			const h4 = alpha * tCube - alpha * tSq;

			// Linear X to keep time monotonic, spline Y for smooth curves
			const x = p1.x + (p2.x - p1.x) * tNorm;
			const y = h1 * p0.y + h2 * p1.y + h3 * p2.y + h4 * p3.y;
			result.push({ x, y });
		}
	}
	return result;
}

/**
 * Average horizontal pixel spacing above which Catmull-Rom smoothing turns
 * off. Smoothing exists to round the sub-pixel corners of dense series; once
 * points sit further apart than this (deep zoom framing a handful of
 * samples), the spline's Y overshoot invents curves between samples that the
 * data never contained — honest straight segments win. Value is in canvas
 * device pixels (the renderer's xScale space).
 */
export const MAX_SMOOTH_SPACING_PX = 64;

/**
 * Whether a line with `pointCount` points spanning `pixelSpan` horizontal
 * pixels should be Catmull-Rom smoothed. Pure — exported for unit tests.
 */
export function shouldSmoothLine(
	pixelSpan: number,
	pointCount: number,
): boolean {
	if (pointCount < 3) return false;
	return Math.abs(pixelSpan) / (pointCount - 1) <= MAX_SMOOTH_SPACING_PX;
}

// ── Standard line geometry (position + color + normal + width) ──

export function createLineGeometry(
	points: Point[],
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	color: [number, number, number],
	lineWidth: number,
	smooth = false,
	alpha = 1,
) {
	const positions: number[] = [];
	const colors: number[] = [];
	const normals: number[] = [];
	const widths: number[] = [];

	const pixelSpan =
		points.length > 1
			? xScale(points[points.length - 1].x) - xScale(points[0].x)
			: 0;
	const renderPoints =
		smooth && shouldSmoothLine(pixelSpan, points.length)
			? interpolateCatmullRom(points)
			: points;

	for (let i = 0; i < renderPoints.length - 1; i++) {
		const x1 = xScale(renderPoints[i].x);
		const y1 = yScale(renderPoints[i].y);
		const x2 = xScale(renderPoints[i + 1].x);
		const y2 = yScale(renderPoints[i + 1].y);

		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len === 0) continue;
		const nx = -dy / len;
		const ny = dx / len;

		// First triangle
		positions.push(x1, y1, x2, y2, x1, y1);
		normals.push(-nx, -ny, -nx, -ny, nx, ny);
		widths.push(lineWidth, lineWidth, lineWidth);
		colors.push(...color, alpha, ...color, alpha, ...color, alpha);

		// Second triangle
		positions.push(x2, y2, x1, y1, x2, y2);
		normals.push(-nx, -ny, nx, ny, nx, ny);
		widths.push(lineWidth, lineWidth, lineWidth);
		colors.push(...color, alpha, ...color, alpha, ...color, alpha);
	}

	return { positions, colors, normals, widths };
}

/**
 * Simple line geometry (position + color only) — used by area chart strokes.
 * Bakes normals into positions directly instead of using a separate attribute.
 */
export function createSimpleLineGeometry(
	points: Point[],
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	color: [number, number, number],
	lineWidth: number,
	alpha = 1,
) {
	const positions: number[] = [];
	const colors: number[] = [];

	for (let i = 0; i < points.length - 1; i++) {
		const x1 = xScale(points[i].x);
		const y1 = yScale(points[i].y);
		const x2 = xScale(points[i + 1].x);
		const y2 = yScale(points[i + 1].y);

		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len === 0) continue;
		const nx = -dy / len;
		const ny = dx / len;

		positions.push(x1, y1, x2, y2, x1, y1);
		positions.push(x2, y2, x1, y1, x2, y2);

		const norms = [-nx, -ny, -nx, -ny, nx, ny, -nx, -ny, nx, ny, nx, ny];
		for (let j = 0; j < 6; j++) {
			const idx = j * 2;
			const vx = positions[positions.length - 12 + idx];
			const vy = positions[positions.length - 11 + idx];
			positions[positions.length - 12 + idx] =
				vx + norms[idx] * lineWidth * 0.5;
			positions[positions.length - 11 + idx] =
				vy + norms[idx + 1] * lineWidth * 0.5;
			colors.push(...color, alpha);
		}
	}

	return { positions, colors };
}
