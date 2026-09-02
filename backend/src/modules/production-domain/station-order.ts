import { Station } from '../canonicalization/types';

/** The 6-step production line order, per docs/plan-v4.md. */
export const STATION_ORDER: readonly Station[] = [
  'RECEIVING',
  'SORTING',
  'WASHING',
  'DRYING',
  'FOLDING',
  'DISPATCH',
];

export function stationIndex(station: Station): number {
  return STATION_ORDER.indexOf(station);
}
