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

// WebRTC variables with updated constraints
const constraints = { 
    video: {
        width: { ideal: 426, max: 426 },
        height: { ideal: 240, max: 240 }, 
        frameRate: { ideal: 24, max: 24 },
        aspectRatio: { ideal: 16/9 }
    },
    audio: {
        channelCount: 1,
        sampleRate: 16000,
        sampleSize: 16,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};

// Encoding bitrates:
const encoding = {
    video: { max: 400000, target: 400000 },
    audio: { max: 24000, target: 24000 }
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
        // Add your TURN servers here if needed
        // {
        //   urls: 'turn:your-turn-server.com:3478',
        //   username: 'yourusername',
        //   credential: 'yourpassword'
        // }
    ],
    iceCandidatePoolSize: 5,
    iceTransportPolicy: 'all', // Use both relay and direct
    bundlePolicy: 'max-bundle', // Reduce number of transports
    rtcpMuxPolicy: 'require' // Multiplex RTP and RTCP
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

nextBtn.addEventListener('click', async () => {
    // Clean up existing connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Stop local stream and reset
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    remoteVideoStatus.textContent = 'No connection';
    localVideoStatus.textContent = 'Camera off';
    
    // Reset state
    partnerSocketId = null;
    isChatActive = false;
    
    // Update UI
    statusText.textContent = 'Connecting to next partner...';
    statusText.className = 'status waiting';
    nextBtn.disabled = true;
    toggleChatBtn.textContent = "Start";
    toggleChatBtn.classList.remove('stop-mode');
    
    // Request next partner
    socket.emit('nextPartner');
});

// Function to stop chat and clean up
function stopChat() {
    isChatActive = false;
    toggleChatBtn.textContent = "Start";
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
        // Get the user's camera and microphone with new constraints
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        // Display your own video
        localVideo.srcObject = localStream;
        localVideoStatus.textContent = 'Camera on';
        
        // Setup the peer connection
        createPeerConnection();
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
    // Create an RTCPeerConnection
    peerConnection = new RTCPeerConnection(configuration);

    // Add our local stream to the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Configure codec preferences for VP8 and Opus
    if ('getSenders' in peerConnection) {
        const senders = peerConnection.getSenders();
        senders.forEach(sender => {
            if (sender.track && sender.track.kind === 'video') {
                const params = sender.getParameters();
                if (!params) return;
                
                // Set video codec preference to VP8
                params.codecs = [
                    {
                        mimeType: 'video/vp8',
                        clockRate: 90000,
                        payloadType: 96
                    }
                ];
                
                // Set video encoding parameters
                if (params.encodings) {
                    params.encodings[0] = {
                        ...params.encodings[0],
                        ...encoding.video
                    };
                }
                
                sender.setParameters(params).catch(console.error);
            } else if (sender.track && sender.track.kind === 'audio') {
                const params = sender.getParameters();
                if (!params) return;
                
                // Set audio codec preference to Opus
                params.codecs = [
                    {
                        mimeType: 'audio/opus',
                        clockRate: 48000,
                        channels: 1,
                        payloadType: 111
                    }
                ];
                
                sender.setParameters(params).catch(console.error);
            }
        });
    }

    // When we receive a remote stream, display it
    peerConnection.ontrack = (event) => {
        remoteStream = new MediaStream();
        event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track);
        });
        remoteVideo.srcObject = remoteStream;
        remoteVideoStatus.textContent = 'Connected';
        statusText.textContent = 'Connected';
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
                statusText.textContent = 'Connected';
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
    statusText.textContent = 'Setting up connection...';
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
    statusText.textContent = 'Connecting...';
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
    statusText.textContent = 'Disconnected. Click Next';
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
        const offerOptions = {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        };
        
        const offer = await peerConnection.createOffer(offerOptions);
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
        statusText.textContent = 'Error creating connection offer';
        statusText.className = 'status disconnected';
        toggleChatBtn.disabled = false;
    }
}

// Handle page visibility change
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden, potentially stop media streams to save resources
        console.log('Page hidden');
    } else {
        // Page is visible again
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