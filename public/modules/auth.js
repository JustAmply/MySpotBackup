export class AuthManager {
	constructor(config) {
		this.config = config;
		this.token = null;
		this.authWindow = null;
	}

	login(scopeType) {
		if (!this.config) {
			console.error("Config missing");
			return;
		}

		const width = 480;
		const height = 640;
		const left = (window.screen.width - width) / 2;
		const top = (window.screen.height - height) / 2;
		const url = `${this.config.login_url}?scopeType=${scopeType}`;

		this.authWindow = window.open(
			url,
			"Spotify Login",
			`menubar=no,location=no,resizable=no,scrollbars=no,status=no,width=${width},height=${height},top=${top},left=${left}`
		);

		// Fallback
		if (!this.authWindow) {
			window.location.href = url;
		}
	}

	handleMessage(event, callback) {
		// Validate origin
		// Note: In development localhost might vary, so we should check against config
		if (
			this.config &&
			event.origin !== this.config.uri &&
			event.origin !== window.location.origin
		) {
			return;
		}

		if (event.data.token) {
			this.token = event.data.token;
			if (this.authWindow) this.authWindow.close();
			callback(this.token);
		}
	}

	checkForHashToken(callback) {
		const hash = window.location.hash;
		if (hash && hash.includes("token=")) {
			const params = new URLSearchParams(hash.substring(1));
			const token = params.get("token");
			if (token) {
				this.token = token;
				// clear hash
				window.history.replaceState(null, document.title, window.location.pathname);
				callback(token);
			}
		}
	}
}
