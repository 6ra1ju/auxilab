/// <reference types="vite/client" />
import React from 'react';
import type { ContoursData, SelectedQuadPoint } from './fill_img';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
interface QuadTransformSidebarProps {
  contoursData: ContoursData | null;
  selectedQuadContourIds: number[];
  setSelectedQuadContourIds: React.Dispatch<React.SetStateAction<number[]>>;
  hoveredQuadContourId: number | null;
  setHoveredQuadContourId: React.Dispatch<React.SetStateAction<number | null>>;
  quadPoints: { [contourId: number]: Array<{ x: number; y: number }> };
  setQuadPoints: React.Dispatch<
    React.SetStateAction<{ [contourId: number]: Array<{ x: number; y: number }> }>
  >;
  currentImage: string | null;
  selectedImage: string | null;
  addPointMode: boolean;
  setAddPointMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedQuadEdgeIndices: number[];
  pointSelectMode: boolean;
  setPointSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedQuadPoints: SelectedQuadPoint[];
  pointMoveMode: 'together' | 'symmetric';
  setPointMoveMode: React.Dispatch<React.SetStateAction<'together' | 'symmetric'>>;
  loading: boolean;
  onSplineClick: () => void;
  /** Reset 4 điểm tứ giác về hình chữ nhật bao nhỏ nhất (minAreaRect) cho contour đã chọn */
  onResetQuadToMinRect: () => void;
  onApplyTransform: () => void;
  onExitQuadMode: () => void;
}

