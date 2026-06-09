import { UlanziApi } from "./actions/ulanzi-api/index.js";
import Stock from "./actions/stock.js";
import { saveStoredFinnhubKey } from "./actions/finnhub-key-store.js";

const ACTION_CACHES = {};
const $UD = new UlanziApi();
let isShuttingDown = false;

function getOrCreateAction(context) {
  if (!context) return null;

  if (!ACTION_CACHES[context]) {
    ACTION_CACHES[context] = new Stock(context, $UD);
  }

  return ACTION_CACHES[context];
}

function disposeAction(context) {
  const instance = ACTION_CACHES[context];
  if (!instance) return;

  if (typeof instance.dispose === "function") {
    instance.dispose();
  } else {
    instance.clear();
  }
  delete ACTION_CACHES[context];
}

function disposeAllActions() {
  Object.keys(ACTION_CACHES).forEach(disposeAction);
}

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  disposeAllActions();
  if (typeof $UD.disconnect === "function") {
    $UD.disconnect();
  } else if ($UD.websocket) {
    $UD.websocket.close();
  }

  if (signal) {
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
}

function normalizeFinnhubKey(key) {
  return String(key || "").trim();
}

async function rememberFinnhubKeyFromSettings(settings) {
  const finnhubKey = normalizeFinnhubKey(settings?.finnhub_api_key);
  if (!finnhubKey) {
    return;
  }

  await saveStoredFinnhubKey(finnhubKey);
}

$UD.connect("com.ulanzi.ulanzideck.stock");
$UD.onConnected(() => {});
$UD.onClose(() => {
  disposeAllActions();
});

$UD.onAdd(async (jsn) => {
  const context = jsn.context;
  getOrCreateAction(context);

  await rememberFinnhubKeyFromSettings(jsn?.param);
  await onSetParams(jsn);
});

$UD.onSetActive((jsn) => {
  const instance = ACTION_CACHES[jsn.context];
  if (instance) {
    instance.setActive(jsn.active);
  }
});

$UD.onRun((jsn) => {
  const instance = getOrCreateAction(jsn.context);
  if (!instance) return;

  instance.run(jsn);
});

$UD.onClear((jsn) => {
  if (!jsn.param) return;

  for (let i = 0; i < jsn.param.length; i += 1) {
    const context = jsn.param[i].context;
    if (!ACTION_CACHES[context]) continue;

    disposeAction(context);
  }
});

$UD.onParamFromApp(async (jsn) => {
  await rememberFinnhubKeyFromSettings(jsn?.param);
  await onSetParams(jsn);
});

$UD.onParamFromPlugin(async (jsn) => {
  await rememberFinnhubKeyFromSettings(jsn?.param);
  await onSetParams(jsn);
});

async function onSetParams(jsn) {
  const rawSettings = jsn.param || {};
  const instance = ACTION_CACHES[jsn.context];

  if (!instance || JSON.stringify(rawSettings) === "{}") {
    return;
  }

  instance.setParams(rawSettings);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("exit", () => {
  disposeAllActions();
});
