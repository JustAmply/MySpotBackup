import { AuthManager } from "./modules/auth.js";
import { UIManager } from "./modules/ui.js";
import { SpotifyApi } from "./modules/spotify-api.js";
import { BackupManager } from "./modules/backup-restore.js";

let config = null;

async function init() {
	const ui = new UIManager();

	try {
		const res = await fetch("/config");
		config = await res.json();
	} catch (e) {
		console.error(e);
		ui.showError("Failed to load config");
		return;
	}

	const auth = new AuthManager(config);

	// Check if we are returning from login
	auth.checkForHashToken((token) => {
		startApp(token, ui, config);
	});

	$("#login").on("click", () => {
		// Default to read/write for now as the UI button is generic "Login" in the old HTML
		// But we will update HTML to have two buttons.
		// For now, let's assume the old button triggers 'read' (export) or we need to ask user.
		// Wait, I am refactoring HTML too.
		auth.login("write"); // fallback
	});

	// Bind new buttons if they exist
	$("#btn-login-read").on("click", () => auth.login("read"));
	$("#btn-login-write").on("click", () => auth.login("write"));

	// Bind message listener for popup
	window.addEventListener(
		"message",
		(event) => {
			auth.handleMessage(event, (token) => {
				startApp(token, ui, config);
			});
		},
		false
	);
}

function startApp(token, ui, config) {
	const api = new SpotifyApi(token, config.slowdown_import); // use import slowdown as default or split
	const backupManager = new BackupManager(api, ui, config);

	backupManager.loadAccountData();

	$("#btnExport").on("click", () => backupManager.exportData());
	$("#btnImport").on("click", () => $("#fileImport").click());
	$("#fileImport").on("change", (e) => backupManager.importData(e.target.files[0]));
}

$(document).ready(init);
