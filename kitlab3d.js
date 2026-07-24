(() => {
  "use strict";

  const MAIN_MODEL_URL = "./assets/3d/kitlab6_collar_yes_short.glb?v=1.3.289-collar-yes-no-atomic-first-test";
  const SHIRT_NO_MODEL_URL = "./assets/3d/shirt_collar_no.glb?v=1.3.289-collar-yes-no-atomic-first-test";
  const ARMBAND_MODEL_URL = "./assets/3d/kitlab6_armband.glb?v=1.3.289-collar-yes-no-atomic-first-test";
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

  function switchTo2d() {
    active3d = false;
    stage3d.hidden = true;
    canvasStage.hidden = false;
    setModeButtons("2d");
    setStatus("2D preview");
  }

  async function switchTo3d() {
    if (!hasActiveTemplate()) {
      sync3dAvailability();
      setStatus("Load a template before opening 3D");
      return;
    }
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
      // Every entry into 3D starts from Full with no piece icon selected.
      if (currentFocus !== "reset" || activeModel !== "main") {
        focusCamera("reset", true);
      } else {
        setFocusButtonState("reset");
      }
      setStatus("3D preview · drag horizontally to rotate 360°");
      requestRender();
    } catch (error) {
      console.error("KitLab6 3D initialization failed", error);
      showError("3D model could not be loaded");
    }
  }

  btn2d.addEventListener("click", switchTo2d);
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

  if (templateName) {
    new MutationObserver(sync3dAvailability).observe(templateName, { childList: true, subtree: true, characterData: true });
  }
  if (selectedCollarName) {
    new MutationObserver(syncCollarModelFromName).observe(selectedCollarName, {
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

    const [model, shirtNoModel, armbandModel] = await Promise.all([
      loadModel(MAIN_MODEL_URL),
      shirtNoPromise,
      loadModel(ARMBAND_MODEL_URL),
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
    shirtYesPrimitives = splitMain.upper.map((primitive) => createPrimitiveBuffers(gl, primitive));

    if (shirtNoModel) {
      alignStandaloneShirtToReferenceShirt(shirtNoModel, splitMain.upper);
      shirtNoPrimitives = shirtNoModel.primitives.map((primitive) => createPrimitiveBuffers(gl, primitive));
    }

    // Keep the independent piece above the shirt, outside the Full view.
    // The camera slides upward to this reserved inspection area only when requested.
    const armbandHalfHeight = Math.max(0.05, (armbandModel.bounds.max[1] - armbandModel.bounds.min[1]) * 0.5);
    const desiredArmbandCenterY = bounds.max[1] + armbandHalfHeight + 0.75;
    const currentArmbandCenterY = (armbandModel.bounds.min[1] + armbandModel.bounds.max[1]) * 0.5;
    translateModelData(armbandModel, [0, desiredArmbandCenterY - currentArmbandCenterY, 0]);
    armbandBounds = armbandModel.bounds;
    armbandPrimitives = armbandModel.primitives.map((primitive) => createPrimitiveBuffers(gl, primitive));

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
    return { positionBuffer, normalBuffer, uvBuffer, indexBuffer, indexType, count };
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
    };
  }


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
    if (!initialized) return;
    dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas3d.setPointerCapture?.(event.pointerId);
  });

  canvas3d.addEventListener("pointermove", (event) => {
    if (!dragging) return;
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
