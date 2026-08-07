"use client";

/**
 * Canonical CRUD-over-SWR resource hook — docs/STANDARDS.md §4.
 *
 * One generic hook backs all list+CRUD resource hooks (source groups,
 * webhooks, integrations, …). Per-resource hooks are thin typed wrappers that
 * supply the API path, envelope keys, and toast copy, and graft on anything
 * resource-specific (member management, FormData uploads, test endpoints).
 *
 * Handled here, once:
 * - SWR list fetch of `{ [listKey]: TList[] }` via the shared `fetcher`
 * - create (POST `path`) / update (PATCH `path/:id`) / remove (DELETE `path/:id`)
 * - error-body normalization (`failFrom`) with per-action fallback messages
 * - optional toast feedback (pass the resource's toast module + messages;
 *   omit `toast` for silent hooks like integrations)
 * - cache sync: `"patch"` optimistically patches the cached list from the
 *   mutation response (no refetch), `"revalidate"` awaits a full refetch
 * - delete is always optimistic: removed from the cached list immediately,
 *   rolled back on failure (see `optimisticMutation`)
 */

import useSWR, { type KeyedMutator } from "swr";
import type { MutatorCallback, MutatorOptions, SWRConfiguration } from "swr";
import { fetcher } from "@/lib/fetcher";

/**
 * Atomic optimistic mutation — docs/STANDARDS.md §2.5.
 *
 * Builds the `[data, options]` pair for SWR's `mutate`: `transform` is applied
 * to the cached value immediately (`optimisticData`), `request` runs inside
 * the mutation so SWR's race guard stays active for the whole request window
 * (concurrent revalidations can't clobber the optimistic state), and a failed
 * request rolls the cache back to the pre-mutation snapshot.
 *
 * Spread into a bound or global mutate:
 *   await mutate(...optimisticMutation(remove(id), doDelete));
 *
 * With a key-filter global mutate, `request` is invoked once per matched key —
 * share one promise across keys: `const req = doDelete()` then `() => req`.
 */
export function optimisticMutation<TData>(
  transform: (current: TData | undefined) => TData,
  request: () => Promise<unknown>,
  { revalidate = false }: { revalidate?: boolean } = {},
): [MutatorCallback<TData>, MutatorOptions<TData>] {
  return [
    async (current) => {
      await request();
      return transform(current);
    },
    {
      optimisticData: transform,
      rollbackOnError: true,
      populateCache: true,
      revalidate,
    },
  ];
}

/**
 * Normalize an error response body (`{ error }` shape) into a thrown Error
 * with a sensible fallback message.
 */
export async function failFrom(
  res: Response,
  fallback: string,
): Promise<never> {
  const body = await res.json().catch(() => ({ error: fallback }));
  throw new Error(body.error || fallback);
}

/** Minimal toast surface — both `sonner` and `lib/toast-utils` satisfy it. */
export interface ResourceToast {
  success: (message: string, options?: { description?: string }) => unknown;
  error: (message: string, options?: { description?: string }) => unknown;
}

/** Success-toast copy per mutation. Omit a key to skip that toast. */
export interface ResourceMessages<TCreate> {
  created?: string | ((input: TCreate) => string);
  updated?: string;
  deleted?: string;
}

/** Per-call message overrides (e.g. a toggle wrapper around `update`). */
export interface MutationMessageOverrides {
  /** Success toast message (overrides `messages.updated`). */
  success?: string;
  /** Fallback error message when the response body has no `error`. */
  fallback?: string;
}

export interface UseResourceOptions<TCreate> {
  /** Base API path, e.g. `"/api/webhooks"`. */
  path: string;
  /** Envelope key of the list response, e.g. `"webhooks"`. */
  listKey: string;
  /** Envelope key of single-item mutation responses, e.g. `"webhook"`. */
  itemKey: string;
  /** Noun for fallback error messages, e.g. `"webhook"` → "Failed to create webhook". */
  label: string;
  /** Cache-sync strategy after mutations (default `"patch"`). */
  cache?: "patch" | "revalidate";
  /** When false, the list fetch is disabled (SWR key = null). Default true. */
  enabled?: boolean;
  /** SWR options for the list fetch. */
  swr?: SWRConfiguration;
  /** Toast module for mutation feedback. Omit for silent hooks. */
  toast?: ResourceToast;
  /** Success-toast copy. Errors always toast when `toast` is provided. */
  messages?: ResourceMessages<TCreate>;
}