export const QuadTransformSidebar: React.FC<QuadTransformSidebarProps> = ({
  contoursData,
  selectedQuadContourIds,
  setSelectedQuadContourIds,
  hoveredQuadContourId,
  setHoveredQuadContourId,
  quadPoints,
  setQuadPoints,
  currentImage,
  selectedImage,
  addPointMode,
  setAddPointMode,
  selectedQuadEdgeIndices,
  pointSelectMode,
  setPointSelectMode,
  selectedQuadPoints,
  pointMoveMode,
  setPointMoveMode,
  loading,
  onSplineClick,
  onResetQuadToMinRect,
  onApplyTransform,
  onExitQuadMode,
}) => {
  return (
    <>
      <div className="p-3 border-b border-[#3a3a3a] bg-blue-600 text-white font-bold text-sm">
        ⬜ QUAD TRANSFORM MODE
      </div>

      <div className="p-3">
        {/* Contour selector - List với hover effect */}
        <div className="mb-3 pb-3 border-b border-[#3a3a3a]">
          <label className="text-xs font-medium mb-2 block">Chọn Contour (click để chọn nhiều):</label>
          <div className="flex gap-1 mb-2">
            <button
              onClick={async () => {
                if (!contoursData) return;
                const ids = contoursData.contours.map((c) => c.id);
                setSelectedQuadContourIds(ids);

                for (const id of ids) {
                  if (!quadPoints[id]) {
                    try {
                      const res = await fetch(`${API_URL}/get_quad_points`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ img: currentImage || selectedImage }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        const map: { [k: number]: Array<{ x: number; y: number }> } = {};
                        for (const [k, v] of Object.entries(data.quadPoints)) {
                          map[parseInt(k)] = v as Array<{ x: number; y: number }>;
                        }
                        setQuadPoints((prev) => ({ ...prev, ...map }));
                      }
                    } catch (err) {
                      console.error('Error loading quad points:', err);
                    }
                  }
                }
              }}
              className="px-2 py-1 text-[10px] bg-[#3a3a3a] rounded hover:bg-[#4a4a4a]"
            >
              Chọn tất cả
            </button>
            <button
              onClick={() => setSelectedQuadContourIds([])}
              className="px-2 py-1 text-[10px] bg-[#3a3a3a] rounded hover:bg-[#4a4a4a]"
            >
              Bỏ chọn tất cả
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto bg-[#2a2a2a] rounded border border-[#3a3a3a]">
            {contoursData?.contours.map((contour) => {
              const isSelected = selectedQuadContourIds.includes(contour.id);
              const isHovered = hoveredQuadContourId === contour.id;

              return (
                <div
                  key={contour.id}
                  onClick={async () => {
                    const cid = contour.id;
                    setSelectedQuadContourIds((prev) => {
                      if (prev.includes(cid)) return prev.filter((id) => id !== cid);
                      return [...prev, cid];
                    });

                    if (!quadPoints[cid] && contoursData) {
                      try {
                        const response = await fetch(`${API_URL}/get-quad-points`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ img: currentImage || selectedImage }),
                        });
                        if (response.ok) {
                          const data = await response.json();
                          const quadPointsMap: { [key: number]: Array<{ x: number; y: number }> } = {};
                          for (const [key, value] of Object.entries(data.quadPoints)) {
                            quadPointsMap[parseInt(key)] = value as Array<{ x: number; y: number }>;
                          }
                          setQuadPoints((prev) => ({ ...prev, ...quadPointsMap }));
                        }
                      } catch (err) {
                        console.error('Error loading quad points:', err);
                      }
                    }
                  }}
                  onMouseEnter={() => setHoveredQuadContourId(contour.id)}
                  onMouseLeave={() => setHoveredQuadContourId(null)}
                  className={`px-3 py-2 text-xs cursor-pointer transition-colors flex items-center gap-2 ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : isHovered
                        ? 'bg-blue-500 text-white'
                        : 'text-white hover:bg-[#3a3a3a]'
                  }`}
                >
                  {isSelected && <span>✓</span>}
                  <span>Contour {contour.id + 1}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add Point Mode Toggle */}
        <div className="mb-3 pb-3 border-b border-[#3a3a3a]">
          <button
            onClick={() => setAddPointMode(!addPointMode)}
            className={`w-full px-3 py-2 rounded text-xs font-medium transition-colors ${
              addPointMode
                ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                : 'bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white border border-[#3a3a3a]'
            }`}
          >
            {addPointMode ? '✓ Chế độ thêm điểm: BẬT' : '➕ Chế độ thêm điểm: TẮT'}
          </button>
          {addPointMode ? (
            <div className="mt-2 text-xs text-[#aaa]">Click vào cạnh để thêm điểm mới</div>
          ) : (
            <div className="mt-2 text-xs text-cyan-300">
              Click cạnh để chọn/bỏ chọn (cyan). Kéo cạnh đã chọn để di chuyển.
            </div>
          )}
          {selectedQuadEdgeIndices.length > 0 && (
            <div className="mt-1 text-xs text-cyan-400">
              Cạnh đã chọn: [{selectedQuadEdgeIndices.join(', ')}]
            </div>
          )}
        </div>

        {/* Chế độ chọn điểm + Spline */}
        <div className="mb-3 pb-3 border-b border-[#3a3a3a]">
          <button
            onClick={() => setPointSelectMode(!pointSelectMode)}
            className={`w-full px-3 py-2 rounded text-xs font-medium transition-colors mb-2 ${
              pointSelectMode
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white border border-[#3a3a3a]'
            }`}
          >
            {pointSelectMode ? '✓ Chế độ chọn điểm: BẬT' : '🔘 Chế độ chọn điểm: TẮT'}
          </button>
          {pointSelectMode && (
            <div className="mb-2 text-xs text-green-300">
              Click điểm → chọn các điểm đối xứng qua Ox/Oy (đã chọn: cyan)
            </div>
          )}
          {selectedQuadPoints.length > 0 && (
            <div className="mb-2 text-xs text-cyan-400">
              Điểm đã chọn:{' '}
              {selectedQuadPoints
                .map((s) => `C${s.contourId + 1} P${s.pointIndex + 1}`)
                .join(', ')}
            </div>
          )}
          {selectedQuadPoints.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium mb-1.5 text-[#aaa]">
                Cách di chuyển khi kéo:
              </div>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="pointMoveMode"
                    checked={pointMoveMode === 'together'}
                    onChange={() => setPointMoveMode('together')}
                    className="accent-blue-500"
                  />
                  Cùng nhau (delta giống nhau)
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="pointMoveMode"
                    checked={pointMoveMode === 'symmetric'}
                    onChange={() => setPointMoveMode('symmetric')}
                    className="accent-blue-500"
                  />
                  Đối xứng (qua Ox và Oy)
                </label>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onSplineClick}
              disabled={
                selectedQuadPoints.filter(
                  (s) => s.contourId === selectedQuadContourIds[0],
                ).length < 3
              }
              className={`flex-1 px-3 py-2 rounded text-xs font-medium transition-colors ${
                selectedQuadPoints.filter(
                  (s) => s.contourId === selectedQuadContourIds[0],
                ).length >= 3
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              📈 Spline
            </button>
          </div>
          {selectedQuadPoints.length > 0 &&
            selectedQuadPoints.filter(
              (s) => s.contourId === selectedQuadContourIds[0],
            ).length < 3 && (
              <div className="mt-1 text-xs text-amber-400">
                Cần ít nhất 3 điểm trên contour đầu để vẽ spline
              </div>
            )}
        </div>

        {/* Bảng số liệu - Tọa độ điểm và độ dài cạnh (áp dụng cho tất cả contour đã chọn) */}
        {selectedQuadContourIds.length > 0 &&
          (() => {
            const firstId = selectedQuadContourIds[0];
            const pts = quadPoints[firstId];
            if (!pts) return null;
            return (
              <div className="mb-3 pb-3 border-b border-[#3a3a3a]">
                <div className="text-xs font-medium mb-2">
                  📊 Số liệu{' '}
                  {selectedQuadContourIds.length > 1
                    ? `(${selectedQuadContourIds.length} contours)`
                    : ''}
                  :
                </div>
                <div className="max-h-64 overflow-y-auto bg-[#2a2a2a] rounded border border-[#3a3a3a] text-xs">
                  <table className="w-full">
                    <thead className="bg-[#1a1a1a] sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left border-b border-[#3a3a3a] w-12">
                          Điểm
                        </th>
                        <th className="px-2 py-1 text-left border-b border-[#3a3a3a]">
                          X
                        </th>
                        <th className="px-2 py-1 text-left border-b border-[#3a3a3a]">
                          Y
                        </th>
                        <th className="px-2 py-1 text-left border-b border-[#3a3a3a]">
                          Cạnh (px)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pts.map((point, index) => {
                        const nextIndex = (index + 1) % pts.length;
                        const nextPoint = pts[nextIndex];
                        const currentEdgeLength = Math.sqrt(
                          Math.pow(nextPoint.x - point.x, 2) +
                            Math.pow(nextPoint.y - point.y, 2),
                        );

                        const angle = Math.atan2(
                          nextPoint.y - point.y,
                          nextPoint.x - point.x,
                        );

                        return (
                          <tr
                            key={index}
                            className="border-b border-[#3a3a3a]"
                          >
                            <td className="px-2 py-1">
                              <div className="font-medium">P{index + 1}</div>
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={Math.round(point.x)}
                                onChange={(e) => {
                                  const newX = parseFloat(e.target.value) || 0;
                                  setQuadPoints((prev) => {
                                    const next = { ...prev };
                                    for (const cid of selectedQuadContourIds) {
                                      const arr = prev[cid];
                                      if (!arr || index >= arr.length) continue;
                                      const newPoints = [...arr];
                                      newPoints[index] = {
                                        ...newPoints[index],
                                        x: newX,
                                      };
                                      next[cid] = newPoints;
                                    }
                                    return next;
                                  });
                                }}
                                className="w-full px-2 py-1 bg-[#1a1a1a] border border-[#3a3a3a] rounded text-white text-xs min-w-[60px]"
                                step="1"
                                style={{ minWidth: '60px' }}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={Math.round(point.y)}
                                onChange={(e) => {
                                  const newY = parseFloat(e.target.value) || 0;
                                  setQuadPoints((prev) => {
                                    const next = { ...prev };
                                    for (const cid of selectedQuadContourIds) {
                                      const arr = prev[cid];
                                      if (!arr || index >= arr.length) continue;
                                      const newPoints = [...arr];
                                      newPoints[index] = {
                                        ...newPoints[index],
                                        y: newY,
                                      };
                                      next[cid] = newPoints;
                                    }
                                    return next;
                                  });
                                }}
                                className="w-full px-2 py-1 bg-[#1a1a1a] border border-[#3a3a3a] rounded text-white text-xs min-w-[60px]"
                                step="1"
                                style={{ minWidth: '60px' }}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={Math.round(currentEdgeLength)}
                                onChange={(e) => {
                                  const newLength =
                                    parseFloat(e.target.value) || 0;
                                  if (newLength > 0) {
                                    const newNextX =
                                      point.x + newLength * Math.cos(angle);
                                    const newNextY =
                                      point.y + newLength * Math.sin(angle);

                                    setQuadPoints((prev) => {
                                      const next = { ...prev };
                                      for (const cid of selectedQuadContourIds) {
                                        const arr = prev[cid];
                                        if (
                                          !arr ||
                                          nextIndex >= arr.length
                                        )
                                          continue;
                                        const newPoints = [...arr];
                                        newPoints[nextIndex] = {
                                          x: newNextX,
                                          y: newNextY,
                                        };
                                        next[cid] = newPoints;
                                      }
                                      return next;
                                    });
                                  }
                                }}
                                className="w-full px-2 py-1 bg-[#1a1a1a] border border-[#3a3a3a] rounded text-white text-xs min-w-[60px]"
                                step="1"
                                min="0"
                                style={{ minWidth: '60px' }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

        {/* Reset tứ giác về hình chữ nhật bao contour */}
        <div className="mb-3 pb-3 border-b border-[#3a3a3a]">
          <button
            type="button"
            onClick={onResetQuadToMinRect}
            disabled={loading || selectedQuadContourIds.length === 0}
            className={`w-full px-3 py-2 rounded text-xs font-medium transition-colors ${
              selectedQuadContourIds.length === 0 || loading
                ? 'bg-gray-600 cursor-not-allowed opacity-50 text-gray-400'
                : 'bg-orange-700 hover:bg-orange-600 text-white'
            }`}
            title="Đặt lại 4 điểm tứ giác theo hình chữ nhật nhỏ nhất bao quanh contour (giống lúc mới vào Quad Transform)"
          >
            {loading ? '⏳ …' : '↺ Reset tứ giác (min rect)'}
          </button>
          <p className="mt-1.5 text-[10px] text-[#888] leading-snug">
            Áp dụng cho các contour đang tick: trả về đúng 4 góc của hình chữ nhật bao nhỏ nhất quanh viền contour; xóa trạng thái spline trên các contour đó.
          </p>
        </div>

        {/* Instructions */}
        <div className="mb-3 pb-3 border-b border-[#3a3a3a] text-xs text-[#aaa]">
          <div className="mb-2">📌 Hướng dẫn:</div>
          <div>• Click contour để chọn nhiều, chỉnh sửa áp dụng cho tất cả contour đã chọn</div>
          <div>• Kéo điểm/cạnh: tất cả contour đã chọn di chuyển cùng lúc</div>
          <div>• Bật chế độ thêm điểm để thêm điểm trên cạnh</div>
          <div className="mt-1.5 text-cyan-300/90">
            • <strong>Apply Transform</strong> chỉ áp dụng lên các contour đang tick trong danh sách phía trên
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onApplyTransform}
            disabled={loading || selectedQuadContourIds.length === 0}
            className={`w-full px-3 py-2 rounded text-xs font-bold transition-colors ${
              selectedQuadContourIds.length === 0 || loading
                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {loading ? '⏳ Transforming...' : '✨ Apply Transform'}
          </button>

          <button
            onClick={onExitQuadMode}
            className="w-full px-3 py-2 bg-red-600 rounded text-xs font-medium hover:bg-red-700 transition-colors"
          >
            ← Exit Mode
          </button>
        </div>
      </div>
    </>
  );
};

