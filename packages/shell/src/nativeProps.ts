import { useCallback, type Ref } from "react";
import type { NativeMethods } from "react-native";

type NativeProps = Record<string, unknown>;

export type NativeViewInstance = { nativeRef?: { current: NativeMethods | null }; setNativeProps?: (props: NativeProps) => void };
export type NativePropsRef = (instance: NativeViewInstance | null) => (() => void) | undefined;

const attached = new WeakSet<NativeViewInstance>();
const unchanged = (props: NativeProps) => props;

function delegateNativeProps(instance: NativeViewInstance, translate: (props: NativeProps) => NativeProps) {
  if (typeof instance.setNativeProps === "function" || !instance.nativeRef) return;
  instance.setNativeProps = (props) => {
    if (attached.has(instance)) instance.nativeRef?.current?.setNativeProps(translate(props));
  };
}

function forwardInstance(ref: Ref<NativeViewInstance> | undefined, instance: NativeViewInstance): () => void {
  if (typeof ref === "function") {
    const cleanup = ref(instance);
    return typeof cleanup === "function" ? cleanup : () => void ref(null);
  }
  if (!ref) return () => {};
  ref.current = instance;
  return () => {
    ref.current = null;
  };
}

export function useNativePropsRef(ref: Ref<NativeViewInstance> | undefined, translate = unchanged): NativePropsRef {
  return useCallback(
    (instance: NativeViewInstance | null) => {
      if (!instance) return undefined;
      delegateNativeProps(instance, translate);
      attached.add(instance);
      const release = forwardInstance(ref, instance);
      return () => {
        attached.delete(instance);
        release();
      };
    },
    [ref, translate],
  );
}
