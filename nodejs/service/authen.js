const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Pool } = require('pg');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
require('dotenv').config();

// trust nginx reverse proxy so cookies and protocol detection work correctly over HTTPS
app.set('trust proxy', 1);

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: (process.env.GOOGLE_CALLBACK_URL || '').startsWith('https'),
        sameSite: 'lax',
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, google_id, display_name, email, photo FROM users WHERE id = $1',
            [id]
        );
        done(null, rows[0] || null);
    } catch (err) {
        done(err);
    }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/rub/auth/callback',
},
    async (accessToken, refreshToken, profile, done) => {
        const googleId = profile.id;
        const displayName = profile.displayName;
        const email = profile.emails?.[0]?.value;
        const photo = profile.photos?.[0]?.value;

        try {
            let { rows } = await pool.query(
                'SELECT id FROM users WHERE google_id = $1',
                [googleId]
            );

            let userId;
            if (rows.length) {
                userId = rows[0].id;
                await pool.query(
                    'UPDATE users SET display_name = $1, email = $2, photo = $3 WHERE id = $4',
                    [displayName, email, photo, userId]
                );
            } else {
                ({ rows } = await pool.query(
                    `INSERT INTO users (google_id, display_name, email, photo)
                        VALUES ($1, $2, $3, $4)
                        RETURNING id`,
                    [googleId, displayName, email, photo]
                ));
                userId = rows[0].id;
            }

            done(null, { id: userId, googleId, displayName, email, photo });
        } catch (err) {
            done(err);
        }
    }
));

app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/callback',
    passport.authenticate('google', { failureRedirect: '/rub/index.html' }),
    (req, res) => {
        const { id, displayName, email, photo } = req.user;
        req.session.user = { id, displayName, email, photo };
        res.redirect('/rub/index.html');
    }
);

app.get('/auth/me', (req, res) => {
    if (!req.session.user) return res.json({ user: null });
    res.json({ user: req.session.user });
});

// Logout
app.get('/auth/logout', (req, res) => {
    req.logout(() => {
        console.log('User logged out');
        res.json({ success: true });
    });
});

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

// Example protected endpoint
app.get('/protected', ensureAuthenticated, (req, res) => {
    console.log(`User ID: ${req.user}`);

    res.send(`Hello, ${req.user.display_name}!`);
});

module.exports = app;