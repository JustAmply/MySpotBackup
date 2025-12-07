"use strict";

var conf = null;

var authWindow = null;
var token = null;
var userId = "";
var collections = {};
var accountName = "spotify";
var importColl = null;

var isImporting = false;
var isExporting = false;
var globalStep = "";
var playlistStep = 0;
var playlistTotal = 0;
var trackStep = 0;
var trackTotal = 0;

var playlistQueue = [];
var savedQueue = [];

var importPlaylistNameCounts = {};
var makingChanges = false;

async function loadConfig() {
	try {
		var response = await fetch("/config");
		if (!response.ok) {
			throw new Error("Unable to load config: " + response.status);
		}
		conf = await response.json();
		$("#login").prop("disabled", false);
	} catch (error) {
		console.log("Failed to load configuration", error);
		$("#pnlLoggedOut").html("Configuration failed to load. Please verify the server environment.");
		$("#login").prop("disabled", true);
		throw error;
	}
}

function refreshTrackData(callback) {
	if (!isExporting && !isImporting) {
		isExporting = true;
		resetCounter();
		$("#pnlLoadingAccount").show();
		$("#loadingTitle").html("Please wait. Loading your playlists and tracks ...");
		refreshPlaylist(function () {
			refreshMyMusicTracks(function () {
				// refreshStarredTracks(function () {
				$("#loadingTitle").html("Finished loading, you now might want to export or import.");
				isExporting = false;
				callback();
				// });
			});
		});
	}
}

function resetCounter() {
	globalStep = "";
	playlistStep = 0;
	playlistTotal = 0;
	trackStep = 0;
	trackTotal = 0;
}

function refreshProgress() {
	$("#globalStep").html(globalStep);
	$("#playlistStep").html(playlistStep);
	$("#playlistTotal").html(playlistTotal);
	$("#trackStep").html(trackStep);
	$("#trackTotal").html(trackTotal);
	var progress = 0;
	if (trackTotal > 0) {
		progress = Math.floor((trackStep / trackTotal) * 100);
	}
	$("#progressBar").css("width", progress + "%");
	if (typeof collections !== "undefined" && !makingChanges) {
		var set = collectionProperties(collections);
		$("#loadingPlaylists").html("" + set.playlistCount + " playlists");
		$("#loadingTracks").html("" + set.trackCount + " tracks");
	}
	if (typeof importColl !== "undefined") {
		var set2 = collectionProperties(importColl);
		$("#filePlaylists").html("" + set2.playlistCount + " playlists");
		$("#fileTracks").html("" + set2.trackCount + " tracks");
	}
	setTimeout(refreshProgress, 1000);
}

function login() {
	if (!conf) {
		console.log("Configuration missing; cannot start login.");
		return;
	}
	if (!conf.login_url) {
		console.log("Login URL missing; cannot start login.");
		return;
	}
	var width = 480,
		height = 640;
	var left = screen.width / 2 - width / 2;
	var top = screen.height / 2 - height / 2;

	authWindow = window.open(
		conf.login_url,
		"Spotify",
		"menubar=no,location=no,resizable=no,scrollbars=no,status=no, width=" +
			width +
			", height=" +
			height +
			", top=" +
			top +
			", left=" +
			left
	);

	// Some browsers block popups; fall back to navigating in the same tab.
	if (!authWindow || authWindow.closed || typeof authWindow.closed === "undefined") {
		window.location.href = conf.login_url;
	}
}

function authCallback(event) {
	if (!conf) {
		console.log("Configuration missing; cannot validate auth callback origin.");
		return;
	}
	var currentOrigin = window.location.origin;
	if (event.origin !== conf.uri && event.origin !== currentOrigin) {
		console.log("Unexpected auth callback origin:", {
			expected: conf.uri,
			current: currentOrigin,
			got: event.origin,
		});
		return;
	}
	if (authWindow && event.source !== authWindow) {
		console.log("Ignoring message from unexpected source window.");
		return;
	}
	if (event.data.token) {
		if (authWindow) {
			authWindow.close();
		}
		handleAuth(event.data.token);
	}
}

