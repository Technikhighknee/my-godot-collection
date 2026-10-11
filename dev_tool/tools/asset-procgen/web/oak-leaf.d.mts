export interface OakLeafProfile {
  lobes: number;
  halfWidth: number;
  baseEar: number;
  depth: number;
  veins: number[][];
  outline: { t:number; left:number; right:number }[];
}
export function oakLeafProfile(seed:number): OakLeafProfile;
