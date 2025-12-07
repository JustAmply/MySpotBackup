const nodeCrypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const { stringify } = require("querystring");

// Scopes required by the Spotify OAuth flow.
const scopes = [
	"user-read-private",
	"user-read-email",
	"playlist-read-private",
	"playlist-read-collaborative",
	"playlist-modify-public",
	"playlist-modify-private",
	"user-library-read",
	"user-library-modify",
];

/**
 * Builds an Express application configured for the Spotify auth flow.
 * Dependencies are injected to make the server easier to test and extend.
 */
function createServer({ config, authStateStore, fetchFn = fetch, cryptoLib = nodeCrypto } = {}) {
	if (!config) throw new Error("createServer requires a config object");
	if (!authStateStore) throw new Error("createServer requires an authStateStore instance");

	const app = express();
	app.use(
		helmet({
			// Keep window.opener available for the OAuth popup; COOP would null it after the Spotify redirect.
			crossOriginOpenerPolicy: false,
			contentSecurityPolicy: {
				useDefaults: true,
				directives: {
					connectSrc: ["'self'", "https://api.spotify.com"],
					styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
					fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
				},
			},
		})
	);
	const publicDir = path.join(__dirname, "..", "..", "public");
	app.use(express.static(publicDir));

	app.get("/login", async function (req, res) {
		if (!config.client_id) {
			res.status(500).send("Missing CLIENT_ID configuration");
			return;
		}

		const codeVerifier = generateRandomString(128, cryptoLib);
		const state = generateRandomString(16, cryptoLib);

		authStateStore.storeState(state, codeVerifier);

		res.redirect(
			"https://accounts.spotify.com/authorize?" +
				stringify({
					response_type: "code",
					client_id: config.client_id,
					scope: scopes.join(" "),
					redirect_uri: config.callback_uri,
					state,
					code_challenge_method: "S256",
					code_challenge: await generateCodeChallenge(codeVerifier, cryptoLib),
				})
		);
	});

	app.get("/config", function (req, res) {
		res.json(config);
	});

	app.get("/callback", async function (req, res) {
		const code = req.query.code || null;
		const state = req.query.state || null;

		if (!code) {
			res.redirect("/#" + stringify({ error: "missing_code" }));
			return;
		}

		if (!state) {
			res.status(400).send("OAuth state is missing or invalid. Please restart the login flow.");
			return;
		}

		const { status, entry } = authStateStore.take(state);
		if (status === "missing") {
			res.status(400).send("OAuth state is missing or invalid. Please restart the login flow.");
			return;
		}

		if (status === "expired") {
			res.status(400).send("OAuth state is expired. Please restart the login flow.");
			return;
		}

		const { token, error } = await getAccessToken({
			code,
			codeVerifier: entry.codeVerifier,
			config,
			fetchFn,
		});
		if (error) {
			res
				.status(400)
				.send(
					`Error during getAccessToken: ${error}. Restart your session and try again. <a href="/">Home Page</a>`
				);
			return;
		}
		res.set("Cache-Control", "no-store, max-age=0");
		const safeConfigOrigin = JSON.stringify(config.uri);
		const safeToken = JSON.stringify(token);
		const fallbackHtml =
			"<p>Login complete. You can close this window.</p><p>If it does not close automatically, return to the original tab.</p>";
		res.send(
			"<!doctype html><html><body><script>" +
				`window.onload = () => {
  const opener = window.opener;
  const token = ${safeToken};
  let targetOrigin = ${safeConfigOrigin};

  try {
    if (opener && opener.location && opener.location.origin) {
      targetOrigin = opener.location.origin;
    }
  } catch (err) {
    console.warn("unable to read opener origin", err);
  }

  if (opener && !opener.closed) {
    try {
      opener.postMessage({token}, targetOrigin);
      window.close();
      return;
    } catch (err) {
      console.warn("postMessage to opener failed", err);
    }
  }

  try {
    window.location.replace("/");
  } catch (err) {
    console.warn("unable to redirect to home", err);
  }
};` +
				`</script>${fallbackHtml}</body></html>`
		);
	});

	return app;
}

function generateRandomString(length, cryptoLib) {
	return cryptoLib.randomBytes(length).toString("base64url").slice(0, length);
}

async function generateCodeChallenge(codeVerifier, cryptoLib) {
	const digest = cryptoLib.createHash("sha256").update(codeVerifier).digest("base64");
	return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken({ code, codeVerifier, config, fetchFn }) {
	const payload = {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: config.client_id,
			grant_type: "authorization_code",
			code,
			redirect_uri: config.callback_uri,
			code_verifier: codeVerifier,
		}),
	};

	const response = await fetchFn("https://accounts.spotify.com/api/token", payload);
	let responseBody;
	try {
		responseBody = await response.json();
	} catch {
		return { token: null, error: `token endpoint returned ${response.status}` };
	}

	if (!response.ok) {
		const message = responseBody.error_description || responseBody.error || response.statusText;
		return { token: null, error: message };
	}

	const { access_token, error } = responseBody;
	return { token: access_token, error };
}

module.exports = {
	createServer,
	generateRandomString,
	generateCodeChallenge,
	getAccessToken,
};
