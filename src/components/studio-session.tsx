import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { meFn } from "../lib/auth";

export type StudioUser = { id: string; name: string | null; email: string; password_change_required?: boolean };
type StudioSession = { user: StudioUser | null; checked: boolean };

const StudioSessionContext = createContext<StudioSession | null>(null);

export function StudioSessionProvider({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [session, setSession] = useState<StudioSession>({ user: null, checked: false });
  const request = useRef<Promise<StudioUser | null> | null>(null);

  useEffect(() => {
    if (pathname === "/login" || session.checked) return;
    let cancelled = false;
    request.current ??= meFn() as Promise<StudioUser | null>;

    request.current.then((user) => {
      if (cancelled) return;
      setSession({ user, checked: true });
      if (!user) {
        const next = window.location.pathname + window.location.search;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      } else if (user.password_change_required && pathname !== "/password") {
        const next = window.location.pathname + window.location.search;
        window.location.replace(`/password?next=${encodeURIComponent(next)}`);
      }
    }).catch(() => {
      if (cancelled) return;
      setSession({ user: null, checked: true });
      const next = window.location.pathname + window.location.search;
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
    });

    return () => { cancelled = true; };
  }, [pathname, session.checked]);

  return <StudioSessionContext.Provider value={session}>{children}</StudioSessionContext.Provider>;
}

export function useStudioSession() {
  const session = useContext(StudioSessionContext);
  if (!session) throw new Error("useStudioSession must be used inside StudioSessionProvider");
  return session;
}