function download(filename, text) {
	var pom = document.createElement("a");
	pom.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text));
	pom.setAttribute("download", filename);

	if (document.createEvent) {
		var event = document.createEvent("MouseEvents");
		event.initEvent("click", true, true);
		pom.dispatchEvent(event);
	} else {
		pom.click();
	}
}

function readFile(evt) {
	//Retrieve the first (and only!) File from the FileList object
	var f = evt.target.files[0];

	if (f) {
		$("#fileName").html(f.name);

		var r = new FileReader();
		r.onload = function (e) {
			var json = e.target.result;

			importColl = JSON.parse(json);

			$("#pnlFile").hide();
			$("#pnlFileInfo").show();
			$("#pnlUpload").show();

			compareEverything();
		};
		r.readAsText(f);
	} else {
		alert("Failed to load file");
	}
}

function collectionProperties(coll) {
	if (!coll || !coll.playlists) {
		return { playlistCount: 0, trackCount: 0 };
	}
	return { playlistCount: collPlaylistCount(coll), trackCount: collTrackCount(coll) };
}

function collTrackCount(coll) {
	var count = 0;
	var playlists = _.values(coll.playlists || {});
	$.each(playlists, function (index, playlist) {
		count += (playlist.tracks || []).length;
	});
	if (coll.starred) {
		count += coll.starred.length;
	}
	if (coll.saved) {
		count += coll.saved.length;
	}
	return count;
}

function collPlaylistCount(coll) {
	var playlists = coll.playlists || {};
	var count = _.keys(playlists).length;
	var hasImportedStarred = _.some(playlists, function (value) {
		return value.name === "importedStarred";
	});
	if (!hasImportedStarred) {
		count++;
	}
	return count;
}

function compareEverything() {
	if (!isImporting && !isExporting) {
		isImporting = true;
		makingChanges = true;
		resetCounter();

		savedQueue = [];
		playlistQueue = [];

		globalStep = "Uploading";
		if (typeof importColl !== "undefined") {
			importPlaylistNameCounts = {};
			_.each(importColl.playlists || {}, function (playlist) {
				var playlistName = playlist.name || "";
				importPlaylistNameCounts[playlistName] = (importPlaylistNameCounts[playlistName] || 0) + 1;
			});

			playlistTotal = collPlaylistCount(importColl);

			// TONOTDO:compare starred -> can not really do that since there is no api to manipulate those
			// instead we just create a replacement-standard-list
			globalStep = "Comparing starred tracks";

			makeSureImportedStarredExists(function () {
				if (importColl.starred && importColl.starred.length > 0) {
					compareUriTracks(importColl.starred, collections.starred || [], addToStarred);
				}
				// compare saved
				globalStep = "Comparing saved tracks";
				compareIdTracks(importColl.saved || [], collections.saved || [], addToSaved);
				playlistStep += 1;

				// compare other playlists
				var playlistIds = _.keys(importColl.playlists || {});
				globalStep = "Comparing custom playlists";
				handlePlaylistCompare(playlistIds.reverse(), function () {
					handleTrackUpload();
				});
			});
		}
	}
}

function handleTrackUpload() {
	var savedBatches = chunkItems(savedQueue, 50);
	var playlistBatches = buildPlaylistBatches(playlistQueue);
	trackTotal = savedQueue.length + playlistQueue.length;
	trackStep = 0;
	savedQueue = [];
	playlistQueue = [];

	if (trackTotal > 0) {
		$("#progressBar").show();
		globalStep = "Uploading tracks";
		handleSavedRequests(savedBatches.reverse(), function () {
			handlePlaylistRequests(playlistBatches.reverse(), function () {
				globalStep = "Finished uploading";
				trackTotal = trackStep;
				isImporting = false;
			});
		});
	} else {
		globalStep = "No new tracks found in import";
	}
}

function isValidSpotifyId(id) {
	return typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id);
}

function isValidTrackUri(uri) {
	return typeof uri === "string" && /^spotify:track:[A-Za-z0-9]{22}$/.test(uri);
}

function chunkItems(items, chunkSize) {
	var batches = [];
	for (var i = 0; i < items.length; i += chunkSize) {
		batches.push(items.slice(i, i + chunkSize));
	}
	return batches;
}

