import React, { useState, useRef, useEffect } from 'react';
import { FillContourSidebar } from './fill_contour';
import { QuadTransformSidebar } from './quad_transform';

export type Tool =
  | 'sharpen'
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'fill_min'
  | 'fill_max'
  | 'get_contours'
  | 'quad_transform';

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

// API base URL – ưu tiên cấu hình từ Vite, fallback về localhost:8000
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const STORAGE_KEY = 'image-enhance-state';

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
  >({}); // Lưu các điểm điều khiển ban đầu của spline để hiển thị
  const [pointSelectMode, setPointSelectMode] = useState<boolean>(false); // Chế độ chọn điểm (quad mode)
  const [draggingEdgeIndex, setDraggingEdgeIndex] = useState<number | null>(null);
  const [pendingEdgeDragIndex, setPendingEdgeDragIndex] = useState<number | null>(null);
  const edgeDragStartRef = useRef<{ mouseX: number; mouseY: number; p0: { x: number; y: number }; p1: { x: number; y: number } } | null>(null);
  const didEdgeDragRef = useRef(false);
  const pointDragLastCoordsRef = useRef<{ x: number; y: number } | null>(null);

  // Mô phỏng vật liệu xây dựng: lưới a x b
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [simulateGrid, setSimulateGrid] = useState<{ a: number; b: number } | null>(null);
  const [simulateInputA, setSimulateInputA] = useState<string>('2');
  const [simulateInputB, setSimulateInputB] = useState<string>('2');
  const [simulateCroppedImage, setSimulateCroppedImage] = useState<string | null>(null); // Ảnh đã cắt bỏ border 5px
  const BORDER_CROP_PX = 5;

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
          setHistory([data.img]);
          setHistoryIndex(0);
        } catch (error) {
          console.error('Error normalizing image:', error);
          // Nếu có lỗi, vẫn lưu ảnh gốc để có thể sử dụng
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

    // Nếu click vào tool khác khi đang có contours hoặc quad mode, clear
    if (contoursData || quadMode) {
      setContoursData(null);
      setActiveTool(null);
      setQuadMode(false);
      setSelectedQuadContourIds([]);
      setQuadPoints({});
    }

    setLoading(true);
    setActiveTool(tool);
    
    try {
      const response = await fetch(`${API_URL}/fill_img`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          img: selectedImage,
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
    }
  };

  // Get contours - giống như một tool bình thường (fill contour mode)
  const handleGetContours = async () => {
    if (!selectedImage) {
      alert('Vui lòng chọn ảnh trước!');
      return;
    }

    // Thoát quad mode nếu đang bật, để vào fill contour mode thuần
    if (quadMode) {
      setQuadMode(false);
      setSelectedQuadContourIds([]);
      setQuadPoints({});
      setSelectedQuadEdgeIndices([]);
      setSelectedQuadPoints([]);
      setSplineControlPointsByContour({});
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
  const getContourAtPoint = (clientX: number, clientY: number, svgEl: SVGSVGElement | null): Contour | null => {
    if (!contoursData || !imageDimensions || !displayDimensions || !svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * imageDimensions.width;
    const y = ((clientY - rect.top) / rect.height) * imageDimensions.height;
    const containing = contoursData.contours.filter((c) => pointInPolygon(x, y, c.points));
    if (containing.length === 0) return null;
    containing.sort((a, b) => a.area - b.area);
    return containing[0];
  };

  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!contoursData) return;
    // Trong quad transform mode: không chọn contour bằng click trên hình
    if (quadMode) return;
    const contour = getContourAtPoint(e.clientX, e.clientY, e.currentTarget);
    if (!contour) return;
    handleToggleContour(contour.id);
  };

  const handleContourCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!contoursData) return;
    const contour = getContourAtPoint(e.clientX, e.clientY, e.currentTarget);
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

  const handleSplineClick = () => {
    const contourId = selectedQuadContourIds[0];
    if (contourId === undefined || !quadPoints[contourId]) return;
    const indicesForContour = selectedQuadPoints
      .filter((s) => s.contourId === contourId)
      .map((s) => s.pointIndex);
    const sorted = [...new Set(indicesForContour)].sort((a, b) => a - b);
    if (sorted.length < 3) {
      alert('Chọn ít nhất 3 điểm để vẽ spline.');
      return;
    }
    const allPts = quadPoints[contourId];
    const pts = sorted.map((i) => allPts[i]);

    // Lưu lại các điểm điều khiển ban đầu để hiển thị sau khi spline đã thay thế đoạn thẳng
    setSplineControlPointsByContour(prev => ({
      ...prev,
      [contourId]: pts,
    }));

    // Thay thế đoạn thẳng giữa điểm đầu và cuối bằng đa giác bám theo spline
    const startIdx = sorted[0];
    const endIdx = sorted[sorted.length - 1];
    const sampled = sampleSplinePoints(pts, 12); // càng nhiều mẫu thì càng mượt

    setQuadPoints(prev => {
      const current = prev[contourId] || [];
      const before = current.slice(0, startIdx);
      const after = current.slice(endIdx + 1);
      const newPoints = [...before, ...sampled, ...after];
      return {
        ...prev,
        [contourId]: newPoints,
      };
    });

    setSelectedQuadPoints([]);
    setSelectedQuadEdgeIndices([]);
  };


  // Get quad points for contours - tự động lấy contours nếu chưa có (quad transform mode)
  const handleGetQuadPoints = async () => {
    if (!selectedImage) {
      alert('Vui lòng chọn ảnh trước!');
      return;
    }

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

  // Apply perspective transform - fill tất cả các polygon
  const handleApplyTransform = async () => {
    if (!contoursData || Object.keys(quadPoints).length === 0) {
      alert('Vui lòng có ít nhất một contour với quad points!');
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
      
      // Chuyển đổi tất cả quad points sang format cho backend
      const allQuadPoints: { [key: string]: Array<{ x: number; y: number }> } = {};
      for (const [contourId, points] of Object.entries(quadPoints)) {
        allQuadPoints[contourId.toString()] = points;
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
    } catch (error) {
      console.error('Error:', error);
      alert('Có lỗi xảy ra khi transform ảnh!');
    } finally {
      setLoading(false);
    }
  };

  // Handle mouse events for dragging points (hoặc chọn điểm khi pointSelectMode)
  const handleMouseDown = (e: React.MouseEvent<SVGCircleElement>, pointIndex: number, contourId: number) => {
    e.preventDefault();
    if (pointSelectMode) {
      e.stopPropagation();
      toggleQuadPointSelection(pointIndex, contourId);
      return;
    }
    setDraggingPointIndex(pointIndex);
    setDraggingContourId(contourId);
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
    setHistory([]);
    setHistoryIndex(-1);
    setContoursData(null);
    setHoveredContourId(null);
    setSelectedContourIds([]);
    // Xóa luôn localStorage
    localStorage.removeItem(STORAGE_KEY);
  };

  // Mở modal mô phỏng
  const handleOpenSimulate = () => setShowSimulateModal(true);

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
    { id: 'get_contours', name: 'Fill Contours', icon: '🎯', description: 'Click để fill contours', isSpecial: true },
    { id: 'quad_transform', name: 'Quad Transform', icon: '⬜', description: 'Kéo thả đỉnh tứ giác', isSpecial: true },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-[#2a2a2a] text-white overflow-hidden m-0 p-0">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1e1e1e] border-b border-[#3a3a3a] h-[50px] min-h-[50px] shrink-0">
        {/* Left buttons */}
        <div className="flex gap-1.5">
          <button 
            onClick={handleClearImage}
            disabled={!selectedImage}
            className={`w-8 h-8 bg-[#2a2a2a] rounded-md text-white text-sm flex items-center justify-center transition-colors ${
              selectedImage ? 'cursor-pointer hover:bg-red-600' : 'cursor-not-allowed opacity-50'
            }`}
            title="Clear image"
          >
            ✕
          </button>
          <button 
            onClick={handleGoBack}
            disabled={historyIndex <= 0}
            className={`w-8 h-8 bg-[#2a2a2a] rounded-md text-white text-sm flex items-center justify-center transition-colors ${
              historyIndex > 0 ? 'cursor-pointer hover:bg-[#3a3a3a]' : 'cursor-not-allowed opacity-50'
            }`}
            title="Undo"
          >
            ‹
          </button>
          <button 
            onClick={handleGoForward}
            disabled={historyIndex >= history.length - 1}
            className={`w-8 h-8 bg-[#2a2a2a] rounded-md text-white text-sm flex items-center justify-center transition-colors ${
              historyIndex < history.length - 1 ? 'cursor-pointer hover:bg-[#3a3a3a]' : 'cursor-not-allowed opacity-50'
            }`}
            title="Redo"
          >
            ›
          </button>
        </div>
        
        {/* Center buttons */}
        <div className="flex gap-2.5">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-1.5 bg-primary rounded-md text-white cursor-pointer text-sm font-medium transition-all hover:bg-[#5558dd]"
          >
            📁 OPEN
          </button>
          <button 
            className={`px-3.5 py-1.5 rounded-md text-white cursor-pointer text-sm font-medium transition-all ${
              activeTool ? 'bg-secondary hover:bg-[#4aa8cc]' : 'bg-[#4a4a4a] hover:bg-[#5a5a5a]'
            }`}
          >
            🛠 TOOLS
          </button>
        </div>

        {/* Right buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleOpenSimulate}
            disabled={!selectedImage}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
              selectedImage ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer' : 'bg-[#2a2a2a] opacity-50 cursor-not-allowed text-white'
            }`}
            title="Mô phỏng vật liệu dạng lưới a x b"
          >
            📐 Mô phỏng
          </button>
          <button className="w-8 h-8 bg-[#2a2a2a] rounded-md text-white cursor-pointer text-sm flex items-center justify-center hover:bg-[#3a3a3a] transition-colors">
            💾
          </button>
          <button className="w-8 h-8 bg-[#2a2a2a] rounded-md text-white cursor-pointer text-sm flex items-center justify-center hover:bg-[#3a3a3a] transition-colors">
            ⋯
          </button>
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
            <p className="text-sm text-[#aaa] mb-4">Nhập số lượng ảnh theo 2 chiều (1–20)</p>
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

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Canvas Area */}
        <div 
          className="flex-1 flex items-center justify-center p-2.5 bg-[#333] overflow-auto min-h-0 min-w-0 relative"
          style={{
            backgroundImage: 'repeating-linear-gradient(45deg, #2a2a2a 0, #2a2a2a 10px, #333 10px, #333 20px)'
          }}
        >
          {/* Overlay mô phỏng lưới a x b */}
          {simulateGrid && selectedImage && (
            <div className="absolute inset-0 z-40 flex flex-col bg-[#1a1a1a]">
              <div className="flex items-center justify-between px-4 py-2 bg-[#2a2a2a] border-b border-[#3a3a3a] shrink-0">
                <span className="text-sm text-white">
                  Mô phỏng {simulateGrid.a} × {simulateGrid.b} (tổng {simulateGrid.a * simulateGrid.b} ảnh, đã cắt border 5px)
                </span>
                <button
                  onClick={handleCloseSimulate}
                  className="px-3 py-1.5 bg-red-600 rounded text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  Đóng
                </button>
              </div>
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
                        src={simulateCroppedImage || currentImage || selectedImage}
                        alt={`Tile ${i + 1}`}
                        className="w-full h-full object-cover"
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
                  <div className="relative inline-block" style={{ maxWidth: '100%', maxHeight: '100%' }}>
                    <img
                      ref={imgRef}
                      src={quadMode ? (currentImage || selectedImage || contoursData?.originalImg) : contoursData.originalImg}
                      alt="Image"
                      className="max-w-full max-h-full object-contain rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: 'calc(100vh - 100px)',
                        width: 'auto',
                        height: 'auto',
                        pointerEvents: contoursData ? 'none' : 'auto',
                      }}
                      onLoad={(e) => {
                        const img = e.currentTarget;
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
                          if (quadMode && (draggingPointIndex !== null || draggingEdgeIndex !== null || pendingEdgeDragIndex !== null)) handleMouseMove(e);
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
                                  />
                                  
                                  {splineControlPointsByContour[contourId]?.length > 0
                                    ? splineControlPointsByContour[contourId].map((pt, idx) => (
                                        <circle
                                          key={`spline-ctrl-${contourId}-${idx}`}
                                          cx={pt.x}
                                          cy={pt.y}
                                          r="8"
                                          fill="cyan"
                                          stroke="white"
                                          strokeWidth={3}
                                          className="cursor-default"
                                          style={{ pointerEvents: 'none' }}
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
                <img
                  ref={imgRef}
                  src={processedImage || selectedImage || undefined}
                  alt="Canvas"
                  className="max-w-full max-h-full object-contain rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
                  style={{
                    display: 'block',
                    width: 'auto',
                    height: 'auto'
                  }}
                />
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
          {quadMode ? (
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
                  const handleClick = tool.id === 'get_contours' 
                    ? handleGetContours 
                    : tool.id === 'quad_transform'
                    ? handleGetQuadPoints
                    : () => handleProcessImage(tool.id);
                  
                  return (
                    <button
                      key={tool.id}
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
                        <div className="font-medium mb-0.5 text-sm">
                          {tool.name}
                        </div>
                        <div className="text-[11px] text-[#aaa]">
                          {tool.description}
                        </div>
                      </div>
                      {loading && activeTool === tool.id && (
                        <div className="text-sm animate-spin-slow">⏳</div>
                      )}
                    </button>
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
