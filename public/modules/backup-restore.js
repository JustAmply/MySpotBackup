export class BackupManager {
	constructor(api, ui, config) {
		this.api = api;
		this.ui = ui;
		this.config = config;
		this.collections = { playlists: {}, saved: [] };
	}

	async loadAccountData() {
		this.ui.setLoading("Loading your playlists and tracks...");
		this.ui.updateProgress("Fetching Playlists", 0, 0, 0, 0);

		try {
			const profile = await this.api.getProfile();
			const userId = profile.id;
			this.ui.showLoggedIn(userId);

			// Load Playlists
			const playlists = await this.api.getMyPlaylists(userId, (count, total) => {
				this.ui.updateProgress("Fetching Playlists", count, total);
			});

			this.collections.playlists = {};
			let trackCount = 0;

			for (let i = 0; i < playlists.length; i++) {
				const p = playlists[i];
				this.ui.updateProgress(
					`Fetching Tracks for ${p.name}`,
					i + 1,
					playlists.length,
					trackCount
				);
				const tracks = await this.api.getPlaylistTracks(p.href);
				p.tracks = tracks;
				delete p.href; // clean up
				this.collections.playlists[p.id] = p;
				trackCount += tracks.length;
			}

			// Load Saved Tracks
			this.ui.updateProgress("Fetching Saved Tracks", playlists.length, playlists.length, 0, 0);
			const saved = await this.api.getMyTracks((count, total) => {
				this.ui.updateProgress(
					"Fetching Saved Tracks",
					playlists.length,
					playlists.length,
					count,
					total
				);
			});
			this.collections.saved = saved;

			this.ui.updateStats(
				"source",
				Object.keys(this.collections.playlists).length,
				trackCount + saved.length
			);
			this.ui.setLoading("Finished loading. Ready to Export or Import.");
			this.ui.enableButtons();
		} catch (e) {
			this.ui.showError("Failed to load account data: " + e.message);
		}
	}

	exportData() {
		const json = JSON.stringify(this.collections);
		const d = new Date();
		const filename = `spotify_backup_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}.json`;
		this.download(filename, json);
	}

	download(filename, text) {
		const element = document.createElement("a");
		element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text));
		element.setAttribute("download", filename);
		element.style.display = "none";
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
	}

	async importData(file) {
		if (!file) return;

		const reader = new FileReader();
		reader.onload = async (e) => {
			try {
				const importColl = JSON.parse(e.target.result);
				this.processImport(importColl);
			} catch (err) {
				console.error(err);
				this.ui.showError("Invalid JSON file");
			}
		};
		reader.readAsText(file);
	}

	async processImport(importColl) {
		// 1. Calculate stats
		let pCount = 0;
		let tCount = 0;
		if (importColl.playlists) {
			pCount = Object.keys(importColl.playlists).length;
			Object.values(importColl.playlists).forEach(
				(p) => (tCount += p.tracks ? p.tracks.length : 0)
			);
		}
		if (importColl.saved) {
			tCount += importColl.saved.length;
		}

		this.ui.updateStats("import", pCount, tCount);

		// 2. Confirm import? (Skipping for now as per current UX, straight to processing)

		this.ui.updateProgress("Comparing...", 0, pCount);

		// 3. Process Saved Tracks
		const savedToImport = [];
		const currentSavedIds = new Set(this.collections.saved.map((t) => t.id));

		if (importColl.saved) {
			importColl.saved.forEach((t) => {
				if (!currentSavedIds.has(t.id)) {
					savedToImport.push(t.id);
				}
			});
		}

		// 4. Process Playlists
		// Simplified logic: If playlist name exists, we assume it's the same and we can append tracks?
		// Original app logic: "If existingByName && !isNameDuplicatedInImport -> use existing".
		// Let's stick to: Create new if not exists, or if duplicate name.
		// Actually, to be safe and simple: Create new playlists for everything import, maybe with a suffix if needed?
		// The original app logic tries to match by name.

		const currentPlaylistsByName = {};
		Object.values(this.collections.playlists).forEach((p) => {
			currentPlaylistsByName[p.name] = p;
		});

		const playlistActions = [];

		if (importColl.playlists) {
			for (const pid in importColl.playlists) {
				const p = importColl.playlists[pid];
				const existing = currentPlaylistsByName[p.name];
				let targetId;

				if (existing) {
					// Check which tracks are missing
					targetId = existing.id;
					const currentTrackUris = new Set(existing.tracks.map((t) => t.uri));
					const missingUris = p.tracks
						.filter((t) => !currentTrackUris.has(t.uri))
						.map((t) => t.uri);
					if (missingUris.length > 0) {
						playlistActions.push({ id: targetId, uris: missingUris, name: p.name });
					}
				} else {
					// Create new
					const uris = p.tracks.map((t) => t.uri);
					if (uris.length > 0) {
						playlistActions.push({ create: true, name: p.name, uris: uris });
					}
				}
			}
		}

		// EXECUTION PHASE
		const totalOps = savedToImport.length > 0 ? 1 : 0 + playlistActions.length;
		let opsDone = 0;

		if (savedToImport.length > 0) {
			this.ui.updateProgress("Importing Saved Tracks", 0, 0, 0, savedToImport.length);
			await this.api.saveTracks(savedToImport);
			opsDone++;
		}

		const profile = await this.api.getProfile();
		const userId = profile.id;

		for (const action of playlistActions) {
			opsDone++;
			this.ui.updateProgress(`Processing Playlist: ${action.name}`, opsDone, totalOps);

			if (action.create) {
				const newPl = await this.api.createPlaylist(userId, action.name);
				await this.api.addTracksToPlaylist(newPl.id, action.uris);
			} else {
				await this.api.addTracksToPlaylist(action.id, action.uris);
			}
		}

		this.ui.updateProgress("Import Finished!", opsDone, totalOps);
		this.ui.setLoading("Import Complete.");
		// Reload account data to reflect changes
		await this.loadAccountData();
	}
}
