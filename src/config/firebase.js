const { initializeApp, cert } = require('firebase-admin/app');
const path = require('path');
const fs = require('fs');

const initFirebase = () => {
  try {
    const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    
    if (envKey) {
      const serviceAccount = JSON.parse(envKey);
      initializeApp({
        credential: cert(serviceAccount)
      });
      console.log('Firebase Admin SDK initialized successfully via Environment Variable.');
    } else {
      console.warn('Firebase Admin SDK not initialized: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is missing.');
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
  }
};

module.exports = { initFirebase };
