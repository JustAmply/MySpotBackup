export class SpotifyApi {
	constructor(token, slowdownMs = 100) {
		this.token = token;
		this.slowdownMs = slowdownMs;
	}

	async fetch(url, options = {}) {
		const headers = {
			Authorization: `Bearer ${this.token}`,
			"Content-Type": "application/json",
			...options.headers,
		};

		let attempts = 0;
		const maxAttempts = 5;

		while (attempts < maxAttempts) {
			attempts++;
			const res = await fetch(url, { ...options, headers });

			if (res.status === 429) {
				const retryAfter = res.headers.get("Retry-After");
				const backoff = retryAfter
					? parseInt(retryAfter, 10) * 1000
					: Math.min(30000, 500 * Math.pow(2, attempts));
				console.warn(`Rate limited. Retrying in ${backoff}ms`);
				await new Promise((r) => setTimeout(r, backoff));
				continue;
			}

			if (!res.ok) {
				throw new Error(`Spotify API Error: ${res.status} ${res.statusText}`);
			}

			// Handle empty responses (like 204 No Content, or some PUT requests)
			const contentLength = res.headers.get("Content-Length");
			if (contentLength === "0" || res.status === 204) {
				return null;
			}

			return res.json();
		}
		throw new Error("Max retry attempts exceeded");
	}

	async getAllPages(url, callback) {
		let nextUrl = url;
		const items = [];
		while (nextUrl) {
			const data = await this.fetch(nextUrl);
			if (data.items) {
				if (callback) {
					// If a callback is provided, process items immediately and don't store them all in memory if possible?
					// The current app stores everything in memory. Let's replicate that for now but allow for processing.
					// Actually, strict replication of current logic:
					items.push(...data.items);
				} else {
					items.push(...data.items);
				}
			} else if (data.tracks && data.tracks.items) {
				// Handle playlists where tracks are nested
				items.push(...data.tracks.items);
			}

			nextUrl = data.next;
			if (nextUrl && this.slowdownMs > 0) {
				await new Promise((r) => setTimeout(r, this.slowdownMs));
			}
		}
		return items;
	}

	async getProfile() {
		return this.fetch("https://api.spotify.com/v1/me");
	}

	async getMyTracks(callback) {
		// Using a generator or callback approach for progress updates would be good
		// For now, let's implement the chunk loader pattern
		const items = [];
		let url = "https://api.spotify.com/v1/me/tracks?limit=50";

		while (url) {
			const data = await this.fetch(url);
			if (!data) break;

			if (data.items) {
				data.items.forEach((item) => {
					if (item.track) items.push({ id: item.track.id, uri: item.track.uri });
				});
			}
			url = data.next;
			if (callback) callback(items.length, data.total);
			if (url && this.slowdownMs > 0) await new Promise((r) => setTimeout(r, this.slowdownMs));
		}
		return items;
	}

	async getMyPlaylists(userId, callback) {
		const items = [];
		let url = `https://api.spotify.com/v1/users/${userId}/playlists?limit=50`;

		while (url) {
			const data = await this.fetch(url);
			if (!data) break;

			if (data.items) {
				for (const playlist of data.items) {
					// We need to fetch tracks for each playlist
					// Ideally we queue this up, but let's just get the playlist metadata first
					items.push({
						name: playlist.name,
						id: playlist.id,
						href: playlist.tracks.href,
						tracks: [], // will fill later
					});
				}
			}
			url = data.next;
			if (callback) callback(items.length, data.total);
			if (url && this.slowdownMs > 0) await new Promise((r) => setTimeout(r, this.slowdownMs));
		}
		return items;
	}

	async getPlaylistTracks(href, callback) {
		const tracks = [];
		let url = href;
		while (url) {
			const data = await this.fetch(url);
			if (!data) break;
			if (data.items) {
				data.items.forEach((item) => {
					if (item.track) tracks.push({ id: item.track.id, uri: item.track.uri });
				});
			}
			url = data.next;
			if (callback) callback(tracks.length, data.total);
			if (url && this.slowdownMs > 0) await new Promise((r) => setTimeout(r, this.slowdownMs));
		}
		return tracks;
	}

	async createPlaylist(userId, name, isPublic = false) {
		return this.fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
			method: "POST",
			body: JSON.stringify({ name, public: isPublic }),
		});
	}

	async addTracksToPlaylist(playlistId, uris) {
		// Max 100 tracks per request
		const chunks = [];
		for (let i = 0; i < uris.length; i += 100) {
			chunks.push(uris.slice(i, i + 100));
		}

		for (const chunk of chunks) {
			await this.fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
				method: "POST",
				body: JSON.stringify({ uris: chunk }),
			});
			if (this.slowdownMs > 0) await new Promise((r) => setTimeout(r, this.slowdownMs));
		}
	}

	async saveTracks(ids) {
		// Max 50 tracks per request
		const chunks = [];
		for (let i = 0; i < ids.length; i += 50) {
			chunks.push(ids.slice(i, i + 50));
		}

		for (const chunk of chunks) {
			await this.fetch("https://api.spotify.com/v1/me/tracks", {
				method: "PUT",
				body: JSON.stringify({ ids: chunk }),
			});
			if (this.slowdownMs > 0) await new Promise((r) => setTimeout(r, this.slowdownMs));
		}
	}
}
