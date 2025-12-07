const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const {stringify} = require('querystring');

loadEnvFile();

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

const app = express();
const codeVerifier = generateRandomString(128);

function generateRandomString(length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

app.use(express.static('public'));

app.get('/login', async function (req, res) {
    res.redirect('https://accounts.spotify.com/authorize?' + stringify({
        response_type: 'code',
        client_id: config.client_id,
        scope: 'user-read-private user-read-email playlist-read playlist-read-private playlist-modify-public playlist-modify-private user-library-read user-library-modify',
        redirect_uri: config.callback_uri,
        state: generateRandomString(16),
        code_challenge_method: "S256",
        code_challenge: await generateCodeChallenge(codeVerifier),
    }));
});

app.get('/config', function (req, res) {
    res.json(config);
});

app.get('/callback', async function (req, res) {

    var code = req.query.code || null;
    var state = req.query.state || null;

    if (state === null) {
        res.redirect('/#' + stringify({error: 'state_mismatch'}));
    } else {
        const {token, error} = await getAccessToken(code);
        if (error) {
            res.send(`Error during getAccessToken: ${error}, probably a invalid session. Restart your server and go to the <a href="/">Home Page</a>`)
        }
        res.send(`Congrats! Your Code is <br/>  ${code} <br/> and the token is <br/> ${token}<br/> , submitting to parent page now.` + `<script type='text/javascript'>window.onload = () => { console.log("posting", "${{token}}", "${config.uri}"); window.opener.postMessage({token:"${token}"}, "${config.uri}");}</script>`);
    }
});

async function getAccessToken(code) {
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
    const responseBody = await response.json();

    const {access_token, error} = responseBody;
    return {token: access_token, error};
}

function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
        return;
    }

    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        if (key && !(key in process.env)) {
            process.env[key] = value;
        }
    }
}


app.listen(config.port, () => {
    console.log(`MySpotBackup is running`, config);
});
