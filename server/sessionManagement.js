const session = require('express-session');
const MongoStore = require('connect-mongo');
const { v4: uuidv4 } = require('uuid');

// Session management configuration
const configureSessionManagement = (app, mongoUri) => {
    // Session configuration
    const sessionConfig = {
        secret: process.env.SESSION_SECRET || uuidv4(),
        name: 'chat.sid', // Custom session ID cookie name
        resave: false,
        saveUninitialized: false,
        rolling: true, // Reset expiration on each request
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        },
        store: MongoStore.create({
            mongoUrl: mongoUri,
            collectionName: 'sessions',
            ttl: 24 * 60 * 60, // Session TTL (in seconds)
            autoRemove: 'native',
            crypto: {
                secret: process.env.MONGO_STORE_SECRET || uuidv4()
            }
        })
    };

    // Apply session middleware
    app.use(session(sessionConfig));

    // Session monitoring middleware
    app.use((req, res, next) => {
        if (!req.session) {
            return next(new Error('Session initialization failed'));
        }
        next();
    });
};

// Session authentication middleware
const requireAuth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ message: 'Authentication required' });
    }
    
    try {
        // Verify user exists in database
        const user = await User.findById(req.session.userId);
        if (!user) {
            req.session.destroy();
            return res.status(401).json({ message: 'User not found' });
        }
        
        // Add user to request object
        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
};

// Session management class
class SessionManager {
    constructor(store) {
        this.store = store;
        this.activeSessions = new Map();
    }

    // Create new session
    async createSession(userId, userProfile) {
        const sessionId = uuidv4();
        const session = {
            id: sessionId,
            userId,
            userProfile,
            createdAt: new Date(),
            lastActive: new Date()
        };

        await this.store.set(sessionId, session);
        this.activeSessions.set(userId, sessionId);
        return sessionId;
    }

    // Validate session
    async validateSession(sessionId) {
        const session = await this.store.get(sessionId);
        if (!session) return false;

        session.lastActive = new Date();
        await this.store.set(sessionId, session);
        return session;
    }

    // End session
    async endSession(sessionId) {
        const session = await this.store.get(sessionId);
        if (session) {
            this.activeSessions.delete(session.userId);
            await this.store.destroy(sessionId);
        }
    }

    // Clean up expired sessions
    async cleanupSessions() {
        const sessions = await this.store.all();
        const now = new Date();
        
        for (const [sessionId, session] of Object.entries(sessions)) {
            const lastActive = new Date(session.lastActive);
            if (now - lastActive > 24 * 60 * 60 * 1000) {
                await this.endSession(sessionId);
            }
        }
    }
}

// Update login endpoint to include session management
const updateLoginEndpoint = (app, sessionManager) => {
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

            // Create session
            const sessionId = await sessionManager.createSession(user._id, user.profile);

            // Set session cookie
            req.session.userId = user._id;
            req.session.sessionId = sessionId;

            res.json({
                userId: user._id,
                profile: user.profile,
                email: user.email,
                sessionId
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ 
                message: 'Error during login',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });
};

// Socket authentication middleware
const socketAuth = (sessionManager) => async (socket, next) => {
    try {
        const sessionId = socket.handshake.auth.sessionId;
        if (!sessionId) {
            return next(new Error('Authentication required'));
        }

        const session = await sessionManager.validateSession(sessionId);
        if (!session) {
            return next(new Error('Invalid session'));
        }

        socket.sessionId = sessionId;
        socket.userId = session.userId;
        socket.userProfile = session.userProfile;
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = {
    configureSessionManagement,
    requireAuth,
    SessionManager,
    updateLoginEndpoint,
    socketAuth
};