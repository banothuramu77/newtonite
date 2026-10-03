import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      setAuth: (user: User, token: string) => {
        localStorage.setItem('newtonite-token', token);
        set({ user, token, isAuthenticated: true });
      },

      clearAuth: () => {
        localStorage.removeItem('newtonite-token');
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    {
      name: 'newtonite-auth',
      // Only persist user and token (not isAuthenticated — recompute on load)
      partialize: (state) => ({ user: state.user, token: state.token }),
      // Rehydrate isAuthenticated from token presence
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = !!state.token;
          if (state.token) {
            localStorage.setItem('newtonite-token', state.token);
          }
        }
      },
    }
  )
);
