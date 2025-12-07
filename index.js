require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const {stringify} = require('querystring');

const port = Number(process.env.PORT || 8080);
const baseUri = process.env.PUBLIC_URI || `http://localhost:${port}`;
const config = {
    port,
    uri: baseUri,
    login_url: `${baseUri}/login`,
    callback_uri: `${baseUri}/callback`,
    client_id: process.env.CLIENT_ID || '',
    slowdown_import: Number(process.env.SLOWDOWN_IMPORT || 100),
    slowdown_export: Number(process.env.SLOWDOWN_EXPORT || 100),
};
const scopes = [
    'user-read-private',
    'user-read-email',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-modify-private',
    'user-library-read',
    'user-library-modify',
];
const authStateStore = new Map();
const AUTH_STATE_TTL_MS = 5 * 60 * 1000;

const app = express();

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

async function generateCodeChallenge(codeVerifier) {
    const digest = crypto.createHash('sha256').update(codeVerifier).digest('base64');
    return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

app.use(express.static('public'));

app.get('/login', async function (req, res) {
    if (!config.client_id) {
        res.status(500).send('Missing CLIENT_ID configuration');
        return;
    }

    const codeVerifier = generateRandomString(128);
    const state = generateRandomString(16);

    authStateStore.set(state, {codeVerifier, createdAt: Date.now()});

    res.redirect('https://accounts.spotify.com/authorize?' + stringify({
        response_type: 'code',
        client_id: config.client_id,
        scope: scopes.join(' '),
        redirect_uri: config.callback_uri,
        state,
        code_challenge_method: "S256",
        code_challenge: await generateCodeChallenge(codeVerifier),
    }));
});

app.get('/config', function (req, res) {
    res.json(config);
});

app.get('/callback', async function (req, res) {

    const code = req.query.code || null;
    const state = req.query.state || null;
    const stored = state ? authStateStore.get(state) : null;
    const isExpired = stored && (Date.now() - stored.createdAt > AUTH_STATE_TTL_MS);

    if (!code) {
        res.redirect('/#' + stringify({error: 'missing_code'}));
        return;
    }

    if (state === null || !stored || isExpired) {
        if (state && stored) {
            authStateStore.delete(state);
        }
        res.redirect('/#' + stringify({error: 'state_mismatch'}));
    } else {
        authStateStore.delete(state);
        const {token, error} = await getAccessToken(code, stored.codeVerifier);
        if (error) {
            res.status(400).send(`Error during getAccessToken: ${error}. Restart your session and try again. <a href="/">Home Page</a>`);
            return;
        }
        res.send(`Congrats! Your Code is <br/>  ${code} <br/> and the token is <br/> ${token}<br/> , submitting to parent page now.` + `<script type='text/javascript'>window.onload = () => { console.log("posting", "${{token}}", "${config.uri}"); window.opener.postMessage({token:"${token}"}, "${config.uri}");}</script>`);
    }
});

async function getAccessToken(code, codeVerifier) {
    const payload = {
        method: 'POST', headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        }, body: new URLSearchParams({
            client_id: config.client_id,
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.callback_uri,
            code_verifier: codeVerifier,
        }),
    }

    const response = await fetch("https://accounts.spotify.com/api/token", payload);
    let responseBody;
    try {
        responseBody = await response.json();
    } catch (error) {
        return {token: null, error: `token endpoint returned ${response.status}`};
    }

    if (!response.ok) {
        const message = responseBody.error_description || responseBody.error || response.statusText;
        return {token: null, error: message};
    }

    const {access_token, error} = responseBody;
    return {token: access_token, error};
}

app.listen(config.port, () => {
    console.log(`MySpotBackup is running`, config);
});
