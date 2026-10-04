import numpy as np
import logging
import random
import math
from typing import List, Dict, Tuple
from app.config import settings
from app.db.models import TrackSkeleton, ScheduleItem

logger = logging.getLogger(__name__)

class TubePacker:
    @staticmethod
    def calculate_spatial_iou(bbox1: List[int], bbox2: List[int]) -> float:
        """Computes Spatial Intersection-over-Union (IoU) between two bounding boxes."""
        x1, y1, w1, h1 = bbox1
        x2, y2, w2, h2 = bbox2

        xa = max(x1, x2)
        ya = max(y1, y2)
        xb = min(x1 + w1, x2 + w2)
        yb = min(y1 + h1, y2 + h2)

        inter_area = max(0, xb - xa) * max(0, yb - ya)
        if inter_area == 0:
            return 0.0

        box1_area = w1 * h1
        box2_area = w2 * h2
        union_area = float(box1_area + box2_area - inter_area)
        return inter_area / union_area if union_area > 0 else 0.0

    # --- Companion grouping config ---
    GROUP_DIST_THRESHOLD_FRAC = 0.25   # max center-to-center distance (fraction of frame diagonal) to count as "together"
    GROUP_MIN_COOCCURRENCE_S = 1.5     # must stay close for at least this long to count as companions, not just a passer-by

    def _find_companion_groups(self, tubes: List[TrackSkeleton], frame_width: float, frame_height: float) -> Dict[str, str]:
        """
        Detects tubes that walk / stand / interact together in the ORIGINAL footage
        (consistently close spatial proximity while temporally overlapping) and
        groups them via union-find, so the packer keeps them together on the
        synopsis timeline instead of splitting them into different time slots.
        """
        parent = {t.track_id: t.track_id for t in tubes}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        diag = math.sqrt(frame_width ** 2 + frame_height ** 2)
        dist_threshold = diag * self.GROUP_DIST_THRESHOLD_FRAC
        fps = 25.0

        for i in range(len(tubes)):
            for j in range(i + 1, len(tubes)):
                t1, t2 = tubes[i], tubes[j]
                
                clip_uuid1 = t1.track_id.split('_')[2] if len(t1.track_id.split('_')) > 2 else None
                clip_uuid2 = t2.track_id.split('_')[2] if len(t2.track_id.split('_')) > 2 else None
                if clip_uuid1 != clip_uuid2 or clip_uuid1 is None:
                    continue

                # Only tubes that actually co-occurred in the ORIGINAL footage can be "together"
                ov_start = max(float(t1.start_time), float(t2.start_time))
                ov_end = min(float(t1.end_time), float(t2.end_time))
                
                is_fragment = False
                if ov_end <= ov_start:
                    # No overlap. Check if they are sequential within 3 seconds
                    t1_end, t2_start = float(t1.end_time), float(t2.start_time)
                    t2_end, t1_start = float(t2.end_time), float(t1.start_time)
                    
                    gap = None
                    if 0 < t2_start - t1_end <= 10.0:
                        b1, b2 = t1.frames[-1].bbox, t2.frames[0].bbox
                        gap = t2_start - t1_end
                    elif 0 < t1_start - t2_end <= 10.0:
                        b1, b2 = t2.frames[-1].bbox, t1.frames[0].bbox
                        gap = t1_start - t2_end
                        
                    if gap is not None:
                        c1 = (b1[0] + b1[2] / 2.0, b1[1] + b1[3] / 2.0)
                        c2 = (b2[0] + b2[2] / 2.0, b2[1] + b2[3] / 2.0)
                        dist = math.hypot(c1[0] - c2[0], c1[1] - c2[1])
                        # Allow much larger distance for longer gaps (people move while occluded)
                        if dist < dist_threshold * (2.0 + gap * 1.5):
                            is_fragment = True

                if is_fragment:
                    logger.info(f"[Packer] Grouping {t1.track_id} + {t2.track_id} as fragmented track")
                    union(t1.track_id, t2.track_id)
                    continue

                if ov_end <= ov_start:
                    continue

                close_duration = 0.0
                t = ov_start
                step = 1.0 / fps
                while t < ov_end:
                    idx1 = int((t - float(t1.start_time)) * fps)
                    idx2 = int((t - float(t2.start_time)) * fps)
                    if 0 <= idx1 < len(t1.frames) and 0 <= idx2 < len(t2.frames):
                        b1, b2 = t1.frames[idx1].bbox, t2.frames[idx2].bbox
                        c1 = (b1[0] + b1[2] / 2.0, b1[1] + b1[3] / 2.0)
                        c2 = (b2[0] + b2[2] / 2.0, b2[1] + b2[3] / 2.0)
                        dist = math.hypot(c1[0] - c2[0], c1[1] - c2[1])
                        if dist < dist_threshold:
                            close_duration += step
                    t += step

                if close_duration >= self.GROUP_MIN_COOCCURRENCE_S:
                    logger.info(f"[Packer] Grouping {t1.track_id} + {t2.track_id} as companions ({close_duration:.1f}s close together)")
                    union(t1.track_id, t2.track_id)

        return {tid: find(tid) for tid in parent}

    def compute_schedule(self, tubes: List[TrackSkeleton], max_iou: float = None, frame_width: float = 1920, frame_height: float = 1080) -> List[ScheduleItem]:
        """
        Greedy 1D Interval Scheduling Algorithm.
        Packs N object tubes into a compressed synopsis timeline while ensuring 
        spatial overlap (IoU) between overlapping active tubes remains under max_iou (e.g. 0.15).
        Tubes that were walking/interacting together in the original footage ("companions")
        are packed as a single unit so they stay together in the synopsis output.
        """
        if max_iou is None:
            max_iou = settings.MAX_IOU_OVERLAP

        tubes_by_id = {t.track_id: t for t in tubes}
        group_of = self._find_companion_groups(tubes, frame_width, frame_height)

        groups: Dict[str, List[TrackSkeleton]] = {}
        for t in tubes:
            groups.setdefault(group_of[t.track_id], []).append(t)

        # Sort groups by the earliest original start time among their members
        sorted_groups = sorted(groups.values(), key=lambda g: min(float(t.start_time) for t in g))
        schedule: List[ScheduleItem] = []
        step_size_s = 0.2  # 200ms timeline shift step

        logger.info(f"Packing {len(tubes)} candidate tubes across {len(sorted_groups)} companion group(s) into synopsis schedule...")

        for group in sorted_groups:
            group_min_start = min(float(t.start_time) for t in group)
            member_ids = {t.track_id for t in group}

            candidate_start_s = 0.0
            placed = False
            while not placed:
                collision = False

                for member in group:
                    member_offset = float(member.start_time) - group_min_start
                    m_start = candidate_start_s + member_offset
                    m_end = m_start + member.duration_s

                    for item in schedule:
                        if item.track_id in member_ids:
                            continue  # companions are allowed (expected) to overlap each other

                        overlap_start = max(m_start, item.synopsis_start_s)
                        overlap_end = min(m_end, item.synopsis_start_s + item.duration_s)
                        if overlap_start < overlap_end:
                            placed_tube = tubes_by_id[item.track_id]
                            if self._check_spatial_collision(member, m_start, placed_tube, item.synopsis_start_s, max_iou):
                                collision = True
                                break
                    if collision:
                        break

                if not collision:
                    for member in group:
                        member_offset = float(member.start_time) - group_min_start
                        m_start = candidate_start_s + member_offset
                        schedule.append(ScheduleItem(
                            track_id=member.track_id,
                            synopsis_start_s=round(m_start, 2),
                            original_start_time=member.start_time,
                            original_end_time=member.end_time,
                            duration_s=member.duration_s
                        ))
                    placed = True
                else:
                    candidate_start_s += step_size_s

        logger.info(f"[Packer] Greedy schedule generated. Total tubes: {len(schedule)}")

        # Optional Refinement: Simulated Annealing (group-aware, see below)
        refined_schedule = self._optimize_with_simulated_annealing(schedule, tubes, max_iou, group_of)
        return refined_schedule

    def _check_spatial_collision(self, tube1: TrackSkeleton, start1: float, tube2: TrackSkeleton, start2: float, max_iou: float) -> bool:
        """Checks if spatial IoU between tube1 and tube2 exceeds max_iou threshold."""
        # Extract clip UUIDs to check if these tubes come from the exact same real-world video chunk
        clip_uuid1 = tube1.track_id.split('_')[2] if len(tube1.track_id.split('_')) > 2 else None
        clip_uuid2 = tube2.track_id.split('_')[2] if len(tube2.track_id.split('_')) > 2 else None
        same_clip = (clip_uuid1 is not None) and (clip_uuid1 == clip_uuid2)

        fps = 25.0
        end1 = start1 + tube1.duration_s
        end2 = start2 + tube2.duration_s
        overlap_start = max(start1, start2)
        overlap_end = min(end1, end2)
        if overlap_start >= overlap_end:
            return False  # no temporal overlap on the synopsis timeline at all

        t = overlap_start
        step = 1.0 / fps  # check EVERY synopsis frame in the overlap window, not every 5th
        while t < overlap_end:
            idx1 = int((t - start1) * fps)
            idx2 = int((t - start2) * fps)
            if 0 <= idx1 < len(tube1.frames) and 0 <= idx2 < len(tube2.frames):
                f1, f2 = tube1.frames[idx1], tube2.frames[idx2]

                # REALITY CHECK: If they physically co-occurred in reality at the same time,
                # we WANT them to overlap! Ignore the spatial collision so they stay together.
                if same_clip and abs(f1.frame_idx - f2.frame_idx) < (0.2 * fps):
                    t += step
                    continue

                if self.calculate_spatial_iou(f1.bbox, f2.bbox) > max_iou:
                    return True
            t += step
        return False

    def _calculate_schedule_cost(self, schedule: List[ScheduleItem], tubes_map: Dict[str, TrackSkeleton], max_iou: float) -> float:
        """
        Calculates the global cost of a schedule.
        Cost = α × spatial_overlap + β × synopsis_duration + γ × chronological_violation
        """
        alpha, beta, gamma = 100.0, 1.0, 0.5
        
        if not schedule: return 0.0
        
        # 1. Synopsis Duration Cost
        duration = max(item.synopsis_start_s + item.duration_s for item in schedule)
        cost_duration = beta * duration
        
        # 2. Spatial Overlap Cost & 3. Chronological Violation Cost
        cost_overlap = 0.0
        cost_chrono = 0.0
        
        for i, item1 in enumerate(schedule):
            t1 = tubes_map[item1.track_id]
            for j in range(i + 1, len(schedule)):
                item2 = schedule[j]
                t2 = tubes_map[item2.track_id]
                
                # Overlap penalty
                overlap_start = max(item1.synopsis_start_s, item2.synopsis_start_s)
                overlap_end = min(item1.synopsis_start_s + item1.duration_s, item2.synopsis_start_s + item2.duration_s)
                if overlap_start < overlap_end:
                    if self._check_spatial_collision(t1, item1.synopsis_start_s, t2, item2.synopsis_start_s, max_iou):
                        cost_overlap += alpha # Heavy penalty for exceeding max_iou
                
                # Chronological violation penalty
                orig_diff = float(item1.original_start_time) - float(item2.original_start_time)
                syn_diff = item1.synopsis_start_s - item2.synopsis_start_s
                # If they were originally ordered A then B, but in synopsis B starts before A
                if orig_diff * syn_diff < 0:
                    cost_chrono += gamma
                    
        return cost_overlap + cost_duration + cost_chrono

    def _optimize_with_simulated_annealing(self, initial_schedule: List[ScheduleItem], tubes: List[TrackSkeleton], max_iou: float, group_of: Dict[str, str] = None) -> List[ScheduleItem]:
        """
        Simulated Annealing optimizer to refine the greedy schedule.
        Randomly perturbs tube start times to find a lower global cost.
        Companion tubes (group_of) are always shifted together as one unit so
        the annealing step can never pull them apart on the synopsis timeline.
        """
        if not initial_schedule:
            return initial_schedule

        if group_of is None:
            group_of = {t.track_id: t.track_id for t in tubes}

        logger.info("[Packer] Starting Simulated Annealing optimization...")
        tubes_map = {t.track_id: t for t in tubes}
        
        current_schedule = [ScheduleItem(**item.model_dump()) for item in initial_schedule]
        current_cost = self._calculate_schedule_cost(current_schedule, tubes_map, max_iou)
        
        best_schedule = [ScheduleItem(**item.model_dump()) for item in current_schedule]
        best_cost = current_cost
        
        temp = 100.0
        cooling_rate = 0.95
        min_temp = 1.0
        iterations_per_temp = 20
        
        while temp > min_temp:
            for _ in range(iterations_per_temp):
                # Create a neighbor schedule by randomly shifting one companion GROUP
                # (all members of the group move together, preserving their relative offsets)
                neighbor_schedule = [ScheduleItem(**item.model_dump()) for item in current_schedule]
                idx = random.randint(0, len(neighbor_schedule) - 1)
                target_group = group_of[neighbor_schedule[idx].track_id]

                # Shift start time between -2.0s and +2.0s
                shift = random.uniform(-2.0, 2.0)
                for item in neighbor_schedule:
                    if group_of[item.track_id] == target_group:
                        item.synopsis_start_s = max(0.0, item.synopsis_start_s + shift)
                
                neighbor_cost = self._calculate_schedule_cost(neighbor_schedule, tubes_map, max_iou)
                
                # Acceptance probability
                if neighbor_cost < current_cost:
                    current_schedule = neighbor_schedule
                    current_cost = neighbor_cost
                    if current_cost < best_cost:
                        best_schedule = [ScheduleItem(**item.model_dump()) for item in current_schedule]
                        best_cost = current_cost
                else:
                    # Accept worse solution with some probability (exploration)
                    probability = math.exp((current_cost - neighbor_cost) / temp)
                    if random.random() < probability:
                        current_schedule = neighbor_schedule
                        current_cost = neighbor_cost
                        
            temp *= cooling_rate
            
        logger.info(f"[Packer] SA Optimization finished. Cost improved to {best_cost:.2f}")
        return best_schedule