# ChatApp Backend

This is the backend server for a real-time Chat and Video Calling application. It provides a REST API for authentication and user management, and a WebSocket server (using Socket.io) for real-time messaging, presence, and WebRTC signaling.

## Tech Stack

- **Node.js** & **Express**: Web framework for the REST API
- **MongoDB** & **Mongoose**: Database and ODM
- **Socket.io**: Real-time bidirectional event-based communication
- **Firebase Admin SDK**: Push notifications via FCM (Firebase Cloud Messaging)
- **JSON Web Tokens (JWT)**: Authentication

## Features

- **Authentication**: User registration and login using JWT.
- **Real-time Messaging**: Send and receive text messages instantly.
- **Message Status**: Support for message sent, delivered, and read receipts (double ticks, blue ticks).
- **Presence Status**: Real-time online/offline indicators for users.
- **Push Notifications**: Offline messages and incoming calls trigger Firebase push notifications.
- **WebRTC Signaling**: Socket events for WebRTC Offer, Answer, and ICE candidates to facilitate peer-to-peer video and audio calls.
- **Call Management**: Handles ringing, accepting, rejecting, and ending calls seamlessly.

## Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB instance (local or Atlas)
- Firebase Service Account Key (for push notifications)

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory and add the following environment variables:
   ```env
   PORT=3000
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret_key
   CALL_RING_TIMEOUT=30000
   ```

3. Add your Firebase service account credentials as required by the application.

### Running the Server

- **Development Mode** (with nodemon):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm start
  ```

## Socket Events Overview

The application utilizes two main socket modules:
- `chat.socket.js`: Handles messaging, user presence, read receipts, and typing indicators.
- `call.socket.js`: Handles call initiation, accepting/rejecting calls, and WebRTC signaling (offer/answer/ice-candidates).
