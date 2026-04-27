import React, { useState, useRef, useEffect } from 'react';
import { FillContourSidebar } from './fill_contour';
import { QuadTransformSidebar } from './quad_transform';
import { Tooltip } from './tooltip';

export type Tool =
  | 'sharpen'
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'fill_min'
  | 'fill_max'
  | 'get_contours'
  | 'quad_transform'
  | 'cut_stretch';

export interface ContourPoint {
  x: number;
  y: number;
}

export interface Contour {
  id: number;
  points: ContourPoint[];
  area: number;
  boundingBox: [number, number, number, number];
}

export interface ContoursData {
  contours: Contour[];
  previewImg: string;
  originalImg: string;
}

export interface SavedState {
  history: string[];
  historyIndex: number;
}

export interface SelectedQuadPoint {
  contourId: number;
  pointIndex: number;
}

type ExportFormat = 'png' | 'jpg' | 'jpeg' | 'svg';

// API base URL – ưu tiên cấu hình từ Vite, fallback về localhost:8000
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const STORAGE_KEY = 'image-enhance-state';

const DEFAULT_SIMULATE_BLACK_THRESHOLD = 55;

/** Cắt ảnh theo hàng ngang tại yCut, chèn insertPx hàng (extrude từ mép dưới phần trên / mép trên phần dưới) */
function applyHorizontalCutStretch(
  imageData: ImageData,
  yCut: number,
  insertPx: number,
  fillMode: 'extrude' | 'solid',
  solidRgb: [number, number, number]
): ImageData {
  const W = imageData.width;
  const H = imageData.height;
  const d = imageData.data;
  const y = Math.max(1, Math.min(H - 1, Math.round(yCut)));
  const g = Math.max(0, Math.round(insertPx));
  if (g === 0) {
    return new ImageData(new Uint8ClampedArray(d), W, H);
  }
  const newH = H + g;
  const out = new ImageData(W, newH);
  const od = out.data;
  const refRow = y < H ? y : y - 1;

  for (let row = 0; row < y; row++) {
    for (let x = 0; x < W; x++) {
      const si = (row * W + x) * 4;
      const oi = (row * W + x) * 4;
      od[oi] = d[si];
      od[oi + 1] = d[si + 1];
      od[oi + 2] = d[si + 2];
      od[oi + 3] = d[si + 3];
    }
  }
  for (let r = 0; r < g; r++) {
    const yy = y + r;
    for (let x = 0; x < W; x++) {
      const oi = (yy * W + x) * 4;
      if (fillMode === 'extrude') {
        const si = (refRow * W + x) * 4;
        od[oi] = d[si];
        od[oi + 1] = d[si + 1];
        od[oi + 2] = d[si + 2];
        od[oi + 3] = d[si + 3];
      } else {
        od[oi] = solidRgb[0];
        od[oi + 1] = solidRgb[1];
        od[oi + 2] = solidRgb[2];
        od[oi + 3] = 255;
      }
    }
  }
  for (let row = y; row < H; row++) {
    const oy = row + g;
    for (let x = 0; x < W; x++) {
      const si = (row * W + x) * 4;
      const oi = (oy * W + x) * 4;
      od[oi] = d[si];
      od[oi + 1] = d[si + 1];
      od[oi + 2] = d[si + 2];
      od[oi + 3] = d[si + 3];
    }
  }
  return out;
}

/** Cắt ảnh theo cột dọc tại xCut, chèn insertPx cột */
function applyVerticalCutStretch(
  imageData: ImageData,
  xCut: number,
  insertPx: number,
  fillMode: 'extrude' | 'solid',
  solidRgb: [number, number, number]
): ImageData {
  const W = imageData.width;
  const H = imageData.height;
  const d = imageData.data;
  const x0 = Math.max(1, Math.min(W - 1, Math.round(xCut)));
  const g = Math.max(0, Math.round(insertPx));
  if (g === 0) {
    return new ImageData(new Uint8ClampedArray(d), W, H);
  }
  const newW = W + g;
  const out = new ImageData(newW, H);
  const od = out.data;
  const refCol = x0 < W ? x0 : x0 - 1;

  for (let row = 0; row < H; row++) {
    for (let x = 0; x < x0; x++) {
      const si = (row * W + x) * 4;
      const oi = (row * newW + x) * 4;
      od[oi] = d[si];
      od[oi + 1] = d[si + 1];
      od[oi + 2] = d[si + 2];
      od[oi + 3] = d[si + 3];
    }
  }
  for (let col = 0; col < g; col++) {
    const ox = x0 + col;
    for (let row = 0; row < H; row++) {
      const oi = (row * newW + ox) * 4;
      if (fillMode === 'extrude') {
        const si = (row * W + refCol) * 4;
        od[oi] = d[si];
        od[oi + 1] = d[si + 1];
        od[oi + 2] = d[si + 2];
        od[oi + 3] = d[si + 3];
      } else {
        od[oi] = solidRgb[0];
        od[oi + 1] = solidRgb[1];
        od[oi + 2] = solidRgb[2];
        od[oi + 3] = 255;
      }
    }
  }
  for (let row = 0; row < H; row++) {
    for (let x = x0; x < W; x++) {
      const si = (row * W + x) * 4;
      const oi = (row * newW + x + g) * 4;
      od[oi] = d[si];
      od[oi + 1] = d[si + 1];
      od[oi + 2] = d[si + 2];
      od[oi + 3] = d[si + 3];
    }
  }
  return out;
}

/** Hex #rrggbb → RGB */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace(/^#/, '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Thay pixel đen (RGB ≤ threshold) bằng màu vật liệu — dùng cho mô phỏng */
function fillBlackWithMaterialColor(
  src: string,
  hexColor: string,
  blackThreshold: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { r: tr, g: tg, b: tb } = hexToRgb(hexColor);
      const d = imageData.data;
      const t = blackThreshold;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (r <= t && g <= t && b <= t) {
          d[i] = tr;
          d[i + 1] = tg;
          d[i + 2] = tb;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Không load được ảnh'));
    img.src = src;
  });
}

/** Đối xứng quad: Ox = trục ngang (ảnh: lật trên-dưới, y' = H−y); Oy = trục dọc (trái-phải, x' = W−x); both = qua tâm ảnh */
export type QuadMirrorMode = 'ox' | 'oy' | 'both';

