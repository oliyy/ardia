export const TILE_GAP = 8;
export const MIN_TILE = 50;
export const BALANCED_MAX_COLUMNS = 4;
export const PIN_ZONE_HYSTERESIS = 6;
const ARC_PIN_COLUMNS = 4;
const ARC_MIN_TILE = 47;
const ARC_ROW_SLACK = 1 / 1024;

export const pinColumnCap = (addressBar: boolean) => (addressBar ? ARC_PIN_COLUMNS : Infinity);
export const pinRowSlack = (maxColumns: number) => (maxColumns === ARC_PIN_COLUMNS ? ARC_ROW_SLACK : 0);

type Area = { x: number; y: number; w: number };

function arcPinGrid(count: number, innerWidth: number) {
  const capacity = Math.max(1, Math.min(count, ARC_PIN_COLUMNS, Math.floor((innerWidth + TILE_GAP) / (ARC_MIN_TILE + TILE_GAP))));
  const rows = Math.max(1, Math.ceil(count / capacity));
  const columns = Math.max(1, Math.ceil(count / rows));
  return { columns, width: (innerWidth - TILE_GAP * (columns - 1)) / columns };
}

export function pinGrid(count: number, innerWidth: number, maxColumns: number | boolean = Infinity, balanced = false) {
  if (maxColumns === ARC_PIN_COLUMNS) return arcPinGrid(count, innerWidth);
  if (balanced || maxColumns === true) {
    const fit = Math.max(1, Math.floor((innerWidth + TILE_GAP) / (MIN_TILE + TILE_GAP)));
    const rows = Math.ceil((count || 1) / Math.min(BALANCED_MAX_COLUMNS, fit));
    const columns = Math.ceil((count || 1) / rows);
    return { columns, width: Math.floor(((innerWidth - TILE_GAP * (columns - 1)) / columns) * 2) / 2 };
  }
  const columns = Math.max(1, Math.min(count || 1, typeof maxColumns === "number" ? maxColumns : Infinity, Math.floor((innerWidth + TILE_GAP) / (MIN_TILE + TILE_GAP))));
  const width = Math.floor(((innerWidth - TILE_GAP * (columns - 1)) / columns) * 2) / 2;
  return { columns, width };
}

export function pinGridHeight(count: number, innerWidth: number, tileHeight: number, maxColumns: number | boolean = Infinity, balanced = false): number {
  const rows = Math.max(1, Math.ceil(count / pinGrid(count, innerWidth, maxColumns, balanced).columns));
  return rows * tileHeight + (rows - 1) * TILE_GAP;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function pinSlot(grid: Area, count: number, tileHeight: number, x: number, y: number, maxColumns: number | boolean = Infinity, balanced = false): number {
  const { columns, width } = pinGrid(count, grid.w, maxColumns, balanced);
  const rows = Math.max(1, Math.ceil(count / columns));
  const row = clamp(Math.floor((y - grid.y + TILE_GAP / 2) / (tileHeight + TILE_GAP)), 0, rows - 1);
  const column = clamp(Math.floor((x - grid.x + TILE_GAP / 2) / (width + TILE_GAP)), 0, columns - 1);
  return clamp(row * columns + column, 0, Math.max(0, count - 1));
}

export function overPins(y: number, listTop: number, wasOver: boolean, hysteresis = PIN_ZONE_HYSTERESIS): boolean {
  return y < listTop + (wasOver ? hysteresis : -hysteresis);
}