function buildPlaylistBatches(queue) {
	var byPlaylist = {};
	$.each(queue, function (_index, item) {
		byPlaylist[item.playlistId] = byPlaylist[item.playlistId] || [];
		byPlaylist[item.playlistId].push(item.uri);
	});

	var batches = [];
	$.each(byPlaylist, function (playlistId, uris) {
		var chunks = chunkItems(uris, 100);
		$.each(chunks, function (_i, chunk) {
			batches.push({ playlistId: playlistId, uris: chunk });
		});
	});

	return batches;
}

function handlePlaylistCompare(ids, callback) {
	var importPlaylistId = ids.pop();
	if (!importPlaylistId) {
		callback();
		return;
	}
	var importPlaylist = importColl.playlists[importPlaylistId];
	ensurePlaylistExists(importPlaylist, function (playlist) {
		if (playlist && importPlaylist) {
			compareUriTracks(importPlaylist.tracks, playlist.tracks, function (uri) {
				addToPlaylist(playlist.id, uri);
			});
		}
		handlePlaylistCompare(ids, callback);
	});
}

function addToPlaylist(playlistId, trackUri) {
	if (!isValidTrackUri(trackUri)) {
		console.log("Skipping invalid track URI", trackUri);
		return;
	}
	playlistQueue.push({ playlistId: playlistId, uri: trackUri });
}

function findPlaylistByName(name) {
	var match = null;
	$.each(collections.playlists || {}, function (_id, playlist) {
		if (playlist.name === name && !match) {
			match = playlist;
		}
	});
	return match;
}

function ensurePlaylistExists(sourcePlaylist, callback) {
	playlistStep += 1;
	if (!sourcePlaylist) {
		callback(null);
		return;
	}

	var existingByOrigin = null;
	$.each(collections.playlists || {}, function (_id, playlist) {
		if (playlist.originId && sourcePlaylist.id && playlist.originId === sourcePlaylist.id) {
			existingByOrigin = playlist;
		}
	});
	if (existingByOrigin) {
		callback(existingByOrigin);
		return;
	}

	var name = sourcePlaylist.name || "Imported playlist";
	var existingByName = findPlaylistByName(name);
	var isNameDuplicatedInImport = (importPlaylistNameCounts[name] || 0) > 1;

	if (existingByName && !isNameDuplicatedInImport) {
		callback(existingByName);
		return;
	}

	var set = { name: name, public: "true" };
	$.ajax({
		method: "POST",
		url: "https://api.spotify.com/v1/users/" + userId + "/playlists",
		data: JSON.stringify(set),
		contentType: "application/json",
		headers: {
			Authorization: "Bearer " + token,
		},
		success: function (response) {
			collections.playlists[response.id] = {
				name: response.name,
				href: response.tracks.href,
				id: response.id,
				tracks: [],
				originId: sourcePlaylist.id || null,
			};
			callback(collections.playlists[response.id]);
		},
		error: function (jqXHR, textStatus, errorThrown) {
			console.log("Failed to create playlist", name, errorThrown || textStatus);
			globalStep = "Failed to create playlist " + name;
			callback(null);
		},
	});
}

function makeSureImportedStarredExists(callback) {
	ensurePlaylistExists(
		{ id: "importedStarred", name: "importedStarred", tracks: [] },
		function (playlist) {
			callback(!!playlist);
		}
	);
}

function addToStarred(trackUri) {
	var playlist = findPlaylistByName("importedStarred");
	if (!playlist) {
		globalStep = "Failed to find importedStarred playlist";
		return;
	}
	uriInTracks(trackUri, playlist.tracks, function (uri) {
		addToPlaylist(playlist.id, uri);
	});
}

function handleSavedRequests(arr, callback) {
	var ids = arr.pop();
	if (ids) {
		trackStep += ids.length;
		$.ajax({
			method: "PUT",
			url: "https://api.spotify.com/v1/me/tracks",
			data: JSON.stringify({ ids: ids }),
			contentType: "application/json",
			headers: {
				Authorization: "Bearer " + token,
			},
			success: function () {},
			error: function (jqXHR, textStatus, errorThrown) {
				console.log("Failed to save track", errorThrown || textStatus);
				globalStep = "Failed saving some tracks";
			},
		}).always(function () {
			handleSavedRequests(arr, callback);
		});
	} else {
		callback();
	}
}

