export type NativeMaterialId =
  'roof-thatch' | 'timber-oak' | 'plaster-lime' | 'stone-rubble';
export type NativeMaterialStyle =
  'hand-painted' | 'retro-3d' | 'naturalistic' | 'watercolor';

export const MATERIAL_STYLES: readonly NativeMaterialStyle[];

export interface NativeMaterialImage {
  id: NativeMaterialId;
  kind: 'image';
  width: number;
  height: number;
  channels: 'RGBA';
  views: readonly string[];
  profiles?: readonly string[];
  profileSizes?: Record<string, {width: number; height: number}>;
  sourceSeeds: Record<string, number>;
  sourceStyle: NativeMaterialStyle;
  paint: (canvas: HTMLCanvasElement, view?: string, profile?: string) => void;
}

export function makeMaterialSurface(
  material: NativeMaterialId,
  seeds: Record<string, number>,
  style: NativeMaterialStyle
): NativeMaterialImage;
