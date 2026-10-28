import { useLayoutEffect } from "react";
import { registerUnsavedChanges } from "../lib/unsavedChanges";

export function useUnsavedChanges(dirty: boolean) {
  useLayoutEffect(() => registerUnsavedChanges(() => dirty), [dirty]);
}
