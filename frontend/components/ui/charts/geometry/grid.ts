/**
 * Grid geometry — shared by all chart types.
 */
export function createGridGeometry(
	xTicks: number[],
	yTicks: number[],
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	width: number,
	height: number,
) {
	const positions: number[] = [];
	const colors: number[] = [];
	const isDark = document.documentElement.classList.contains("dark");
	const gridColor: [number, number, number] = isDark
		? [0.3, 0.3, 0.35]
		: [0.85, 0.85, 0.88];

	for (const tick of xTicks) {
		const x = xScale(tick);
		positions.push(
			x,
			0,
			x + 1,
			0,
			x,
			height,
			x + 1,
			0,
			x + 1,
			height,
			x,
			height,
		);
		for (let i = 0; i < 6; i++) colors.push(...gridColor, 0.4);
	}
	for (const tick of yTicks) {
		const y = yScale(tick);
		positions.push(0, y, width, y, 0, y + 1, width, y, width, y + 1, 0, y + 1);
		for (let i = 0; i < 6; i++) colors.push(...gridColor, 0.4);
	}

	return { positions, colors };
}
