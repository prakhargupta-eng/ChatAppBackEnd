const Call = require('../models/call.model');
const User = require('../models/user.model');
const { getMessaging } = require('firebase-admin/messaging');
const { connectedUsers } = require('./chat.socket');
const crypto = require('crypto');

const CALL_RING_TIMEOUT = parseInt(process.env.CALL_RING_TIMEOUT) || 30000;
const callTimeouts = new Map();

const initCallSocket = (io) => {
  io.on('connection', (socket) => {
    
    // We expect socket.userId to be set by the middleware
    const currentUserId = String(socket.userId);
    
    // 1. Initiate Call
    socket.on('call:initiate', async (data) => {
      try {
        const { receiverId, callType } = data;
        
        if (!receiverId || !callType) return;
        if (currentUserId === String(receiverId)) return; // Can't call self

        const receiverIdStr = String(receiverId);

        // Check if receiver exists
        const receiver = await User.findById(receiverIdStr);
        if (!receiver) return;

        // Check if receiver is busy (has a ringing/connected call)
        const activeCall = await Call.findOne({
          $or: [{ callerId: receiverIdStr }, { receiverId: receiverIdStr }],
          status: { $in: ['ringing', 'connected'] }
        });

        if (activeCall) {
          return socket.emit('call:busy', { receiverId: receiverIdStr });
        }

        const callId = `call_${crypto.randomUUID()}`;
        
        // Create MongoDB record
        const newCall = new Call({
          callId,
          callerId: currentUserId,
          receiverId: receiverIdStr,
          callType,
          status: 'ringing'
        });
        await newCall.save();

        // Get Caller Data to send callerName
        const caller = await User.findById(currentUserId);
        const callerName = caller ? caller.username : 'Unknown';

        const payload = {
          callId,
          callerId: currentUserId,
          callerName,
          receiverId: receiverIdStr,
          callType,
          status: 'ringing'
        };

        // Notify Receiver via Sockets if online
        const targetSockets = connectedUsers.get(receiverIdStr);
        let receiverIsOnline = false;

        if (targetSockets && targetSockets.size > 0) {
          targetSockets.forEach(sockId => {
            io.to(sockId).emit('call:incoming', payload);
            receiverIsOnline = true;
          });
        }

        // Send FCM if offline (or even if online, for background push)
        if (receiver.fcmToken) {
          try {
            await getMessaging().send({
              token: receiver.fcmToken,
              notification: {
                title: 'Incoming Call',
                body: `${callerName} is calling you via ${callType}`
              },
              data: {
                type: 'incoming_call',
                callId: callId,
                callerId: currentUserId,
                callerName,
                callType: callType
              }
            });
          } catch (e) {
            console.error('Failed to send FCM for call', e);
            if (e.code === 'messaging/registration-token-not-registered') {
              // The token is dead/expired. Remove it from the database so we stop attempting.
              User.findByIdAndUpdate(receiverIdStr, { $unset: { fcmToken: "" } })
                .then(() => console.log(`Removed dead FCM token for user ${receiverIdStr}`))
                .catch(err => console.error('Failed to remove dead FCM token:', err));
            }
          }
        }

        // Set Timeout for Ringing
        const timeout = setTimeout(async () => {
          // If still ringing, mark as missed
          const callCheck = await Call.findOne({ callId });
          if (callCheck && callCheck.status === 'ringing') {
            callCheck.status = 'missed';
            await callCheck.save();
            
            // Forcefully emit call:end to BOTH parties so the UI cuts the call entirely
            const callerSockets = connectedUsers.get(String(callCheck.callerId));
            const receiverSockets = connectedUsers.get(String(callCheck.receiverId));

            if (callerSockets) {
              callerSockets.forEach(sockId => io.to(sockId).emit('call:end', { callId }));
            }
            if (receiverSockets) {
              receiverSockets.forEach(sockId => io.to(sockId).emit('call:end', { callId }));
            }
          }
          callTimeouts.delete(callId);
        }, CALL_RING_TIMEOUT);

        callTimeouts.set(callId, timeout);

      } catch (err) {
        console.error('Error initiating call:', err);
      }
    });

    // 2. Accept Call
    socket.on('call:accept', async (data) => {
      try {
        const { callId } = data;
        const call = await Call.findOne({ callId });
        
        if (!call) return;
        if (String(call.receiverId) !== currentUserId) return; // Only receiver can accept
        if (call.status !== 'ringing') return; // Must be ringing

        call.status = 'accepted';
        call.answeredAt = new Date();
        await call.save();

        // Clear timeout
        if (callTimeouts.has(callId)) {
          clearTimeout(callTimeouts.get(callId));
          callTimeouts.delete(callId);
        }

        // Notify caller
        const callerSockets = connectedUsers.get(String(call.callerId));
        if (callerSockets) {
          callerSockets.forEach(sockId => {
            io.to(sockId).emit('call:accepted', { callId, receiverId: currentUserId });
          });
        }
      } catch (err) {
        console.error('Error accepting call:', err);
      }
    });

    // 3. Reject Call
    socket.on('call:reject', async (data) => {
      try {
        const { callId } = data;
        const call = await Call.findOne({ callId });
        if (!call || String(call.receiverId) !== currentUserId) return;
        
        call.status = 'rejected';
        await call.save();

        if (callTimeouts.has(callId)) {
          clearTimeout(callTimeouts.get(callId));
          callTimeouts.delete(callId);
        }

        const callerSockets = connectedUsers.get(String(call.callerId));
        if (callerSockets) {
          callerSockets.forEach(sockId => {
            io.to(sockId).emit('call:reject', { callId });
          });
        }
      } catch (err) {}
    });

    // 4. Cancel Call (Caller cancels before answer)
    socket.on('call:cancel', async (data) => {
      try {
        const { callId } = data;
        const call = await Call.findOne({ callId });
        if (!call || String(call.callerId) !== currentUserId) return;
        if (call.status !== 'ringing') return;

        call.status = 'cancelled';
        await call.save();

        if (callTimeouts.has(callId)) {
          clearTimeout(callTimeouts.get(callId));
          callTimeouts.delete(callId);
        }

        const receiverSockets = connectedUsers.get(String(call.receiverId));
        if (receiverSockets) {
          receiverSockets.forEach(sockId => {
            io.to(sockId).emit('call:cancel', { callId });
          });
        }
      } catch (err) {}
    });

    // 5. Call Connected (WebRTC established)
    socket.on('call:connected', async (data) => {
      console.log(`[CALL] call:connected event received. Data frame:`, JSON.stringify(data, null, 2));
      try {
        const { callId } = data;
        const call = await Call.findOne({ callId });
        
        if (!call) {
          console.log(`[CALL] Call not found for callId: ${callId}`);
          return;
        }

        if (String(call.callerId) !== currentUserId && String(call.receiverId) !== currentUserId) {
          console.log(`[CALL] Unauthorized attempt to connect call by user: ${currentUserId}`);
          return;
        }

        // Ensure we only mark connected once
        if (call.status === 'accepted') {
          call.status = 'connected';
          call.startedAt = new Date();
          await call.save();
          console.log(`[CALL] Call successfully established (status updated to 'connected') for callId: ${callId}`);
        } else {
          console.log(`[CALL] Call already established or in invalid state (current status: ${call.status}) for callId: ${callId}`);
        }
      } catch (err) {
        console.error(`[CALL] Error establishing call:`, err);
      }
    });

    // 6. End Call
    socket.on('call:end', async (data) => {
      try {
        const { callId } = data;
        const call = await Call.findOne({ callId });
        if (!call) return;
        
        const callerStr = String(call.callerId);
        const receiverStr = String(call.receiverId);
        
        if (callerStr !== currentUserId && receiverStr !== currentUserId) return;

        if (['ringing', 'accepted', 'connected'].includes(call.status)) {
          call.status = 'ended';
          call.endedAt = new Date();
          if (call.startedAt) {
            call.duration = Math.floor((call.endedAt - call.startedAt) / 1000);
          }
          await call.save();
        }

        // Notify other participant
        const otherUserId = callerStr === currentUserId ? receiverStr : callerStr;
        const otherSockets = connectedUsers.get(otherUserId);
        if (otherSockets) {
          otherSockets.forEach(sockId => {
            io.to(sockId).emit('call:end', { callId });
          });
        }
      } catch (err) {}
    });

    // ==========================================
    // WebRTC Signaling
    // ==========================================

    socket.on('webrtc:offer', async (data) => {
      const { callId, offer } = data;
      const call = await Call.findOne({ callId });
      if (!call) return;
      if (String(call.callerId) !== currentUserId && String(call.receiverId) !== currentUserId) return;

      const targetId = data.receiverId || (String(call.callerId) === currentUserId ? String(call.receiverId) : String(call.callerId));
      console.log('[WEBRTC] Offer Received', { from: currentUserId, to: targetId });

      const targetSockets = connectedUsers.get(targetId);
      if (targetSockets) {
        targetSockets.forEach(sockId => {
          io.to(sockId).emit('webrtc:offer', { callId, offer, callerId: currentUserId });
        });
      }
    });

    socket.on('webrtc:answer', async (data) => {
      const { callId, answer } = data;
      const call = await Call.findOne({ callId });
      if (!call) return;
      if (String(call.callerId) !== currentUserId && String(call.receiverId) !== currentUserId) return;

      const targetId = data.receiverId || (String(call.callerId) === currentUserId ? String(call.receiverId) : String(call.callerId));
      console.log('[WEBRTC] Answer Received', { from: currentUserId, to: targetId });

      const targetSockets = connectedUsers.get(targetId);
      if (targetSockets) {
        targetSockets.forEach(sockId => {
          io.to(sockId).emit('webrtc:answer', { callId, answer, responderId: currentUserId });
        });
      }
    });

    socket.on('webrtc:ice-candidate', async (data) => {
      const { callId, candidate } = data;
      let targetId = data.receiverId;
      
      if (!targetId) {
        const call = await Call.findOne({ callId });
        if (call) {
          targetId = String(call.callerId) === currentUserId ? String(call.receiverId) : String(call.callerId);
        }
      }

      console.log('[WEBRTC] ICE Candidate Received', { from: currentUserId, to: targetId });
      if (!targetId) return;

      const targetSockets = connectedUsers.get(targetId);
      if (targetSockets) {
        targetSockets.forEach(sockId => {
          io.to(sockId).emit('webrtc:ice-candidate', { callId, candidate, senderId: currentUserId });
        });
      }
    });

  });
};

module.exports = { initCallSocket };