function handlePlaylistRequestsWithTimeout(arr, callback) {
	setTimeout(function () {
		console.log("Fast runners are dead runners");
		handlePlaylistRequests(arr, callback);
	}, conf.slowdown_import);
}

function handlePlaylistRequests(arr, callback) {
	var batch = arr.pop();
	if (batch) {
		trackStep += batch.uris.length;
		$.ajax({
			method: "POST",
			url:
				"https://api.spotify.com/v1/users/" +
				userId +
				"/playlists/" +
				batch.playlistId +
				"/tracks",
			data: JSON.stringify({ uris: batch.uris }),
			contentType: "application/json",
			headers: {
				Authorization: "Bearer " + token,
			},
			success: function () {
				// collections.playlists[response.name] = {
				//     id: response.id,
				//     uri: response.uri
				// };
			},
			error: function (jqXHR, textStatus, errorThrown) {
				console.log("Failed to add track to playlist", errorThrown || textStatus);
				globalStep = "Failed adding some tracks";
			},
		}).always(function () {
			handlePlaylistRequestsWithTimeout(arr, callback);
		});
	} else {
		callback();
	}
}

function uriInTracks(uri, tracks, addCallback) {
	var found = false;
	$.each(tracks, function (index, value) {
		if (value.uri === uri) {
			found = true;
		}
	});
	if (!found) {
		addCallback(uri);
	}
}

function addToSaved(id) {
	if (!isValidSpotifyId(id)) {
		console.log("Skipping invalid saved track id", id);
		return;
	}
	savedQueue.push(id);
}

function compareUriTracks(imported, stored, addCallback) {
	$.each(imported, function (index, value) {
		if (!isValidTrackUri(value.uri)) {
			console.log("Skipping invalid track uri in compare", value);
			return;
		}
		var found = false;
		$.each(stored, function (index2, value2) {
			if (value.uri === value2.uri) {
				found = true;
			}
		});
		if (!found) {
			addCallback(value.uri);
		}
	});
}

function compareIdTracks(imported, stored, addCallback) {
	$.each(imported, function (index, value) {
		if (!isValidSpotifyId(value.id)) {
			console.log("Skipping invalid track id in compare", value);
			return;
		}
		var found = false;
		$.each(stored, function (index2, value2) {
			if (value.id === value2.id) {
				found = true;
			}
		});
		if (!found) {
			addCallback(value.id);
		}
	});
}

function bindControls() {
	$("#btnImport").click(function () {
		$("#pnlAction").hide();
		$("#pnlImport").show();
	});
	$("#btnExport").click(function () {
		var json = JSON.stringify(collections);
		var d = new Date();
		var time = "@" + d.getFullYear() + "_" + (d.getMonth() + 1) + "_" + d.getDate();
		download(accountName + time + ".json", json);
	});
	$("#fileImport").change(readFile);
}

function handleAuth(accessToken) {
	token = accessToken;
	console.log("fetching now with auth token", token);
	// fetch my public playlists
	$.ajax({
		url: "https://api.spotify.com/v1/me",
		headers: {
			Authorization: "Bearer " + accessToken,
		},
		success: function (response) {
			var user_id = response.id.toLowerCase();
			userId = user_id;
			accountName = user_id;

			$("#userName").html(accountName);
			$("#pnlLoggedOut").hide();

			refreshTrackData(function () {
				$("#pnlAction").show();
			});
		},
		error: function (jqXHR, textStatus, errorThrown) {
			var errorInfo = {
				status: jqXHR && jqXHR.status,
				statusText: jqXHR && jqXHR.statusText,
				responseText: jqXHR && jqXHR.responseText,
				error: errorThrown || textStatus,
			};
			console.log("Failed to fetch user profile", errorInfo);
			var readableStatus = errorInfo.status ? " (" + errorInfo.status + ")" : "";
			var detail = errorInfo.responseText || errorInfo.error || "Unknown error";
			if (detail && !/[.!?]\s*$/.test(detail)) {
				detail += ".";
			}
			$("#pnlLoggedOut").html(
				"Login failed" +
					readableStatus +
					". " +
					detail +
					" Please verify your Spotify app settings and try again."
			);
			$("#login").prop("disabled", false);
		},
	});
}

