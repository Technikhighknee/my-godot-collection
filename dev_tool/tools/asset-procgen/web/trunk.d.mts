export interface StemSettings {
  seed: number;
  height: number;
  radius: number;
  character: number;
  buttress: number;
}
export interface StemMesh {
  settings: StemSettings;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  rings: number;
  sides: number;
}
export const DEFAULT_STEM: Readonly<StemSettings>;
export function validateStem(input: unknown): StemSettings;
export function generateStem(input?: StemSettings): StemMesh;
