export type MotherCardSide = 'front' | 'back';

export interface MotherCardImageConfig {
  original: string;
  cropped: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface MotherCardImageStoredSide {
  cropped_path?: string;
  original_path?: string;
  cropped?: string;
  original?: string;
  zoom: number;
  offset_x: number;
  offset_y: number;
}

export type MotherCardImagesJson = Partial<Record<MotherCardSide, MotherCardImageStoredSide>>;

export type MotherCardImageStore = Partial<Record<MotherCardSide, MotherCardImageConfig>>;

export const LEGACY_MOTHER_CARD_STORAGE_KEY = 'moms-care-mother-card-images';

export function readLegacyMotherCardStore(): MotherCardImageStore {
  try {
    const raw = localStorage.getItem(LEGACY_MOTHER_CARD_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as MotherCardImageStore;
  } catch {
    return {};
  }
}

export function writeMotherCardLocalStore(store: MotherCardImageStore): void {
  localStorage.setItem(LEGACY_MOTHER_CARD_STORAGE_KEY, JSON.stringify(store));
}

export function clearLegacyMotherCardStore(): void {
  localStorage.removeItem(LEGACY_MOTHER_CARD_STORAGE_KEY);
}

export function motherCardImagesJsonIsEmpty(store: MotherCardImagesJson | null | undefined): boolean {
  if (!store || typeof store !== 'object') return true;
  return !store.front && !store.back;
}
