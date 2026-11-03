import React, { memo } from "react";
import PropTypes from "prop-types";
import "./Loader.css";
 
/**
 * Universal Loader Component for Mirador VMS
 *
 * @param {'area' | 'overlay' | 'fullscreen' | 'inline' | 'skeleton'} variant Display variant
 * @param {'sm' | 'md' | 'lg'} size Size of spinner
 * @param {string} text Optional label displayed beneath or beside spinner
 * @param {number} skeletonRows Number of placeholder rows if variant="skeleton"
 * @param {string} className Additional CSS class
 * @param {object} style Additional inline styles
 */
function Loader({
    variant = "area",
    size = "md",
    text = "",
    skeletonRows = 4,
    className = "",
    style = {},
}) {
    if (variant === "skeleton") {
        return (
            <div
                className={`mirador-loader__skeleton ${className}`}
                style={style}
                role="status"
                aria-busy="true"
                aria-label={text || "Loading content"}
            >
                {Array.from({ length: skeletonRows }).map((_, idx) => (
                    <div key={idx} className="mirador-loader__skeleton-row" />
                ))}
            </div>
        );
    }
 
    const containerClasses = [
        "mirador-loader",
        `mirador-loader--${variant}`,
        `mirador-loader--${size}`,
        className,
    ]
        .filter(Boolean)
        .join(" ");
 
    return (
        <div
            className={containerClasses}
            style={style}
            role="status"
            aria-busy="true"
            aria-label={text || "Loading"}
        >
            <div className="mirador-loader__spinner-box">
                <div className="mirador-loader__glow" />
                <div className="mirador-loader__ring" />
            </div>
 
            {text && <span className="mirador-loader__text">{text}</span>}
        </div>
    );
}
 
Loader.propTypes = {
    variant: PropTypes.oneOf(["area", "overlay", "fullscreen", "inline", "skeleton"]),
    size: PropTypes.oneOf(["sm", "md", "lg"]),
    text: PropTypes.string,
    skeletonRows: PropTypes.number,
    className: PropTypes.string,
    style: PropTypes.object,
};
 
export default memo(Loader);