import React, { createContext, useContext, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithCredential,
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

        let isControllerAccount = false;
        if (!controllerSnap.exists()) {
          const controllerData = {
            primaryUid: currentUser.uid,
            primaryEmail: currentUser.email || '',
            registeredAt: new Date().toISOString(),
          };
          try {
            await setDoc(controllerRef, controllerData);
            isControllerAccount = true;
            setPrimaryControllerUid(currentUser.uid);
            setPrimaryControllerEmail(currentUser.email || '');
          } catch (e) {
            console.warn('Could not register controller doc:', e);
          }
        } else {
          const data = controllerSnap.data();
          setPrimaryControllerUid(data.primaryUid || null);
          setPrimaryControllerEmail(data.primaryEmail || null);
          isControllerAccount = data.primaryUid === currentUser.uid;
        }

        // 2. Fetch or create user profile
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setProfile(userSnap.data() as UserProfile);
        } else {
          const newProfile: UserProfile = {
            uid: currentUser.uid,
            displayName:
              currentUser.displayName ||
              (currentUser.email ? currentUser.email.split('@')[0] : 'المتحكم بالمنظومة'),
            email: currentUser.email || '',
            // Only the immutable primary-controller UID receives the admin role.
            // All other self-registered accounts start with the limited IT manager role.
            role: isControllerAccount ? 'admin' : 'it_manager',
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
      let token: string | null = null;
      if (Capacitor.isNativePlatform()) {
        const nativeResult = await FirebaseAuthentication.signInWithGoogle();
        const idToken = nativeResult.credential?.idToken;
        if (!idToken) throw new Error('لم يُرجع Google رمز الهوية. تحقق من إعداد SHA-1 وملف google-services.json.');
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);

        // The native plugin's access token may contain only basic sign-in scopes.
        // Never expose it to Google Sheets/Drive API calls as if it had the
        // additional OAuth scopes requested by googleProvider.
        token = null;
        inMemoryAccessToken = null;
        setGoogleAccessToken(null);
      } else {
        const result = await signInWithPopup(auth, googleProvider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        token = credential?.accessToken || null;
      }
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
    // Firebase's native Google sign-in authenticates the user, but it does not
    // guarantee the additional Sheets/Drive OAuth scopes requested by googleProvider.
    // Never return an unverified token and let the Sheets integration fail later.
    if (Capacitor.isNativePlatform()) {
      throw new Error(
        'تسجيل الدخول عبر Google يعمل على Android، لكن منح صلاحيات Google Sheets وDrive يحتاج موافقة OAuth إضافية. استخدم نسخة الويب لهذه العملية حالياً.'
      );
    }

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      if (!token) {
        throw new Error('لم يتم الحصول على رمز وصول Google. أعد تسجيل الدخول ووافق على صلاحيات Sheets وDrive.');
      }
      inMemoryAccessToken = token;
      setGoogleAccessToken(token);
      return token;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !msg.includes('popup-closed-by-user') &&
        !msg.includes('cancelled-popup-request') &&
        !msg.includes('popup-blocked')
      ) {
        console.error('Re-auth for Google API access failed', err);
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
    if (Capacitor.isNativePlatform()) {
      await FirebaseAuthentication.signOut().catch((error) => {
        console.warn('Native Firebase sign-out failed:', error);
      });
    }
    await fbSignOut(auth);
    inMemoryAccessToken = null;
    setGoogleAccessToken(null);
  };

  // The controller identity in Firestore is the single source of truth.
  // A matching email alone must not bypass a controller UID already registered
  // for another account; this mirrors the Firestore isPrimaryController rule.
  const isPrimaryController =
    Boolean(user?.uid) && primaryControllerUid === user?.uid;

  // Admin-only UI follows the immutable controller UID, not a mutable profile role.
  const isAdmin = isPrimaryController && profile?.isActive === true;
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
