export function getOrbitRegime(
  altitudeKm: number,
  eccentricity: number,
): { label: string; className: string } | null {
  if (eccentricity > 0.25)
    return { label: "HEO", className: "border-purple-500/50 text-purple-400" };
  if (altitudeKm < 2000)
    return {
      label: "LEO",
      className: "border-emerald-500/50 text-emerald-400",
    };
  if (altitudeKm <= 35286)
    return { label: "MEO", className: "border-cyan-500/50 text-cyan-400" };
  if (altitudeKm <= 36286)
    return { label: "GEO", className: "border-amber-500/50 text-amber-400" };
  return { label: "HEO", className: "border-purple-500/50 text-purple-400" };
}
