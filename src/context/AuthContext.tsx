import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isItManager: boolean;
  isPrimaryController: boolean;
  primaryControllerEmail: string | null;
  googleAccessToken: string | null;
  signInWithGoogle: () => Promise<string | null>;
  requestGoogleAccessToken: () => Promise<string | null>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SUPER_ADMIN_EMAIL = 'gfa437926@gmail.com';

// In-memory token storage (never in localStorage per security guidelines)
let inMemoryAccessToken: string | null = null;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [primaryControllerUid, setPrimaryControllerUid] = useState<string | null>(null);
  const [primaryControllerEmail, setPrimaryControllerEmail] = useState<string | null>(null);

  // Listen for system primary controller
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'system_settings', 'controller'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setPrimaryControllerUid(data.primaryUid || null);
          setPrimaryControllerEmail(data.primaryEmail || null);
        } else {
          setPrimaryControllerUid(null);
          setPrimaryControllerEmail(null);
        }
      },
      () => {
        // Ignore settings permission errors if any
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        inMemoryAccessToken = null;
        setGoogleAccessToken(null);
        setLoading(false);
        return;
      }

      try {
        // 1. Check or establish Primary Controller for the first user
        const controllerRef = doc(db, 'system_settings', 'controller');
        const controllerSnap = await getDoc(controllerRef);

        let isFirstController = false;
        if (!controllerSnap.exists()) {
          const controllerData = {
            primaryUid: currentUser.uid,
            primaryEmail: currentUser.email || '',
            registeredAt: new Date().toISOString(),
          };
          try {
            await setDoc(controllerRef, controllerData);
            isFirstController = true;
            setPrimaryControllerUid(currentUser.uid);
            setPrimaryControllerEmail(currentUser.email || '');
          } catch (e) {
            console.warn('Could not register controller doc:', e);
          }
        } else {
          const data = controllerSnap.data();
          setPrimaryControllerUid(data.primaryUid || null);
          setPrimaryControllerEmail(data.primaryEmail || null);
        }

        // 2. Fetch or create user profile
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setProfile(userSnap.data() as UserProfile);
        } else {
          const isSuperAdmin =
            currentUser.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() ||
            isFirstController;

          const newProfile: UserProfile = {
            uid: currentUser.uid,
            displayName:
              currentUser.displayName ||
              (currentUser.email ? currentUser.email.split('@')[0] : 'المتحكم بالمنظومة'),
            email: currentUser.email || '',
            // Only the designated super-admin / first controller receives admin access.
            // All other self-registered accounts start with the limited IT manager role.
            role: isSuperAdmin ? 'admin' : 'it_manager',
            isActive: true,
            createdAt: new Date().toISOString(),
          };

          await setDoc(userRef, newProfile);
          setProfile(newProfile);
        }
      } catch (err) {
        console.error('Error fetching user profile:', err);
        // Fail closed: a profile read/write failure must never grant admin UI access.
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (): Promise<string | null> => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      if (token) {
        inMemoryAccessToken = token;
        setGoogleAccessToken(token);
      }
      return token;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !msg.includes('popup-closed-by-user') &&
        !msg.includes('cancelled-popup-request') &&
        !msg.includes('popup-blocked')
      ) {
        console.error('Google Sign-in failed', err);
      }
      throw err;
    }
  };

  const requestGoogleAccessToken = async (): Promise<string | null> => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      if (token) {
        inMemoryAccessToken = token;
        setGoogleAccessToken(token);
      }
      return token;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !msg.includes('popup-closed-by-user') &&
        !msg.includes('cancelled-popup-request') &&
        !msg.includes('popup-blocked')
      ) {
        console.error('Re-auth for Google token failed', err);
      }
      throw err;
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const signUpWithEmail = async (email: string, pass: string, name: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (name && cred.user) {
      await updateProfile(cred.user, { displayName: name });
    }
  };

  const signOut = async () => {
    await fbSignOut(auth);
    inMemoryAccessToken = null;
    setGoogleAccessToken(null);
  };

  // Determine if the currently logged-in user is the Primary Controller
  const isPrimaryController =
    Boolean(user?.uid) &&
    (primaryControllerUid === user?.uid ||
      primaryControllerUid === null ||
      user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase());

  const isAdmin = profile?.role === 'admin' && profile?.isActive === true;
  const isItManager =
    (profile?.role === 'admin' || profile?.role === 'it_manager') && profile?.isActive === true;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAdmin,
        isItManager,
        isPrimaryController,
        primaryControllerEmail,
        googleAccessToken,
        signInWithGoogle,
        requestGoogleAccessToken,
        signInWithEmail,
        signUpWithEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
