import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
});

// Inactivity timeout: 30 minutes (in milliseconds)
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Inactivity auto-logout ──────────────────────────────────────────────────
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(async () => {
      if (supabase) {
        await supabase.auth.signOut();
        toast.warning('You have been logged out due to 30 minutes of inactivity.');
      }
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current);
      inactivityTimer.current = null;
    }
  }, []);

  // ── Listen for user activity events ─────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      clearInactivityTimer();
      return;
    }

    const events: (keyof WindowEventMap)[] = [
      'mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click',
    ];

    const handleActivity = () => resetInactivityTimer();

    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }));
    resetInactivityTimer(); // Start the timer immediately on session

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
      clearInactivityTimer();
    };
  }, [session, resetInactivityTimer, clearInactivityTimer]);

  // ── Supabase auth state listener ─────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
