const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors({ origin: 'https://your-frontend-url.onrender.com' }));
app.use(express.static(path.join(__dirname)));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Server State
const waitingQueue = []; // Users waiting for a partner
const partnerships = new Map(); // Tracks who is connected to whom
const userRooms = new Map(); // Tracks which room each user is in

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // When user clicks start button
  socket.on('startChat', () => {
    // Remove from any existing partnership first (cleanup)
    handleDisconnection(socket.id, false);
    
    // Add to waiting queue
    if (!waitingQueue.includes(socket.id)) {
      waitingQueue.push(socket.id);
      socket.emit('waitingForPartner');
      console.log(`User ${socket.id} added to waiting queue`);
    }
    
    tryToMatchUsers();
  });

  // When user clicks Next button
  socket.on('nextPartner', () => {
    console.log(`User ${socket.id} requested next partner`);
    handleDisconnection(socket.id, true);
  });

  // When user clicks Stop button  
  socket.on('stopChat', () => {
    console.log(`User ${socket.id} stopped chat`);
    handleDisconnection(socket.id, false);
  });

  // WebRTC Signaling handlers
  socket.on('offer', (data) => {
    console.log(`Offer from ${socket.id} to ${data.to}`);
    socket.to(data.to).emit('offer', { 
      offer: data.offer, 
      from: socket.id 
    });
  });

  socket.on('answer', (data) => {
    console.log(`Answer from ${socket.id} to ${data.to}`);
    socket.to(data.to).emit('answer', { 
      answer: data.answer, 
      from: socket.id 
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.to).emit('ice-candidate', { 
      candidate: data.candidate, 
      from: socket.id 
    });
  });

  // When user disconnects (closes tab/browser)
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    handleDisconnection(socket.id, false);
  });
});

// Core matching function
function tryToMatchUsers() {
  while (waitingQueue.length >= 2) {
    const user1 = waitingQueue.shift();
    const user2 = waitingQueue.shift();
    
    // Check if both users are still connected
    const user1Socket = io.sockets.sockets.get(user1);
    const user2Socket = io.sockets.sockets.get(user2);
    
    if (!user1Socket || !user2Socket) {
      // Put back any still-connected users
      if (user1Socket) waitingQueue.unshift(user1);
      if (user2Socket) waitingQueue.unshift(user2);
      continue;
    }
    
    // Create room and connect users
    const roomName = `room_${user1}_${user2}`;
    user1Socket.join(roomName);
    user2Socket.join(roomName);
    
    // Store partnership info
    partnerships.set(user1, user2);
    partnerships.set(user2, user1);
    userRooms.set(user1, roomName);
    userRooms.set(user2, roomName);
    
    // Notify users
    user1Socket.emit('partnerFound', {partnerId: user2});
    user2Socket.emit('partnerFound', {partnerId: user1});
    
    console.log(`Matched ${user1} with ${user2} in room ${roomName}`);
  }
}

// Proper disconnection handler
function handleDisconnection(socketId, addToQueue) {
  const partnerId = partnerships.get(socketId);
  
  // Notify partner if they exist
  if (partnerId) {
    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket) {
      partnerSocket.emit('partnerDisconnected');
      // Clean up partner's state
      partnerships.delete(partnerId);
      userRooms.delete(partnerId);
      
      // Add partner to queue if requested
      if (addToQueue && !waitingQueue.includes(partnerId)) {
        waitingQueue.push(partnerId);
        partnerSocket.emit('waitingForPartner');
      }
    }
  }
  
  // Clean up user's state
  partnerships.delete(socketId);
  userRooms.delete(socketId);
  
  // Remove from waiting queue
  const queueIndex = waitingQueue.indexOf(socketId);
  if (queueIndex > -1) {
    waitingQueue.splice(queueIndex, 1);
  }
  
  // Add back to queue if requested
  if (addToQueue && !waitingQueue.includes(socketId)) {
    waitingQueue.push(socketId);
    const userSocket = io.sockets.sockets.get(socketId);
    if (userSocket) userSocket.emit('waitingForPartner');
  }
  
  console.log(`User ${socketId} disconnected, partner notified: ${!!partnerId}`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});