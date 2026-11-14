export type ArenaId = 'CLASSROOM_DESK' | 'LIBRARY_DESK' | 'SCIENCE_LAB';

export const DEFAULT_ARENA: ArenaId = 'CLASSROOM_DESK';

export const ARENA_ORDER: readonly ArenaId[] = [
  'CLASSROOM_DESK',
  'LIBRARY_DESK',
  'SCIENCE_LAB',
];

export interface ArenaSpec {
  id: ArenaId;
  label: string;
  shortLabel: string;
  surfaceMaterial: string;
  lightingMood: string;
  description: string;
  swatchHex: string;
  accentHex: string;
}

export const ARENA_SPECS: Record<ArenaId, ArenaSpec> = {
  CLASSROOM_DESK: {
    id: 'CLASSROOM_DESK',
    label: 'Classroom Wooden Desk',
    shortLabel: 'Classroom Desk',
    surfaceMaterial: 'Varnished Beechwood',
    lightingMood: 'Warm Daylight',
    description:
      'Sunlit beechwood tabletop with inlaid ruler ticks, tubular steel legs, and chalkboard backdrop.',
    swatchHex: '#D4A36E',
    accentHex: '#4F6D8A',
  },
  LIBRARY_DESK: {
    id: 'LIBRARY_DESK',
    label: 'Library Desk',
    shortLabel: 'Library Desk',
    surfaceMaterial: 'Aged Study Oak',
    lightingMood: 'Warm Amber',
    description:
      'Aged wooden reading desk with faded vintage varnish, faint pencil & ink wear, warm library lighting, and bookshelves.',
    swatchHex: '#A67447',
    accentHex: '#85581A',
  },
  SCIENCE_LAB: {
    id: 'SCIENCE_LAB',
    label: 'Science Lab',
    shortLabel: 'Science Lab',
    surfaceMaterial: 'Phenolic Resin',
    lightingMood: 'Neutral Lab',
    description:
      'Muted light-grey laboratory workbench with subtle measurement markings, sturdy steel frame, and lab cabinets.',
    swatchHex: '#C5C9CB',
    accentHex: '#2E664B',
  },
};

export function isArenaId(value: unknown): value is ArenaId {
  return typeof value === 'string' && value in ARENA_SPECS;
}
