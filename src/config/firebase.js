const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const initFirebase = () => {
  try {
    // Path to the downloaded JSON key file in the root directory
    const serviceAccountPath = path.join(__dirname, '../../chatapp-19c40-firebase-adminsdk-fbsvc-f3f7776dd9.json');
    
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin SDK initialized successfully with JSON key.');
    } else {
      console.warn(`Firebase Admin SDK not initialized: Could not find key at ${serviceAccountPath}`);
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
  }
};

module.exports = { admin, initFirebase };
