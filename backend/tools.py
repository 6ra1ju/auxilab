from fastapi import HTTPException
from fill_img import (
    app,
    ImageRequest,
    ImageResponse,
    ContoursResponse,
    FillContourRequest,
    QuadPoint,
    QuadTransformRequest,
    MinAreaQuadRequest,
    min_area_quad_from_contour_points,
    adaptive_polygon_from_contour_points,
    base64_to_image,
    image_to_base64,
    fill_min,
    fill_max,
    apply_tool,
    extract_contours_from_image,
    fill_contour_in_image,
    get_quad_points_for_contours,
    fill_polygon_in_image,
    fill_all_polygons_in_image,
    get_contours_advanced,
    normalize_image_to_binary,
    add_black_border,
    get_contours,
    process_image,
    smooth_binary_pil,
)

@app.post("/fill_img")
async def fill_img(request: ImageRequest) -> ImageResponse:
    try:
        # Chuyển đổi base64 thành PIL Image
        image = base64_to_image(request.img)
        
        # Áp dụng công cụ xử lý nếu có
        if request.tool:
            image = apply_tool(image, request.tool)
        
        # Chuyển đổi lại thành base64
        result_base64 = image_to_base64(image)
        
        return ImageResponse(img=result_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/get_contours")
async def get_contours_endpoint(request: ImageRequest) -> ContoursResponse:
    """
    Extract contours từ ảnh và trả về danh sách các contour
    Frontend có thể hiển thị và cho phép người dùng chọn từng contour
    """
    try:
        # Chuyển đổi base64 thành PIL Image
        image = base64_to_image(request.img)
        
        # Extract contours
        result = extract_contours_from_image(image)
        
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/fill_contour")
async def fill_contour_endpoint(request: FillContourRequest) -> ImageResponse:
    """
    Fill một contour cụ thể trong ảnh
    Frontend sẽ gửi contourId mà người dùng chọn
    """
    try:
        print(f"[DEBUG] Received fill_contour request for contourId: {request.contourId}")
        print(f"[DEBUG] Number of contours: {len(request.contours)}")
        print(f"[DEBUG] Fill color: {request.fillColor}")
        
        # Chuyển đổi base64 thành PIL Image
        image = base64_to_image(request.img)
        print(f"[DEBUG] Image loaded: size={image.size}, mode={image.mode}")
        
        # Tìm contour được chọn
        selected_contour = None
        for contour in request.contours:
            if contour.id == request.contourId:
                selected_contour = contour
                break
        
        if selected_contour is None:
            print(f"[ERROR] Contour {request.contourId} not found")
            raise HTTPException(status_code=404, detail="Contour not found")
        
        print(f"[DEBUG] Selected contour has {len(selected_contour.points)} points")
        print(f"[DEBUG] First few points: {[(p.x, p.y) for p in selected_contour.points[:5]]}")
        
        # Fill contour
        result_image = fill_contour_in_image(image, selected_contour, request.fillColor)
        print(f"[DEBUG] Fill completed successfully")
        print(f"[DEBUG] Result image size: {result_image.size}, mode: {result_image.mode}")
        
        # Chuyển đổi lại thành base64
        result_base64 = image_to_base64(result_image)
        
        return ImageResponse(img=result_base64)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in fill_contour: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/get_quad_points")
async def get_quad_points_endpoint(request: ImageRequest) -> dict:
    """
    Lấy 4 điểm góc của hình tứ giác bao trùm cho tất cả contours
    Tự động lấy contours với logic từ notebook (đối xứng và chuẩn hóa binary)
    """
    try:
        # Chuyển đổi base64 thành PIL Image
        image = base64_to_image(request.img)
        
        # Extract contours với logic từ notebook (đối xứng và binary)
        contours_data = get_contours_advanced(image, apply_symmetry=False, small_area=1000)
        
        # Lấy quad points cho mỗi contour
        quad_points_dict = get_quad_points_for_contours(contours_data.contours)
        
        # Chuyển đổi sang format dễ dùng cho frontend
        result = {}
        for contour_id, quad_points in quad_points_dict.items():
            result[str(contour_id)] = [{"x": p.x, "y": p.y} for p in quad_points]
        
        return {
            "quadPoints": result,
            "contours": [{"id": c.id, "points": [{"x": p.x, "y": p.y} for p in c.points], "area": c.area, "boundingBox": c.boundingBox} for c in contours_data.contours],
            "previewImg": contours_data.previewImg,
            "originalImg": contours_data.originalImg
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/min_area_quad_from_points")
async def min_area_quad_from_points_endpoint(request: MinAreaQuadRequest) -> dict:
    """
    Từ danh sách đỉnh contour, trả về 4 góc của hình chữ nhật bao nhỏ nhất (minAreaRect).
    Dùng khi reset quad trong Quad Transform.
    """
    try:
        quad = min_area_quad_from_contour_points(request.points)
        return {"quad": [{"x": p.x, "y": p.y} for p in quad]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/adaptive_polygon_from_points")
async def adaptive_polygon_from_points_endpoint(request: MinAreaQuadRequest) -> dict:
    """
    Từ danh sách đỉnh contour, trả về polygon bao quanh nhỏ nhất theo pipeline
    Douglas-Peucker đang dùng trong Quad Transform.
    Dùng khi reset polygon trong Quad Transform.
    """
    try:
        poly = adaptive_polygon_from_contour_points(
            request.points,
            d_tol=4.0,
            max_points=12,
        )
        return {"polygon": [{"x": p.x, "y": p.y} for p in poly]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/perspective_transform")
async def perspective_transform_endpoint(request: QuadTransformRequest) -> ImageResponse:
    """
    Tô trắng bên trong các polygon có trong allQuadPoints (ảnh nền = ảnh gốc grayscale).
    Chỉ các contour được gửi trong allQuadPoints mới được cập nhật.
    """
    try:
        # Chuyển đổi base64 thành PIL Image
        image = base64_to_image(request.img)
        
        # Fill tất cả các polygon từ tất cả contours
        result_image = fill_all_polygons_in_image(image, request.allQuadPoints)
        
        # Chuyển đổi lại thành base64
        result_base64 = image_to_base64(result_image)
        
        return ImageResponse(img=result_base64)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in perspective_transform: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/normalize_binary")
async def normalize_binary_endpoint(request: ImageRequest) -> ImageResponse:
    """
    Chuẩn hóa ảnh về binary (0-1, trắng-đen) ngay khi upload
    """
    try:
        # Chuyển đổi base64 thành PIL Image
        image = base64_to_image(request.img)
        
        # Chuẩn hóa về binary
        binary_image = normalize_image_to_binary(image)
        # Cắt từ bốn biên vào đến pixel đen đầu tiên (bỏ viền trắng thừa)
        binary_image = process_image(binary_image)
        # Thêm viền đen 2 pixel quanh toàn bộ ảnh
        binary_image = add_black_border(binary_image, width=2)
        # Giảm gờ trắng mỏng gần biên (artifact sau chuẩn hóa / viền)
        binary_image = smooth_binary_pil(binary_image)

        # Chuyển đổi lại thành base64
        result_base64 = image_to_base64(binary_image)
        
        return ImageResponse(img=result_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
