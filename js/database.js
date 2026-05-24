import { initializeFirebaseApp } from './firebase-init.js';

class DatabaseService {
  constructor() {
    this.db = null;
  }

  init() {
    const app = initializeFirebaseApp();
    if (app) {
      this.db = window.firebase.database();
    }
  }

  // Generates a unique 6-character alphanumeric code e.g. QZ-A93B
  async generateUniqueQuizId() {
    this.init();
    if (!this.db) throw new Error("Firebase is not configured.");

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Clean character pool
    let quizId = '';
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      attempts++;
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      quizId = `QZ-${code}`;

      // Check if this ID already exists
      const snapshot = await this.db.ref(`quizzes/${quizId}`).once('value');
      if (!snapshot.exists()) {
        isUnique = true;
      }
    }

    if (!isUnique) {
      throw new Error("Failed to generate a unique Quiz ID. Please try again.");
    }

    return quizId;
  }

  // Save quiz details
  async saveQuiz(quizData, user) {
    this.init();
    if (!this.db) throw new Error("Firebase is not configured.");

    try {
      const quizId = await this.generateUniqueQuizId();
      
      const quizPayload = {
        id: quizId,
        title: quizData.title,
        description: quizData.description || "",
        genre: quizData.genre,
        timeLimit: parseInt(quizData.timeLimit) || 30, // in seconds per question
        createdAt: window.firebase.database.ServerValue.TIMESTAMP,
        creatorUid: user.uid,
        creatorName: user.displayName || "Anonymous Creator",
        questions: quizData.questions // Array of { questionText, options: [], correctOption: 0-3 }
      };

      await this.db.ref(`quizzes/${quizId}`).set(quizPayload);
      return quizId;
    } catch (error) {
      console.error("Failed to save quiz:", error);
      throw error;
    }
  }

  // Fetch quiz by ID
  async getQuiz(quizId) {
    this.init();
    if (!this.db) throw new Error("Firebase is not configured.");

    try {
      const formattedId = quizId.trim().toUpperCase();
      const snapshot = await this.db.ref(`quizzes/${formattedId}`).once('value');
      
      if (!snapshot.exists()) {
        throw new Error("Quiz not found! Please check the ID and try again.");
      }

      return snapshot.val();
    } catch (error) {
      console.error("Failed to fetch quiz:", error);
      throw error;
    }
  }

  // Save quiz attempt
  async saveAttempt(quizId, quizTitle, genre, score, totalQuestions, user) {
    this.init();
    if (!this.db) throw new Error("Firebase is not configured.");

    try {
      const attemptId = this.db.ref('attempts').push().key;
      const percentage = Math.round((score / totalQuestions) * 100);
      
      const attemptPayload = {
        id: attemptId,
        quizId: quizId,
        quizTitle: quizTitle,
        genre: genre,
        uid: user.uid,
        username: user.displayName || "Anonymous Player",
        score: score,
        totalQuestions: totalQuestions,
        percentage: percentage,
        timestamp: window.firebase.database.ServerValue.TIMESTAMP
      };

      // 1. Write the attempt record
      await this.db.ref(`attempts/${attemptId}`).set(attemptPayload);
      
      // 2. Also record in user's nested attempt list for quick lookups
      await this.db.ref(`users/${user.uid}/attempts/${attemptId}`).set(attemptPayload);

      // 3. Update aggregate stats in users/{uid} using a database transaction
      const userRef = this.db.ref(`users/${user.uid}`);
      await userRef.transaction((currentData) => {
        if (currentData) {
          currentData.totalQuizzesTaken = (currentData.totalQuizzesTaken || 0) + 1;
          currentData.totalScore = (currentData.totalScore || 0) + score;
        }
        return currentData;
      });

      return attemptId;
    } catch (error) {
      console.error("Failed to save attempt:", error);
      throw error;
    }
  }

  // Listen to leaderboard real-time changes for a specific quiz
  listenToQuizLeaderboard(quizId, callback) {
    this.init();
    if (!this.db) return () => {};

    const attemptsRef = this.db.ref('attempts');
    // Fetch attempts for this quiz
    const query = attemptsRef.orderByChild('quizId').equalTo(quizId);
    
    const listener = query.on('value', (snapshot) => {
      const attempts = [];
      snapshot.forEach((childSnapshot) => {
        attempts.push(childSnapshot.val());
      });
      
      // Sort attempts by percentage descending, then by timestamp ascending (faster gets higher rank)
      attempts.sort((a, b) => {
        if (b.percentage !== a.percentage) {
          return b.percentage - a.percentage;
        }
        return a.timestamp - b.timestamp;
      });

      // Filter out duplicate attempts by same user, keeping only their highest score
      const uniqueLeaderboard = [];
      const seenUsers = new Set();
      for (const attempt of attempts) {
        if (!seenUsers.has(attempt.uid)) {
          seenUsers.add(attempt.uid);
          uniqueLeaderboard.push(attempt);
        }
      }

      callback(uniqueLeaderboard);
    });

    // Return unsubscribe function
    return () => query.off('value', listener);
  }

  // Fetch all quiz attempts by a specific user for personal graphs
  async getUserAttempts(uid) {
    this.init();
    if (!this.db) return [];

    try {
      const snapshot = await this.db.ref(`users/${uid}/attempts`).once('value');
      const attempts = [];
      snapshot.forEach((childSnapshot) => {
        attempts.push(childSnapshot.val());
      });
      
      // Sort chronologically (oldest to newest)
      attempts.sort((a, b) => a.timestamp - b.timestamp);
      return attempts;
    } catch (error) {
      console.error("Failed to get user attempts:", error);
      return [];
    }
  }

  // Get global users list (for global leaderboard display)
  async getGlobalLeaderboard() {
    this.init();
    if (!this.db) return [];

    try {
      const snapshot = await this.db.ref('users').once('value');
      const users = [];
      snapshot.forEach((childSnapshot) => {
        const u = childSnapshot.val();
        users.push({
          uid: u.uid,
          username: u.username,
          totalQuizzesTaken: u.totalQuizzesTaken || 0,
          totalScore: u.totalScore || 0,
          // Calculate average score if they've taken quizzes
          averageScore: u.totalQuizzesTaken ? Math.round((u.totalScore / u.totalQuizzesTaken) * 10) / 10 : 0
        });
      });

      // Sort by averageScore descending, then totalQuizzesTaken descending
      users.sort((a, b) => {
        if (b.totalScore !== a.totalScore) {
          return b.totalScore - a.totalScore;
        }
        return b.totalQuizzesTaken - a.totalQuizzesTaken;
      });

      return users; // Return all sorted players to allow complete client-side searching/filtering
    } catch (error) {
      console.error("Failed to get global leaderboard:", error);
      return [];
    }
  }
}

export const dbService = new DatabaseService();
