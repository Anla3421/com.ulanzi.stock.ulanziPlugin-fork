const DEFAULT_SETTING = {
  mode: "single",
  provider: "",
  code_single: "",
  code_multiple: [],
  code_multiple_before: "",
  rotate_duration: "10",
  refresh_duration: "60",
  finnhub_api_key: "",
  bgColor: "#000000",
  bgImgName: "",
  bgImg: "",
};

let ACTION_SETTING = { ...DEFAULT_SETTING };
let form = "";
let latestStoredFinnhubKey = "";
let hasUserTouchedFinnhubKey = false;
let hasLoadedStoredFinnhubKey = false;
let hasInitializedSettings = false;
let bgImgEnableTimer = null;

function normalizeFinnhubKey(key) {
  return String(key || "").trim();
}

function getDefaultProvider() {
  return String($UD?.language || "").trim() === "zh_CN" ? "china" : "yahoo";
}

function normalizeProvider(provider) {
  return String(provider || "").trim() || getDefaultProvider();
}

function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTING,
    ...(settings || {}),
    provider: normalizeProvider(settings?.provider),
  };
}

async function loadStoredFinnhubKey() {
  const pluginPath = Utils.getPluginPath();
  const candidates = [
    `${pluginPath}/finnhub-key.json`,
    `${pluginPath}/data/finnhub-key.json`,
  ];

  latestStoredFinnhubKey = "";

  for (const filePath of candidates) {
    try {
      const json = await Utils.readJson(filePath);
      const key = normalizeFinnhubKey(json?.finnhub_api_key);
      if (key) {
        latestStoredFinnhubKey = key;
        break;
      }
    } catch (error) {
      // ignore missing files and continue
    }
  }

  hasLoadedStoredFinnhubKey = true;
  applyStoredFinnhubKey(true);
}

function applyStoredFinnhubKey(shouldSendToPlugin = false) {
  const normalizedStoredKey = normalizeFinnhubKey(latestStoredFinnhubKey);
  const currentKey = normalizeFinnhubKey(ACTION_SETTING.finnhub_api_key);

  if (!hasInitializedSettings || !hasLoadedStoredFinnhubKey || !normalizedStoredKey || currentKey || hasUserTouchedFinnhubKey) {
    return;
  }

  ACTION_SETTING = {
    ...mergeSettings(ACTION_SETTING),
    finnhub_api_key: normalizedStoredKey,
  };

  if (form) {
    Utils.setFormValue(ACTION_SETTING, form);
    renderForm();
  }

  if (shouldSendToPlugin) {
    $UD.sendParamFromPlugin(ACTION_SETTING);
  }
}

function bindFinnhubKeyField() {
  const finnhubInput = document.getElementById("finnhub_api_key");
  if (!finnhubInput || finnhubInput.dataset.bound === "true") {
    return;
  }

  const markTouched = () => {
    hasUserTouchedFinnhubKey = true;
  };

  const commitLatestKey = () => {
    ACTION_SETTING.finnhub_api_key = normalizeFinnhubKey(finnhubInput.value);
  };

  finnhubInput.addEventListener("input", markTouched);
  finnhubInput.addEventListener("change", commitLatestKey);
  finnhubInput.addEventListener("blur", commitLatestKey);
  finnhubInput.dataset.bound = "true";
}

function bindFormInput() {
  if (!form || form.dataset.inputBound === "true") {
    return;
  }

  form.addEventListener(
    "input",
    Utils.debounce(() => {
      const value = Utils.getFormValue(form);
      ACTION_SETTING = mergeSettings({
        ...ACTION_SETTING,
        ...value,
      });
      ACTION_SETTING.finnhub_api_key = normalizeFinnhubKey(ACTION_SETTING.finnhub_api_key);

      renderForm();
      $UD.sendParamFromPlugin(ACTION_SETTING);
    })
  );
  form.dataset.inputBound = "true";
}

$UD.connect("com.ulanzi.ulanzideck.stock.config");

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");

  const el = document.querySelector(".uspi-wrapper");
  el.classList.remove("hidden");

  bindFinnhubKeyField();
  loadStoredFinnhubKey();
  ACTION_SETTING = mergeSettings(ACTION_SETTING);
  Utils.setFormValue(ACTION_SETTING, form);
  renderForm();
  bindFormInput();
});

