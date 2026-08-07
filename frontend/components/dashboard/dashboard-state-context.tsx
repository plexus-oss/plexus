"use client";

/**
 * Dashboard State Context
 *
 * Combined provider for dashboard-level filters and variables.
 * Reduces provider nesting by one level.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import type { DashboardVariable, DataFilter } from "@/lib/types/dashboard";
import { useConnectionQueryManual } from "@/hooks/use-connection-query";

// =============================================================================
// Context Types
// =============================================================================

interface DashboardFilterContextType {
	filters: DataFilter[];
}

interface DashboardVariableContextType {
	variables: DashboardVariable[];
	values: Record<string, string>;
	setValue: (name: string, value: string) => void;
	options: Record<string, string[]>;
	loading: Record<string, boolean>;
}

const DashboardFilterContext = createContext<DashboardFilterContextType>({
	filters: [],
});

const DashboardVariableContext = createContext<DashboardVariableContextType>({
	variables: [],
	values: {},
	setValue: () => {},
	options: {},
	loading: {},
});

/**
 * Dashboard-level refresh interval (ms, 0 = off / no auto-refresh).
 * Set via the DashboardToolbar dropdown. When non-zero, every panel in the
 * dashboard polls at this cadence — overriding per-source defaults but
 * losing to explicit panel-level overrides.
 */
const DashboardRefreshContext = createContext<number>(0);

// =============================================================================
// Hooks (backward-compatible exports)
// =============================================================================

export function useDashboardFilters() {
	return useContext(DashboardFilterContext);
}

export function useDashboardVariables() {
	return useContext(DashboardVariableContext);
}

export function useDashboardRefreshInterval(): number {
	return useContext(DashboardRefreshContext);
}

// =============================================================================
// Combined Provider
// =============================================================================

export function DashboardStateProvider({
	filters,
	variables,
	refreshInterval = 0,
	onVariableChange,
	children,
}: {
	filters: DataFilter[];
	variables: DashboardVariable[];
	refreshInterval?: number;
	onVariableChange?: (name: string, value: string) => void;
	children: ReactNode;
}) {
	const filterValue = useMemo(() => ({ filters }), [filters]);

	// ── Variable state ──

	const [values, setValues] = useState<Record<string, string>>(() => {
		const initial: Record<string, string> = {};
		for (const v of variables) {
			initial[v.name] = v.current || v.defaultValue || "";
		}
		return initial;
	});

	// Reconcile values when the variables prop changes (adjust-state-during-
	// render instead of an effect). Guarded by an identity check so it only
	// runs when `variables` actually changes.
	const [prevVariables, setPrevVariables] = useState(variables);
	if (prevVariables !== variables) {
		setPrevVariables(variables);
		setValues((prev) => {
			const next: Record<string, string> = {};
			let changed = Object.keys(prev).length !== variables.length;
			for (const v of variables) {
				next[v.name] = prev[v.name] ?? v.current ?? v.defaultValue ?? "";
				if (next[v.name] !== prev[v.name]) changed = true;
			}
			return changed ? next : prev;
		});
	}

	const setValue = useCallback(
		(name: string, value: string) => {
			setValues((prev) => ({ ...prev, [name]: value }));
			onVariableChange?.(name, value);
		},
		[onVariableChange],
	);

	// ── Custom variable options ──

	const customOptions = useMemo(() => {
		const result: Record<string, string[]> = {};
		for (const v of variables) {
			if (v.type === "custom" && v.customValues) {
				let opts = v.customValues
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				if (v.sort === "alpha-asc") opts.sort();
				if (v.sort === "alpha-desc") opts.sort().reverse();
				if (v.includeAll) opts = ["All", ...opts];
				result[v.name] = opts;
			}
		}
		return result;
	}, [variables]);

	// ── Query variable options (up to 4) ──

	const queryVars = useMemo(
		() =>
			variables.filter(
				(v) => v.type === "query" && v.querySourceId && v.queryString,
			),
		[variables],
	);

	const qv0 = queryVars[0];
	const qv1 = queryVars[1];
	const qv2 = queryVars[2];
	const qv3 = queryVars[3];

	const q0 = useConnectionQueryManual(qv0?.querySourceId ?? null);
	const q1 = useConnectionQueryManual(qv1?.querySourceId ?? null);
	const q2 = useConnectionQueryManual(qv2?.querySourceId ?? null);
	const q3 = useConnectionQueryManual(qv3?.querySourceId ?? null);

	const queryExecutors = [
		{ variable: qv0, executor: q0 },
		{ variable: qv1, executor: q1 },
		{ variable: qv2, executor: q2 },
		{ variable: qv3, executor: q3 },
	];

	const valuesKey = JSON.stringify(values);
	useEffect(() => {
		for (const { variable, executor } of queryExecutors) {
			if (!variable || !variable.queryString) continue;
			let queryStr = variable.queryString;
			for (const [name, val] of Object.entries(values)) {
				if (name === variable.name) continue;
				queryStr = queryStr.replace(
					new RegExp(`\\$${name}(?![\\w])`, "g"),
					val.replace(/'/g, "''"),
				);
			}
			executor.execute(queryStr);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		qv0?.queryString,
		qv1?.queryString,
		qv2?.queryString,
		qv3?.queryString,
		valuesKey,
	]);

	const queryOptions = useMemo(() => {
		const result: Record<string, string[]> = {};
		for (const { variable, executor } of queryExecutors) {
			if (!variable) continue;
			if (executor.rows.length > 0 && executor.columns.length > 0) {
				const firstCol = executor.columns[0].name;
				let opts = executor.rows
					.map((r) => String(r[firstCol] ?? ""))
					.filter(Boolean);
				opts = [...new Set(opts)];
				if (variable.sort === "alpha-asc") opts.sort();
				if (variable.sort === "alpha-desc") opts.sort().reverse();
				if (variable.includeAll) opts = ["All", ...opts];
				result[variable.name] = opts;
			}
		}
		return result;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [q0.rows, q1.rows, q2.rows, q3.rows]);

	const loading = useMemo(() => {
		const result: Record<string, boolean> = {};
		for (const { variable, executor } of queryExecutors) {
			if (variable) result[variable.name] = executor.isLoading;
		}
		return result;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [q0.isLoading, q1.isLoading, q2.isLoading, q3.isLoading]);

	const options = useMemo(() => {
		const merged = { ...customOptions, ...queryOptions };
		for (const v of variables) {
			const current = values[v.name];
			if (current) {
				if (!merged[v.name]) {
					merged[v.name] = [current];
				} else if (!merged[v.name].includes(current)) {
					merged[v.name] = [current, ...merged[v.name]];
				}
			}
		}
		return merged;
	}, [customOptions, queryOptions, variables, values]);

	const variableValue = useMemo(
		() => ({ variables, values, setValue, options, loading }),
		[variables, values, setValue, options, loading],
	);

	return (
		<DashboardFilterContext.Provider value={filterValue}>
			<DashboardVariableContext.Provider value={variableValue}>
				<DashboardRefreshContext.Provider value={refreshInterval}>
					{children}
				</DashboardRefreshContext.Provider>
			</DashboardVariableContext.Provider>
		</DashboardFilterContext.Provider>
	);
}
