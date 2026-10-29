import "react-native";

declare module "react-native" {
  interface ViewProps {
    tooltip?: string;
    presentationGate?: boolean;
    presentationFolded?: boolean;
    presentationPersistent?: boolean;
    presentationSession?: boolean;
    presentationShiftBound?: number;
    presentationArming?: boolean;
    mountReceipt?: number;
    ntpLayoutBasis?: number | null;
    ntpLayoutRole?: "bar" | "mark" | "commandBar" | null;
    onMountReceipt?: (event: NativeSyntheticEvent<{ receipt: number; target: number; x: number; y: number; width: number; height: number }>) => void;
  }
}
