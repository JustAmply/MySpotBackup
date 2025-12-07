require("dotenv").config();
const { loadConfig } = require("./lib/config");
const AuthStateStore = require("./lib/auth-state-store");
const { createServer } = require("./lib/server");

let config;
try {
	config = loadConfig(process.env);
} catch (error) {
	console.error("Invalid configuration:", error.message);
	process.exit(1);
}
const AUTH_STATE_TTL_MS = 5 * 60 * 1000;
const AUTH_STATE_SWEEP_MS = 60 * 1000;
const authStateStore = new AuthStateStore({
	ttlMs: AUTH_STATE_TTL_MS,
	sweepMs: AUTH_STATE_SWEEP_MS,
});

const app = createServer({ config, authStateStore });

app.listen(config.port, () => {
	console.log(`MySpotBackup is running`, config);
});
