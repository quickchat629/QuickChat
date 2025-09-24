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
        width: { ideal: 640 }, // Reduced resolution for better performance
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 } // Limit frame rate
    }, 
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1, // Mono audio for better compatibility
        sampleRate: 22050, // Lower sample rate for less bandwidth
        sampleSize: 16,
        volume: 1.0
    }
};

let localStream = null;
let remoteStream = null;
let peerConnection = null;
let partnerSocketId = null;
let isChatActive = false;

// Optimized STUN/TURN servers
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Add your TURN servers here for better connectivity
        // {
        //   urls: 'turn:your-turn-server.com:3478',
        //   username: 'yourusername',
        //   credential: 'yourpassword'
        // }
    ],
    iceCandidatePoolSize: 5, // Reduced for faster connection
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceTransportPolicy: 'all'
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
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    remoteVideoStatus.textContent = 'No connection';
    statusText.textContent = 'Connecting...';
    statusText.className = 'status waiting';
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
        // Get the user's camera and microphone
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Apply audio processing to reduce echo
        await applyAudioProcessing(localStream);
        
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

// Audio processing to reduce echo and improve quality
async function applyAudioProcessing(stream) {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
        // Create audio context for processing
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const destination = audioContext.createMediaStreamDestination();
        
        // Create audio filters
        const compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.value = -50;
        compressor.knee.value = 40;
        compressor.ratio.value = 12;
        compressor.attack.value = 0;
        compressor.release.value = 0.25;
        
        const filter = audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1000;
        filter.Q.value = 1;
        
        // Connect audio nodes
        source.connect(compressor);
        compressor.connect(filter);
        filter.connect(destination);
        
        // Replace the audio track with processed one
        const processedStream = destination.stream;
        stream.removeTrack(audioTracks[0]);
        stream.addTrack(processedStream.getAudioTracks()[0]);
    }
}

// Function to create and set up the PeerConnection
function createPeerConnection() {
    // Create an RTCPeerConnection with optimized settings
    peerConnection = new RTCPeerConnection(configuration);

    // Add our local stream to the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // When we receive a remote stream, display it
    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        remoteVideo.srcObject = remoteStream;
        remoteVideoStatus.textContent = 'Connected';
        statusText.textContent = 'Connected';
        statusText.className = 'status connected';
        
        // Apply volume boost to remote audio
        if (remoteVideo.srcObject) {
            remoteVideo.volume = 1.5; // Boost volume by 50%
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
                // Optimize video playback
                optimizeVideoPlayback();
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

    // Handle negotiation needed event
    peerConnection.onnegotiationneeded = async () => {
        console.log('Negotiation needed');
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', {
                offer: offer,
                to: partnerSocketId
            });
        } catch (err) {
            console.error('Error during negotiation:', err);
        }
    };

    // Set up bandwidth constraints for better performance
    const senders = peerConnection.getSenders();
    senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'video') {
            const parameters = sender.getParameters();
            if (!parameters.encodings) {
                parameters.encodings = [{}];
            }
            parameters.encodings[0].maxBitrate = 500000; // 500 kbps
            parameters.encodings[0].maxFramerate = 25;
            sender.setParameters(parameters);
        }
    });
}

// Optimize video playback performance
function optimizeVideoPlayback() {
    // Ensure video elements are properly configured
    localVideo.playsInline = true;
    remoteVideo.playsInline = true;
    
    // Preload and autoplay settings
    remoteVideo.preload = 'auto';
    localVideo.preload = 'auto';
    
    // Reduce latency by buffering less
    if (remoteVideo.buffered && remoteVideo.buffered.length > 0) {
        remoteVideo.currentTime = remoteVideo.buffered.end(0);
    }
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
            setTimeout(createOffer, 500); // Reduced delay
        }
    } else {
        setTimeout(createOffer, 500); // Reduced delay
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
        statusText.textContent = 'Error creating connection offer';
        statusText.className = 'status disconnected';
        toggleChatBtn.disabled = false;
    }
}

// Handle page visibility change
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden, reduce quality to save resources
        if (localStream) {
            localStream.getTracks().forEach(track => {
                if (track.kind === 'video') {
                    track.enabled = false;
                }
            });
        }
    } else {
        // Page is visible again, restore quality
        if (localStream) {
            localStream.getTracks().forEach(track => {
                if (track.kind === 'video') {
                    track.enabled = true;
                }
            });
        }
    }
});

// Handle beforeunload event to clean up
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    socket.emit('stopChat');
});