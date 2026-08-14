import { describe, expect, it } from "vitest";
import {
	createLineGeometry,
	MAX_SMOOTH_SPACING_PX,
	shouldSmoothLine,
} from "@/components/ui/charts/geometry/line";

describe("shouldSmoothLine", () => {
	it("never smooths fewer than 3 points", () => {
		expect(shouldSmoothLine(0, 0)).toBe(false);
		expect(shouldSmoothLine(10, 1)).toBe(false);
		expect(shouldSmoothLine(10, 2)).toBe(false);
	});

	it("smooths dense series (sub-threshold average spacing)", () => {
		// 800px spanned by 400 points → 2px spacing.
		expect(shouldSmoothLine(800, 400)).toBe(true);
	});

	it("stops smoothing when average spacing exceeds the threshold", () => {
		// Deep zoom: 4 points across 800px → ~267px spacing. Catmull-Rom would
		// invent Y-overshoot curves between samples the data never contained.
		expect(shouldSmoothLine(800, 4)).toBe(false);
	});

	it("uses the absolute span (direction-agnostic)", () => {
		expect(shouldSmoothLine(-800, 400)).toBe(true);
		expect(shouldSmoothLine(-800, 4)).toBe(false);
	});

	it("flips exactly at the documented threshold", () => {
		const n = 5;
		const spanAt = MAX_SMOOTH_SPACING_PX * (n - 1);
		expect(shouldSmoothLine(spanAt, n)).toBe(true);
		expect(shouldSmoothLine(spanAt + 1, n)).toBe(false);
	});
});

describe("createLineGeometry smoothing gate", () => {
	const identity = (v: number) => v;

	it("emits straight segments (no interpolation) at huge point spacing", () => {
		// 3 points across 900px — smoothing requested but must be gated off.
		const points = [
			{ x: 0, y: 0 },
			{ x: 450, y: 100 },
			{ x: 900, y: 0 },
		];
		const geo = createLineGeometry(
			points,
			identity,
			identity,
			[1, 0, 0],
			2,
			true,
		);
		// Unsmoothed: 2 segments × 6 vertices × 2 coords = 24 position floats.
		expect(geo.positions.length).toBe(24);
	});

	it("still interpolates dense smoothed series", () => {
		const points = Array.from({ length: 100 }, (_, i) => ({
			x: i * 4,
			y: Math.sin(i / 5),
		}));
		const geo = createLineGeometry(
			points,
			identity,
			identity,
			[1, 0, 0],
			2,
			true,
		);
		// Catmull-Rom at 12 segments per interval multiplies vertex count well
		// beyond the unsmoothed 99 segments.
		expect(geo.positions.length).toBeGreaterThan(99 * 12);
	});

	it("never emits NaN for coincident points (duplicate ms timestamps)", () => {
		const points = [
			{ x: 100, y: 5 },
			{ x: 100, y: 5 },
			{ x: 200, y: 6 },
		];
		const geo = createLineGeometry(
			points,
			identity,
			identity,
			[1, 0, 0],
			2,
			false,
		);
		for (const v of geo.positions) expect(Number.isFinite(v)).toBe(true);
	});
});
