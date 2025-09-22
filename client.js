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
        height: { ideal: 720 },
        facingMode: "user" // Prefer front camera
    }, 
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100
    }
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
toggleChatBtn.addEventListener('click', async () => {
    if (!isChatActive) {
        // Start chat
        toggleChatBtn.disabled = true;
        toggleChatBtn.textContent = "Start";
        
        // First check if we have permission and devices available
        try {
            await checkMediaPermissions();
            statusText.textContent = 'Waiting for partner...';
            statusText.className = 'status waiting';
            socket.emit('startChat');
        } catch (error) {
            handleMediaError(error);
        }
    } else {
        // Stop chat
        stopChat();
        socket.emit('stopChat');
    }
});

nextBtn.addEventListener('click', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    remoteVideoStatus.textContent = 'No connection';
    statusText.textContent = 'Looking for next partner...';
    statusText.className = 'status waiting';
    socket.emit('nextPartner');
});

// Check media permissions before starting
async function checkMediaPermissions() {
    try {
        // Check if devices are available
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideo = devices.some(device => device.kind === 'videoinput');
        const hasAudio = devices.some(device => device.kind === 'audioinput');
        
        if (!hasVideo && !hasAudio) {
            throw new Error('No camera or microphone found');
        }
        
        if (!hasVideo) {
            console.warn('No camera found, continuing with audio only');
            constraints.video = false;
        }
        
        if (!hasAudio) {
            console.warn('No microphone found, continuing with video only');
            constraints.audio = false;
        }
        
        return true;
    } catch (error) {
        throw new Error('Cannot access media devices: ' + error.message);
    }
}

// Handle media errors gracefully
function handleMediaError(error) {
    console.error('Media error:', error);
    
    let errorMessage = 'Error accessing camera/microphone: ';
    
    if (error.name === 'NotAllowedError') {
        errorMessage += 'Permission denied. Please allow camera and microphone access.';
    } else if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
        errorMessage += 'No suitable camera/microphone found.';
    } else if (error.name === 'NotReadableError') {
        errorMessage += 'Camera/microphone is already in use by another application.';
    } else {
        errorMessage += error.message;
    }
    
    statusText.textContent = errorMessage;
    statusText.className = 'status disconnected';
    toggleChatBtn.disabled = false;
    toggleChatBtn.textContent = "Start Chat";
}

// Function to stop chat and clean up
function stopChat() {
    isChatActive = false;
    toggleChatBtn.textContent = "Start Chat";
    toggleChatBtn.classList.remove('stop-mode');
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    toggleChatBtn.disabled = false;
    nextBtn.disabled = true;
    statusText.textContent = 'Disconnected - Click Start to begin';
    statusText.className = 'status disconnected';
    localVideoStatus.textContent = 'Camera off';
    remoteVideoStatus.textContent = 'No connection';
}

// Function to start the media and initialize WebRTC
async function startWebRTC() {
    try {
        // Get the user's camera and microphone with fallback
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
            .catch(async (error) => {
                // If both video and audio fail, try audio only
                if (constraints.video && constraints.audio) {
                    console.warn('Both video and audio failed, trying audio only');
                    return await navigator.mediaDevices.getUserMedia({
                        audio: constraints.audio,
                        video: false
                    });
                }
                throw error;
            });
            
        localStream = stream;
        
        // Display your own video if available
        localVideo.srcObject = localStream;
        localVideoStatus.textContent = localStream.getVideoTracks().length > 0 ? 'Camera on' : 'Audio only';
        
        // Setup the peer connection
        createPeerConnection();
        return true;
    } catch (error) {
        handleMediaError(error);
        return false;
    }
}

// Function to create and set up the PeerConnection
function createPeerConnection() {
    // Create an RTCPeerConnection
    peerConnection = new RTCPeerConnection(configuration);

    // Add our local stream to the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // When we receive a remote stream, display it
    peerConnection.ontrack = (event) => {
        remoteStream = new MediaStream();
        event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track);
        });
        remoteVideo.srcObject = remoteStream;
        remoteVideoStatus.textContent = 'Connected';
        statusText.textContent = 'Connected to partner';
        statusText.className = 'status connected';
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
                statusText.textContent = 'Connected to partner';
                statusText.className = 'status connected';
                break;
            case 'disconnected':
            case 'failed':
                statusText.textContent = 'Connection lost';
                statusText.className = 'status disconnected';
                break;
            case 'closed':
                statusText.textContent = 'Connection closed';
                statusText.className = 'status disconnected';
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
    statusText.textContent = 'Partner found! Setting up connection...';
    statusText.className = 'status waiting';
    
    if (!localStream) {
        const success = await startWebRTC();
        if (success) {
            // Let's say the user who started the chat creates the offer
            setTimeout(createOffer, 1000);
        }
    } else {
        setTimeout(createOffer, 1000);
    }
});

// When waiting for a partner
socket.on('waitingForPartner', () => {
    statusText.textContent = 'Waiting for partner...';
    statusText.className = 'status waiting';
});

// When an offer is received from a partner
socket.on('offer', async (data) => {
    partnerSocketId = data.from;
    
    // If we haven't started yet, do it now (we are the receiving user)
    if (!peerConnection) {
        await startWebRTC();
    }

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
    } catch (error) {
        console.error('Error handling offer:', error);
        statusText.textContent = 'Error establishing connection';
        statusText.className = 'status disconnected';
    }
});

// When an answer is received from a partner
socket.on('answer', async (data) => {
    try {
        // Set the remote description (the answer from our partner)
        await peerConnection.setRemoteDescription(data.answer);
    } catch (error) {
        console.error('Error handling answer:', error);
        statusText.textContent = 'Error establishing connection';
        statusText.className = 'status disconnected';
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
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    remoteVideoStatus.textContent = 'No connection';
    partnerSocketId = null;
    statusText.textContent = 'Partner disconnected. Click Next for a new partner';
    statusText.className = 'status disconnected';
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
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        // Send the offer to the partner via Socket.io
        socket.emit('offer', {
            offer: offer,
            to: partnerSocketId
        });
        
        // Update UI to show chat is active
        isChatActive = true;
        toggleChatBtn.textContent = "Stop Chat";
        toggleChatBtn.classList.add('stop-mode');
        toggleChatBtn.disabled = false;
        nextBtn.disabled = false;
    } catch (error) {
        console.error('Error creating offer:', error);
        statusText.textContent = 'Error creating connection offer';
        statusText.className = 'status disconnected';
        toggleChatBtn.disabled = false;
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