/** Stable selected snapshot prevents unrelated token frames from rendering a row. */
export declare function useSelected<T>(subscribe: (listener: () => void) => () => void, select: () => T): T;
