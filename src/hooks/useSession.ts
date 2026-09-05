import { useOutletContext } from "react-router-dom";
import type { Session } from "../lib/types/api.ts";

export function useSession(): Session {
  return useOutletContext<Session>();
}
