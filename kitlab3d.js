(() => {
  "use strict";

  const MAIN_MODEL_URL = "./assets/3d/kitlab6_collar_yes_short.glb";
  const SHIRT_NO_MODEL_URL = "./assets/3d/shirt_collar_no.glb";
  const ARMBAND_MODEL_URL = "./assets/3d/kitlab6_armband.glb";
  const NUMBERS_FONTS_MESH_URL = "./assets/3d/kitlab6_numbers_fonts_meshes.json";
  const KITLAB_NUMBERS_FONTS_ATLAS_VERSION = "2.08";
  const KITLAB_NUMBERS_FONTS_LAYOUT_VERSION = 208;
  const ARMBAND_CAMERA_YAW = Math.PI / 2;     // Approved fixed camera: H 90°
  const ARMBAND_CAMERA_PITCH = -Math.PI / 2; // Approved fixed camera: V -90°
  const MAIN_FRAMING_COMPAT_Y = 0.12460509975392142;
  const MAIN_APPROVED_BOUNDS = Object.freeze({
    min: [-1.7375600044974675, -3.742509071621839, -0.5933347187935993],
    max: [1.7375600044974675, 3.991719271129682, 0.5933347187935993],
  });
  const MAIN_APPROVED_FOCUS_BOUNDS = Object.freeze({
    reset: {
      min: [-1.7348692696943289, -3.742509071621839, -0.5913239537628598],
      max: [1.7348692696943289, 3.991719271129682, 0.5424839661460226],
    },
    shirt: {
      min: [-1.7375600044974675, 1.1963140668798815, -0.5933347187935993],
      max: [1.7375600044974675, 3.9917192778352044, 0.5922243367383402],
    },
    short: {
      min: [-0.7502969192647129, -1.3336932074943206, -0.5188178137209007],
      max: [0.7487007736705067, 0.5721105829154567, 0.5424839661460226],
    },
    socks: {
      min: [-0.6351631022580762, -3.742509071621839, -0.453612508171517],
      max: [0.6350475932274549, -1.936594049112631, 0.20725570215458333],
    },
  });

  const sourceCanvas = document.getElementById("kitCanvas");
  const canvasStage = document.getElementById("canvasStage");
  const stage3d = document.getElementById("kitlab3dStage");
  const canvas3d = document.getElementById("kitlab3dCanvas");
  const btn2d = document.getElementById("kitlab2dModeBtn");
  const btn3d = document.getElementById("kitlab3dModeBtn");
  const templateName = document.getElementById("selectedTemplateName");
  const selectedCollarName = document.getElementById("selectedCollarName");
  const loadingEl = document.getElementById("kitlab3dLoading");
  const errorEl = document.getElementById("kitlab3dError");
  const resetBtn = document.getElementById("kitlab3dResetBtn");
  const shirtBtn = document.getElementById("kitlab3dShirtBtn");
  const shortBtn = document.getElementById("kitlab3dShortBtn");
  const socksBtn = document.getElementById("kitlab3dSocksBtn");
  const armbandBtn = document.getElementById("kitlab3dArmbandBtn");
  const helpText = document.getElementById("kitlab3dHelp");
  const statusText = document.getElementById("statusText");
  const numbersPanel = document.getElementById("kitlabNumbersPanel");
  const numbersPanelToggle = document.getElementById("kitlabNumbersPanelToggle");
  const numbersPanelClose = document.getElementById("kitlabNumbersPanelClose");
  const rightTabsNav = document.querySelector(".kitlab-right-tabs");
  const rightTabButtons = {
    project: document.getElementById("kitlabProjectTab"),
    config: document.getElementById("kitlabConfigTab"),
    numbers: document.getElementById("kitlabNumbersTab"),
    font: document.getElementById("kitlabFontTab"),
  };
  const rightTabPanels = {
    project: document.getElementById("kitlabProjectTabPanel"),
    config: document.getElementById("kitlabConfigTabPanel"),
    numbers: document.getElementById("kitlabNumbersTabPanel"),
    font: document.getElementById("kitlabFontTabPanel"),
  };

  if (!sourceCanvas || !canvasStage || !stage3d || !canvas3d || !btn2d || !btn3d) return;

  let active3d = false;
  let initialized = false;
  let loadPromise = null;
  let gl = null;
  let program = null;
  let texture = null;
  let textureReady = false;
  let textureDirty = true;
  let textureDirtySince = 0;
  let textureRefreshTimer = 0;
  // The current main GLB is split once into Shirt YES and the shared Short/Socks.
  // Shirt NO is preloaded independently. Collar changes only swap GPU buffer lists.
  let lowerPrimitives = [];
  let shirtYesPrimitives = [];
  let shirtNoPrimitives = [];
  let armbandPrimitives = [];
  let numbersProgram = null;
  let numbersFontPrimitives = [];
  const numbersFontTextures = Object.create(null);
  const numbersFontCanvases = Object.create(null);
  const NUMBERS_CALIBRATION_STORAGE_KEY = "kitlab6:numbers-fonts-manual-calibration:v2";
  let numbersMeshSourceData = null;
  let numbersMeshCalibrationUi = null;
  let numbersMeshCalibrationSvg = null;
  let lastMainCameraState = null;
  let lastMainViewProjection = null;
  const numbersMeshEditor = {
    active: false,
    piece: "back",
    mode: "vertex",
    surfaceOffset: 0.025,
    drag: null,
    status: "Manual calibration ready",
  };
  let bounds = null;
  let focusBounds = null;
  let armbandBounds = null;
  let activeModel = "main";
  let initialDistance = 12;
  let distance = 12;
  let cameraTarget = [0, 0, 0];
  let yaw = 0;
  let pitch = 0;
  const ARMBAND_DEFAULT_SPIN = Math.PI / 6; // 30°
  let armbandSpin = ARMBAND_DEFAULT_SPIN;
  const rotations = {
    main: { yaw: 0, pitch: 0 },
    armband: {
      yaw: ARMBAND_CAMERA_YAW,
      pitch: ARMBAND_CAMERA_PITCH,
    },
  };
  let currentFocus = "reset";
  // Committed state is what is currently visible in the 3D framebuffer.
  // Pending state follows the UI selection but is not displayed until the
  // matching collar texture has finished rendering.
  let useCollarNoModel = false;
  let committedCollarLabel = "";
  let pendingCollarLabel = "";
  let pendingUseCollarNoModel = false;
  let collarVisualCommitPending = false;
  let collarCommitFallbackFrame = 0;

  // Final fixed framing. There are no zoom controls in the 3D viewer.
  const FIXED_FOCUS_PERCENT = Object.freeze({
    reset: 100,
    shirt: 95,
    short: 90,
    socks: 90,
    armband: 35,
  });

  let cameraTransition = null;
  let renderFrame = 0;
  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;

  const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

  const OFFICIAL_NUMBERS_FONTS_TRANSFORMS = Object.freeze({
    // First pass measured from the supplied straight PES6 / KitLab guide views.
    back: Object.freeze({ width: 1.17, height: 1.12, x: -11, y: 10, depth: 0 }),
    backDigit1: Object.freeze({ width: 1, height: 1, x: 19, y: 0, depth: 0 }),
    backDigit2: Object.freeze({ width: 1, height: 1, x: -9, y: 0, depth: 0 }),

    // First Font Top pass from the supplied top-name guide proportions.
    name: Object.freeze({ width: 0.86, height: 1.44, x: 0, y: -20, depth: -30 }),
    nameBottom: Object.freeze({ width: 1.18, height: 1.43, x: 0, y: 0, depth: 0 }),

    front: Object.freeze({ width: 1, height: 1, x: 0, y: 0, depth: 0 }),
    frontTopRight: Object.freeze({ width: 1.06, height: 1.02, x: -4, y: 50, depth: -20 }),
    frontDigit1: Object.freeze({ width: 1, height: 1, x: 9, y: 0, depth: 0 }),
    frontDigit2: Object.freeze({ width: 1, height: 1, x: -9, y: 0, depth: 0 }),

    short: Object.freeze({ width: 1, height: 1, x: 0, y: 0, depth: 0 }),
    shortLeft: Object.freeze({ width: 1, height: 1.17, x: 13, y: -5, depth: -30 }),
    shortRight: Object.freeze({ width: 1, height: 1.17, x: 13, y: -5, depth: 3 }),
    shortDigit1: Object.freeze({ width: 1, height: 1, x: 0, y: 0, depth: 0 }),
    shortDigit2: Object.freeze({ width: 1, height: 1, x: 0, y: 0, depth: 0 }),
  });

  const NUMBERS_FONTS_CALIBRATION_KEYS = Object.freeze([
    "back", "backDigit1", "backDigit2",
    "name", "nameBottom", "front", "frontTopRight",
    "frontDigit1", "frontDigit2", "short", "shortLeft", "shortRight",
    "shortDigit1", "shortDigit2",
  ]);
  const UNIVERSAL_NUMBERS_FONTS_CALIBRATION_KEY = "kitlab6_universal_numbers_fonts_calibration_v208";

  function sanitizeUniversalCalibrationTransform(value, fallback) {
    const source = value && typeof value === "object" ? value : {};
    const base = fallback && typeof fallback === "object"
      ? fallback
      : { width: 1, height: 1, x: 0, y: 0, depth: 0 };
    return {
      width: Math.max(0.10, Math.min(3.00, Number(source.width) || Number(base.width) || 1)),
      height: Math.max(0.10, Math.min(3.00, Number(source.height) || Number(base.height) || 1)),
      x: Math.max(-100, Math.min(100, Number.isFinite(Number(source.x)) ? Number(source.x) : Number(base.x) || 0)),
      y: Math.max(-100, Math.min(100, Number.isFinite(Number(source.y)) ? Number(source.y) : Number(base.y) || 0)),
      // Depth deliberately has no software limit.
      depth: Number.isFinite(Number(source.depth)) ? Number(source.depth) : Number(base.depth) || 0,
    };
  }

  function cloneOfficialCalibrationProfile() {
    return Object.fromEntries(
      NUMBERS_FONTS_CALIBRATION_KEYS.map((key) => [
        key,
        sanitizeUniversalCalibrationTransform(
          OFFICIAL_NUMBERS_FONTS_TRANSFORMS[key],
          OFFICIAL_NUMBERS_FONTS_TRANSFORMS.back,
        ),
      ]),
    );
  }

  function loadUniversalCalibrationProfile() {
    const profile = cloneOfficialCalibrationProfile();
    try {
      const saved = JSON.parse(localStorage.getItem(UNIVERSAL_NUMBERS_FONTS_CALIBRATION_KEY) || "null");
      if (saved && typeof saved === "object") {
        for (const key of NUMBERS_FONTS_CALIBRATION_KEYS) {
          profile[key] = sanitizeUniversalCalibrationTransform(
            saved[key],
            OFFICIAL_NUMBERS_FONTS_TRANSFORMS[key],
          );
        }
      }
    } catch {}
    return profile;
  }

  let universalNumbersFontsCalibration = loadUniversalCalibrationProfile();
  let universalNumbersFontsCalibrationTarget = "back";

  function saveUniversalCalibrationProfile() {
    try {
      localStorage.setItem(
        UNIVERSAL_NUMBERS_FONTS_CALIBRATION_KEY,
        JSON.stringify(universalNumbersFontsCalibration),
      );
    } catch {}
  }

  function officialNumbersFontsTransform(key) {
    const source = universalNumbersFontsCalibration[key]
      || OFFICIAL_NUMBERS_FONTS_TRANSFORMS[key]
      || OFFICIAL_NUMBERS_FONTS_TRANSFORMS.back;
    return { ...source };
  }

  function updateUniversalNumbersFontsTransform(key, field, rawValue) {
    if (!NUMBERS_FONTS_CALIBRATION_KEYS.includes(key)) return;
    const current = officialNumbersFontsTransform(key);
    const next = sanitizeUniversalCalibrationTransform(
      { ...current, [field]: rawValue },
      OFFICIAL_NUMBERS_FONTS_TRANSFORMS[key],
    );
    universalNumbersFontsCalibration[key] = next;
    saveUniversalCalibrationProfile();
    forceOfficialNumbersFontsGeometry();
    syncNumbersFontsTransformControls();

    const textureTargets = new Set([
      "back", "backDigit1", "backDigit2",
      "frontDigit1", "frontDigit2", "shortDigit1", "shortDigit2",
    ]);
    if (field !== "depth" && textureTargets.has(key)) requestNumbersFontsTextureRefresh();
    else requestRender();
  }

  function resetUniversalNumbersFontsTransform(key) {
    if (!NUMBERS_FONTS_CALIBRATION_KEYS.includes(key)) return;
    universalNumbersFontsCalibration[key] = sanitizeUniversalCalibrationTransform(
      OFFICIAL_NUMBERS_FONTS_TRANSFORMS[key],
      OFFICIAL_NUMBERS_FONTS_TRANSFORMS.back,
    );
    saveUniversalCalibrationProfile();
    forceOfficialNumbersFontsGeometry();
    syncNumbersFontsTransformControls();
    requestNumbersFontsTextureRefresh();
  }

  function resetUniversalNumbersFontsCalibration() {
    universalNumbersFontsCalibration = cloneOfficialCalibrationProfile();
    universalNumbersFontsCalibrationTarget = "back";
    saveUniversalCalibrationProfile();
    forceOfficialNumbersFontsGeometry();
    syncNumbersFontsControls();
    requestNumbersFontsTextureRefresh();
  }

  const NUMBERS_FONTS_DEFAULT_STATE = Object.freeze({
    playerName: "KITLAB",
    backNumber: "6",
    frontNumber: "6",
    shortNumber: "6",
    fill: "#ffffff",
    stroke: "#111111",
    strokeWidth: 0,
    fontFamily: "Arial Black, Arial, sans-serif",
    nameVisible: false,
    namePosition: "none",
    backVisible: false,
    frontPosition: "none",
    shortSide: "left",
    panelOpen: false,
    layoutVersion: KITLAB_NUMBERS_FONTS_LAYOUT_VERSION,
    storageScope: "per_kit_v3",
    ownerKitId: "",
    pes6NumberAsset: null,
    pes6FontAsset: null,
    transformTarget: "back",
    meshCalibration: null,
    gdbConfig: {
      description: "",
      model: "33",
      collar: "yes",
      nameShape: "type1",
      radarColor: "",
      shortsColor: "",
    },
    transforms: OFFICIAL_NUMBERS_FONTS_TRANSFORMS,
  });

  let numbersFontsState = cloneNumbersFontsDefaultState();
  let numbersFontsApplyGeneration = 0;

  function forceOfficialNumbersFontsGeometry() {
    numbersFontsState.transforms = Object.fromEntries(
      NUMBERS_FONTS_CALIBRATION_KEYS.map((key) => [key, officialNumbersFontsTransform(key)]),
    );
    numbersFontsState.meshCalibration = null;
    numbersFontsState.transformTarget = universalNumbersFontsCalibrationTarget;
    numbersFontsState.layoutVersion = KITLAB_NUMBERS_FONTS_LAYOUT_VERSION;
  }
  // Every kit owns its own complete Numbers, Font and GDB configuration.
  // app.js stores this serialized state in the active kit while the Project is
  // open and includes every kit state only when the Project is explicitly saved.
  let activeNumbersSidebarTab = "project";
  let numbersFontsFlagIndexPromise = null;
  const numbersFontsLibraryState = {
    numbers: {
      roots: [["assets", "numbers"]],
      selectionKey: "pes6NumberAsset",
      label: "Numbers",
      country: "",
      root: null,
      countriesLoaded: false,
      loading: false,
    },
    font: {
      roots: [["assets", "fonts"], ["assets", "font"]],
      selectionKey: "pes6FontAsset",
      label: "Font",
      country: "",
      root: null,
      countriesLoaded: false,
      loading: false,
    },
  };

  let gdbRadarColor = "";
  let gdbShortsColor = "";
  let gdbColorSyncTimer = 0;

  function normalizeAngle(angle) {
    const fullTurn = Math.PI * 2;
    let normalized = Number(angle) || 0;
    normalized = ((normalized % fullTurn) + fullTurn) % fullTurn;
    return normalized;
  }


  function hasActiveTemplate() {
    const text = String(templateName?.textContent || "").trim().toLowerCase();
    return !!text && text !== "no template";
  }

  function selectedCollarLabel() {
    return String(selectedCollarName?.textContent || "")
      .replace(/^\s*Collar\s*:\s*/i, "")
      .trim();
  }

  function normalizedCollarLabel(label = "") {
    return String(label || "").trim().toUpperCase();
  }

  function collarLabelRequiresNoModel(label = "") {
    return /\/NO\s*$/i.test(String(label || "").trim());
  }

  function collarNameRequiresNoModel() {
    return collarLabelRequiresNoModel(selectedCollarLabel());
  }

  function syncCollarModelFromName() {
    const nextLabel = selectedCollarLabel();
    const nextUseNo = collarLabelRequiresNoModel(nextLabel);
    syncGdbCollarControl(nextLabel);

    // Before WebGL exists there is nothing visible to preserve.
    if (!initialized) {
      useCollarNoModel = nextUseNo;
      committedCollarLabel = nextLabel;
      pendingCollarLabel = nextLabel;
      pendingUseCollarNoModel = nextUseNo;
      collarVisualCommitPending = false;
      return;
    }

    if (
      normalizedCollarLabel(nextLabel) === normalizedCollarLabel(committedCollarLabel) &&
      nextUseNo === useCollarNoModel
    ) {
      pendingCollarLabel = nextLabel;
      pendingUseCollarNoModel = nextUseNo;
      collarVisualCommitPending = false;
      return;
    }

    // Do not change geometry yet. The old complete collar remains visible
    // until app.js confirms that the new collar texture is ready.
    pendingCollarLabel = nextLabel;
    pendingUseCollarNoModel = nextUseNo;
    collarVisualCommitPending = true;
  }

  function commitPendingCollarVisual() {
    if (!initialized || !collarVisualCommitPending) return false;
    if (!uploadTextureFastFromCanvas()) return false;

    // Texture and geometry are committed together before the next WebGL frame.
    useCollarNoModel = pendingUseCollarNoModel;
    committedCollarLabel = pendingCollarLabel;
    collarVisualCommitPending = false;

    // The native canvas upload is immediate. Rebuild the Safe-Strong edge
    // texture quietly afterwards, without delaying the visible collar swap.
    textureDirty = true;
    textureDirtySince = performance.now();
    scheduleTextureRefresh(80);
    requestRender();
    return true;
  }

  function sync3dAvailability() {
    const available = hasActiveTemplate();
    btn3d.disabled = !available;
    btn3d.title = available ? "Open real-time 3D preview" : "Load a template first";
    if (!available && active3d) switchTo2d();
  }

  function setModeButtons(mode) {
    const is3d = mode === "3d";
    btn2d.classList.toggle("active", !is3d);
    btn3d.classList.toggle("active", is3d);
    btn2d.setAttribute("aria-pressed", String(!is3d));
    btn3d.setAttribute("aria-pressed", String(is3d));
  }

  function setStatus(message) {
    if (statusText) statusText.textContent = message;
  }

  function showError(message) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = message;
    }
    setStatus(message);
  }

  function freezeCurrent3DView() {
    if (!initialized) return;
    if (cameraTransition) {
      updateCameraTransition();
      cameraTransition = null;
    }
    if (activeModel === "main") {
      rotations.main.yaw = yaw;
      rotations.main.pitch = pitch;
    } else {
      rotations.armband.yaw = yaw;
      rotations.armband.pitch = pitch;
    }
  }

  function switchTo2d(options = {}) {
    const restore2D = options.restore2D !== false;
    const preserveNumbersFonts = options.preserveNumbersFonts === true;
    freezeCurrent3DView();
    active3d = false;
    if (numbersFontsState.panelOpen && !preserveNumbersFonts) {
      numbersFontsState.panelOpen = false;
      activeNumbersSidebarTab = "project";
      syncNumbersFontsPanelVisibility();
    }
    stage3d.hidden = true;
    canvasStage.hidden = false;
    setModeButtons("2d");
    if (restore2D) {
      try { window.KitLab6PreviewView?.restore2D?.(); } catch (_) {}
    }
    setStatus("2D preview");
  }

  async function switchTo3d() {
    if (!hasActiveTemplate()) {
      sync3dAvailability();
      setStatus("Load a template before opening 3D");
      return;
    }

    // Preserve the exact 2D zoom and scroll point before hiding the stage.
    try { window.KitLab6PreviewView?.capture2D?.(); } catch (_) {}

    active3d = true;
    canvasStage.hidden = true;
    stage3d.hidden = false;
    setModeButtons("3d");
    resizeCanvas();
    textureDirty = true;
    textureDirtySince = 0;
    setStatus("Loading 3D preview...");
    try {
      await ensureInitialized();

      // Manual return to 3D keeps the exact previous focus, camera, rotation,
      // active model and selected icon.
      setFocusButtonState(currentFocus);
      setStatus("3D preview · drag horizontally to rotate 360°");
      requestRender();
    } catch (error) {
      console.error("KitLab6 3D initialization failed", error);
      showError("3D model could not be loaded");
    }
  }

  btn2d.addEventListener("click", () => switchTo2d());
  btn3d.addEventListener("click", () => {
    // The 3D button keeps its original place. While already in 3D it also
    // provides the Full model view because the new toolbar follows the exact
    // order requested and contains no additional Full button.
    if (active3d && initialized) {
      focusCamera("reset", true);
      return;
    }
    switchTo3d();
  });

  function reset3DPreviewForNewContent(event) {
    cameraTransition = null;
    currentFocus = "reset";
    activeModel = "main";
    yaw = 0;
    pitch = 0;
    rotations.main.yaw = 0;
    rotations.main.pitch = 0;
    rotations.armband.yaw = ARMBAND_CAMERA_YAW;
    rotations.armband.pitch = ARMBAND_CAMERA_PITCH;
    armbandSpin = ARMBAND_DEFAULT_SPIN;

    const loadKind = String(event?.detail?.kind || "").toLowerCase();
    const kitSwitch = !!(
      window.__kitlabProjectSwitchToken
      || window.__kitlabProjectPrewarmToken
    );
    if (loadKind === "project" && !kitSwitch) {
      // A different saved Project is opening. Show neutral defaults only until
      // app.js applies the saved state belonging to its active kit.
      resetNumbersFontsState({ preservePanel: false });
    }
    // Template changes and kit switches never copy another kit's state here.
    // app.js applies the destination kit state immediately after the switch.

    if (initialized && focusBounds) {
      const view = calibratedViewForFocus("reset");
      cameraTarget = view.target.slice();
      distance = view.distance;
      setFocusButtonState("reset");
    }

    // A Template or Project always opens in 2D. Do not restore the previous
    // 2D view here: app.js has already reset it to the approved default.
    if (active3d) {
      switchTo2d({ restore2D: false, preserveNumbersFonts: true });
    } else {
      stage3d.hidden = true;
      canvasStage.hidden = false;
      setModeButtons("2d");
    }
  }

  window.addEventListener("kitlab:content-load-start", reset3DPreviewForNewContent);

  if (templateName) {
    new MutationObserver(sync3dAvailability).observe(templateName, { childList: true, subtree: true, characterData: true });
  }
  if (selectedCollarName) {
    new MutationObserver(() => {
      syncCollarModelFromName();
      syncGdbCollarControl();
    }).observe(selectedCollarName, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  sync3dAvailability();
  syncCollarModelFromName();

  function ensureInitialized() {
    if (initialized) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = initializeWebGL();
    return loadPromise;
  }

  async function initializeWebGL() {
    gl = canvas3d.getContext("webgl", {
      alpha: false,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL is unavailable");

    program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    numbersProgram = createProgram(gl, NUMBERS_VERTEX_SHADER, NUMBERS_FRAGMENT_SHADER);
    gl.useProgram(program.handle);

    gl.enable(gl.DEPTH_TEST);
    // Strict depth comparison keeps coincident/duplicated faces stable while rotating.
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    // Keep normal alpha blending disabled: it produced black halos and fine
    // transparent seams. Alpha-to-coverage preserves real cut-outs smoothly
    // when the antialiased default framebuffer supports multisampling.
    gl.disable(gl.BLEND);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.depthMask(true);
    gl.clearColor(49 / 255, 54 / 255, 88 / 255, 1);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const loadModel = async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Model HTTP ${response.status}: ${url}`);
      const parsed = parseGlb(await response.arrayBuffer());
      return buildModelData(parsed.json, parsed.bin);
    };

    const shirtNoPromise = loadModel(SHIRT_NO_MODEL_URL).catch((error) => {
      console.warn("KitLab6 Shirt Collar NO could not be loaded; Collar YES remains available", error);
      return null;
    });

    const numbersFontsPromise = loadNumbersFontsMeshData().catch((error) => {
      console.warn("KitLab6 Numbers & Fonts exact UV meshes could not be loaded", error);
      return null;
    });

    const [model, shirtNoModel, armbandModel, numbersFontsData] = await Promise.all([
      loadModel(MAIN_MODEL_URL),
      shirtNoPromise,
      loadModel(ARMBAND_MODEL_URL),
      numbersFontsPromise,
    ]);

    preserveApprovedMainFraming(model);

    bounds = model.bounds;
    focusBounds = model.focusBounds;

    const shirtSplitY = (
      MAIN_APPROVED_FOCUS_BOUNDS.short.max[1] +
      MAIN_APPROVED_FOCUS_BOUNDS.shirt.min[1]
    ) * 0.5;
    const splitMain = splitPrimitivesAtY(model.primitives, shirtSplitY);
    lowerPrimitives = splitMain.lower.map((primitive) => createPrimitiveBuffers(gl, primitive));

    const cleanShirtYes = cleanCollapsedTrianglesFromShirtPrimitives(
      splitMain.upper,
      "Collar YES"
    );
    shirtYesPrimitives = cleanShirtYes.map(
      (primitive) => createPrimitiveBuffers(gl, primitive)
    );

    if (shirtNoModel) {
      alignStandaloneShirtToReferenceShirt(shirtNoModel, splitMain.upper);
      const cleanShirtNo = cleanCollapsedTrianglesFromShirtPrimitives(
        shirtNoModel.primitives,
        "Collar NO"
      );
      shirtNoPrimitives = cleanShirtNo.map(
        (primitive) => createPrimitiveBuffers(gl, primitive)
      );
    }

    // Keep the independent piece above the shirt, outside the Full view.
    // The camera slides upward to this reserved inspection area only when requested.
    const armbandHalfHeight = Math.max(0.05, (armbandModel.bounds.max[1] - armbandModel.bounds.min[1]) * 0.5);
    const desiredArmbandCenterY = bounds.max[1] + armbandHalfHeight + 0.75;
    const currentArmbandCenterY = (armbandModel.bounds.min[1] + armbandModel.bounds.max[1]) * 0.5;
    translateModelData(armbandModel, [0, desiredArmbandCenterY - currentArmbandCenterY, 0]);
    armbandBounds = armbandModel.bounds;
    armbandPrimitives = armbandModel.primitives.map((primitive) => createPrimitiveBuffers(gl, primitive));
    if (numbersFontsData) initializeNumbersFontsGpu(numbersFontsData);

    const initialView = cameraViewForBounds(focusBounds?.reset || bounds, 1.10);
    initialDistance = initialView.distance;
    distance = initialDistance;
    cameraTarget = initialView.target.slice();

    initialized = true;
    const initialCollarLabel = selectedCollarLabel();
    useCollarNoModel = collarLabelRequiresNoModel(initialCollarLabel);
    committedCollarLabel = initialCollarLabel;
    pendingCollarLabel = initialCollarLabel;
    pendingUseCollarNoModel = useCollarNoModel;
    collarVisualCommitPending = false;
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = true;
    resizeCanvas();
    uploadTexture();
    syncNumbersFontsTextures();
    activeModel = "main";
    setFocusButtonState("reset");
    requestRender();
  }

  function parseGlb(buffer) {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Invalid GLB header");
    if (view.getUint32(4, true) !== 2) throw new Error("Only GLB 2.0 is supported");
    const totalLength = view.getUint32(8, true);
    let offset = 12;
    let json = null;
    let bin = null;
    const decoder = new TextDecoder("utf-8");
    while (offset + 8 <= totalLength) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      offset += 8;
      if (chunkType === 0x4e4f534a) {
        const bytes = new Uint8Array(buffer, offset, chunkLength);
        json = JSON.parse(decoder.decode(bytes).replace(/\u0000+$/g, "").trim());
      } else if (chunkType === 0x004e4942) {
        bin = buffer.slice(offset, offset + chunkLength);
      }
      offset += chunkLength;
    }
    if (!json || !bin) throw new Error("Incomplete GLB file");
    return { json, bin };
  }

  function readComponent(view, offset, componentType) {
    switch (componentType) {
      case 5120: return view.getInt8(offset);
      case 5121: return view.getUint8(offset);
      case 5122: return view.getInt16(offset, true);
      case 5123: return view.getUint16(offset, true);
      case 5125: return view.getUint32(offset, true);
      case 5126: return view.getFloat32(offset, true);
      default: throw new Error(`Unsupported component type ${componentType}`);
    }
  }

  function readAccessor(json, bin, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const bufferView = json.bufferViews[accessor.bufferView];
    const componentCount = TYPE_COMPONENTS[accessor.type];
    const componentBytes = COMPONENT_BYTES[accessor.componentType];
    if (!componentCount || !componentBytes) throw new Error("Unsupported accessor");
    const stride = bufferView.byteStride || componentCount * componentBytes;
    const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const view = new DataView(bin);
    const total = accessor.count * componentCount;
    let output;
    if (accessor.componentType === 5126) output = new Float32Array(total);
    else if (accessor.componentType === 5125) output = new Uint32Array(total);
    else if (accessor.componentType === 5123) output = new Uint16Array(total);
    else if (accessor.componentType === 5121) output = new Uint8Array(total);
    else output = new Float32Array(total);

    for (let i = 0; i < accessor.count; i++) {
      const elementOffset = start + i * stride;
      for (let c = 0; c < componentCount; c++) {
        output[i * componentCount + c] = readComponent(view, elementOffset + c * componentBytes, accessor.componentType);
      }
    }
    return { data: output, accessor, componentCount };
  }

  function buildModelData(json, bin) {
    const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
    const scene = json.scenes?.[sceneIndex] || { nodes: [0] };
    const nodeIndex = scene.nodes?.[0] ?? 0;
    const node = json.nodes?.[nodeIndex] || {};
    const mesh = json.meshes?.[node.mesh ?? 0];
    if (!mesh) throw new Error("GLB has no mesh");

    const scale = node.scale || [1, 1, 1];
    const translation = node.translation || [0, 0, 0];
    const rawPrimitives = [];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (const primitive of mesh.primitives || []) {
      const pos = readAccessor(json, bin, primitive.attributes.POSITION).data;
      const normal = primitive.attributes.NORMAL != null ? readAccessor(json, bin, primitive.attributes.NORMAL).data : null;
      const uv = primitive.attributes.TEXCOORD_0 != null ? readAccessor(json, bin, primitive.attributes.TEXCOORD_0).data : null;
      const indexRead = primitive.indices != null ? readAccessor(json, bin, primitive.indices) : null;
      const positions = new Float32Array(pos.length);
      const normals = new Float32Array(pos.length);
      const uvs = uv ? new Float32Array(uv) : new Float32Array((pos.length / 3) * 2);

      for (let i = 0; i < pos.length; i += 3) {
        const bx = pos[i] * scale[0] + translation[0];
        const by = pos[i + 1] * scale[1] + translation[1];
        const bz = pos[i + 2] * scale[2] + translation[2];
        // The source mesh uses Blender Z as vertical. Rotate once into browser Y-up.
        const x = bx;
        const y = -bz;
        const z = by;
        positions[i] = x;
        positions[i + 1] = y;
        positions[i + 2] = z;
        min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
        max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);

        if (normal) {
          let nx = normal[i];
          let ny = -normal[i + 2];
          let nz = normal[i + 1];
          const length = Math.hypot(nx, ny, nz) || 1;
          normals[i] = nx / length;
          normals[i + 1] = ny / length;
          normals[i + 2] = nz / length;
        } else {
          normals[i] = 0; normals[i + 1] = 0; normals[i + 2] = 1;
        }
      }

      rawPrimitives.push({
        positions,
        normals,
        uvs,
        indices: indexRead?.data || null,
        indexComponentType: indexRead?.accessor?.componentType || null,
      });
    }

    const center = [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5];
    const fullHeight = Math.max(0.001, max[1] - min[1]);
    // This ALEGOR model is arranged vertically: socks, shorts and shirt.
    // The cut lines sit in the empty gaps between those three pieces.
    const socksTop = min[1] + fullHeight * 0.31;
    const shirtBottom = min[1] + fullHeight * 0.61;
    const regionPoints = { reset: [], shirt: [], short: [], socks: [] };

    for (const primitive of rawPrimitives) {
      for (let i = 0; i < primitive.positions.length; i += 3) {
        const rawX = primitive.positions[i];
        const rawY = primitive.positions[i + 1];
        const rawZ = primitive.positions[i + 2];
        const x = rawX - center[0];
        const y = rawY - center[1];
        const z = rawZ - center[2];
        primitive.positions[i] = x;
        primitive.positions[i + 1] = y;
        primitive.positions[i + 2] = z;
        regionPoints.reset.push([x, y, z]);
        if (rawY >= shirtBottom) regionPoints.shirt.push([x, y, z]);
        else if (rawY >= socksTop) regionPoints.short.push([x, y, z]);
        else regionPoints.socks.push([x, y, z]);
      }
    }

    function boundsFromPoints(points, fallback) {
      if (!points?.length) return fallback;
      // Ignore only extreme isolated vertices, which may belong to invisible helper geometry.
      function percentile(values, t) {
        const sorted = values.slice().sort((a, b) => a - b);
        const at = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * t)));
        return sorted[at];
      }
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      const zs = points.map((point) => point[2]);
      return {
        min: [percentile(xs, 0.005), percentile(ys, 0.002), percentile(zs, 0.005)],
        max: [percentile(xs, 0.995), percentile(ys, 0.998), percentile(zs, 0.995)],
      };
    }

    const centeredBounds = {
      min: [min[0] - center[0], min[1] - center[1], min[2] - center[2]],
      max: [max[0] - center[0], max[1] - center[1], max[2] - center[2]],
    };
    return {
      primitives: rawPrimitives,
      bounds: centeredBounds,
      focusBounds: {
        reset: boundsFromPoints(regionPoints.reset, centeredBounds),
        shirt: boundsFromPoints(regionPoints.shirt, centeredBounds),
        short: boundsFromPoints(regionPoints.short, centeredBounds),
        socks: boundsFromPoints(regionPoints.socks, centeredBounds),
      },
    };
  }

  function copyBounds(source) {
    return {
      min: source.min.slice(),
      max: source.max.slice(),
    };
  }

  function preserveApprovedMainFraming(model) {
    // Re-align the cleaned geometry to the approved centre.
    // Shirt and socks are physically separated by equal opposite offsets,
    // while Short remains fixed.
    for (const primitive of model.primitives) {
      for (let index = 1; index < primitive.positions.length; index += 3) {
        primitive.positions[index] += MAIN_FRAMING_COMPAT_Y;
      }
    }

    model.bounds = copyBounds(MAIN_APPROVED_BOUNDS);
    model.focusBounds = {
      reset: copyBounds(MAIN_APPROVED_FOCUS_BOUNDS.reset),
      shirt: copyBounds(MAIN_APPROVED_FOCUS_BOUNDS.shirt),
      short: copyBounds(MAIN_APPROVED_FOCUS_BOUNDS.short),
      socks: copyBounds(MAIN_APPROVED_FOCUS_BOUNDS.socks),
    };
  }

  function translateModelData(model, offset) {
    for (const primitive of model.primitives) {
      for (let i = 0; i < primitive.positions.length; i += 3) {
        primitive.positions[i] += offset[0];
        primitive.positions[i + 1] += offset[1];
        primitive.positions[i + 2] += offset[2];
      }
    }
    const shiftBounds = (targetBounds) => {
      if (!targetBounds) return;
      for (let axis = 0; axis < 3; axis += 1) {
        targetBounds.min[axis] += offset[axis];
        targetBounds.max[axis] += offset[axis];
      }
    };
    shiftBounds(model.bounds);
    if (model.focusBounds) {
      for (const targetBounds of Object.values(model.focusBounds)) shiftBounds(targetBounds);
    }
  }

  function verticesAreEffectivelyIdentical(positions, firstIndex, secondIndex) {
    const dx = positions[firstIndex * 3] - positions[secondIndex * 3];
    const dy = positions[firstIndex * 3 + 1] - positions[secondIndex * 3 + 1];
    const dz = positions[firstIndex * 3 + 2] - positions[secondIndex * 3 + 2];

    // 0.000002 model units is microscopic relative to a Shirt width of ~3.5.
    // A triangle containing an edge this small has no usable surface.
    return (dx * dx + dy * dy + dz * dz) <= 4e-12;
  }

  function removeCollapsedTrianglesFromShirtPrimitive(primitive) {
    const sourceIndices = primitive.indices;
    const triangleCount = sourceIndices
      ? Math.floor(sourceIndices.length / 3)
      : Math.floor((primitive.positions.length / 3) / 3);

    const keptTriangleVertexIndices = [];
    let removed = 0;

    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const offset = triangle * 3;
      const a = sourceIndices ? sourceIndices[offset] : offset;
      const b = sourceIndices ? sourceIndices[offset + 1] : offset + 1;
      const c = sourceIndices ? sourceIndices[offset + 2] : offset + 2;

      const collapsed =
        verticesAreEffectivelyIdentical(primitive.positions, a, b) ||
        verticesAreEffectivelyIdentical(primitive.positions, b, c) ||
        verticesAreEffectivelyIdentical(primitive.positions, c, a);

      if (collapsed) {
        removed += 1;
        continue;
      }

      keptTriangleVertexIndices.push(a, b, c);
    }

    if (!removed) return { primitive, removed: 0 };

    if (sourceIndices) {
      const IndexArray = sourceIndices.constructor;
      return {
        primitive: {
          ...primitive,
          indices: new IndexArray(keptTriangleVertexIndices),
        },
        removed,
      };
    }

    const positions = new Float32Array(keptTriangleVertexIndices.length * 3);
    const normals = new Float32Array(keptTriangleVertexIndices.length * 3);
    const uvs = new Float32Array(keptTriangleVertexIndices.length * 2);

    for (let outputIndex = 0; outputIndex < keptTriangleVertexIndices.length; outputIndex += 1) {
      const sourceIndex = keptTriangleVertexIndices[outputIndex];
      positions.set(
        primitive.positions.subarray(sourceIndex * 3, sourceIndex * 3 + 3),
        outputIndex * 3
      );
      normals.set(
        primitive.normals.subarray(sourceIndex * 3, sourceIndex * 3 + 3),
        outputIndex * 3
      );
      uvs.set(
        primitive.uvs.subarray(sourceIndex * 2, sourceIndex * 2 + 2),
        outputIndex * 2
      );
    }

    return {
      primitive: {
        positions,
        normals,
        uvs,
        indices: null,
        indexComponentType: null,
      },
      removed,
    };
  }

  function cleanCollapsedTrianglesFromShirtPrimitives(sourcePrimitives, label) {
    const cleanedPrimitives = [];
    let removed = 0;

    for (const primitive of sourcePrimitives) {
      const result = removeCollapsedTrianglesFromShirtPrimitive(primitive);
      cleanedPrimitives.push(result.primitive);
      removed += result.removed;
    }

    if (removed > 0) {
      console.info(
        `KitLab6 3D: removed ${removed} collapsed Shirt triangle(s) from ${label}`
      );
    }

    return cleanedPrimitives;
  }

  function splitPrimitivesAtY(sourcePrimitives, splitY) {
    const lower = [];
    const upper = [];

    function expandedPrimitive(source, triangleVertexIndices) {
      const positions = new Float32Array(triangleVertexIndices.length * 3);
      const normals = new Float32Array(triangleVertexIndices.length * 3);
      const uvs = new Float32Array(triangleVertexIndices.length * 2);

      for (let outIndex = 0; outIndex < triangleVertexIndices.length; outIndex += 1) {
        const sourceIndex = triangleVertexIndices[outIndex];
        positions.set(source.positions.subarray(sourceIndex * 3, sourceIndex * 3 + 3), outIndex * 3);
        normals.set(source.normals.subarray(sourceIndex * 3, sourceIndex * 3 + 3), outIndex * 3);
        uvs.set(source.uvs.subarray(sourceIndex * 2, sourceIndex * 2 + 2), outIndex * 2);
      }

      return {
        positions,
        normals,
        uvs,
        indices: null,
        indexComponentType: null,
      };
    }

    for (const primitive of sourcePrimitives) {
      const sourceIndices = primitive.indices || null;
      const vertexCount = primitive.positions.length / 3;
      const triangleIndexCount = sourceIndices ? sourceIndices.length : vertexCount;
      const lowerIndices = [];
      const upperIndices = [];

      for (let index = 0; index + 2 < triangleIndexCount; index += 3) {
        const a = sourceIndices ? sourceIndices[index] : index;
        const b = sourceIndices ? sourceIndices[index + 1] : index + 1;
        const c = sourceIndices ? sourceIndices[index + 2] : index + 2;
        const centerY = (
          primitive.positions[a * 3 + 1] +
          primitive.positions[b * 3 + 1] +
          primitive.positions[c * 3 + 1]
        ) / 3;
        const target = centerY >= splitY ? upperIndices : lowerIndices;
        target.push(a, b, c);
      }

      if (lowerIndices.length) lower.push(expandedPrimitive(primitive, lowerIndices));
      if (upperIndices.length) upper.push(expandedPrimitive(primitive, upperIndices));
    }

    return { lower, upper };
  }

  function primitiveDataBounds(sourcePrimitives) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const primitive of sourcePrimitives) {
      for (let index = 0; index < primitive.positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = primitive.positions[index + axis];
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
    }
    return { min, max };
  }

  function alignStandaloneShirtToReferenceShirt(model, referencePrimitives) {
    const reference = primitiveDataBounds(referencePrimitives);
    const modelCenterX = (model.bounds.min[0] + model.bounds.max[0]) * 0.5;
    const modelCenterZ = (model.bounds.min[2] + model.bounds.max[2]) * 0.5;
    const referenceCenterX = (reference.min[0] + reference.max[0]) * 0.5;
    const referenceCenterZ = (reference.min[2] + reference.max[2]) * 0.5;

    // Align the shared body exactly to Shirt YES: same X/Z centre and same
    // lower hem. Collar NO may extend slightly higher because only its collar
    // geometry is different.
    translateModelData(model, [
      referenceCenterX - modelCenterX,
      reference.min[1] - model.bounds.min[1],
      referenceCenterZ - modelCenterZ,
    ]);
  }

  function createPrimitiveBuffers(context, primitive) {
    const positionBuffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
    context.bufferData(context.ARRAY_BUFFER, primitive.positions, context.STATIC_DRAW);

    const normalBuffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, normalBuffer);
    context.bufferData(context.ARRAY_BUFFER, primitive.normals, context.STATIC_DRAW);

    const uvBuffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, uvBuffer);
    context.bufferData(context.ARRAY_BUFFER, primitive.uvs, context.STATIC_DRAW);

    let indexBuffer = null;
    let indexType = null;
    let count = primitive.positions.length / 3;
    if (primitive.indices) {
      indexBuffer = context.createBuffer();
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
      context.bufferData(context.ELEMENT_ARRAY_BUFFER, primitive.indices, context.STATIC_DRAW);
      indexType = primitive.indexComponentType === 5125 ? context.UNSIGNED_INT : context.UNSIGNED_SHORT;
      count = primitive.indices.length;
    }
    return {
      positionBuffer, normalBuffer, uvBuffer, indexBuffer, indexType, count,
      positions: primitive.positions,
      normals: primitive.normals,
      uvs: primitive.uvs,
      indices: primitive.indices || null,
    };
  }

  function createShader(context, type, source) {
    const shader = context.createShader(type);
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
      const info = context.getShaderInfoLog(shader);
      context.deleteShader(shader);
      throw new Error(info || "Shader compile failed");
    }
    return shader;
  }

  function createProgram(context, vertexSource, fragmentSource) {
    const vertex = createShader(context, context.VERTEX_SHADER, vertexSource);
    const fragment = createShader(context, context.FRAGMENT_SHADER, fragmentSource);
    const handle = context.createProgram();
    context.attachShader(handle, vertex);
    context.attachShader(handle, fragment);
    context.linkProgram(handle);
    context.deleteShader(vertex);
    context.deleteShader(fragment);
    if (!context.getProgramParameter(handle, context.LINK_STATUS)) {
      throw new Error(context.getProgramInfoLog(handle) || "Program link failed");
    }
    return {
      handle,
      position: context.getAttribLocation(handle, "aPosition"),
      normal: context.getAttribLocation(handle, "aNormal"),
      uv: context.getAttribLocation(handle, "aUv"),
      viewProjection: context.getUniformLocation(handle, "uViewProjection"),
      model: context.getUniformLocation(handle, "uModel"),
      texture: context.getUniformLocation(handle, "uTexture"),
      depthBias: context.getUniformLocation(handle, "uDepthBias"),
      surfaceOffset: context.getUniformLocation(handle, "uSurfaceOffset"),
    };
  }



  function cloneNumbersFontsDefaultState() {
    return {
      ...NUMBERS_FONTS_DEFAULT_STATE,
      meshCalibration: null,
      gdbConfig: { ...NUMBERS_FONTS_DEFAULT_STATE.gdbConfig },
      transforms: {
        back: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.back },
        backDigit1: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.backDigit1 },
        backDigit2: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.backDigit2 },
        name: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.name },
        nameBottom: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.nameBottom },
        front: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.front },
        frontTopRight: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontTopRight },
        frontDigit1: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontDigit1 },
        frontDigit2: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontDigit2 },
        short: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.short },
        shortLeft: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortLeft },
        shortRight: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortRight },
        shortDigit1: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortDigit1 },
        shortDigit2: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortDigit2 },
      },
    };
  }

  function sanitizeNumbersColor(value, fallback) {
    const text = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
  }

  function sanitizeNumberValue(value) {
    return String(value ?? "").replace(/\D+/g, "").slice(0, 2);
  }

  function sanitizeMeshCalibration(value) {
    if (!value || typeof value !== "object") return null;
    const sourcePositions = value.positions && typeof value.positions === "object"
      ? value.positions
      : (value.pieces && typeof value.pieces === "object" ? value.pieces : null);
    if (!sourcePositions) return null;
    const positions = {};
    const calibrationVersion = Math.max(1, Number(value.version) || 1);
    for (const key of ["back", "name", "nameBottom", "front", "frontTopRight", "shortLeft", "shortRight"]) {
      const source = sourcePositions[key];
      if (!Array.isArray(source) || source.length < 9 || source.length > 12000 || source.length % 3 !== 0) continue;
      const clean = source.map((item) => Number(item));
      if (clean.some((item) => !Number.isFinite(item) || Math.abs(item) > 1000)) continue;
      positions[key] = clean;
    }
    if (!Object.keys(positions).length) return null;
    return {
      version: calibrationVersion,
      surfaceOffset: Math.max(0.003, Math.min(0.08, Number(value.surfaceOffset) || 0.025)),
      positions,
    };
  }

  function sanitizeNumbersFontsState(value = {}, base = cloneNumbersFontsDefaultState()) {
    const incoming = value && typeof value === "object" ? value : {};
    const target = { ...base, ...incoming };
    target.playerName = normalizePes6PlayerName(target.playerName);
    target.backNumber = sanitizeNumberValue(target.backNumber);
    target.frontNumber = sanitizeNumberValue(target.frontNumber);
    target.shortNumber = sanitizeNumberValue(target.shortNumber);
    target.fill = sanitizeNumbersColor(target.fill, "#ffffff");
    target.stroke = sanitizeNumbersColor(target.stroke, "#111111");
    target.strokeWidth = 0;
    target.fontFamily = String(target.fontFamily || NUMBERS_FONTS_DEFAULT_STATE.fontFamily);
    target.namePosition = ["none", "top", "bottom"].includes(target.namePosition) ? target.namePosition : "none";
    target.panelOpen = target.panelOpen === true;
    const incomingLayoutVersion = Math.max(0, Number(incoming.layoutVersion) || 0);
    target.pes6NumberAsset = sanitizePes6LibrarySelection(target.pes6NumberAsset);
    target.pes6FontAsset = sanitizePes6LibrarySelection(target.pes6FontAsset);

    const incomingGdb = incoming.gdbConfig && typeof incoming.gdbConfig === "object"
      ? incoming.gdbConfig
      : {};
    const baseGdb = base.gdbConfig && typeof base.gdbConfig === "object"
      ? base.gdbConfig
      : NUMBERS_FONTS_DEFAULT_STATE.gdbConfig;
    const description = String(incomingGdb.description ?? baseGdb.description ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 120);
    const modelDigits = String(incomingGdb.model ?? baseGdb.model ?? "33")
      .replace(/\D+/g, "")
      .slice(0, 3);
    const nameShape = String(incomingGdb.nameShape ?? baseGdb.nameShape ?? "type1").toLowerCase();
    target.gdbConfig = {
      description,
      model: modelDigits || "33",
      collar: String(incomingGdb.collar ?? baseGdb.collar ?? "yes").toLowerCase() === "no" ? "no" : "yes",
      nameShape: ["type1", "type2", "type3"].includes(nameShape) ? nameShape : "type1",
      radarColor: sanitizeNumbersColor(incomingGdb.radarColor, ""),
      shortsColor: sanitizeNumbersColor(incomingGdb.shortsColor, ""),
    };

    // PES6-only activation: no PNG means no visible number/font geometry.
    // This also prevents older projects from falling back to the provisional Arial renderer.
    const hasPes6Numbers = !!target.pes6NumberAsset?.path;
    const hasPes6Font = !!target.pes6FontAsset?.path;
    target.nameVisible = hasPes6Font && target.namePosition !== "none";
    target.backVisible = hasPes6Numbers;
    const requestedFrontPosition = String(target.frontPosition || "none").toLowerCase();
    const normalizedFrontPosition = requestedFrontPosition === "center"
      ? "top"
      : requestedFrontPosition;
    target.frontPosition = hasPes6Numbers && ["top", "topright"].includes(normalizedFrontPosition)
      ? normalizedFrontPosition
      : "none";
    target.shortSide = ["none", "left", "right", "both"].includes(target.shortSide) ? target.shortSide : "left";
    target.transformTarget = [
      "back", "backDigit1", "backDigit2", "name", "nameBottom", "front", "frontTopRight", "frontDigit1", "frontDigit2",
      "short", "shortLeft", "shortRight", "shortDigit1", "shortDigit2",
    ].includes(target.transformTarget) ? target.transformTarget : "back";
    target.meshCalibration = sanitizeMeshCalibration(incoming.meshCalibration ?? base.meshCalibration);
    const sourceTransforms = incoming.transforms && typeof incoming.transforms === "object" ? incoming.transforms : {};
    target.transforms = {};
    for (const key of [
      "back", "backDigit1", "backDigit2", "name", "nameBottom", "front", "frontTopRight", "frontDigit1", "frontDigit2",
      "short", "shortLeft", "shortRight", "shortDigit1", "shortDigit2",
    ]) {
      const source = sourceTransforms[key] && typeof sourceTransforms[key] === "object"
        ? sourceTransforms[key]
        : (base.transforms?.[key] || {});
      const legacyScale = Number.isFinite(Number(source.scale)) ? Number(source.scale) : 1;
      const sourceWidth = Number.isFinite(Number(source.width)) ? Number(source.width) : legacyScale;
      const sourceHeight = Number.isFinite(Number(source.height)) ? Number(source.height) : legacyScale;
      const sourceDepth = Number(source.depth);
      target.transforms[key] = {
        width: Math.max(0.10, Math.min(3.00, sourceWidth || 1)),
        height: Math.max(0.10, Math.min(3.00, sourceHeight || 1)),
        x: Math.max(-50, Math.min(50, Number(source.x) || 0)),
        y: Math.max(-50, Math.min(50, Number(source.y) || 0)),
        // Depth is intentionally unrestricted. The user decides the exact
        // contact point with the model, including negative values.
        depth: Number.isFinite(sourceDepth) ? sourceDepth : 0,
      };
    }
    // Preserve the approved Back/Name migration only for projects older
    // than layout 168. Newer projects keep every manual value unchanged.
    if (incomingLayoutVersion < 168) {
      target.transforms.name = { width: 1, height: 1, x: 0, y: 20, depth: 0 };
      target.transforms.back = { width: 1, height: 1, x: 0, y: 12, depth: 0 };
      if (target.meshCalibration?.positions?.back) {
        const positions = { ...target.meshCalibration.positions };
        delete positions.back;
        target.meshCalibration = Object.keys(positions).length
          ? { ...target.meshCalibration, version: 168, positions }
          : null;
      }
    }
    // Layout 172 adds independent texture controls for digit 1 and digit 2
    // on both Front and Short. Existing projects start from neutral values.
    if (incomingLayoutVersion < 172) {
      target.transforms.backDigit1 = { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.backDigit1 };
      target.transforms.backDigit2 = { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.backDigit2 };
      target.transforms.frontDigit1 = { width: 1, height: 1, x: 0, y: 0, depth: 0 };
      target.transforms.frontDigit2 = { width: 1, height: 1, x: 0, y: 0, depth: 0 };
      target.transforms.shortDigit1 = { width: 1, height: 1, x: 0, y: 0, depth: 0 };
      target.transforms.shortDigit2 = { width: 1, height: 1, x: 0, y: 0, depth: 0 };
    }
    // Layout 173 adds independent Short Left / Short Right geometry movement
    // and a persisted manual normal-distance value for every full piece.
    if (incomingLayoutVersion < 173) {
      target.transforms.shortLeft = { width: 1, height: 1, x: 0, y: 0, depth: 0 };
      target.transforms.shortRight = { width: 1, height: 1, x: 0, y: 0, depth: 0 };
      for (const transform of Object.values(target.transforms)) {
        if (!Number.isFinite(Number(transform.depth))) transform.depth = 0;
      }
    }
    // Layout 175 establishes the approved default placement for every
    // Numbers & Fonts receiver. Projects from older layouts receive these
    // values once; projects saved with 1.75 keep their own later adjustments.
    if (incomingLayoutVersion < 175) {
      target.transforms = {
        back: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.back },
        backDigit1: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.backDigit1 },
        backDigit2: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.backDigit2 },
        name: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.name },
        nameBottom: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.nameBottom },
        front: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.front },
        frontTopRight: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontTopRight },
        frontDigit1: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontDigit1 },
        frontDigit2: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontDigit2 },
        short: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.short },
        shortLeft: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortLeft },
        shortRight: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortRight },
        shortDigit1: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortDigit1 },
        shortDigit2: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortDigit2 },
      };
    }
    // Layout 176 restores the real lower rear Font receiver. It starts neutral
    // so the user can configure its approved default visually.
    if (incomingLayoutVersion < 176) {
      target.namePosition = "top";
      target.transforms.nameBottom = { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.nameBottom };
    }
    // Layout 177 makes Font Top and Font Bottom mutually exclusive.
    // Older "both" projects are migrated to Top so only one font is visible.
    if (incomingLayoutVersion < 177 && target.namePosition === "both") {
      target.namePosition = "top";
    }
    // Layout 181 keeps existing saved projects intact. New sessions use the
    // approved Font Top default: W105 H95 X0 Y-5 Depth-30.

    // Layout 180 installs the approved Font Bottom default and the exact
    // PES6 Front TopRight receiver. Old Center projects become Front Top.
    if (incomingLayoutVersion < 180) {
      target.transforms.nameBottom = { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.nameBottom };
      target.transforms.frontTopRight = { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontTopRight };
      if (String(incoming.frontPosition || "").toLowerCase() === "center") {
        target.frontPosition = "top";
      }
    }
    // Layout 182 repairs the Front TopRight topology. Remove any calibration
    // saved from the broken mesh and reapply the approved Font Top placement.
    if (incomingLayoutVersion < 182) {
      target.transforms.name = { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.name };
      target.transforms.frontTopRight = { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontTopRight };
      if (target.meshCalibration?.positions?.frontTopRight) {
        const positions = { ...target.meshCalibration.positions };
        delete positions.frontTopRight;
        target.meshCalibration = Object.keys(positions).length
          ? { ...target.meshCalibration, version: 182, positions }
          : null;
      }
    }
    // Layout 183 removes the overlapping Front TopRight triangle 9-4-0.
    // Discard calibrations made against the previous overlapping topology.
    if (incomingLayoutVersion < 183 && target.meshCalibration?.positions?.frontTopRight) {
      const positions = { ...target.meshCalibration.positions };
      delete positions.frontTopRight;
      target.meshCalibration = Object.keys(positions).length
        ? { ...target.meshCalibration, version: 183, positions }
        : null;
    }
    // Layout 184 installs the approved Front TopRight placement from the
    // user's final visual calibration.
    if (incomingLayoutVersion < 184) {
      target.transforms.frontTopRight = { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontTopRight };
    }
    // Layout 187 restores the approved Font Top configuration after the UI
    // cleanup in 1.86. Old saved transforms or manual mesh calibration could
    // otherwise override the official position while the controls were hidden.
    if (incomingLayoutVersion < 187) {
      target.transforms.name = { width: 1.05, height: 0.95, x: 0, y: -5, depth: -30 };
      if (target.meshCalibration?.positions?.name) {
        const positions = { ...target.meshCalibration.positions };
        delete positions.name;
        target.meshCalibration = Object.keys(positions).length
          ? { ...target.meshCalibration, version: 187, positions }
          : null;
      }
    }
    // Layout 188 permanently locks every geometry/UV transform to the approved
    // KitLab6 defaults. Saved templates, kits and old projects can no longer
    // overwrite these values, and manual mesh calibration is never accepted.
    target.transforms = {
      back: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.back },
      name: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.name },
      nameBottom: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.nameBottom },
      front: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.front },
      frontTopRight: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontTopRight },
      frontDigit1: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontDigit1 },
      frontDigit2: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.frontDigit2 },
      short: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.short },
      shortLeft: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortLeft },
      shortRight: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortRight },
      shortDigit1: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortDigit1 },
      shortDigit2: { ...NUMBERS_FONTS_DEFAULT_STATE.transforms.shortDigit2 },
    };
    target.meshCalibration = null;
    target.transformTarget = "back";
    target.layoutVersion = KITLAB_NUMBERS_FONTS_LAYOUT_VERSION;
    // Layout 200: transforms are not a per-kit setting. They are immutable and
    // are reapplied independently of Project/template/asset state.
    return target;
  }

  function sanitizePes6LibrarySelection(value) {
    if (!value || typeof value !== "object") return null;
    const country = String(value.country || "").trim();
    const file = String(value.file || "").trim();
    const path = String(value.path || "").trim();
    if (!country || !file || !path) return null;
    return { country, file, path };
  }

  function numbersControl(id) {
    return document.getElementById(id);
  }

  function normalizedLibraryKey(value = "") {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\.(png|webp|jpg|jpeg|svg)$/i, "")
      .replace(/\b(flag|flags|bandera|banderas|country|4x3|1x1)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const NUMBERS_FONTS_COUNTRY_ALIASES = Object.freeze({
    espana: ["spain"], alemania: ["germany"], inglaterra: ["england"], francia: ["france"],
    italia: ["italy"], brasil: ["brazil"], belgica: ["belgium"], suiza: ["switzerland"],
    austria: ["austria"], holanda: ["netherlands"], "paises bajos": ["netherlands"],
    "estados unidos": ["united states", "usa"], "reino unido": ["england"],
    escocia: ["scotland"], gales: ["wales"], irlanda: ["ireland"],
    japon: ["japan"], corea: ["south korea"], "corea del sur": ["south korea"],
    marruecos: ["morocco"], argelia: ["algeria"], tunez: ["tunisia"],
    egipto: ["egypt"], camerun: ["cameroon"], costa_de_marfil: ["cote divoire"],
    "costa de marfil": ["cote divoire"], republica_checa: ["czechia"],
    "republica checa": ["czechia"], turquia: ["turkey"], grecia: ["greece"],
    croacia: ["croatia"], serbia: ["serbia"], polonia: ["poland"], suecia: ["sweden"],
    noruega: ["norway"], dinamarca: ["denmark"], finlandia: ["finland"],
    rusia: ["russia"], ucrania: ["ukraine"], china: ["china"], australia: ["australia"],
    nueva_zelanda: ["new zealand"], "nueva zelanda": ["new zealand"],
    sudafrica: ["south africa"], "africa del sur": ["south africa"],
  });

  function countryFlagCandidateKeys(country = "") {
    const base = normalizedLibraryKey(country);
    const keys = new Set([base]);
    const direct = NUMBERS_FONTS_COUNTRY_ALIASES[base] || [];
    direct.forEach((value) => keys.add(normalizedLibraryKey(value)));
    for (const [alias, values] of Object.entries(NUMBERS_FONTS_COUNTRY_ALIASES)) {
      const normalizedAlias = normalizedLibraryKey(alias.replace(/_/g, " "));
      const normalizedValues = values.map(normalizedLibraryKey);
      if (normalizedValues.includes(base)) keys.add(normalizedAlias);
    }
    return [...keys].filter(Boolean);
  }

  function encodedAssetPath(parts = []) {
    return `./${parts.map((part) => encodeURIComponent(String(part))).join("/")}`;
  }

  function parseDirectoryListing(html = "") {
    const folders = [];
    const files = [];
    const seenFolders = new Set();
    const seenFiles = new Set();
    const regex = /href=["']([^"']+)["']/gi;
    let match;
    while ((match = regex.exec(String(html || "")))) {
      let href = String(match[1] || "").split("?")[0].split("#")[0];
      if (!href || href === "../" || href.startsWith("/")) continue;
      try { href = decodeURIComponent(href); } catch (_) {}
      const clean = href.replace(/^\.\//, "");
      if (!clean || clean.includes("/../")) continue;
      if (clean.endsWith("/")) {
        const name = clean.replace(/\/+$/, "").split("/").pop();
        if (name && !seenFolders.has(name)) {
          seenFolders.add(name);
          folders.push(name);
        }
      } else {
        const name = clean.split("/").pop();
        if (name && !seenFiles.has(name)) {
          seenFiles.add(name);
          files.push(name);
        }
      }
    }
    return { folders, files };
  }

  async function listNumbersFontsDirectory(parts = []) {
    const cleanParts = parts.filter(Boolean).map(String);
    const key = cleanParts.join("/");
    const byName = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
    try {
      const response = await fetch(`/kitlab-api/list-assets?dir=${encodeURIComponent(key)}&_=${Date.now()}`, { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json();
        const folders = Array.isArray(payload?.folders) ? payload.folders.filter(Boolean) : [];
        const files = Array.isArray(payload?.files) ? payload.files.filter(Boolean) : [];
        return { ok: true, folders: [...new Set(folders)].sort(byName), files: [...new Set(files)].sort(byName) };
      }
    } catch (_) {}
    try {
      const response = await fetch(`${encodedAssetPath(cleanParts)}/?_=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return { ok: false, folders: [], files: [] };
      const parsed = parseDirectoryListing(await response.text());
      parsed.folders.sort(byName);
      parsed.files.sort(byName);
      return { ok: true, ...parsed };
    } catch (_) {
      return { ok: false, folders: [], files: [] };
    }
  }

  async function loadNumbersFontsFlagIndex() {
    if (numbersFontsFlagIndexPromise) return numbersFontsFlagIndexPromise;
    numbersFontsFlagIndexPromise = (async () => {
      const listed = await listNumbersFontsDirectory(["assets", "flags"]);
      const files = (listed.files || []).filter((file) => /\.(png|webp|jpg|jpeg|svg)$/i.test(file));
      return files.map((file) => ({ file, key: normalizedLibraryKey(file) }));
    })();
    return numbersFontsFlagIndexPromise;
  }

  async function flagForNumbersFontsCountry(country = "") {
    const wantedKeys = countryFlagCandidateKeys(country);
    if (!wantedKeys.length) return "";
    const index = await loadNumbersFontsFlagIndex();
    let match = index.find((item) => wantedKeys.includes(item.key));
    if (!match) {
      match = index.find((item) => item.key && wantedKeys.some((wanted) => item.key.includes(wanted) || wanted.includes(item.key)));
    }
    return match ? encodedAssetPath(["assets", "flags", match.file]) : "";
  }

  function libraryDom(type) {
    const prefix = type === "numbers" ? "kitlabNumbersLibrary" : "kitlabFontLibrary";
    return {
      grid: numbersControl(`${prefix}Grid`),
      empty: numbersControl(`${prefix}Empty`),
      title: numbersControl(`${prefix}Title`),
      back: numbersControl(`${prefix}Back`),
    };
  }

  function selectedLibraryAsset(type) {
    const config = numbersFontsLibraryState[type];
    return config ? numbersFontsState[config.selectionKey] : null;
  }

  function syncNumbersFontsLibrarySelection(type) {
    const config = numbersFontsLibraryState[type];
    if (!config) return;
    const dom = libraryDom(type);
    const selected = selectedLibraryAsset(type);
    dom.grid?.querySelectorAll(".kitlab-nf-asset-card").forEach((card) => {
      const same = !!selected && card.dataset.country === selected.country && card.dataset.file === selected.file;
      card.classList.toggle("selected", same);
      card.setAttribute("aria-pressed", String(same));
    });
  }

  function setLibraryEmpty(type, message = "") {
    const dom = libraryDom(type);
    if (!dom.empty) return;
    dom.empty.textContent = message;
    dom.empty.hidden = !message;
  }

  function clearLibraryGrid(type) {
    const dom = libraryDom(type);
    if (dom.grid) dom.grid.replaceChildren();
  }

  async function resolveNumbersFontsLibraryRoot(type) {
    const config = numbersFontsLibraryState[type];
    if (!config) return null;
    if (config.root) return config.root;
    let firstReachable = null;
    for (const root of config.roots) {
      const listed = await listNumbersFontsDirectory(root);
      if (!listed.ok) continue;
      if (!firstReachable) firstReachable = root;
      if ((listed.folders || []).length || (listed.files || []).length) {
        config.root = root;
        return root;
      }
    }
    if (firstReachable) {
      config.root = firstReachable;
      return firstReachable;
    }
    config.root = config.roots[0];
    return config.root;
  }

  function capitalizedAssetLabel(file = "") {
    const base = String(file || "").replace(/\.png$/i, "").trim();
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : "PNG";
  }

  function createCountryCard(type, country, flagSrc) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kitlab-nf-country-card";
    button.title = country;
    button.setAttribute("aria-label", country);
    const flagWrap = document.createElement("span");
    flagWrap.className = "kitlab-nf-country-flag-wrap";
    if (flagSrc) {
      const image = document.createElement("img");
      image.className = "kitlab-nf-country-flag";
      image.src = flagSrc;
      image.alt = country;
      image.loading = "lazy";
      flagWrap.appendChild(image);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "kitlab-nf-country-fallback";
      fallback.textContent = "🏳️";
      flagWrap.appendChild(fallback);
    }
    button.appendChild(flagWrap);
    button.addEventListener("click", () => openNumbersFontsCountry(type, country));
    return button;
  }

  function alphaBoundsFromPixels(data, width, height, threshold = 3) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] <= threshold) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return maxX >= minX && maxY >= minY
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : { x: 0, y: 0, width, height };
  }

  function blackAtlasCanvas(image) {
    const source = document.createElement("canvas");
    source.width = image.naturalWidth || image.width || 1;
    source.height = image.naturalHeight || image.height || 1;
    const sourceContext = source.getContext("2d", { alpha: true, willReadFrequently: true });
    sourceContext.clearRect(0, 0, source.width, source.height);
    sourceContext.drawImage(image, 0, 0);
    sourceContext.globalCompositeOperation = "source-in";
    sourceContext.fillStyle = "#000000";
    sourceContext.fillRect(0, 0, source.width, source.height);
    sourceContext.globalCompositeOperation = "source-over";
    return source;
  }

  function paintNumbersSingleRowPreview(canvas, image) {
    const width = canvas.width;
    const height = canvas.height;
    const context = canvas.getContext("2d", { alpha: false });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    const layout = pes6AtlasGlyphs(image);
    const boxes = "0123456789".split("").map((digit) => layout.numbers[digit]).filter(Boolean);
    if (boxes.length !== 10) return false;

    const blackSource = blackAtlasCanvas(image);
    const maxSourceHeight = Math.max(...boxes.map((box) => box.height), 1);
    const paddingX = 12;
    const paddingY = 8;
    const gapRatio = 0.10;
    const widthRatio = boxes.reduce((sum, box) => sum + (box.width / maxSourceHeight), 0) + gapRatio * (boxes.length - 1);
    const targetHeight = Math.max(1, Math.min(height - paddingY * 2, (width - paddingX * 2) / Math.max(widthRatio, 0.01)));
    const gap = targetHeight * gapRatio;
    const glyphWidths = boxes.map((box) => (box.width / maxSourceHeight) * targetHeight);
    const totalWidth = glyphWidths.reduce((sum, glyphWidth) => sum + glyphWidth, 0) + gap * (boxes.length - 1);
    let x = (width - totalWidth) * 0.5;
    const centerY = height * 0.5;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    boxes.forEach((box, index) => {
      const drawWidth = glyphWidths[index];
      const drawHeight = (box.height / maxSourceHeight) * targetHeight;
      const y = centerY - drawHeight * 0.5;
      context.drawImage(blackSource, box.x, box.y, box.width, box.height, x, y, drawWidth, drawHeight);
      x += drawWidth + gap;
    });
    return true;
  }

  function paintPngLibraryPreview(canvas, image, type = "font") {
    if (type === "numbers" && paintNumbersSingleRowPreview(canvas, image)) return;

    const width = canvas.width;
    const height = canvas.height;
    const context = canvas.getContext("2d", { alpha: false });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    const source = document.createElement("canvas");
    source.width = image.naturalWidth || image.width || 1;
    source.height = image.naturalHeight || image.height || 1;
    const sourceContext = source.getContext("2d", { alpha: true, willReadFrequently: true });
    sourceContext.clearRect(0, 0, source.width, source.height);
    sourceContext.drawImage(image, 0, 0);
    let bounds = { x: 0, y: 0, width: source.width, height: source.height };
    try {
      bounds = alphaBoundsFromPixels(sourceContext.getImageData(0, 0, source.width, source.height).data, source.width, source.height);
    } catch (_) {}

    const tinted = document.createElement("canvas");
    tinted.width = bounds.width;
    tinted.height = bounds.height;
    const tintedContext = tinted.getContext("2d", { alpha: true });
    tintedContext.clearRect(0, 0, tinted.width, tinted.height);
    tintedContext.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    tintedContext.globalCompositeOperation = "source-in";
    tintedContext.fillStyle = "#000000";
    tintedContext.fillRect(0, 0, tinted.width, tinted.height);
    tintedContext.globalCompositeOperation = "source-over";

    const paddingX = 10;
    const paddingY = 8;
    const scale = Math.min((width - paddingX * 2) / Math.max(1, tinted.width), (height - paddingY * 2) / Math.max(1, tinted.height));
    const drawWidth = Math.max(1, tinted.width * scale);
    const drawHeight = Math.max(1, tinted.height * scale);
    const x = (width - drawWidth) * 0.5;
    const y = (height - drawHeight) * 0.5;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(tinted, x, y, drawWidth, drawHeight);
  }

  function createAssetPreview(path, file, type) {
    const canvas = document.createElement("canvas");
    canvas.className = "kitlab-nf-asset-thumb";
    canvas.width = type === "numbers" ? 1200 : 640;
    canvas.height = type === "numbers" ? 180 : 190;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", capitalizedAssetLabel(file));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => paintPngLibraryPreview(canvas, image, type);
    image.src = path;
    return canvas;
  }

  function createAssetCard(type, country, file, path) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `kitlab-nf-asset-card is-${type}`;
    button.dataset.country = country;
    button.dataset.file = file;
    button.setAttribute("aria-pressed", "false");
    button.title = capitalizedAssetLabel(file);
    const thumbWrap = document.createElement("span");
    thumbWrap.className = "kitlab-nf-asset-thumb-wrap";
    thumbWrap.appendChild(createAssetPreview(path, file, type));
    const label = document.createElement("span");
    label.className = "kitlab-nf-asset-name";
    label.textContent = capitalizedAssetLabel(file);
    button.append(thumbWrap, label);
    button.addEventListener("click", () => {
      const config = numbersFontsLibraryState[type];
      const selection = { country, file, path };
      const activation = type === "numbers"
        ? {
            [config.selectionKey]: selection,
            backVisible: true,
            frontPosition: numbersFontsState.frontPosition,
            shortSide: numbersFontsState.shortSide,
          }
        : {
            [config.selectionKey]: selection,
            nameVisible: true,
            namePosition: numbersFontsState.namePosition === "none" ? "top" : numbersFontsState.namePosition,
          };
      forceOfficialNumbersFontsGeometry();
      updateNumbersFontsState(activation);
      preloadPes6AtlasSelection(selection).then(() => {
        forceOfficialNumbersFontsGeometry();
        if (type === "font") enforceOfficialPlayerNameLimit();
        syncNumbersFontsControls();
        requestNumbersFontsTextureRefresh();
      }).catch(() => {
        forceOfficialNumbersFontsGeometry();
        requestNumbersFontsTextureRefresh();
      });
      syncNumbersFontsLibrarySelection(type);
    });
    return button;
  }

  async function showNumbersFontsCountries(type) {
    const config = numbersFontsLibraryState[type];
    if (!config || config.loading) return;
    config.loading = true;
    config.country = "";
    const dom = libraryDom(type);
    if (dom.title) dom.title.textContent = type === "numbers" ? "Numbers" : "Fonts";
    if (dom.back) dom.back.hidden = true;
    dom.grid?.classList.remove("assets-list");
    clearLibraryGrid(type);
    setLibraryEmpty(type, "Loading countries...");
    try {
      const root = await resolveNumbersFontsLibraryRoot(type);
      const listed = await listNumbersFontsDirectory(root);
      const countries = (listed.folders || []).filter((name) => name && !String(name).startsWith("."));
      if (!countries.length) {
        setLibraryEmpty(type, `Add country folders inside ${root.join("/")}.`);
        return;
      }
      setLibraryEmpty(type, "");
      const cards = await Promise.all(countries.map(async (country) => createCountryCard(type, country, await flagForNumbersFontsCountry(country))));
      dom.grid?.append(...cards);
      config.countriesLoaded = true;
    } finally {
      config.loading = false;
      syncNumbersFontsLibrarySelection(type);
    }
  }

  async function openNumbersFontsCountry(type, country) {
    const config = numbersFontsLibraryState[type];
    if (!config || config.loading) return;
    config.loading = true;
    config.country = country;
    const dom = libraryDom(type);
    if (dom.title) dom.title.textContent = type === "numbers" ? "Numbers" : "Fonts";
    if (dom.back) dom.back.hidden = false;
    dom.grid?.classList.add("assets-list");
    clearLibraryGrid(type);
    setLibraryEmpty(type, "Loading PNG files...");
    try {
      const root = await resolveNumbersFontsLibraryRoot(type);
      const listed = await listNumbersFontsDirectory([...root, country]);
      const files = (listed.files || []).filter((file) => /\.png$/i.test(file));
      if (!files.length) {
        setLibraryEmpty(type, `No PNG files found in ${[...root, country].join("/")}.`);
        return;
      }
      setLibraryEmpty(type, "");
      const cards = files.map((file) => createAssetCard(type, country, file, encodedAssetPath([...root, country, file])));
      dom.grid?.append(...cards);
    } finally {
      config.loading = false;
      syncNumbersFontsLibrarySelection(type);
    }
  }

  function activateNumbersSidebarTab(tab = "project", options = {}) {
    const open = numbersFontsState.panelOpen;
    const allowed = ["project", "config", "numbers", "font"];
    let next = allowed.includes(tab) ? tab : "project";
    if (!open && next !== "project") next = "project";
    activeNumbersSidebarTab = next;
    for (const key of allowed) {
      const active = key === next;
      const button = rightTabButtons[key];
      const panel = rightTabPanels[key];
      if (button) {
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      }
      if (panel) {
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      }
    }
    if (numbersPanel) numbersPanel.hidden = !(open && next === "config");
    if (options.load !== false && open) {
      if (next === "numbers") showNumbersFontsCountries("numbers");
      if (next === "font") showNumbersFontsCountries("font");
    }
  }

  function syncNumbersFontsPanelVisibility() {
    const open = numbersFontsState.panelOpen === true;
    rightTabsNav?.classList.toggle("nf-open", open);
    document.querySelectorAll(".kitlab-nf-extra-tab").forEach((button) => { button.hidden = !open; });
    if (!open) activeNumbersSidebarTab = "project";
    activateNumbersSidebarTab(activeNumbersSidebarTab, { load: false });
    if (numbersPanelToggle) {
      numbersPanelToggle.classList.toggle("active", open);
      numbersPanelToggle.setAttribute("aria-pressed", String(open));
    }
  }

  function gdbControl(id) {
    return document.getElementById(id);
  }

  function syncGdbCollarControl(label = selectedCollarLabel()) {
    const value = collarLabelRequiresNoModel(label) ? "no" : "yes";
    const control = gdbControl("kitlabGdbPreviewCollar");
    if (control) control.value = value;
    if (numbersFontsState.gdbConfig) numbersFontsState.gdbConfig.collar = value;
  }

  function parseCssColorToHex(value) {
    const text = String(value || "").trim();
    if (!text || text === "transparent") return "";
    const shortHex = text.match(/^#([0-9a-f]{3})$/i);
    if (shortHex) return `#${shortHex[1].split("").map((c) => c + c).join("")}`.toLowerCase();
    const fullHex = text.match(/^#([0-9a-f]{6})$/i);
    if (fullHex) return `#${fullHex[1]}`.toLowerCase();
    const rgb = text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i);
    if (!rgb) return "";
    const channel = (item) => Math.max(0, Math.min(255, Math.round(Number(item) || 0))).toString(16).padStart(2, "0");
    return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
  }

  function firstPieceColor(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return "";
    const selectors = [
      'input[type="color"]',
      '[data-color]',
      '[data-hex]',
      '.palette-color-swatch',
      '.piece-color-swatch',
      '.color-swatch',
      'button[style*="background"]',
      '[style*="background-color"]',
    ].join(",");
    const candidates = Array.from(root.querySelectorAll(selectors));
    for (const element of candidates) {
      const values = [
        element.value,
        element.dataset?.color,
        element.dataset?.hex,
        element.style?.backgroundColor,
        element.style?.background,
      ];
      try { values.push(getComputedStyle(element).backgroundColor); } catch (_) {}
      for (const value of values) {
        const hex = parseCssColorToHex(value);
        if (hex) return hex;
      }
    }
    return "";
  }

  function paintGdbColor(prefix, color) {
    const normalized = sanitizeNumbersColor(color, "");
    const field = gdbControl(`kitlabGdbPreview${prefix}Color`);
    const chip = gdbControl(`kitlabGdb${prefix}ColorChip`);
    if (field) field.value = normalized ? normalized.toUpperCase() : "";
    if (chip) {
      const fallback = prefix === "Radar" ? "#aab4c2" : "#aab4c2";
      chip.style.background = normalized || fallback;
      chip.style.backgroundColor = normalized || fallback;
      chip.title = `${prefix === "Radar" ? "Radar" : "Shorts"} color ${normalized ? normalized.toUpperCase() : ""}`.trim();
    }
  }

  function syncGdbKitColors(options = {}) {
    const shirtColor = firstPieceColor("shirtPieceColors");
    const shortColor = firstPieceColor("shortPieceColors");
    const previousRadar = numbersFontsState.gdbConfig?.radarColor || "";
    const previousShorts = numbersFontsState.gdbConfig?.shortsColor || "";
    const nextRadar = shirtColor || previousRadar;
    const nextShorts = shortColor || previousShorts;
    gdbRadarColor = nextRadar;
    gdbShortsColor = nextShorts;
    if (numbersFontsState.gdbConfig) {
      numbersFontsState.gdbConfig.radarColor = nextRadar;
      numbersFontsState.gdbConfig.shortsColor = nextShorts;
    }
    paintGdbColor("Radar", nextRadar);
    paintGdbColor("Shorts", nextShorts);
    if (options.emit === true && (nextRadar !== previousRadar || nextShorts !== previousShorts)) {
      emitCurrentKitNumbersFontsState();
    }
  }

  function scheduleGdbKitColorSync() {
    clearTimeout(gdbColorSyncTimer);
    gdbColorSyncTimer = window.setTimeout(() => syncGdbKitColors({ emit: true }), 40);
  }

  function syncGdbConfigControls() {
    const gdb = numbersFontsState.gdbConfig || NUMBERS_FONTS_DEFAULT_STATE.gdbConfig;
    const description = gdbControl("kitlabGdbPreviewDescription");
    const model = gdbControl("kitlabGdbPreviewModel");
    const nameShape = gdbControl("kitlabGdbPreviewNameShape");
    if (description && description.value !== String(gdb.description || "")) description.value = String(gdb.description || "");
    if (model && model.value !== String(gdb.model || "33")) model.value = String(gdb.model || "33");
    if (nameShape) nameShape.value = ["type1", "type2", "type3"].includes(gdb.nameShape) ? gdb.nameShape : "type1";
    gdbRadarColor = gdb.radarColor || "";
    gdbShortsColor = gdb.shortsColor || "";
    paintGdbColor("Radar", gdbRadarColor);
    paintGdbColor("Shorts", gdbShortsColor);

    const nameLocation = gdbControl("kitlabGdbPreviewNameLocation");
    const shirtLocation = gdbControl("kitlabGdbPreviewShirtLocation");
    const shortLocation = gdbControl("kitlabGdbPreviewShortLocation");
    if (nameLocation) nameLocation.value = ["top", "bottom"].includes(numbersFontsState.namePosition)
      ? numbersFontsState.namePosition
      : "off";
    if (shirtLocation) shirtLocation.value = numbersFontsState.frontPosition === "top"
      ? "center"
      : (numbersFontsState.frontPosition === "topright" ? "topright" : "off");
    if (shortLocation) shortLocation.value = ["left", "right", "both"].includes(numbersFontsState.shortSide)
      ? numbersFontsState.shortSide
      : "off";
    const numbersFile = numbersFontsState.pes6NumberAsset?.file || "";
    const shirtFile = gdbControl("kitlabGdbPreviewNumbersShirt");
    const shortFile = gdbControl("kitlabGdbPreviewNumbersShort");
    if (shirtFile) shirtFile.value = numbersFile;
    if (shortFile) shortFile.value = numbersFile;
    syncGdbCollarControl();
    scheduleGdbKitColorSync();
  }

  const KITLAB_ORIGINAL_COLOR_PRESETS = Object.freeze([
    "#151515", "#f1f1f1", "#666666", "#a9834f", "#533b2e", "#83101b", "#e8641b",
    "#efb900", "#b7dd31", "#125b33", "#23347c", "#2386ec", "#421d51", "#d54471",
  ]);

  function normalizeOriginalPaletteHex(raw, fallback = "#ffffff") {
    const clean = String(raw || "").trim().replace(/^#/, "");
    return /^[0-9a-f]{6}$/i.test(clean) ? `#${clean.toLowerCase()}` : fallback;
  }

  function originalPaletteHexToRgb(hex) {
    const clean = normalizeOriginalPaletteHex(hex).slice(1);
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

  function originalPaletteRgbToHex(r, g, b) {
    const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    return `#${[r, g, b].map((value) => clampChannel(value).toString(16).padStart(2, "0")).join("")}`;
  }

  function originalPaletteRgbToHsv(r, g, b) {
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const delta = max - min;
    let h = 0;
    if (delta) {
      if (max === rr) h = 60 * (((gg - bb) / delta) % 6);
      else if (max === gg) h = 60 * (((bb - rr) / delta) + 2);
      else h = 60 * (((rr - gg) / delta) + 4);
    }
    if (h < 0) h += 360;
    return {
      h,
      s: max ? delta / max : 0,
      v: max,
    };
  }

  function originalPaletteHsvToRgb(h, s, v) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(1, Number(s) || 0));
    const val = Math.max(0, Math.min(1, Number(v) || 0));
    const c = val * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = val - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) [r, g, b] = [c, x, 0];
    else if (hue < 120) [r, g, b] = [x, c, 0];
    else if (hue < 180) [r, g, b] = [0, c, x];
    else if (hue < 240) [r, g, b] = [0, x, c];
    else if (hue < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }

  function loadOriginalKitLabPresets() {
    const presets = [...KITLAB_ORIGINAL_COLOR_PRESETS];
    try {
      const stored = JSON.parse(localStorage.getItem("kitlab6_color_presets_final14_v1") || "null");
      if (Array.isArray(stored)) {
        stored.slice(0, presets.length).forEach((color, index) => {
          presets[index] = normalizeOriginalPaletteHex(color, presets[index]);
        });
      }
    } catch {}
    return presets;
  }

  function saveOriginalKitLabPresets(presets) {
    try {
      localStorage.setItem(
        "kitlab6_color_presets_final14_v1",
        JSON.stringify((Array.isArray(presets) ? presets : []).slice(0, 14)),
      );
    } catch {}
  }

  function closeOriginalKitLabPaletteHosts(exceptHost = null) {
    for (const host of document.querySelectorAll(".kitlab-nf-color-picker-host, .kitlab-gdb-picker-host")) {
      if (host !== exceptHost) host.replaceChildren();
    }
  }

  function installStandaloneOriginalPaletteStyles() {
    if (document.getElementById("kitlabStandaloneOriginalPaletteStyles")) return;
    const style = document.createElement("style");
    style.id = "kitlabStandaloneOriginalPaletteStyles";
    style.textContent = `
      .kitlab-gdb-picker-host .psh-hue-slider,
      .kitlab-nf-color-picker-host .psh-hue-slider {
        -webkit-appearance:none!important;
        appearance:none!important;
        width:100%!important;
        height:10px!important;
        min-height:10px!important;
        border-radius:999px!important;
        border:1px solid rgba(255,255,255,.32)!important;
        outline:none!important;
        cursor:pointer!important;
        background:linear-gradient(90deg,#ff0000 0%,#ffff00 16.666%,#00ff00 33.333%,#00ffff 50%,#0000ff 66.666%,#ff00ff 83.333%,#ff0000 100%)!important;
      }
      .kitlab-gdb-picker-host .psh-hue-slider::-webkit-slider-thumb,
      .kitlab-nf-color-picker-host .psh-hue-slider::-webkit-slider-thumb {
        -webkit-appearance:none!important;
        appearance:none!important;
        width:13px!important;
        height:13px!important;
        margin-top:-2px!important;
        border-radius:50%!important;
        background:#fff!important;
        border:2px solid rgba(0,0,0,.72)!important;
        box-shadow:0 0 0 1px rgba(255,255,255,.75),0 1px 4px rgba(0,0,0,.55)!important;
      }
      .kitlab-gdb-picker-host .psh-sv,
      .kitlab-nf-color-picker-host .psh-sv {
        display:block!important;
        width:100%!important;
        height:auto!important;
        background:#000!important;
        cursor:crosshair!important;
      }
      .kitlab-gdb-picker-host .psh-preset-row,
      .kitlab-nf-color-picker-host .psh-preset-row {
        display:grid!important;
        grid-template-columns:repeat(14,minmax(0,1fr))!important;
        gap:6px!important;
        width:100%!important;
        margin:0 0 6px!important;
      }
      .kitlab-gdb-picker-host .psh-preset,
      .kitlab-nf-color-picker-host .psh-preset {
        width:100%!important;
        min-width:0!important;
        aspect-ratio:1/1!important;
        height:auto!important;
        min-height:16px!important;
        padding:0!important;
        border-radius:4px!important;
        box-sizing:border-box!important;
      }
      .kitlab-gdb-picker-host .psh-preset.active,
      .kitlab-nf-color-picker-host .psh-preset.active {
        outline:2px solid #f1b51c!important;
        outline-offset:1px!important;
      }
    `;
    document.head.appendChild(style);
  }

  function standaloneOriginalPaletteHtml(key, color, title) {
    const [r, g, b] = originalPaletteHexToRgb(color);
    const hsv = originalPaletteRgbToHsv(r, g, b);
    const presets = loadOriginalKitLabPresets();
    return `
      <div class="psh-popover compact kitlab-standalone-original-palette" data-picker-key="${key}">
        <div class="psh-head-row">
          <strong class="psh-layer-name">${String(title || "Color")}</strong>
          <div class="psh-current" style="background:${color}" title="${color.toUpperCase()}"></div>
          <strong class="psh-hex-live">${color.toUpperCase()}</strong>
        </div>
        <div class="psh-main">
          <div class="psh-sv-wrap">
            <canvas class="psh-sv" width="360" height="210"></canvas>
          </div>
          <div class="psh-current-wrap psh-compact-controls">
            <div class="psh-rgb">
              <label>R <input type="number" min="0" max="255" data-channel="r" value="${r}"></label>
              <label>G <input type="number" min="0" max="255" data-channel="g" value="${g}"></label>
              <label>B <input type="number" min="0" max="255" data-channel="b" value="${b}"></label>
            </div>
            <div class="psh-hex-field">
              <span class="psh-hex-prefix" aria-hidden="true">#</span>
              <input class="piece-hex-input psh-hex" type="text" value="${color.slice(1).toUpperCase()}" maxlength="7" spellcheck="false">
              <button type="button" class="kitlab-standalone-copy-hex" title="Copy HEX">⧉</button>
            </div>
            <button type="button" class="psh-eyedrop icon-only kitlab-standalone-eyedrop" title="Eyedropper">
              <img src="./assets/ui/eyedropper-red.png" alt=""> Eyedropper
            </button>
          </div>
        </div>
        <div class="psh-hue-row">
          <label>Hue</label>
          <input class="psh-hue-slider" type="range" min="0" max="360" value="${Math.round(hsv.h)}">
        </div>
        <div class="psh-presets">
          <div class="psh-preset-row">
            ${presets.map((preset, index) => `
              <button type="button" class="psh-preset${preset === color ? " active" : ""}"
                data-color="${preset}" data-preset-index="${index}"
                style="background:${preset}"
                title="${preset.toUpperCase()} · click apply · Ctrl+click save current"></button>
            `).join("")}
          </div>
        </div>
        <div class="psh-apply-row">
          <button type="button" class="psh-apply">Apply</button>
          <button type="button" class="psh-cancel">Cancel</button>
        </div>
      </div>
    `;
  }

  function renderStandaloneOriginalKitLabPalette(host, options = {}) {
    installStandaloneOriginalPaletteStyles();

    const key = String(options.key || "kitlab-original-palette");
    const originalColor = normalizeOriginalPaletteHex(options.color, "#ffffff");
    let currentColor = originalColor;
    let hsv = originalPaletteRgbToHsv(...originalPaletteHexToRgb(currentColor));

    host.innerHTML = standaloneOriginalPaletteHtml(key, currentColor, options.title || "Color");
    const root = host.querySelector(".kitlab-standalone-original-palette");
    if (!root) return;

    const canvas = root.querySelector(".psh-sv");
    const hueInput = root.querySelector(".psh-hue-slider");
    const currentChip = root.querySelector(".psh-current");
    const liveHex = root.querySelector(".psh-hex-live");
    const hexInput = root.querySelector(".psh-hex");
    const rgbInputs = Object.fromEntries(
      [...root.querySelectorAll(".psh-rgb input[data-channel]")].map((input) => [input.dataset.channel, input]),
    );

    const drawCanvas = () => {
      const context = canvas?.getContext("2d");
      if (!context || !canvas) return;
      const [hr, hg, hb] = originalPaletteHsvToRgb(hsv.h, 1, 1);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = `rgb(${hr},${hg},${hb})`;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const white = context.createLinearGradient(0, 0, canvas.width, 0);
      white.addColorStop(0, "rgba(255,255,255,1)");
      white.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = white;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const black = context.createLinearGradient(0, 0, 0, canvas.height);
      black.addColorStop(0, "rgba(0,0,0,0)");
      black.addColorStop(1, "rgba(0,0,0,1)");
      context.fillStyle = black;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const x = hsv.s * canvas.width;
      const y = (1 - hsv.v) * canvas.height;
      context.beginPath();
      context.arc(x, y, 6, 0, Math.PI * 2);
      context.strokeStyle = "#fff";
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.arc(x, y, 7.5, 0, Math.PI * 2);
      context.strokeStyle = "rgba(0,0,0,.75)";
      context.lineWidth = 1;
      context.stroke();
    };

    const refreshDom = (emit = true) => {
      currentColor = originalPaletteRgbToHex(...originalPaletteHsvToRgb(hsv.h, hsv.s, hsv.v));
      const [r, g, b] = originalPaletteHexToRgb(currentColor);
      if (currentChip) {
        currentChip.style.background = currentColor;
        currentChip.title = currentColor.toUpperCase();
      }
      if (liveHex) liveHex.textContent = currentColor.toUpperCase();
      if (hexInput && document.activeElement !== hexInput) hexInput.value = currentColor.slice(1).toUpperCase();
      if (rgbInputs.r && document.activeElement !== rgbInputs.r) rgbInputs.r.value = String(r);
      if (rgbInputs.g && document.activeElement !== rgbInputs.g) rgbInputs.g.value = String(g);
      if (rgbInputs.b && document.activeElement !== rgbInputs.b) rgbInputs.b.value = String(b);
      if (hueInput && document.activeElement !== hueInput) hueInput.value = String(Math.round(hsv.h));
      root.querySelectorAll(".psh-preset[data-color]").forEach((button) => {
        button.classList.toggle("active", normalizeOriginalPaletteHex(button.dataset.color) === currentColor);
      });
      drawCanvas();
      if (emit && typeof options.onChange === "function") options.onChange(currentColor);
    };

    const setColor = (raw, emit = true) => {
      currentColor = normalizeOriginalPaletteHex(raw, currentColor);
      hsv = originalPaletteRgbToHsv(...originalPaletteHexToRgb(currentColor));
      refreshDom(emit);
    };

    const setSvFromPointer = (event) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      hsv.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
      hsv.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1)));
      refreshDom(true);
    };

    canvas?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      setSvFromPointer(event);
    });
    canvas?.addEventListener("pointermove", (event) => {
      if (event.buttons !== 1) return;
      event.preventDefault();
      setSvFromPointer(event);
    });

    hueInput?.addEventListener("input", () => {
      hsv.h = Number(hueInput.value) || 0;
      refreshDom(true);
    });

    Object.values(rgbInputs).forEach((input) => {
      input?.addEventListener("input", () => {
        setColor(originalPaletteRgbToHex(
          Number(rgbInputs.r?.value) || 0,
          Number(rgbInputs.g?.value) || 0,
          Number(rgbInputs.b?.value) || 0,
        ), true);
      });
    });

    hexInput?.addEventListener("change", () => setColor(hexInput.value, true));
    hexInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      setColor(hexInput.value, true);
    });

    root.querySelectorAll(".psh-preset[data-color]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.ctrlKey || event.metaKey) {
          const presets = loadOriginalKitLabPresets();
          const index = Math.max(0, Math.min(13, Number(button.dataset.presetIndex) || 0));
          presets[index] = currentColor;
          saveOriginalKitLabPresets(presets);
          button.dataset.color = currentColor;
          button.style.background = currentColor;
          button.title = `${currentColor.toUpperCase()} · click apply · Ctrl+click save current`;
          refreshDom(false);
          return;
        }
        setColor(button.dataset.color, true);
      });
    });

    root.querySelector(".kitlab-standalone-copy-hex")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard?.writeText?.(currentColor.toUpperCase());
      } catch {}
    });

    root.querySelector(".kitlab-standalone-eyedrop")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!window.EyeDropper) return;
      try {
        const result = await new window.EyeDropper().open();
        if (result?.sRGBHex) setColor(result.sRGBHex, true);
      } catch {}
    });

    root.querySelector(".psh-apply")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      host.replaceChildren();
    });

    root.querySelector(".psh-cancel")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof options.onChange === "function") options.onChange(originalColor);
      host.replaceChildren();
    });

    refreshDom(false);
    requestAnimationFrame(drawCanvas);
  }

  function openOriginalKitLabColorPicker(event, options = {}) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const host = options.host || document.getElementById(String(options.hostId || ""));
    if (!host) return;

    closeOriginalKitLabPaletteHosts(host);
    host.replaceChildren();

    let sharedRequested = false;
    if (typeof window.kitlabOpenSharedColorPicker === "function") {
      try {
        window.kitlabOpenSharedColorPicker(event, { ...options, host });
        sharedRequested = true;
      } catch (error) {
        console.warn("Original shared KitLab palette failed.", error);
      }
    }

    const ensureVisible = () => {
      if (host.querySelector(".psh-popover")) return;
      renderStandaloneOriginalKitLabPalette(host, options);
    };

    if (sharedRequested) {
      requestAnimationFrame(() => {
        if (!host.querySelector(".psh-popover")) window.setTimeout(ensureVisible, 20);
      });
    } else {
      ensureVisible();
    }
  }

  function openGdbColorPicker(event, kind) {
    const isRadar = kind === "radar";
    const current = isRadar ? gdbRadarColor : gdbShortsColor;
    openOriginalKitLabColorPicker(event, {
      key: isRadar ? "gdb-radar-color" : "gdb-shorts-color",
      hostId: isRadar ? "kitlabGdbRadarPickerHost" : "kitlabGdbShortsPickerHost",
      title: isRadar ? "Radar color" : "Shorts color",
      color: current || (isRadar ? firstPieceColor("shirtPieceColors") : firstPieceColor("shortPieceColors")) || "#ffffff",
      onChange: (hex) => {
        const clean = sanitizeNumbersColor(hex, "#ffffff");
        if (isRadar) gdbRadarColor = clean;
        else gdbShortsColor = clean;
        updateNumbersFontsState({
          gdbConfig: {
            [isRadar ? "radarColor" : "shortsColor"]: clean,
          },
        }, { refreshTextures: false });
        paintGdbColor(isRadar ? "Radar" : "Shorts", clean);
      },
    });
  }

  function bindGdbConfigControls() {
    const description = gdbControl("kitlabGdbPreviewDescription");
    description?.addEventListener("input", () => {
      updateNumbersFontsState({
        gdbConfig: { description: String(description.value || "").slice(0, 120) },
      }, { refreshTextures: false });
    });

    const model = gdbControl("kitlabGdbPreviewModel");
    model?.addEventListener("input", () => {
      const clean = String(model.value || "").replace(/\D+/g, "").slice(0, 3);
      if (model.value !== clean) model.value = clean;
      updateNumbersFontsState({
        gdbConfig: { model: clean || "33" },
      }, { refreshTextures: false });
    });
    model?.addEventListener("blur", () => {
      if (!model.value) model.value = "33";
      updateNumbersFontsState({
        gdbConfig: { model: model.value || "33" },
      }, { refreshTextures: false });
    });

    gdbControl("kitlabGdbPreviewNameShape")?.addEventListener("change", (event) => {
      updateNumbersFontsState({
        gdbConfig: { nameShape: String(event.target.value || "type1") },
      }, { refreshTextures: false });
    });

    gdbControl("kitlabGdbPreviewNameLocation")?.addEventListener("change", (event) => {
      const selected = String(event.target.value || "off");
      updateNumbersFontsState({
        namePosition: selected === "off" ? "none" : selected,
        nameVisible: selected !== "off",
      }, { refreshTextures: false });
    });

    gdbControl("kitlabGdbPreviewShirtLocation")?.addEventListener("change", (event) => {
      const selected = String(event.target.value || "off");
      updateNumbersFontsState({
        frontPosition: selected === "center" ? "top" : (selected === "topright" ? "topright" : "none"),
      }, { refreshTextures: false });
    });

    gdbControl("kitlabGdbPreviewShortLocation")?.addEventListener("change", (event) => {
      const selected = String(event.target.value || "off");
      updateNumbersFontsState({
        shortSide: ["left", "right", "both"].includes(selected) ? selected : "none",
      }, { refreshTextures: false });
    });

    gdbControl("kitlabGdbRadarColorChip")?.addEventListener("click", (event) => openGdbColorPicker(event, "radar"));
    gdbControl("kitlabGdbShortsColorChip")?.addEventListener("click", (event) => openGdbColorPicker(event, "shorts"));
    gdbControl("kitlabGdbPreviewRadarColor")?.addEventListener("click", (event) => openGdbColorPicker(event, "radar"));
    gdbControl("kitlabGdbPreviewShortsColor")?.addEventListener("click", (event) => openGdbColorPicker(event, "shorts"));

    for (const id of ["shirtPieceColors", "shortPieceColors"]) {
      const root = document.getElementById(id);
      if (!root) continue;
      new MutationObserver(scheduleGdbKitColorSync).observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "value", "data-color", "data-hex"],
      });
      root.addEventListener("input", scheduleGdbKitColorSync, true);
      root.addEventListener("change", scheduleGdbKitColorSync, true);
      root.addEventListener("click", scheduleGdbKitColorSync, true);
    }
    syncGdbConfigControls();
  }

  function syncNumbersFontsTransformControls() {
    const target = universalNumbersFontsCalibrationTarget;
    const transform = officialNumbersFontsTransform(target);
    const targetSelect = numbersControl("kitlabNfTransformTarget");
    const width = numbersControl("kitlabNfWidth");
    const height = numbersControl("kitlabNfHeight");
    const x = numbersControl("kitlabNfOffsetX");
    const y = numbersControl("kitlabNfOffsetY");
    const depth = numbersControl("kitlabNfDepth");
    const digitOnlyTarget = ["backDigit1", "backDigit2", "frontDigit1", "frontDigit2", "shortDigit1", "shortDigit2"].includes(target);
    if (targetSelect) targetSelect.value = target;
    if (width) width.value = String(Math.round((transform.width || 1) * 100));
    if (height) height.value = String(Math.round((transform.height || 1) * 100));
    if (x) x.value = String(Math.round(transform.x));
    if (y) y.value = String(Math.round(transform.y));
    if (depth) {
      depth.value = String(Number.isFinite(Number(transform.depth)) ? Number(transform.depth) : 0);
      depth.disabled = digitOnlyTarget;
      depth.title = digitOnlyTarget
        ? "Select the complete Front or Short receiver to change its depth"
        : "Negative moves into the model; positive moves away. No software limit.";
    }
    const widthOut = numbersControl("kitlabNfWidthValue");
    const heightOut = numbersControl("kitlabNfHeightValue");
    const xOut = numbersControl("kitlabNfOffsetXValue");
    const yOut = numbersControl("kitlabNfOffsetYValue");
    const depthOut = numbersControl("kitlabNfDepthValue");
    if (widthOut) widthOut.textContent = `${Math.round((transform.width || 1) * 100)}%`;
    if (heightOut) heightOut.textContent = `${Math.round((transform.height || 1) * 100)}%`;
    if (xOut) xOut.textContent = String(Math.round(transform.x));
    if (yOut) yOut.textContent = String(Math.round(transform.y));
    if (depthOut) depthOut.textContent = digitOnlyTarget ? "—" : String(Number.isFinite(Number(transform.depth)) ? Number(transform.depth) : 0);
  }

  function syncNumbersFontsControls() {
    const values = {
      kitlabNfPlayerName: numbersFontsState.playerName,
      kitlabNfNamePosition: numbersFontsState.namePosition,
      kitlabNfBackNumber: numbersFontsState.backNumber,
      kitlabNfFrontNumber: numbersFontsState.frontNumber,
      kitlabNfShortNumber: numbersFontsState.shortNumber,
      kitlabNfFrontPosition: numbersFontsState.frontPosition,
      kitlabNfShortSide: numbersFontsState.shortSide,
      kitlabNfFill: numbersFontsState.fill,
    };
    for (const [id, value] of Object.entries(values)) {
      const control = numbersControl(id);
      if (control && control.value !== String(value)) control.value = String(value);
    }
    const nameVisible = numbersControl("kitlabNfNameVisible");
    const backVisible = numbersControl("kitlabNfBackVisible");
    if (nameVisible) nameVisible.checked = numbersFontsState.nameVisible;
    if (backVisible) backVisible.checked = numbersFontsState.backVisible;
    const fillSwatch = numbersControl("kitlabNfFillSwatch");
    if (fillSwatch) {
      fillSwatch.style.background = numbersFontsState.fill;
      fillSwatch.style.backgroundColor = numbersFontsState.fill;
      fillSwatch.title = `Numbers & Fonts color ${numbersFontsState.fill.toUpperCase()}`;
    }
    syncNumbersFontsTransformControls();
    syncGdbConfigControls();
    syncNumbersFontsPanelVisibility();
    syncNumbersFontsLibrarySelection("numbers");
    syncNumbersFontsLibrarySelection("font");
  }

  function requestNumbersFontsTextureRefresh() {
    forceOfficialNumbersFontsGeometry();
    if (initialized && gl) syncNumbersFontsTextures();
    requestRender();
  }

  function cloneNumbersFontsRuntimeState(value = numbersFontsState) {
    const cloned = JSON.parse(JSON.stringify(value));
    delete cloned.transforms;
    delete cloned.meshCalibration;
    delete cloned.transformTarget;
    return cloned;
  }

  function numbersFontsStateAssetsReady(stateValue = numbersFontsState) {
    const numberReady = !stateValue?.pes6NumberAsset?.path || !!pes6AtlasImage(stateValue.pes6NumberAsset);
    const fontReady = !stateValue?.pes6FontAsset?.path || !!pes6AtlasImage(stateValue.pes6FontAsset);
    return numberReady && fontReady;
  }

  function preloadNumbersFontsState(stateValue = null) {
    const source = stateValue && typeof stateValue === "object" ? stateValue : {};
    return Promise.allSettled([
      preloadPes6AtlasSelection(source.pes6NumberAsset),
      preloadPes6AtlasSelection(source.pes6FontAsset),
    ]);
  }

  function commitAppliedNumbersFontsVisuals(generation) {
    if (generation !== numbersFontsApplyGeneration) return;
    forceOfficialNumbersFontsGeometry();
    applyMeshCalibrationToGpu(null, { useBaseWhenMissing: true });
    enforceOfficialPlayerNameLimit({ emit: false });
    syncNumbersFontsControls();
    requestNumbersFontsTextureRefresh();
  }

  function finishApplyingNumbersFontsState() {
    const generation = ++numbersFontsApplyGeneration;

    // A kit change never moves the user's right sidebar away from Kits.
    activeNumbersSidebarTab = "project";

    // Geometry and UV placement are always the approved locked defaults.
    forceOfficialNumbersFontsGeometry();
    syncNumbersFontsControls();
    applyMeshCalibrationToGpu(null, { useBaseWhenMissing: true });

    // The Project switcher preloads the destination assets. When they are
    // already cached, upload both textures synchronously before app.js renders
    // the new shirt, so the complete kit changes in one visual frame.
    if (numbersFontsStateAssetsReady(numbersFontsState)) {
      commitAppliedNumbersFontsVisuals(generation);
      return;
    }

    // Cold loads stay on the previous complete visual state until Number and
    // Font are both ready. They are committed together, never one after another.
    preloadNumbersFontsState(numbersFontsState).then(() => {
      commitAppliedNumbersFontsVisuals(generation);
    });
  }

  function emitCurrentKitNumbersFontsState() {
    window.dispatchEvent(new CustomEvent("kitlab:numbers-fonts-updated", {
      detail: { state: serializeNumbersFontsState() },
    }));
  }

  function updateNumbersFontsState(patch = {}, options = {}) {
    const safePatch = { ...patch };
    delete safePatch.transforms;
    delete safePatch.meshCalibration;
    delete safePatch.transformTarget;
    const merged = {
      ...numbersFontsState,
      ...safePatch,
      gdbConfig: {
        ...numbersFontsState.gdbConfig,
        ...(safePatch.gdbConfig || {}),
      },
      transforms: Object.fromEntries(
        Object.keys(OFFICIAL_NUMBERS_FONTS_TRANSFORMS).map((key) => [key, officialNumbersFontsTransform(key)]),
      ),
      meshCalibration: null,
      transformTarget: "back",
    };
    numbersFontsState = sanitizeNumbersFontsState(merged, numbersFontsState);
    forceOfficialNumbersFontsGeometry();
    syncNumbersFontsControls();
    if (options.refreshTextures !== false) requestNumbersFontsTextureRefresh();
    else requestRender();
    if (options.emit !== false) emitCurrentKitNumbersFontsState();
  }

  function resetNumbersFontsState(options = {}) {
    const panelOpen = options.preservePanel ? numbersFontsState.panelOpen : false;
    numbersFontsState = sanitizeNumbersFontsState(
      cloneNumbersFontsDefaultState(),
      cloneNumbersFontsDefaultState(),
    );
    numbersFontsState.panelOpen = panelOpen;
    finishApplyingNumbersFontsState();
    if (options.emit === true) emitCurrentKitNumbersFontsState();
  }

  function captureGdbConfigFromControls() {
    const description = gdbControl("kitlabGdbPreviewDescription");
    const model = gdbControl("kitlabGdbPreviewModel");
    const nameShape = gdbControl("kitlabGdbPreviewNameShape");
    const radarField = gdbControl("kitlabGdbPreviewRadarColor");
    const shortsField = gdbControl("kitlabGdbPreviewShortsColor");
    numbersFontsState.gdbConfig = {
      ...numbersFontsState.gdbConfig,
      description: String(description?.value ?? numbersFontsState.gdbConfig?.description ?? "").slice(0, 120),
      model: String(model?.value ?? numbersFontsState.gdbConfig?.model ?? "33").replace(/\D+/g, "").slice(0, 3) || "33",
      collar: collarLabelRequiresNoModel(selectedCollarLabel()) ? "no" : "yes",
      nameShape: ["type1", "type2", "type3"].includes(String(nameShape?.value || "").toLowerCase())
        ? String(nameShape.value).toLowerCase()
        : "type1",
      radarColor: sanitizeNumbersColor(radarField?.value, numbersFontsState.gdbConfig?.radarColor || ""),
      shortsColor: sanitizeNumbersColor(shortsField?.value, numbersFontsState.gdbConfig?.shortsColor || ""),
    };
  }

  function serializeNumbersFontsState() {
    // Geometry is not kit data and is never serialized. Every kit stores only
    // its own PNG selections, text, color, visibility/location and GDB values.
    captureGdbConfigFromControls();
    forceOfficialNumbersFontsGeometry();
    const serialized = cloneNumbersFontsRuntimeState(numbersFontsState);
    delete serialized.transforms;
    delete serialized.meshCalibration;
    delete serialized.transformTarget;
    serialized.layoutVersion = KITLAB_NUMBERS_FONTS_LAYOUT_VERSION;
    serialized.geometryProfile = "KITLAB_OFFICIAL_PES6_V1";
    forceOfficialNumbersFontsGeometry();
    return serialized;
  }

  function applyNumbersFontsState(saved, options = {}) {
    forceOfficialNumbersFontsGeometry();
    if (!saved || typeof saved !== "object") {
      if (options.resetIfMissing !== false) {
        resetNumbersFontsState({ preservePanel: false });
      }
      return;
    }
    // Restore only per-kit content. Any transform/calibration from any older
    // project/version is discarded before it can enter the runtime state.
    const contentOnly = { ...saved };
    delete contentOnly.transforms;
    delete contentOnly.meshCalibration;
    delete contentOnly.transformTarget;
    numbersFontsState = sanitizeNumbersFontsState(contentOnly, cloneNumbersFontsDefaultState());
    forceOfficialNumbersFontsGeometry();
    finishApplyingNumbersFontsState();
  }

  function bindNumbersFontsControls() {
    if (!numbersPanelToggle) return;
    numbersPanelToggle.addEventListener("click", () => {
      const nextOpen = !numbersFontsState.panelOpen;
      activeNumbersSidebarTab = "project";
      updateNumbersFontsState({ panelOpen: nextOpen }, { refreshTextures: false, emit: false });
      activateNumbersSidebarTab("project", { load: false });
    });
    numbersPanelClose?.addEventListener("click", () => {
      activeNumbersSidebarTab = "project";
      updateNumbersFontsState({ panelOpen: false }, { refreshTextures: false, emit: false });
    });
    Object.entries(rightTabButtons).forEach(([tab, button]) => {
      button?.addEventListener("click", () => activateNumbersSidebarTab(tab));
    });
    numbersControl("kitlabNumbersLibraryBack")?.addEventListener("click", () => showNumbersFontsCountries("numbers"));
    numbersControl("kitlabFontLibraryBack")?.addEventListener("click", () => showNumbersFontsCountries("font"));

    const bindText = (id, key, sanitize) => {
      numbersControl(id)?.addEventListener("input", (event) => {
        const value = sanitize ? sanitize(event.target.value) : event.target.value;
        if (event.target.value !== value) event.target.value = value;
        updateNumbersFontsState({ [key]: value });
      });
    };
    bindText("kitlabNfPlayerName", "playerName", (value) => {
      const clean = normalizePes6PlayerName(value).slice(0, 15);
      const atlas = pes6AtlasImage(numbersFontsState.pes6FontAsset);
      return atlas ? fitPes6PlayerNameToOfficialZone(clean, atlas) : clean;
    });
    numbersControl("kitlabNfBackNumber")?.addEventListener("input", (event) => {
      const value = sanitizeNumberValue(event.target.value);
      if (event.target.value !== value) event.target.value = value;
      updateNumbersFontsState({
        backNumber: value,
        frontNumber: value,
        shortNumber: value,
        backVisible: !!value,
      });
    });

    numbersControl("kitlabNfNameVisible")?.addEventListener("change", (event) => updateNumbersFontsState({ nameVisible: event.target.checked }, { refreshTextures: false }));
    numbersControl("kitlabNfNamePosition")?.addEventListener("change", (event) => updateNumbersFontsState({ namePosition: event.target.value }, { refreshTextures: false }));
    numbersControl("kitlabNfBackVisible")?.addEventListener("change", (event) => updateNumbersFontsState({ backVisible: event.target.checked }, { refreshTextures: false }));
    numbersControl("kitlabNfFrontPosition")?.addEventListener("change", (event) => updateNumbersFontsState({ frontPosition: event.target.value }, { refreshTextures: false }));
    numbersControl("kitlabNfShortSide")?.addEventListener("change", (event) => updateNumbersFontsState({ shortSide: event.target.value }, { refreshTextures: false }));
    numbersControl("kitlabNfFillSwatch")?.addEventListener("click", (event) => {
      openOriginalKitLabColorPicker(event, {
        key: "numbers-fonts-fill",
        hostId: "kitlabNfFillPickerHost",
        title: "Numbers & Fonts color",
        color: numbersFontsState.fill,
        onChange: (hex) => updateNumbersFontsState({ fill: hex }),
      });
    });
    numbersControl("kitlabNfTransformTarget")?.addEventListener("change", (event) => {
      const selected = String(event.target.value || "back");
      universalNumbersFontsCalibrationTarget = NUMBERS_FONTS_CALIBRATION_KEYS.includes(selected)
        ? selected
        : "back";
      forceOfficialNumbersFontsGeometry();
      syncNumbersFontsTransformControls();
    });
    const patchTransform = (field, rawValue) => {
      updateUniversalNumbersFontsTransform(
        universalNumbersFontsCalibrationTarget,
        field,
        rawValue,
      );
    };
    numbersControl("kitlabNfWidth")?.addEventListener("input", (event) => patchTransform("width", (Number(event.target.value) || 100) / 100));
    numbersControl("kitlabNfHeight")?.addEventListener("input", (event) => patchTransform("height", (Number(event.target.value) || 100) / 100));
    numbersControl("kitlabNfOffsetX")?.addEventListener("input", (event) => patchTransform("x", Number(event.target.value) || 0));
    numbersControl("kitlabNfOffsetY")?.addEventListener("input", (event) => patchTransform("y", Number(event.target.value) || 0));
    numbersControl("kitlabNfDepth")?.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) patchTransform("depth", value);
    });
    numbersControl("kitlabNfResetPiece")?.addEventListener("click", () => {
      resetUniversalNumbersFontsTransform(universalNumbersFontsCalibrationTarget);
    });
    numbersControl("kitlabNfResetAll")?.addEventListener("click", () => {
      resetUniversalNumbersFontsCalibration();
    });
    syncNumbersFontsControls();
  }

  async function loadNumbersFontsMeshData() {
    const response = await fetch(NUMBERS_FONTS_MESH_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Numbers & Fonts HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.meshes)) throw new Error("Invalid Numbers & Fonts mesh payload");
    return data;
  }

  // The source Back Number overlay follows the real shirt triangles. Some of
  // those triangles duplicate the same UV knot with slightly different 3D
  // positions. Rendering the duplicates independently creates a visible
  // horizontal crack through the bottom of large digits. Weld only vertices
  // that share the same UV coordinate and are physically adjacent, then reuse
  // one continuous vertex on both sides of every internal edge.
  function weldNumbersBackMeshUvSeams(mesh) {
    const sourcePositions = Array.isArray(mesh?.positions) ? mesh.positions : [];
    const sourceNormals = Array.isArray(mesh?.normals) ? mesh.normals : [];
    const sourceUvs = Array.isArray(mesh?.uvs) ? mesh.uvs : [];
    const sourceIndices = Array.isArray(mesh?.indices) ? mesh.indices : [];
    const vertexCount = Math.min(
      Math.floor(sourcePositions.length / 3),
      Math.floor(sourceNormals.length / 3),
      Math.floor(sourceUvs.length / 2),
    );
    if (vertexCount < 3 || sourceIndices.length < 3) return mesh;

    const UV_QUANTIZE = 10000;
    const MAX_WELD_DISTANCE_SQ = 0.03 * 0.03;
    const groupsByUv = new Map();
    const groups = [];
    const oldToNew = new Uint16Array(vertexCount);

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const positionOffset = vertex * 3;
      const uvOffset = vertex * 2;
      const px = Number(sourcePositions[positionOffset]) || 0;
      const py = Number(sourcePositions[positionOffset + 1]) || 0;
      const pz = Number(sourcePositions[positionOffset + 2]) || 0;
      const nx = Number(sourceNormals[positionOffset]) || 0;
      const ny = Number(sourceNormals[positionOffset + 1]) || 0;
      const nz = Number(sourceNormals[positionOffset + 2]) || 0;
      const u = Number(sourceUvs[uvOffset]) || 0;
      const v = Number(sourceUvs[uvOffset + 1]) || 0;
      const uvKey = `${Math.round(u * UV_QUANTIZE)}:${Math.round(v * UV_QUANTIZE)}`;
      const candidates = groupsByUv.get(uvKey) || [];
      let groupIndex = -1;
      for (const candidateIndex of candidates) {
        const candidate = groups[candidateIndex];
        const cx = candidate.sumPosition[0] / candidate.count;
        const cy = candidate.sumPosition[1] / candidate.count;
        const cz = candidate.sumPosition[2] / candidate.count;
        const dx = px - cx;
        const dy = py - cy;
        const dz = pz - cz;
        if (dx * dx + dy * dy + dz * dz <= MAX_WELD_DISTANCE_SQ) {
          groupIndex = candidateIndex;
          break;
        }
      }
      if (groupIndex < 0) {
        groupIndex = groups.length;
        groups.push({
          count: 0,
          sumPosition: [0, 0, 0],
          sumNormal: [0, 0, 0],
          sumUv: [0, 0],
        });
        candidates.push(groupIndex);
        groupsByUv.set(uvKey, candidates);
      }
      const group = groups[groupIndex];
      group.count += 1;
      group.sumPosition[0] += px;
      group.sumPosition[1] += py;
      group.sumPosition[2] += pz;
      group.sumNormal[0] += nx;
      group.sumNormal[1] += ny;
      group.sumNormal[2] += nz;
      group.sumUv[0] += u;
      group.sumUv[1] += v;
      oldToNew[vertex] = groupIndex;
    }

    const weldedPositions = new Float32Array(groups.length * 3);
    const weldedNormals = new Float32Array(groups.length * 3);
    const weldedUvs = new Float32Array(groups.length * 2);
    groups.forEach((group, index) => {
      const inverseCount = 1 / Math.max(1, group.count);
      weldedPositions[index * 3] = group.sumPosition[0] * inverseCount;
      weldedPositions[index * 3 + 1] = group.sumPosition[1] * inverseCount;
      weldedPositions[index * 3 + 2] = group.sumPosition[2] * inverseCount;
      let nx = group.sumNormal[0] * inverseCount;
      let ny = group.sumNormal[1] * inverseCount;
      let nz = group.sumNormal[2] * inverseCount;
      const normalLength = Math.hypot(nx, ny, nz) || 1;
      nx /= normalLength;
      ny /= normalLength;
      nz /= normalLength;
      weldedNormals[index * 3] = nx;
      weldedNormals[index * 3 + 1] = ny;
      weldedNormals[index * 3 + 2] = nz;
      weldedUvs[index * 2] = group.sumUv[0] * inverseCount;
      weldedUvs[index * 2 + 1] = group.sumUv[1] * inverseCount;
    });

    const weldedIndices = [];
    const seenTriangles = new Set();
    for (let index = 0; index + 2 < sourceIndices.length; index += 3) {
      const a = oldToNew[Number(sourceIndices[index]) || 0];
      const b = oldToNew[Number(sourceIndices[index + 1]) || 0];
      const c = oldToNew[Number(sourceIndices[index + 2]) || 0];
      if (a === b || b === c || c === a) continue;
      const triangleKey = [a, b, c].sort((left, right) => left - right).join(":");
      if (seenTriangles.has(triangleKey)) continue;
      seenTriangles.add(triangleKey);
      weldedIndices.push(a, b, c);
    }

    return {
      ...mesh,
      positions: Array.from(weldedPositions),
      normals: Array.from(weldedNormals),
      uvs: Array.from(weldedUvs),
      indices: weldedIndices,
    };
  }

  function initializeNumbersFontsGpu(data) {
    numbersMeshSourceData = data;
    numbersFontPrimitives = data.meshes.map((sourceMesh) => {
      const mesh = String(sourceMesh?.name || "") === "back"
        ? weldNumbersBackMeshUvSeams(sourceMesh)
        : sourceMesh;
      const positions = new Float32Array(mesh.positions || []);
      const normals = new Float32Array(mesh.normals || []);
      const primitive = createPrimitiveBuffers(gl, {
        positions,
        normals,
        uvs: new Float32Array(mesh.uvs || []),
        indices: new Uint16Array(mesh.indices || []),
        indexComponentType: 5123,
      });
      primitive.name = String(mesh.name || "");
      primitive.piece = String(mesh.piece || "back");
      primitive.center = Array.isArray(mesh.center) ? mesh.center.slice(0, 3) : [0, 0, 0];
      primitive.baseCenter = primitive.center.slice();
      primitive.basePositions = new Float32Array(positions);
      primitive.baseNormals = new Float32Array(normals);
      primitive.calibrationGroups = buildNumbersCalibrationGroups(primitive.basePositions);
      return primitive;
    });

    // Manual calibration was retired. Old browser data must never change the
    // official mesh when another kit is selected.
    try { localStorage.removeItem(NUMBERS_CALIBRATION_STORAGE_KEY); } catch (_) {}
    numbersFontsState.meshCalibration = null;
    applyMeshCalibrationToGpu(null, { useBaseWhenMissing: true });
    ensureNumbersMeshCalibrationUi();
  }

  const pes6AtlasImageCache = new Map();
  const pes6AtlasCanvasCache = Object.create(null);

  function pes6AtlasImage(selection) {
    if (!selection?.path) return null;
    const entry = pes6AtlasImageCache.get(String(selection.path));
    return entry?.status === "loaded" ? entry.image : null;
  }

  function preloadPes6AtlasSelection(selection) {
    if (!selection?.path) return Promise.resolve(null);
    const path = String(selection.path);
    const existing = pes6AtlasImageCache.get(path);
    if (existing?.promise) return existing.promise;
    const image = new Image();
    image.decoding = "async";
    const entry = { status: "loading", image, promise: null };
    entry.promise = new Promise((resolve, reject) => {
      image.onload = () => {
        entry.status = "loaded";
        resolve(image);
      };
      image.onerror = () => {
        entry.status = "error";
        reject(new Error(`Unable to load PES6 atlas: ${path}`));
      };
    });
    pes6AtlasImageCache.set(path, entry);
    image.src = path;
    return entry.promise;
  }

  function pes6AtlasWorkCanvas(key, width, height) {
    let canvas = pes6AtlasCanvasCache[key];
    if (!canvas) canvas = pes6AtlasCanvasCache[key] = document.createElement("canvas");
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  }

  function normalizeAtlasCanvasColor(context, canvas) {
    context.save();
    context.globalCompositeOperation = "source-in";
    context.fillStyle = numbersFontsState.fill || "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  // KitLab6 Local 1.60 — exact PES6 layout calibrated from the 2048×2048
  // VillaPilla colour guide and verified against PES6 in-game screenshots.
  // Ratios are based on the visible content inside each official grey zone.
  // They are intentionally independent of the PNG atlas: every future PES6
  // number/font set inherits the same physical size and placement rules.
  const PES6_EXACT_LAYOUT = Object.freeze({
    back: Object.freeze({
      contentHeight: 291 / 332,
      // Keep wide glyphs such as 4 separated, while preserving the PES6 height.
      digitSlotWidth: 148 / 348,
      centers: Object.freeze([0.26, 0.74]),
      // Keep the 3D surface conformed to the shirt and move only the atlas
      // content. 50 canvas pixels on the 1024px Back texture = 0.048828125.
      // This raises the complete dorsal without translating the 3D surface.
      centerY: 0.391171875,
    }),
    front: Object.freeze({
      contentHeight: 161 / 215,
      // Two protected cells inside the complete Front receiver.
      digitSlotWidth: 0.42,
      centers: Object.freeze([0.25, 0.75]),
      centerY: 0.5,
    }),
    short: Object.freeze({
      contentHeight: 132 / 168,
      // Two protected cells inside the exact Short receiver vertices.
      // The digits remain clearly separated and neither cell touches an edge.
      digitSlotWidth: 0.42,
      centers: Object.freeze([0.25, 0.75]),
      centerY: 0.5,
    }),
    name: Object.freeze({
      contentHeight: 44 / 95,
      maxWidth: 337 / 348,
      sourceGapByHeight: 0.12,
      centerY: 0.5,
    }),
  });

  // Back Number controls are rendered inside the transparent texture instead
  // of translating/scaling the 3D surface. This keeps every vertex conformed to
  // the shirt and prevents the dorsal from entering the torso.
  const BACK_NUMBER_BASELINE_Y = 12;
  const BACK_NUMBER_TEXTURE_X_PER_UNIT = 0.00425;
  const BACK_NUMBER_TEXTURE_Y_PER_UNIT = 0.00360;
  // Individual digit sliders operate inside the transparent atlas texture.
  // Positive X moves right; positive Y moves up.
  const INDIVIDUAL_DIGIT_TEXTURE_X_PER_UNIT = 0.0030;
  const INDIVIDUAL_DIGIT_TEXTURE_Y_PER_UNIT = 0.0030;

  const pes6AtlasGlyphCache = new WeakMap();

  function atlasAnalysisCanvas(image) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width || 1;
    canvas.height = image.naturalHeight || image.height || 1;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return { canvas, context, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
  }

  function glyphRunsInAtlasRow(analysis, yStart, yEnd, threshold = 3) {
    const { canvas, pixels } = analysis;
    const width = canvas.width;
    const height = canvas.height;
    const top = Math.max(0, Math.floor(yStart));
    const bottom = Math.min(height, Math.ceil(yEnd));
    const occupied = new Uint8Array(width);
    for (let x = 0; x < width; x += 1) {
      for (let y = top; y < bottom; y += 1) {
        if (pixels[(y * width + x) * 4 + 3] > threshold) {
          occupied[x] = 1;
          break;
        }
      }
    }
    const runs = [];
    let x = 0;
    while (x < width) {
      while (x < width && !occupied[x]) x += 1;
      if (x >= width) break;
      const firstX = x;
      while (x < width && occupied[x]) x += 1;
      const lastX = x - 1;
      let minY = bottom;
      let maxY = top - 1;
      for (let px = firstX; px <= lastX; px += 1) {
        for (let py = top; py < bottom; py += 1) {
          if (pixels[(py * width + px) * 4 + 3] <= threshold) continue;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
      if (maxY >= minY) runs.push({ x: firstX, y: minY, width: lastX - firstX + 1, height: maxY - minY + 1 });
    }
    return runs;
  }

  // Real fixed PES6 cells. The PNG format is already final and must never be
  // reinterpreted differently because of its transparent pixels.
  function pes6AtlasGlyphs(image) {
    let cached = pes6AtlasGlyphCache.get(image);
    if (cached) return cached;
    const analysis = atlasAnalysisCanvas(image);
    const half = analysis.canvas.height * 0.5;
    const topRuns = glyphRunsInAtlasRow(analysis, 0, half);
    const bottomRuns = glyphRunsInAtlasRow(analysis, half, analysis.canvas.height);

    // Preserve the complete PES6 cell around every detected glyph. The old
    // tight alpha crop removed the final antialiased pixels and produced a
    // visible straight cut at the base of large back numbers. Cell limits are
    // placed in the transparent gap between neighbouring glyphs, so no part
    // of the original PNG is lost and adjacent characters never bleed in.
    const attachCompleteCells = (runs, rowTop, rowHeight) => runs.map((box, index) => {
      const previous = index > 0 ? runs[index - 1] : null;
      const next = index + 1 < runs.length ? runs[index + 1] : null;
      const boxRight = box.x + box.width;
      let cellLeft;
      let cellRight;
      if (previous) {
        const previousRight = previous.x + previous.width;
        cellLeft = Math.floor((previousRight + box.x) * 0.5);
      } else {
        const nextGap = next ? Math.max(0, next.x - boxRight) : Math.max(2, box.x);
        cellLeft = Math.max(0, box.x - Math.max(2, Math.ceil(nextGap * 0.5)));
      }
      if (next) {
        cellRight = Math.ceil((boxRight + next.x) * 0.5);
      } else {
        const previousRight = previous ? previous.x + previous.width : 0;
        const previousGap = previous ? Math.max(0, box.x - previousRight) : Math.max(2, analysis.canvas.width - boxRight);
        cellRight = Math.min(analysis.canvas.width, boxRight + Math.max(2, Math.ceil(previousGap * 0.5)));
      }
      cellLeft = Math.max(0, Math.min(box.x, cellLeft));
      cellRight = Math.min(analysis.canvas.width, Math.max(boxRight, cellRight));
      return {
        ...box,
        rowTop,
        rowHeight,
        cellX: cellLeft,
        cellY: rowTop,
        cellWidth: Math.max(1, cellRight - cellLeft),
        cellHeight: Math.max(1, rowHeight),
      };
    });

    const top = attachCompleteCells(topRuns, 0, half);
    const bottom = attachCompleteCells(bottomRuns, half, analysis.canvas.height - half);
    const numbers = Object.create(null);
    top.slice(0, 5).forEach((box, index) => { numbers[String(index)] = box; });
    bottom.slice(0, 5).forEach((box, index) => { numbers[String(index + 5)] = box; });
    const fonts = Object.create(null);
    "ABCDEFGHIJKLMN".split("").forEach((character, index) => {
      if (top[index]) fonts[character] = top[index];
    });
    "OPQRSTUVWXYZ.".split("").forEach((character, index) => {
      if (bottom[index]) fonts[character] = bottom[index];
    });
    cached = { analysis, numbers, fonts };
    pes6AtlasGlyphCache.set(image, cached);
    return cached;
  }


  function drawAtlasGlyph(context, image, box, centerX, centerY, scaleX, scaleY = scaleX) {
    if (!box) return;
    const sourceX = Number.isFinite(box.sourceX) ? box.sourceX : (Number.isFinite(box.cellX) ? box.cellX : box.x);
    const sourceY = Number.isFinite(box.sourceY) ? box.sourceY : (Number.isFinite(box.cellY) ? box.cellY : box.y);
    const sourceWidth = Number.isFinite(box.sourceWidth) ? box.sourceWidth : (Number.isFinite(box.cellWidth) ? box.cellWidth : box.width);
    const sourceHeight = Number.isFinite(box.sourceHeight) ? box.sourceHeight : (Number.isFinite(box.cellHeight) ? box.cellHeight : box.height);
    const destinationWidth = Math.max(1, Number(box.width) || 1) * scaleX;
    const destinationHeight = Math.max(1, Number(box.height) || 1) * scaleY;
    context.drawImage(
      image,
      sourceX, sourceY, sourceWidth, sourceHeight,
      centerX - destinationWidth * 0.5,
      centerY - destinationHeight * 0.5,
      destinationWidth,
      destinationHeight,
    );
  }

  function pes6NumberProfile(cacheKey) {
    if (cacheKey === "back") return PES6_EXACT_LAYOUT.back;
    if (cacheKey === "front") return PES6_EXACT_LAYOUT.front;
    return PES6_EXACT_LAYOUT.short;
  }

  function clampAtlasGlyphCenter(box, centerX, centerY, scaleX, scaleY, canvas, padding = 4) {
    const halfWidth = Math.max(1, Number(box?.width) || 1) * scaleX * 0.5;
    const halfHeight = Math.max(1, Number(box?.height) || 1) * scaleY * 0.5;
    const minX = padding + halfWidth;
    const maxX = canvas.width - padding - halfWidth;
    const minY = padding + halfHeight;
    const maxY = canvas.height - padding - halfHeight;
    return {
      x: minX <= maxX ? Math.max(minX, Math.min(maxX, centerX)) : canvas.width * 0.5,
      y: minY <= maxY ? Math.max(minY, Math.min(maxY, centerY)) : canvas.height * 0.5,
    };
  }

  function individualDigitTransform(cacheKey, digitIndex) {
    if (cacheKey === "back") {
      return officialNumbersFontsTransform(digitIndex === 0 ? "backDigit1" : "backDigit2");
    }
    if (cacheKey === "front") {
      return officialNumbersFontsTransform(digitIndex === 0 ? "frontDigit1" : "frontDigit2");
    }
    if (cacheKey === "short") {
      return officialNumbersFontsTransform(digitIndex === 0 ? "shortDigit1" : "shortDigit2");
    }
    return null;
  }

  function drawPes6NumberAtlas(targetContext, text, targetCanvas, image, cacheKey) {
    if (!image || image.naturalWidth < 128 || image.naturalHeight < 64) return false;
    const digits = String(text || "").replace(/\D+/g, "").slice(0, 2);
    if (!digits) return true;
    const layout = pes6AtlasGlyphs(image);
    const boxes = digits.split("").map((digit) => layout.numbers[digit]).filter(Boolean);
    if (boxes.length !== digits.length) return false;
    const work = pes6AtlasWorkCanvas(`number-${cacheKey}`, targetCanvas.width, targetCanvas.height);
    const context = work.getContext("2d", { alpha: true });
    context.clearRect(0, 0, work.width, work.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const profile = pes6NumberProfile(cacheKey);
    const allBoxes = Object.values(layout.numbers);
    const maxSourceWidth = Math.max(...allBoxes.map((box) => box.width), 1);
    const maxSourceHeight = Math.max(...allBoxes.map((box) => box.height), 1);
    // Fixed PES6 base size. Front and Short can then fine-tune each digit
    // independently without moving or deforming the 3D receiver mesh.
    const baseScale = Math.min(
      (work.height * profile.contentHeight) / maxSourceHeight,
      (work.width * profile.digitSlotWidth) / maxSourceWidth,
    );
    let groupScaleX = baseScale;
    let groupScaleY = baseScale;
    let centerY = work.height * profile.centerY;
    let centerOffsetX = 0;
    if (cacheKey === "back") {
      const transform = officialNumbersFontsTransform("back");
      groupScaleX *= Math.max(0.10, Math.min(3.00, Number(transform.width) || 1));
      groupScaleY *= Math.max(0.10, Math.min(3.00, Number(transform.height) || 1));
      centerOffsetX = work.width * (Number(transform.x) || 0) * BACK_NUMBER_TEXTURE_X_PER_UNIT;
      centerY -= work.height * ((Number(transform.y) || 0) - BACK_NUMBER_BASELINE_Y) * BACK_NUMBER_TEXTURE_Y_PER_UNIT;
    }

    const drawDigit = (box, digitIndex, baseCenterX) => {
      const digitTransform = boxes.length > 1 ? individualDigitTransform(cacheKey, digitIndex) : null;
      let digitScaleX = groupScaleX;
      let digitScaleY = groupScaleY;
      let digitCenterX = baseCenterX + centerOffsetX;
      let digitCenterY = centerY;
      if (digitTransform) {
        digitScaleX *= Math.max(0.10, Math.min(3.00, Number(digitTransform.width) || 1));
        digitScaleY *= Math.max(0.10, Math.min(3.00, Number(digitTransform.height) || 1));
        digitCenterX += work.width * (Number(digitTransform.x) || 0) * INDIVIDUAL_DIGIT_TEXTURE_X_PER_UNIT;
        digitCenterY -= work.height * (Number(digitTransform.y) || 0) * INDIVIDUAL_DIGIT_TEXTURE_Y_PER_UNIT;
      }
      const safe = clampAtlasGlyphCenter(
        box,
        digitCenterX,
        digitCenterY,
        digitScaleX,
        digitScaleY,
        work,
        4,
      );
      drawAtlasGlyph(context, image, box, safe.x, safe.y, digitScaleX, digitScaleY);
    };

    if (boxes.length === 1) {
      drawDigit(boxes[0], 0, work.width * 0.5);
    } else {
      drawDigit(boxes[0], 0, work.width * profile.centers[0]);
      drawDigit(boxes[1], 1, work.width * profile.centers[1]);
    }
    normalizeAtlasCanvasColor(context, work);
    targetContext.drawImage(work, 0, 0);
    return true;
  }

  function pes6FontCell(character, image = null) {
    const value = String(character || "").toUpperCase();
    if (value === " ") return { space: true };
    if (!image) return null;
    return pes6AtlasGlyphs(image).fonts[value] || null;
  }

  function normalizePes6PlayerName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/Ñ/g, "N")
      .replace(/[^A-Z. ]+/g, "")
      .replace(/ {2,}/g, " ")
      .slice(0, 15);
  }

  function pes6FontRenderMetrics(text, targetCanvas, image) {
    const clean = normalizePes6PlayerName(text);
    const layout = pes6AtlasGlyphs(image);
    const fontBoxes = Object.values(layout.fonts);
    const averageWidth = Math.max(1, fontBoxes.reduce((sum, box) => sum + box.width, 0) / Math.max(1, fontBoxes.length));
    const maxSourceHeight = Math.max(...fontBoxes.map((box) => box.height), 1);
    const scale = (targetCanvas.height * PES6_EXACT_LAYOUT.name.contentHeight) / maxSourceHeight;
    const sourceGap = maxSourceHeight * PES6_EXACT_LAYOUT.name.sourceGapByHeight;
    const gap = sourceGap * scale;
    const items = clean.split("").map((character) => {
      if (character === " ") return { space: true, width: averageWidth * 0.55, offsetY: 0 };
      const box = layout.fonts[character];
      if (!box) return null;
      // Preserve the glyph's original vertical position inside its PES6 atlas row.
      // This is especially important for '.', which must sit on the baseline rather
      // than being vertically centred like a dash.
      const rowCenter = Number(box.rowTop || 0) + Number(box.rowHeight || image.height * 0.5) * 0.5;
      const glyphCenter = box.y + box.height * 0.5;
      return { box, width: box.width, offsetY: glyphCenter - rowCenter };
    }).filter(Boolean);
    const totalWidth = items.reduce((sum, item) => sum + item.width * scale, 0) + gap * Math.max(0, items.length - 1);
    return { clean, layout, items, scale, gap, totalWidth, maxWidth: targetCanvas.width * PES6_EXACT_LAYOUT.name.maxWidth };
  }

  function fitPes6PlayerNameToOfficialZone(value, image, targetCanvas = null) {
    const clean = normalizePes6PlayerName(value);
    if (!image) return clean;
    const canvas = targetCanvas || { width: 1024, height: 256 };
    let accepted = "";
    for (const character of clean) {
      const candidate = accepted + character;
      const metrics = pes6FontRenderMetrics(candidate, canvas, image);
      if (metrics.totalWidth <= metrics.maxWidth + 0.01) accepted = candidate;
      else break;
    }
    return accepted;
  }

  function enforceOfficialPlayerNameLimit(options = {}) {
    const atlas = pes6AtlasImage(numbersFontsState.pes6FontAsset);
    if (!atlas) return false;
    const fitted = fitPes6PlayerNameToOfficialZone(numbersFontsState.playerName, atlas);
    if (fitted === numbersFontsState.playerName) return false;
    numbersFontsState.playerName = fitted;
    syncNumbersFontsControls();
    if (options.emit !== false) {
      window.dispatchEvent(new CustomEvent("kitlab:numbers-fonts-updated", {
        detail: { state: serializeNumbersFontsState() },
      }));
    }
    return true;
  }

  function drawPes6FontAtlas(targetContext, text, targetCanvas, image, cacheKey) {
    if (!image || image.naturalWidth < 128 || image.naturalHeight < 32) return false;
    const fittedText = fitPes6PlayerNameToOfficialZone(text, image, targetCanvas);
    if (!fittedText.length) return true;
    const metrics = pes6FontRenderMetrics(fittedText, targetCanvas, image);
    if (!metrics.items.length) return true;
    const work = pes6AtlasWorkCanvas(`font-${cacheKey}`, targetCanvas.width, targetCanvas.height);
    const context = work.getContext("2d", { alpha: true });
    context.clearRect(0, 0, work.width, work.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    // Never shrink a PES6 player name. Glyph height and spacing are fixed.
    // Input is stopped before the next character can leave the official red zone.
    let cursor = (work.width - metrics.totalWidth) * 0.5;
    const centerY = work.height * PES6_EXACT_LAYOUT.name.centerY;
    for (const item of metrics.items) {
      const itemWidth = item.width * metrics.scale;
      if (item.box) {
        const glyphCenterY = centerY + (Number(item.offsetY) || 0) * metrics.scale;
        drawAtlasGlyph(context, image, item.box, cursor + itemWidth * 0.5, glyphCenterY, metrics.scale);
      }
      cursor += itemWidth + metrics.gap;
    }
    normalizeAtlasCanvasColor(context, work);
    targetContext.drawImage(work, 0, 0);
    return true;
  }

  function textTextureSpec(key) {
    if (key === "name") return { width: 1024, height: 256, text: numbersFontsState.playerName, strokeScale: 0.55 };
    if (key === "back") return { width: 1024, height: 1024, text: numbersFontsState.backNumber, strokeScale: 1 };
    if (key === "front") return { width: 512, height: 512, text: numbersFontsState.frontNumber, strokeScale: 1 };
    return { width: 512, height: 512, text: numbersFontsState.shortNumber, strokeScale: 1 };
  }

  function fitNumbersFont(context, text, width, height, family) {
    let size = Math.floor(height * 0.82);
    while (size > 16) {
      context.font = `900 ${size}px ${family}`;
      if (context.measureText(text).width <= width * 0.90) return size;
      size -= 4;
    }
    return size;
  }

  function fixedDigitFontSize(context, width, height, family) {
    const probeSize = 1000;
    context.font = `900 ${probeSize}px ${family}`;
    let widest = 1;
    for (const digit of "0123456789") {
      widest = Math.max(widest, context.measureText(digit).width / probeSize);
    }
    // Two equal digit cells. A single digit uses the same exact size and is
    // only centred; it is never enlarged.
    const cellWidth = width * 0.42;
    const byWidth = cellWidth / widest;
    const byHeight = height * 0.82;
    return Math.max(16, Math.floor(Math.min(byWidth, byHeight)));
  }

  function drawTextGlyph(context, text, x, y, strokeWidth) {
    if (strokeWidth > 0) {
      context.lineWidth = strokeWidth;
      context.strokeStyle = numbersFontsState.stroke;
      context.strokeText(text, x, y);
    }
    context.fillStyle = numbersFontsState.fill;
    context.fillText(text, x, y);
  }

  function drawFixedNumber(context, text, canvas, family, strokeWidth) {
    const digits = String(text || "").replace(/\D+/g, "").slice(0, 2);
    if (!digits) return;
    const size = fixedDigitFontSize(context, canvas.width, canvas.height, family);
    context.font = `900 ${size}px ${family}`;
    const y = canvas.height * 0.515;
    if (digits.length === 1) {
      drawTextGlyph(context, digits, canvas.width * 0.5, y, strokeWidth);
      return;
    }
    // Equal cells, equal glyph size. This is the critical rule: 7 and 10
    // always have the same digit height; only their total occupied width changes.
    drawTextGlyph(context, digits[0], canvas.width * 0.2725, y, strokeWidth);
    drawTextGlyph(context, digits[1], canvas.width * 0.7275, y, strokeWidth);
  }

  function drawNumbersFontCanvas(key) {
    const spec = textTextureSpec(key);
    let canvas = numbersFontCanvases[key];
    if (!canvas) {
      canvas = document.createElement("canvas");
      numbersFontCanvases[key] = canvas;
    }
    if (canvas.width !== spec.width) canvas.width = spec.width;
    if (canvas.height !== spec.height) canvas.height = spec.height;
    const context = canvas.getContext("2d", { alpha: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    const text = String(spec.text || "").trim();
    if (!text) return canvas;

    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.miterLimit = 2;
    const strokeWidth = numbersFontsState.strokeWidth * spec.strokeScale;

    // The original PES/Alegor Back and Name UVs are mirrored. Keep those
    // proven UVs intact (flipping the UV broke the dorsal into fragments)
    // and mirror only the generated transparent canvas instead.
    const mirrorCanvasX = key === "back" || key === "name";
    context.save();
    if (mirrorCanvasX) {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }

    if (key !== "name") {
      // Numbers are PES6-atlas only. The same selected PNG drives back, front and shorts.
      const selected = numbersFontsState.pes6NumberAsset;
      const atlas = pes6AtlasImage(selected);
      if (atlas && drawPes6NumberAtlas(context, text, canvas, atlas, key)) {
        context.restore();
        return canvas;
      }
      if (selected?.path) preloadPes6AtlasSelection(selected).then(requestNumbersFontsTextureRefresh).catch(() => {});
      context.restore();
      return canvas;
    }

    // Player names are PES6-atlas only. No Arial/browser-font fallback is rendered.
    const selected = numbersFontsState.pes6FontAsset;
    const atlas = pes6AtlasImage(selected);
    if (atlas && drawPes6FontAtlas(context, text, canvas, atlas, key)) {
      context.restore();
      return canvas;
    }
    if (selected?.path) preloadPes6AtlasSelection(selected).then(requestNumbersFontsTextureRefresh).catch(() => {});
    context.restore();
    return canvas;
  }

  function uploadNumbersFontTexture(key) {
    if (!gl) return null;
    const canvas = drawNumbersFontCanvas(key);
    let textureHandle = numbersFontTextures[key];
    if (!textureHandle) {
      textureHandle = gl.createTexture();
      numbersFontTextures[key] = textureHandle;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureHandle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    return textureHandle;
  }

  function syncNumbersFontsTextures() {
    if (!gl || !numbersProgram) return;
    for (const key of ["back", "name", "front", "short"]) uploadNumbersFontTexture(key);
  }

  function numbersPrimitiveVisible(primitive) {
    // The Numbers & Fonts toolbar icon is an independent visibility switch.
    // It remains active while Shirt/Short/Socks/Armband focus changes.
    if (numbersFontsState.panelOpen !== true) return false;
    const hasNumbers = !!numbersFontsState.pes6NumberAsset?.path;
    const hasFont = !!numbersFontsState.pes6FontAsset?.path;
    const backText = String(numbersFontsState.backNumber || "").trim();
    if (primitive.name === "back") return hasNumbers && numbersFontsState.backVisible && !!backText;
    if (primitive.name === "name") {
      return hasFont && numbersFontsState.nameVisible
        && numbersFontsState.namePosition === "top"
        && !!numbersFontsState.playerName;
    }
    if (primitive.name === "nameBottom") {
      return hasFont && numbersFontsState.nameVisible
        && numbersFontsState.namePosition === "bottom"
        && !!numbersFontsState.playerName;
    }
    if (primitive.name === "front") {
      return hasNumbers && numbersFontsState.frontPosition === "top" && !!numbersFontsState.frontNumber;
    }
    if (primitive.name === "frontTopRight") {
      return hasNumbers && numbersFontsState.frontPosition === "topright" && !!numbersFontsState.frontNumber;
    }
    if (primitive.name === "shortLeft") return hasNumbers && ["left", "both"].includes(numbersFontsState.shortSide) && !!numbersFontsState.shortNumber;
    if (primitive.name === "shortRight") return hasNumbers && ["right", "both"].includes(numbersFontsState.shortSide) && !!numbersFontsState.shortNumber;
    return false;
  }

  function numbersTextureForPrimitive(primitive) {
    return numbersFontTextures[primitive.piece] || null;
  }

  function numbersPrimitiveTransform(primitive) {
    if (primitive?.name === "shortLeft" || primitive?.name === "shortRight") {
      const shared = officialNumbersFontsTransform("short");
      const side = officialNumbersFontsTransform(primitive.name);
      return {
        width: shared.width * side.width,
        height: shared.height * side.height,
        x: shared.x + side.x,
        y: shared.y + side.y,
        depth: shared.depth + side.depth,
      };
    }
    if (primitive?.name === "nameBottom") return officialNumbersFontsTransform("nameBottom");
    if (primitive?.name === "frontTopRight") return officialNumbersFontsTransform("frontTopRight");
    return officialNumbersFontsTransform(primitive?.piece);
  }
  function numbersTransformMatrix(primitive) {
    // Back Number remains conformed to the curved shirt. Its X/Y/Size are
    // texture-space controls, while Depth is applied separately along normals.
    if (primitive.piece === "back") return mat4Identity();
    const transform = numbersPrimitiveTransform(primitive);
    const center = primitive.center || [0, 0, 0];
    const offsetX = transform.x * 0.005;
    const offsetY = transform.y * 0.005;
    const toOrigin = mat4Translation(-center[0], -center[1], -center[2]);
    const scale = mat4Scale(
      Math.max(0.10, Math.min(3.00, Number(transform.width) || 1)),
      Math.max(0.10, Math.min(3.00, Number(transform.height) || 1)),
      1,
    );
    const restore = mat4Translation(center[0] + offsetX, center[1] + offsetY, center[2]);
    return mat4Multiply(restore, mat4Multiply(scale, toOrigin));
  }

  function numbersManualSurfaceOffset(primitive) {
    const baseOffset =
      primitive.name === "back" ? 0.0100 :
      primitive.name === "frontTopRight" ? 0.0100 :
      primitive.name === "shortLeft" ? 0.0080 :
      0.0;
    const transform = numbersPrimitiveTransform(primitive);
    const manualOffset = (Number(transform.depth) || 0) * 0.001;
    // No automatic limit: the user decides exactly when the receiver touches
    // or crosses the model.
    return baseOffset + manualOffset;
  }

  function renderNumbersFonts(viewProjection) {
    if (!numbersProgram || !numbersFontPrimitives.length || activeModel !== "main") return;
    forceOfficialNumbersFontsGeometry();
    gl.useProgram(numbersProgram.handle);
    gl.uniformMatrix4fv(numbersProgram.viewProjection, false, viewProjection);
    gl.uniform1i(numbersProgram.texture, 0);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -1);
    // Only the outward face of each Numbers/Fonts surface is renderable.
    // This prevents a back dorsal from showing through the front or side.
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);

    for (const primitive of numbersFontPrimitives) {
      if (!numbersPrimitiveVisible(primitive)) continue;
      const textureHandle = numbersTextureForPrimitive(primitive);
      if (!textureHandle) continue;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textureHandle);
      gl.uniformMatrix4fv(numbersProgram.model, false, numbersTransformMatrix(primitive));
      // Back Number follows the exact curved shirt surface. It is lifted along
      // each vertex normal (not toward the camera), so no section can sink into
      // the torso and the dorsal still remains restricted to the back.
      if (numbersProgram.surfaceOffset) {
        gl.uniform1f(numbersProgram.surfaceOffset, numbersManualSurfaceOffset(primitive));
      }
      // Use only a minimal depth bias for the corrected left shorts surface.
      // The visible separation comes from the normal offset above, not from
      // pulling the number toward the camera.
      if (numbersProgram.depthBias) {
        const depthBias =
          primitive.name === "back" ? 0.00018 :
          primitive.name === "shortLeft" ? 0.00022 :
          0.0010;
        gl.uniform1f(numbersProgram.depthBias, depthBias);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, primitive.positionBuffer);
      gl.enableVertexAttribArray(numbersProgram.position);
      gl.vertexAttribPointer(numbersProgram.position, 3, gl.FLOAT, false, 0, 0);
      if (numbersProgram.normal >= 0 && primitive.normalBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, primitive.normalBuffer);
        gl.enableVertexAttribArray(numbersProgram.normal);
        gl.vertexAttribPointer(numbersProgram.normal, 3, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, primitive.uvBuffer);
      gl.enableVertexAttribArray(numbersProgram.uv);
      gl.vertexAttribPointer(numbersProgram.uv, 2, gl.FLOAT, false, 0, 0);
      if (primitive.indexBuffer) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.indexBuffer);
        gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, primitive.count);
      }
    }

    gl.disable(gl.CULL_FACE);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.useProgram(program.handle);
  }


  function calibrationPieceToTransformKey(piece) {
    if (piece === "shortLeft" || piece === "shortRight") return "short";
    return piece;
  }

  function buildNumbersCalibrationGroups(positions) {
    const groups = [];
    const byKey = new Map();
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      const offset = vertex * 3;
      // Vertices closer than 0.01 model units represent the same editable knot.
      // Their small original differences are retained while they are dragged.
      const key = [
        Math.round(positions[offset] * 100),
        Math.round(positions[offset + 1] * 100),
        Math.round(positions[offset + 2] * 100),
      ].join(":");
      let group = byKey.get(key);
      if (!group) {
        group = { indices: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.indices.push(vertex);
    }
    return groups;
  }

  function calibrationPrimitive(piece = numbersMeshEditor.piece) {
    return numbersFontPrimitives.find((primitive) => primitive.name === piece) || null;
  }

  function recomputeNumbersPrimitiveCenter(primitive) {
    if (!primitive?.positions?.length) return;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < primitive.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], primitive.positions[index + axis]);
        max[axis] = Math.max(max[axis], primitive.positions[index + axis]);
      }
    }
    primitive.center = [
      (min[0] + max[0]) * 0.5,
      (min[1] + max[1]) * 0.5,
      (min[2] + max[2]) * 0.5,
    ];
  }

  function uploadNumbersPrimitivePositions(primitive) {
    if (!gl || !primitive?.positionBuffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, primitive.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, primitive.positions, gl.DYNAMIC_DRAW);
    recomputeNumbersPrimitiveCenter(primitive);
  }

  function applyMeshCalibrationToGpu(calibration, options = {}) {
    if (!numbersFontPrimitives.length) return;
    const clean = sanitizeMeshCalibration(calibration || numbersFontsState.meshCalibration);
    for (const primitive of numbersFontPrimitives) {
      const saved = clean?.positions?.[primitive.name];
      if (saved && saved.length === primitive.positions.length) {
        primitive.positions.set(saved);
      } else if (options.useBaseWhenMissing && primitive.basePositions) {
        primitive.positions.set(primitive.basePositions);
      }
      uploadNumbersPrimitivePositions(primitive);
    }
    if (clean) numbersMeshEditor.surfaceOffset = clean.surfaceOffset;
    syncNumbersMeshCalibrationUi();
    requestRender();
  }

  function buildMeshCalibrationSnapshot() {
    const positions = {};
    for (const primitive of numbersFontPrimitives) {
      positions[primitive.name] = Array.from(primitive.positions, (value) => Number(value.toFixed(7)));
    }
    return {
      version: 4,
      surfaceOffset: Number(numbersMeshEditor.surfaceOffset.toFixed(4)),
      positions,
    };
  }

  function downloadNumbersCalibration(calibration) {
    const payload = {
      format: "KitLab6 Numbers & Fonts Manual Calibration",
      version: 4,
      createdAt: new Date().toISOString(),
      sourceModel: MAIN_MODEL_URL.split("/").pop(),
      instructions: "Send this JSON back so the exact final mesh positions can be integrated.",
      calibration,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "KitLab6_Numbers_Fonts_Manual_Calibration.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setNumbersCalibrationStatus(message, isError = false) {
    numbersMeshEditor.status = String(message || "");
    const status = numbersControl("kitlabNfMeshStatus");
    if (status) {
      status.textContent = numbersMeshEditor.status;
      status.classList.toggle("error", !!isError);
    }
  }

  function syncNumbersMeshCalibrationUi() {
    const toggle = numbersControl("kitlabNfMeshEditToggle");
    const piece = numbersControl("kitlabNfMeshPiece");
    const mode = numbersControl("kitlabNfMeshMode");
    const lift = numbersControl("kitlabNfMeshLift");
    const liftValue = numbersControl("kitlabNfMeshLiftValue");
    if (toggle) {
      toggle.classList.toggle("active", numbersMeshEditor.active);
      toggle.textContent = numbersMeshEditor.active ? "STOP EDIT" : "EDIT UV MESH";
      toggle.setAttribute("aria-pressed", String(numbersMeshEditor.active));
    }
    if (piece) piece.value = numbersMeshEditor.piece;
    if (mode) mode.value = numbersMeshEditor.mode;
    if (lift) lift.value = String(Math.round(numbersMeshEditor.surfaceOffset * 1000));
    if (liftValue) liftValue.textContent = numbersMeshEditor.surfaceOffset.toFixed(3);
    setNumbersCalibrationStatus(numbersMeshEditor.status);
    numbersMeshCalibrationSvg?.classList.toggle("active", numbersMeshEditor.active);
  }

  function ensureNumbersMeshCalibrationUi() {
    if (!numbersPanel || numbersMeshCalibrationUi) return;
    const section = document.createElement("div");
    section.className = "kitlab-nf-mesh-calibrator";
    section.innerHTML = `
      <div class="kitlab-nf-divider"></div>
      <div class="kitlab-nf-mesh-title"><strong>MANUAL UV MESH</strong><span>CALIBRATION</span></div>
      <button id="kitlabNfMeshEditToggle" class="kitlab-nf-mesh-primary" type="button" aria-pressed="false">EDIT UV MESH</button>
      <div class="kitlab-nf-mesh-row">
        <label for="kitlabNfMeshPiece">Piece</label>
        <select id="kitlabNfMeshPiece">
          <option value="back">Back number</option>
          <option value="name">Font top</option>
          <option value="nameBottom">Font bottom</option>
          <option value="front">Front top number</option>
          <option value="frontTopRight">Front top right number</option>
          <option value="shortLeft">Short left</option>
          <option value="shortRight">Short right</option>
        </select>
      </div>
      <div class="kitlab-nf-mesh-row">
        <label for="kitlabNfMeshMode">Drag</label>
        <select id="kitlabNfMeshMode">
          <option value="vertex">Blue vertices</option>
          <option value="piece">Yellow centre / whole mesh</option>
        </select>
      </div>
      <label class="kitlab-nf-range-row" for="kitlabNfMeshLift"><span>Above model</span><input id="kitlabNfMeshLift" type="range" min="8" max="60" step="1" value="25" /><output id="kitlabNfMeshLiftValue">0.025</output></label>
      <div class="kitlab-nf-mesh-actions">
        <button id="kitlabNfMeshConform" type="button">PUT ABOVE MODEL</button>
        <button id="kitlabNfMeshReset" type="button">RESET PIECE</button>
      </div>
      <div class="kitlab-nf-mesh-actions">
        <button id="kitlabNfMeshLoad" type="button">LOAD CONFIG</button>
        <button id="kitlabNfMeshSave" class="save" type="button">SAVE CONFIG</button>
      </div>
      <input id="kitlabNfMeshFile" type="file" accept="application/json,.json" hidden />
      <p class="kitlab-nf-mesh-help">Blue point: move one UV vertex. Yellow point: move the complete mesh. Drag empty space to rotate. Every released vertex is projected above the visible model surface so it cannot remain inside it.</p>
      <div id="kitlabNfMeshStatus" class="kitlab-nf-mesh-status" aria-live="polite">Manual calibration ready</div>
    `;
    numbersPanel.appendChild(section);
    numbersMeshCalibrationUi = section;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "kitlabNfMeshOverlay";
    svg.classList.add("kitlab-nf-mesh-overlay");
    svg.setAttribute("aria-label", "Editable Numbers and Fonts UV mesh");
    stage3d.appendChild(svg);
    numbersMeshCalibrationSvg = svg;

    numbersControl("kitlabNfMeshEditToggle")?.addEventListener("click", () => {
      setNumbersMeshEditorActive(!numbersMeshEditor.active);
    });
    numbersControl("kitlabNfMeshPiece")?.addEventListener("change", (event) => {
      numbersMeshEditor.piece = event.target.value;
      if (numbersMeshEditor.active) {
        bakeNumbersPieceTransform(numbersMeshEditor.piece);
        focusNumbersCalibrationPiece();
      }
      setNumbersCalibrationStatus(`Editing ${numbersMeshEditor.piece}`);
      requestRender();
    });
    numbersControl("kitlabNfMeshMode")?.addEventListener("change", (event) => {
      numbersMeshEditor.mode = event.target.value === "piece" ? "piece" : "vertex";
      setNumbersCalibrationStatus(numbersMeshEditor.mode === "piece"
        ? "Drag the yellow centre to move the full mesh"
        : "Drag any blue vertex");
      requestRender();
    });
    numbersControl("kitlabNfMeshLift")?.addEventListener("input", (event) => {
      numbersMeshEditor.surfaceOffset = Math.max(0.008, Math.min(0.06, Number(event.target.value) / 1000));
      syncNumbersMeshCalibrationUi();
    });
    numbersControl("kitlabNfMeshConform")?.addEventListener("click", () => {
      if (conformCalibrationPrimitiveToModel(calibrationPrimitive())) {
        setNumbersCalibrationStatus("Mesh projected above the model");
      } else {
        setNumbersCalibrationStatus("Rotate the model until the whole target area is visible", true);
      }
      requestRender();
    });
    numbersControl("kitlabNfMeshReset")?.addEventListener("click", () => {
      const primitive = calibrationPrimitive();
      if (!primitive?.basePositions) return;
      primitive.positions.set(primitive.basePositions);
      uploadNumbersPrimitivePositions(primitive);
      setNumbersCalibrationStatus(`${primitive.name} restored to the starting mesh`);
      requestRender();
    });
    numbersControl("kitlabNfMeshSave")?.addEventListener("click", () => {
      for (const piece of ["back", "name", "nameBottom", "front", "frontTopRight", "shortLeft", "shortRight"]) {
        bakeNumbersPieceTransform(piece);
      }
      const calibration = buildMeshCalibrationSnapshot();
      updateNumbersFontsState({ meshCalibration: calibration }, { refreshTextures: false });
      try { localStorage.setItem(NUMBERS_CALIBRATION_STORAGE_KEY, JSON.stringify(calibration)); } catch (_) {}
      downloadNumbersCalibration(calibration);
      setNumbersCalibrationStatus("Saved in KitLab and exported as JSON");
    });
    numbersControl("kitlabNfMeshLoad")?.addEventListener("click", () => numbersControl("kitlabNfMeshFile")?.click());
    numbersControl("kitlabNfMeshFile")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const calibration = sanitizeMeshCalibration(parsed.calibration || parsed);
        if (!calibration) throw new Error("Invalid calibration JSON");
        numbersFontsState.meshCalibration = calibration;
        applyMeshCalibrationToGpu(calibration, { useBaseWhenMissing: false });
        try { localStorage.setItem(NUMBERS_CALIBRATION_STORAGE_KEY, JSON.stringify(calibration)); } catch (_) {}
        setNumbersCalibrationStatus(`Loaded ${file.name}`);
      } catch (error) {
        setNumbersCalibrationStatus(error?.message || "Could not load calibration", true);
      }
    });

    svg.addEventListener("pointerdown", startNumbersMeshPointerDrag);
    svg.addEventListener("pointermove", moveNumbersMeshPointerDrag);
    svg.addEventListener("pointerup", stopNumbersMeshPointerDrag);
    svg.addEventListener("pointercancel", stopNumbersMeshPointerDrag);
    syncNumbersMeshCalibrationUi();
  }

  function setNumbersMeshEditorActive(active) {
    numbersMeshEditor.active = !!active;
    numbersMeshEditor.drag = null;
    dragging = false;
    if (numbersMeshEditor.active) {
      if (activeModel !== "main") changeActiveModel("main");
      bakeNumbersPieceTransform(numbersMeshEditor.piece);
      focusNumbersCalibrationPiece();
      setNumbersCalibrationStatus("Drag blue vertices or the yellow centre");
    } else {
      setNumbersCalibrationStatus("Manual calibration paused");
    }
    syncNumbersMeshCalibrationUi();
    requestRender();
  }

  function focusNumbersCalibrationPiece() {
    const isBack = ["back", "name", "nameBottom"].includes(numbersMeshEditor.piece);
    const isShort = numbersMeshEditor.piece === "shortLeft" || numbersMeshEditor.piece === "shortRight";
    const visibilityPatch = numbersMeshEditor.piece === "back"
      ? { backVisible: true }
      : numbersMeshEditor.piece === "name"
        ? { nameVisible: true, namePosition: "top" }
        : numbersMeshEditor.piece === "nameBottom"
          ? { nameVisible: true, namePosition: "bottom" }
          : numbersMeshEditor.piece === "front"
            ? { frontPosition: "top" }
            : numbersMeshEditor.piece === "frontTopRight"
              ? { frontPosition: "topright" }
              : { shortSide: numbersMeshEditor.piece === "shortRight" ? "right" : "left" };
    updateNumbersFontsState(visibilityPatch, { refreshTextures: false, emit: false });
    yaw = isBack ? Math.PI : 0;
    pitch = 0;
    rotations.main.yaw = yaw;
    rotations.main.pitch = 0;
    focusCamera(isShort ? "short" : "shirt", false);
  }

  function transformPointByMatrix(matrix, point) {
    const x = point[0], y = point[1], z = point[2];
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    const safeW = Math.abs(w) > 1e-8 ? w : 1;
    return [
      (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / safeW,
      (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / safeW,
      (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / safeW,
    ];
  }

  function bakeNumbersPieceTransform(selectedPiece) {
    // Permanently disabled: the official Number/Font geometry cannot be baked,
    // edited or changed by any kit, template, Project or hidden legacy control.
    forceOfficialNumbersFontsGeometry();
  }
  function projectWorldToCalibrationScreen(point) {
    const matrix = lastMainViewProjection;
    const rect = canvas3d.getBoundingClientRect();
    if (!matrix || rect.width <= 0 || rect.height <= 0) return null;
    const x = point[0], y = point[1], z = point[2];
    const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (clipW <= 1e-6) return null;
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    const ndcZ = clipZ / clipW;
    return {
      x: (ndcX * 0.5 + 0.5) * rect.width,
      y: (1 - (ndcY * 0.5 + 0.5)) * rect.height,
      visible: ndcZ >= -1.2 && ndcZ <= 1.2,
    };
  }

  function groupCurrentCenter(primitive, group) {
    const center = [0, 0, 0];
    for (const vertex of group.indices) {
      center[0] += primitive.positions[vertex * 3];
      center[1] += primitive.positions[vertex * 3 + 1];
      center[2] += primitive.positions[vertex * 3 + 2];
    }
    const count = Math.max(1, group.indices.length);
    return center.map((value) => value / count);
  }

  function refreshNumbersMeshCalibrationOverlay() {
    const svg = numbersMeshCalibrationSvg;
    if (!svg) return;
    if (!numbersMeshEditor.active || activeModel !== "main") {
      svg.replaceChildren();
      return;
    }
    const primitive = calibrationPrimitive();
    const rect = canvas3d.getBoundingClientRect();
    if (!primitive || !lastMainViewProjection || rect.width <= 0 || rect.height <= 0) return;
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    svg.setAttribute("width", String(rect.width));
    svg.setAttribute("height", String(rect.height));

    const namespace = "http://www.w3.org/2000/svg";
    const fragment = document.createDocumentFragment();
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("class", "kitlab-nf-mesh-wire");
    const edgeKeys = new Set();
    const pathParts = [];
    const indices = primitive.indices || null;
    const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor((primitive.positions.length / 3) / 3);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const base = triangle * 3;
      const verts = indices ? [indices[base], indices[base + 1], indices[base + 2]] : [base, base + 1, base + 2];
      for (const [a, b] of [[verts[0], verts[1]], [verts[1], verts[2]], [verts[2], verts[0]]]) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        const pa = projectWorldToCalibrationScreen([
          primitive.positions[a * 3], primitive.positions[a * 3 + 1], primitive.positions[a * 3 + 2],
        ]);
        const pb = projectWorldToCalibrationScreen([
          primitive.positions[b * 3], primitive.positions[b * 3 + 1], primitive.positions[b * 3 + 2],
        ]);
        if (!pa?.visible || !pb?.visible) continue;
        pathParts.push(`M${pa.x.toFixed(2)},${pa.y.toFixed(2)}L${pb.x.toFixed(2)},${pb.y.toFixed(2)}`);
      }
    }
    path.setAttribute("d", pathParts.join(""));
    fragment.appendChild(path);

    const projectedCenters = [];
    primitive.calibrationGroups.forEach((group, groupIndex) => {
      const screen = projectWorldToCalibrationScreen(groupCurrentCenter(primitive, group));
      if (!screen?.visible) return;
      projectedCenters.push(screen);
      const circle = document.createElementNS(namespace, "circle");
      circle.setAttribute("class", "kitlab-nf-mesh-vertex");
      circle.setAttribute("cx", screen.x.toFixed(2));
      circle.setAttribute("cy", screen.y.toFixed(2));
      circle.setAttribute("r", numbersMeshEditor.mode === "vertex" ? "4.2" : "2.5");
      circle.dataset.group = String(groupIndex);
      circle.dataset.role = "vertex";
      fragment.appendChild(circle);
    });

    if (projectedCenters.length) {
      const centerX = projectedCenters.reduce((sum, item) => sum + item.x, 0) / projectedCenters.length;
      const centerY = projectedCenters.reduce((sum, item) => sum + item.y, 0) / projectedCenters.length;
      const center = document.createElementNS(namespace, "circle");
      center.setAttribute("class", "kitlab-nf-mesh-centre");
      center.setAttribute("cx", centerX.toFixed(2));
      center.setAttribute("cy", centerY.toFixed(2));
      center.setAttribute("r", "8");
      center.dataset.role = "piece";
      fragment.appendChild(center);
    }
    svg.replaceChildren(fragment);
  }

  function vectorSubtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vectorAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vectorScale(a, scale) { return [a[0] * scale, a[1] * scale, a[2] * scale]; }
  function vectorDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vectorCross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function vectorNormalize(a) {
    const length = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / length, a[1] / length, a[2] / length];
  }

  function calibrationRayFromClient(clientX, clientY) {
    const camera = lastMainCameraState;
    const rect = canvas3d.getBoundingClientRect();
    if (!camera || rect.width <= 0 || rect.height <= 0) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const forward = vectorNormalize(vectorSubtract(camera.target, camera.eye));
    const right = vectorNormalize(vectorCross(forward, camera.up));
    const trueUp = vectorNormalize(vectorCross(right, forward));
    const tanV = Math.tan(camera.vfov * 0.5);
    const direction = vectorNormalize(vectorAdd(
      forward,
      vectorAdd(
        vectorScale(right, ndcX * tanV * camera.aspect),
        vectorScale(trueUp, ndcY * tanV)
      )
    ));
    return { origin: camera.eye.slice(), direction, right, up: trueUp };
  }

  function intersectCalibrationTriangle(ray, a, b, c) {
    const edge1 = vectorSubtract(b, a);
    const edge2 = vectorSubtract(c, a);
    const p = vectorCross(ray.direction, edge2);
    const det = vectorDot(edge1, p);
    if (Math.abs(det) < 1e-9) return null;
    const inverse = 1 / det;
    const tvec = vectorSubtract(ray.origin, a);
    const u = vectorDot(tvec, p) * inverse;
    if (u < -1e-6 || u > 1.000001) return null;
    const q = vectorCross(tvec, edge1);
    const v = vectorDot(ray.direction, q) * inverse;
    if (v < -1e-6 || u + v > 1.000001) return null;
    const distance = vectorDot(edge2, q) * inverse;
    return distance > 1e-5 ? { distance, u, v } : null;
  }

  function surfacePrimitivesForCalibration() {
    const piece = numbersMeshEditor.piece;
    if (piece === "shortLeft" || piece === "shortRight") return lowerPrimitives;
    return useCollarNoModel && shirtNoPrimitives.length ? shirtNoPrimitives : shirtYesPrimitives;
  }

  function raycastCalibrationSurface(clientX, clientY) {
    const ray = calibrationRayFromClient(clientX, clientY);
    if (!ray) return null;
    let best = null;
    for (const primitive of surfacePrimitivesForCalibration()) {
      const positions = primitive.positions;
      const normals = primitive.normals;
      const indices = primitive.indices || null;
      if (!positions) continue;
      const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor((positions.length / 3) / 3);
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const offset = triangle * 3;
        const ia = indices ? indices[offset] : offset;
        const ib = indices ? indices[offset + 1] : offset + 1;
        const ic = indices ? indices[offset + 2] : offset + 2;
        const a = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
        const b = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
        const c = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
        const hit = intersectCalibrationTriangle(ray, a, b, c);
        if (!hit || (best && hit.distance >= best.distance)) continue;
        const point = vectorAdd(ray.origin, vectorScale(ray.direction, hit.distance));
        const w = 1 - hit.u - hit.v;
        let normal;
        if (normals?.length === positions.length) {
          normal = vectorNormalize([
            normals[ia * 3] * w + normals[ib * 3] * hit.u + normals[ic * 3] * hit.v,
            normals[ia * 3 + 1] * w + normals[ib * 3 + 1] * hit.u + normals[ic * 3 + 1] * hit.v,
            normals[ia * 3 + 2] * w + normals[ib * 3 + 2] * hit.u + normals[ic * 3 + 2] * hit.v,
          ]);
        } else {
          normal = vectorNormalize(vectorCross(vectorSubtract(b, a), vectorSubtract(c, a)));
        }
        // Always choose the normal pointing towards the camera. The positive
        // offset therefore places the editable mesh outside the garment.
        if (vectorDot(normal, ray.direction) > 0) normal = vectorScale(normal, -1);
        best = { distance: hit.distance, point, normal };
      }
    }
    if (!best) return null;
    return {
      ...best,
      outsidePoint: vectorAdd(best.point, vectorScale(best.normal, numbersMeshEditor.surfaceOffset)),
    };
  }

  function startNumbersMeshPointerDrag(event) {
    if (!numbersMeshEditor.active || event.button !== 0) return;
    const primitive = calibrationPrimitive();
    if (!primitive) return;
    const targetRole = event.target?.dataset?.role;
    const role = targetRole === "vertex" || targetRole === "piece" ? targetRole : "camera";
    if (role === "vertex" && numbersMeshEditor.mode !== "vertex") return;
    if (role === "piece" && numbersMeshEditor.mode !== "piece") return;
    const startPositions = new Float32Array(primitive.positions);
    const drag = {
      role,
      primitive,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPositions,
      startScreens: [],
      groupIndex: role === "vertex" ? Number(event.target.dataset.group) : -1,
    };
    if (role === "vertex") {
      const group = primitive.calibrationGroups[drag.groupIndex];
      if (!group) return;
      const center = groupCurrentCenter(primitive, group);
      const centerScreen = projectWorldToCalibrationScreen(center);
      drag.startScreens = group.indices.map((vertex) => {
        const screen = projectWorldToCalibrationScreen([
          primitive.positions[vertex * 3], primitive.positions[vertex * 3 + 1], primitive.positions[vertex * 3 + 2],
        ]);
        return {
          vertex,
          dx: (screen?.x || centerScreen?.x || 0) - (centerScreen?.x || 0),
          dy: (screen?.y || centerScreen?.y || 0) - (centerScreen?.y || 0),
        };
      });
    }
    numbersMeshEditor.drag = drag;
    numbersMeshCalibrationSvg.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function moveNumbersMeshPointerDrag(event) {
    const drag = numbersMeshEditor.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const primitive = drag.primitive;
    if (drag.role === "camera") {
      const dx = event.clientX - drag.startClientX;
      drag.startClientX = event.clientX;
      drag.startClientY = event.clientY;
      cameraTransition = null;
      yaw -= dx * 0.009;
      pitch = 0;
      rotations.main.yaw = yaw;
      rotations.main.pitch = 0;
      setNumbersCalibrationStatus("View rotated; drag a vertex when the target surface is visible");
      requestRender();
      event.preventDefault();
      return;
    }
    if (drag.role === "vertex") {
      let moved = false;
      const rect = canvas3d.getBoundingClientRect();
      for (const item of drag.startScreens) {
        const hit = raycastCalibrationSurface(event.clientX + item.dx, event.clientY + item.dy);
        if (!hit) continue;
        const offset = item.vertex * 3;
        primitive.positions[offset] = hit.outsidePoint[0];
        primitive.positions[offset + 1] = hit.outsidePoint[1];
        primitive.positions[offset + 2] = hit.outsidePoint[2];
        moved = true;
      }
      if (moved) {
        uploadNumbersPrimitivePositions(primitive);
        setNumbersCalibrationStatus("Vertex snapped above the model");
      }
    } else {
      const camera = lastMainCameraState;
      if (!camera) return;
      const rect = canvas3d.getBoundingClientRect();
      const center = primitive.center || [0, 0, 0];
      const depth = Math.max(0.1, Math.hypot(
        center[0] - camera.eye[0], center[1] - camera.eye[1], center[2] - camera.eye[2]
      ));
      const ray = calibrationRayFromClient(event.clientX, event.clientY);
      if (!ray) return;
      const unitsPerPixel = 2 * depth * Math.tan(camera.vfov * 0.5) / Math.max(1, rect.height);
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      const delta = vectorAdd(vectorScale(ray.right, dx * unitsPerPixel), vectorScale(ray.up, -dy * unitsPerPixel));
      for (let index = 0; index < primitive.positions.length; index += 3) {
        primitive.positions[index] = drag.startPositions[index] + delta[0];
        primitive.positions[index + 1] = drag.startPositions[index + 1] + delta[1];
        primitive.positions[index + 2] = drag.startPositions[index + 2] + delta[2];
      }
      uploadNumbersPrimitivePositions(primitive);
      setNumbersCalibrationStatus("Release to adapt the full mesh to the model");
    }
    requestRender();
    event.preventDefault();
  }

  function stopNumbersMeshPointerDrag(event) {
    const drag = numbersMeshEditor.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    numbersMeshEditor.drag = null;
    try { numbersMeshCalibrationSvg.releasePointerCapture?.(event.pointerId); } catch (_) {}
    if (drag.role === "piece") {
      const ok = conformCalibrationPrimitiveToModel(drag.primitive);
      setNumbersCalibrationStatus(ok
        ? "Complete mesh placed above the model"
        : "Some vertices could not see the model; rotate and use PUT ABOVE MODEL", !ok);
    }
    uploadNumbersPrimitivePositions(drag.primitive);
    requestRender();
    event.preventDefault();
  }

  function conformCalibrationPrimitiveToModel(primitive) {
    if (!primitive || !lastMainViewProjection) return false;
    const rect = canvas3d.getBoundingClientRect();
    const source = new Float32Array(primitive.positions);
    let success = 0;
    for (let vertex = 0; vertex < source.length / 3; vertex += 1) {
      const screen = projectWorldToCalibrationScreen([
        source[vertex * 3], source[vertex * 3 + 1], source[vertex * 3 + 2],
      ]);
      if (!screen?.visible) continue;
      const hit = raycastCalibrationSurface(rect.left + screen.x, rect.top + screen.y);
      if (!hit) continue;
      primitive.positions[vertex * 3] = hit.outsidePoint[0];
      primitive.positions[vertex * 3 + 1] = hit.outsidePoint[1];
      primitive.positions[vertex * 3 + 2] = hit.outsidePoint[2];
      success += 1;
    }
    uploadNumbersPrimitivePositions(primitive);
    return success >= Math.max(3, Math.floor((source.length / 3) * 0.82));
  }

  window.KitLab6NumbersFonts = Object.freeze({
    serialize: serializeNumbersFontsState,
    apply: applyNumbersFontsState,
    reset: resetNumbersFontsState,
    update: updateNumbersFontsState,
    getState: serializeNumbersFontsState,
    getManualCalibration: () => null,
    applyManualCalibration: () => false,
    preloadState: preloadNumbersFontsState,
    assetsReady: numbersFontsStateAssetsReady,
  });
  bindNumbersFontsControls();
  bindGdbConfigControls();
  document.querySelectorAll(
    ".kitlab-nf-mesh-calibrator, #kitlabNfMeshOverlay, [id^='kitlabNfMesh']"
  ).forEach((element) => element.remove());
  // Manual UV Mesh and every geometry adjustment below it are permanently hidden.

  function markSemiTransparentEdgeTargetsFor3d(rgba, width, height, options = {}) {
    const hiddenAlphaMax = Number.isFinite(options.hiddenAlphaMax) ? options.hiddenAlphaMax : 8;
    const semiAlphaMax = Number.isFinite(options.semiAlphaMax) ? options.semiAlphaMax : 96;
    const edgeRadius = Math.max(1, Math.min(6, Number.isFinite(options.edgeRadius) ? options.edgeRadius : 2));
    const pixelCount = width * height;
    const target = new Uint8Array(pixelCount);

    const hasHiddenNear = (x, y) => {
      for (let dy = -edgeRadius; dy <= edgeRadius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -edgeRadius; dx <= edgeRadius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const p = (yy * width + xx) * 4;
          if (rgba[p + 3] <= hiddenAlphaMax) return true;
        }
      }
      return false;
    };

    for (let y = 0, idx = 0, p = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1, idx += 1, p += 4) {
        const alpha = rgba[p + 3];
        if (alpha > hiddenAlphaMax && alpha <= semiAlphaMax && hasHiddenNear(x, y)) {
          target[idx] = 1;
        }
      }
    }
    return target;
  }

  function bleedEdgeRgbFor3dSafeStrong(rgba, width, height, options = {}) {
    const hiddenAlphaMax = Number.isFinite(options.hiddenAlphaMax) ? options.hiddenAlphaMax : 8;
    const seedAlphaMin = Number.isFinite(options.seedAlphaMin) ? options.seedAlphaMin : 128;
    const semiAlphaMax = Number.isFinite(options.semiAlphaMax) ? options.semiAlphaMax : 96;
    const radius = Math.max(1, Math.min(128, Number.isFinite(options.radius) ? options.radius : 40));
    const pixelCount = width * height;

    const semiTargets = markSemiTransparentEdgeTargetsFor3d(rgba, width, height, {
      hiddenAlphaMax,
      semiAlphaMax,
      edgeRadius: Number.isFinite(options.edgeRadius) ? options.edgeRadius : 2,
    });

    const out = new Uint8ClampedArray(rgba);
    const dist = new Int16Array(pixelCount);
    dist.fill(-1);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;

    for (let i = 0, p = 0; i < pixelCount; i += 1, p += 4) {
      if (rgba[p + 3] >= seedAlphaMin) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }

    const shouldFill = (idx) => {
      const p = idx * 4;
      const alpha = rgba[p + 3];
      return alpha <= hiddenAlphaMax || semiTargets[idx] === 1;
    };

    const tryFill = (fromIdx, toIdx, nextDist) => {
      if (toIdx < 0 || toIdx >= pixelCount || dist[toIdx] !== -1 || !shouldFill(toIdx)) return;
      const from = fromIdx * 4;
      const to = toIdx * 4;
      out[to] = out[from];
      out[to + 1] = out[from + 1];
      out[to + 2] = out[from + 2];
      dist[toIdx] = nextDist;
      queue[tail++] = toIdx;
    };

    while (head < tail) {
      const idx = queue[head++];
      const d = dist[idx];
      if (d >= radius) continue;
      const x = idx % width;
      const nextDist = d + 1;

      if (x > 0) tryFill(idx, idx - 1, nextDist);
      if (x < width - 1) tryFill(idx, idx + 1, nextDist);
      if (idx >= width) tryFill(idx, idx - width, nextDist);
      if (idx < pixelCount - width) tryFill(idx, idx + width, nextDist);
      if (x > 0 && idx >= width) tryFill(idx, idx - width - 1, nextDist);
      if (x < width - 1 && idx >= width) tryFill(idx, idx - width + 1, nextDist);
      if (x > 0 && idx < pixelCount - width) tryFill(idx, idx + width - 1, nextDist);
      if (x < width - 1 && idx < pixelCount - width) tryFill(idx, idx + width + 1, nextDist);
    }

    return out;
  }

  function buildSafeStrong3dTexture() {
    const context2d = sourceCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
    const imageData = context2d.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

    // Repair only hidden RGB around every transparent boundary.
    // The original alpha channel is copied back byte-for-byte so collar,
    // cuffs and all intentional cut-outs remain exactly as designed.
    const safeRgba = bleedEdgeRgbFor3dSafeStrong(
      imageData.data,
      imageData.width,
      imageData.height,
      {
        hiddenAlphaMax: 8,
        semiAlphaMax: 254,
        seedAlphaMin: 128,
        edgeRadius: 2,
        radius: 48,
      },
    );

    for (let p = 3; p < safeRgba.length; p += 4) {
      safeRgba[p] = imageData.data[p];
    }

    return new ImageData(safeRgba, imageData.width, imageData.height);
  }

  function scheduleTextureRefresh(delay = 80) {
    if (textureRefreshTimer) clearTimeout(textureRefreshTimer);
    textureRefreshTimer = window.setTimeout(() => {
      textureRefreshTimer = 0;
      requestRender();
    }, Math.max(0, delay));
  }

  function uploadTextureFastFromCanvas() {
    if (!gl || !texture || !sourceCanvas) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    try {
      // Native GPU upload: no getImageData, no edge-bleed loop and no GLB work.
      // The old framebuffer stays visible until requestRender(), so the user
      // never sees a half-switched collar.
      if (!textureReady) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          sourceCanvas
        );
        textureReady = true;
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          sourceCanvas
        );
      }
      textureDirty = false;
      return true;
    } catch (error) {
      console.warn("KitLab6 immediate collar texture upload failed", error);
      return false;
    }
  }

  function uploadTexture() {
    if (!gl || !texture || !sourceCanvas) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    try {
      // Same Safe-Strong RGB bleed used by the corrected PNG export.
      // Alpha is preserved exactly; only hidden/edge RGB is repaired.
      const safeTexture = buildSafeStrong3dTexture();

      if (!textureReady) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, safeTexture);
        textureReady = true;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, safeTexture);
      }
      textureDirty = false;
    } catch (error) {
      console.warn("KitLab6 3D Safe-Strong texture update failed", error);
    }
  }

  function resizeCanvas() {
    if (!canvas3d || !stage3d || stage3d.hidden) return;
    const rect = canvas3d.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas3d.width !== width || canvas3d.height !== height) {
      canvas3d.width = width;
      canvas3d.height = height;
      if (gl) gl.viewport(0, 0, width, height);
    }
    requestRender();
  }

  function requestRender() {
    if (!active3d || !initialized || renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      renderScene();
    });
  }

  function renderScene() {
    if (!gl || !program || !active3d || !initialized) return;
    resizeCanvasInternal();
    if (textureDirty || !textureReady) {
      const elapsed = performance.now() - textureDirtySince;
      const wait = textureReady ? Math.max(0, 80 - elapsed) : 0;
      if (wait <= 0) uploadTexture();
      else scheduleTextureRefresh(wait);
    }

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.texture, 0);

    updateCameraTransition();
    const aspect = canvas3d.width / Math.max(1, canvas3d.height);
    const projection = mat4Perspective(35 * Math.PI / 180, aspect, Math.max(0.01, distance / 100), distance * 12 + 30);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const eye = [
      cameraTarget[0] + sy * cp * distance,
      cameraTarget[1] - sp * distance,
      cameraTarget[2] + cy * cp * distance,
    ];
    const cameraUp = activeModel === "armband"
      ? [sy * sp, cp, cy * sp]
      : [0, 1, 0];
    const view = mat4LookAt(eye, cameraTarget, cameraUp);
    const viewProjection = mat4Multiply(projection, view);
    if (activeModel === "main") {
      lastMainCameraState = {
        eye: eye.slice(),
        target: cameraTarget.slice(),
        up: cameraUp.slice(),
        aspect,
        vfov: 35 * Math.PI / 180,
      };
      lastMainViewProjection = viewProjection;
    }
    gl.uniformMatrix4fv(program.viewProjection, false, viewProjection);

    // Main kit: identity model matrix and camera orbit.
    // Armband: fixed camera and the geometry rotates around its own centre.
    const modelMatrix = activeModel === "armband"
      ? armbandSelfRotationMatrix()
      : mat4Identity();
    gl.uniformMatrix4fv(program.model, false, modelMatrix);

    const primitiveGroups = activeModel === "armband"
      ? [armbandPrimitives]
      : [
          lowerPrimitives,
          useCollarNoModel && shirtNoPrimitives.length
            ? shirtNoPrimitives
            : shirtYesPrimitives,
        ];

    for (const visiblePrimitives of primitiveGroups) {
      for (const primitive of visiblePrimitives) {
        gl.bindBuffer(gl.ARRAY_BUFFER, primitive.positionBuffer);
        gl.enableVertexAttribArray(program.position);
        gl.vertexAttribPointer(program.position, 3, gl.FLOAT, false, 0, 0);

        if (program.normal >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, primitive.normalBuffer);
          gl.enableVertexAttribArray(program.normal);
          gl.vertexAttribPointer(program.normal, 3, gl.FLOAT, false, 0, 0);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, primitive.uvBuffer);
        gl.enableVertexAttribArray(program.uv);
        gl.vertexAttribPointer(program.uv, 2, gl.FLOAT, false, 0, 0);

        if (primitive.indexBuffer) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.indexBuffer);
          gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0);
        } else {
          gl.drawArrays(gl.TRIANGLES, 0, primitive.count);
        }
      }
    }

    renderNumbersFonts(viewProjection);
    refreshNumbersMeshCalibrationOverlay();
  }

  function resizeCanvasInternal() {
    const rect = canvas3d.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas3d.width !== width || canvas3d.height !== height) {
      canvas3d.width = width;
      canvas3d.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function cameraViewForBounds(targetBounds, margin = 1.08) {
    const rect = canvas3d?.getBoundingClientRect?.() || { width: 1, height: 1 };
    const aspect = Math.max(0.2, rect.width / Math.max(1, rect.height));
    const vfov = 35 * Math.PI / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov * 0.5) * aspect);
    const min = targetBounds?.min || bounds?.min || [-1, -1, -1];
    const max = targetBounds?.max || bounds?.max || [1, 1, 1];
    const target = [
      (min[0] + max[0]) * 0.5,
      (min[1] + max[1]) * 0.5,
      (min[2] + max[2]) * 0.5,
    ];
    const halfX = Math.max(0.02, (max[0] - min[0]) * 0.5);
    const halfY = Math.max(0.02, (max[1] - min[1]) * 0.5);
    const halfZ = Math.max(0.02, (max[2] - min[2]) * 0.5);
    // Horizontal radius keeps the focused piece inside the screen through a full 360° turn.
    const horizontalRadius = Math.hypot(halfX, halfZ);
    const fitVertical = halfY / Math.tan(vfov * 0.5);
    const fitHorizontal = horizontalRadius / Math.tan(hfov * 0.5);
    return {
      target,
      distance: Math.max(0.25, Math.max(fitVertical, fitHorizontal) * margin + horizontalRadius * 0.18),
    };
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function updateCameraTransition() {
    if (!cameraTransition) return;
    const elapsed = performance.now() - cameraTransition.startedAt;
    const raw = Math.max(0, Math.min(1, elapsed / cameraTransition.duration));
    const t = easeInOutCubic(raw);
    cameraTarget = [
      cameraTransition.fromTarget[0] + (cameraTransition.toTarget[0] - cameraTransition.fromTarget[0]) * t,
      cameraTransition.fromTarget[1] + (cameraTransition.toTarget[1] - cameraTransition.fromTarget[1]) * t,
      cameraTransition.fromTarget[2] + (cameraTransition.toTarget[2] - cameraTransition.fromTarget[2]) * t,
    ];
    distance = cameraTransition.fromDistance + (cameraTransition.toDistance - cameraTransition.fromDistance) * t;
    if (cameraTransition.resetYaw) {
      let delta = ((cameraTransition.toYaw - cameraTransition.fromYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      yaw = cameraTransition.fromYaw + delta * t;
    }
    if (raw >= 1) {
      cameraTarget = cameraTransition.toTarget.slice();
      distance = cameraTransition.toDistance;
      if (cameraTransition.resetYaw) yaw = cameraTransition.toYaw;
      cameraTransition = null;
    } else {
      requestRender();
    }
  }


  function setFocusButtonState(focus) {
    const buttons = { reset: resetBtn, shirt: shirtBtn, short: shortBtn, socks: socksBtn, armband: armbandBtn };
    for (const [name, button] of Object.entries(buttons)) {
      if (!button) continue;
      const active = name === focus;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function focusBoundsFor(name) {
    return name === "armband"
      ? armbandBounds
      : (focusBounds?.[name] || focusBounds?.reset || bounds);
  }

  function focusMarginFor(name) {
    return name === "reset" ? 1.10 :
      name === "armband" ? 1.38 :
      name === "short" ? 1.16 :
      1.06;
  }

  function calibratedViewForFocus(name) {
    const baseView = cameraViewForBounds(focusBoundsFor(name), focusMarginFor(name));
    const percent = FIXED_FOCUS_PERCENT[name] || 100;
    baseView.distance *= 100 / percent;
    return baseView;
  }

  function changeActiveModel(nextModel) {
    rotations[activeModel].yaw = yaw;
    rotations[activeModel].pitch = pitch;
    activeModel = nextModel;
    yaw = rotations[activeModel].yaw;
    pitch = rotations[activeModel].pitch;
    if (helpText) {
      helpText.textContent = activeModel === "armband"
        ? "Drag horizontally: the armband rotates 360° on its own axis"
        : "Drag horizontally to rotate 360° · Use the buttons to focus";
    }
  }

  function focusCamera(focus, resetYaw = false) {
    if (!initialized || !focusBounds) return;
    const nextModel = focus === "armband" ? "armband" : "main";

    if (focus === "armband") {
      // The camera never moves. The piece always starts at its approved 30° spin.
      rotations.armband.yaw = ARMBAND_CAMERA_YAW;
      rotations.armband.pitch = ARMBAND_CAMERA_PITCH;
      armbandSpin = ARMBAND_DEFAULT_SPIN;
    }

    if (nextModel !== activeModel) {
      changeActiveModel(nextModel);
    } else if (focus === "armband") {
      yaw = ARMBAND_CAMERA_YAW;
      pitch = ARMBAND_CAMERA_PITCH;
    }

    if (focus !== "armband") {
      pitch = 0;
      rotations.main.pitch = 0;
    }

    currentFocus = focus;
    const view = calibratedViewForFocus(focus);
    setFocusButtonState(focus);

    cameraTransition = {
      fromTarget: cameraTarget.slice(),
      toTarget: view.target,
      fromDistance: distance,
      toDistance: view.distance,
      fromYaw: yaw,
      toYaw: 0,
      resetYaw,
      startedAt: performance.now(),
      duration: focus === "armband" ? 420 : 320,
    };
    requestRender();
  }

  function togglePieceFocus(focus) {
    if (currentFocus === focus) {
      focusCamera("reset", true);
      return;
    }
    focusCamera(focus, false);
  }

  shirtBtn?.addEventListener("click", () => togglePieceFocus("shirt"));
  shortBtn?.addEventListener("click", () => togglePieceFocus("short"));
  socksBtn?.addEventListener("click", () => togglePieceFocus("socks"));
  armbandBtn?.addEventListener("click", () => togglePieceFocus("armband"));


  canvas3d.addEventListener("pointerdown", (event) => {
    if (!initialized || numbersMeshEditor.active) return;
    dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas3d.setPointerCapture?.(event.pointerId);
  });

  canvas3d.addEventListener("pointermove", (event) => {
    if (!dragging || numbersMeshEditor.active) return;
    const dx = event.clientX - lastPointerX;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    cameraTransition = null;

    if (activeModel === "armband") {
      // The camera stays completely fixed.
      // Only the armband turns horizontally around its own centre.
      armbandSpin = normalizeAngle(armbandSpin - dx * 0.009);
      yaw = ARMBAND_CAMERA_YAW;
      pitch = ARMBAND_CAMERA_PITCH;
      rotations.armband.yaw = ARMBAND_CAMERA_YAW;
      rotations.armband.pitch = ARMBAND_CAMERA_PITCH;
    } else {
      yaw -= dx * 0.009;
      pitch = 0;
      rotations.main.yaw = yaw;
      rotations.main.pitch = 0;
    }
    requestRender();
  });

  function stopDrag(event) {
    dragging = false;
    try { canvas3d.releasePointerCapture?.(event.pointerId); } catch (_) {}
  }
  canvas3d.addEventListener("pointerup", stopDrag);
  canvas3d.addEventListener("pointercancel", stopDrag);
  canvas3d.addEventListener("lostpointercapture", () => { dragging = false; });

  function blockWheelWhile3dIsActive(event) {
    if (!active3d) return;
    // The 2D editor owns a wheel listener on the parent canvas wrapper.
    // Stop the event here so scrolling over 3D can never modify the 2D zoom.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  stage3d.addEventListener("wheel", blockWheelWhile3dIsActive, {
    passive: false,
    capture: true,
  });

  window.addEventListener("kitlab:collar-render-ready", (event) => {
    if (!collarVisualCommitPending) return;
    const readyLabel = String(event?.detail?.name || "").trim();
    if (
      readyLabel &&
      normalizedCollarLabel(readyLabel) !== normalizedCollarLabel(pendingCollarLabel)
    ) {
      return;
    }
    if (collarCommitFallbackFrame) {
      cancelAnimationFrame(collarCommitFallbackFrame);
      collarCommitFallbackFrame = 0;
    }
    commitPendingCollarVisual();
  });

  window.addEventListener("kitlab:canvas-updated", () => {
    if (collarVisualCommitPending && initialized) {
      // selectCollarStyle emits a precise collar-ready event after this generic
      // canvas event. Keep one-frame fallback support for project/template paths
      // that render a collar without going through selectCollarStyle.
      if (!collarCommitFallbackFrame) {
        collarCommitFallbackFrame = requestAnimationFrame(() => {
          collarCommitFallbackFrame = 0;
          commitPendingCollarVisual();
        });
      }
      return;
    }

    textureDirty = true;
    textureDirtySince = performance.now();
    // Wait briefly for consecutive slider/render updates, then process only the final canvas.
    scheduleTextureRefresh(80);
  });
  window.addEventListener("resize", resizeCanvas, { passive: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(resizeCanvas).observe(stage3d);

  const NUMBERS_VERTEX_SHADER = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUv;
    uniform mat4 uViewProjection;
    uniform mat4 uModel;
    uniform float uDepthBias;
    uniform float uSurfaceOffset;
    varying vec2 vUv;
    void main() {
      vUv = aUv;
      vec3 safeNormal = normalize(aNormal);
      vec3 conformedPosition = aPosition + safeNormal * uSurfaceOffset;
      gl_Position = uViewProjection * uModel * vec4(conformedPosition, 1.0);
      gl_Position.z -= uDepthBias * gl_Position.w;
    }
  `;

  const NUMBERS_FRAGMENT_SHADER = `
    precision highp float;
    uniform sampler2D uTexture;
    varying vec2 vUv;
    void main() {
      vec4 textSample = texture2D(uTexture, vUv);
      if (textSample.a <= 0.01) discard;
      gl_FragColor = textSample;
    }
  `;

  const VERTEX_SHADER = `
    attribute vec3 aPosition;
    attribute vec2 aUv;
    uniform mat4 uViewProjection;
    uniform mat4 uModel;
    varying vec2 vUv;
    void main() {
      vUv = aUv;
      gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision highp float;
    uniform sampler2D uTexture;
    varying vec2 vUv;
    void main() {
      vec4 kitSample = texture2D(uTexture, vUv);

      // Preserve the real transparency mask from KitLab6.
      // Only genuinely empty pixels are removed. Antialiased alpha is passed
      // to alpha-to-coverage instead of being blended against a dark colour.
      if (kitSample.a <= 0.01) discard;
      float coverage = smoothstep(0.01, 0.35, kitSample.a);
      gl_FragColor = vec4(kitSample.rgb, coverage);
    }
  `;

  function mat4Identity() {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  }

  function mat4Scale(x, y, z) {
    return new Float32Array([
      x, 0, 0, 0,
      0, y, 0, 0,
      0, 0, z, 0,
      0, 0, 0, 1,
    ]);
  }

  function mat4Translation(x, y, z) {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ]);
  }

  function mat4RotationX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1,
    ]);
  }

  function armbandSelfRotationMatrix() {
    if (!armbandBounds) return mat4Identity();
    const center = [
      (armbandBounds.min[0] + armbandBounds.max[0]) * 0.5,
      (armbandBounds.min[1] + armbandBounds.max[1]) * 0.5,
      (armbandBounds.min[2] + armbandBounds.max[2]) * 0.5,
    ];
    const toOrigin = mat4Translation(-center[0], -center[1], -center[2]);
    const rotate = mat4RotationX(armbandSpin);
    const restore = mat4Translation(center[0], center[1], center[2]);
    return mat4Multiply(restore, mat4Multiply(rotate, toOrigin));
  }

  function mat4Perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }

  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length; zy /= length; zz /= length;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length; xy /= length; xz /= length;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1,
    ]);
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        out[column * 4 + row] =
          a[0 * 4 + row] * b[column * 4 + 0] +
          a[1 * 4 + row] * b[column * 4 + 1] +
          a[2 * 4 + row] * b[column * 4 + 2] +
          a[3 * 4 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }
})();

// KitLab6 Local 1.69: Front and Short two-digit PES6 numbers use wider fixed centres so repeated wide digits such as 44 remain clearly separated.

// KitLab6 Local 1.70: Short Left is lifted 0.008 along its own vertex normals so the complete PES6 number remains outside the shorts mesh without changing its size, spacing or UV placement.

// KitLab6 Local 1.71: the first Short digit is moved inward (centers 0.31 / 0.72) so wide pairs such as 44 remain complete without returning to the old joined spacing.

// KitLab6 Local 1.72: Front and Short digit 1/2 now have independent Size/X/Y texture controls. Protected cells and glyph-bound clamping keep each complete digit inside the exact receiver vertices while preserving a clear gap between both digits.

// KitLab6 Local 1.73: Back, Player Name, Front, Short Both, Short Left and Short Right now have persistent manual X/Y/Depth controls. Depth moves along each receiver's own normals and is clamped so negative values cannot push the geometry inside the 3D model. Front/Short digits retain independent Size/X/Y texture controls.

// KitLab6 Local 1.74: Number and Font receivers use independent Width and Height controls without proportional locking. Individual Front/Short digits also scale independently on each axis. Depth is an unrestricted numeric value with no inward/outward software clamp.

// KitLab6 Local 1.75 approved defaults:
// Back 109/95, X0, Y11, Depth0.
// Player Name 118/143, X0, Y-4, Depth-30.
// Front Digit 1 X9; Front Digit 2 X-9.
// Short Left 100/117, X13, Y-5, Depth-30.
// Short Right 100/117, X13, Y-5, Depth3.

// KitLab6 Local 1.76: Font position supports Top and Both. Both renders the same selected PES6 font atlas above and below the Back Number. Font Bottom has independent Width/Height/X/Y/Depth and manual mesh editing.

// KitLab6 Local 1.77: Font placement is mutually exclusive. Top shows only the upper rear font; Bottom shows only the lower rear font. The removed Font Both mode can no longer render both receivers simultaneously.

// KitLab6 Local 1.80: Font Bottom default is Width 118%, Height 143%, X 0, Y 0, Depth 0. Front now offers Top, TopRight and None. TopRight uses the exact KL_FRONT_NUMBER_SIDE UV receiver recovered from the original PES6 BIN.

// KitLab6 Local 1.82: Front TopRight vertex 2 is now connected by triangle 0-1-2; all receiver triangles use correct outward winding. Font Top resets to W105 H95 X0 Y-5 Depth-30 when upgrading from an older layout.

// KitLab6 Local 1.83: removed the erroneous overlapping Front TopRight triangle 9-4-0. The required 0-1-2 triangle remains, leaving one clean continuous 9-triangle receiver with no duplicate rear fragments.

// KitLab6 Local 1.84 approved Front TopRight defaults: Width 106%, Height 102%, X -4, Y 50, Depth -20.

// KitLab6 Local 1.85: the supplied Numbers/Fonts icon is placed below Armband
// and uses the same white/yellow size formula as Shirt, Short, Socks and Armband.
// Its active state is independent from camera focus buttons. While active,
// Numbers/Fonts remain visible and Config/Numbers/Font tabs remain available;
// pressing it again hides all Numbers/Fonts meshes and removes those tabs.


// KitLab6 Local 1.86: Adjust and Manual UV Mesh controls are removed from
// Config. The supplied Numbers and Fonts libraries are included by country.
// Country flags use an exact four-column grid. The Numbers/Fonts toolbar icon
// keeps the shared white/yellow formula with extra internal padding so its
// perceived size matches Shirt, Short, Socks and Armband.

// KitLab6 Local 1.87: Font Top is force-restored once to W105 H95 X0 Y-5 Depth-30, and any old saved Font Top mesh calibration is removed.

// KitLab6 Local 1.88: approved Numbers/Fonts transforms and mesh topology are
// immutable for every template and every Project kit. Numbers/Fonts selection,
// text, color, visibility and independent toolbar toggle are shared across all
// kits in the open Project, persist only when the Project is saved, and restore
// on reopening. Fresh unsaved sessions start with Font/Numbers at None.


// KitLab6 Local 1.90: Project tab is labeled Kits. Config uses one compact
// Font/Number/Color row. GDB Description and Model are editable (Model defaults
// to 33); Collar follows the active kit collar YES/NO; Name shape has type1/2/3;
// Name, Shirt and Short locations drive the existing locked 3D Font/Numbers
// renderers. Radar and Shorts colors initialize from the active Shirt/Short
// piece colors and use the shared KitLab palette. Geometry defaults remain locked.

// KitLab6 Local 1.91: GDB Config visual cleanup. Removed preview header, badges, bottom note and section icons; section titles are centered. New session defaults are KITLAB and number 6. Color chips use the exact same 32px height as their text fields.

// KitLab6 Local 1.92: Short location defaults to Left. Numbers shirt/short rows contain only their path fields. The main color swatch and all Extra Files X/ellipsis controls are locked to the same 32px height as Radar and Shorts color controls.

// KitLab6 Local 1.93: the quick Numbers/Fonts color no longer inherits the global palette swatch sizing. Quick inputs, the quick color, Radar/Shorts colors, Extra Files paths and their X/ellipsis controls all use one shared exact 32px row height. Extra Files controls are spans to prevent global button CSS from changing their size.

// KitLab6 Local 1.94: Numbers, Font and GDB Config are stored per kit. Home/Away/GK kits restore only their own PNG selections, text, number, locations, colors, Description, Model and Name shape. Switching kits keeps unsaved session data through app.js; Save Project persists every kit, while reopening without saving returns to the last saved Project state.

// KitLab6 Local 1.95: saved Projects can no longer restore stale hidden visibility flags, transforms or mesh calibration. Each kit still restores its own PNGs, text and GDB configuration, while Back, Font Top/Bottom, Front, TopRight and Short always use the approved locked defaults. Number and Font atlases are applied atomically and stale asynchronous loads from another kit are ignored.

// KitLab6 Local 1.96: Numbers/Fonts, Radar and Shorts color controls use a reliable picker. The existing shared KitLab palette is used when available; if it fails or is unavailable, an in-panel fallback palette opens immediately. Both the color square and the hexadecimal Radar/Shorts fields are clickable.

// KitLab6 Local 1.97: removed the temporary fallback palette. Numbers, Fonts, Radar and Shorts now open only the original shared KitLab color palette, with the same Photoshop-style controls and saved 14-color presets used by the left-side piece color system.

// KitLab6 Local 1.98: the original Photoshop-style KitLab palette no longer depends on app.js exposing the external picker API. If that API is unavailable or fails to render, kitlab3d.js creates the same full picker locally: SV canvas, Hue, RGB, HEX, eyedropper, Apply/Cancel and the same 14 saved presets.

// KitLab6 Local 1.99: app.js now stores Numbers, Font, color and GDB Config in a dedicated map keyed by Project kit id. Legacy duplicated global states are kept only on the active kit; each other kit starts empty and independent.

// KitLab6 Local 2.00: official Numbers/Fonts geometry is hard-coded at the final render level.
// Per-kit state stores only PNG selections, text, locations, color and GDB data.
// Switching kits, loading Projects/templates, inserting a new Number/Font, stale cache data,
// hidden controls and old mesh calibration can no longer alter the approved configuration.

// KitLab6 Local 2.01: Numbers and Fonts now use immutable PES6 atlas cells and canonical metrics. Selecting another kit or PNG cannot change the approved visual configuration.

// KitLab6 Local 2.02: fixed PES6 cells alone were not enough because the content inside each selected PNG was still alpha-cropped and re-centered. Every digit and letter now uses the immutable LaLiga-reference content bounds, while sampling the full PES6 cell. Therefore a second kit or a different asset cannot change the approved Size, X, Y, spacing or Depth.

// KitLab6 Local 2.04: definitive invariant configuration. Per-kit state contains no
// transforms or mesh calibration. Every asset glyph is normalized from its real alpha
// bounds inside a fixed PES6 cell into the immutable LaLiga-reference destination box.
// Therefore Number/Font artwork, transparent margins, kit switching, Project loading
// and legacy saved data cannot change the approved geometry or visual placement.

// KitLab6 Local 2.05: the Numbers & Fonts toggle and kit changes always stay on the Kits tab. Destination atlases are preloaded and Number + Font textures are committed together in one frame.

// KitLab6 Local 2.06: restored the exact atlas interpretation that was in use when the official configuration was approved. Official geometry is global and immutable: Back 109/95 X0 Y11 D0; Font Top 105/95 X0 Y-5 D-30; Font Bottom 118/143 X0 Y0 D0; Front TopRight 106/102 X-4 Y50 D-20; Short Left 100/117 X13 Y-5 D-30; Short Right 100/117 X13 Y-5 D3.

// KitLab6 Local 2.07: Width, Height, X, Y and unrestricted Depth controls are restored for every Numbers/Fonts receiver. The calibration profile is one universal profile shared by all kits and saved outside Project data. No kit can own a different geometry. Once the user approves every value, these values can be hard-coded and the controls hidden again.

// KitLab6 Local 2.08: first calibration from the supplied PES6 references. Back starts at W117 H112 X-11 Y10 D0. Back digit 1 and digit 2 now have independent Width/Height/X/Y controls, initially X+19 and X-9. Single digits stay centered. Font Top begins at W86 H144 X0 Y-20 D-30. The rest uses the last accepted baseline and remains manually adjustable.
