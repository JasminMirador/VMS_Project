import { useEffect, useRef, useState } from "react";
import "./HeatmapLayer.css";
import { drawHeatmapToContext } from "./HeatmapLogic";

/**
 * HeatmapLayer — works identically for both MapView and DesignerView.
 * No special props needed. Both views now use the same cone origin formula.
 */
export default function HeatmapLayer({
  markers,
  cameras,
  scaleRef,
  offsetRef,
  wrapRef,
  showHeatmap,
  floorImgRef,
  activeZone,
  zones = [],
  onClose,
  onlyLegend = false,
}) {
  const densityRef = useRef(null);

  useEffect(() => {
    if (onlyLegend) return;
    const canvas = densityRef.current;
    if (!canvas) return;
    const wrap = wrapRef?.current;
    if (!wrap) return;

    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");

    if (!showHeatmap || markers.length === 0) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    drawHeatmapToContext(ctx, W, H, {
      markers,
      cameras,
      scale:     scaleRef?.current || 1,
      offset:    offsetRef?.current || { x: 0, y: 0 },
      activeZone,
      allZones:  zones,
      floorImg:  floorImgRef?.current,
      step:      3,
    });
  }, [showHeatmap, markers, cameras, scaleRef, offsetRef, wrapRef,
      floorImgRef, activeZone, zones, onlyLegend]);

  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX - translate.x;
    const startY = e.clientY - translate.y;

    const handleMouseMove = (moveEvent) => {
      setTranslate({
        x: moveEvent.clientX - startX,
        y: moveEvent.clientY - startY
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <>
      {!onlyLegend && (
        <canvas
          ref={densityRef}
          className="mv-heatmap-density-canvas"
          style={{ display: showHeatmap ? "block" : "none" }}
        />
      )}

      {showHeatmap && (
        <div 
          className="mv-heatmap-legend" 
          style={{ transform: `translate(${translate.x}px, ${translate.y}px)`, cursor: 'grab', pointerEvents: 'auto' }}
          onMouseDown={handleMouseDown}
        >
          <div className="mv-heatmap-legend__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              Coverage Heatmap
              {activeZone && (
                <span style={{ marginLeft: 6, fontSize: 9, color: "#f59e0b", fontWeight: 400 }}>
                  · zone only
                </span>
              )}
            </div>
            {onClose && (
              <button 
                onClick={(e) => { e.stopPropagation(); onClose(); }} 
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                title="Close"
              >✕</button>
            )}
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--none" />
            <span>Blind spot (No coverage)</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--single" />
            <span>Single camera coverage</span>
          </div>
          {/* <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--overlap" />
            <span>2-camera overlap</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--high" />
            <span>High density (3+ cameras)</span>
          </div> */}
        </div>
      )}
    </>
  );
}