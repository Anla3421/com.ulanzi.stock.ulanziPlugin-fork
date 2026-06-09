import superagent from "superagent";

import { QUOTE_REQUEST_TIMEOUT, createErrorQuote, createQuote, isNetworkError, mapLimit } from "./helpers.js";
import { normalizeInput, normalizeInputs, toFinnhubSymbol } from "./normalizer.js";

function getApiKey(config) {
  return String(config?.finnhub_api_key || "").trim();
}

async function fetchFinnhubQuote(normalized, config) {
  if (!normalized.isValid) {
    return createErrorQuote(normalized, "invalid");
  }

  const apiKey = getApiKey(config);
  if (!apiKey) {
    return createErrorQuote(normalized, "unauthorized");
  }

  const symbol = toFinnhubSymbol(normalized);
  if (!symbol) {
    return createErrorQuote(normalized, "unsupported");
  }

  try {
    const response = await superagent
      .get("https://finnhub.io/api/v1/quote")
      .query({
        symbol,
        token: apiKey,
      })
      .set("User-Agent", "Mozilla/5.0")
      .timeout(QUOTE_REQUEST_TIMEOUT);

    const body = response.body || {};
    if (!Number(body.c) && !Number(body.pc) && !Number(body.h) && !Number(body.l)) {
      return createErrorQuote(normalized, "not_found", { providerSymbol: symbol });
    }

    return createQuote(normalized, {
      providerSymbol: symbol,
      name: normalized.market === "US" ? normalized.symbol : symbol,
      now: body.c,
      yesterday: body.pc,
      high: body.h,
      low: body.l,
    });
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return createErrorQuote(normalized, "unauthorized", { providerSymbol: symbol });
    }
    if (error.status === 429) {
      return createErrorQuote(normalized, "rate_limited", { providerSymbol: symbol });
    }
    if (isNetworkError(error)) {
      return createErrorQuote(normalized, "network_error", { providerSymbol: symbol });
    }
    return createErrorQuote(normalized, "not_found", { providerSymbol: symbol });
  }
}

async function getQuotes(rawInputs, config) {
  const normalizedList = normalizeInputs(rawInputs);
  return mapLimit(normalizedList, 4, (item) => fetchFinnhubQuote(item, config));
}

async function getQuote(rawInput, config) {
  const normalized = normalizeInput(rawInput);
  if (!normalized) {
    return createErrorQuote(null, "invalid", { code: String(rawInput || "").trim().toUpperCase() });
  }
  return fetchFinnhubQuote(normalized, config);
}

export default {
  id: "finnhub",
  getQuote,
  getQuotes,
};