function contourCentroidFromPoints(points: ContourPoint[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const n = points.length;
  return { x: sx / n, y: sy / n };
}

function mirrorQuadPoint(
  p: { x: number; y: number },
  mode: QuadMirrorMode,
  W: number,
  H: number
): { x: number; y: number } {
  switch (mode) {
    case 'ox':
      return { x: p.x, y: H - p.y };
    case 'oy':
      return { x: W - p.x, y: p.y };
    case 'both':
      return { x: W - p.x, y: H - p.y };
    default:
      return { ...p };
  }
}

/**
 * Tìm contour có tâm (centroid) gần nhất với vị trí đối xứng của centroid contour nguồn.
 */
function findOppositeContourId(
  sourceId: number,
  mode: QuadMirrorMode,
  contours: Contour[],
  W: number,
  H: number,
  excludeIds: Set<number>
): number | null {
  const source = contours.find((c) => c.id === sourceId);
  if (!source || source.points.length < 1) return null;
  const c0 = contourCentroidFromPoints(source.points);
  const targetPt = mirrorQuadPoint(c0, mode, W, H);
  let bestId: number | null = null;
  let bestDist = Infinity;
  const maxDist = Math.min(W, H) * 0.65;
  const maxD2 = maxDist * maxDist;
  for (const c of contours) {
    if (c.id === sourceId || excludeIds.has(c.id)) continue;
    if (c.points.length < 1) continue;
    const cc = contourCentroidFromPoints(c.points);
    const d2 = (cc.x - targetPt.x) ** 2 + (cc.y - targetPt.y) ** 2;
    if (d2 < bestDist && d2 <= maxD2) {
      bestDist = d2;
      bestId = c.id;
    }
  }
  return bestId;
}

const FillImage = () => {
  // Load state from localStorage on mount
  const loadSavedState = (): SavedState | null => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading saved state:', error);
    }
    return null;
  };

  const savedState = loadSavedState();
  
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(savedState?.history || []);
  const [historyIndex, setHistoryIndex] = useState<number>(savedState?.historyIndex ?? -1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Contour states
  const [contoursData, setContoursData] = useState<ContoursData | null>(null);
  const [hoveredContourId, setHoveredContourId] = useState<number | null>(null);
  const [selectedContourIds, setSelectedContourIds] = useState<number[]>([]);
  const [fillColor, setFillColor] = useState<string>('#000000');
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [displayDimensions, setDisplayDimensions] = useState<{ width: number; height: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  
  // Quad transform states
  const [quadMode, setQuadMode] = useState<boolean>(false);
  const [selectedQuadContourIds, setSelectedQuadContourIds] = useState<number[]>([]);
  const [draggingContourId, setDraggingContourId] = useState<number | null>(null); // Contour đang kéo (point/edge)
  const [quadPoints, setQuadPoints] = useState<{ [contourId: number]: Array<{ x: number; y: number }> }>({});
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  const [hoveredQuadContourId, setHoveredQuadContourId] = useState<number | null>(null);
  const [hoveredEdgeIndex, setHoveredEdgeIndex] = useState<number | null>(null);
  const [addPointMode, setAddPointMode] = useState<boolean>(false); // Chế độ thêm điểm
  const [selectedQuadEdgeIndices, setSelectedQuadEdgeIndices] = useState<number[]>([]); // Cạnh đã chọn (quad mode)
  const [selectedQuadPoints, setSelectedQuadPoints] = useState<SelectedQuadPoint[]>([]); // Điểm đã chọn (đối xứng qua Ox/Oy)
  const [pointMoveMode, setPointMoveMode] = useState<'together' | 'symmetric'>('together'); // Cách di chuyển khi kéo nhiều điểm
  const [splineControlPointsByContour, setSplineControlPointsByContour] = useState<
    Record<number, Array<{ x: number; y: number }>>
  >({}); // Điểm điều khiển spline (kéo được sau khi vẽ)
  /** Phần đỉnh còn lại của polygon sau cung spline (để tái dựng khi kéo điểm điều khiển) */
  const [splineTailByContour, setSplineTailByContour] = useState<
    Record<number, Array<{ x: number; y: number }>>
  >({});
  const [draggingSplineControl, setDraggingSplineControl] = useState<{ contourId: number; index: number } | null>(
    null
  );
  const [pointSelectMode, setPointSelectMode] = useState<boolean>(false); // Chế độ chọn điểm (quad mode)
  const [draggingEdgeIndex, setDraggingEdgeIndex] = useState<number | null>(null);
  const [pendingEdgeDragIndex, setPendingEdgeDragIndex] = useState<number | null>(null);
  const edgeDragStartRef = useRef<{ mouseX: number; mouseY: number; p0: { x: number; y: number }; p1: { x: number; y: number } } | null>(null);
  const didEdgeDragRef = useRef(false);
  const pointDragLastCoordsRef = useRef<{ x: number; y: number } | null>(null);

  // Mô phỏng vật liệu xây dựng: lưới a x b
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportFilename, setExportFilename] = useState('image-enhance');
  const [simulateGrid, setSimulateGrid] = useState<{ a: number; b: number } | null>(null);
  const [simulateInputA, setSimulateInputA] = useState<string>('2');
  const [simulateInputB, setSimulateInputB] = useState<string>('2');
  const [simulateCroppedImage, setSimulateCroppedImage] = useState<string | null>(null); // Ảnh đã cắt bỏ border 5px
  /** Màu thay thế vùng đen (vật liệu) trong mô phỏng */
  const [simulateMaterialColor, setSimulateMaterialColor] = useState<string>('#8B4513');
  /** Ảnh đã áp dụng tô màu vật liệu (sau crop) — dùng cho lưới */
  const [simulatePaintedImage, setSimulatePaintedImage] = useState<string | null>(null);
  /** Sau Apply Quad: hỏi có áp dụng đối xứng sang contour đối diện không */
  const [mirrorApplyPrompt, setMirrorApplyPrompt] = useState<{
    newImage: string;
    sourceIds: number[];
    quadSnapshot: Record<number, Array<{ x: number; y: number }>>;
  } | null>(null);
  /** Modal đối xứng: tick Ox / Oy / Both (tâm ảnh) */
  const [mirrorTickOx, setMirrorTickOx] = useState(false);
  const [mirrorTickOy, setMirrorTickOy] = useState(false);
  const [mirrorTickBoth, setMirrorTickBoth] = useState(false);
  /** Cắt & kéo giãn ảnh theo đường ngang/dọc */
  const [cutStretchMode, setCutStretchMode] = useState(false);
  const [cutStretchDraft, setCutStretchDraft] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const cutStretchDragRef = useRef<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(
    null
  );
  /** Khi đã chọn đường cắt, kéo trực tiếp để thay đổi vị trí `pos` */
  const cutStretchMoveRef = useRef<{ kind: 'horizontal' | 'vertical' } | null>(null);
  const [cutStretchCut, setCutStretchCut] = useState<
    { kind: 'horizontal' | 'vertical'; pos: number } | null
  >(null);
  const [cutStretchInsertPx, setCutStretchInsertPx] = useState(40);
  const [cutStretchFillMode, setCutStretchFillMode] = useState<'extrude' | 'solid'>('extrude');
  const [cutStretchGapColor, setCutStretchGapColor] = useState('#3388ff');
  const BORDER_CROP_PX = 5;
  /** Phóng to / thu nhỏ ảnh chính (canvas giữa) */
  const CANVAS_ZOOM_MIN = 0.25;
  const CANVAS_ZOOM_MAX = 4;
  const clampCanvasZoom = (z: number) =>
    Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, z));
  const [canvasZoom, setCanvasZoom] = useState(1);

  // Computed values based on history
  const selectedImage = history.length > 0 ? history[0] : null;
  const currentImage = historyIndex >= 0 && historyIndex < history.length ? history[historyIndex] : null;
  const processedImage = historyIndex > 0 ? currentImage : null;

  // Khi mở mô phỏng: cắt border đen 5px trước khi hiển thị lưới
  useEffect(() => {
    if (!simulateGrid || !(currentImage || selectedImage)) return;
    cropBlackBorder(currentImage || selectedImage!, BORDER_CROP_PX)
      .then(setSimulateCroppedImage)
      .catch(() => setSimulateCroppedImage(currentImage || selectedImage));
  }, [simulateGrid, currentImage, selectedImage]);

  // Sau crop: tô toàn bộ vùng đen bằng màu vật liệu (canvas)
  useEffect(() => {
    if (!simulateGrid || !(currentImage || selectedImage)) {
      setSimulatePaintedImage(null);
      return;
    }
    const base = simulateCroppedImage || currentImage || selectedImage;
    if (!base) return;
    let cancelled = false;
    fillBlackWithMaterialColor(base, simulateMaterialColor, DEFAULT_SIMULATE_BLACK_THRESHOLD)
      .then((url) => {
        if (!cancelled) setSimulatePaintedImage(url);
      })
      .catch(() => {
        if (!cancelled) setSimulatePaintedImage(base);
      });
    return () => {
      cancelled = true;
    };
  }, [
    simulateGrid,
    simulateCroppedImage,
    currentImage,
    selectedImage,
    simulateMaterialColor,
  ]);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      const stateToSave: SavedState = {
        history,
        historyIndex,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('Error saving state:', error);
    }
  }, [history, historyIndex]);

  // Khi xóa hết lịch sử: dọn state contour / zoom (đồng bộ với không còn ảnh)
  useEffect(() => {
    if (history.length > 0) return;
    setCanvasZoom(1);
    setContoursData(null);
    setQuadMode(false);
    setSelectedQuadContourIds([]);
    setQuadPoints({});
    setSplineControlPointsByContour({});
    setSplineTailByContour({});
    setImageDimensions(null);
    setDisplayDimensions(null);
    setActiveTool(null);
    setCutStretchMode(false);
    setCutStretchCut(null);
    setCutStretchDraft(null);
    cutStretchDragRef.current = null;
    cutStretchMoveRef.current = null;
    // Reset input file để lần chọn file tiếp theo luôn bắn `onChange`
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setLoading(false);
  }, [history.length]);

  // Mở lại modal đối xứng: reset tick
  useEffect(() => {
    if (mirrorApplyPrompt) {
      setMirrorTickOx(false);
      setMirrorTickOy(false);
      setMirrorTickBoth(false);
    }
  }, [mirrorApplyPrompt]);

  // Cập nhật kích thước hiển thị (SVG overlay) khi zoom / đổi ảnh
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !imageDimensions) return;
    const r = img.getBoundingClientRect();
    setDisplayDimensions({ width: r.width, height: r.height });
  }, [canvasZoom, imageDimensions, currentImage, quadMode, contoursData, cutStretchMode]);

  /** Xóa một bản khỏi lịch sử (nút × trên thumbnail) */
  const removeHistoryAt = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setHistory((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setHistoryIndex((prevIdx) => {
        if (next.length === 0) return -1;
        if (prevIdx > index) return prevIdx - 1;
        if (prevIdx === index) return Math.min(index, next.length - 1);
        return prevIdx;
      });
      return next;
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLoading(true);
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        
        try {
          // Chuẩn hóa ảnh về binary ngay khi upload
          const response = await fetch(`${API_URL}/normalize_binary`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              img: base64String,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response:', errorText);
            throw new Error(`Lỗi khi chuẩn hóa ảnh: ${response.status}`);
          }

          const data = await response.json();
          if (!data.img) {
            throw new Error('Không nhận được ảnh từ server');
          }
          
          // Lưu ảnh đã chuẩn hóa vào history (ảnh gốc luôn ở index 0)
          setCanvasZoom(1);
          setHistory([data.img]);
          setHistoryIndex(0);
        } catch (error) {
          console.error('Error normalizing image:', error);
          // Nếu có lỗi, vẫn lưu ảnh gốc để có thể sử dụng
        setCanvasZoom(1);
        setHistory([base64String]);
        setHistoryIndex(0);
          // Chỉ hiển thị cảnh báo, không block việc mở ảnh
          console.warn('Sử dụng ảnh gốc do lỗi khi chuẩn hóa:', error);
        } finally {
          setLoading(false);
        }
      };
      reader.onerror = () => {
        console.error('Error reading file');
        setLoading(false);
        alert('Lỗi khi đọc file ảnh');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProcessImage = async (tool: Tool) => {
    if (!selectedImage) {
      alert('Vui lòng chọn ảnh trước!');
      return;
    }

    setCutStretchMode(false);
    setCutStretchCut(null);
    setCutStretchDraft(null);
    cutStretchDragRef.current = null;
    cutStretchMoveRef.current = null;

    // Nếu click vào tool khác khi đang có contours hoặc quad mode, clear
    if (contoursData || quadMode) {
      setContoursData(null);
      setActiveTool(null);
      setQuadMode(false);
      setSelectedQuadContourIds([]);
      setQuadPoints({});
      setSplineControlPointsByContour({});
      setSplineTailByContour({});
    }
    const workingImg = currentImage || selectedImage;
    setLoading(true);
    setActiveTool(tool);
    
    try {
      const response = await fetch(`${API_URL}/fill_img`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          img: workingImg,
          tool: tool,
        }),
      });

      if (!response.ok) {
        throw new Error('Lỗi khi xử lý ảnh');
      }

      const data = await response.json();
      // Thêm vào history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(data.img);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    } catch (error) {
      console.error('Error:', error);
      alert('Có lỗi xảy ra khi xử lý ảnh!');
    } finally {
      setLoading(false);
      // Tool cơ bản chạy xong thì bỏ trạng thái active để tránh giữ màu hover.
      setActiveTool(null);
    }
  };

  const handleExitCutStretch = () => {
    setCutStretchMode(false);
    setActiveTool(null);
    setCutStretchCut(null);
    setCutStretchDraft(null);
    cutStretchDragRef.current = null;
    cutStretchMoveRef.current = null;
  };

  const handleEnterCutStretch = () => {
    if (!selectedImage) {
      alert('Vui lòng chọn ảnh trước!');
      return;
    }
    if (contoursData || quadMode) {
      setContoursData(null);
      setQuadMode(false);
      setSelectedQuadContourIds([]);
      setQuadPoints({});
      setSelectedQuadEdgeIndices([]);
      setSelectedQuadPoints([]);
      setSplineControlPointsByContour({});
      setSplineTailByContour({});
      setSelectedContourIds([]);
    }
    setActiveTool('cut_stretch');
    setCutStretchMode(true);
    setCutStretchCut(null);
    setCutStretchDraft(null);
    cutStretchDragRef.current = null;
    cutStretchMoveRef.current = null;
  };

  const getCutStretchSvgCoords = (
    clientX: number,
    clientY: number,
    svgEl: SVGSVGElement
  ): { x: number; y: number } | null => {
    if (!imageDimensions) return null;
    const rect = svgEl.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * imageDimensions.width;
    const y = ((clientY - rect.top) / rect.height) * imageDimensions.height;
    return {
      x: Math.max(0, Math.min(imageDimensions.width, x)),
      y: Math.max(0, Math.min(imageDimensions.height, y)),
    };
  };

  const handleCutStretchMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!imageDimensions || loading) return;
    e.preventDefault();
    const svg = e.currentTarget;
    const p = getCutStretchSvgCoords(e.clientX, e.clientY, svg);
    if (!p) return;
    // Nếu đã có đường cắt: bấm gần đường thì kéo để di chuyển vị trí
    if (cutStretchCut) {
      const lineDist = cutStretchCut.kind === 'horizontal' ? Math.abs(p.y - cutStretchCut.pos) : Math.abs(p.x - cutStretchCut.pos);
      const lineStrokeW =
        cutStretchCut.kind === 'horizontal' ? Math.max(2, imageDimensions.width / 400) : Math.max(2, imageDimensions.height / 400);
      const hitRadius = lineStrokeW + 6; // Cho phép bấm hơi lệch để dễ kéo

      if (lineDist <= hitRadius) {
        const dims = imageDimensions;
        const movingKind = cutStretchCut.kind;
        cutStretchMoveRef.current = { kind: movingKind };
        setCutStretchDraft(null);
        cutStretchDragRef.current = null;

        const onMove = (ev: MouseEvent) => {
          if (!cutStretchMoveRef.current) return;
          const cur = getCutStretchSvgCoords(ev.clientX, ev.clientY, svg);
          if (!cur) return;

          if (movingKind === 'horizontal') {
            const clampedY = Math.max(1, Math.min(dims.height - 1, Math.round(cur.y)));
            setCutStretchCut((prev) => (prev ? { ...prev, pos: clampedY } : prev));
          } else {
            const clampedX = Math.max(1, Math.min(dims.width - 1, Math.round(cur.x)));
            setCutStretchCut((prev) => (prev ? { ...prev, pos: clampedX } : prev));
          }
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          cutStretchMoveRef.current = null;
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      }
    }

    // Nếu không bấm gần đường cắt: bắt đầu vẽ lại (draft) để xác định đường cắt mới
    setCutStretchCut(null);
    cutStretchDragRef.current = { start: p, current: p };
    setCutStretchDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });

    const dims = imageDimensions;
    const onMove = (ev: MouseEvent) => {
      const cur = getCutStretchSvgCoords(ev.clientX, ev.clientY, svg);
      if (!cur || !cutStretchDragRef.current) return;
      cutStretchDragRef.current.current = cur;
      setCutStretchDraft({
        x1: cutStretchDragRef.current.start.x,
        y1: cutStretchDragRef.current.start.y,
        x2: cur.x,
        y2: cur.y,
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const drag = cutStretchDragRef.current;
      cutStretchDragRef.current = null;
      setCutStretchDraft(null);
      if (!drag) return;
      const { start, current } = drag;
      const dx = Math.abs(current.x - start.x);
      const dy = Math.abs(current.y - start.y);
      if (dx < 4 && dy < 4) return;
      if (dx >= dy) {
        const yy = Math.round((start.y + current.y) / 2);
        const clampedY = Math.max(1, Math.min(dims.height - 1, yy));
        setCutStretchCut({ kind: 'horizontal', pos: clampedY });
      } else {
        const xx = Math.round((start.x + current.x) / 2);
        const clampedX = Math.max(1, Math.min(dims.width - 1, xx));
        setCutStretchCut({ kind: 'vertical', pos: clampedX });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleApplyCutStretch = () => {
    if (!cutStretchCut || !imageDimensions) {
      alert('Kéo một đường trên ảnh: gần ngang → cắt theo hàng; gần dọc → cắt theo cột.');
      return;
    }
    const src = currentImage || selectedImage;
    if (!src) return;
    const { r, g, b } = hexToRgb(cutStretchGapColor);
    const rgb: [number, number, number] = [r, g, b];
    setLoading(true);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setLoading(false);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const out =
          cutStretchCut.kind === 'horizontal'
            ? applyHorizontalCutStretch(
                imageData,
                cutStretchCut.pos,
                cutStretchInsertPx,
                cutStretchFillMode,
                rgb
              )
            : applyVerticalCutStretch(
                imageData,
                cutStretchCut.pos,
                cutStretchInsertPx,
                cutStretchFillMode,
                rgb
              );
        canvas.width = out.width;
        canvas.height = out.height;
        ctx.putImageData(out, 0, 0);
        const newUrl = canvas.toDataURL('image/png');
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newUrl);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setImageDimensions({ width: out.width, height: out.height });
        setCutStretchCut(null);
        setCutStretchDraft(null);
      } catch (e) {
        console.error(e);
        alert('Lỗi khi áp dụng cắt & kéo giãn.');
      } finally {
        setLoading(false);
      }
    };
    img.onerror = () => {
      setLoading(false);
      alert('Không đọc được ảnh.');
    };
    img.src = src;
  };

  // Get contours - giống như một tool bình thường (fill contour mode)
  const handleGetContours = async () => {
    if (!selectedImage) {
      alert('Vui lòng chọn ảnh trước!');
      return;
    }

    setCutStretchMode(false);
    setCutStretchCut(null);
    setCutStretchDraft(null);
    cutStretchDragRef.current = null;

    // Thoát quad mode nếu đang bật, để vào fill contour mode thuần
    if (quadMode) {
      setQuadMode(false);
      setSelectedQuadContourIds([]);
      setQuadPoints({});
      setSelectedQuadEdgeIndices([]);
      setSelectedQuadPoints([]);
      setSplineControlPointsByContour({});
      setSplineTailByContour({});
    }

    const workingImg = processedImage || selectedImage;

    setLoading(true);
    setActiveTool('get_contours');
    
    try {
      const response = await fetch(`${API_URL}/get_contours`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          img: workingImg,
        }),
      });

      if (!response.ok) {
        throw new Error('Lỗi khi lấy contours');
      }

      const data: ContoursData = await response.json();
      // Đảm bảo ảnh làm việc là ảnh hiện tại (processed hoặc original)
      setContoursData({
        ...data,
        originalImg: workingImg,
        previewImg: data.previewImg, // vẫn dùng preview vẽ sẵn
      });
      setHoveredContourId(null);
      setSelectedContourIds([]); // Reset selection
      
      // Get image dimensions
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.width, height: img.height });
        setDisplayDimensions({ width: img.width, height: img.height });
      };
      img.src = data.originalImg;
    } catch (error) {
      console.error('Error:', error);
      alert('Có lỗi xảy ra khi lấy contours!');
    } finally {
      setLoading(false);
    }
  };

  // Point-in-polygon (ray casting) - trả về true nếu (px, py) nằm trong đa giác
  const pointInPolygon = (px: number, py: number, points: ContourPoint[]): boolean => {
    if (points.length < 3) return false;
    let inside = false;
    const n = points.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  // Lấy contour tại tọa độ màn hình (clientX, clientY) trên SVG – trả về contour nhỏ nhất chứa điểm
  const getContourAtPoint = (clientX: number, clientY: number): Contour | null => {
    if (!contoursData || !imageDimensions) return null;
    const imgEl = imgRef.current;
    if (!imgEl) return null;

    // SVG overlay có thể lớn hơn ảnh thật (ảnh được căn giữa + giới hạn maxHeight/maxWidth),
    // vì vậy cần quy đổi tọa độ chuột theo bounding box của ảnh.
    const imgRect = imgEl.getBoundingClientRect();
    if (imgRect.width <= 0 || imgRect.height <= 0) return null;

    const nx = (clientX - imgRect.left) / imgRect.width;
    const ny = (clientY - imgRect.top) / imgRect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;

    const x = nx * imageDimensions.width;
    const y = ny * imageDimensions.height;

    const containing = contoursData.contours.filter((c) => pointInPolygon(x, y, c.points));
    if (containing.length === 0) return null;
    containing.sort((a, b) => a.area - b.area);
    return containing[0];
  };

  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!contoursData) return;
    // Trong quad transform mode: không chọn contour bằng click trên hình
    if (quadMode) return;
    const contour = getContourAtPoint(e.clientX, e.clientY);
    if (!contour) return;
    handleToggleContour(contour.id);
  };

  const handleContourCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!contoursData) return;
    const contour = getContourAtPoint(e.clientX, e.clientY);
    if (quadMode) setHoveredQuadContourId(contour?.id ?? null);
    else setHoveredContourId(contour?.id ?? null);
  };

  // Toggle select/deselect contour
  const handleToggleContour = (contourId: number) => {
    setSelectedContourIds(prev => {
      if (prev.includes(contourId)) {
        // Deselect
        return prev.filter(id => id !== contourId);
      } else {
        // Select
        return [...prev, contourId];
      }
    });
  };

  // Select all contours
  const handleSelectAll = () => {
    if (!contoursData) return;
    setSelectedContourIds(contoursData.contours.map(c => c.id));
  };

  // Deselect all
  const handleDeselectAll = () => {
    setSelectedContourIds([]);
  };

  // Fill tất cả contours đã chọn
  const handleFillSelectedContours = async () => {
    if (!contoursData || selectedContourIds.length === 0) {
      alert('Vui lòng chọn ít nhất một contour!');
      return;
    }

    setLoading(true);
    
    try {
      // Convert hex color to RGB
      const r = parseInt(fillColor.slice(1, 3), 16);
      const g = parseInt(fillColor.slice(3, 5), 16);
      const b = parseInt(fillColor.slice(5, 7), 16);

      // Fill từng contour một
      let currentImg = contoursData.originalImg;
      
      for (const contourId of selectedContourIds) {
        const response = await fetch(`${API_URL}/fill_contour`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            img: currentImg,
            contourId: contourId,
            contours: contoursData.contours,
            fillColor: [r, g, b],
          }),
        });

        if (!response.ok) {
          throw new Error('Lỗi khi fill contour');
        }

        const data = await response.json();
        currentImg = data.img; // Use result for next fill
      }

      // Thêm vào history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(currentImg);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      
      // Cập nhật ảnh đang làm việc để tiếp tục contour mode
      setContoursData(prev => prev ? {
        ...prev,
        originalImg: currentImg,
        previewImg: currentImg,
      } : prev);
      setSelectedContourIds([]);
    } catch (error) {
      console.error('Error:', error);
      alert('Có lỗi xảy ra khi fill contour!');
    } finally {
      setLoading(false);
    }
  };

  // Exit contour mode (fill contour)
  const handleExitContourMode = () => {
    setContoursData(null);
    setActiveTool(null);
    setSelectedContourIds([]);
    setQuadMode(false);
    setSelectedQuadContourIds([]);
    setQuadPoints({});
    setSelectedQuadEdgeIndices([]);
    setSelectedQuadPoints([]);
    setSplineControlPointsByContour({});
    setSplineTailByContour({});
  };

  // Exit quad transform mode – tách riêng, về panel Tools (không qua fill contour)
  const handleExitQuadMode = () => {
    setContoursData(null);
    setActiveTool(null);
    setQuadMode(false);
    setSelectedQuadContourIds([]);
    setQuadPoints({});
    setSelectedQuadEdgeIndices([]);
    setSelectedQuadPoints([]);
    setSplineControlPointsByContour({});
    setSplineTailByContour({});
    setDraggingSplineControl(null);
    setPointMoveMode('together');
    setDraggingPointIndex(null);
    setDraggingContourId(null);
    setHoveredQuadContourId(null);
    setAddPointMode(false);
    setDraggingEdgeIndex(null);
    setPendingEdgeDragIndex(null);
  };

  // Tìm điểm đối xứng qua trục Ox hoặc Oy (chọn điểm gần nhất với vị trí đối xứng)
  const findSymmetricPoints = (
    contourId: number,
    pointIndex: number,
    width: number,
    height: number
  ): Array<{ contourId: number; pointIndex: number }> => {
    const pts = quadPoints[contourId];
    if (!pts || pointIndex >= pts.length) return [{ contourId, pointIndex }];
    const { x, y } = pts[pointIndex];
    const symOY = { x: width - x, y };       // đối xứng qua trục Oy
    const symOX = { x, y: height - y };       // đối xứng qua trục Ox
    const result: Array<{ contourId: number; pointIndex: number }> = [{ contourId, pointIndex }];
    for (const cid of selectedQuadContourIds) {
      if (cid === contourId) continue;
      const arr = quadPoints[cid];
      if (!arr) continue;
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < arr.length; j++) {
        const p = arr[j];
        const dOY = Math.hypot(p.x - symOY.x, p.y - symOY.y);
        const dOX = Math.hypot(p.x - symOX.x, p.y - symOX.y);
        const d = Math.min(dOY, dOX);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) result.push({ contourId: cid, pointIndex: bestIdx });
    }
    return result;
  };

  const isPointInSelection = (contourId: number, pointIndex: number) =>
    selectedQuadPoints.some((s) => s.contourId === contourId && s.pointIndex === pointIndex);

  // Chọn/bỏ chọn điểm đối xứng qua Ox/Oy
  const toggleQuadPointSelection = (pointIndex: number, contourId: number) => {
    if (!imageDimensions) return;
    const { width, height } = imageDimensions;
    const symmetricGroup = findSymmetricPoints(contourId, pointIndex, width, height);
    const clickedIn = symmetricGroup.some((s) => isPointInSelection(s.contourId, s.pointIndex));
    setSelectedQuadPoints((prev) => {
      if (clickedIn) {
        const toRemove = new Set(symmetricGroup.map((s) => `${s.contourId}-${s.pointIndex}`));
        return prev.filter((p) => !toRemove.has(`${p.contourId}-${p.pointIndex}`));
      }
      return [...prev, ...symmetricGroup];
    });
  };

  // Chọn/bỏ chọn cạnh trong quad transform mode (khi không ở chế độ thêm điểm)
  const toggleQuadEdgeSelection = (edgeIndex: number) => {
    setSelectedQuadEdgeIndices((prev) =>
      prev.includes(edgeIndex) ? prev.filter((i) => i !== edgeIndex) : [...prev, edgeIndex]
    );
  };

  // Khi đổi contour được chọn trong quad mode thì xóa danh sách cạnh/điểm đã chọn
  useEffect(() => {
    if (quadMode) {
      setSelectedQuadEdgeIndices([]);
      setSelectedQuadPoints([]);
    }
  }, [quadMode, selectedQuadContourIds]);

  // Lấy mẫu các điểm trên Catmull-Rom spline để thay thế đoạn thẳng bằng đa giác bám theo spline
  const sampleSplinePoints = (
    points: Array<{ x: number; y: number }>,
    samplesPerSegment: number = 10
  ): Array<{ x: number; y: number }> => {
    if (points.length < 2) return points;
    const n = points.length;
    const extend = (i: number) =>
      i < 0
        ? { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y }
        : i >= n
          ? { x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y }
          : points[i];

    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = extend(i - 1);
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = extend(i + 2);

      // Thêm điểm đầu đoạn (tránh trùng lặp, chỉ thêm nếu là đoạn đầu)
      if (i === 0) out.push({ x: p1.x, y: p1.y });

      for (let s = 1; s <= samplesPerSegment; s++) {
        const t = s / samplesPerSegment;
        const t2 = t * t;
        const t3 = t2 * t;
        // Công thức Catmull-Rom (tension = 0.5), parametric
        const x =
          0.5 *
          ((2 * p1.x) +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y =
          0.5 *
          ((2 * p1.y) +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        out.push({ x, y });
      }
    }
    return out;
  };

  /** Cung đi theo chiều kim đồng hồ trên polygon: từ start đến end (gồm cả hai đầu) */
  const forwardArcInclusive = (start: number, end: number, n: number): number[] => {
    const path: number[] = [];
    let i = start;
    for (let k = 0; k <= n; k++) {
      path.push(i);
      if (i === end) break;
      i = (i + 1) % n;
    }
    return path;
  };

  /** Các đỉnh còn lại sau cung start→end (không gồm đỉnh nội suy của cung) */
  const verticesAfterArc = (arcEnd: number, arcStart: number, n: number): number[] => {
    const rest: number[] = [];
    let i = (arcEnd + 1) % n;
    while (i !== arcStart) {
      rest.push(i);
      i = (i + 1) % n;
    }
    return rest;
  };

  const handleSplineClick = () => {
    const contourId = selectedQuadContourIds[0];
    if (contourId === undefined || !quadPoints[contourId]) return;
    // Giữ thứ tự chọn (điểm giữa = đỉnh spline mong muốn)
    const orderedIndices: number[] = [];
    for (const s of selectedQuadPoints) {
      if (s.contourId === contourId && !orderedIndices.includes(s.pointIndex)) {
        orderedIndices.push(s.pointIndex);
      }
    }
    if (orderedIndices.length < 3) {
      alert('Chọn ít nhất 3 điểm để vẽ spline.');
      return;
    }
    const allPts = quadPoints[contourId];
    const n = allPts.length;
    const pts = orderedIndices.map((i) => allPts[i]);

    const i0 = orderedIndices[0];
    const i1 = orderedIndices[Math.floor(orderedIndices.length / 2)];
    const iLast = orderedIndices[orderedIndices.length - 1];

    // Catmull-Rom: đường cong đi qua tất cả các điểm theo thứ tự đã chọn (nội suy, không chỉ kéo hướng)
    const sampled = sampleSplinePoints(pts, pts.length <= 4 ? 16 : 12);

    // Tìm cung polygon từ i0 → iLast có chứa điểm giữa (và với n>3, mọi điểm đã chọn nằm trên cung)
    const arcA = forwardArcInclusive(i0, iLast, n);
    const arcB = forwardArcInclusive(iLast, i0, n);
    let arc: number[] | null = null;
    if (arcA.includes(i1) && arcA.length >= 2) {
      const ok =
        orderedIndices.length === 3 ||
        orderedIndices.every((idx) => arcA.includes(idx));
      if (ok) arc = arcA;
    }
    if (!arc && arcB.includes(i1) && arcB.length >= 2) {
      const ok =
        orderedIndices.length === 3 ||
        orderedIndices.every((idx) => arcB.includes(idx));
      if (ok) arc = arcB;
    }
    if (!arc) {
      alert(
        'Các điểm đã chọn không nằm liên tiếp trên viền contour. Hãy chọn các điểm theo một cạnh liên tục.'
      );
      return;
    }

    const arcStart = arc[0];
    const arcEnd = arc[arc.length - 1];

    const currentPts = allPts; // cùng tham chiếu với quadPoints[contourId] tại thời điểm click
    const restIdx = verticesAfterArc(arcEnd, arcStart, n);
    const tail = restIdx.map((j) => ({ ...currentPts[j] }));
    const newPoints = [...sampled, ...tail];

    // Chỉ gán sau khi validation OK — tránh UI chuyển sang spline nhưng không có tail/đa giác mới (kéo điểm bị hỏng)
    setSplineControlPointsByContour((prev) => ({
      ...prev,
      [contourId]: pts,
    }));
    setQuadPoints((prev) => ({
      ...prev,
      [contourId]: newPoints,
    }));
    setSplineTailByContour((prevTail) => ({ ...prevTail, [contourId]: tail }));

    setSelectedQuadPoints([]);
    setSelectedQuadEdgeIndices([]);
  };


  // Get quad points for contours - tự động lấy contours nếu chưa có (quad transform mode)
  const handleGetQuadPoints = async () => {
    if (!selectedImage) {
      alert('Vui lòng chọn ảnh trước!');
      return;
    }

    setCutStretchMode(false);
    setCutStretchCut(null);
    setCutStretchDraft(null);
    cutStretchDragRef.current = null;

    // Xóa trạng thái fill contour nếu có, để vào quad mode thuần
    setSelectedContourIds([]);

    setLoading(true);
    setActiveTool('quad_transform');
    
    try {
      // Sử dụng ảnh hiện tại đang được hiển thị (currentImage)
      const workingImg = currentImage || selectedImage;
      
      const response = await fetch(`${API_URL}/get_quad_points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          img: workingImg,
        }),
      });

      if (!response.ok) {
        throw new Error('Lỗi khi lấy quad points');
      }

      const data = await response.json();
      
      // Convert string keys to numbers
      const quadPointsMap: { [key: number]: Array<{ x: number; y: number }> } = {};
      for (const [key, value] of Object.entries(data.quadPoints)) {
        quadPointsMap[parseInt(key)] = value as Array<{ x: number; y: number }>;
      }
      
      // Cập nhật contours data nếu có
      if (data.contours) {
        const contoursData: ContoursData = {
          contours: (data.contours as Contour[]).map((c) => ({
            id: c.id,
            points: c.points.map((p) => ({ x: p.x, y: p.y })),
            area: c.area,
            boundingBox: c.boundingBox,
          })),
          previewImg: data.previewImg,
          originalImg: data.originalImg,
        };
        setContoursData(contoursData);
        
        // Get image dimensions
        const img = new Image();
        img.onload = () => {
          setImageDimensions({ width: img.width, height: img.height });
          setDisplayDimensions({ width: img.width, height: img.height });
        };
        img.src = data.originalImg;
      }
      
      setSplineControlPointsByContour({});
      setSplineTailByContour({});
      setQuadPoints(quadPointsMap);
      setQuadMode(true);
      const firstContourId = data.contours?.[0]?.id;
      setSelectedQuadContourIds(firstContourId !== undefined ? [firstContourId] : []);
    } catch (error) {
      console.error('Error:', error);
      alert('Có lỗi xảy ra khi lấy quad points!');
    } finally {
      setLoading(false);
    }
  };

  /** Reset polygon theo contour MỚI nhất (re-detect từ ảnh hiện tại) rồi fit Douglas-Peucker */
  const handleResetQuadToMinRect = async () => {
    if (selectedQuadContourIds.length === 0) {
      alert('Chọn ít nhất một contour trong danh sách để reset tứ giác.');
      return;
    }
    if (!currentImage && !selectedImage) {
      alert('Không có ảnh để reset.');
      return;
    }

    setLoading(true);
    try {
      const workingImg = currentImage || selectedImage;
      const refreshRes = await fetch(`${API_URL}/get_quad_points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ img: workingImg }),
      });
      if (!refreshRes.ok) {
        const errText = await refreshRes.text();
        throw new Error(errText || 'Không lấy được contour mới để reset.');
      }
      const freshData = await refreshRes.json();

      const freshContours: Contour[] = ((freshData.contours as Contour[] | undefined) ?? []).map((c) => ({
        id: c.id,
        points: c.points.map((p) => ({ x: p.x, y: p.y })),
        area: c.area,
        boundingBox: c.boundingBox,
      }));

      // Map contour cũ đã chọn -> contour mới gần nhất theo centroid
      const centroid = (pts: ContourPoint[]) => {
        const n = Math.max(pts.length, 1);
        const sx = pts.reduce((acc, p) => acc + p.x, 0);
        const sy = pts.reduce((acc, p) => acc + p.y, 0);
        return { x: sx / n, y: sy / n };
      };
      const freshCentroids = freshContours.map((c) => ({ id: c.id, c: centroid(c.points) }));

      const oldSelectedContours =
        contoursData?.contours.filter((c) => selectedQuadContourIds.includes(c.id)) ?? [];
      const mappedFreshIds = new Set<number>();

      for (const oldContour of oldSelectedContours) {
        const oldCenter = centroid(oldContour.points);
        let bestId: number | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const fc of freshCentroids) {
          const dx = fc.c.x - oldCenter.x;
          const dy = fc.c.y - oldCenter.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) {
            bestDist = d2;
            bestId = fc.id;
          }
        }
        if (bestId !== null) mappedFreshIds.add(bestId);
      }

      // Fallback: nếu chưa map được (không có contoursData cũ), dùng id hiện tại nếu tồn tại
      if (mappedFreshIds.size === 0) {
        for (const id of selectedQuadContourIds) {
          if (freshContours.some((c) => c.id === id)) mappedFreshIds.add(id);
        }
      }

      const updates: { [contourId: number]: Array<{ x: number; y: number }> } = {};
      for (const freshId of mappedFreshIds) {
        const poly = (freshData.quadPoints?.[String(freshId)] as Array<{ x: number; y: number }> | undefined) ?? [];
        if (poly.length >= 3) {
          updates[freshId] = poly.map((p) => ({ x: p.x, y: p.y }));
        }
      }

      if (Object.keys(updates).length === 0) {
        alert('Không có contour hợp lệ (cần ít nhất 3 đỉnh trên contour).');
        return;
      }

      // Cập nhật contour mới vào state trước, để thao tác tiếp theo bám contour mới.
      if (freshContours.length > 0) {
        setContoursData({
          contours: freshContours,
          previewImg: freshData.previewImg,
          originalImg: freshData.originalImg || workingImg,
        });
      }
      setSelectedQuadContourIds(Array.from(mappedFreshIds));
      setQuadPoints((prev) => ({ ...prev, ...updates }));

      setSplineControlPointsByContour((prev) => {
        const next = { ...prev };
        for (const cid of Object.keys(updates)) {
          delete next[Number(cid)];
        }
        return next;
      });
      setSplineTailByContour((prev) => {
        const next = { ...prev };
        for (const cid of Object.keys(updates)) {
          delete next[Number(cid)];
        }
        return next;
      });
      setSelectedQuadPoints([]);
      setSelectedQuadEdgeIndices([]);
    } catch (error) {
      console.error('Reset quad:', error);
      alert(
        error instanceof Error
          ? error.message
          : 'Không reset được tứ giác. Kiểm tra backend và thử lại.'
      );
    } finally {
      setLoading(false);
    }
  };

  // Apply perspective transform — chỉ các contour đang chọn trong danh sách Quad Transform
  const handleApplyTransform = async () => {
    if (!contoursData || Object.keys(quadPoints).length === 0) {
      alert('Vui lòng có ít nhất một contour với quad points!');
      return;
    }

    if (selectedQuadContourIds.length === 0) {
      alert('Vui lòng chọn ít nhất một contour trong danh sách (Quad Transform) để áp dụng!');
      return;
    }

    if (!currentImage && !selectedImage) {
      alert('Không có ảnh để transform!');
      return;
    }

    setLoading(true);
    
    try {
      // Sử dụng ảnh hiện tại đang được hiển thị (currentImage)
      const workingImg = currentImage || selectedImage;
      
      // Chỉ gửi quad points của các contour đã chọn (checkbox trong sidebar)
      const allQuadPoints: { [key: string]: Array<{ x: number; y: number }> } = {};
      for (const contourId of selectedQuadContourIds) {
        const points = quadPoints[contourId];
        if (points && points.length >= 3) {
          allQuadPoints[String(contourId)] = points;
        }
      }
      if (Object.keys(allQuadPoints).length === 0) {
        alert('Các contour đã chọn chưa có đủ quad points (ít nhất 3 điểm). Hãy chỉnh hoặc tải lại điểm.');
        setLoading(false);
        return;
      }
      
      const response = await fetch(`${API_URL}/perspective_transform`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          img: workingImg,
          contours: contoursData.contours,
          allQuadPoints: allQuadPoints,
        }),
      });

      if (!response.ok) {
        throw new Error('Lỗi khi transform ảnh');
      }

      const data = await response.json();
      
      // Thêm vào history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(data.img);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      
      // Cập nhật ảnh đang làm việc
      setContoursData(prev => prev ? {
        ...prev,
        originalImg: data.img,
        previewImg: data.img,
      } : prev);

      // Hỏi đối xứng sang contour đối diện (cần kích thước ảnh + ≥2 contour)
      if (
        imageDimensions &&
        contoursData.contours.length >= 2 &&
        selectedQuadContourIds.length > 0
      ) {
        const quadSnapshot: Record<number, Array<{ x: number; y: number }>> = {};
        for (const cid of selectedQuadContourIds) {
          const q = quadPoints[cid];
          if (q && q.length >= 3) {
            quadSnapshot[cid] = q.map((p) => ({ x: p.x, y: p.y }));
          }
        }
        if (Object.keys(quadSnapshot).length > 0) {
          setMirrorApplyPrompt({
            newImage: data.img,
            sourceIds: [...selectedQuadContourIds],
            quadSnapshot,
          });
        }
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Có lỗi xảy ra khi transform ảnh!');
    } finally {
      setLoading(false);
    }
  };

  /** Apply lần 2: tứ giác đối xứng cho contour “đối diện”, trên ảnh vừa Apply xong (có thể nhiều trục trong một lần) */
  const handleMirrorApplyFollowUp = async (modes: QuadMirrorMode[]) => {
    if (!mirrorApplyPrompt || !contoursData || !imageDimensions) {
      setMirrorApplyPrompt(null);
      return;
    }
    if (modes.length === 0) return;

    const { newImage, sourceIds, quadSnapshot } = mirrorApplyPrompt;
    const W = imageDimensions.width;
    const H = imageDimensions.height;
    const contours = contoursData.contours;

    const allQuadPoints: { [key: string]: Array<{ x: number; y: number }> } = {};
    const assignedTargets = new Set<number>();

    for (const mode of modes) {
      for (const cid of sourceIds) {
        const pts = quadSnapshot[cid];
        if (!pts || pts.length < 3) continue;
        const exclude = new Set<number>([...sourceIds, ...assignedTargets]);
        const targetId = findOppositeContourId(cid, mode, contours, W, H, exclude);
        if (targetId === null) continue;
        const mirrored = pts.map((p) => mirrorQuadPoint(p, mode, W, H));
        allQuadPoints[String(targetId)] = mirrored;
        assignedTargets.add(targetId);
      }
    }

    setMirrorApplyPrompt(null);

    if (Object.keys(allQuadPoints).length === 0) {
      alert(
        'Không tìm thấy contour đối diện phù hợp (centroid sau đối xứng phải gần centroid một contour khác trong khoảng cho phép).'
      );
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/perspective_transform`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          img: newImage,
          contours: contoursData.contours,
          allQuadPoints: allQuadPoints,
        }),
      });

      if (!response.ok) {
        throw new Error('Lỗi khi transform ảnh (đối xứng)');
      }

      const data = await response.json();

      // Nối tiếp ảnh vừa Apply (không cắt nhánh undo — modal mở ngay sau bước trước)
      setHistory((prev) => [...prev, data.img]);
      setHistoryIndex((prev) => prev + 1);

      setContoursData((prev) =>
        prev
          ? {
              ...prev,
              originalImg: data.img,
              previewImg: data.img,
            }
          : prev
      );

      setQuadPoints((prev) => {
        const next = { ...prev };
        for (const [key, pts] of Object.entries(allQuadPoints)) {
          next[Number(key)] = pts.map((p) => ({ x: p.x, y: p.y }));
        }
        return next;
      });

      setSplineControlPointsByContour((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(allQuadPoints)) {
          delete next[Number(key)];
        }
        return next;
      });
      setSplineTailByContour((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(allQuadPoints)) {
          delete next[Number(key)];
        }
        return next;
      });
    } catch (error) {
      console.error('Mirror apply:', error);
      alert('Có lỗi khi áp dụng chỉnh sửa đối xứng!');
    } finally {
      setLoading(false);
    }
  };

  /** Xác nhận đối xứng từ checkbox Ox / Oy / Both (độc lập; tick cả 3 = áp dụng Ox, Oy và tâm ảnh) */
  const handleMirrorApplyConfirm = () => {
    const modes: QuadMirrorMode[] = [];
    if (mirrorTickOx) modes.push('ox');
    if (mirrorTickOy) modes.push('oy');
    if (mirrorTickBoth) modes.push('both');
    if (modes.length === 0) return;
    void handleMirrorApplyFollowUp(modes);
  };

  // Handle mouse events for dragging points (hoặc chọn điểm khi pointSelectMode)
  const handleMouseDown = (e: React.MouseEvent<SVGCircleElement>, pointIndex: number, contourId: number) => {
    e.preventDefault();
    if (pointSelectMode) {
      e.stopPropagation();
      toggleQuadPointSelection(pointIndex, contourId);
      return;
    }
    setDraggingSplineControl(null);
    setDraggingPointIndex(pointIndex);
    setDraggingContourId(contourId);
  };

  /** Kéo điểm điều khiển spline sau khi đã vẽ spline */
  const handleSplineControlMouseDown = (
    e: React.MouseEvent<SVGCircleElement>,
    contourId: number,
    controlIndex: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (pointSelectMode) return;
    setDraggingSplineControl({ contourId, index: controlIndex });
    setDraggingPointIndex(null);
    setDraggingContourId(null);
    pointDragLastCoordsRef.current = null;
  };

  const getImageCoords = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (!imageDimensions) return null;
    const x = ((e.clientX - rect.left) / rect.width) * imageDimensions.width;
    const y = ((e.clientY - rect.top) / rect.height) * imageDimensions.height;
    const clampedX = Math.max(0, Math.min(x, imageDimensions.width));
    const clampedY = Math.max(0, Math.min(y, imageDimensions.height));
    return { x: clampedX, y: clampedY };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!imageDimensions || !displayDimensions) return;
    const coords = getImageCoords(e);
    if (!coords) return;

    // Kéo điểm điều khiển spline: tái tạo đa giác từ control + phần đuôi đã lưu
    if (draggingSplineControl !== null) {
      const { contourId, index } = draggingSplineControl;
      // tail có thể là [] khi spline thay thế cả contour — vẫn cho phép kéo
      const tail = splineTailByContour[contourId] ?? [];
      if (!pointDragLastCoordsRef.current) {
        pointDragLastCoordsRef.current = coords;
        return;
      }
      const dx = coords.x - pointDragLastCoordsRef.current.x;
      const dy = coords.y - pointDragLastCoordsRef.current.y;
      if (dx === 0 && dy === 0) return;
      const w = imageDimensions.width;
      const h = imageDimensions.height;
      const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));

      setSplineControlPointsByContour((prev) => {
        const ctrl = [...(prev[contourId] || [])];
        const p = ctrl[index];
        if (!p) return prev;
        ctrl[index] = { x: clamp(p.x + dx, w), y: clamp(p.y + dy, h) };
        const sampled = sampleSplinePoints(ctrl, ctrl.length <= 4 ? 16 : 12);
        setQuadPoints((q) => ({ ...q, [contourId]: [...sampled, ...tail] }));
        return { ...prev, [contourId]: ctrl };
      });
      pointDragLastCoordsRef.current = coords;
      return;
    }

    // Kéo điểm: áp dụng delta cho tất cả contour đã chọn (chỉnh 1 lúc)
    if (draggingPointIndex !== null && draggingContourId !== null && selectedQuadContourIds.length > 0) {
      if (!pointDragLastCoordsRef.current) {
        pointDragLastCoordsRef.current = coords;
        return;
      }
      const dx = coords.x - pointDragLastCoordsRef.current.x;
      const dy = coords.y - pointDragLastCoordsRef.current.y;
      if (dx === 0 && dy === 0) return;

      // Nếu đang có selection thì kéo toàn bộ nhóm đã chọn, bất kể click vào điểm nào
      const pointsToMove =
        selectedQuadPoints.length > 0
          ? selectedQuadPoints
          : [{ contourId: draggingContourId, pointIndex: draggingPointIndex }];

      const { width, height } = imageDimensions;
      const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
      setQuadPoints(prev => {
        const dragPts = prev[draggingContourId];
        const dragP = dragPts?.[draggingPointIndex];
        const isLeft = dragP ? dragP.x < width / 2 : true;
        const isTop = dragP ? dragP.y < height / 2 : true;

        // Gom thay đổi theo từng contour để không bị ghi đè khi có nhiều điểm cùng contour
        const updatedByContour: { [cid: number]: Array<{ x: number; y: number }> } = {};

        for (const { contourId: cid, pointIndex: idx } of pointsToMove) {
          const basePts = updatedByContour[cid] ?? prev[cid];
          if (!basePts || idx >= basePts.length) continue;

          const pts = updatedByContour[cid] ?? [...basePts];
          const p = pts[idx];

          let moveDx = dx;
          let moveDy = dy;
          if (pointsToMove.length > 1 && pointMoveMode === 'symmetric') {
            const sameSideX = (p.x < width / 2) === isLeft;
            const sameSideY = (p.y < height / 2) === isTop;
            moveDx = sameSideX ? dx : -dx;
            moveDy = sameSideY ? dy : -dy;
          }

          pts[idx] = {
            x: clamp(p.x + moveDx, width),
            y: clamp(p.y + moveDy, height),
          };

          updatedByContour[cid] = pts;
        }

        return { ...prev, ...updatedByContour };
      });
      pointDragLastCoordsRef.current = coords;
      return;
    }

    // Kéo cạnh: áp dụng delta cho tất cả contour đã chọn
    if (draggingEdgeIndex !== null && draggingContourId !== null && edgeDragStartRef.current && selectedQuadContourIds.length > 0) {
      const start = edgeDragStartRef.current;
      const dx = coords.x - start.mouseX;
      const dy = coords.y - start.mouseY;
      const p0 = { x: start.p0.x + dx, y: start.p0.y + dy };
      const p1 = { x: start.p1.x + dx, y: start.p1.y + dy };
      const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
      setQuadPoints(prev => {
        const next = { ...prev };
        for (const cid of selectedQuadContourIds) {
          const pts = prev[cid];
          if (!pts || draggingEdgeIndex >= pts.length) continue;
          const newPoints = [...pts];
          const n = newPoints.length;
          newPoints[draggingEdgeIndex] = { x: clamp(p0.x, imageDimensions.width), y: clamp(p0.y, imageDimensions.height) };
          newPoints[(draggingEdgeIndex + 1) % n] = { x: clamp(p1.x, imageDimensions.width), y: clamp(p1.y, imageDimensions.height) };
          next[cid] = newPoints;
        }
        return next;
      });
      return;
    }

    if (pendingEdgeDragIndex !== null && edgeDragStartRef.current) {
      const start = edgeDragStartRef.current;
      const dist = Math.hypot(coords.x - start.mouseX, coords.y - start.mouseY);
      if (dist > 5) {
        setDraggingEdgeIndex(pendingEdgeDragIndex);
        setPendingEdgeDragIndex(null);
        didEdgeDragRef.current = true;
      }
    }
  };

  const handleMouseUp = () => {
    if (draggingEdgeIndex !== null) {
      didEdgeDragRef.current = true;
      setDraggingEdgeIndex(null);
      edgeDragStartRef.current = null;
      setPendingEdgeDragIndex(null);
    } else if (pendingEdgeDragIndex !== null) {
      setPendingEdgeDragIndex(null);
      edgeDragStartRef.current = null;
    }
    setDraggingSplineControl(null);
    setDraggingPointIndex(null);
    setDraggingContourId(null);
    pointDragLastCoordsRef.current = null;
  };

  const handleEdgeMouseDown = (e: React.MouseEvent<SVGLineElement>, edgeIndex: number, contourId: number) => {
    if (addPointMode || !selectedQuadEdgeIndices.includes(edgeIndex)) return;
    const pts = quadPoints[contourId];
    if (!pts || !imageDimensions) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * imageDimensions.width;
    const mouseY = ((e.clientY - rect.top) / rect.height) * imageDimensions.height;
    const p0 = pts[edgeIndex];
    const p1 = pts[(edgeIndex + 1) % pts.length];
    setDraggingContourId(contourId);
    setPendingEdgeDragIndex(edgeIndex);
    edgeDragStartRef.current = { mouseX, mouseY, p0: { ...p0 }, p1: { ...p1 } };
  };

  // Click vào cạnh: addPointMode = thêm điểm, không thì toggle chọn cạnh (trừ khi vừa kéo cạnh)
  const handleEdgeClick = (e: React.MouseEvent<SVGLineElement>, edgeIndex: number, contourId: number) => {
    if (didEdgeDragRef.current) {
      didEdgeDragRef.current = false;
      return;
    }
    if (addPointMode) {
      const pts = quadPoints[contourId];
      if (!pts || !imageDimensions || !displayDimensions) return;
      const svg = e.currentTarget.ownerSVGElement;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * imageDimensions.width;
      const y = ((e.clientY - rect.top) / rect.height) * imageDimensions.height;
      const clampedX = Math.max(0, Math.min(x, imageDimensions.width));
      const clampedY = Math.max(0, Math.min(y, imageDimensions.height));
      setQuadPoints(prev => {
        const points = [...(prev[contourId] || [])];
        points.splice(edgeIndex + 1, 0, { x: clampedX, y: clampedY });
        return { ...prev, [contourId]: points };
      });
    } else {
      toggleQuadEdgeSelection(edgeIndex);
    }
  };

  // Tính toán điểm gần nhất trên cạnh khi hover
  // Xóa ảnh
  const handleClearImage = () => {
    setActiveTool(null);
    setCanvasZoom(1);
    setHistory([]);
    setHistoryIndex(-1);
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setContoursData(null);
    setHoveredContourId(null);
    setSelectedContourIds([]);
    setSplineTailByContour({});
    setDraggingSplineControl(null);
    // Xóa luôn localStorage
    localStorage.removeItem(STORAGE_KEY);
  };

  // Mở modal mô phỏng
  const handleOpenSimulate = () => setShowSimulateModal(true);
  const handleOpenExport = () => {
    if (!currentImage && !selectedImage) {
      alert('Vui lòng mở ảnh trước khi lưu.');
      return;
    }
    setShowExportModal(true);
  };

  const sanitizeFilename = (raw: string) => {
    const cleaned = raw
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return cleaned || 'image-enhance';
  };

  const triggerDownload = (href: string, filename: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const loadImageElement = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không thể đọc ảnh để xuất.'));
      img.src = src;
    });

  const exportRasterImage = async (src: string, format: Extract<ExportFormat, 'png' | 'jpg' | 'jpeg'>, filename: string) => {
    const img = await loadImageElement(src);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không khởi tạo được canvas để xuất ảnh.');

    if (format === 'jpg' || format === 'jpeg') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      triggerDownload(canvas.toDataURL('image/jpeg', 0.95), `${filename}.jpg`);
      return;
    }

    // PNG
    ctx.drawImage(img, 0, 0);
    triggerDownload(canvas.toDataURL('image/png'), `${filename}.png`);
  };

  const exportAsSvg = async (src: string, filename: string) => {
    let contoursForSvg: Contour[] | null = null;
    if (contoursData && contoursData.contours.length > 0 && contoursData.originalImg === src) {
      contoursForSvg = contoursData.contours;
    } else {
      const res = await fetch(`${API_URL}/get_contours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ img: src }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Không lấy được contour để xuất SVG.');
      }
      const data = (await res.json()) as ContoursData;
      contoursForSvg = data.contours;
    }

    const img = await loadImageElement(src);
    const W = img.width;
    const H = img.height;
    // Đổi polygon thô -> path đã lọc/simplify để tăng tương thích với editor vector.
    const makePathD = (pts: ContourPoint[]) => {
      if (pts.length < 3) return '';
      const cleaned: Array<{ x: number; y: number }> = [];
      for (const p of pts) {
        const x = Math.max(0, Math.min(W, Math.round(p.x)));
        const y = Math.max(0, Math.min(H, Math.round(p.y)));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const prev = cleaned[cleaned.length - 1];
        if (!prev || prev.x !== x || prev.y !== y) cleaned.push({ x, y });
      }
      if (cleaned.length < 3) return '';

      // Simplify nhẹ bằng lấy mẫu đều để tránh path quá nặng (Vectornator dễ fail với contour quá dày).
      const MAX_POINTS = 240;
      let sampled = cleaned;
      if (cleaned.length > MAX_POINTS) {
        sampled = [];
        for (let i = 0; i < MAX_POINTS; i++) {
          const idx = Math.round((i * (cleaned.length - 1)) / (MAX_POINTS - 1));
          sampled.push(cleaned[idx]);
        }
      }
      if (sampled.length < 3) return '';
      const first = sampled[0];
      const rest = sampled.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ');
      return `M ${first.x} ${first.y} ${rest} Z`;
    };

    const paths = (contoursForSvg ?? [])
      .map((c) => makePathD(c.points))
      .filter((d) => d.length > 0)
      .map((d) => `<path d="${d}" fill="#ffffff" stroke="none" />`)
      .join('\n');

    const svg = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
      `<rect x="0" y="0" width="${W}" height="${H}" fill="#000000" />`,
      paths,
      `</svg>`,
    ].join('\n');

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      triggerDownload(url, `${filename}.svg`);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const handleConfirmExport = async () => {
    const src = currentImage || selectedImage;
    if (!src) return;
    const filename = sanitizeFilename(exportFilename);
    setLoading(true);
    try {
      if (exportFormat === 'svg') {
        await exportAsSvg(src, filename);
      } else {
        await exportRasterImage(src, exportFormat, filename);
      }
      setShowExportModal(false);
    } catch (error) {
      console.error('Export error:', error);
      alert(error instanceof Error ? error.message : 'Không thể xuất file.');
    } finally {
      setLoading(false);
    }
  };

  // Xác nhận mô phỏng a x b
  const handleConfirmSimulate = () => {
    const a = parseInt(simulateInputA, 10);
    const b = parseInt(simulateInputB, 10);
    if (isNaN(a) || isNaN(b) || a < 1 || b < 1 || a > 20 || b > 20) {
      alert('Vui lòng nhập a và b từ 1 đến 20');
      return;
    }
    setSimulateGrid({ a, b });
    setShowSimulateModal(false);
    setSimulateCroppedImage(null); // Reset để useEffect tạo ảnh mới
  };

  // Đóng mô phỏng
  const handleCloseSimulate = () => {
    setSimulateGrid(null);
    setSimulateCroppedImage(null);
    setSimulatePaintedImage(null);
  };

  // Cắt bỏ border đen 5px ở mỗi cạnh trước khi mô phỏng (tránh khe hở giữa các ô)
  const cropBlackBorder = (src: string, px: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        if (w <= px * 2 || h <= px * 2) {
          resolve(src);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w - px * 2;
        canvas.height = h - px * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, px, px, w - px * 2, h - px * 2, 0, 0, w - px * 2, h - px * 2);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Không load được ảnh'));
      img.src = src;
    });
  };

  // Quay lại ảnh trước
  const handleGoBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
    }
  };

  // Tiến tới ảnh sau
  const handleGoForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
    }
  };

  interface ToolItem {
    id: Tool;
    name: string;
    icon: string;
    description: string;
    isSpecial?: boolean;
  }

  const tools: ToolItem[] = [
    { id: 'sharpen', name: 'Sharpen', icon: '◇', description: 'Làm sắc nét ảnh' },
    { id: 'blur', name: 'Blur', icon: '💧', description: 'Làm mờ ảnh' },
    { id: 'brightness', name: 'Brightness', icon: '☀', description: 'Điều chỉnh độ sáng' },
    { id: 'contrast', name: 'Contrast', icon: '◐', description: 'Điều chỉnh độ tương phản' },
    { id: 'saturation', name: 'Saturation', icon: '🎨', description: 'Điều chỉnh độ bão hòa màu' },
    { id: 'fill_min', name: 'Fill Min', icon: '⬇️', description: 'Đối xứng ảnh (min)' },
    { id: 'fill_max', name: 'Fill Max', icon: '⬆️', description: 'Đối xứng ảnh (max)' },
    { id: 'get_contours', name: 'Fill Contours', icon: '🎯', description: 'Tô màu contour đã chọn', isSpecial: true },
    { id: 'quad_transform', name: 'Quad Transform', icon: '⬜', description: 'Chỉnh sửa hình dạng contour', isSpecial: true },
    {
      id: 'cut_stretch',
      name: 'Cắt & kéo giãn',
      icon: '✂️',
      description: 'Vạch đường cắt rồi chèn khoảng (extrude / màu)',
      isSpecial: true,
    },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-[#2a2a2a] text-white overflow-hidden m-0 p-0">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1e1e1e] border-b border-[#3a3a3a] h-[50px] min-h-[50px] shrink-0">
        {/* Left buttons */}
        <div className="flex gap-1.5">
          <Tooltip label="Xóa ảnh và làm mới phiên (đặt lại lịch sử)" side="bottom">
            <button
              onClick={handleClearImage}
              disabled={!selectedImage}
              aria-label="Xóa ảnh"
              className={`w-8 h-8 bg-[#2a2a2a] rounded-md text-white text-sm flex items-center justify-center transition-colors ${
                selectedImage ? 'cursor-pointer hover:bg-red-600' : 'cursor-not-allowed opacity-50'
              }`}
            >
              ✕
            </button>
          </Tooltip>
          <Tooltip label="Hoàn tác về bản chỉnh sửa trước (Undo)" side="bottom">
            <button
              onClick={handleGoBack}
              disabled={historyIndex <= 0}
              aria-label="Hoàn tác (Undo)"
              className={`w-8 h-8 bg-[#2a2a2a] rounded-md text-white text-sm flex items-center justify-center transition-colors ${
                historyIndex > 0 ? 'cursor-pointer hover:bg-[#3a3a3a]' : 'cursor-not-allowed opacity-50'
              }`}
            >
              ‹
            </button>
          </Tooltip>
          <Tooltip label="Làm lại bản chỉnh sửa kế tiếp (Redo)" side="bottom">
            <button
              onClick={handleGoForward}
              disabled={historyIndex >= history.length - 1}
              aria-label="Làm lại (Redo)"
              className={`w-8 h-8 bg-[#2a2a2a] rounded-md text-white text-sm flex items-center justify-center transition-colors ${
                historyIndex < history.length - 1 ? 'cursor-pointer hover:bg-[#3a3a3a]' : 'cursor-not-allowed opacity-50'
              }`}
            >
              ›
            </button>
          </Tooltip>
        </div>

        {/* Center buttons */}
        <div className="flex gap-2.5">
          <Tooltip label="Mở ảnh từ máy (PNG/JPG); ảnh sẽ được chuẩn hóa nhị phân trước khi xử lý" side="bottom">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-1.5 bg-primary rounded-md text-white cursor-pointer text-sm font-medium transition-all hover:bg-[#5558dd]"
            >
              📁 OPEN
            </button>
          </Tooltip>
          <Tooltip label="Bảng công cụ xử lý ảnh đang ở sidebar bên phải" side="bottom">
            <button
              className={`px-3.5 py-1.5 rounded-md text-white cursor-pointer text-sm font-medium transition-all ${
                activeTool ? 'bg-secondary hover:bg-[#4aa8cc]' : 'bg-[#4a4a4a] hover:bg-[#5a5a5a]'
              }`}
            >
              🛠 TOOLS
            </button>
          </Tooltip>
        </div>

        {/* Right buttons */}
        <div className="flex gap-2">
          <Tooltip
            label="Mô phỏng vật liệu lưới a × b: tô vùng đen bằng màu vật liệu rồi xem trước"
            side="bottom"
          >
            <button
              onClick={handleOpenSimulate}
              disabled={!selectedImage}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                selectedImage ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer' : 'bg-[#2a2a2a] opacity-50 cursor-not-allowed text-white'
              }`}
            >
              📐 Mô phỏng
            </button>
          </Tooltip>
          <Tooltip label="Lưu ảnh đã chỉnh sửa: PNG, JPG/JPEG hoặc SVG" side="bottom">
            <button
              type="button"
              aria-label="Lưu"
              onClick={handleOpenExport}
              disabled={!selectedImage || loading}
              className={`w-8 h-8 rounded-md text-white text-sm flex items-center justify-center transition-colors ${
                selectedImage && !loading
                  ? 'bg-[#2a2a2a] cursor-pointer hover:bg-[#3a3a3a]'
                  : 'bg-[#2a2a2a] opacity-50 cursor-not-allowed'
              }`}
            >
              💾
            </button>
          </Tooltip>
          <Tooltip label="Tùy chọn khác" side="bottom">
            <button
              type="button"
              aria-label="Tùy chọn"
              className="w-8 h-8 bg-[#2a2a2a] rounded-md text-white cursor-pointer text-sm flex items-center justify-center hover:bg-[#3a3a3a] transition-colors"
            >
              ⋯
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Modal nhập a x b cho mô phỏng */}
      {showSimulateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowSimulateModal(false)}>
          <div
            className="bg-[#2a2a2a] rounded-lg p-6 shadow-xl border border-[#3a3a3a] min-w-[280px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4 text-white">Mô phỏng vật liệu a × b</h3>
            <p className="text-sm text-[#aaa] mb-4">Nhập số lượng ảnh theo 2 chiều (1–20). Vùng đen trên ảnh sẽ được tô bằng màu vật liệu bạn chọn.</p>
            <div className="mb-5 rounded-lg border border-[#3a3a3a] bg-[#1e1e1e] p-3">
              <label className="mb-2 block text-xs font-medium text-[#ccc]">🎨 Màu vật liệu (tô vùng đen)</label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="color"
                  value={simulateMaterialColor}
                  onChange={(e) => setSimulateMaterialColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border border-[#555] bg-transparent p-0"
                  title="Chọn màu"
                />
                <span className="font-mono text-xs text-[#aaa]">{simulateMaterialColor}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[
                  { label: 'Gạch', hex: '#A52A2A' },
                  { label: 'Xi măng', hex: '#B8B8B8' },
                  { label: 'Đá', hex: '#708090' },
                  { label: 'Gỗ', hex: '#8B4513' },
                  { label: 'Ngói', hex: '#B22222' },
                  { label: 'Đen gốc', hex: '#1a1a1a' },
                ].map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    onClick={() => setSimulateMaterialColor(p.hex)}
                    className="rounded border border-[#444] px-2 py-0.5 text-[10px] text-[#ccc] hover:bg-[#3a3a3a]"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-4 mb-5">
              <div>
                <label className="block text-xs text-[#aaa] mb-1">Số cột (a)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={simulateInputA}
                  onChange={(e) => setSimulateInputA(e.target.value)}
                  className="w-20 px-3 py-2 bg-[#1e1e1e] border border-[#3a3a3a] rounded text-white text-center"
                />
              </div>
              <div>
                <label className="block text-xs text-[#aaa] mb-1">Số hàng (b)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={simulateInputB}
                  onChange={(e) => setSimulateInputB(e.target.value)}
                  className="w-20 px-3 py-2 bg-[#1e1e1e] border border-[#3a3a3a] rounded text-white text-center"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowSimulateModal(false)}
                className="px-4 py-2 bg-[#3a3a3a] rounded text-sm hover:bg-[#4a4a4a] transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmSimulate}
                className="px-4 py-2 bg-amber-600 rounded text-sm font-medium hover:bg-amber-700 transition-colors"
              >
                Xem
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal lưu ảnh */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => !loading && setShowExportModal(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-semibold text-white">Lưu ảnh đã chỉnh sửa</h3>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-[#aaa]">Tên file</label>
              <input
                type="text"
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                className="w-full rounded border border-[#3a3a3a] bg-[#1e1e1e] px-3 py-2 text-sm text-white"
                placeholder="image-enhance"
              />
            </div>

            <div className="mb-4 rounded border border-[#3a3a3a] bg-[#1e1e1e] p-3">
              <div className="mb-2 text-xs font-medium text-[#aaa]">Định dạng xuất</div>
              <div className="space-y-2 text-sm text-[#ddd]">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="exportFormat"
                    checked={exportFormat === 'png'}
                    onChange={() => setExportFormat('png')}
                  />
                  PNG (raster, không mất dữ liệu)
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="exportFormat"
                    checked={exportFormat === 'jpg' || exportFormat === 'jpeg'}
                    onChange={() => setExportFormat('jpg')}
                  />
                  JPG / JPEG (raster, dung lượng nhỏ)
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="exportFormat"
                    checked={exportFormat === 'svg'}
                    onChange={() => setExportFormat('svg')}
                  />
                  SVG (vector từ contour hiện tại)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                disabled={loading}
                className="rounded bg-[#3a3a3a] px-4 py-2 text-sm text-white hover:bg-[#4a4a4a] disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExport()}
                disabled={loading || !selectedImage}
                className="rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
              >
                {loading ? '⏳ Đang xuất...' : 'Tải xuống'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: sau Apply Quad — hỏi đối xứng sang contour đối diện */}
      {mirrorApplyPrompt && (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/75 p-4"
          onClick={() => !loading && setMirrorApplyPrompt(null)}
        >
          <div
            className="max-w-md rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-white">
              Áp dụng tương tự cho contour đối xứng?
            </h3>
            <p className="mb-3 text-sm leading-relaxed text-[#aaa]">
              Mỗi điểm tứ giác đã chỉnh sẽ được đối xứng theo trục bạn chọn, rồi gán cho contour có{' '}
              <strong className="text-cyan-300">tâm (centroid)</strong> gần nhất với vị trí đối xứng đó.
            </p>
            <ul className="mb-3 list-inside list-disc text-xs text-[#888]">
              <li>
                <strong className="text-[#ccc]">Ox</strong> (trục ngang): lật trên-dưới —{' '}
                <code className="text-[#aaa]">y&apos; = H − y</code>
              </li>
              <li>
                <strong className="text-[#ccc]">Oy</strong> (trục dọc): lật trái-phải —{' '}
                <code className="text-[#aaa]">x&apos; = W − x</code>
              </li>
              <li>
                <strong className="text-[#ccc]">Both</strong> (tâm ảnh): đối xứng qua tâm —{' '}
                <code className="text-[#aaa]">(x&apos;, y&apos;) = (W − x, H − y)</code>
                {' '}
                <span className="text-[#666]">(khác với tick riêng Ox và Oy)</span>
              </li>
            </ul>
            <div className="mb-4 space-y-3 rounded-lg border border-[#3a3a3a] bg-[#1e1e1e] p-3">
              <span className="mb-1 block text-xs font-medium text-[#ccc]">Chọn trục đối xứng:</span>
              <label className="flex cursor-pointer items-center gap-3 text-sm text-white hover:text-cyan-200">
                <input
                  type="checkbox"
                  checked={mirrorTickOx}
                  onChange={(e) => setMirrorTickOx(e.target.checked)}
                  disabled={loading}
                  className="h-4 w-4 rounded border-[#555] bg-[#2a2a2a] accent-cyan-500"
                />
                <span>
                  Đối xứng qua <strong>Ox</strong> (trục ngang)
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 text-sm text-white hover:text-cyan-200">
                <input
                  type="checkbox"
                  checked={mirrorTickOy}
                  onChange={(e) => setMirrorTickOy(e.target.checked)}
                  disabled={loading}
                  className="h-4 w-4 rounded border-[#555] bg-[#2a2a2a] accent-cyan-500"
                />
                <span>
                  Đối xứng qua <strong>Oy</strong> (trục dọc)
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-white hover:text-amber-200/90">
                <input
                  type="checkbox"
                  checked={mirrorTickBoth}
                  onChange={(e) => setMirrorTickBoth(e.target.checked)}
                  disabled={loading}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#555] bg-[#2a2a2a] accent-amber-500"
                />
                <span>
                  <strong className="text-amber-200/95">Both</strong> — đối xứng qua <strong>Ox và Oy</strong> (tâm ảnh){' '}
                  <code className="block text-xs text-[#888] mt-1">(x&apos;, y&apos;) = (W − x, H − y)</code>
                </span>
              </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={loading}
                onClick={() => setMirrorApplyPrompt(null)}
                className="order-2 rounded border border-[#555] px-4 py-2 text-sm text-[#ccc] hover:bg-[#3a3a3a] disabled:opacity-50 sm:order-1"
              >
                Không
              </button>
              <button
                type="button"
                disabled={loading || (!mirrorTickOx && !mirrorTickOy && !mirrorTickBoth)}
                onClick={() => void handleMirrorApplyConfirm()}
                className="order-1 rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Lịch sử ảnh — click để xem lại bản đã lưu (cùng stack với Undo/Redo) */}
        {history.length > 0 && (
          <aside
            className="w-[168px] min-w-[168px] shrink-0 flex flex-col min-h-0 bg-[#1e1e1e] border-r border-[#3a3a3a]"
            aria-label="Lịch sử chỉnh sửa"
          >
            <div className="px-2 py-2 border-b border-[#3a3a3a] text-[11px] font-semibold text-[#aaa]">
              📜 Lịch sử
              <span className="block text-[10px] font-normal text-[#666] mt-0.5">
                {history.length} bản · đang xem:{' '}
                {historyIndex === 0 ? 'gốc' : `#${historyIndex}`}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
              {history.map((src, index) => (
                <div
                  key={`history-thumb-${index}`}
                  className={`relative rounded-lg border-2 transition-all ${
                    historyIndex === index
                      ? 'border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.4)]'
                      : 'border-transparent hover:border-[#555] opacity-90 hover:opacity-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setHistoryIndex(index)}
                    title={
                      index === 0
                        ? 'Ảnh gốc (bản đầu tiên)'
                        : `Bản chỉnh sửa thứ ${index} — click để xem`
                    }
                    className="w-full overflow-hidden rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5558dd]"
                  >
                    <img
                      src={src}
                      alt=""
                      className="w-full h-[80px] object-cover bg-[#2a2a2a] pointer-events-none select-none"
                      draggable={false}
                    />
                    <div
                      className={`text-[10px] py-1 px-1 text-center truncate ${
                        historyIndex === index ? 'text-blue-300 bg-[#1a2332]' : 'text-[#888] bg-[#252525]'
                      }`}
                    >
                      {index === 0 ? 'Gốc' : `Bản ${index}`}
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label="Xóa khỏi lịch sử"
                    title="Xóa khỏi lịch sử"
                    onClick={(e) => removeHistoryAt(index, e)}
                    className="absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-[13px] font-bold leading-none text-white shadow hover:bg-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* Canvas Area */}
        <div 
          className="flex-1 flex items-center justify-center p-2.5 bg-[#333] overflow-auto min-h-0 min-w-0 relative"
          style={{
            backgroundImage: 'repeating-linear-gradient(45deg, #2a2a2a 0, #2a2a2a 10px, #333 10px, #333 20px)'
          }}
        >
          {/* Phóng to / thu nhỏ ảnh chính */}
          {(processedImage || selectedImage) && !simulateGrid && (
            <div className="absolute top-2 right-2 z-30 flex flex-wrap items-center justify-end gap-1 rounded-lg border border-[#3a3a3a] bg-[#1e1e1e]/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
              <Tooltip label="Thu nhỏ vùng xem (−20%)" side="bottom">
                <button
                  type="button"
                  aria-label="Thu nhỏ"
                  onClick={() => setCanvasZoom((z) => clampCanvasZoom(z / 1.2))}
                  className="flex h-7 w-7 items-center justify-center rounded bg-[#2a2a2a] text-lg font-semibold text-white hover:bg-[#3a3a3a]"
                >
                  −
                </button>
              </Tooltip>
              <span className="min-w-[3rem] text-center text-[11px] font-mono text-[#ccc]">
                {Math.round(canvasZoom * 100)}%
              </span>
              <Tooltip label="Phóng to vùng xem (+20%)" side="bottom">
                <button
                  type="button"
                  aria-label="Phóng to"
                  onClick={() => setCanvasZoom((z) => clampCanvasZoom(z * 1.2))}
                  className="flex h-7 w-7 items-center justify-center rounded bg-[#2a2a2a] text-lg font-semibold text-white hover:bg-[#3a3a3a]"
                >
                  +
                </button>
              </Tooltip>
              <Tooltip label="Đặt lại mức zoom về 100%" side="bottom">
                <button
                  type="button"
                  aria-label="Đặt lại zoom"
                  onClick={() => setCanvasZoom(1)}
                  className="rounded bg-[#2a2a2a] px-2 py-1 text-[10px] font-medium text-[#aaa] hover:bg-[#3a3a3a] hover:text-white"
                >
                  Reset
                </button>
              </Tooltip>
            </div>
          )}

          {/* Overlay mô phỏng lưới a x b */}
          {simulateGrid && selectedImage && (
            <div className="absolute inset-0 z-40 flex flex-col bg-[#1a1a1a]">
              <div className="flex flex-wrap items-center gap-3 border-b border-[#3a3a3a] bg-[#2a2a2a] px-4 py-2 shrink-0">
                <span className="text-sm text-white">
                  Mô phỏng {simulateGrid.a} × {simulateGrid.b} ({simulateGrid.a * simulateGrid.b} ô)
                </span>
                <div className="mx-auto flex flex-wrap items-center gap-2 sm:mx-0">
                  <span className="text-xs text-[#aaa]">Màu vật liệu:</span>
                  <input
                    type="color"
                    value={simulateMaterialColor}
                    onChange={(e) => setSimulateMaterialColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-[#555] bg-transparent p-0"
                    title="Tô toàn bộ vùng đen bằng màu này"
                  />
                  <span className="font-mono text-[11px] text-[#888]">{simulateMaterialColor}</span>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { label: 'Gạch', hex: '#A52A2A' },
                      { label: 'Xi măng', hex: '#B8B8B8' },
                      { label: 'Đá', hex: '#708090' },
                      { label: 'Gỗ', hex: '#8B4513' },
                    ].map((p) => (
                      <button
                        key={p.hex}
                        type="button"
                        onClick={() => setSimulateMaterialColor(p.hex)}
                        className="rounded border border-[#444] px-1.5 py-0.5 text-[10px] text-[#ccc] hover:bg-[#3a3a3a]"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleCloseSimulate}
                  className="ml-auto shrink-0 px-3 py-1.5 bg-red-600 rounded text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  Đóng
                </button>
              </div>
              <p className="border-b border-[#3a3a3a] bg-[#252525] px-4 py-1.5 text-[11px] text-[#999]">
                Các pixel đen (RGB ≤ {DEFAULT_SIMULATE_BLACK_THRESHOLD}) được thay bằng màu đã chọn; vùng sáng giữ nguyên.
              </p>
              <div className="flex-1 p-4 overflow-auto flex items-center justify-center min-h-0">
                <div
                  className="grid gap-0 bg-[#1a1a1a] max-w-full max-h-full"
                  style={{
                    gridTemplateColumns: `repeat(${simulateGrid.a}, 1fr)`,
                    gridTemplateRows: `repeat(${simulateGrid.b}, 1fr)`,
                    aspectRatio: `${simulateGrid.a} / ${simulateGrid.b}`,
                  }}
                >
                  {Array.from({ length: simulateGrid.a * simulateGrid.b }).map((_, i) => (
                    <div key={i} className="min-w-0 min-h-0 bg-[#2a2a2a] overflow-hidden">
                      <img
                        src={
                          simulatePaintedImage ||
                          simulateCroppedImage ||
                          currentImage ||
                          selectedImage
                        }
                        alt={`Ô ${i + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(processedImage || selectedImage) ? (
            <div className="w-full h-full flex items-center justify-center p-4 relative" ref={canvasRef}>
              {contoursData ? (
                // Contour Mode: Multi-select và fill
                <div className="relative w-full h-full flex items-center justify-center">
                  <div
                    className="relative inline-block rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
                    style={
                      imageDimensions
                        ? {
                            width: imageDimensions.width * canvasZoom,
                            height: imageDimensions.height * canvasZoom,
                          }
                        : { maxWidth: '100%', maxHeight: '100%' }
                    }
                  >
                    <img
                      ref={imgRef}
                      src={quadMode ? (currentImage || selectedImage || contoursData?.originalImg) : contoursData.originalImg}
                      alt="Image"
                      className="block rounded-lg"
                      style={{
                        display: 'block',
                        width: imageDimensions ? imageDimensions.width * canvasZoom : undefined,
                        height: imageDimensions ? imageDimensions.height * canvasZoom : undefined,
                        maxWidth: !imageDimensions ? '100%' : undefined,
                        maxHeight: !imageDimensions ? 'calc(100vh - 100px)' : undefined,
                        pointerEvents: contoursData ? 'none' : 'auto',
                      }}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                        const rect = img.getBoundingClientRect();
                        setDisplayDimensions({ width: rect.width, height: rect.height });
                      }}
                    />
                    
                    {/* SVG overlay cho contours và quad points - phủ đúng ảnh, nhận toàn bộ click khi có contours */}
                    {imageDimensions && displayDimensions && (
                      <svg
                        className="absolute top-0 left-0 w-full h-full"
                        viewBox={`0 0 ${imageDimensions.width} ${imageDimensions.height}`}
                        preserveAspectRatio="none"
                        style={{
                          pointerEvents: contoursData ? 'all' : 'none',
                          width: '100%',
                          height: '100%',
                        }}
                        onMouseMove={(e) => {
                          if (
                            quadMode &&
                            (draggingPointIndex !== null ||
                              draggingEdgeIndex !== null ||
                              pendingEdgeDragIndex !== null ||
                              draggingSplineControl !== null)
                          )
                            handleMouseMove(e);
                          else handleContourCanvasMouseMove(e);
                        }}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={() => {
                          handleMouseUp();
                          setHoveredContourId(null);
                          setHoveredQuadContourId(null);
                        }}
                        onClick={contoursData ? handleCanvasClick : undefined}
                      >
                        {/* Lớp hit: click vào vùng ảnh để chọn contour (fill contour mode + quad transform mode) */}
                        {contoursData && imageDimensions && (
                          <rect
                            width={imageDimensions.width}
                            height={imageDimensions.height}
                            fill="transparent"
                            style={{ pointerEvents: 'all', cursor: 'pointer' }}
                          />
                        )}
                        {!quadMode && contoursData.contours.map((contour) => {
                          const isSelected = selectedContourIds.includes(contour.id);
                          const isHovered = hoveredContourId === contour.id;
                          
                          return (
                            <polygon
                              key={contour.id}
                              points={contour.points.map(p => `${p.x},${p.y}`).join(' ')}
                              fill={isSelected ? 'rgba(255, 165, 0, 0.3)' : isHovered ? 'rgba(255, 0, 0, 0.2)' : 'transparent'}
                              stroke={isSelected ? 'orange' : 'red'}
                              strokeWidth={isSelected ? '3' : '2'}
                              className="pointer-events-none transition-all"
                              style={{ pointerEvents: 'none' }}
                            />
                          );
                        })}
                        
                        {/* Quad transform mode: hiển thị contours, tứ giác và các điểm góc */}
                        {quadMode && contoursData && (
                          <>
                            {/* Vẽ tất cả contours với highlight khi hover + tên contour trên hình */}
                            {contoursData.contours.map((contour) => {
                              const isSelected = selectedQuadContourIds.includes(contour.id);
                              const isHovered = hoveredQuadContourId === contour.id;
                              const [bx, by, bw, bh] = contour.boundingBox;
                              const labelX = bx + bw / 2;
                              const labelY = by + bh / 2;
                              
                              return (
                                <g key={contour.id}>
                                  <polygon
                                    points={contour.points.map(p => `${p.x},${p.y}`).join(' ')}
                                    fill={isSelected ? 'rgba(0, 255, 0, 0.2)' : isHovered ? 'rgba(255, 255, 0, 0.3)' : 'transparent'}
                                    stroke={isSelected ? 'green' : isHovered ? 'yellow' : 'rgba(255, 255, 255, 0.3)'}
                                    strokeWidth={isSelected ? '3' : isHovered ? '2' : '1'}
                                    className="transition-all"
                                    style={{ pointerEvents: 'none' }}
                                  />
                                  {(isHovered || isSelected) && (
                                    <text
                                      x={labelX}
                                      y={labelY}
                                      textAnchor="middle"
                                      dominantBaseline="middle"
                                      fill="white"
                                      fontSize="10"
                                      stroke="black"
                                      strokeWidth={0.5}
                                    >
                                      {`Contour ${contour.id + 1}`}
                                    </text>
                                  )}
                                </g>
                              );
                            })}
                            
                            {/* Vẽ tứ giác và các điểm góc cho tất cả contour đã chọn */}
                            {selectedQuadContourIds.map((contourId) => {
                              const points = quadPoints[contourId];
                              if (!points) return null;
                              
                              return (
                                <g key={`quad-${contourId}`}>
                                  {/* Vẽ các cạnh */}
                                  {points.map((point, index) => {
                                    const nextIndex = (index + 1) % points.length;
                                    const nextPoint = points[nextIndex];
                                    const isHovered = hoveredEdgeIndex === index;
                                    const isEdgeSelected = selectedQuadEdgeIndices.includes(index);
                                    const EDGE_HITBOX_PX = 20;
                                    
                                    return (
                                      <g key={`edge-${contourId}-${index}`}>
                                        <line
                                          x1={point.x}
                                          y1={point.y}
                                          x2={nextPoint.x}
                                          y2={nextPoint.y}
                                          stroke="transparent"
                                          strokeWidth={EDGE_HITBOX_PX}
                                          className={isEdgeSelected && !addPointMode ? 'cursor-move' : 'cursor-pointer'}
                                          onClick={(e) => handleEdgeClick(e, index, contourId)}
                                          onMouseDown={(e) => handleEdgeMouseDown(e, index, contourId)}
                                          onMouseEnter={() => setHoveredEdgeIndex(index)}
                                          onMouseLeave={() => setHoveredEdgeIndex(null)}
                                          style={{ pointerEvents: 'all' }}
                                        />
                                        <line
                                          x1={point.x}
                                          y1={point.y}
                                          x2={nextPoint.x}
                                          y2={nextPoint.y}
                                          stroke={
                                            draggingEdgeIndex === index && draggingContourId === contourId
                                              ? 'yellow'
                                              : isEdgeSelected
                                                ? 'red'
                                                : isHovered && addPointMode
                                                  ? 'yellow'
                                                  : 'blue'
                                          }
                                          strokeWidth={
                                            draggingEdgeIndex === index && draggingContourId === contourId
                                              ? 6
                                              : isEdgeSelected
                                                ? 5
                                                : addPointMode
                                                  ? (isHovered ? 6 : 4)
                                                  : isHovered
                                                    ? 4
                                                    : 2
                                          }
                                          strokeDasharray="5,5"
                                          style={{ pointerEvents: 'none' }}
                                        />
                                      </g>
                                    );
                                  })}
                                  
                                  <polygon
                                    points={points.map(p => `${p.x},${p.y}`).join(' ')}
                                    fill="rgba(0, 255, 0, 0.1)"
                                    stroke="none"
                                    style={{ pointerEvents: 'none' }}
                                  />
                                  
                                  {splineControlPointsByContour[contourId]?.length > 0
                                    ? splineControlPointsByContour[contourId].map((pt, idx) => (
                                        <circle
                                          key={`spline-ctrl-${contourId}-${idx}`}
                                          cx={pt.x}
                                          cy={pt.y}
                                          r="8"
                                          fill={
                                            draggingSplineControl?.contourId === contourId &&
                                            draggingSplineControl?.index === idx
                                              ? 'yellow'
                                              : 'cyan'
                                          }
                                          stroke="white"
                                          strokeWidth={3}
                                          className={pointSelectMode ? 'cursor-default' : 'cursor-move'}
                                          onMouseDown={(e) => handleSplineControlMouseDown(e, contourId, idx)}
                                          style={{ pointerEvents: 'all' }}
                                        />
                                      ))
                                    : points.map((point, index) => {
                                        const ptSelected = isPointInSelection(contourId, index);
                                        return (
                                          <circle
                                            key={`point-${contourId}-${index}`}
                                            cx={point.x}
                                            cy={point.y}
                                            r="8"
                                            fill={draggingPointIndex === index && draggingContourId === contourId ? 'yellow' : ptSelected ? 'cyan' : 'blue'}
                                            stroke={ptSelected ? 'white' : 'white'}
                                            strokeWidth={ptSelected ? 3 : 2}
                                            className={pointSelectMode ? 'cursor-pointer' : 'cursor-move'}
                                            onMouseDown={(e) => handleMouseDown(e, index, contourId)}
                                            style={{ pointerEvents: 'all' }}
                                          />
                                        );
                                      })}
                                </g>
                              );
                            })}
                          </>
                        )}
                      </svg>
                    )}
                  </div>
                </div>
              ) : (
                // Mode bình thường: Hiển thị ảnh thông thường
                <div
                  className="relative inline-block rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
                  style={
                    imageDimensions
                      ? {
                          width: imageDimensions.width * canvasZoom,
                          height: imageDimensions.height * canvasZoom,
                        }
                      : undefined
                  }
                >
                  <img
                    ref={imgRef}
                    src={processedImage || selectedImage || undefined}
                    alt="Canvas"
                    className="block max-w-full max-h-full rounded-lg object-contain"
                    style={{
                      display: 'block',
                      width: imageDimensions ? imageDimensions.width * canvasZoom : 'auto',
                      height: imageDimensions ? imageDimensions.height * canvasZoom : 'auto',
                      maxWidth: !imageDimensions ? '100%' : undefined,
                      maxHeight: !imageDimensions ? 'calc(100vh - 100px)' : undefined,
                      pointerEvents: cutStretchMode ? 'none' : 'auto',
                    }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                      const rect = img.getBoundingClientRect();
                      setDisplayDimensions({ width: rect.width, height: rect.height });
                    }}
                  />
                  {cutStretchMode && imageDimensions && (
                    <svg
                      className="absolute left-0 top-0 h-full w-full select-none"
                      viewBox={`0 0 ${imageDimensions.width} ${imageDimensions.height}`}
                      preserveAspectRatio="none"
                      role="presentation"
                      style={{ cursor: loading ? 'wait' : 'crosshair', touchAction: 'none' }}
                      onMouseDown={handleCutStretchMouseDown}
                    >
                      <rect
                        width={imageDimensions.width}
                        height={imageDimensions.height}
                        fill="transparent"
                      />
                      {cutStretchDraft && (
                        <line
                          x1={cutStretchDraft.x1}
                          y1={cutStretchDraft.y1}
                          x2={cutStretchDraft.x2}
                          y2={cutStretchDraft.y2}
                          stroke="#22d3ee"
                          strokeWidth={Math.max(2, imageDimensions.width / 400)}
                          strokeDasharray="8 5"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                      {cutStretchCut?.kind === 'horizontal' && (
                        <line
                          x1={0}
                          y1={cutStretchCut.pos}
                          x2={imageDimensions.width}
                          y2={cutStretchCut.pos}
                          stroke="#84cc16"
                          strokeWidth={Math.max(2, imageDimensions.width / 400)}
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                      {cutStretchCut?.kind === 'vertical' && (
                        <line
                          x1={cutStretchCut.pos}
                          y1={0}
                          x2={cutStretchCut.pos}
                          y2={imageDimensions.height}
                          stroke="#84cc16"
                          strokeWidth={Math.max(2, imageDimensions.height / 400)}
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                    </svg>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center p-10 bg-[#1e1e1e] rounded-xl border-2 border-dashed border-[#555]">
              <div className="text-5xl mb-4">🖼️</div>
              <h2 className="mb-2 text-xl font-semibold">No Image Loaded</h2>
              <p className="text-[#888] mb-4 text-sm">
                Click OPEN button to select an image
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-5 py-2.5 bg-primary text-white rounded-lg cursor-pointer text-sm font-medium hover:bg-[#5558dd] transition-colors"
              >
                Choose Image
              </button>
            </div>
          )}
        </div>

        {/* Right Sidebar - Tools Panel hoặc Contour Control */}
        <div className="w-[350px] min-w-[350px] max-w-[350px] bg-[#1e1e1e] border-l border-[#3a3a3a] flex flex-col overflow-y-auto shrink-0">
          {cutStretchMode ? (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="p-3 border-b border-[#3a3a3a] bg-secondary text-white font-bold text-sm">
                ✂️ Cắt & kéo giãn
              </div>
              <div className="p-3 space-y-4 text-sm text-[#ccc]">
                <p className="text-xs leading-relaxed text-[#aaa]">
                  <strong className="text-white">Bước 1:</strong> kéo trên ảnh một nét gần{' '}
                  <strong>ngang</strong> để cắt theo hàng, hoặc gần <strong>dọc</strong> để cắt theo cột.
                </p>
                <p className="text-xs leading-relaxed text-[#aaa]">
                  <strong className="text-white">Bước 2:</strong> chỉnh số pixel chèn vào khe (kéo giãn), chế độ lấp vùng chèn, rồi{' '}
                  <strong className="text-cyan-300">Áp dụng</strong>.
                </p>
                {cutStretchCut && (
                  <div className="rounded border border-cyan-700/50 bg-[#1a2a2a] px-2 py-1.5 text-xs text-cyan-200">
                    {cutStretchCut.kind === 'horizontal'
                      ? `Đường cắt ngang tại y ≈ ${cutStretchCut.pos}px`
                      : `Đường cắt dọc tại x ≈ ${cutStretchCut.pos}px`}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#aaa]">
                    Độ dãn (px chèn vào khe)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={400}
                    value={cutStretchInsertPx}
                    onChange={(e) => setCutStretchInsertPx(Number(e.target.value))}
                    disabled={loading}
                    className="w-full accent-cyan-500"
                  />
                  <div className="text-center font-mono text-cyan-300">{cutStretchInsertPx}px</div>
                </div>
                <div>
                  <span className="mb-2 block text-xs font-medium text-[#aaa]">Vùng chèn</span>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="cutFill"
                      checked={cutStretchFillMode === 'extrude'}
                      onChange={() => setCutStretchFillMode('extrude')}
                      disabled={loading}
                    />
                    Lặp pixel tại mép cắt (extrude)
                  </label>
                  <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="cutFill"
                      checked={cutStretchFillMode === 'solid'}
                      onChange={() => setCutStretchFillMode('solid')}
                      disabled={loading}
                    />
                    Tô màu đặc
                  </label>
                  {cutStretchFillMode === 'solid' && (
                    <input
                      type="color"
                      value={cutStretchGapColor}
                      onChange={(e) => setCutStretchGapColor(e.target.value)}
                      disabled={loading}
                      className="mt-2 h-9 w-full max-w-[120px] cursor-pointer rounded border border-[#555] bg-transparent"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-2 pt-2">
                  <Tooltip
                    label={
                      <span>
                        Chèn <strong>{cutStretchInsertPx}px</strong> tại đường cắt; vùng chèn được{' '}
                        {cutStretchFillMode === 'extrude' ? 'lặp pixel ở mép cắt' : 'tô bằng màu đặc'}.
                        Cần vẽ đường cắt trên ảnh trước khi áp dụng.
                      </span>
                    }
                    side="left"
                    block
                  >
                    <button
                      type="button"
                      disabled={loading || !cutStretchCut}
                      onClick={() => void handleApplyCutStretch()}
                      className="w-full rounded bg-cyan-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Áp dụng lên ảnh
                    </button>
                  </Tooltip>
                  <Tooltip label="Thoát chế độ Cắt & kéo giãn (không lưu thay đổi)" side="left" block>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleExitCutStretch}
                      className="w-full rounded border border-[#555] px-4 py-2 text-sm text-[#ccc] hover:bg-[#3a3a3a]"
                    >
                      Thoát
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          ) : quadMode ? (
            <QuadTransformSidebar
              contoursData={contoursData}
              selectedQuadContourIds={selectedQuadContourIds}
              setSelectedQuadContourIds={setSelectedQuadContourIds}
              hoveredQuadContourId={hoveredQuadContourId}
              setHoveredQuadContourId={setHoveredQuadContourId}
              quadPoints={quadPoints}
              setQuadPoints={setQuadPoints}
              currentImage={currentImage}
              selectedImage={selectedImage}
              addPointMode={addPointMode}
              setAddPointMode={setAddPointMode}
              selectedQuadEdgeIndices={selectedQuadEdgeIndices}
              pointSelectMode={pointSelectMode}
              setPointSelectMode={setPointSelectMode}
              selectedQuadPoints={selectedQuadPoints}
              pointMoveMode={pointMoveMode}
              setPointMoveMode={setPointMoveMode}
              loading={loading}
              onSplineClick={handleSplineClick}
              onResetQuadToMinRect={handleResetQuadToMinRect}
              onApplyTransform={handleApplyTransform}
              onExitQuadMode={handleExitQuadMode}
            />
          ) : contoursData ? (
            <FillContourSidebar
              contoursData={contoursData}
              selectedContourIds={selectedContourIds}
              fillColor={fillColor}
              onChangeFillColor={setFillColor}
              loading={loading}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onFillSelectedContours={handleFillSelectedContours}
              onExitContourMode={handleExitContourMode}
            />
          ) : (
            // Normal Tools Panel
            <>
              <div className="p-3 border-b border-[#3a3a3a] bg-secondary text-white font-bold text-sm">
                🛠️ TOOLS
              </div>

              <div className="p-2">
                {tools.map((tool) => {
                  const handleClick =
                    tool.id === 'get_contours'
                      ? handleGetContours
                      : tool.id === 'quad_transform'
                        ? handleGetQuadPoints
                        : tool.id === 'cut_stretch'
                          ? handleEnterCutStretch
                          : () => handleProcessImage(tool.id);

                  return (
                    <Tooltip
                      key={tool.id}
                      label={
                        <span className="flex flex-col gap-0.5">
                          <span className="font-semibold text-white">{tool.name}</span>
                          <span className="text-[10px] text-[#cfcfcf]">
                            {tool.description}
                          </span>
                          {!selectedImage && (
                            <span className="text-[10px] text-amber-300">
                              Cần mở ảnh trước khi dùng công cụ này
                            </span>
                          )}
                        </span>
                      }
                      side="left"
                      block
                    >
                      <button
                        onClick={handleClick}
                        disabled={loading || !selectedImage}
                        className={`
                          w-full flex items-center gap-2.5 p-3 mb-1.5 rounded-md text-white transition-all text-left
                          ${activeTool === tool.id ? 'bg-secondary' : 'bg-[#2a2a2a]'}
                          ${!selectedImage || loading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[#3a3a3a]'}
                          ${activeTool === tool.id && 'hover:bg-secondary'}
                        `}
                      >
                        <div className="text-xl">{tool.icon}</div>
                        <div className="flex-1">
                          <div className="font-medium mb-0.5 text-sm">{tool.name}</div>
                          <div className="text-[11px] text-[#aaa]">{tool.description}</div>
                        </div>
                        {loading && activeTool === tool.id && (
                          <div className="text-sm animate-spin-slow">⏳</div>
                        )}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />
    </div>
  );
};

export default FillImage;