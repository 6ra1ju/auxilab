from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Tuple
import base64
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw
from io import BytesIO
import numpy as np
import cv2
import re

app = FastAPI()

# Thêm CORS để frontend có thể gọi API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Trong production nên chỉ định cụ thể domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ImageRequest(BaseModel):
    img: str  # Base64 encoded image
    tool: str = None  # Tool to apply: sharpen, blur, brightness, contrast, saturation

class ImageResponse(BaseModel):
    img: str  # Base64 encoded image

class ContourPoint(BaseModel):
    x: int
    y: int

class Contour(BaseModel):
    id: int
    points: List[ContourPoint]
    area: float
    boundingBox: Tuple[int, int, int, int]  # x, y, width, height

class ContoursResponse(BaseModel):
    contours: List[Contour]
    previewImg: str  # Base64 encoded preview image with contours outlined
    originalImg: str  # Base64 encoded original image

class FillContourRequest(BaseModel):
    img: str  # Base64 encoded image
    contourId: int
    contours: List[Contour]
    fillColor: Tuple[int, int, int] = (255, 255, 255)  # RGB color

class QuadPoint(BaseModel):
    x: float
    y: float

class QuadTransformRequest(BaseModel):
    img: str  # Base64 encoded image
    contours: List[Contour]
    allQuadPoints: dict  # Dictionary với key là contourId, value là list of QuadPoint


class MinAreaQuadRequest(BaseModel):
    """Danh sách đỉnh contour — trả về 4 góc hình chữ nhật bao nhỏ nhất (minAreaRect)."""

    points: List[ContourPoint]


def base64_to_image(base64_string: str) -> Image.Image:
    """Chuyển đổi base64 string thành PIL Image"""
    # Loại bỏ header của base64 nếu có (data:image/png;base64,)
    if ',' in base64_string:
        base64_string = base64_string.split(',')[1]
    
    image_data = base64.b64decode(base64_string)
    image = Image.open(BytesIO(image_data))
    return image

def image_to_base64(image: Image.Image, format: str = 'PNG') -> str:
    """Chuyển đổi PIL Image thành base64 string"""
    buffered = BytesIO()
    image.save(buffered, format=format)
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return f"data:image/{format.lower()};base64,{img_str}"

