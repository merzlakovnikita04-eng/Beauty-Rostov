import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { auth, db, googleProvider } from "./firebase-config.js";

setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn("Не удалось включить persistence:", err);
});

export const session = {
  user: null,
  profile: null,
  ready: false
};

const listeners = new Set();
export function onSessionChange(fn) {
  listeners.add(fn);
  if (session.ready) fn(session);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach(fn => fn(session));
}

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logout() {
  await signOut(auth);
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function createUserProfile(user, role) {
  const userRef = doc(db, "users", user.uid);
  const existing = await getDoc(userRef);
  
  if (existing.exists()) {
    return existing.data();
  }

  const profile = {
    role,
    name: user.displayName || "",
    email: user.email || "",
    photoUrl: user.photoURL || "",
    createdAt: serverTimestamp()
  };

  await setDoc(userRef, profile);
  return profile;
}

onAuthStateChanged(auth, async (user) => {
  session.user = user;

  if (user) {
    try {
      session.profile = await getUserProfile(user.uid);
    } catch (err) {
      console.error("Ошибка чтения профиля:", err);
      session.profile = null;
    }
  } else {
    session.profile = null;
  }

  session.ready = true;
  emit();
});
