import china from "./china.js";
import yahoo from "./yahoo.js";
import finnhub from "./finnhub.js";

const PROVIDERS = {
  china,
  yahoo,
  finnhub,
};

export function getProvider(providerId) {
  return PROVIDERS[providerId] || PROVIDERS.china;
}

export async function getQuote(providerId, rawInput, config) {
  return getProvider(providerId).getQuote(rawInput, config);
}

export async function getQuotes(providerId, rawInputs, config) {
  return getProvider(providerId).getQuotes(rawInputs, config);
}