function refreshMyMusicTracks(callback) {
	collections.saved = [];
	playlistStep += 1;
	loadTrackChunks("https://api.spotify.com/v1/me/tracks", collections.saved, callback);
}

function loadTrackChunksWithTimeout(url, arr, callback) {
	setTimeout(function () {
		console.log("Taking breath, not to fast my cheetah");
		loadTrackChunks(url, arr, callback);
	}, conf.slowdown_export);
}

function loadTrackChunks(url, arr, callback) {
	$.ajax({
		url: url,
		headers: {
			Authorization: "Bearer " + token,
		},
		success: function (data) {
			if (!data) return;
			if ("items" in data) {
				$.each(data.items, function (index, value) {
					if (value.track !== null) {
						arr.push({ id: value.track.id, uri: value.track.uri });
					} else {
						console.log("track is null", value);
					}
				});
			} else {
				arr.push({ id: data.track.id, uri: data.track.uri });
			}
			if (data.next) {
				loadTrackChunksWithTimeout(data.next, arr, callback);
			} else {
				callback();
			}
		},
		error: function (jqXHR, textStatus, errorThrown) {
			console.log("Failed to load tracks", errorThrown || textStatus);
			globalStep = "Failed to load tracks";
			callback();
		},
	});
}

function refreshPlaylist(callback) {
	collections.playlists = {};
	var playlists = [];
	loadPlaylistChunks(
		"https://api.spotify.com/v1/users/" + userId + "/playlists",
		playlists,
		function () {
			handlePlaylistTracks(playlists, collections.playlists, callback);
		}
	);
}

function loadPlaylistChunks(url, arr, callback) {
	$.ajax({
		url: url,
		headers: {
			Authorization: "Bearer " + token,
		},
		success: function (data) {
			if (!data) return;
			if ("items" in data) {
				$.each(data.items, function (index, value) {
					if (value.tracks && value.tracks.href) {
						arr.push({
							name: value.name,
							href: value.tracks.href,
							id: value.id,
							tracks: [],
						});
					}
				});
			} else {
				if (data.tracks && data.tracks.href) {
					arr.push({
						name: data.name,
						href: data.tracks.href,
						id: data.id,
						tracks: [],
					});
				}
			}
			if (data.next) {
				loadPlaylistChunks(data.next, arr, callback);
			} else {
				callback();
			}
		},
		error: function (jqXHR, textStatus, errorThrown) {
			console.log("Failed to load playlists", errorThrown || textStatus);
			globalStep = "Failed to load playlists";
			callback();
		},
	});
}

function handlePlaylistTracks(arr, result, callback) {
	var item = arr.pop();
	if (!item) {
		return callback();
	}
	playlistStep += 1;
	item.tracks = [];
	loadTrackChunks(item.href, item.tracks, function () {
		delete item.href;
		item.originId = null;
		result[item.id] = item;
		if (arr.length === 0) {
			callback();
		} else {
			handlePlaylistTracks(arr, result, callback);
		}
	});
}

function consumeHashToken() {
	var hash = window.location.hash || "";
	if (!hash || hash.length < 2) return null;
	var params = new URLSearchParams(hash.slice(1));
	var hashToken = params.get("token");
	if (!hashToken) return null;
	try {
		params.delete("token");
		var newHash = params.toString();
		if (typeof window.history.replaceState === "function") {
			var cleanedHash = newHash ? "#" + newHash : "";
			window.history.replaceState(null, document.title, window.location.pathname + cleanedHash);
		} else {
			window.location.hash = newHash;
		}
	} catch (error) {
		console.log("Unable to clean hash token", error);
	}
	return hashToken;
}

window.onload = async function () {
	if (navigator.userAgent.indexOf("MSIE") !== -1 || navigator.appVersion.indexOf("Trident/") > 0) {
		// MSIE
		$("#pnlLoggedOut").html("Please use Firefox or Chrome, due to a bug in Internet Explorer");
	} else {
		$("#login").prop("disabled", true);
		try {
			await loadConfig();
		} catch {
			return;
		}
		$("#login").click(login);
		window.addEventListener("message", authCallback, false);
		bindControls();
		refreshProgress();

		var hashToken = consumeHashToken();
		if (hashToken) {
			handleAuth(hashToken);
		}
	}
};
