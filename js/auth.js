import { initializeFirebaseApp } from './firebase-init.js';

class AuthService {
  constructor() {
    this.auth = null;
    this.db = null;
  }

  init() {
    const app = initializeFirebaseApp();
    if (app) {
      this.auth = window.firebase.auth();
      this.db = window.firebase.database();
    }
  }

  // Register a new user
  async register(email, password, username) {
    this.init();
    if (!this.auth) throw new Error("Firebase is not configured yet.");

    try {
      // Create user in Firebase Auth
      const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // Update Firebase Auth profile display name
      await user.updateProfile({ displayName: username });

      // Save initial profile details in Realtime Database
      await this.db.ref(`users/${user.uid}`).set({
        uid: user.uid,
        username: username,
        email: email,
        createdAt: window.firebase.database.ServerValue.TIMESTAMP,
        totalQuizzesTaken: 0,
        totalScore: 0
      });

      return user;
    } catch (error) {
      console.error("Registration failed:", error);
      throw this.formatError(error);
    }
  }

  // Login existing user
  async login(email, password) {
    this.init();
    if (!this.auth) throw new Error("Firebase is not configured yet.");

    try {
      const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
      return userCredential.user;
    } catch (error) {
      console.error("Login failed:", error);
      throw this.formatError(error);
    }
  }

  // Login with Google Provider
  async loginWithGoogle() {
    this.init();
    if (!this.auth) throw new Error("Firebase is not configured yet.");

    try {
      const provider = new window.firebase.auth.GoogleAuthProvider();
      const userCredential = await this.auth.signInWithPopup(provider);
      const user = userCredential.user;

      // Check if user already exists in Realtime Database
      const profile = await this.getUserProfile(user.uid);
      if (!profile) {
        // Save initial profile details in Realtime Database for new Google Auth users
        await this.db.ref(`users/${user.uid}`).set({
          uid: user.uid,
          username: user.displayName || "Google Player",
          email: user.email || "",
          createdAt: window.firebase.database.ServerValue.TIMESTAMP,
          totalQuizzesTaken: 0,
          totalScore: 0
        });
      }

      return user;
    } catch (error) {
      console.error("Google login failed:", error);
      throw this.formatError(error);
    }
  }

  // Logout user
  async logout() {
    this.init();
    if (this.auth) {
      await this.auth.signOut();
    }
  }

  // Set up auth state change observer
  onAuthStateChanged(callback) {
    this.init();
    if (!this.auth) {
      // Return a dummy unsubscribe if not configured yet
      return () => {};
    }
    return this.auth.onAuthStateChanged(callback);
  }

  // Helper to fetch user details from database
  async getUserProfile(uid) {
    this.init();
    if (!this.db) return null;
    try {
      const snapshot = await this.db.ref(`users/${uid}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error("Failed to fetch user profile:", error);
      return null;
    }
  }

  // Format Firebase auth errors for human display
  formatError(error) {
    switch (error.code) {
      case 'auth/email-already-in-use':
        return new Error("This email is already registered. Try logging in instead.");
      case 'auth/invalid-email':
        return new Error("Please enter a valid email address.");
      case 'auth/weak-password':
        return new Error("Your password should be at least 6 characters long.");
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return new Error("Invalid email or password. Please try again.");
      case 'auth/network-request-failed':
        return new Error("Network error. Please check your internet connection.");
      default:
        return new Error(error.message || "An unexpected error occurred.");
    }
  }
}

export const authService = new AuthService();