import { create } from "zustand";

export const useUpsellShift = create<Record<string, number>>()(() => ({}));

export const setUpsellShift = (windowId: string, shift: number) => useUpsellShift.setState((u) => (u[windowId] === shift ? u : { ...u, [windowId]: shift }));
