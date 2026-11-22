import React, { createContext, useContext, useEffect, useState } from 'react';

import { auth } from '../lib/firebase';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  signInAnonymously,
  updateProfile
} from 'firebase/auth';
import { isFirebaseConfigured } from '../lib/appConfig';

const AuthContext = createContext({
  user: null,
  loading: true,
  loginWithGoogle: async () => { },
  loginAsGuest: async () => { },
  logout: async () => { }
});

const googleProvider = new GoogleAuthProvider();

// ─── Zero-backend local identity ────────────────────────────────────────────
// When no Firebase keys are configured (the default free deployment), sign-in
// is entirely device-local: a manager profile is created in localStorage.
// This is what makes Solo auctions work with zero setup and zero cost.
const LOCAL_USER_KEY = 'the_gavel_local_user';

const createLocalUser = (displayName) => ({
  uid: `guest_local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  displayName,
  email: null,
  photoURL: null,
  isLocal: true,
});

const restoreLocalUser = () => {
  try {
    const raw = localStorage.getItem(LOCAL_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const persistLocalUser = (user) => {
  try {
    user ? localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user))
         : localStorage.removeItem(LOCAL_USER_KEY);
  } catch {}
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // AuthProvider check failed
  }
  return context || {};
};

export const AuthProvider = ({ children }) => {
  // Device-local mode: seed the session from localStorage up-front so the
  // first render already has the right identity (no post-mount state set).
  const [user, setUser] = useState(() => (isFirebaseConfigured ? null : restoreLocalUser()));
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const loginWithGoogle = async () => {
    if (!isFirebaseConfigured) {
      throw new Error('Online sign-in is not available on this deployment.');
    }
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  };

  const loginAsGuest = async (displayName) => {
    if (!isFirebaseConfigured) {
      const localUser = createLocalUser(displayName);
      setUser(localUser);
      persistLocalUser(localUser);
      return localUser;
    }
    const result = await signInAnonymously(auth);
    await updateProfile(result.user, { displayName });
    setUser({ ...result.user, displayName });
    return result.user;
  };

  const logout = () => {
    if (!isFirebaseConfigured) {
      setUser(null);
      persistLocalUser(null);
      return;
    }
    return signOut(auth);
  };

  const value = {
    user,
    loading,
    loginWithGoogle,
    loginAsGuest,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
