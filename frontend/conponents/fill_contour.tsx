import React from 'react';
import type { ContoursData } from './fill_img';

interface FillContourSidebarProps {
  contoursData: ContoursData;
  selectedContourIds: number[];
  fillColor: string;
  onChangeFillColor: (color: string) => void;
  loading: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onFillSelectedContours: () => void;
  onExitContourMode: () => void;
}

export const FillContourSidebar: React.FC<FillContourSidebarProps> = ({
  contoursData,
  selectedContourIds,
  fillColor,
  onChangeFillColor,
  loading,
  onSelectAll,
  onDeselectAll,
  onFillSelectedContours,
  onExitContourMode,
}) => {
  return (
    <>
      <div className="p-3 border-b border-[#3a3a3a] bg-orange-600 text-white font-bold text-sm">
        🎯 CONTOUR MODE
      </div>

      <div className="p-3">
        {/* Stats */}
        <div className="mb-3 pb-3 border-b border-[#3a3a3a] text-xs text-[#aaa]">
          <div>Total: {contoursData.contours.length} contours</div>
          <div className="text-orange-500 font-medium mt-1">Selected: {selectedContourIds.length}</div>
        </div>

        {/* Color picker */}
        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[#3a3a3a]">
          <label className="text-xs font-medium">Fill Color:</label>
          <input
            type="color"
            value={fillColor}
            onChange={(e) => onChangeFillColor(e.target.value)}
            className="w-12 h-8 rounded cursor-pointer border-0"
          />
          <span className="text-xs text-[#aaa]">{fillColor}</span>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onSelectAll}
            className="w-full px-3 py-2 bg-[#2a2a2a] rounded text-xs font-medium hover:bg-[#3a3a3a] transition-colors"
          >
            ✓ Select All
          </button>

          <button
            onClick={onDeselectAll}
            disabled={selectedContourIds.length === 0}
            className={`w-full px-3 py-2 bg-[#2a2a2a] rounded text-xs font-medium transition-colors ${
              selectedContourIds.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#3a3a3a]'
            }`}
          >
            ✗ Deselect All
          </button>

          <button
            onClick={onFillSelectedContours}
            disabled={loading || selectedContourIds.length === 0}
            className={`w-full px-3 py-2 rounded text-xs font-bold transition-colors ${
              selectedContourIds.length === 0 || loading
                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {loading
              ? '⏳ Filling...'
              : `🎨 Fill ${selectedContourIds.length} Contour${selectedContourIds.length !== 1 ? 's' : ''}`}
          </button>

          <button
            onClick={onExitContourMode}
            className="w-full px-3 py-2 bg-red-600 rounded text-xs font-medium hover:bg-red-700 transition-colors"
          >
            ← Exit Mode
          </button>
        </div>
      </div>
    </>
  );
};

