/**
 * lib/imageProxy.js — Image search via Advanced Google Library (googlethis)
 *
 * Uses the modern `googlethis` npm library to perform advanced Google Image
 * searches, retrieving high-quality, relevant images for queries.
 */

import google from 'googlethis';

// Simple in-memory cache to avoid refetching the same query
const cache = new Map();
const MAX_CACHE = 50;

/**
 * Fetches a relevant image and returns it as a base64 data URL.
 *
 * @param {string} query - Search query for the image
 * @returns {Promise<string|null>} base64 data URL or null on failure
 */
export async function fetchImage(query) {
    if (!query || typeof query !== 'string') return null;
    const cacheKey = query.trim().toLowerCase();

    if (cache.has(cacheKey)) {
        console.log(`[imageProxy] Cache hit: "${query}"`);
        return cache.get(cacheKey);
    }

    console.log(`[imageProxy] Searching via Advanced Google Library: "${query}"`);
    let dataUrl = await tryGoogleAdvanced(query);

    // Fallback if no images found
    if (!dataUrl) {
        console.log(`[imageProxy] Advanced search failed, using fallback for: "${query}"`);
        dataUrl = await tryFallback(query);
    }

    if (dataUrl) {
        if (cache.size >= MAX_CACHE) {
            cache.delete(cache.keys().next().value);
        }
        cache.set(cacheKey, dataUrl);
    }

    return dataUrl;
}

/**
 * Advanced Google Image Search using `googlethis` library
 */
async function tryGoogleAdvanced(query) {
    try {
        // Clean query to ensure better image results
        const cleanQuery = query.replace(/ educational diagram illustration/i, ' diagram').trim();

        const options = {
            page: 0,
            safe: false,
            additional_params: {
                hl: 'en',
                tbs: 'isz:l' // Filter: Large Images only (High Quality)
            }
        };

        const images = await google.image(cleanQuery, options);

        if (images && images.length > 0) {
            // Try up to 3 images in case the first one is a dead link
            for (let i = 0; i < Math.min(3, images.length); i++) {
                const img = images[i];
                console.log(`[imageProxy] Found Google image: ${img.url.slice(0, 100)}`);
                const dataUrl = await fetchAsBase64(img.url);
                if (dataUrl) return dataUrl;
            }
        }
        return null;
    } catch (err) {
        console.warn(`[imageProxy] Advanced Google search error: ${err.message}`);
        return null;
    }
}

/**
 * Helper to fetch a URL and return it as a base64 Data URL
 */
async function fetchAsBase64(url) {
    try {
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' },
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
        });

        if (!resp.ok) return null;

        const ct = resp.headers.get('content-type') || 'image/jpeg';
        if (!ct.startsWith('image/')) return null;

        const buffer = Buffer.from(await resp.arrayBuffer());
        if (buffer.length < 500) return null;

        console.log(`[imageProxy] Fetched successfully: ${(buffer.length / 1024).toFixed(1)}KB`);
        return `data:${ct};base64,${buffer.toString('base64')}`;
    } catch (err) {
        console.warn(`[imageProxy] Fetch error: ${err.message}`);
        return null;
    }
}

/**
 * Fallback to a seeded Picsum photo if search fails
 */
async function tryFallback(query) {
    try {
        let seed = 0;
        for (let i = 0; i < query.length; i++) seed += query.charCodeAt(i);
        const id = (seed % 900) + 10;

        const url = `https://picsum.photos/id/${id}/500/350`;
        return await fetchAsBase64(url);
    } catch (err) {
        return null;
    }
}
