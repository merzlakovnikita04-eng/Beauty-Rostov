import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyASQv1WHkJoU1uE4uipil-SG_XIrjvbhWU",
  authDomain: "beauty-rostov.firebaseapp.com",
  projectId: "beauty-rostov",
  storageBucket: "beauty-rostov.firebasestorage.app",
  messagingSenderId: "998841628217",
  appId: "1:998841628217:web:08c3722e377503c6b4bfe8"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const CLOUDINARY = {
  cloudName: "whrxpqma",
  uploadPreset: "beauty_unsigned",
  folder: "masters"
};
