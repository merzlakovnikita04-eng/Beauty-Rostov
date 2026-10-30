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
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { auth, db, googleProvider } from "./firebase-config.js";

export const FREE_MASTERS_LIMIT = 50;

const STATS_COLLECTION = "stats";
const STATS_DOC = "masters_counter";
const STATS_FIELD = "freeUsed";

const ALLOWED_ROLES = new Set(["client", "master"]);

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

export async function getFreeUsed() {
  try {
    const snap = await getDoc(doc(db, STATS_COLLECTION, STATS_DOC));
    if (!snap.exists()) return 0;
    return snap.data()[STATS_FIELD] || 0;
  } catch (err) {
    console.error("Ошибка чтения счётчика:", err);
    return 0;
  }
}

async function reserveFreeSlot() {
  const counterRef = doc(db, STATS_COLLECTION, STATS_DOC);

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data()[STATS_FIELD] || 0) : 0;

    if (current >= FREE_MASTERS_LIMIT) {
      return { granted: false, used: current };
    }

    const next = current + 1;
    tx.set(
      counterRef,
      { [STATS_FIELD]: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return { granted: true, used: next };
  });
}

export async function createUserProfile(user, role) {
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error("Недопустимая роль: " + role);
  }

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

  if (role === "master") {
    const { granted } = await reserveFreeSlot();
    if (granted) {
      profile.subscriptionStatus = "free";
      profile.subscriptionSince = serverTimestamp();
    } else {
      profile.subscriptionStatus = "pending";
    }
  }

  await setDoc(userRef, profile, { merge: true });
  return profile;
}

export async function ensureMasterSubscription(uid) {
  const userRef = doc(db, "users", uid);
  const counterRef = doc(db, STATS_COLLECTION, STATS_DOC);

  return await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) return null;

    const data = userSnap.data();
    if (data.role !== "master") return data;
    if (data.subscriptionStatus) return data;

    const counterSnap = await tx.get(counterRef);
    const current = counterSnap.exists() ? (counterSnap.data()[STATS_FIELD] || 0) : 0;
    const granted = current < FREE_MASTERS_LIMIT;

    if (granted) {
      tx.set(
        counterRef,
        { [STATS_FIELD]: current + 1, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }

    const status = granted ? "free" : "pending";
    tx.set(
      userRef,
      { subscriptionStatus: status, subscriptionSince: serverTimestamp() },
      { merge: true }
    );

    return { ...data, subscriptionStatus: status };
  });
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
