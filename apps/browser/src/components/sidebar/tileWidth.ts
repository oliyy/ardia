import { createContext, useContext } from "react";
import { Animated } from "react-native";
import { TILE_GAP } from "./pinZone";

export type TileWidth = Animated.AnimatedInterpolation<number>;

const TileInnerContext = createContext<Animated.Value | null>(null);

export const TileInnerProvider = TileInnerContext.Provider;

export function useTileInner(): Animated.Value {
  const inner = useContext(TileInnerContext);
  if (!inner) throw new Error("useTileInner outside a sidebar");
  return inner;
}

export function tileWidthNode(inner: Animated.Value, columns: number, exact: boolean): TileWidth {
  const raw = Animated.divide<number>(Animated.add(inner, -TILE_GAP * (columns - 1)), columns);
  return exact ? raw : Animated.subtract<number>(raw, Animated.modulo<number>(raw, 0.5));
}

export const tileWidthNow = (width: TileWidth): number => (width as unknown as { __getValue(): number }).__getValue();
