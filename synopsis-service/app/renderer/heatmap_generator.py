import cv2
import numpy as np
import logging
from typing import List
from pathlib import Path
from app.db.models import TrackSkeleton

logger = logging.getLogger(__name__)

class HeatmapGenerator:
    @staticmethod
    def generate(tubes: List[TrackSkeleton], width: int, height: int, output_path: str, bg_plate_path: str = None):
        logger.info(f"Generating heatmap for {len(tubes)} tubes at {width}x{height}...")
        
        # 1. Initialize empty density map
        density_map = np.zeros((height, width), dtype=np.float32)
        
        # 2. Accumulate footfall points
        for tube in tubes:
            for frame in tube.frames:
                x, y, w, h = frame.bbox
                
                # We care about the bottom center of the bounding box (the feet)
                foot_x = int(x + w / 2)
                foot_y = int(y + h)
                
                # Bound check
                if 0 <= foot_x < width and 0 <= foot_y < height:
                    # Add weight per frame
                    density_map[foot_y, foot_x] += 1.0
                    
        # 3. Apply Gaussian Blur to smooth the points into a density cloud
        blurred_map = cv2.GaussianBlur(density_map, (151, 151), 60)
        
        # 4. Normalize to 0-255
        max_val = np.max(blurred_map)
        if max_val > 0:
            normalized_map = (blurred_map / max_val * 255).astype(np.uint8)
        else:
            normalized_map = np.zeros((height, width), dtype=np.uint8)
            
        # 5. Apply colormap (JET goes from Blue (cold) to Red (hot))
        heatmap_color = cv2.applyColorMap(normalized_map, cv2.COLORMAP_JET)
        
        # 6. Composite with background plate if provided
        final_image = None
        if bg_plate_path:
            bg_img = cv2.imread(bg_plate_path)
            if bg_img is not None:
                bg_img = cv2.resize(bg_img, (width, height))
                # Create alpha mask from normalized density
                alpha = np.where(normalized_map > 3, np.clip(normalized_map * 2.5, 0, 255), 0).astype(np.float32) / 255.0
                alpha = np.expand_dims(alpha, axis=2)
                
                # Blend: Heatmap * alpha + BG * (1 - alpha)
                final_image = (heatmap_color * alpha + bg_img * (1 - alpha)).astype(np.uint8)
                
        if final_image is None:
            # Fallback to RGBA if no bg_plate
            alpha = np.where(normalized_map > 3, np.clip(normalized_map * 2.5, 0, 255), 0).astype(np.uint8)
            b, g, r = cv2.split(heatmap_color)
            final_image = cv2.merge([b, g, r, alpha])
        
        # 8. Save image
        cv2.imwrite(str(output_path), final_image)
        logger.info(f"Heatmap successfully saved to {output_path}")
