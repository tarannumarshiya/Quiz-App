// Firebase Configuration Template
// You can either paste your Firebase config here, or use the interactive setup screen in the UI.
export const FIREBASE_CONFIG_KEY = 'quiz_app_firebase_config';

export const fallbackConfig = {
  apiKey: "AIzaSyD_qfWWb5v-eE5CvshpXNuhOKQ1OcdGcOw",
  authDomain: "battlequiz-14c64.firebaseapp.com",
  databaseURL: "https://battlequiz-14c64-default-rtdb.firebaseio.com",
  projectId: "battlequiz-14c64",
  storageBucket: "battlequiz-14c64.firebasestorage.app",
  messagingSenderId: "1051698115808",
  appId: "1:1051698115808:web:5ce71a19bcf8c13fa18c85",
  measurementId: "G-7Q1ZVHM12F"
};


export function getFirebaseConfig() {
  const localConfig = localStorage.getItem(FIREBASE_CONFIG_KEY);
  if (localConfig) {
    try {
      return JSON.parse(localConfig);
    } catch (e) {
      console.error("Invalid Firebase config in localStorage", e);
    }
  }

  // If no localStorage config, check if fallbackConfig has been filled
  if (fallbackConfig.apiKey && fallbackConfig.databaseURL) {
    return fallbackConfig;
  }

  return null;
}

export function isFirebaseConfigured() {
  const config = getFirebaseConfig();
  return !!(config && config.apiKey && config.databaseURL);
}

export function saveFirebaseConfig(config) {
  localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(config));
}

export function clearFirebaseConfig() {
  localStorage.removeItem(FIREBASE_CONFIG_KEY);
  localStorage.removeItem('quiz_app_user');
}

export function initializeFirebaseApp() {
  if (!window.firebase) {
    console.error("Firebase SDK is not loaded. Ensure CDN scripts are properly imported in index.html");
    return null;
  }

  const config = getFirebaseConfig();
  if (!config) {
    console.warn("Firebase is not configured yet. Interactive setup wizard is required.");
    return null;
  }

  // Check if already initialized to prevent duplicate app errors
  if (window.firebase.apps.length > 0) {
    return window.firebase.app();
  }

  try {
    return window.firebase.initializeApp(config);
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    return null;
  }
}
