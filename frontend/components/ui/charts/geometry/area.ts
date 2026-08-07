/**
 * Area fill geometry — triangulated fill between data and baseline.
 */
import type { Point } from "../base-chart";

export function createAreaGeometry(
	points: Point[],
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	color: [number, number, number],
	fillOpacity: number,
	baseline: number,
	previousY?: (x: number) => number,
) {
	const positions: number[] = [];
	const colors: number[] = [];
	if (points.length < 2) return { positions, colors };

	for (let i = 0; i < points.length - 1; i++) {
		const x1 = xScale(points[i].x);
		const y1 = yScale(points[i].y);
		const x2 = xScale(points[i + 1].x);
		const y2 = yScale(points[i + 1].y);
		const baseY1 = previousY
			? yScale(previousY(points[i].x))
			: yScale(baseline);
		const baseY2 = previousY
			? yScale(previousY(points[i + 1].x))
			: yScale(baseline);

		positions.push(x1, y1, x2, y2, x1, baseY1, x2, y2, x2, baseY2, x1, baseY1);
		for (let j = 0; j < 6; j++) colors.push(...color, fillOpacity);
	}

	return { positions, colors };
}
