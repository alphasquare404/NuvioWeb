const TORBOX_BASE_URL = "https://api.torbox.app/";
const PREMIUMIZE_BASE_URL = "https://www.premiumize.me/";
const REAL_DEBRID_BASE_URL = "https://api.real-debrid.com/rest/1.0/";

function joinUrl(baseUrl, path) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

async function requestBridgeJson(path, options = {}) {
  return requestJson("", path, options);
}

async function requestJson(baseUrl, path, options = {}) {
  let response;
  try {
    const url = joinUrl(baseUrl, path);
    const fetchOptions = {
      ...options,
      headers: {
        ...(options.headers || {})
      }
    };
    response = await fetch(url, fetchOptions);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: "",
      error
    };
  }
  const text = await response.text();
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    text
  };
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${String(apiKey || "").trim()}`
  };
}

function formBody(values = {}) {
  const body = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => body.append(key, String(entry)));
    } else if (value != null) {
      body.set(key, String(value));
    }
  });
  return body;
}

export const DebridApi = {
  async startTorboxDeviceAuthorization(appName = "Nuvio") {
    void appName;
    return requestBridgeJson("/api/debrid/torbox/device/start", { method: "POST" });
  },

  async redeemTorboxDeviceAuthorization(deviceCode) {
    return requestBridgeJson("/api/debrid/torbox/device/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode: String(deviceCode || "").trim() })
    });
  },

  async startPremiumizeDeviceAuthorization(clientId) {
    return requestBridgeJson("/api/debrid/premiumize/device/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: String(clientId || "").trim() })
    });
  },

  async redeemPremiumizeDeviceAuthorization(deviceCode, clientId) {
    return requestBridgeJson("/api/debrid/premiumize/device/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceCode: String(deviceCode || "").trim(),
        clientId: String(clientId || "").trim()
      })
    });
  },

  async validateTorboxApiKey(apiKey) {
    const response = await requestBridgeJson("/api/debrid/torbox/account", {
      headers: authHeaders(apiKey)
    });
    return response.ok;
  },

  async validatePremiumizeApiKey(apiKey) {
    const response = await requestBridgeJson("/api/debrid/premiumize/account", {
      headers: authHeaders(apiKey)
    });
    return response.ok && String(response.data?.status || "").toLowerCase() !== "error";
  },

  async validateRealDebridApiKey(apiKey) {
    const response = await requestJson(REAL_DEBRID_BASE_URL, "user", {
      headers: authHeaders(apiKey)
    });
    return response.ok;
  },

  async torboxCreateTorrent(apiKey, magnet) {
    return requestBridgeJson("/api/debrid/torbox/torrent/create", {
      method: "POST",
      headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ magnet: String(magnet || "").trim() })
    });
  },

  async torboxCheckCached(apiKey, hashes = []) {
    return requestBridgeJson("/api/debrid/torbox/cache/check", {
      method: "POST",
      headers: {
        ...authHeaders(apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        hashes: (hashes || [])
          .map((hash) =>
            String(hash || "")
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      })
    });
  },

  async torboxGetTorrent(apiKey, torrentId) {
    return requestBridgeJson("/api/debrid/torbox/torrent/lookup", {
      method: "POST",
      headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ torrentId: String(torrentId || "").trim() })
    });
  },

  async torboxRequestDownloadLink(apiKey, torrentId, fileId) {
    return requestBridgeJson("/api/debrid/torbox/link/resolve", {
      method: "POST",
      headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({
        torrentId: String(torrentId || "").trim(),
        ...(fileId != null ? { fileId: String(fileId) } : {})
      })
    });
  },

  async torboxListCloudItems(apiKey, path) {
    return requestJson(TORBOX_BASE_URL, path, { headers: authHeaders(apiKey) });
  },

  async torboxRequestCloudDownloadLink(apiKey, itemType, itemId, fileId) {
    const type = String(itemType || "");
    const config =
      type === "Usenet"
        ? { path: "v1/api/usenet/requestdl", idKey: "usenet_id" }
        : type === "WebDownload"
          ? { path: "v1/api/webdl/requestdl", idKey: "web_id" }
          : { path: "v1/api/torrents/requestdl", idKey: "torrent_id" };
    const query = new URLSearchParams({
      token: String(apiKey || "").trim(),
      [config.idKey]: String(itemId),
      zip_link: "false",
      redirect: "false",
      append_name: "false"
    });
    if (fileId != null) query.set("file_id", String(fileId));
    return requestJson(TORBOX_BASE_URL, `${config.path}?${query.toString()}`, {
      headers: authHeaders(apiKey)
    });
  },

  async premiumizeDirectDownload(apiKey, source) {
    return requestJson(PREMIUMIZE_BASE_URL, "api/transfer/directdl", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ src: source })
    });
  },

  async premiumizeCheckCache(apiKey, hashes = []) {
    const body = new URLSearchParams();
    (hashes || [])
      .map((hash) =>
        String(hash || "")
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
      .forEach((hash) => body.append("items[]", `magnet:?xt=urn:btih:${hash}`));
    return requestJson(PREMIUMIZE_BASE_URL, "api/cache/check", {
      method: "POST",
      headers: authHeaders(apiKey),
      body
    });
  },

  async premiumizeListCloudItems(apiKey) {
    return requestJson(PREMIUMIZE_BASE_URL, "api/item/listall", {
      headers: authHeaders(apiKey)
    });
  },

  async premiumizeCloudItemDetails(apiKey, itemId) {
    const query = new URLSearchParams({ id: String(itemId || "") });
    return requestJson(PREMIUMIZE_BASE_URL, `api/item/details?${query.toString()}`, {
      headers: authHeaders(apiKey)
    });
  },

  async realDebridAddMagnet(apiKey, magnet) {
    return requestJson(REAL_DEBRID_BASE_URL, "torrents/addMagnet", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ magnet })
    });
  },

  async realDebridTorrentInfo(apiKey, torrentId) {
    return requestJson(REAL_DEBRID_BASE_URL, `torrents/info/${encodeURIComponent(torrentId)}`, {
      headers: authHeaders(apiKey)
    });
  },

  async realDebridSelectFiles(apiKey, torrentId, files) {
    return requestJson(
      REAL_DEBRID_BASE_URL,
      `torrents/selectFiles/${encodeURIComponent(torrentId)}`,
      {
        method: "POST",
        headers: authHeaders(apiKey),
        body: formBody({ files })
      }
    );
  },

  async realDebridUnrestrictLink(apiKey, link) {
    return requestJson(REAL_DEBRID_BASE_URL, "unrestrict/link", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ link })
    });
  },

  async realDebridDeleteTorrent(apiKey, torrentId) {
    return requestJson(REAL_DEBRID_BASE_URL, `torrents/delete/${encodeURIComponent(torrentId)}`, {
      method: "DELETE",
      headers: authHeaders(apiKey)
    });
  }
};
