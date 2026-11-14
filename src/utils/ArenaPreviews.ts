import classroomPreview from '../assets/images/arena_classroom_desk_1794641236294.jpg';
import libraryPreview from '../assets/images/arena_library_desk_1794641236726.jpg';
import scienceLabPreview from '../assets/images/arena_science_lab_1794641236607.jpg';
import { ArenaId } from './ArenaCatalog';

export const ARENA_PREVIEW_IMAGES: Record<ArenaId, string> = {
  CLASSROOM_DESK: classroomPreview,
  LIBRARY_DESK: libraryPreview,
  SCIENCE_LAB: scienceLabPreview,
};
