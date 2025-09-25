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
let isReconnecting = false; // Prevent race conditions
let connectionAttempts = 0; // Track connection attempts

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
    if (isReconnecting) {
        console.log('Already reconnecting, please wait...');
        return;
    }
    
    isReconnecting = true;
    nextBtn.disabled = true;
    connectionAttempts = 0;
    
    console.log('Next button clicked, cleaning up connection...');
    
    // Clean up existing connection more thoroughly
    cleanupConnection();
    
    // Reset state
    partnerSocketId = null;
    isChatActive = false;
    
    // Update UI
    statusText.textContent = 'Connecting to next partner...';
    statusText.className = 'status waiting';
    toggleChatBtn.textContent = "Start";
    toggleChatBtn.classList.remove('stop-mode');
    
    // Delay before requesting new partner to prevent overwhelming older devices
    setTimeout(() => {
        socket.emit('nextPartner');
        
        // Re-enable button after a longer delay for older devices
        setTimeout(() => {
            isReconnecting = false;
            nextBtn.disabled = false;
        }, 4000); // 4-second cooldown for older devices
    }, 2000); // 2-second delay before emitting
});

// Improved cleanup function
function cleanupConnection() {
    console.log('Cleaning up WebRTC connection...');
    
    // Stop remote stream tracks first
    if (remoteVideo.srcObject) {
        const remoteStream = remoteVideo.srcObject;
        remoteStream.getTracks().forEach(track => {
            track.stop();
        });
        remoteVideo.srcObject = null;
    }
    
    // Clean up peer connection
    if (peerConnection) {
        // Remove all event listeners first to prevent memory leaks
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onnegotiationneeded = null;
        peerConnection.onsignalingstatechange = null;
        
        // Close the connection
        try {
            peerConnection.close();
        } catch (e) {
            console.log('Error closing peer connection:', e);
        }
        peerConnection = null;
    }
    
    remoteVideoStatus.textContent = 'No connection';
    console.log('Cleanup completed');
}

// Function to stop chat and clean up
function stopChat() {
    console.log('Stopping chat...');
    isChatActive = false;
    isReconnecting = false;
    connectionAttempts = 0;
    toggleChatBtn.textContent = "Start";
    toggleChatBtn.classList.remove('stop-mode');
    
    cleanupConnection();
    
    // Stop local stream but keep it for potential reuse
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
}

// Function to start the media and initialize WebRTC
async function startWebRTC() {
    try {
        // Get the user's camera and microphone
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
        isReconnecting = false;
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
        console.log('Received remote stream, tracks:', event.streams[0]?.getTracks().length);
        if (event.streams && event.streams[0]) {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
            remoteVideoStatus.textContent = 'Connected';
            statusText.textContent = 'Connected';
            statusText.className = 'status connected';
            isReconnecting = false;
            connectionAttempts = 0;
        }
    };

    // When the ICE agent needs to send a candidate to the other peer
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && partnerSocketId) {
            // Small delay to prevent overwhelming older devices
            setTimeout(() => {
                socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    to: partnerSocketId
                });
            }, 100);
        } else if (!event.candidate) {
            console.log('ICE gathering complete');
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = (event) => {
        console.log('Connection state:', peerConnection.connectionState);
        switch(peerConnection.connectionState) {
            case 'connected':
                statusText.textContent = 'Connected';
                statusText.className = 'status connected';
                isReconnecting = false;
                connectionAttempts = 0;
                break;
            case 'disconnected':
                statusText.textContent = 'Connection lost';
                statusText.className = 'status disconnected';
                // Try to recover after a delay
                setTimeout(() => {
                    if (partnerSocketId && !isReconnecting && connectionAttempts < 3) {
                        connectionAttempts++;
                        console.log('Attempting to recover disconnected connection...');
                        createOffer();
                    }
                }, 2000);
                break;
            case 'failed':
                statusText.textContent = 'Connection failed';
                statusText.className = 'status disconnected';
                // Try to recover with longer delay
                setTimeout(() => {
                    if (partnerSocketId && !isReconnecting && connectionAttempts < 2) {
                        connectionAttempts++;
                        console.log('Attempting to recover failed connection...');
                        createOffer();
                    }
                }, 3000);
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
            // Try to restart ICE with delay
            setTimeout(() => {
                if (peerConnection && !isReconnecting) {
                    console.log('ICE connection failed, restarting ICE...');
                    peerConnection.restartIce();
                }
            }, 1000);
        }
    };

    // Handle signaling state changes
    peerConnection.onsignalingstatechange = (event) => {
        console.log('Signaling state:', peerConnection.signalingState);
    };
}

// Socket event handlers

