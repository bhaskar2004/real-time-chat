const express = require('express');
const cors = require('cors');
const path = require('path');
const MongoStore = require('connect-mongo');

const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();
const http = require('http').createServer(app);

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const corsOptions = {
    origin: [
        'https://warm-twilight-c35b54.netlify.app/',
        'http://localhost:5173',
        'http://localhost:3000'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    
    // Update this to your Netlify domain
    res.setHeader('Access-Control-Allow-Origin', 'https://warm-twilight-c35b54.netlify.app/');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    
    next();
});
// Socket.io configuration
const io = require('socket.io')(http, {
    cors: {
        origin: corsOptions.origin,
        methods: corsOptions.methods,
        credentials: true,
        allowedHeaders: corsOptions.allowedHeaders
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Main route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// User Manager Class
// Update the UserManager class in server.js
class UserManager {
    constructor() {
        this.users = new Map();
        this.activeUsers = new Map();
    }

    addUser(userId, socketId, profile) {
        // Ensure profile has all required fields
        const userProfile = {
            displayName: profile?.displayName || 'Anonymous User',
            avatarColor: profile?.avatarColor || `#${Math.floor(Math.random()*16777215).toString(16)}`,
            status: 'online'
        };

        const userData = {
            userId,
            socketId,
            profile: userProfile,
            lastSeen: new Date(),
            status: 'online'
        };

        this.users.set(userId, userData);
        this.activeUsers.set(userId, socketId);
        return userData;
    }

    getAllUsers() {
        return Array.from(this.users.values()).map(user => ({
            userId: user.userId,
            profile: user.profile,
            status: user.status,
            lastSeen: user.lastSeen
        }));
    }

    removeUser(userId) {
        const user = this.users.get(userId);
        if (user) {
            user.status = 'offline';
            user.lastSeen = new Date();
            this.activeUsers.delete(userId);
        }
        return user;
    }

    getUser(userId) {
        return this.users.get(userId);
    }

    getUserBySocketId(socketId) {
        return Array.from(this.users.values()).find(user => user.socketId === socketId);
    }

    // getAllUsers() {
    //     return Array.from(this.users.values());
    // }

    updateUserStatus(userId, status) {
        const user = this.users.get(userId);
        if (user) {
            user.status = status;
            return true;
        }
        return false;
    }
    isUserOnline(userId) {
        return this.activeUsers.has(userId);
    }

    getSocketId(userId) {
        return this.activeUsers.get(userId);
    }
}

const userManager = new UserManager();

// MongoDB User Schema
const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    googleId: {
        type: String,
        required: true,
        unique: true
    },
    profile: {
        displayName: String,
        avatarColor: String,
        status: {
            type: String,
            enum: ['online', 'offline', 'away'],
            default: 'offline'
        }
    },
    lastLogin: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const User = mongoose.model('User', userSchema);

// Verify Google token
async function verifyGoogleToken(token) {
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        return ticket.getPayload();
    } catch (error) {
        console.error('Token verification error:', error);
        return null;
    }
}

// Login endpoint update
app.post('/api/login', async (req, res) => {
    try {
        const { credential } = req.body;
        
        if (!credential) {
            return res.status(400).json({ message: 'No credential provided' });
        }

        const payload = await verifyGoogleToken(credential);

        if (!payload) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        // Find or create user
        let user = await User.findOne({ googleId: payload.sub });
        
        if (!user) {
            // Create new user
            user = new User({
                email: payload.email,
                googleId: payload.sub,
                profile: {
                    displayName: payload.name,
                    avatarColor: `#${Math.floor(Math.random()*16777215).toString(16)}`,
                    status: 'online'
                }
            });
        }

        user.lastLogin = new Date();
        user.profile.status = 'online';
        await user.save();

        // Send full user data
        res.json({
            userId: user._id,
            profile: user.profile,
            email: user.email
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            message: 'Error during login',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Socket event handlers
io.on('connection', (socket) => {
    socket.on('register', (userData) => {
        console.log('Register event received:', userData);
        try {
            const { userId, profile } = userData;
            const user = userManager.addUser(userId, socket.id, profile);
            console.log('Registered user:', user);
            
            // Emit updated user list to all clients
            const allUsers = userManager.getAllUsers();
            console.log('Broadcasting user list:', allUsers);
            io.emit('userList', allUsers);
        } catch (error) {
            console.error('Registration error:', error);
            socket.emit('error', { message: 'Registration failed' });
        }
    });
    io.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });    
    socket.on('fileMessage', (data) => {
        try {
            const recipientSocketId = userManager.getSocketId(data.recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('fileMessage', {
                    senderId: data.senderId,
                    senderProfile: data.senderProfile,
                    fileData: data.fileData,
                    timestamp: data.timestamp
                });
                
                // Confirm to sender
                socket.emit('messageSent', {
                    success: true,
                    type: 'file',
                    timestamp: data.timestamp
                });
            }
        } catch (error) {
            console.error('File message error:', error);
            socket.emit('error', { 
                message: 'Failed to send file message',
                error: error.message 
            });
        }
    });

    // Handle audio messages
    socket.on('audioMessage', (data) => {
        try {
            const recipientSocketId = userManager.getSocketId(data.recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('audioMessage', {
                    senderId: data.senderId,
                    senderProfile: data.senderProfile,
                    audioData: data.audioData,
                    timestamp: data.timestamp
                });
                
                // Confirm to sender
                socket.emit('messageSent', {
                    success: true,
                    type: 'audio',
                    timestamp: data.timestamp
                });
            }
        } catch (error) {
            console.error('Audio message error:', error);
            socket.emit('error', { 
                message: 'Failed to send voice message',
                error: error.message 
            });
        }
    });

    // Updated privateMessage handler to handle different message types
    socket.on('privateMessage', (data) => {
        try {
            const recipientSocketId = userManager.activeUsers.get(data.recipientId);
            console.log('Recipient Socket ID:', recipientSocketId);
            console.log('Message Data:', data);
    
            if (recipientSocketId) {
                const messageData = {
                    senderId: data.senderId,
                    senderProfile: data.senderProfile,
                    message: data.message,
                    timestamp: new Date(),
                    messageId: Date.now().toString()
                };
    
                io.to(recipientSocketId).emit('privateMessage', messageData);
    
                // Optional: Emit confirmation to the sender
                socket.emit('messageSent', {
                    success: true,
                    messageId: messageData.messageId
                });
            } else {
                console.error('Recipient not connected or active');
            }
        } catch (error) {
            console.error('Message error:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });
    
    // Add these socket listeners in your server.js file
socket.on('fileMessage', (data) => {
    const recipientSocketId = userManager.getSocketId(data.recipientId);
    if (recipientSocketId) {
        io.to(recipientSocketId).emit('fileMessage', data);
    }
});

socket.on('audioMessage', (data) => {
    const recipientSocketId = userManager.getSocketId(data.recipientId);
    if (recipientSocketId) {
        io.to(recipientSocketId).emit('audioMessage', data);
    }
});

    socket.on('typing', (data) => {
        try {
            const recipientSocketId = userManager.activeUsers.get(data.recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('userTyping', {
                    senderId: data.senderId,
                    senderProfile: data.senderProfile,
                    isTyping: data.isTyping
                });
            }
        } catch (error) {
            console.error('Typing indicator error:', error);
        }
    });

    socket.on('updateStatus', async (data) => {
        try {
            const { userId, status } = data;
            const updated = userManager.updateUserStatus(userId, status);
            if (updated) {
                io.emit('userList', userManager.getAllUsers());
                
                // Update status in database
                await User.findByIdAndUpdate(userId, {
                    'profile.status': status
                });
            }
        } catch (error) {
            console.error('Status update error:', error);
            socket.emit('error', { message: 'Failed to update status' });
        }
    });

    socket.on('error', (error) => {
        if (error.message === 'File too large') {
            socket.emit('error', { message: 'File size exceeds limit (100 MB)' });
        }
    });

    socket.on('pong', () => {
        // Update last seen timestamp for user
        const user = userManager.getUserBySocketId(socket.id);
        if (user) {
            user.lastSeen = new Date();
        }
    });

    socket.on('disconnect', () => {
        try {
            const user = userManager.getUserBySocketId(socket.id);
            if (user) {
                userManager.removeUser(user.userId);
                io.emit('userList', userManager.getAllUsers());
                
                // Update user status in database
                User.findByIdAndUpdate(user.userId, {
                    'profile.status': 'offline'
                }).catch(error => {
                    console.error('Error updating user status on disconnect:', error);
                });
            }
            console.log('User disconnected:', socket.id);
        } catch (error) {
            console.error('Disconnect error:', error);
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => {
    console.log('Connected to MongoDB');
})
.catch((error) => {
    console.error('MongoDB connection error:', error);
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    http.close(() => {
        console.log('Server closed');
        mongoose.connection.close(false, () => {
            console.log('MongoDB connection closed');
            process.exit(0);
        });
    });
});