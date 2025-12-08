// Keeping some jQuery usage as rewriting the whole DOM manipulation to vanilla JS is out of scope
// and the prompt says "Refactor public/app.js into modular ES6+ JavaScript files" but doesn't ban jQuery.
// However, I will wrap it cleanly.

export class UIManager {
	constructor() {
		this.$loginRead = $("#btn-login-read");
		this.$loginWrite = $("#btn-login-write");
		this.$pnlLoggedOut = $("#pnlLoggedOut");
		this.$pnlAction = $("#pnlAction");
		this.$pnlLoadingAccount = $("#pnlLoadingAccount");
		this.$userName = $("#userName");

		this.$btnExport = $("#btnExport");
		this.$btnImport = $("#btnImport");

		this.$pnlImport = $("#pnlImport");
		this.$fileImport = $("#fileImport");

		this.$progressBar = $("#progressBar");

		// Stats
		this.$loadingPlaylists = $("#loadingPlaylists");
		this.$loadingTracks = $("#loadingTracks");
		this.$filePlaylists = $("#filePlaylists");
		this.$fileTracks = $("#fileTracks");

		// Progress Labels
		this.$globalStep = $("#globalStep");
		this.$playlistStep = $("#playlistStep");
		this.$playlistTotal = $("#playlistTotal");
		this.$trackStep = $("#trackStep");
		this.$trackTotal = $("#trackTotal");
	}

	setLoading(msg) {
		$("#loadingTitle").text(msg);
		this.$pnlLoadingAccount.show();
	}

	showLoggedIn(username) {
		this.$userName.text(username);
		this.$pnlLoggedOut.hide();
		this.$pnlAction.show();
	}

	showImportPanel() {
		this.$pnlAction.hide();
		this.$pnlImport.show();
	}

	updateProgress(global, pStep, pTotal, tStep, tTotal) {
		if (global) {
			this.$globalStep.text(global);
			$("#loadingTitle").text(global);
		}
		if (pStep !== undefined) {
			this.$playlistStep.text(pStep);
			this.$loadingPlaylists.text(
				pTotal ? `${pStep} / ${pTotal} playlists` : `${pStep} playlists`
			);
		}
		if (pTotal !== undefined) this.$playlistTotal.text(pTotal);
		if (tStep !== undefined) {
			this.$trackStep.text(tStep);
			this.$loadingTracks.text(
				tTotal ? `${tStep} / ${tTotal} tracks` : `${tStep} tracks`
			);
		}
		if (tTotal !== undefined) this.$trackTotal.text(tTotal);

		if (tTotal > 0) {
			const pct = Math.floor((tStep / tTotal) * 100);
			this.$progressBar.css("width", `${pct}%`);
			this.$progressBar.show();
		} else {
			this.$progressBar.hide();
		}
	}

	updateStats(type, playlists, tracks) {
		if (type === "source") {
			this.$loadingPlaylists.text(`${playlists} playlists`);
			this.$loadingTracks.text(`${tracks} tracks`);
		} else if (type === "import") {
			this.$filePlaylists.text(`${playlists} playlists`);
			this.$fileTracks.text(`${tracks} tracks`);
		}
	}

	showError(msg) {
		alert(msg); // Simple alert for now, could be better
		console.error(msg);
	}
}
