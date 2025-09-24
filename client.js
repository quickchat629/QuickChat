// Initialize Socket.IO connection
const socket = io(window.location.origin);

// DOM elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const nextBtn = document.getElementById('nextBtn');
const statusText = document.getElementById('status');
const localVideoStatus = document.getElementById('localVideoStatus');
const remoteVideoStatus = document.getElementById('remoteVideoStatus');

// WebRTC variables
const constraints = { 
    video: { 
        width: { ideal: 1280 }, 
        height: { ideal: 720 } 
    }, 
    audio: true 
};
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let partnerSocketId = null;
let isChatActive = false;

// STUN servers for NAT traversal with fallback TURN servers
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 10
};

// Set up button event listeners
toggleChatBtn.addEventListener('click', () => {
    if (!isChatActive) {
        // Start chat
        toggleChatBtn.disabled = true;
        toggleChatBtn.textContent = "Start";
        statusText.textContent = 'Connecting...';
        statusText.className = 'status waiting';
        socket.emit('startChat');
    } else {
        // Stop chat
        stopChat();
        socket.emit('stopChat');
    }
});

nextBtn.addEventListener('click', () => {
    handleNextPartner();
});

// Function to handle next partner request
async function handleNextPartner() {
    try {
        // Disable next button to prevent multiple clicks
        nextBtn.disabled = true;
        statusText.textContent = 'Looking for next partner...';
        statusText.className = 'status waiting';
        
        // Clean up existing connection properly
        cleanupWebRTC();
        
        // Emit next partner request
        socket.emit('nextPartner');
        
    } catch (error) {
        console.error('Error handling next partner:', error);
        statusText.textContent = 'Error switching partners';
        statusText.className = 'status disconnected';
        nextBtn.disabled = false;
    }
}

// Function to clean up WebRTC connection
function cleanupWebRTC() {
    if (peerConnection) {
        // Remove all event listeners to prevent memory leaks
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onnegotiationneeded = null;
        
        // Close the connection
        peerConnection.close();
        peerConnection = null;
    }
    
    // Clear remote video but keep local stream
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }
    remoteVideoStatus.textContent = 'No connection';
    partnerSocketId = null;
}

// Function to stop chat and clean up completely
function stopChat() {
    isChatActive = false;
    toggleChatBtn.textContent = "Start";
    toggleChatBtn.classList.remove('stop-mode');
    
    cleanupWebRTC();
    
    // Also stop local stream when stopping completely
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localVideo.srcObject = null;
        localVideoStatus.textContent = 'Camera off';
    }
    
    toggleChatBtn.disabled = false;
    nextBtn.disabled = true;
    statusText.textContent = 'Disconnected - Click Start to begin';
    statusText.className = 'status disconnected';
    remoteVideoStatus.textContent = 'No connection';
}

// Function to start the media and initialize WebRTC
async function startWebRTC() {
    try {
        // Get the user's camera and microphone
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        // Display your own video
        localVideo.srcObject = localStream;
        localVideoStatus.textContent = 'Camera on';
        
        return true;
    } catch (error) {
        console.error('Error accessing media devices.', error);
        statusText.textContent = 'Error accessing camera/microphone: ' + error.message;
        statusText.className = 'status disconnected';
        toggleChatBtn.disabled = false;
        nextBtn.disabled = true;
        return false;
    }
}

// Function to create and set up the PeerConnection
function createPeerConnection() {
    // Clean up any existing connection first
    if (peerConnection) {
        cleanupWebRTC();
    }
    
    // Create an RTCPeerConnection
    peerConnection = new RTCPeerConnection(configuration);

    // Add our local stream to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // When we receive a remote stream, display it
    peerConnection.ontrack = (event) => {
        console.log('Received remote stream');
        if (event.streams && event.streams[0]) {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
            remoteVideoStatus.textContent = 'Connected';
            statusText.textContent = 'Connected';
            statusText.className = 'status connected';
            
            // Re-enable next button when connected
            nextBtn.disabled = false;
        }
    };

    // When the ICE agent needs to send a candidate to the other peer
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && partnerSocketId) {
            // Send the candidate to the partner via Socket.io
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                to: partnerSocketId
            });
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = (event) => {
        console.log('Connection state:', peerConnection.connectionState);
        switch(peerConnection.connectionState) {
            case 'connected':
                statusText.textContent = 'Connected';
                statusText.className = 'status connected';
                nextBtn.disabled = false;
                break;
            case 'disconnected':
                statusText.textContent = 'Connection lost';
                statusText.className = 'status disconnected';
                nextBtn.disabled = false;
                break;
            case 'failed':
                statusText.textContent = 'Connection failed';
                statusText.className = 'status disconnected';
                nextBtn.disabled = false;
                break;
            case 'closed':
                statusText.textContent = 'Connection closed';
                statusText.className = 'status disconnected';
                nextBtn.disabled = false;
                break;
        }
    };

    // Handle ICE connection state changes
    peerConnection.oniceconnectionstatechange = (event) => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
            // Try to restart ICE
            peerConnection.restartIce();
        }
    };
}

