import type {TreeMesh} from './tree.mjs';
import type {OakBarkProfile} from './oak-bark.mjs';
export const OAK_BARK_UV_SCALE:Readonly<{aroundMeters:number;alongMeters:number}>;
export interface BarkGeometryGroup {
  start:number;count:number;materialIndex:number;
  profile:OakBarkProfile;axisId:number;radius:number;
}
export interface MappedWood {
  positions:Float32Array;normals:Float32Array;uvs:Float32Array;
  indices:Uint32Array;bounds:TreeMesh['bounds'];
  uvScale:typeof OAK_BARK_UV_SCALE;
  groups:BarkGeometryGroup[];
}
export function mapOakBarkWood(wood:TreeMesh):MappedWood;
