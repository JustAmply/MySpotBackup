import "dotenv/config";
import { loadConfig } from "./config";
import { AuthStateStore } from "./auth/auth-state-store";
import { createServer } from "./server/create-server";

let config;
try {
	config = loadConfig(process.env);
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error("Invalid configuration:", error.message);
	} else {
		console.error("Invalid configuration:", error);
	}
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