$UD.onAdd((jsonObj) => {
  settingSaveParam(jsonObj?.param || {}, { resetFinnhubTouch: true });
});

$UD.onParamFromApp((jsonObj) => {
  settingSaveParam(jsonObj?.param || {});
});

$UD.onSelectdialog((param) => {
  ACTION_SETTING.bgImg = param.path;
  ACTION_SETTING.bgImgName = param.path;
  document.getElementById("bgImgFileInfo").value = ACTION_SETTING.bgImgName || "";
  document.getElementById("bgImgFileInfo").setAttribute("title", ACTION_SETTING.bgImgName || "");
  $UD.sendParamFromPlugin(ACTION_SETTING);
});

function settingSaveParam(params, { resetFinnhubTouch = false } = {}) {
  if (resetFinnhubTouch) {
    hasUserTouchedFinnhubKey = false;
  }
  hasInitializedSettings = true;
  const hadExplicitProvider = String(params?.provider || "").trim().length > 0;
  ACTION_SETTING = mergeSettings(params);
  ACTION_SETTING.finnhub_api_key = normalizeFinnhubKey(ACTION_SETTING.finnhub_api_key);

  if (form) {
    Utils.setFormValue(ACTION_SETTING, form);
    renderForm();
  }
  if (!hadExplicitProvider) {
    $UD.sendParamFromPlugin(ACTION_SETTING);
  }
  applyStoredFinnhubKey(true);
}

document.getElementById("bgImgFileLabel").addEventListener("click", async () => {
  const labelDom = document.getElementById("bgImgFileLabel");
  if (labelDom.classList.contains("disabled")) return;

  labelDom.classList.add("disabled");
  $UD.selectFileDialog("image(*.jpg *.png *.gif)");
  if (bgImgEnableTimer) {
    clearTimeout(bgImgEnableTimer);
  }
  bgImgEnableTimer = setTimeout(() => {
    bgImgEnableTimer = null;
    document.getElementById("bgImgFileLabel").classList.remove("disabled");
  }, 1000);
});

window.addEventListener("beforeunload", () => {
  if (bgImgEnableTimer) {
    clearTimeout(bgImgEnableTimer);
    bgImgEnableTimer = null;
  }
}, { once: true });

document.getElementById("finnhub_api_key_link").addEventListener("click", (event) => {
  event.preventDefault();
  $UD.openUrl("https://finnhub.io/dashboard");
});

function renderForm() {
  ACTION_SETTING = mergeSettings(ACTION_SETTING);

  const hideModeDom = ACTION_SETTING.mode === "single" ? "multiple" : "single";
  document.getElementById(`mode_${hideModeDom}_container`).style.display = "none";
  document.getElementById(`mode_${ACTION_SETTING.mode || "single"}_container`).style.display = "block";
  document.getElementById("rotate-duration-value").innerText = ACTION_SETTING.rotate_duration + "s";
  document.getElementById("finnhub_api_key_container").style.display = ACTION_SETTING.provider === "finnhub" ? "flex" : "none";
  document.getElementById("finnhub_api_key_help").style.display = ACTION_SETTING.provider === "finnhub" ? "flex" : "none";
  document.getElementById("provider_notice_china").style.display = ACTION_SETTING.provider === "china" ? "block" : "none";
  document.getElementById("provider_notice_yahoo").style.display = ACTION_SETTING.provider === "yahoo" ? "block" : "none";
  document.getElementById("provider_notice_finnhub").style.display = ACTION_SETTING.provider === "finnhub" ? "block" : "none";

  document.getElementById("bgImgFileInfo").textContent = ACTION_SETTING.bgImgName || "";
  document.getElementById("bgImgFileInfo").setAttribute("title", ACTION_SETTING.bgImgName || "");

  if (ACTION_SETTING.mode === "multiple" && ACTION_SETTING.code_multiple_before) {
    const replacedStr = ACTION_SETTING.code_multiple_before.replace(/\r\n/g, "\n");
    const stockCode = replacedStr.split("\n");
    const hasCheckList = [];

    stockCode.forEach((item) => {
      const trimItem = item && item.trim();
      if (trimItem && hasCheckList.indexOf(trimItem) < 0) {
        hasCheckList.push(trimItem);
      }
    });

    ACTION_SETTING.code_multiple = hasCheckList;
    document.getElementById("code_multiple").value = ACTION_SETTING.code_multiple_before;
  }
}
