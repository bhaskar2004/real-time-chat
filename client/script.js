let chatApp = null;
class ChatApp {
    constructor() {
        // Get backend URL from window.__env or fall back to a default
        const BACKEND_URL = window.__env?.BACKEND_URL || 'http://localhost:3000';
        
        this.socket = io(BACKEND_URL, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5,
            withCredentials: true
        });
        
        // Rest of the constructor remains the same
        this.currentUser = null;
        this.currentUserProfile = null;
        this.selectedUser = null;
        this.messages = new Map();
        this.typingTimeout = null;
        this.activeUsers = new Map();
        this.themeManager = new ThemeManager();
        this.initializeMediaHandlers();
        this.setupSocketListeners();
        this.setupUIListeners();
        this.initializeUI();
    }
    initializeMediaHandlers() {
        this.setupVoiceRecording();
        this.setupFileUpload();
    }
    setupVoiceRecording() {
        const voiceRecordButton = document.getElementById('voiceRecordButton');
        let mediaRecorder = null;
        let audioChunks = [];
        let isRecording = false;
        let stream = null;

        voiceRecordButton.addEventListener('click', async () => {
            try {
                if (!isRecording) {
                    // Start recording
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    audioChunks = [];

                    mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            audioChunks.push(event.data);
                        }
                    };

                    mediaRecorder.onstop = async () => {
                        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                        await this.sendAudioMessage(audioBlob);
                        
                        // Clean up
                        audioChunks = [];
                        if (stream) {
                            stream.getTracks().forEach(track => track.stop());
                        }
                    };

                    mediaRecorder.start();
                    isRecording = true;
                    voiceRecordButton.classList.add('recording');
                    voiceRecordButton.innerHTML = '🔴 Recording...';
                } else {
                    // Stop recording
                    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                        mediaRecorder.stop();
                    }
                    isRecording = false;
                    voiceRecordButton.classList.remove('recording');
                    voiceRecordButton.innerHTML = '🎤';
                }
            } catch (error) {
                console.error('Voice recording error:', error);
                alert('Unable to access microphone. Please check permissions.');
                isRecording = false;
                voiceRecordButton.classList.remove('recording');
                voiceRecordButton.innerHTML = '🎤';
            }
        });}

        setupFileUpload() {
            const fileInput = document.getElementById('fileInput');
            const attachFileButton = document.getElementById('attachFileButton');
    
            if (!fileInput || !attachFileButton) return;
    
            attachFileButton.addEventListener('click', () => {
                fileInput.click();
            });
    
            fileInput.addEventListener('change', async (event) => {
                const files = event.target.files;
                if (!files.length || !this.selectedUser) return;
    
                for (const file of files) {
                    if (file.size > 100 * 1024 * 1024) { // 100MB limit
                        alert(`File ${file.name} exceeds 100MB limit`);
                        continue;
                    }
    
                    try {
                        await this.sendFileMessage(file);
                    } catch (error) {
                        console.error('Error sending file:', error);
                        alert(`Failed to send file ${file.name}. Please try again.`);
                    }
                }
                fileInput.value = ''; // Clear the input
            });
        }

        async sendFileMessage(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                
                reader.onload = () => {
                    try {
                        const base64Data = reader.result.split(',')[1]; // Remove data URL prefix
                        
                        this.socket.emit('fileMessage', {
                            senderId: this.currentUser.userId,
                            recipientId: this.selectedUser.userId,
                            senderProfile: this.currentUserProfile,
                            fileData: {
                                name: file.name,
                                type: file.type,
                                size: file.size,
                                data: base64Data
                            },
                            timestamp: new Date()
                        });
    
                        // Add file message to chat immediately for sender
                        this.addFileMessageToChat({
                            senderId: this.currentUser.userId,
                            senderProfile: this.currentUserProfile,
                            fileData: {
                                name: file.name,
                                type: file.type,
                                data: base64Data
                            },
                            timestamp: new Date()
                        }, true);
    
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
    
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
        }

        async sendAudioMessage(audioBlob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                
                reader.onload = () => {
                    try {
                        const base64Data = reader.result.split(',')[1]; // Remove data URL prefix
                        
                        this.socket.emit('audioMessage', {
                            senderId: this.currentUser.userId,
                            recipientId: this.selectedUser.userId,
                            senderProfile: this.currentUserProfile,
                            audioData: {
                                type: audioBlob.type,
                                data: base64Data
                            },
                            timestamp: new Date()
                        });
    
                        // Add audio message to chat immediately for sender
                        this.addAudioMessageToChat({
                            senderId: this.currentUser.userId,
                            senderProfile: this.currentUserProfile,
                            audioData: {
                                type: audioBlob.type,
                                data: base64Data
                            },
                            timestamp: new Date()
                        }, true);
    
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
    
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(audioBlob);
            });
        }

        addFileMessageToChat(data, isSent = false) {
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return;
    
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    
            const isImage = data.fileData.type.startsWith('image/');
            let contentHtml = '';
    
            if (isImage && data.fileData.data) {
                contentHtml = `
                    <img src="data:${data.fileData.type};base64,${data.fileData.data}" 
                         alt="${data.fileData.name}" 
                         style="max-width: 200px; max-height: 200px;">
                `;
            } else {
                const icon = isImage ? '🖼️' : '📎';
                contentHtml = `
                    <div class="file-message">
                        ${icon} ${data.fileData.name}
                        ${data.fileData.data ? 
                            `<button class="download-button">Download</button>` : 
                            '<span>(File unavailable)</span>'}
                    </div>
                `;
            }
    
            messageDiv.innerHTML = `
                <div class="message-content">
                    ${contentHtml}
                    <div class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</div>
                </div>
            `;
    
            if (data.fileData.data && !isImage) {
                const downloadButton = messageDiv.querySelector('.download-button');
                downloadButton.addEventListener('click', () => {
                    const blob = this.base64ToBlob(data.fileData.data, data.fileData.type);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = data.fileData.name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                });
            }
    
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        addAudioMessageToChat(data, isSent = false) {
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return;
    
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    
            const audioUrl = `data:${data.audioData.type};base64,${data.audioData.data}`;
    
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="audio-message">
                        <audio controls>
                            <source src="${audioUrl}" type="${data.audioData.type}">
                            Your browser does not support the audio element.
                        </audio>
                    </div>
                    <div class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</div>
                </div>
            `;
    
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    
        base64ToBlob(base64, type) {
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return new Blob([bytes], { type: type });
        }
    

    handleSuccessfulLogin(userData) {
        console.log('User logged in:', userData);
        
        this.currentUser = userData;
        this.currentUserProfile = userData.profile;
        
        const loginContainer = document.getElementById('loginContainer');
        const chatContainer = document.getElementById('chatContainer');
        if (loginContainer) loginContainer.style.display = 'none';
        if (chatContainer) chatContainer.style.display = 'flex';
        
        this.updateCurrentUserProfile();
        
        if (!this.socket.connected) {
            this.socket.connect();
        }
        this.socket.emit('register', {
            userId: this.currentUser.userId,
            profile: this.currentUser.profile
        });
    }

    updateConnectionStatus(status) {
        const connectionStatus = document.getElementById('connectionStatus');
        if (!connectionStatus) return;

        const statusDot = connectionStatus.querySelector('.status-dot');
        const statusText = connectionStatus.querySelector('.status-text');

        if (statusDot && statusText) {
            statusDot.className = `status-dot ${status}`;
            statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        }
    }

    initializeUI() {
        this.updateConnectionStatus('connecting');
        
        const messageInput = document.getElementById('messageInput');
        const emojiButton = document.getElementById('emojiButton');
        const emojiPicker = document.getElementById('emojiPicker');
        const fileInput = document.getElementById('fileInput');
        const attachFileButton = document.getElementById('attachFileButton');
        const voiceRecordButton = document.getElementById('voiceRecordButton');
        
        if (messageInput) messageInput.disabled = true;

        if (emojiButton && emojiPicker) {
            emojiButton.addEventListener('click', () => {
                emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'block' : 'none';
            });

            document.querySelectorAll('.emoji').forEach(emoji => {
                emoji.addEventListener('click', () => {
                    if (messageInput) {
                        messageInput.value += emoji.textContent;
                        emojiPicker.style.display = 'none';
                    }
                });
            });
        }

        if (attachFileButton && fileInput) {
            attachFileButton.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', this.handleFileUpload.bind(this));
        }

        document.addEventListener('click', (e) => {
            if (emojiPicker && !emojiButton?.contains(e.target) && !emojiPicker.contains(e.target)) {
                emojiPicker.style.display = 'none';
            }
        });
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateConnectionStatus('connected');
            if (this.currentUser) {
                this.socket.emit('register', {
                    userId: this.currentUser.userId,
                    profile: this.currentUserProfile
                });
            }
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus('disconnected');
        });

        this.socket.on('fileMessage', (data) => {
            if (this.selectedUser && data.senderId === this.selectedUser.userId) {
                this.addFileMessageToChat(data);
            }
        });

        this.socket.on('audioMessage', (data) => {
            if (this.selectedUser && data.senderId === this.selectedUser.userId) {
                this.addAudioMessageToChat(data);
            }
        });
    

        this.socket.on('userList', (users) => {
            console.log('Received user list:', users);
            this.activeUsers.clear();
            users.forEach(user => {
                if (user.status === 'online') {
                    this.activeUsers.set(user.userId, {
                        ...user,
                        profile: user.profile || {
                            displayName: 'Anonymous User',
                            avatarColor: '#ccc'
                        }
                    });
                }
            });
            this.updateUserList(Array.from(this.activeUsers.values()));
        });
    

        this.socket.on('privateMessage', (data) => {
            this.handleIncomingMessage(data);
        });

        this.socket.on('userTyping', (data) => {
            this.handleTypingIndicator(data);
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            alert(error.message || 'An error occurred');
        });
    }
    // Add these methods to your ChatApp class

handleVoiceRecording() {
    const voiceRecordButton = document.getElementById('voiceRecordButton');
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;

    voiceRecordButton.addEventListener('click', async () => {
        try {
            if (!isRecording) {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                
                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                    this.sendAudioMessage(audioBlob);
                    audioChunks = [];
                };

                mediaRecorder.start();
                isRecording = true;
                voiceRecordButton.classList.add('recording');
            } else {
                mediaRecorder.stop();
                isRecording = false;
                voiceRecordButton.classList.remove('recording');
            }
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Unable to access microphone. Please check permissions.');
        }
    });
}

handleFileUpload(event) {
    const files = event.target.files;
    if (!files.length || !this.selectedUser) return;

    Array.from(files).forEach(file => {
        const maxSize = 100 * 1024 * 1024; // 100MB
        if (file.size > maxSize) {
            alert('File size exceeds limit (100 MB)');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const fileData = {
                name: file.name,
                type: file.type,
                size: file.size,
                data: e.target.result
            };

            this.socket.emit('fileMessage', {
                senderId: this.currentUser.userId,
                senderProfile: this.currentUserProfile,
                recipientId: this.selectedUser.userId,
                file: fileData,
                timestamp: new Date()
            });
        };
        reader.readAsDataURL(file);
    });
}

sendAudioMessage(audioBlob) {
    if (!this.selectedUser) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        this.socket.emit('audioMessage', {
            senderId: this.currentUser.userId,
            senderProfile: this.currentUserProfile,
            recipientId: this.selectedUser.userId,
            audio: e.target.result,
            timestamp: new Date()
        });
    };
    reader.readAsDataURL(audioBlob);
}


// Update the createUserListItem method in your ChatApp class
createUserListItem(user) {
    const userElement = document.createElement('li');
    userElement.className = 'user-item';
    userElement.dataset.userId = user.userId;

    // Ensure we're getting the display name from the correct path in the user object
    const displayName = user.profile?.displayName || user.userId;
    const avatarColor = user.profile?.avatarColor || '#ccc';
    const status = user.status || 'offline';

    // Add a debug log to see what data we're receiving
    console.log('User data:', user);
    console.log('Display name:', displayName);

    userElement.innerHTML = `
        <div class="avatar" style="background-color: ${avatarColor}">
            ${displayName.charAt(0).toUpperCase()}
        </div>
        <div class="user-info">
            <h4>${displayName}</h4>
            <p class="status">${status}</p>
        </div>
    `;

    userElement.addEventListener('click', () => this.selectUser(user));
    return userElement;
}
    setupUIListeners() {
        const messageForm = document.getElementById('messageForm');
        const messageInput = document.getElementById('messageInput');
        const userSearch = document.getElementById('userSearch');

        if (messageForm) {
            messageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.sendMessage();
            });
        }

        if (messageInput) {
            messageInput.addEventListener('input', () => {
                this.handleTyping();
            });
        }

        if (userSearch) {
            userSearch.addEventListener('input', (e) => {
                this.filterUsers(e.target.value);
            });
        }
    }

    updateCurrentUserProfile() {
        const profileContainer = document.getElementById('currentUserProfile');
        if (!profileContainer || !this.currentUserProfile) return;

        profileContainer.innerHTML = `
            <div class="avatar" style="background-color: ${this.currentUserProfile.avatarColor}">
                ${this.currentUserProfile.displayName.charAt(0).toUpperCase()}
            </div>
            <h3>${this.currentUserProfile.displayName}</h3>
            <p class="status">${this.currentUserProfile.status}</p>
        `;
    }

    updateUserList(users) {
        const userList = document.getElementById('userList');
        if (!userList) return;
    
        // Clear the existing list
        userList.innerHTML = '';
        
        // Debug log to see incoming users data
        console.log('Updating user list with:', users);
    
        users.forEach(user => {
            // Only add other users, not the current user
            if (user.userId !== this.currentUser?.userId) {
                const userElement = this.createUserListItem(user);
                userList.appendChild(userElement);
            }
        });
    }

    createUserListItem(user) {
        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.dataset.userId = user.userId;

        const displayName = user.profile?.displayName || user.userId;
        const avatarColor = user.profile?.avatarColor || '#ccc';

        userElement.innerHTML = `
            <span class="status-indicator ${user.status}"></span>
            <div class="avatar" style="background-color: ${avatarColor}">
                ${displayName.charAt(0).toUpperCase()}
            </div>
            <div class="user-info">
                <h4>${displayName}</h4>
                <p class="status">${user.status}</p>
            </div>
        `;

        userElement.addEventListener('click', () => this.selectUser(user));
        return userElement;
    }

    selectUser(user) {
        this.selectedUser = user;
        const messageInput = document.getElementById('messageInput');
        const chatHeader = document.getElementById('chatHeader');
        const chatMessages = document.getElementById('chatMessages');

        if (messageInput) messageInput.disabled = false;
        if (chatHeader) {
            chatHeader.innerHTML = `
                <div class="avatar" style="background-color: ${user.profile?.avatarColor || '#ccc'}">
                    ${(user.profile?.displayName || user.userId).charAt(0).toUpperCase()}
                </div>
                <div class="user-info">
                    <h4>${user.profile?.displayName || user.userId}</h4>
                    <p class="status">${user.status}</p>
                </div>
            `;
        }

        if (chatMessages) {
            chatMessages.innerHTML = '';
            const conversationKey = this.getConversationKey(this.currentUser.userId, user.userId);
            const messages = this.messages.get(conversationKey) || [];
            messages.forEach(msg => this.addMessageToChat(msg));
        }
    }

    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput || !this.selectedUser) return;

        const message = messageInput.value.trim();
        if (!message) return;

        const messageData = {
            senderId: this.currentUser.userId,
            senderProfile: this.currentUserProfile,
            recipientId: this.selectedUser.userId,
            message: message,
            timestamp: new Date()
        };

        this.socket.emit('privateMessage', messageData);
        this.addMessageToChat(messageData);
        messageInput.value = '';
    }

    handleIncomingMessage(data) {
        const conversationKey = this.getConversationKey(data.senderId, this.currentUser.userId);
        if (!this.messages.has(conversationKey)) {
            this.messages.set(conversationKey, []);
        }
        this.messages.get(conversationKey).push(data);

        if (this.selectedUser && data.senderId === this.selectedUser.userId) {
            this.addMessageToChat(data);
        }
    }

    addMessageToChat(data) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        const messageElement = document.createElement('div');
        messageElement.className = `message ${data.senderId === this.currentUser.userId ? 'sent' : 'received'}`;

        const avatarColor = data.senderProfile?.avatarColor || '#ccc';
        const displayName = data.senderProfile?.displayName || data.senderId;

        messageElement.innerHTML = `
            <div class="message-avatar" style="background-color: ${avatarColor}">
                ${displayName.charAt(0).toUpperCase()}
            </div>
            <div class="message-content">
                <div class="message-text">${data.message}</div>
                <div class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</div>
            </div>
        `;

        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    handleTyping() {
        if (!this.selectedUser) return;

        this.socket.emit('typing', {
            senderId: this.currentUser.userId,
            senderProfile: this.currentUserProfile,
            recipientId: this.selectedUser.userId,
            isTyping: true
        });

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.socket.emit('typing', {
                senderId: this.currentUser.userId,
                senderProfile: this.currentUserProfile,
                recipientId: this.selectedUser.userId,
                isTyping: false
            });
        }, 1000);
    }

    handleTypingIndicator(data) {
        const typingIndicator = document.getElementById('typingIndicator');
        if (!typingIndicator || !this.selectedUser || data.senderId !== this.selectedUser.userId) return;

        const displayName = data.senderProfile?.displayName || data.senderId;
        typingIndicator.style.display = data.isTyping ? 'block' : 'none';
        typingIndicator.querySelector('.typing-text').textContent = `${displayName} is typing...`;
    }

    // handleFileUpload(event) {
    //     const file = event.target.files[0];
    //     if (!file || !this.selectedUser) return;

    //     const maxSize = 100 * 1024 * 1024; // 100MB
    //     if (file.size > maxSize) {
    //         alert('File size exceeds limit (100 MB)');
    //         return;
    //     }

    //     console.log('File selected:', file);
    // }

    filterUsers(searchTerm) {
        const userElements = document.querySelectorAll('.user-item');
        searchTerm = searchTerm.toLowerCase();

        userElements.forEach(element => {
            const userName = element.querySelector('h4').textContent.toLowerCase();
            element.style.display = userName.includes(searchTerm) ? 'flex' : 'none';
        });
    }

    getConversationKey(user1Id, user2Id) {
        return [user1Id, user2Id].sort().join(':');
    }
}

// Update the Google Sign-In handler function
function handleGoogleSignIn(response) {
    if (!response || !response.credential) {
        console.error('Invalid Google sign-in response');
        alert('Google sign-in failed. Please try again.');
        return;
    }

    console.log('Received credential:', response.credential);

    const loginStatusElement = document.getElementById('loginStatus');
    if (loginStatusElement) {
        loginStatusElement.textContent = 'Signing in...';
    }

    fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ credential: response.credential })
    })
        .then(res => {
            if (!res.ok) {
                return res.json().then(err => {
                    throw new Error(err.message || 'Login failed');
                });
            }
            return res.json();
        })
        .then(data => {
            console.log('Login successful:', data);
            const currentUser = {
                userId: data.userId,
                profile: data.profile,
                email: data.email
            };
            
            // Use the global chatApp instance
            if (chatApp) {
                chatApp.handleSuccessfulLogin(currentUser);
            } else {
                console.error('ChatApp instance not found, initializing new instance...');
                // Create new instance if somehow not exists
                chatApp = new ChatApp();
                chatApp.handleSuccessfulLogin(currentUser);
            }
        })
        .catch(error => {
            console.error('Login error:', error);
            alert('Login failed. Please try again.');
        });
}

class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'light';
        this.toggleBtn = document.getElementById('themeToggle');
        this.initialize();
    }

    initialize() {
        document.documentElement.setAttribute('data-theme', this.theme);
        
        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', () => this.toggleTheme());
            this.updateButtonState();
        }

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                this.theme = e.matches ? 'dark' : 'light';
                this.applyTheme();
            }
        });
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        this.applyTheme();
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        localStorage.setItem('theme', this.theme);
        this.updateButtonState();
    }

    updateButtonState() {
        if (this.toggleBtn) {
            const title = this.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
            this.toggleBtn.setAttribute('title', title);
            this.toggleBtn.setAttribute('aria-label', title);
        }
    }
}
// Add this before your script loads
window.__env = {
    BACKEND_URL: 'https://real-time-chat-2lt4.onrender.com' // Change this to your actual backend URL
};
function initializeApp() {
    try {
        if (!chatApp) {
            chatApp = new ChatApp();
            console.log('ChatApp initialized successfully');
        }
    } catch (error) {
        console.error('Failed to initialize ChatApp:', error);
    }
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (chatApp?.currentUser) {
        // Notify server about user disconnection
        chatApp.socket.emit('userDisconnect', {
            userId: chatApp.currentUser.userId
        });
        
        // Cleanup socket connection
        chatApp.socket.disconnect();
    }
});

// Handle errors that might occur during socket operations
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    
    // Attempt to reconnect if it's a socket-related error
    if (chatApp?.socket && !chatApp.socket.connected) {
        chatApp.socket.connect();
    }
});