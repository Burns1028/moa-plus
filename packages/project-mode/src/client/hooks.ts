import { useRef, useSyncExternalStore } from "react";
import { reuse } from "./store.ts";
/** Stable selected snapshot prevents unrelated token frames from rendering a row. */
export function useSelected<T>(
  subscribe: (listener: () => void) => () => void,
  select: () => T,
): T {
  const ref = useRef<{ value: T }>();
  const get = () => {
    const value = reuse(ref.current?.value, select());
    ref.current = { value };
    return value;
  };
  return useSyncExternalStore(subscribe, get, get);
}
