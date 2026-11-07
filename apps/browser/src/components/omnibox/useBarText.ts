import { useReducer, useState } from "react";
import { barReducer, initialBar, selectionTracker } from "./barText";

export function useBarText(initialText: string, noneSelected: number) {
  const [start] = useState(() => {
    const bar = initialBar(initialText, noneSelected);
    return { bar, selection: selectionTracker({ start: 0, end: bar.typed.length }) };
  });
  const [state, dispatch] = useReducer(barReducer, start.bar);
  return { ...state, dispatch, selection: start.selection };
}