export interface UseResourceReturn<T, TCreate, TUpdate, TList> {
  /** Cached list items (empty array while loading). */
  items: TList[];
  isLoading: boolean;
  error: Error | undefined;
  create: (input: TCreate) => Promise<T>;
  update: (
    id: string,
    updates: TUpdate,
    overrides?: MutationMessageOverrides,
  ) => Promise<T>;
  remove: (id: string) => Promise<void>;
  /** The SWR list mutator (full refetch when called with no arguments). */
  refresh: KeyedMutator<Record<string, TList[]>>;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function useResource<
  T extends { id: string },
  TCreate = unknown,
  TUpdate = unknown,
  TList extends { id: string } = T,
>(
  options: UseResourceOptions<TCreate>,
): UseResourceReturn<T, TCreate, TUpdate, TList> {
  const {
    path,
    listKey,
    itemKey,
    label,
    cache = "patch",
    enabled = true,
    swr,
    toast,
    messages,
  } = options;

  const { data, error, isLoading, mutate } = useSWR<Record<string, TList[]>>(
    enabled ? path : null,
    fetcher,
    swr,
  );

  /** Toast (if configured) and throw the normalized error of a failed response. */
  const fail = async (res: Response, fallback: string): Promise<never> => {
    const body = await res.json().catch(() => ({ error: fallback }));
    const message: string = body.error || fallback;
    toast?.error(message);
    throw new Error(message);
  };

  /** Apply the configured cache-sync strategy after a successful mutation. */
  const sync = async (patch: (current: TList[]) => TList[]): Promise<void> => {
    if (cache === "revalidate") {
      await mutate();
    } else {
      mutate(
        (current) => ({
          ...current,
          [listKey]: patch(current?.[listKey] || []),
        }),
        false,
      );
    }
  };

  const create = async (input: TCreate): Promise<T> => {
    const res = await fetch(path, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
    if (!res.ok) await fail(res, `Failed to create ${label}`);
    const item = (await res.json())[itemKey] as T;
    const message =
      typeof messages?.created === "function"
        ? messages.created(input)
        : messages?.created;
    if (message) toast?.success(message);
    await sync((list) => [item as unknown as TList, ...list]);
    return item;
  };

  const update = async (
    id: string,
    updates: TUpdate,
    overrides?: MutationMessageOverrides,
  ): Promise<T> => {
    const res = await fetch(`${path}/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(updates),
    });
    if (!res.ok)
      await fail(res, overrides?.fallback ?? `Failed to update ${label}`);
    const item = (await res.json())[itemKey] as T;
    const message = overrides?.success ?? messages?.updated;
    if (message) toast?.success(message);
    await sync((list) =>
      list.map((i) => (i.id === id ? (item as unknown as TList) : i)),
    );
    return item;
  };

  const remove = async (id: string): Promise<void> => {
    const fallback = `Failed to delete ${label}`;
    try {
      // Remove from the cached list immediately; SWR rolls back on failure.
      await mutate(
        ...optimisticMutation<Record<string, TList[]>>(
          (current) => ({
            ...current,
            [listKey]: (current?.[listKey] || []).filter((i) => i.id !== id),
          }),
          async () => {
            const res = await fetch(`${path}/${id}`, { method: "DELETE" });
            if (!res.ok) await failFrom(res, fallback);
          },
          { revalidate: cache === "revalidate" },
        ),
      );
      if (messages?.deleted) toast?.success(messages.deleted);
    } catch (err) {
      toast?.error(err instanceof Error ? err.message : fallback);
      throw err;
    }
  };

  return {
    items: data?.[listKey] || [],
    isLoading,
    error,
    create,
    update,
    remove,
    refresh: mutate,
  };
}
