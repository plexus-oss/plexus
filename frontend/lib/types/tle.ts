/**
 * TLE lookup response shape (from /api/tle/lookup)
 */
export interface TleLookupResult {
  name: string;
  norad_id: number;
  tle_line1: string;
  tle_line2: string;
  tle_epoch: string;
  orbital_params: {
    inclination: number;
    eccentricity: number;
    raan: number;
    argPerigee: number;
    meanAnomaly: number;
    meanMotion: number;
    period: number;
    altitude: number;
  };
}
