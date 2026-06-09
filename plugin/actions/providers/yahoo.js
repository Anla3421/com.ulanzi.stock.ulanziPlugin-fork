import superagent from "superagent";

import { QUOTE_REQUEST_TIMEOUT, createErrorQuote, createQuote, isNetworkError, mapLimit } from "./helpers.js";
import { normalizeInput, normalizeInputs, toYahooSymbol } from "./normalizer.js";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0",
};

function extractPreviousClose(result) {
  const regularPrevious = Number(
    result?.meta?.regularMarketPreviousClose || result?.meta?.previousClose || 0
  );
  if (Number.isFinite(regularPrevious) && regularPrevious > 0) {
    return regularPrevious;
  }

  const closes = result?.indicators?.quote?.[0]?.close || [];
  const numericCloses = closes.filter((item) => Number.isFinite(item));
  if (numericCloses.length >= 2) {
    return Number(numericCloses[numericCloses.length - 2]);
  }

  const chartPrevious = Number(result?.meta?.chartPreviousClose || 0);
  if (Number.isFinite(chartPrevious) && chartPrevious > 0) {
    return chartPrevious;
  }

  return 0;
}

async function fetchYahooQuote(normalized) {
  if (!normalized.isValid) {
    return createErrorQuote(normalized, "invalid");
  }

  const symbol = toYahooSymbol(normalized);
  if (!symbol) {
    return createErrorQuote(normalized, "unsupported");
  }

  try {
    const response = await superagent
      .get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
      .query({
        interval: "1d",
        range: "5d",
      })
      .set(BROWSER_HEADERS)
      .timeout(QUOTE_REQUEST_TIMEOUT);

    const result = response.body?.chart?.result?.[0];
    if (!result) {
      return createErrorQuote(normalized, "not_found", { providerSymbol: symbol });
    }

    const meta = result.meta || {};
    return createQuote(normalized, {
      providerSymbol: symbol,
      name: meta.shortName || meta.longName || symbol,
      now: meta.regularMarketPrice,
      yesterday: extractPreviousClose(result),
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
    });
  } catch (error) {
    if (error.status === 429) {
      return createErrorQuote(normalized, "rate_limited", { providerSymbol: symbol });
    }
    if (isNetworkError(error)) {
      return createErrorQuote(normalized, "network_error", { providerSymbol: symbol });
    }
    return createErrorQuote(normalized, "not_found", { providerSymbol: symbol });
  }
}

async function getQuotes(rawInputs) {
  const normalizedList = normalizeInputs(rawInputs);
  return mapLimit(normalizedList, 4, fetchYahooQuote);
}

async function getQuote(rawInput) {
  const normalized = normalizeInput(rawInput);
  if (!normalized) {
    return createErrorQuote(null, "invalid", { code: String(rawInput || "").trim().toUpperCase() });
  }
  return fetchYahooQuote(normalized);
}

export default {
  id: "yahoo",
  getQuote,
  getQuotes,
};