def fill_min(img: Image.Image) -> Image.Image:
    """Làm đối xứng ảnh bằng cách lấy giá trị min của các pixel đối xứng"""
    # Convert PIL Image to numpy array
    img_array = np.array(img)
    h, w = img_array.shape[:2]

    # Làm đối xứng trái-phải
    for y in range(h):
        for x in range(w // 2):
            left = img_array[y, x]
            right = img_array[y, w - x - 1]
            
            # Xử lý cho cả ảnh grayscale và RGB
            if len(img_array.shape) == 3:  # RGB
                min_value = np.minimum(left, right)
            else:  # Grayscale
                min_value = min(left, right)
            
            img_array[y, x] = min_value
            img_array[y, w - x - 1] = min_value

    # Làm đối xứng trên-dưới
    for y in range(h // 2):
        for x in range(w):
            top = img_array[y, x]
            bottom = img_array[h - y - 1, x]
            
            # Xử lý cho cả ảnh grayscale và RGB
            if len(img_array.shape) == 3:  # RGB
                min_value = np.minimum(top, bottom)
            else:  # Grayscale
                min_value = min(top, bottom)
            
            img_array[y, x] = min_value
            img_array[h - y - 1, x] = min_value

    # Convert numpy array back to PIL Image
    return Image.fromarray(img_array)


def fill_max(img: Image.Image) -> Image.Image:
    """Làm đối xứng ảnh bằng cách lấy giá trị max của các pixel đối xứng"""
    # Convert PIL Image to numpy array
    img_array = np.array(img)
    h, w = img_array.shape[:2]

    # Làm đối xứng trái-phải
    for y in range(h):
        for x in range(w // 2):
            left = img_array[y, x]
            right = img_array[y, w - x - 1]
            
            # Xử lý cho cả ảnh grayscale và RGB
            if len(img_array.shape) == 3:  # RGB
                max_value = np.maximum(left, right)
            else:  # Grayscale
                max_value = max(left, right)
            
            img_array[y, x] = max_value
            img_array[y, w - x - 1] = max_value

    # Làm đối xứng trên-dưới
    for y in range(h // 2):
        for x in range(w):
            top = img_array[y, x]
            bottom = img_array[h - y - 1, x]
            
            # Xử lý cho cả ảnh grayscale và RGB
            if len(img_array.shape) == 3:  # RGB
                max_value = np.maximum(top, bottom)
            else:  # Grayscale
                max_value = max(top, bottom)
            
            img_array[y, x] = max_value
            img_array[h - y - 1, x] = max_value

    # Convert numpy array back to PIL Image
    return Image.fromarray(img_array)


def vertical_symmetric(img: np.ndarray) -> np.ndarray:
    """Làm đối xứng ảnh trái-phải bằng cách lấy giá trị min của các pixel đối xứng và chuẩn hóa về binary"""
    img_array = img.copy()
    h, w = img_array.shape[:2]

    # Làm đối xứng trái-phải
    for y in range(h):
        for x in range(w // 2):
            left = img_array[y, x]
            right = img_array[y, w - x - 1]
            
            # Xử lý cho cả ảnh grayscale và RGB
            if len(img_array.shape) == 3:  # RGB
                min_value = np.minimum(left, right)
            else:  # Grayscale
                min_value = min(left, right)
            # Chuẩn hóa về binary (0 hoặc 255)
            if min_value > 127:
                min_value = 255
            else:
                min_value = 0
            img_array[y, x] = min_value
            img_array[y, w - x - 1] = min_value
    
    return img_array

def horizontal_symmetric(img: np.ndarray) -> np.ndarray:
    """Làm đối xứng ảnh trên-dưới bằng cách lấy giá trị min của các pixel đối xứng và chuẩn hóa về binary"""
    img_array = img.copy()
    h, w = img_array.shape[:2]

    # Làm đối xứng trên-dưới
    for y in range(h // 2):
        for x in range(w):
            top = img_array[y, x]
            bottom = img_array[h - y - 1, x]
            
            # Xử lý cho cả ảnh grayscale và RGB
            if len(img_array.shape) == 3:  # RGB
                min_value = np.minimum(top, bottom)
            else:  # Grayscale
                min_value = min(top, bottom)
            # Chuẩn hóa về binary (0 hoặc 255)
            if min_value > 127:
                min_value = 255
            else:
                min_value = 0
            img_array[y, x] = min_value
            img_array[h - y - 1, x] = min_value
    
    return img_array

def centripetal_symmetric(img: np.ndarray) -> np.ndarray:
    """Áp dụng cả đối xứng trái-phải và trên-dưới"""
    new_img = vertical_symmetric(img)
    new_img = horizontal_symmetric(new_img)
    return new_img

def normalize_to_binary(img_array: np.ndarray) -> np.ndarray:
    """Chuẩn hóa ảnh về binary (đen trắng)"""
    # Nếu là RGB, chuyển sang grayscale
    if len(img_array.shape) == 3:
        img_gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        img_gray = img_array.copy()
    
    # Threshold để tạo binary image
    _, binary = cv2.threshold(img_gray, 127, 255, cv2.THRESH_BINARY)
    
    return binary


def smooth_binary_foreground(binary: np.ndarray, kernel_size: int = 3) -> np.ndarray:
    """
    Morphological opening nhẹ trên vùng trắng (foreground 255).
    Giảm gờ trắng mỏng / nhiễu 1 pixel gần mép ảnh hoặc viền đen (findContours thường lởm chởm ở biên).
    binary: uint8 2D, 0 = nền, 255 = trắng.
    """
    if binary.size == 0 or kernel_size < 2:
        return binary
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
    return cv2.morphologyEx(binary, cv2.MORPH_OPEN, k, iterations=1)


def smooth_binary_pil(image: Image.Image) -> Image.Image:
    """Áp dụng smooth_binary_foreground cho PIL (L hoặc RGB grayscale)."""
    arr = np.array(image)
    if len(arr.shape) == 3:
        arr = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    arr = smooth_binary_foreground(arr)
    return Image.fromarray(arr)

def normalize_image_to_binary(image: Image.Image) -> Image.Image:
    """Chuẩn hóa ảnh PIL về binary (0-1, trắng-đen)"""
    # Convert to RGB if needed
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    # Chuyển sang numpy array
    img_array = np.array(image)
    
    # Chuyển sang grayscale
    img_gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    
    # Threshold để tạo binary image (0 hoặc 255)
    _, binary = cv2.threshold(img_gray, 127, 255, cv2.THRESH_BINARY)
    
    # Nếu background là trắng (nhiều pixel trắng), invert lại
    if np.mean(binary) < 127:
        binary = cv2.bitwise_not(binary)
    
    # Convert back to PIL Image
    return Image.fromarray(binary)


def add_black_border(image: Image.Image, width: int = 2) -> Image.Image:
    """Thêm viền đen quanh toàn bộ ảnh (border dày `width` pixel, màu đen)."""
    img_array = np.array(image)
    # copyMakeBorder: top, bottom, left, right = width, value = 0 (đen)
    bordered = cv2.copyMakeBorder(
        img_array, width, width, width, width,
        cv2.BORDER_CONSTANT, value=0
    )
    return Image.fromarray(bordered)


def process_image(image: Image.Image) -> Image.Image:
    """
    Cắt ảnh từ bốn biên vào giữa cho đến khi gặp pixel đen đầu tiên ở mỗi phía
    (trên, dưới, trái, phải), rồi trả về ảnh đã cắt.
    """
    img_array = np.array(image)
    if len(img_array.shape) == 3:
        # Grayscale để kiểm tra pixel đen (0)
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    h, w = gray.shape
    # Mặc định giữ nguyên ảnh nếu không tìm thấy pixel đen
    top, bottom = 0, h - 1
    left, right = 0, w - 1

    # Từ trên xuống: hàng đầu tiên có ít nhất một pixel đen
    for y in range(h):
        if np.any(gray[y, :] == 0):
            top = y
            break

    # Từ dưới lên: hàng đầu tiên có ít nhất một pixel đen
    for y in range(h - 1, -1, -1):
        if np.any(gray[y, :] == 0):
            bottom = y
            break

    # Từ trái sang: cột đầu tiên có ít nhất một pixel đen
    for x in range(w):
        if np.any(gray[:, x] == 0):
            left = x
            break

    # Từ phải sang: cột đầu tiên có ít nhất một pixel đen
    for x in range(w - 1, -1, -1):
        if np.any(gray[:, x] == 0):
            right = x
            break

    cropped = img_array[top : bottom + 1, left : right + 1]
    return Image.fromarray(cropped)


def get_contours_advanced(image: Image.Image, apply_symmetry: bool = True, small_area: int = 1000) -> ContoursResponse:
    """Lấy contours với logic từ notebook: đối xứng và loại bỏ contours nhỏ"""
    # Convert to RGB if needed
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    # Chuyển sang numpy array và grayscale
    img_array = np.array(image)
    if len(img_array.shape) == 3:
        img_gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        img_gray = img_array
    
    # Áp dụng đối xứng nếu cần
    if apply_symmetry:
        img_binary = centripetal_symmetric(img_gray)
    else:
        img_binary = normalize_to_binary(img_gray)

    # Làm mượt biên trắng: bỏ gờ thừa gần mép ảnh / viền đen trước khi tìm contour
    img_binary = smooth_binary_foreground(img_binary)
    
    # Tìm contours
    contours, _ = cv2.findContours(img_binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    
    
    # Loại bỏ contours nhỏ
    removed = 0
    for cnt in contours:
        if cv2.contourArea(cnt) < small_area:
            cv2.drawContours(img_binary, [cnt], -1, 0, thickness=-1)
            removed += 1
    
    if removed > 0:
        print(f"Filled {removed} tiny contours (area < {small_area})")
    
    # Tìm contours lại sau khi loại bỏ contours nhỏ
    contours, _ = cv2.findContours(img_binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    
    # Chuyển đổi sang JSON format
    contours_json = contours_to_json(contours)
    
    # Vẽ contours trên ảnh binary (chuẩn hóa về RGB để hiển thị)
    img_rgb = cv2.cvtColor(img_binary, cv2.COLOR_GRAY2RGB)
    preview_img = img_rgb.copy()
    cv2.drawContours(preview_img, contours, -1, (0, 255, 0), 2)
    
    # Tạo preview image
    preview_pil = Image.fromarray(preview_img)
    preview_base64 = image_to_base64(preview_pil)
    
    # Original image (binary)
    original_pil = Image.fromarray(img_binary)
    original_base64 = image_to_base64(original_pil)
    
    return ContoursResponse(
        contours=contours_json,
        previewImg=preview_base64,
        originalImg=original_base64
    )

def get_contours(img: np.ndarray):
    """Lấy contours từ ảnh grayscale"""
    contours, _ = cv2.findContours(img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    contour_img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    cv2.drawContours(contour_img, contours, -1, (0, 255, 0), 2)
    
    return contour_img, contours

def contours_to_json(contours) -> List[Contour]:
    """Chuyển đổi OpenCV contours sang JSON format"""
    result = []
    for idx, cnt in enumerate(contours):
        # Lấy diện tích
        area = cv2.contourArea(cnt)
        
        # Lấy bounding box
        x, y, w, h = cv2.boundingRect(cnt)
        
        # Chuyển đổi points
        points = []
        for point in cnt:
            points.append(ContourPoint(x=int(point[0][0]), y=int(point[0][1])))
        
        result.append(Contour(
            id=idx,
            points=points,
            area=float(area),
            boundingBox=(int(x), int(y), int(w), int(h))
        ))
    
    return result

def extract_contours_from_image(image: Image.Image) -> ContoursResponse:
    """Extract contours từ ảnh và trả về dạng JSON"""
    # Convert to RGB if needed
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    # Chuyển sang grayscale
    img_gray = image.convert('L')
    img_array = np.array(img_gray)
    
    # Threshold để tạo binary image
    # Thử nghiệm với cả hai cách threshold
    _, binary = cv2.threshold(img_array, 127, 255, cv2.THRESH_BINARY)
    
    # Nếu background là trắng (nhiều pixel trắng), invert lại
    if np.mean(binary) > 127:
        binary = cv2.bitwise_not(binary)
    
    # Lấy contours - dùng RETR_TREE để lấy contours có phân cấp (cha-con)
    # RETR_EXTERNAL: chỉ lấy contours ngoài cùng
    # RETR_LIST: lấy tất cả contours không phân cấp
    # RETR_TREE: lấy tất cả contours có phân cấp cha-con (tốt nhất cho contours lồng nhau)
    contours, hierarchy = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    # Lọc bỏ contours quá nhỏ (nhiễu)
    min_area = 1 
    filtered_contours = []
    filtered_hierarchy = []
    
    if hierarchy is not None:
        for i, cnt in enumerate(contours):
            area = cv2.contourArea(cnt)
            if area > min_area:
                filtered_contours.append(cnt)
                filtered_hierarchy.append(hierarchy[0][i])
    
    # Lọc bỏ contour lớn nhất (thường là contour bao quanh toàn bộ ảnh)
    if len(filtered_contours) > 1:
        areas = [cv2.contourArea(cnt) for cnt in filtered_contours]
        max_area_idx = areas.index(max(areas))
        max_area = max(areas)
        img_area = img_array.shape[0] * img_array.shape[1]
        
        # Nếu contour lớn nhất chiếm > 80% diện tích ảnh, bỏ nó đi
        if max_area > img_area * 0.8:
            filtered_contours.pop(max_area_idx)
            print(f"[DEBUG] Removed largest contour (area={max_area:.0f}, {max_area/img_area*100:.1f}% of image)")
    
    contours = filtered_contours
    
    print(f"[DEBUG] Found {len(contours)} contours after filtering (min_area={min_area})")
    
    # Chuyển đổi sang JSON format
    contours_json = contours_to_json(contours)
    
    # Vẽ contours trên ảnh GỐC (không phải binary)
    img_rgb = np.array(image)
    preview_img = img_rgb.copy()
    cv2.drawContours(preview_img, contours, -1, (0, 255, 0), 2)
    
    # Tạo preview image với contours được vẽ
    preview_pil = Image.fromarray(preview_img)
    preview_base64 = image_to_base64(preview_pil)
    
    # Original image - chuẩn hóa về binary
    binary_pil = Image.fromarray(binary)
    original_base64 = image_to_base64(binary_pil)
    
    return ContoursResponse(
        contours=contours_json,
        previewImg=preview_base64,
        originalImg=original_base64
    )

def min_area_quad_from_contour_points(points: List[ContourPoint]) -> List[QuadPoint]:
    """
    4 đỉnh của hình chữ nhật có diện tích nhỏ nhất bao quanh polygon (cv2.minAreaRect + boxPoints).
    Dùng để reset quad trong Quad Transform về đúng hình chữ nhật bao quanh contour.
    """
    pts = np.array([[p.x, p.y] for p in points], dtype=np.float32)
    if len(pts) < 3:
        raise ValueError("Cần ít nhất 3 điểm")
    rect = cv2.minAreaRect(pts)
    box = cv2.boxPoints(rect)
    return [QuadPoint(x=float(p[0]), y=float(p[1])) for p in box]


def _order_points_clockwise(pts: np.ndarray) -> np.ndarray:
    """Sort 2D points in clockwise order around centroid and start at top-left-ish."""
    pts = np.asarray(pts, dtype=np.float32)
    if len(pts) == 0:
        return pts
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    order = np.argsort(ang)
    pts = pts[order]
    start = int(np.argmin(pts[:, 0] + pts[:, 1]))
    return np.roll(pts, -start, axis=0)


def _max_point_line_distance(pts: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    ab = b - a
    denom = float(np.hypot(ab[0], ab[1]))
    if denom < 1e-6:
        d = pts - a
        return float(np.max(np.hypot(d[:, 0], d[:, 1])))
    ap = pts - a
    cross = np.abs(ap[:, 0] * ab[1] - ap[:, 1] * ab[0])
    return float(np.max(cross / denom))


def _point_line_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    """Perpendicular distance from a single point to line AB."""
    ab = b - a
    denom = float(np.hypot(ab[0], ab[1]))
    if denom < 1e-6:
        d = p - a
        return float(np.hypot(d[0], d[1]))
    return float(abs((p[0] - a[0]) * ab[1] - (p[1] - a[1]) * ab[0]) / denom)


def _dedupe_consecutive_closed(pts: np.ndarray, atol: float = 0.5) -> np.ndarray:
    """Bỏ các điểm trùng hoặc quá sát nhau liên tiếp trên contour/polygon kín."""
    pts = np.asarray(pts, dtype=np.float32)
    if len(pts) == 0:
        return pts
    out = [pts[0]]
    for p in pts[1:]:
        if float(np.hypot(*(p - out[-1]))) > atol:
            out.append(p)
    out = np.asarray(out, dtype=np.float32)
    if len(out) > 1 and float(np.hypot(*(out[0] - out[-1]))) <= atol:
        out = out[:-1]
    return out


def _remove_short_edges_closed(poly: np.ndarray, min_edge_len: float) -> np.ndarray:
    """Gộp các đỉnh tạo ra cạnh quá ngắn (thường là cụm điểm ở góc bậc thang)."""
    poly = np.asarray(poly, dtype=np.float32)
    changed = True
    while changed and len(poly) > 3:
        changed = False
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            if float(np.hypot(*(poly[j] - poly[i]))) >= min_edge_len:
                continue
            prev_pt = poly[(i - 1) % n]
            cur_pt = poly[i]
            next_pt = poly[j]
            after_pt = poly[(j + 1) % n]
            d_cur = _point_line_distance(cur_pt, prev_pt, after_pt)
            d_next = _point_line_distance(next_pt, prev_pt, after_pt)
            remove_idx = i if d_cur <= d_next else j
            poly = np.delete(poly, remove_idx, axis=0)
            changed = True
            break
    return poly


def _remove_near_collinear_points_closed(poly: np.ndarray, line_tol: float) -> np.ndarray:
    """Bỏ đỉnh gần như thẳng hàng với hai đỉnh kề trước/sau."""
    poly = np.asarray(poly, dtype=np.float32)
    changed = True
    while changed and len(poly) > 3:
        changed = False
        n = len(poly)
        for i in range(n):
            prev_pt = poly[(i - 1) % n]
            cur_pt = poly[i]
            next_pt = poly[(i + 1) % n]
            if _point_line_distance(cur_pt, prev_pt, next_pt) <= line_tol:
                poly = np.delete(poly, i, axis=0)
                changed = True
                break
    return poly


def _uniform_subsample_closed(poly: np.ndarray, max_points: int) -> np.ndarray:
    """Giảm số điểm khi polygon còn quá dày."""
    poly = np.asarray(poly, dtype=np.float32)
    if len(poly) <= max_points:
        return poly
    idxs = np.linspace(0, len(poly), max_points, endpoint=False).round().astype(int)
    idxs = np.clip(idxs, 0, len(poly) - 1)
    idxs = np.unique(idxs)
    return poly[idxs]


def _point_segment_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    """Khoảng cách ngắn nhất từ điểm p tới đoạn thẳng AB."""
    p = np.asarray(p, dtype=np.float32)
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    ab = b - a
    denom = float(np.dot(ab, ab))
    if denom < 1e-6:
        d = p - a
        return float(np.hypot(d[0], d[1]))
    t = float(np.dot(p - a, ab) / denom)
    t = max(0.0, min(1.0, t))
    q = a + t * ab
    d = p - q
    return float(np.hypot(d[0], d[1]))


def _max_distance_to_closed_polygon(pts: np.ndarray, poly: np.ndarray) -> float:
    """Max khoảng cách từ tập điểm pts tới biên polygon kín poly."""
    pts = np.asarray(pts, dtype=np.float32)
    poly = np.asarray(poly, dtype=np.float32)
    if len(pts) == 0 or len(poly) < 2:
        return 0.0
    n = len(poly)
    max_d = 0.0
    for p in pts:
        d = min(_point_segment_distance(p, poly[i], poly[(i + 1) % n]) for i in range(n))
        max_d = max(max_d, d)
    return float(max_d)


def adaptive_polygon_from_contour_points(
    points: List[ContourPoint],
    d_tol: float = 3.0,
    max_points: int = 96,
) -> List[QuadPoint]:
    """
    Tạo polygon ít điểm nhưng ổn định cho contour ảnh binary.

    Ý tưởng:
    1) Lấy convex hull để bỏ các lõm/răng cưa nhỏ do raster.
    2) Nếu contour rất gần minAreaRect -> snap thẳng về 4 góc box.
       Điều này xử lý case như contour 13: chỉ còn 1 điểm ở mỗi góc.
    3) Nếu không phải rectangle, thử nhiều mức epsilon của Douglas-Peucker
       và chọn candidate có ít điểm nhất nhưng vẫn giữ shape đủ sát hull.
       Cách này giúp các contour kiểu 6 / 14 / 15 ổn định và đồng nhất số điểm.
    """
    pts = np.array([[p.x, p.y] for p in points], dtype=np.float32)
    pts = _dedupe_consecutive_closed(pts)
    if len(pts) < 3:
        raise ValueError("Cần ít nhất 3 điểm")

    hull = cv2.convexHull(pts.reshape((-1, 1, 2))).reshape((-1, 2)).astype(np.float32)
    hull = _dedupe_consecutive_closed(hull)
    if len(hull) < 3:
        return min_area_quad_from_contour_points(points)

    x, y, w, h = cv2.boundingRect(hull.astype(np.int32))
    min_dim = float(min(w, h))
    max_dim = float(max(w, h))
    perimeter = float(cv2.arcLength(hull.reshape((-1, 1, 2)), True))
    hull_area = float(cv2.contourArea(hull.reshape((-1, 1, 2))))
    if hull_area < 1e-6:
        return min_area_quad_from_contour_points(points)

    # 1) Rectangle snap cho các contour gần hình chữ nhật / hình vuông.
    rect = cv2.minAreaRect(hull.reshape((-1, 1, 2)))
    box = cv2.boxPoints(rect).astype(np.float32)
    box_area = float(abs(cv2.contourArea(box.reshape((-1, 1, 2)))))
    box_fill_ratio = hull_area / max(box_area, 1e-6)
    box_max_dist = _max_distance_to_closed_polygon(hull, box)
    rect_snap_tol = max(9.5, 0.042 * max_dim, d_tol * 2.4)
    if box_fill_ratio >= 0.94 and box_max_dist <= rect_snap_tol:
        poly = _order_points_clockwise(box)
        poly = _uniform_subsample_closed(poly, max_points=max_points)
        return [QuadPoint(x=float(p[0]), y=float(p[1])) for p in poly]

    # 2) Thử nhiều epsilon và chọn polygon có ít điểm nhất nhưng vẫn đủ sát hull.
    area_ratio_tol = 0.895
    shape_tol = max(9.5, 0.042 * max_dim, d_tol * 2.4)
    base_floor = max(float(d_tol * 2.0), 0.02 * min_dim)

    best_poly = None
    best_key = None
    for mult in [0.012, 0.014, 0.016, 0.018, 0.020, 0.024]:
        epsilon = max(base_floor, float(mult * perimeter))
        cand = cv2.approxPolyDP(hull.reshape((-1, 1, 2)), epsilon, True).reshape((-1, 2)).astype(np.float32)
        cand = _dedupe_consecutive_closed(cand)
        if len(cand) < 3:
            continue

        cand_area = float(abs(cv2.contourArea(cand.reshape((-1, 1, 2)))))
        cand_area_ratio = cand_area / hull_area
        cand_max_dist = _max_distance_to_closed_polygon(hull, cand)

        if cand_area_ratio < area_ratio_tol or cand_max_dist > shape_tol:
            continue

        key = (len(cand), cand_max_dist, -cand_area_ratio)
        if best_key is None or key < best_key:
            best_key = key
            best_poly = cand

    if best_poly is None:
        epsilon = max(base_floor, float(0.014 * perimeter))
        best_poly = cv2.approxPolyDP(hull.reshape((-1, 1, 2)), epsilon, True).reshape((-1, 2)).astype(np.float32)

    if len(best_poly) < 3:
        return min_area_quad_from_contour_points(points)

    best_poly = _dedupe_consecutive_closed(best_poly)
    best_poly = _uniform_subsample_closed(best_poly, max_points=max_points)
    best_poly = _order_points_clockwise(best_poly)

    return [QuadPoint(x=float(p[0]), y=float(p[1])) for p in best_poly]


def get_quad_points_for_contours(contours: List[Contour]) -> dict:
    """Lấy 4 điểm góc của hình tứ giác bao trùm cho mỗi contour"""
    result = {}
    for contour in contours:
        if len(contour.points) < 3:
            continue
        try:
            result[contour.id] = adaptive_polygon_from_contour_points(
                contour.points,
                d_tol=3.5,
                max_points=12,
            )
        except ValueError:
            continue

    return result

def fill_polygon_in_image(image: Image.Image, quad_points: List[QuadPoint]) -> Image.Image:
    """Fill polygon với trắng bên trong, đen bên ngoài"""
    # Convert to RGB if needed
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    img_array = np.array(image)
    h, w = img_array.shape[:2]
    
    # Tạo ảnh binary mới (nền đen)
    result_array = np.zeros((h, w), dtype=np.uint8)
    
    # Chuyển đổi quad_points sang numpy array
    pts = np.array([[p.x, p.y] for p in quad_points], dtype=np.int32)
    
    # Fill polygon với màu trắng (255)
    cv2.fillPoly(result_array, [pts], 255)
    
    # Convert back to PIL Image (grayscale binary)
    result_image = Image.fromarray(result_array)
    
    return result_image

def fill_all_polygons_in_image(image: Image.Image, all_quad_points: dict) -> Image.Image:
    """
    Với mỗi polygon trong all_quad_points: tô trắng (255) bên trong polygon đó
    trên bản copy ảnh gốc (grayscale). Các pixel không thuộc polygon nào trong dict
    giữ nguyên — cho phép Apply chỉ một phần contour (các contour khác giữ ảnh gốc).
    """
    if image.mode != 'RGB':
        image = image.convert('RGB')

    img_array = np.array(image)
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array.copy()

    if not all_quad_points:
        return Image.fromarray(gray)

    result_array = gray.copy()

    for contour_id, quad_points in all_quad_points.items():
        if not quad_points or len(quad_points) < 3:
            continue

        if isinstance(quad_points[0], dict):
            pts = np.array([[p["x"], p["y"]] for p in quad_points], dtype=np.int32)
        else:
            pts = np.array([[p.x, p.y] for p in quad_points], dtype=np.int32)

        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(mask, [pts], 255)
        result_array[mask > 0] = 255

    result_image = Image.fromarray(result_array)
    return result_image

def fill_contour_in_image(image: Image.Image, contour: Contour, fill_color: Tuple[int, int, int]) -> Image.Image:
    """Fill một contour cụ thể trong ảnh"""
    # Convert to RGB if needed
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    # Sử dụng OpenCV để fill (tốt hơn PIL cho contours phức tạp)
    img_array = np.array(image)
    
    # OpenCV sử dụng BGR, cần convert từ RGB
    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
    
    # Chuyển đổi contour points về format OpenCV - ĐÚNG format cho cv2
    # cv2.drawContours cần format: (N, 1, 2)
    pts = np.array([[p.x, p.y] for p in contour.points], dtype=np.int32)
    pts = pts.reshape((-1, 1, 2))  # Reshape về (N, 1, 2)
    
    # Fill color cũng cần convert sang BGR
    fill_color_bgr = (fill_color[2], fill_color[1], fill_color[0])  # RGB -> BGR
    
    # Dùng drawContours với thickness=-1 để fill (reliable hơn fillPoly)
    cv2.drawContours(img_bgr, [pts], 0, fill_color_bgr, thickness=-1)
    
    # Convert back to RGB rồi PIL Image
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    result_image = Image.fromarray(img_rgb)
    
    return result_image


def apply_tool(image: Image.Image, tool: str) -> Image.Image:
    """Áp dụng công cụ xử lý ảnh"""
    if tool == 'sharpen':
        # Làm sắc nét ảnh
        return image.filter(ImageFilter.SHARPEN)
    
    elif tool == 'blur':
        # Làm mờ ảnh
        return image.filter(ImageFilter.GaussianBlur(radius=3))
    
    elif tool == 'brightness':
        # Tăng độ sáng
        enhancer = ImageEnhance.Brightness(image)
        return enhancer.enhance(1.5)  # Tăng 50% độ sáng
    
    elif tool == 'contrast':
        # Tăng độ tương phản
        enhancer = ImageEnhance.Contrast(image)
        return enhancer.enhance(1.5)  # Tăng 50% độ tương phản
    
    elif tool == 'saturation':
        # Tăng độ bão hòa màu
        enhancer = ImageEnhance.Color(image)
        return enhancer.enhance(1.5)  # Tăng 50% độ bão hòa
    # Làm đối xứng ảnh
    elif tool == 'fill_min':
        return fill_min(image)
    elif tool == 'fill_max':
        return fill_max(image)
    else:
        # Nếu không có tool hoặc tool không hợp lệ, trả về ảnh gốc
        return image