// When we are connected to a partner, start the process
socket.on('partnerFound', async (data) => {
    console.log('Partner found:', data.partnerId);
    partnerSocketId = data.partnerId;
    statusText.textContent = 'Setting up connection...';
    statusText.className = 'status waiting';
    
    // Delay for older devices to stabilize
    setTimeout(async () => {
        if (!localStream) {
            const success = await startWebRTC();
            if (success) {
                // Additional delay for older devices
                setTimeout(createOffer, 1000);
            }
        } else {
            // Reuse existing local stream
            createPeerConnection();
            setTimeout(createOffer, 1000);
        }
    }, 500);
});

// When waiting for a partner
socket.on('waitingForPartner', () => {
    console.log('Waiting for partner...');
    statusText.textContent = 'Connecting...';
    statusText.className = 'status waiting';
});

// When an offer is received from a partner
socket.on('offer', async (data) => {
    console.log('Offer received from:', data.from);
    partnerSocketId = data.from;
    
    // Clean up any existing connection first with delay
    setTimeout(async () => {
        if (peerConnection) {
            cleanupConnection();
        }

        // If we haven't started yet, do it now (we are the receiving user)
        if (!localStream) {
            await startWebRTC();
        } else {
            createPeerConnection();
        }

        try {
            // Set the remote description (the offer from our partner)
            await peerConnection.setRemoteDescription(data.offer);

            // Create and send an answer
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            // Delay for older devices
            setTimeout(() => {
                socket.emit('answer', {
                    answer: answer,
                    to: partnerSocketId
                });
            }, 500);
            
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
            isReconnecting = false;
        }
    }, 1000); // 1-second delay for older devices
});

// When an answer is received from a partner
socket.on('answer', async (data) => {
    console.log('Answer received from:', data.from);
    try {
        // Set the remote description (the answer from our partner)
        if (peerConnection && peerConnection.signalingState !== 'closed') {
            await peerConnection.setRemoteDescription(data.answer);
        }
    } catch (error) {
        console.error('Error handling answer:', error);
        statusText.textContent = 'Error establishing connection';
        statusText.className = 'status disconnected';
    }
});

// When an ICE candidate is received from a partner
socket.on('ice-candidate', async (data) => {
    try {
        // Add the candidate to the peer connection with delay for older devices
        setTimeout(async () => {
            if (peerConnection && data.candidate && peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(data.candidate);
            }
        }, 100);
    } catch (error) {
        console.error('Error adding received ice candidate', error);
    }
});

// When a partner disconnects - IMPROVED HANDLING WITH DELAY
socket.on('partnerDisconnected', () => {
    console.log('Partner disconnected');
    
    // Critical: Add significant delay for older devices to cleanup properly
    setTimeout(() => {
        if (!isReconnecting) {
            cleanupConnection();
            
            remoteVideoStatus.textContent = 'No connection';
            partnerSocketId = null;
            isChatActive = false;
            connectionAttempts = 0;
            
            statusText.textContent = 'Partner disconnected. Click Next to find new partner';
            statusText.className = 'status disconnected';
            
            // Update UI
            toggleChatBtn.textContent = "Start";
            toggleChatBtn.classList.remove('stop-mode');
            nextBtn.disabled = false;
        }
    }, 3000); // 3-second delay for older devices
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
    if (!peerConnection || !partnerSocketId) {
        console.error('Cannot create offer: peerConnection or partnerSocketId missing');
        return;
    }
    
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Delay for older devices
        setTimeout(() => {
            socket.emit('offer', {
                offer: offer,
                to: partnerSocketId
            });
        }, 500);
        
        // Update UI to show chat is active
        isChatActive = true;
        toggleChatBtn.textContent = "Stop";
        toggleChatBtn.classList.add('stop-mode');
        toggleChatBtn.disabled = false;
        nextBtn.disabled = false;
        
        console.log('Offer created and sent');
    } catch (error) {
        console.error('Error creating offer:', error);
        statusText.textContent = 'Error creating connection offer';
        statusText.className = 'status disconnected';
        toggleChatBtn.disabled = false;
        isReconnecting = false;
    }
}

// Handle page visibility change
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Page hidden');
        // Pause video tracks to save resources on older devices
        if (localStream) {
            localStream.getTracks().forEach(track => track.enabled = false);
        }
    } else {
        console.log('Page visible');
        // Resume video tracks
        if (localStream) {
            localStream.getTracks().forEach(track => track.enabled = true);
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

// Detect older devices and apply additional delays
function isOlderDevice() {
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('android') && 
           (userAgent.includes('samsung') || 
            userAgent.includes('galaxy') ||
            userAgent.includes('j2'));
}

if (isOlderDevice()) {
    console.log('Older device detected, applying additional optimizations');
    // You can add device-specific optimizations here
}