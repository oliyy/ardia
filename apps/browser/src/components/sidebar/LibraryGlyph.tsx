import { View } from "react-native";

const BOX = { left: 1.5, right: 13, top: 7, bottom: 16 } as const;
const HOLE = { left: 5.5, right: 9, top: 8, bottom: 10 } as const;
const CLEAR = "transparent";

export function LibraryGlyph({ color }: { color: string }) {
  const piece = (left: number, top: number, width: number, height: number, extra: object = {}) => (
    <View style={{ position: "absolute", left, top, width, height, backgroundColor: color, ...extra }} />
  );
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 16, height: 16 }}>
      {piece(BOX.left, BOX.top, BOX.right - BOX.left, HOLE.top - BOX.top, { borderTopLeftRadius: 0.75, borderTopRightRadius: 0.75 })}
      {piece(BOX.left, HOLE.top, HOLE.left - BOX.left, HOLE.bottom - HOLE.top)}
      {piece(HOLE.right, HOLE.top, BOX.right - HOLE.right, HOLE.bottom - HOLE.top)}
      {piece(BOX.left, HOLE.bottom, BOX.right - BOX.left, BOX.bottom - HOLE.bottom, { borderBottomLeftRadius: 2.5, borderBottomRightRadius: 2.5 })}
      {piece(0, 3.5, 9, 2, { borderRadius: 1 })}
      {piece(2.5, 2.5, 6, 1, { borderTopLeftRadius: 0.5, borderTopRightRadius: 0.5 })}
      <View
        style={{
          position: "absolute",
          left: 3,
          top: 0.5,
          width: 0,
          height: 0,
          borderLeftWidth: 1.25,
          borderRightWidth: 1.25,
          borderBottomWidth: 2,
          borderLeftColor: CLEAR,
          borderRightColor: CLEAR,
          borderBottomColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 10,
          top: 2.5,
          width: 0,
          height: 0,
          borderTopWidth: 1.5,
          borderBottomWidth: 1.5,
          borderLeftWidth: 3.5,
          borderTopColor: CLEAR,
          borderBottomColor: CLEAR,
          borderLeftColor: color,
        }}
      />
      {piece(8, -0.5, 2, 2, { borderRadius: 1 })}
    </View>
  );
}
