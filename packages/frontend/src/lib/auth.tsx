import type { AuthStatus } from "@sui/shared";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch, NetworkError, registerUnauthorizedCallback } from "./api";

interface AuthState {
  configured: boolean;
  authenticated: boolean;
  loading: boolean;
  error: boolean;
}

interface AuthContextValue extends AuthState {
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    configured: false,
    authenticated: false,
    loading: true,
    error: false,
  });

  useEffect(() => {
    const check = async () => {
      try {
        const status = await apiFetch<AuthStatus>("/api/auth/status");
        setState({
          configured: status.configured,
          authenticated: status.authenticated,
          loading: false,
          error: false,
        });
      } catch (error) {
        const offline =
          error instanceof NetworkError && typeof navigator !== "undefined" && !navigator.onLine;
        setState({
          configured: false,
          authenticated: offline,
          loading: false,
          error: true,
        });
      }
    };

    void check();
    const unsubscribe = registerUnauthorizedCallback(() => {
      setState((current) => ({ ...current, authenticated: false }));
    });
    return unsubscribe;
  }, []);

  const login = () => {
    window.location.href = "/api/auth/login";
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "x-sui-client": "web" },
      });
    } finally {
      setState((current) => ({ ...current, authenticated: false }));
      window.location.href = "/";
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
