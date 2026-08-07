import { Spinner } from "./spinner";

/**
 * The one loading state used by every `loading.tsx` at the route level.
 * Centered spinner, no per-route skeleton shapes — consistency over
 * theatrics. Re-export this from any new `loading.tsx`.
 */
export default function RouteLoading() {
  return (
    <div className="flex items-center justify-center h-full py-12">
      <Spinner />
    </div>
  );
}
