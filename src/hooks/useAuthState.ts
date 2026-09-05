import { useSyncExternalStore } from "react";
import { getAuthState, subscribeToAuthState } from "../lib/auth.ts";

export function useAuthState() {
  return useSyncExternalStore(subscribeToAuthState, getAuthState, getAuthState);
}
