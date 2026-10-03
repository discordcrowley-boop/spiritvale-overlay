const fs = require("fs");
const path = require("path");
const { app, net } = require("electron");

const SNAPSHOT_URL =
  "https://market-api.spiritvalers.com/v2/markets/global/snapshot";
const CACHE_TTL_MS = 14 * 60 * 1000;

let memoryCache = null;
let inFlight = null;

function cachePath() {
  return path.join(app.getPath("userData"), "market-snapshot.json");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function itemKey(itemType, itemId) {
  return `${itemType}::${itemId}`;
}

function isExpired(listing, now = Date.now()) {
  if (!listing.expiresAt) {
    return false;
  }
  const expires = Date.parse(listing.expiresAt);
  return Number.isFinite(expires) && expires <= now;
}

function activeListings(listings) {
  const now = Date.now();
  return listings.filter((row) => !isExpired(row, now));
}

function httpGetJson(url, etag) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: "GET", url });
    request.setHeader("Accept", "application/json");
    if (etag) {
      request.setHeader("If-None-Match", etag);
    }

    let statusCode = 0;
    const headers = {};
    const chunks = [];

    request.on("response", (response) => {
      statusCode = response.statusCode;
      for (const [key, value] of Object.entries(response.headers)) {
        headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
      }
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (statusCode === 304) {
          resolve({ statusCode, headers, json: null });
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`ValeMarket ${statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve({ statusCode, headers, json: JSON.parse(body) });
        } catch (err) {
          reject(err);
        }
      });
      response.on("error", reject);
    });

    request.on("error", reject);
    request.end();
  });
}

function loadDiskCache() {
  const disk = readJson(cachePath(), null);
  if (!disk || !disk.payload || !Array.isArray(disk.payload.listings)) {
    return null;
  }
  return disk;
}

function catalogFromSnapshot(payload) {
  const byItem = new Map();
  for (const listing of activeListings(payload.listings || [])) {
    const key = itemKey(listing.itemType, listing.itemId);
    let entry = byItem.get(key);
    if (!entry) {
      entry = {
        itemType: listing.itemType,
        itemId: listing.itemId,
        displayName: listing.displayName || listing.itemId,
        listingCount: 0,
        totalQty: 0,
        low: Number.POSITIVE_INFINITY,
        high: 0,
        prices: [],
      };
      byItem.set(key, entry);
    }
    entry.listingCount += 1;
    entry.totalQty += Number(listing.quantity) || 0;
    const price = Number(listing.unitPrice) || 0;
    entry.prices.push(price);
    if (price < entry.low) {
      entry.low = price;
    }
    if (price > entry.high) {
      entry.high = price;
    }
    if (listing.displayName) {
      entry.displayName = listing.displayName;
    }
  }

  const items = [];
  for (const entry of byItem.values()) {
    const sorted = entry.prices.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length === 0
        ? 0
        : sorted.length % 2
          ? sorted[mid]
          : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    items.push({
      itemType: entry.itemType,
      itemId: entry.itemId,
      displayName: entry.displayName,
      listingCount: entry.listingCount,
      totalQty: entry.totalQty,
      low: Number.isFinite(entry.low) ? entry.low : 0,
      high: entry.high,
      median,
      searchText: `${entry.displayName} ${entry.itemId}`.toLowerCase(),
    });
  }

  items.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return items;
}

async function getSnapshot(force = false) {
  const now = Date.now();
  if (!force && memoryCache && now - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return memoryCache;
  }

  if (!force && !memoryCache) {
    const disk = loadDiskCache();
    if (disk && now - (disk.fetchedAt || 0) < CACHE_TTL_MS) {
      memoryCache = {
        fetchedAt: disk.fetchedAt,
        etag: disk.etag || null,
        generatedAt: disk.payload.generatedAt,
        items: catalogFromSnapshot(disk.payload),
        listingCount: (disk.payload.listings || []).length,
        listings: disk.payload.listings || [],
      };
      return memoryCache;
    }
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    const disk = loadDiskCache();
    const etag = disk?.etag || null;
    try {
      const result = await httpGetJson(SNAPSHOT_URL, force ? null : etag);
      let payload = result.json;
      let nextEtag = result.headers.etag || etag;

      if (result.statusCode === 304 && disk?.payload) {
        payload = disk.payload;
      }

      if (!payload || !Array.isArray(payload.listings)) {
        throw new Error("Invalid ValeMarket snapshot");
      }

      writeJson(cachePath(), {
        fetchedAt: now,
        etag: nextEtag,
        payload,
      });

      memoryCache = {
        fetchedAt: now,
        etag: nextEtag,
        generatedAt: payload.generatedAt,
        items: catalogFromSnapshot(payload),
        listingCount: payload.listings.length,
        listings: payload.listings,
      };
      return memoryCache;
    } catch (err) {
      if (disk?.payload) {
        memoryCache = {
          fetchedAt: disk.fetchedAt || now,
          etag: disk.etag || null,
          generatedAt: disk.payload.generatedAt,
          items: catalogFromSnapshot(disk.payload),
          listingCount: (disk.payload.listings || []).length,
          listings: disk.payload.listings || [],
          stale: true,
          error: String(err.message || err),
        };
        return memoryCache;
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

module.exports = { getSnapshot };