// Socket event handlers

// When we are connected to a partner, start the process
socket.on('partnerFound', async (data) => {
    partnerSocketId = data.partnerId;
    statusText.textContent = 'Setting up connection...';
    statusText.className = 'status waiting';
    
    // Ensure we have local stream
    if (!localStream) {
        const success = await startWebRTC();
        if (!success) {
            return; // Exit if we couldn't get media
        }
    }
    
    // Create new peer connection
    createPeerConnection();
    
    // Create and send offer
    await createOffer();
});

// When waiting for a partner
socket.on('waitingForPartner', () => {
    statusText.textContent = 'Looking for a partner...';
    statusText.className = 'status waiting';
});

// When an offer is received from a partner
socket.on('offer', async (data) => {
    partnerSocketId = data.from;
    
    // Ensure we have local stream
    if (!localStream) {
        const success = await startWebRTC();
        if (!success) {
            return; // Exit if we couldn't get media
        }
    }
    
    // Create new peer connection for receiving offer
    createPeerConnection();

    try {
        // Set the remote description (the offer from our partner)
        await peerConnection.setRemoteDescription(data.offer);

        // Create and send an answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('answer', {
            answer: answer,
            to: partnerSocketId
        });
        
        // Update UI
        isChatActive = true;
        toggleChatBtn.textContent = "Stop";
        toggleChatBtn.classList.add('stop-mode');
        toggleChatBtn.disabled = false;
        nextBtn.disabled = false;
        
    } catch (error) {
        console.error('Error handling offer:', error);
        statusText.textContent = 'Error establishing connection';
        statusText.className = 'status disconnected';
        nextBtn.disabled = false;
    }
});

// When an answer is received from a partner
socket.on('answer', async (data) => {
    try {
        // Set the remote description (the answer from our partner)
        if (peerConnection && peerConnection.signalingState !== 'stable') {
            await peerConnection.setRemoteDescription(data.answer);
        }
    } catch (error) {
        console.error('Error handling answer:', error);
        statusText.textContent = 'Error establishing connection';
        statusText.className = 'status disconnected';
        nextBtn.disabled = false;
    }
});

// When an ICE candidate is received from a partner
socket.on('ice-candidate', async (data) => {
    try {
        // Add the candidate to the peer connection
        if (peerConnection && data.candidate) {
            await peerConnection.addIceCandidate(data.candidate);
        }
    } catch (error) {
        console.error('Error adding received ice candidate', error);
    }
});

// When a partner disconnects
socket.on('partnerDisconnected', () => {
    statusText.textContent = 'Partner disconnected. Click Next to find new partner';
    statusText.className = 'status disconnected';
    nextBtn.disabled = false;
    
    // Clean up WebRTC but keep local stream
    cleanupWebRTC();
});

// Handle socket connection events
socket.on('connect', () => {
    console.log('Connected to server');
    statusText.textContent = 'Connected to server - Click Start to begin';
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    statusText.textContent = 'Disconnected from server';
    statusText.className = 'status disconnected';
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    statusText.textContent = 'Connection error: ' + error.message;
    statusText.className = 'status disconnected';
});

// Create and send an offer
async function createOffer() {
    try {
        if (!peerConnection) {
            createPeerConnection();
        }
        
        // Check if we're in a state where we can create an offer
        if (peerConnection.signalingState !== 'stable') {
            console.log('Cannot create offer, signaling state is:', peerConnection.signalingState);
            return;
        }
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Send the offer to the partner via Socket.io
        socket.emit('offer', {
            offer: offer,
            to: partnerSocketId
        });
        
        // Update UI to show chat is active
        isChatActive = true;
        toggleChatBtn.textContent = "Stop";
        toggleChatBtn.classList.add('stop-mode');
        toggleChatBtn.disabled = false;
        nextBtn.disabled = false;
        
    } catch (error) {
        console.error('Error creating offer:', error);
        statusText.textContent = 'Error creating connection offer: ' + error.message;
        statusText.className = 'status disconnected';
        toggleChatBtn.disabled = false;
        nextBtn.disabled = false;
    }
}

// Handle page visibility change
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Page hidden');
    } else {
        console.log('Page visible');
    }
});

// Handle beforeunload event to clean up
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    socket.emit('stopChat');
});