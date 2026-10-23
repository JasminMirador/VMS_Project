import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, Panel, MarkerType, Handle, Position,
  EdgeLabelRenderer, getSmoothStepPath, BaseEdge
} from 'reactflow';
import 'reactflow/dist/style.css';
import SpecularButton from "../../components/shared/SpecularButton";
import { useTheme } from "../../context/ThemeContext";
import './Topology.css';

const API_BASE = (import.meta.env.VITE_API_URL || "") + "/api/infrastructure";

const BW_SPIKE_THRESHOLD_MBPS = 80;

// ─── HIERARCHICAL LAYOUT ─────────────────────────────────────────────────────
const DEVICE_TIER = {
  'router':       0,
  'core-switch':  1,
  'switch':       2,
  'poe-switch':   2,
  'access_point': 2,
  'server':       3,
  'nvr':          3,
  'nas':          3,
  'camera':       4,
  'workstation':  4,
  'printer':      4,
  'iot':          4,
  'other':        4,
  'unknown':      4,
};
const TIER_Y = [60, 180, 300, 440, 580];
const H_GAP  = 200;
const V_GAP  = 160;

function autoLayout(nodes) {
  const needsLayout = nodes.filter(n => !n._hasPosition && (!n.position || typeof n.position.x !== 'number'));
  if (needsLayout.length === 0) return nodes;

  const byTier = {};
  needsLayout.forEach(n => {
    const type = n.data?.type || n.type || 'unknown';
    const tier = DEVICE_TIER[type] ?? 4;
    (byTier[tier] = byTier[tier] || []).push(n);
  });

  const positioned = new Map(nodes.filter(n => n._hasPosition || (n.position && typeof n.position.x === 'number')).map(n => [n.id, n]));

  Object.entries(byTier).forEach(([tierStr, tierNodes]) => {
    const tier = parseInt(tierStr, 10);
    const baseY = TIER_Y[tier] ?? (580 + (tier - 4) * V_GAP);
    const maxPerRow = 8;
    tierNodes.forEach((n, i) => {
      const row = Math.floor(i / maxPerRow);
      const col = i % maxPerRow;
      const countInRow = Math.min(tierNodes.length - row * maxPerRow, maxPerRow);
      const startX = Math.max(120, 550 - ((countInRow - 1) * H_GAP) / 2);
      const pos = {
        x: Math.round(startX + col * H_GAP),
        y: Math.round(baseY + row * 130)
      };
      positioned.set(n.id, { ...n, position: pos, _hasPosition: true });
    });
  });

  return nodes.map(n => positioned.get(n.id) || n);
}

// ─── Icons ───────────────────────────────────────────────────────────────────
const Icon = ({ type, size = 20, model = '', subtype = '' }) => {
  const s = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2.5', width: size, height: size };
  switch (type) {
    case 'camera': {
      const isDome = (subtype || '').toLowerCase().includes('dome') || (model || '').toLowerCase().includes('dome');
      const isPtz = (subtype || '').toLowerCase().includes('ptz') || (model || '').toLowerCase().includes('ptz');
      
      if (isDome) {
        return (
          <svg viewBox="0 0 100 100" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 12px rgba(0,0,0,0.6))' }}>
            <g transform="translate(50, 50) scale(3.5)">
              <circle cx="0" cy="0" r="11" fill="#ffffff" stroke="#000000" strokeWidth="1" />
              <circle cx="3" cy="0" r="8.5" fill="#222222" stroke="#ffffff" strokeWidth="1.5" />
              <circle cx="3" cy="0" r="8.5" fill="none" stroke="#000000" strokeWidth="1" />
              <circle cx="4" cy="0" r="5" fill="#111111" stroke="#000000" strokeWidth="1" />
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => {
                const a = (i / 12) * Math.PI * 2;
                return <circle key={i} cx={4 + Math.cos(a) * 3.8} cy={Math.sin(a) * 3.8} r="0.6" fill="#dddddd" />
              })}
              <circle cx="4" cy="0" r="2" fill="#000000" />
              <circle cx="4.5" cy="-0.5" r="0.5" fill="rgba(255,255,255,0.6)" />
            </g>
          </svg>
        );
      } else if (isPtz) {
        return (
          <svg viewBox="0 0 100 100" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 12px rgba(0,0,0,0.6))' }}>
            <g transform="translate(50, 50) scale(2.8)">
              <polygon points="-10,-6 -10,10 -14,12 -14,-8" fill="#ffffff" stroke="#000000" strokeWidth="1" />
              <polygon points="-10,0 -4,-2 -4,2 -10,4" fill="#ffffff" stroke="#000000" strokeWidth="1" />
              <polygon points="-4,-3 -4,3 -2,3 -2,-3" fill="#ffffff" stroke="#000000" strokeWidth="1" />
              <path d="M-2,-3 L-2,3 C4,8 6,9 8,9 L8,-9 C6,-9 4,-8 -2,-3 Z" fill="#ffffff" stroke="#000000" strokeWidth="1" />
              <path d="M8,-8 L8,8 C14,8 16,4 16,0 C16,-4 14,-8 8,-8 Z" fill="#1a1a1a" stroke="#000000" strokeWidth="1" />
              <rect x="8" y="-3" width="4" height="6" rx="1" fill="#262626" />
              <circle cx="10" cy="0" r="1.8" fill="#000000" />
            </g>
          </svg>
        );
      }

      // Default Bullet Camera
      return (
        <svg viewBox="0 0 100 100" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 12px rgba(0,0,0,0.6))' }}>
          <g transform="translate(45, 45) scale(2.2)">
            <polygon points="5,10 10,8 10,18 5,20" fill="#ffffff" stroke="#000000" strokeWidth="1" />
            <polygon points="5,10 2,11 2,21 5,20" fill="#f5f5f5" stroke="#000000" strokeWidth="1" />
            <polygon points="-2,14 5,12 5,15 -2,17" fill="#ffffff" stroke="#000000" strokeWidth="1" />
            <polygon points="-4,0 0,-1 0,14 -4,15" fill="#ffffff" stroke="#000000" strokeWidth="1" />
            <path d="M-12,-7 L8,-7 C12,-7 12,7 8,7 L-12,7 C-8,7 -8,-7 -12,-7 Z" fill="#ffffff" stroke="#000000" strokeWidth="1" />
            <path d="M-14,-8 L10,-8 C16,-8 16,-1 10,-1 L-14,-1 Z" fill="#ffffff" stroke="#000000" strokeWidth="1" />
            <ellipse cx="8" cy="0" rx="2.5" ry="6.5" fill="#1b3039" stroke="#000000" strokeWidth="1" />
            <ellipse cx="8" cy="0" rx="1.2" ry="3.5" fill="none" stroke="#ffffff" strokeWidth="1" />
            <ellipse cx="8" cy="0" rx="0.5" ry="1.5" fill="#000000" />
          </g>
        </svg>
      );
    }
    case 'switch': return (
      <svg viewBox="0 0 100 50" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 8px rgba(0,0,0,0.6))' }}>
        <defs>
          <linearGradient id="swTop" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#d1d5db"/><stop offset="50%" stopColor="#f3f4f6"/><stop offset="100%" stopColor="#9ca3af"/></linearGradient>
          <linearGradient id="swFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#cbd5e1"/><stop offset="100%" stopColor="#94a3b8"/></linearGradient>
          <linearGradient id="swRight" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e2e8f0"/><stop offset="100%" stopColor="#cbd5e1"/></linearGradient>
        </defs>
        
        <g stroke="#000" strokeWidth="1" strokeLinejoin="round">
          {/* Top Face */}
          <polygon points="10,20 80,20 95,10 25,10" fill="url(#swTop)" />
          {/* Right Face */}
          <polygon points="80,20 95,10 95,30 80,40" fill="url(#swRight)" />
          {/* Front Face */}
          <rect x="10" y="20" width="70" height="20" fill="url(#swFront)" />
        </g>

        {/* Ports */}
        {[13, 17, 21, 25, 29, 33, 37, 41].map(x => (
          <g key={`port-${x}`}>
            <rect x={x} y="24" width="2.5" height="2.5" fill="#000" />
            <rect x={x} y="31" width="2.5" height="2.5" fill="#000" />
          </g>
        ))}

        {/* LED Panel */}
        <rect x="50" y="24" width="26" height="12" rx="1.5" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.5"/>
        {[52, 55, 58, 61, 64, 67, 70, 73].map(x => (
          <g key={`led-${x}`}>
            <rect x={x} y="26" width="1.5" height="1.5" fill="#4ade80" stroke="#16a34a" strokeWidth="0.3"/>
            <rect x={x} y="30.5" width="1.5" height="1.5" fill="#4ade80" stroke="#16a34a" strokeWidth="0.3"/>
          </g>
        ))}
      </svg>
    );
    case 'core-switch': return (
      <svg viewBox="0 0 100 50" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 8px rgba(0,0,0,0.6))' }}>
        <defs>
          <linearGradient id="swTopCore" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#94a3b8"/><stop offset="50%" stopColor="#cbd5e1"/><stop offset="100%" stopColor="#64748b"/></linearGradient>
          <linearGradient id="swFrontCore" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#64748b"/><stop offset="100%" stopColor="#334155"/></linearGradient>
          <linearGradient id="swRightCore" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#94a3b8"/><stop offset="100%" stopColor="#475569"/></linearGradient>
        </defs>
        
        <g stroke="#000" strokeWidth="1" strokeLinejoin="round">
          {/* Top Face */}
          <polygon points="10,15 80,15 95,5 25,5" fill="url(#swTopCore)" />
          {/* Right Face */}
          <polygon points="80,15 95,5 95,30 80,40" fill="url(#swRightCore)" />
          {/* Front Face */}
          <rect x="10" y="15" width="70" height="25" fill="url(#swFrontCore)" />
        </g>

        {/* Ports - 3 rows */}
        {[13, 17, 21, 25, 29, 33, 37, 41].map(x => (
          <g key={`port-${x}`}>
            <rect x={x} y="18" width="2.5" height="2.5" fill="#000" />
            <rect x={x} y="24" width="2.5" height="2.5" fill="#000" />
            <rect x={x} y="30" width="2.5" height="2.5" fill="#000" />
          </g>
        ))}

        {/* LED Panel - taller */}
        <rect x="50" y="18" width="26" height="18" rx="1.5" fill="#cbd5e1" stroke="#475569" strokeWidth="0.5"/>
        {[52, 55, 58, 61, 64, 67, 70, 73].map(x => (
          <g key={`led-${x}`}>
            <rect x={x} y="20" width="1.5" height="1.5" fill="#3b82f6" stroke="#2563eb" strokeWidth="0.3"/>
            <rect x={x} y="25" width="1.5" height="1.5" fill="#3b82f6" stroke="#2563eb" strokeWidth="0.3"/>
            <rect x={x} y="30" width="1.5" height="1.5" fill="#3b82f6" stroke="#2563eb" strokeWidth="0.3"/>
          </g>
        ))}
      </svg>
    );
    case 'poe-switch': return (
      <svg viewBox="0 0 100 50" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 8px rgba(0,0,0,0.6))' }}>
        <defs>
          <linearGradient id="swTopPoe" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#d1d5db"/><stop offset="50%" stopColor="#f3f4f6"/><stop offset="100%" stopColor="#9ca3af"/></linearGradient>
          <linearGradient id="swFrontPoe" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#cbd5e1"/><stop offset="100%" stopColor="#94a3b8"/></linearGradient>
          <linearGradient id="swRightPoe" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e2e8f0"/><stop offset="100%" stopColor="#cbd5e1"/></linearGradient>
        </defs>
        
        <g stroke="#000" strokeWidth="1" strokeLinejoin="round">
          {/* Top Face */}
          <polygon points="10,20 80,20 95,10 25,10" fill="url(#swTopPoe)" />
          {/* Right Face */}
          <polygon points="80,20 95,10 95,30 80,40" fill="url(#swRightPoe)" />
          {/* Front Face */}
          <rect x="10" y="20" width="70" height="20" fill="url(#swFrontPoe)" />
        </g>

        {/* PoE Lightning Bolt on Top */}
        <polygon points="45,12 38,15 42,15 40,18 48,13 44,13" fill="#f59e0b" stroke="#000" strokeWidth="0.5"/>

        {/* Ports (Orange) */}
        {[13, 17, 21, 25, 29, 33, 37, 41].map(x => (
          <g key={`port-${x}`}>
            <rect x={x} y="24" width="2.5" height="2.5" fill="#f59e0b" stroke="#000" strokeWidth="0.5" />
            <rect x={x} y="31" width="2.5" height="2.5" fill="#f59e0b" stroke="#000" strokeWidth="0.5" />
          </g>
        ))}

        {/* LED Panel */}
        <rect x="50" y="24" width="26" height="12" rx="1.5" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.5"/>
        {[52, 55, 58, 61, 64, 67, 70, 73].map(x => (
          <g key={`led-${x}`}>
            <rect x={x} y="26" width="1.5" height="1.5" fill="#f59e0b" stroke="#d97706" strokeWidth="0.3"/>
            <rect x={x} y="30.5" width="1.5" height="1.5" fill="#f59e0b" stroke="#d97706" strokeWidth="0.3"/>
          </g>
        ))}
      </svg>
    );
    case 'server': return (
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 12px rgba(0,0,0,0.5))' }}>
        <defs>
          <linearGradient id="dbTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#93c5fd"/><stop offset="100%" stopColor="#3b82f6"/></linearGradient>
          <linearGradient id="dbSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#2563eb"/><stop offset="50%" stopColor="#60a5fa"/><stop offset="100%" stopColor="#1e40af"/></linearGradient>
        </defs>
        
        {/* Server Tower */}
        <g stroke="#000000" strokeWidth="2.5" strokeLinejoin="round">
          {/* Top Face */}
          <polygon points="35,5 15,20 50,30 75,15" fill="#d1d5db" />
          {/* Right Side */}
          <polygon points="50,30 75,15 75,75 50,95" fill="#e5e7eb" />
          {/* Front (Left) Face */}
          <polygon points="15,20 50,30 50,95 15,85" fill="#f3f4f6" />
        </g>
        
        {/* Drive Bays / Details on Front Face */}
        <g stroke="#a0a0a0" strokeWidth="1.5">
          {/* Outer drive bay box */}
          <polygon points="20,28 42,34 42,62 20,53" fill="#d4d4d4" />
          {/* Bay slots */}
          <line x1="22" y1="33" x2="40" y2="38" />
          <line x1="22" y1="38" x2="40" y2="43" />
          <line x1="22" y1="43" x2="40" y2="48" />
          <line x1="22" y1="48" x2="40" y2="53" />
          <line x1="22" y1="53" x2="40" y2="58" />
        </g>
        
        {/* CD/DVD or USB slot */}
        <polygon points="25,72 40,76 40,80 25,76" fill="#4b5563" stroke="#000000" strokeWidth="1"/>
        <path d="M 25,82 Q 32,86 38,84 M 27,85 Q 32,88 36,87 M 29,88 Q 32,90 34,89" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>

        {/* Database Stack */}
        <g transform="translate(5, 5)">
          {/* Disk 3 (Bottom) */}
          <path d="M 45,75 L 45,90 A 25,10 0 0,0 95,90 L 95,75 Z" fill="url(#dbSide)" />
          <path d="M 45,90 A 25,10 0 0,0 95,90" fill="none" stroke="#000000" strokeWidth="1.5"/>
          <path d="M 45,75 A 25,10 0 0,0 95,75" fill="none" stroke="#000000" strokeWidth="1.5"/>

          {/* Disk 2 (Middle) */}
          <path d="M 45,60 L 45,75 A 25,10 0 0,0 95,75 L 95,60 Z" fill="url(#dbSide)" />
          <path d="M 45,60 A 25,10 0 0,0 95,60" fill="none" stroke="#000000" strokeWidth="1.5"/>

          {/* Disk 1 (Top) */}
          <path d="M 45,45 L 45,60 A 25,10 0 0,0 95,60 L 95,45 Z" fill="url(#dbSide)" />
          <ellipse cx="70" cy="45" rx="25" ry="10" fill="url(#dbTop)" stroke="#000000" strokeWidth="1.5"/>
          
          {/* Left and Right Edges of Stack */}
          <line x1="45" y1="45" x2="45" y2="90" stroke="#000000" strokeWidth="1.5"/>
          <line x1="95" y1="45" x2="95" y2="90" stroke="#000000" strokeWidth="1.5"/>
        </g>
      </svg>
    );
    case 'nvr': return (
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ filter: 'drop-shadow(0px 10px 15px rgba(0,0,0,0.7))' }}>
        <defs>
          <linearGradient id="nvrTop" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#1e293b"/><stop offset="100%" stopColor="#0f172a"/></linearGradient>
          <linearGradient id="nvrSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#475569"/><stop offset="100%" stopColor="#334155"/></linearGradient>
          <linearGradient id="nvrFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1e293b"/><stop offset="100%" stopColor="#020617"/></linearGradient>
        </defs>
        <g transform="translate(0, 30)">
          <polygon points="10,25 50,45 90,25 90,32 50,52 10,32" fill="#000" opacity="0.4"/>
          <polygon points="50,10 90,25 50,40 10,25" fill="url(#nvrTop)" stroke="#64748b" strokeWidth="2" strokeLinejoin="round"/>
          <polygon points="10,25 50,40 50,55 10,40" fill="url(#nvrSide)" stroke="#64748b" strokeWidth="2" strokeLinejoin="round"/>
          <polygon points="50,40 90,25 90,40 50,55" fill="url(#nvrFront)" stroke="#64748b" strokeWidth="2" strokeLinejoin="round"/>
          <polygon points="53,42 63,38 63,48 53,52" fill="#000"/>
          <polygon points="65,37 75,33 75,43 65,47" fill="#000"/>
          <polygon points="77,32 87,28 87,38 77,42" fill="#000"/>
          <circle cx="55" cy="48" r="1.5" fill="#ef4444" filter="drop-shadow(0 0 2px #ef4444)"/>
          <circle cx="58" cy="47" r="1.5" fill="#10b981" filter="drop-shadow(0 0 2px #10b981)"/>
        </g>
      </svg>
    );
    case 'router': return (
      <svg viewBox="0 0 100 60" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 10px rgba(0,0,0,0.6))' }}>
        <defs>
          <linearGradient id="rtrTop" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#0284c7"/><stop offset="100%" stopColor="#0369a1"/></linearGradient>
          <linearGradient id="rtrFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f172a"/><stop offset="100%" stopColor="#020617"/></linearGradient>
        </defs>
        <line x1="25" y1="20" x2="15" y2="2" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="75" y1="20" x2="85" y2="2" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="15" cy="2" r="2" fill="#38bdf8" />
        <circle cx="85" cy="2" r="2" fill="#38bdf8" />
        <polygon points="10,25 90,25 95,35 5,35" fill="url(#rtrTop)" stroke="#0284c7" strokeWidth="1"/>
        <rect x="5" y="35" width="90" height="20" rx="3" fill="url(#rtrFront)" stroke="#334155" strokeWidth="1"/>
        <circle cx="20" cy="45" r="2" fill="#38bdf8" filter="drop-shadow(0 0 3px #38bdf8)"/>
        <circle cx="28" cy="45" r="2" fill="#4ade80" filter="drop-shadow(0 0 3px #4ade80)"/>
        <circle cx="36" cy="45" r="2" fill="#4ade80" filter="drop-shadow(0 0 3px #4ade80)"/>
        <circle cx="44" cy="45" r="2" fill="#4ade80" filter="drop-shadow(0 0 3px #4ade80)"/>
        <rect x="65" y="40" width="20" height="10" rx="1.5" fill="#1e293b" stroke="#38bdf8" strokeWidth="1"/>
      </svg>
    );
    case 'access_point':
    case 'access-point': return (
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 10px rgba(0,0,0,0.5))' }}>
        <circle cx="50" cy="50" r="30" fill="#f8fafc" stroke="#64748b" strokeWidth="2"/>
        <circle cx="50" cy="50" r="20" fill="#0284c7" opacity="0.15"/>
        <circle cx="50" cy="50" r="6" fill="#0284c7" filter="drop-shadow(0 0 4px #0284c7)"/>
        <path d="M 28 50 A 22 22 0 0 1 72 50" fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M 18 50 A 32 32 0 0 1 82 50" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 3"/>
      </svg>
    );
    case 'workstation': return (
      <svg viewBox="0 0 100 80" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 10px rgba(0,0,0,0.5))' }}>
        <rect x="10" y="8" width="55" height="38" rx="2" fill="#0f172a" stroke="#475569" strokeWidth="1.5"/>
        <rect x="13" y="11" width="49" height="32" rx="1" fill="#1e293b"/>
        <polygon points="20,25 35,15 45,28 35,33" fill="#38bdf8" opacity="0.3"/>
        <rect x="34" y="46" width="7" height="8" fill="#64748b"/>
        <polygon points="25,54 50,54 48,57 27,57" fill="#475569"/>
        <rect x="70" y="10" width="22" height="46" rx="2" fill="#1e293b" stroke="#64748b" strokeWidth="1.5"/>
        <rect x="74" y="16" width="14" height="4" fill="#334155"/>
        <circle cx="81" cy="46" r="2.5" fill="#38bdf8" filter="drop-shadow(0 0 2px #38bdf8)"/>
      </svg>
    );
    case 'printer': return (
      <svg viewBox="0 0 100 80" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 10px rgba(0,0,0,0.5))' }}>
        <polygon points="28,5 72,5 70,22 30,22" fill="#f8fafc" stroke="#64748b" strokeWidth="1.5"/>
        <line x1="36" y1="12" x2="64" y2="12" stroke="#94a3b8" strokeWidth="1"/>
        <line x1="36" y1="16" x2="58" y2="16" stroke="#94a3b8" strokeWidth="1"/>
        <rect x="12" y="20" width="76" height="32" rx="4" fill="#e2e8f0" stroke="#475569" strokeWidth="1.5"/>
        <rect x="16" y="24" width="68" height="8" fill="#1e293b" rx="1"/>
        <rect x="25" y="44" width="50" height="20" fill="#f8fafc" stroke="#64748b" strokeWidth="1.5"/>
        <line x1="32" y1="50" x2="68" y2="50" stroke="#94a3b8" strokeWidth="1"/>
        <line x1="32" y1="55" x2="60" y2="55" stroke="#94a3b8" strokeWidth="1"/>
        <circle cx="78" cy="28" r="2" fill="#4ade80" filter="drop-shadow(0 0 2px #4ade80)"/>
      </svg>
    );
    case 'nas': return (
      <svg viewBox="0 0 100 80" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 10px rgba(0,0,0,0.5))' }}>
        <rect x="15" y="10" width="70" height="55" rx="3" fill="#1e293b" stroke="#475569" strokeWidth="1.5"/>
        {[22, 38, 54, 70].map(x => (
          <g key={`drive-${x}`}>
            <rect x={x} y="16" width="10" height="42" rx="1" fill="#0f172a" stroke="#334155" strokeWidth="1"/>
            <rect x={x+2} y="20" width="6" height="3" fill="#64748b"/>
            <circle cx={x+5} cy="52" r="1.5" fill="#38bdf8" filter="drop-shadow(0 0 2px #38bdf8)"/>
          </g>
        ))}
      </svg>
    );
    case 'iot': return (
      <svg viewBox="0 0 100 80" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 10px rgba(0,0,0,0.5))' }}>
        <rect x="25" y="18" width="50" height="44" rx="4" fill="#0f172a" stroke="#059669" strokeWidth="1.5"/>
        <rect x="35" y="28" width="30" height="24" rx="2" fill="#064e3b" stroke="#10b981" strokeWidth="1"/>
        <circle cx="50" cy="40" r="4" fill="#34d399" filter="drop-shadow(0 0 3px #34d399)"/>
        {[30, 40, 50, 60, 70].map(x => (
          <g key={`pin-${x}`}>
            <line x1={x} y1="12" x2={x} y2="18" stroke="#34d399" strokeWidth="2" strokeLinecap="round"/>
            <line x1={x} y1="62" x2={x} y2="68" stroke="#34d399" strokeWidth="2" strokeLinecap="round"/>
          </g>
        ))}
      </svg>
    );
    case 'unknown':
    case 'other': return (
      <svg viewBox="0 0 100 80" width={size} height={size} style={{ filter: 'drop-shadow(0px 8px 10px rgba(0,0,0,0.5))' }}>
        <rect x="20" y="15" width="60" height="48" rx="4" fill="#1e293b" stroke="#64748b" strokeWidth="1.5"/>
        <circle cx="50" cy="38" r="14" fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3"/>
        <circle cx="50" cy="38" r="4" fill="#94a3b8"/>
        <circle cx="70" cy="24" r="2" fill="#38bdf8" filter="drop-shadow(0 0 2px #38bdf8)"/>
      </svg>
    );
    case 'alert':       return <svg {...s}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case 'bell':        return <svg {...s}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
    case 'wifi':        return <svg {...s}><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/></svg>;
    case 'cpu':         return <svg {...s}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>;
    case 'disk':        return <svg {...s}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
    case 'activity':    return <svg {...s}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
    case 'power':       return <svg {...s}><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>;
    case 'video':       return <svg {...s}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
    case 'zap':         return <svg {...s}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case 'check':       return <svg {...s}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'refresh':     return <svg {...s}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>;
    case 'email':       return <svg {...s}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
    case 'x':           return <svg {...s}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    case 'template':    return <svg {...s}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M21 9H3M21 15H3M12 3v18"/></svg>;
    case 'copy':        return <svg {...s}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
    default:            return <svg {...s}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;
  }
};

const statusColor     = (s) => ({ online: '#10b981', offline: '#ef4444', degraded: '#f59e0b' }[s] || '#6b7280');
const packetLossColor = (pct) => {
  if (pct == null) return '#6b7280';
  if (pct < 1)    return '#10b981';
  if (pct < 5)    return '#f59e0b';
  return '#ef4444';
};
const deviceTypeLabel = (type) => ({
  'core-switch': 'Core Switch', 'poe-switch': 'PoE Switch',
  'nvr': 'NVR', 'camera': 'Camera', 'server': 'Server', 'switch': 'Switch',
  'router': 'Router', 'access_point': 'Access Point', 'access-point': 'Access Point',
  'workstation': 'Workstation', 'printer': 'Printer', 'nas': 'NAS Storage',
  'iot': 'IoT Device', 'other': 'Other Device', 'unknown': 'Network Device',
}[type] || type || 'Device');

// Hide placeholder values so only real manufacturer/model text is shown
const GENERIC_NAMES = ['', 'unknown', 'unknown device', 'network device', 'device',
  'web device', 'network node', 'network gateway', 'http device'];
const cleanMake  = (n) => { const m = (n?.manufacturer || n?.vendor || '').trim(); return GENERIC_NAMES.includes(m.toLowerCase()) ? '' : m; };
const cleanModel = (n) => { const m = (n?.model || '').trim(); return GENERIC_NAMES.includes(m.toLowerCase()) ? '' : m; };
const makeModelLabel = (n) => {
  const mk = cleanMake(n), md = cleanModel(n);
  if (mk && md) return md.toLowerCase().startsWith(mk.toLowerCase()) ? md : `${mk} ${md}`;
  return md || mk || 'Identifying…';
};

// ─── Custom Topology Node ─────────────────────────────────────────────────────
const CustomNode = ({ data }) => {
  const isIconMode = ['switch', 'camera', 'server', 'core-switch', 'poe-switch', 'nvr', 'router', 'access_point', 'access-point', 'workstation', 'printer', 'nas', 'iot', 'other', 'unknown'].includes(data.type);

  if (isIconMode) {
    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Handle type="target" position={Position.Top} style={{ background: '#555', border: 'none' }} />
        {data.onRemove && (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              data.onRemove();
            }}
            style={{
              position: 'absolute',
              top: -5,
              right: -25,
              background: '#ef4444',
              border: '1px solid #7f1d1d',
              color: '#fff',
              borderRadius: '50%',
              width: 18,
              height: 18,
              fontSize: 14,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              zIndex: 1000,
              transition: 'all 0.1s'
            }}
            title="Remove from Canvas"
          >
            ×
          </button>
        )}
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="topo-node__pulse" style={{ backgroundColor: statusColor(data.status), position: 'absolute', top: -10, right: -10, width: 14, height: 14, borderRadius: '50%', boxShadow: `0 0 10px ${statusColor(data.status)}`, zIndex: 10 }} />
          <Icon type={data.type} size={80} model={data.model} subtype={data.camera_type} />
        </div>
        <div className="topo-node-badge" style={{ marginTop: 8, textAlign: 'center', padding: '2px 8px', borderRadius: 12, backdropFilter: 'blur(4px)' }}>
          <div className="topo-node-ip" style={{ fontSize: 13, fontWeight: 'bold' }}>{data.ip}</div>
          {cleanModel(data) && (
            <div className="topo-node-model" style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cleanModel(data)}>
              {cleanModel(data)}
            </div>
          )}
          <div className="topo-node-type" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)' }}>{deviceTypeLabel(data.type)}</div>
        </div>
        <Handle type="source" position={Position.Bottom} style={{ background: '#555', border: 'none' }} />
      </div>
    );
  }

  return (
    <div className={`topo-node topo-node--${data.status} topo-node-type--${data.type}`}
         style={{ borderColor: statusColor(data.status), position: 'relative' }}>
      <Handle type="target" position={Position.Top} style={{ background: '#555' }} />
      
      {/* Remove button */}
      {data.onRemove && (
        <button 
          onClick={(e) => {
            e.stopPropagation(); // Prevent opening node sidebar details
            data.onRemove();
          }}
          style={{
            position: 'absolute',
            top: -7,
            right: -7,
            background: '#ef4444',
            border: '1px solid #7f1d1d',
            color: '#fff',
            borderRadius: '50%',
            width: 17,
            height: 17,
            fontSize: 14,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            zIndex: 1000,
            transition: 'all 0.1s'
          }}
          title="Remove from Canvas"
        >
          ×
        </button>
      )}

      <div className="topo-node__pulse" style={{ backgroundColor: statusColor(data.status), marginRight: data.onRemove ? 10 : 0 }} />
      <div className="topo-node__header">
        <div className="topo-node__icon-wrapper"><Icon type={data.type} model={data.model} subtype={data.camera_type} /></div>
        <div className="topo-node__title">
          <span className="topo-node__ip">{data.ip}</span>
          <span className="topo-node__label">{deviceTypeLabel(data.type)}</span>
        </div>
      </div>
      <div className="topo-node__body">
        <span className="topo-node__model">{data.model || 'Device'}</span>
        {data.latency != null && <span className="topo-node__latency">{Math.round(data.latency)}ms</span>}
      </div>
      {data.poe_power && (
        <div className="topo-node__poe">
          <Icon type="zap" size={10}/> {data.poe_power.used}W / {data.poe_power.total}W
        </div>
      )}
      {data.stream_bitrate_mbps != null && (
        <div className="topo-node__stream">{data.stream_bitrate_mbps} Mbps</div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
    </div>
  );
};

const nodeTypes = { custom: CustomNode };

// ─── Custom Connection Edge ───────────────────────────────────────────────────
const ConnectionEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data
}) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition
  });

  const cType = (data?.cableType || '').toLowerCase();
  
  let edgeStyle = { ...style, strokeWidth: 2, fill: 'none' };
  
  // Apply styling based on cable type
  if (cType.includes('fiber')) {
    // Fiber - double line effect or thicker glowing
    edgeStyle.strokeWidth = 4;
    edgeStyle.strokeDasharray = '4 2'; // just to make it distinct if we can't easily do double lines in one path
  } else if (cType.includes('wireless')) {
    edgeStyle.strokeDasharray = '2 4';
    edgeStyle.strokeWidth = 2;
  } else if (data?.status === 'Fault') {
    edgeStyle.strokeDasharray = '5 5';
    edgeStyle.stroke = '#ef4444'; // Red for fault
  } else {
    // CAT cables - solid
    edgeStyle.strokeWidth = 3;
  }

  // Disconnected state
  if (data?.status === 'Disconnected') {
    edgeStyle.strokeDasharray = '4 4';
    edgeStyle.stroke = '#6b7280';
    edgeStyle.opacity = 0.5;
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <div className="connection-edge-label" onClick={(e) => {
             // Let ReactFlow's onEdgeClick handle this, but stop propagation if needed
          }}>
            {data?.poeEnabled && <Icon type="zap" size={12} />}
            <span>{data?.cableType || 'Cable'}</span>
            <span style={{ color: '#9ca3af' }}>{data?.linkSpeed}</span>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

const edgeTypes = { connection: ConnectionEdge };

// ─── Connection Modal ─────────────────────────────────────────────────────────


const MetricCard = ({ icon, label, value, unit, percent, color, sub }) => (
  <div className="metric-card">
    <div className="metric-card__icon" style={{ color }}><Icon type={icon} size={16} /></div>
    <div className="metric-card__body">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}<span className="metric-card__unit">{unit}</span></div>
      {sub && <div className="metric-card__sub">{sub}</div>}
      {percent !== undefined && (
        <div className="metric-bar">
          <div className="metric-bar__fill" style={{ width: `${Math.min(percent, 100)}%`, background: color }} />
        </div>
      )}
    </div>
  </div>
);

// ─── BELL ALERT POPUP (replaces AlertBanner) ──────────────────────────────────
const BellAlertButton = ({ alerts, onAck }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const unreadCount = alerts.length;

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const severityColor = (sev) => ({ critical: '#ef4444', warning: '#f59e0b', info: '#60a5fa' }[sev] || '#ef4444');
  const severityBg    = (sev) => ({ critical: 'rgba(239,68,68,0.08)', warning: 'rgba(245,158,11,0.08)', info: 'rgba(96,165,250,0.08)' }[sev] || 'rgba(239,68,68,0.08)');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative',
          background: open ? 'rgba(99,102,241,0.15)' : 'rgba(17,24,39,0.85)',
          border: `1px solid ${open ? '#6366f1' : '#374151'}`,
          borderRadius: 10,
          color: unreadCount > 0 ? '#f59e0b' : '#9ca3af',
          cursor: 'pointer',
          width: 38,
          height: 38,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)',
          transition: 'all 0.2s',
          boxShadow: unreadCount > 0 ? '0 0 0 2px rgba(245,158,11,0.25)' : 'none',
        }}
        title={`${unreadCount} alert${unreadCount !== 1 ? 's' : ''}`}
      >
        <Icon type="bell" size={17} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -5, right: -5,
            background: '#ef4444',
            color: '#fff',
            borderRadius: '50%',
            minWidth: 18,
            height: 18,
            fontSize: 14,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            border: '2px solid #111827',
            lineHeight: 1,
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popup */}
      {open && (
        <div className="bell-alert-popup" style={{
          position: 'absolute',
          top: 46,
          right: 0,
          width: 360,
          maxHeight: 480,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Popup header */}
          <div className="bell-alert-header" style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon type="bell" size={14} />
              <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 17 }}>Alerts</span>
              {unreadCount > 0 && (
                <span style={{
                  background: '#ef4444',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '1px 7px',
                  fontSize: 14,
                  fontWeight: 700,
                }}>
                  {unreadCount}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: "var(--text-muted)", cursor: 'pointer', padding: 2 }}
            >
              <Icon type="x" size={14} />
            </button>
          </div>

          {/* Alert list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {alerts.length === 0 ? (
              <div style={{
                padding: 32,
                textAlign: 'center',
                color: "var(--text-muted)",
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
              }}>
                <Icon type="check" size={28} />
                <span style={{ fontSize: 17 }}>No active alerts</span>
              </div>
            ) : (
              alerts.map((a, i) => {
                const sev = a.severity || 'warning';
                return (
                  <div key={i} className="bell-alert-item" style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    borderLeft: `3px solid ${severityColor(sev)}`,
                    background: severityBg(sev),
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}>
                    <div style={{ color: severityColor(sev), marginTop: 1, flexShrink: 0 }}>
                      <Icon type="alert" size={13} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: severityColor(sev),
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        marginBottom: 3,
                      }}>
                        {sev.toUpperCase()}
                      </div>
                      <div style={{
                        color: 'var(--text-primary)',
                        fontSize: 15,
                        lineHeight: 1.45,
                        wordBreak: 'break-word',
                        marginBottom: 4,
                      }}>
                        {a.message}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: "var(--text-secondary)", fontSize: 14 }}>
                        {a.ip && <span>{a.ip}</span>}
                        <span>{new Date(a.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => onAck(a.node_id)}
                      style={{
                        flexShrink: 0,
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.3)',
                        borderRadius: 6,
                        color: '#818cf8',
                        cursor: 'pointer',
                        fontSize: 14,
                        fontWeight: 600,
                        padding: '3px 8px',
                        letterSpacing: '0.04em',
                      }}
                    >
                      ACK
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {alerts.length > 0 && (
            <div style={{
              padding: '8px 14px',
              borderTop: '1px solid #1f2937',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => { alerts.forEach(a => onAck(a.node_id)); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6366f1',
                  cursor: 'pointer',
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                Acknowledge All
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SwitchPortTable = ({ ports }) => {
  if (!ports || ports.length === 0) return <p className="empty-msg">No switch port data</p>;
  return (
    <div className="port-table">
      <div className="port-table__header">
        <span>Port</span><span>Status</span><span>Speed</span><span>PoE(W)</span><span>Device</span>
      </div>
      {ports.map((p, i) => (
        <div key={i} className="port-table__row">
          <span className="port-name">{p.port}</span>
          <span className={`port-status ${p.status === 'up' ? 'port-up' : 'port-dn'}`}>
            {p.status === 'up' ? '▲ UP' : '▼ DN'}
          </span>
          <span className="port-speed">{p.speed || '—'}</span>
          <span className="port-poe" style={{ color: p.poe_watts > 0 ? '#f59e0b' : '#4b5563' }}>
            {p.poe_watts != null ? p.poe_watts : '—'}
          </span>
          <span className="port-device">{p.connected_device || '—'}</span>
        </div>
      ))}
      <div className="port-hint">
        <Icon type="zap" size={10}/> <i>Real-time port monitoring requires SNMPv2 support.</i>
      </div>
    </div>
  );
};

const NetworkPerfTable = ({ diagnostics, filterIp }) => {
  if (!diagnostics?.devices) return null;
  const rows = filterIp
    ? diagnostics.devices.filter(d => d.ip === filterIp)
    : diagnostics.devices;

  if (rows.length === 0)
    return <p className="empty-msg">No diagnostic data for this device yet.</p>;

  return (
    <div className="perf-table">
      <div className="perf-table__header">
        <span>Device</span><span>Latency</span><span>PktLoss</span>
        <span>RTSP</span><span>HTTP</span><span>ONVIF</span><span>Status</span>
      </div>
      {rows.map((d, i) => (
        <div key={i} className="perf-table__row perf-row--selected">
          <span className="perf-name">{d.name || d.ip}</span>
          <span className="perf-latency">{d.latency != null ? `${d.latency}ms` : '—'}</span>
          <span style={{ color: packetLossColor(d.packet_loss), fontSize: '14px', textAlign: 'center' }}>
            {d.packet_loss != null ? `${d.packet_loss}%` : '—'}
          </span>
          <span className={`perf-port ${d.ports?.rtsp  ? 'port-up' : 'port-dn'}`}>{d.ports?.rtsp  ? '●' : '○'}</span>
          <span className={`perf-port ${d.ports?.http  ? 'port-up' : 'port-dn'}`}>{d.ports?.http  ? '●' : '○'}</span>
          <span className={`perf-port ${d.ports?.onvif ? 'port-up' : 'port-dn'}`}>{d.ports?.onvif ? '●' : '○'}</span>
          <span className={`perf-status status--${d.status?.toLowerCase()}`}>{d.status}</span>
        </div>
      ))}
    </div>
  );
};

const Sparkline = ({ data, color, height = 36, width = 140 }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

const NVRPanel = ({ d }) => (
  <div className="nvr-panel">
    <div className="nvr-panel__title"><Icon type="nvr" size={14}/> NVR Status</div>
    <div className="nvr-grid">
      <div className="nvr-stat"><span className="nvr-label">Connected</span>
        <span className={`nvr-val ${d.nvr_connected ? 'txt-green' : 'txt-red'}`}>{d.nvr_connected ? '✓ YES' : '✗ NO'}</span>
      </div>
      <div className="nvr-stat"><span className="nvr-label">Recording</span>
        <span className={`nvr-val ${d.recording_status === 'active' ? 'txt-green' : 'txt-red'}`}>{d.recording_status || 'Unknown'}</span>
      </div>
      <div className="nvr-stat"><span className="nvr-label">Storage</span>
        <span className="nvr-val">{d.storage_usage != null ? `${d.storage_usage}%` : '—'}</span>
      </div>
    </div>
    {d.storage_usage != null && (
      <div className="metric-bar" style={{ marginTop: 6 }}>
        <div className="metric-bar__fill" style={{
          width: `${d.storage_usage}%`,
          background: d.storage_usage > 85 ? '#ef4444' : d.storage_usage > 70 ? '#f59e0b' : '#10b981'
        }}/>
      </div>
    )}
  </div>
);

const CameraStreamPanel = ({ d, liveData, isRefreshing, onRefresh }) => {
  const cam = liveData ? { ...d, ...liveData } : d;

  const hasAnyStreamData =
    cam.stream_bitrate_mbps != null ||
    cam.stream_fps          != null ||
    cam.stream_status       != null ||
    cam.stream_resolution   != null ||
    cam.codec               != null ||
    cam.dropped_frames      != null;

  return (
    <div className="stream-panel">
      <div className="stream-panel__title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span><Icon type="video" size={14}/> Stream Health</span>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh stream data"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: isRefreshing ? 'var(--text-muted)' : 'var(--accent)', padding: '2px 4px',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 14
          }}>
          <Icon type="refresh" size={12}/>
          {isRefreshing ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!hasAnyStreamData && !isRefreshing && (
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px',
          color: "var(--text-muted)", fontSize: 14, marginBottom: 8,
          border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 6
        }}>
          <Icon type="alert" size={12}/>
          Stream data not yet polled. Click Refresh or wait for the next cycle.
        </div>
      )}

      <div className="stream-grid">
        <div className="stream-stat">
          <span className="stream-label">Bitrate</span>
          <span className="stream-val" style={{ color: cam.stream_bitrate_mbps != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {cam.stream_bitrate_mbps != null ? `${cam.stream_bitrate_mbps} Mbps` : '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">FPS</span>
          <span className="stream-val" style={{ color: cam.stream_fps != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {cam.stream_fps != null ? cam.stream_fps : '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">Status</span>
          <span className={`stream-val ${cam.stream_status === 'healthy' ? 'txt-green' : cam.stream_status ? 'txt-red' : ''}`}
                style={{ color: !cam.stream_status ? 'var(--text-muted)' : undefined }}>
            {cam.stream_status || '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">Resolution</span>
          <span className="stream-val" style={{ color: cam.stream_resolution != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {cam.stream_resolution != null ? cam.stream_resolution : '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">Codec</span>
          <span className="stream-val" style={{ color: cam.codec != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {cam.codec != null ? cam.codec : '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">Dropped Frames</span>
          <span className={`stream-val ${cam.dropped_frames > 0 ? 'txt-yellow' : cam.dropped_frames === 0 ? 'txt-green' : ''}`}
                style={{ color: cam.dropped_frames == null ? 'var(--text-muted)' : undefined }}>
            {cam.dropped_frames != null ? cam.dropped_frames : '—'}
          </span>
        </div>
      </div>

      <div className="stream-flags">
        <span className={`stream-flag ${cam.rtsp_connected == null ? 'flag-unknown' : cam.rtsp_connected ? 'flag-ok' : 'flag-err'}`}
          title={cam.rtsp_connected == null ? 'Not yet checked' : cam.rtsp_connected ? 'Connected' : 'Disconnected'}>
          RTSP{cam.rtsp_connected == null ? ' ?' : ''}
        </span>
        <span className={`stream-flag ${cam.onvif_connected == null ? 'flag-unknown' : cam.onvif_connected ? 'flag-ok' : 'flag-err'}`}
          title={cam.onvif_connected == null ? 'Not yet checked' : cam.onvif_connected ? 'Connected' : 'Disconnected'}>
          ONVIF{cam.onvif_connected == null ? ' ?' : ''}
        </span>
        <span className={`stream-flag ${cam.recording == null ? 'flag-unknown' : cam.recording ? 'flag-ok' : 'flag-err'}`}
          title={cam.recording == null ? 'Not yet checked' : cam.recording ? 'Recording' : 'Not recording'}>
          REC{cam.recording == null ? ' ?' : ''}
        </span>
      </div>

      {(cam.onvif_url || cam.rtsp_url) && (
        <div style={{ marginTop: 8 }}>
          {cam.onvif_url && (
            <div className="detail-row" style={{ fontSize: 13, color: "var(--text-muted)" }}>
              <label>ONVIF URL</label><span style={{ wordBreak: 'break-all' }}>{cam.onvif_url}</span>
            </div>
          )}
          {cam.rtsp_url && (
            <div className="detail-row" style={{ fontSize: 13, color: "var(--text-muted)" }}>
              <label>RTSP URL</label><span style={{ wordBreak: 'break-all' }}>{cam.rtsp_url}</span>
            </div>
          )}
        </div>
      )}

      {cam.stream_last_polled && (
        <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)", textAlign: 'right' }}>
          Last polled: {new Date(cam.stream_last_polled).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

const PoEPanel = ({ d }) => {
  if (!d.poe_power) return null;
  const { used, total } = d.poe_power;
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div className="poe-panel">
      <div className="poe-panel__title"><Icon type="zap" size={14}/> PoE Power</div>
      <div className="poe-summary">
        <span className="poe-used">{used}W</span><span className="poe-sep"> / </span>
        <span className="poe-total">{total}W</span><span className="poe-pct">({pct.toFixed(0)}%)</span>
      </div>
      <div className="metric-bar">
        <div className="metric-bar__fill" style={{ width: `${pct}%`, background: pct > 85 ? '#ef4444' : '#f59e0b' }}/>
      </div>
    </div>
  );
};

const normalizeNodeType = (node) => {
  if (!node) return node;
  const modelLower = (node.model || '').toLowerCase();
  const idLower = (node.id || '').toLowerCase();
  if (modelLower.includes('vms host') || idLower.includes('vms-host')) {
    return { ...node, type: 'server' };
  }
  return node;
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Topology() {
  const { theme } = useTheme();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [scannedNodes, setScannedNodes]   = useState([]); // Store ALL scanned nodes from backend!
  const [scanning, setScanning]         = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [metrics, setMetrics]           = useState(null);
  const [alerts, setAlerts]             = useState([]);
  const [diagnostics, setDiagnostics]   = useState(null);
  const [bwHistory, setBwHistory]       = useState([]);
  const [activeTab, setActiveTab]       = useState('details');
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false });
  const [activeTemplate, setActiveTemplate] = useState(null);
  
  const memoizedNodeTypes = useMemo(() => nodeTypes, []);
  const memoizedEdgeTypes = useMemo(() => edgeTypes, []);
  

  const [selectedEdge, setSelectedEdge] = useState(null);

  const [templatesDropdownOpen, setTemplatesDropdownOpen] = useState(false);
  const templatesDropdownRef = useRef(null);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const typeDropdownRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (templatesDropdownRef.current && !templatesDropdownRef.current.contains(e.target)) {
        setTemplatesDropdownOpen(false);
      }
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target)) {
        setTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Filter state: null = show all, string = active filter ───────────────
  const [statusFilter, setStatusFilter]   = useState(null); // 'online'|'offline'|'degraded'
  const [typeFilter, setTypeFilter]       = useState(null); // 'camera'|'server'|'switch'|etc.

  const [deviceLiveData, setDeviceLiveData]     = useState(null);
  const [deviceRefreshing, setDeviceRefreshing] = useState(false);
  const [copiedField, setCopiedField]           = useState(null);

  const copyValue = (text, fieldName) => {
    if (!text) return;
    try {
      navigator.clipboard.writeText(String(text));
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {}
  };

  // ─── Search and Accordion group states ───
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({ online: true, degraded: true, offline: true });

  const toggleGroup = (group) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const wsRef       = useRef(null);
  const prevUptimes = useRef({});
  const prevBwRef   = useRef({});

  // ─── Computed: nodes visible on canvas based on active filters ────────────
  // Placed nodes on the canvas always retain and do not hide under filters
  const visibleNodes = nodes;

  // ─── Toggle helpers ───────────────────────────────────────────────────────
  const toggleStatusFilter = (status) => {
    setStatusFilter(prev => prev === status ? null : status);
    setTypeFilter(null);
  };
  const toggleTypeFilter = (type) => {
    setTypeFilter(prev => prev === type ? null : type);
    setStatusFilter(null);
  };

  const fetchDeviceLiveData = useCallback(async (node) => {
    if (!node) return;
    setDeviceRefreshing(true);
    try {
      const r = await fetch(`${API_BASE}/topology`);
      if (!r.ok) return;
      const data = await r.json();
      if (!data?.nodes) return;
      const nodeData =
        data.nodes.find(n => n.id === node.id) ||
        data.nodes.find(n => n.ip === node.data?.ip) ||
        null;
      if (nodeData) {
        setDeviceLiveData(nodeData);
        setNodes(nds => nds.map(n =>
          n.id === node.id ? { ...n, data: { ...n.data, ...nodeData, onRemove: n.data.onRemove } } : n
        ));
      }
    } catch (err) {
      console.error('[DeviceFetch] Failed:', err);
    } finally {
      setDeviceRefreshing(false);
    }
  }, [setNodes]);

  const checkBandwidthSpike = useCallback((bwData) => {
    if (!bwData) return;
    const sentMbps = (bwData.sent_kbps || 0) / 1024;
    const recvMbps = (bwData.recv_kbps || 0) / 1024;
    const prev = prevBwRef.current['global'] || {};
    if (!prev.alerted && (sentMbps > BW_SPIKE_THRESHOLD_MBPS || recvMbps > BW_SPIKE_THRESHOLD_MBPS)) {
      setAlerts(p => [{
        node_id: 'bandwidth-spike', severity: 'warning',
        message: `High bandwidth spike detected! ${sentMbps > BW_SPIKE_THRESHOLD_MBPS ? '↑TX' : '↓RX'} ${Math.max(sentMbps, recvMbps).toFixed(1)} Mbps (threshold: ${BW_SPIKE_THRESHOLD_MBPS} Mbps)`,
        timestamp: new Date().toISOString(), ip: 'Network'
      }, ...p]);
      prevBwRef.current['global'] = { alerted: true };
    } else if (sentMbps < BW_SPIKE_THRESHOLD_MBPS && recvMbps < BW_SPIKE_THRESHOLD_MBPS) {
      prevBwRef.current['global'] = { alerted: false };
    }
  }, []);

  const checkUnexpectedReboot = useCallback((nodeId, newData) => {
    if (!newData.uptime) return;
    const parseUptimeSeconds = (str) => {
      if (!str) return null;
      let secs = 0;
      const d = str.match(/(\d+)\s*d/); if (d) secs += parseInt(d[1]) * 86400;
      const h = str.match(/(\d+)\s*h/); if (h) secs += parseInt(h[1]) * 3600;
      const m = str.match(/(\d+)\s*m/); if (m) secs += parseInt(m[1]) * 60;
      return secs;
    };
    const newSecs  = parseUptimeSeconds(newData.uptime);
    const prevSecs = parseUptimeSeconds(prevUptimes.current[nodeId]);
    if (prevSecs != null && newSecs != null && newSecs < prevSecs - 60) {
      setAlerts(p => [{
        node_id: nodeId, severity: 'critical',
        message: `Device ${newData.ip || nodeId} rebooted unexpectedly! Reason: ${newData.reboot_reason || 'Unknown'}`,
        timestamp: new Date().toISOString(), ip: newData.ip || nodeId
      }, ...p]);
    }
    prevUptimes.current[nodeId] = newData.uptime;
  }, []);

  // ─── Canvas Removal Action ────────────────────────────────────────────────
  const removeNodeFromCanvas = useCallback(async (nodeId) => {
    try {
      await fetch(`${API_BASE}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: null })
      });
      
      // Clear connected edges
      const connectedEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);
      await Promise.all(connectedEdges.map(e => 
        fetch(`${API_BASE}/connections/${e.data?.id || e.id}`, {
          method: 'DELETE'
        }).catch(() => {})
      ));

      setNodes(nds => nds.filter(n => n.id !== nodeId));
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
      setScannedNodes(snd => snd.map(n => n.id === nodeId ? { ...n, position: null } : n));
    } catch (err) {
      console.error("Failed to remove node from canvas:", err);
    }
  }, [edges, setNodes, setEdges]);

  const fetchTopology = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/topology`);
      const data = await res.json();
      if (!data?.nodes) return;

      const seen = new Map();
      const seenIds = new Set();
      const idAlias = {};
      data.nodes.forEach(n => {
        const norm = normalizeNodeType(n);
        const key  = norm.ip || norm.mac || norm.id;
        const cur  = seen.get(key);
        const better = !cur
          || (!!norm.position && !cur.position)
          || (!!norm.position === !!cur.position &&
              new Date(norm.last_seen || 0) > new Date(cur.last_seen || 0));
        if (better) { if (cur) idAlias[cur.id] = norm.id; seen.set(key, norm); }
        else        { idAlias[norm.id] = cur.id; }
      });
      const uniqueNodes = [];
      for (const node of seen.values()) {
        const idKey = node.id || node.ip;
        if (!seenIds.has(idKey)) {
          seenIds.add(idKey);
          uniqueNodes.push(node);
        }
      }
      const A = (id) => idAlias[id] || id;

      // Populate all discovered devices into the inventory library (left panel)
      setScannedNodes(uniqueNodes);

      // Only devices with an explicit saved position appear on the canvas (no auto-placement)
      const placedNodes = uniqueNodes.filter(n => n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number');

      const reactNodes = placedNodes.map(n => ({
        id: n.id,
        type: 'custom',
        _hasPosition: true,
        position: n.position,
        data: { 
          ...n, 
          onRemove: () => removeNodeFromCanvas(n.id)
        }
      }));

      setNodes(prev => {
        let arrayChanged = false;
        if (prev.length !== reactNodes.length) arrayChanged = true;
        
        const nextNodes = reactNodes.map(rn => {
          const p = prev.find(x => x.id === rn.id);
          if (!p) {
            arrayChanged = true;
            return rn;
          }
          const posChanged = p.position.x !== rn.position.x || p.position.y !== rn.position.y;
          const pDataStr = JSON.stringify({ ...p.data, onRemove: null });
          const rnDataStr = JSON.stringify({ ...rn.data, onRemove: null });
          if (posChanged || pDataStr !== rnDataStr) {
            arrayChanged = true;
            return rn;
          }
          return p; // Keep exact reference
        });
        
        return arrayChanged ? nextNodes : prev;
      });

      const edgeSeen = new Set();
      const uniqueEdges = (data.connections || []).filter(e => {
        const key = `${A(e.sourceDeviceId)}|${A(e.destinationDeviceId)}`;
        if (edgeSeen.has(key)) return false;
        edgeSeen.add(key);
        return true;
      });

      const reactEdges = uniqueEdges.map((e) => {
        return {
          id: e.id || `conn-${e.sourceDeviceId}-${e.destinationDeviceId}`,
          source: A(e.sourceDeviceId),
          target: A(e.destinationDeviceId),
          animated: true,
          type: 'connection',
          data: e,
        };
      });

      const logicalEdges = (data.edges || []).map((e0, idx) => {
        const e = { ...e0, source: A(e0.source), target: A(e0.target) };
        const targetNode = uniqueNodes.find(n => n.id === e.target);
        const targetType = targetNode?.type;
        
        let strokeColor = '#818cf8';
        let strokeWidth = 2;
        
        if (targetType === 'camera') {
          strokeColor = '#10b981';
        } else if (targetType === 'server' || targetType === 'nvr') {
          strokeColor = '#3b82f6';
          strokeWidth = 2.5;
        } else if (targetType === 'switch' || targetType === 'poe-switch' || targetType === 'core-switch') {
          strokeColor = '#f59e0b';
          strokeWidth = 2.5;
        }

        const isCameraTarget = targetType === 'camera';

        return {
          id: `e-logic-${e.source}-${e.target}-${idx}`, 
          source: e.source, 
          target: e.target,
          animated: true,
          type: 'smoothstep',
          style: { 
            stroke: strokeColor, 
            strokeWidth: strokeWidth,
            filter: `drop-shadow(0px 0px 3px ${strokeColor}66)`
          },
          ...(isCameraTarget ? {
            markerStart: { type: MarkerType.ArrowClosed, color: strokeColor }
          } : {
            markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor }
          })
        };
      });

      const allReactEdges = [...reactEdges, ...logicalEdges];

      setEdges(prev => {
        let arrayChanged = false;
        if (prev.length !== allReactEdges.length) arrayChanged = true;
        
        const nextEdges = allReactEdges.map(re => {
          const p = prev.find(x => x.id === re.id);
          if (!p) {
            arrayChanged = true;
            return re;
          }
          const pStr = JSON.stringify(p);
          const reStr = JSON.stringify(re);
          if (pStr !== reStr) {
            arrayChanged = true;
            return re;
          }
          return p;
        });
        
        return arrayChanged ? nextEdges : prev;
      });
    } catch (err) { console.error('Topology fetch failed:', err); }
  }, [setNodes, setEdges, removeNodeFromCanvas]);

  const fetchMetrics = useCallback(async () => {
    try {
      const r    = await fetch(`${API_BASE}/metrics`);
      const data = await r.json();
      setMetrics(data);
    } catch {}
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/alerts?unacknowledged_only=true`);
      const d = await r.json();
      setAlerts(Array.isArray(d) ? d : []);
    } catch {}
  }, []);

  const fetchBandwidth = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/bandwidth`);
      const d = await r.json();
      setBwHistory(Array.isArray(d) ? d.reverse() : []);
    } catch {}
  }, []);

  useEffect(() => {
    // Fetch cached topology and network data strictly once on component mount (entering page)
    fetchTopology();
    fetchMetrics();
    fetchAlerts();
    fetchBandwidth();
    // Continuous polling removed: polling runs only when navigating to this page or on manual scan
  }, [fetchTopology, fetchMetrics, fetchAlerts, fetchBandwidth]);

  // Keep selectedNode data in sync when nodes refresh
  useEffect(() => {
    if (!selectedNode) return;
    const updated = nodes.find(n => n.id === selectedNode.id);
    if (updated && updated.data !== selectedNode.data) setSelectedNode(updated);
  }, [nodes, selectedNode]);

  const onNodeDragStop = useCallback((_, node) => {
    fetch(`${API_BASE}/nodes/${node.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: node.position })
    });
  }, []);


  const handleNodeClick = useCallback((_, node) => {
    setSelectedNode(node);
    setSelectedEdge(null);
    setActiveTab('details');
    setSidebarOpen(true);
    setDeviceLiveData(null);
    if (node.data?.type === 'camera' && node.data?.ip) {
      fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: node.data.ip })
      }).catch(() => {});
      fetchDeviceLiveData(node);
      setTimeout(() => fetchDeviceLiveData(node), 3000);
    } else {
      fetchDeviceLiveData(node);
    }
  }, [fetchDeviceLiveData]);

  const handleEdgeClick = useCallback((_, edge) => {
    setSelectedNode(null);
    setSelectedEdge(edge);
    setActiveTab('details');
    setSidebarOpen(true);
    setDeviceLiveData(null);
  }, []);

  const closeSidebar = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setSidebarOpen(false);
    setDeviceLiveData(null);
  }, []);

  const triggerScan = async () => {
    setScanning(true);
    try {
      await fetch(`${API_BASE}/scan`, { method: 'POST' });
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        await fetchTopology();
        const statusRes = await fetch(`${API_BASE}/scan/status`);
        const statusData = await statusRes.json();
        if (!statusData.is_scanning) break;
      }
      await fetchTopology();
      await fetchAlerts();
    } catch (err) {
      console.error("Scan error:", err);
    } finally {
      setScanning(false);
    }
  };
  const savePositions = async () => { await Promise.all(nodes.map(n => fetch(`${API_BASE}/nodes/${n.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: n.position }) }))); };
  const ackAlert      = async (nodeId) => { await fetch(`${API_BASE}/alerts/${nodeId}/acknowledge`, { method: 'POST' }); setAlerts(prev => prev.filter(a => a.node_id !== nodeId)); };
  const onDragStart   = (e, nd) => { e.dataTransfer.setData('application/reactflow', JSON.stringify(nd)); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver    = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  
  const onDrop        = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw) return;
    const nd = JSON.parse(raw);
    if (nodes.find(n => n.id === nd.id)) return;
    const bounds   = e.target.getBoundingClientRect();
    const position = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    setNodes(nds => nds.concat({ 
      id: nd.id, 
      type: 'custom', 
      position, 
      data: { 
        ...nd, 
        onRemove: () => removeNodeFromCanvas(nd.id) 
      } 
    }));
    setScannedNodes(snd => snd.map(n => n.id === nd.id ? { ...n, position } : n));
    fetch(`${API_BASE}/nodes/${nd.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position }) });
  }, [nodes, setNodes, removeNodeFromCanvas]);

  // ─── Topology Template Design Actions ─────────────────────────────────────
  const resetWorkspace = useCallback(() => {
    setConfirmModal({
      isOpen: true,
      title: 'Clear Canvas',
      message: "Are you sure you want to clear the canvas? This will remove all devices from the topology canvas.",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        // Instantly wipe canvas state
        setNodes([]);
        setEdges([]);
        setScannedNodes(snd => snd.map(n => ({ ...n, position: null })));
        setSelectedNode(null);
        setSelectedEdge(null);
        setSidebarOpen(false);
        setActiveTemplate(null);
        try {
          await fetch(`${API_BASE}/reset`, { method: 'POST' });
          await fetchTopology();
        } catch (err) {
          console.error("Failed to reset workspace:", err);
        }
      },
      onCancel: () => setConfirmModal(prev => ({ ...prev, isOpen: false }))
    });
  }, [fetchTopology, setNodes, setEdges]);

  const applyTopologyTemplate = useCallback(async (templateType) => {
    setActiveTemplate(templateType);
    setStatusFilter(null);
    setTypeFilter(null);

    // Arrange all scanned nodes (or placed nodes if canvas has any)
    const targetNodes = scannedNodes.length > 0 ? scannedNodes : nodes.map(n => n.data);
    const N = targetNodes.length;
    if (N === 0) {
      alert("No network devices available to arrange.");
      return;
    }

    const newPositions = {};
    const newEdges = [];

    if (templateType === 'tree') {
      // ── HIERARCHICAL TREE ──
      const routers = targetNodes.filter(n => n.type === 'router');
      const root = routers[0] ||
                   targetNodes.find(n => n.type === 'core-switch') ||
                   targetNodes.find(n => n.type === 'switch' || n.type === 'poe-switch') ||
                   targetNodes.find(n => n.type === 'server') ||
                   targetNodes[0];

      const switches = targetNodes.filter(n => (n.type === 'switch' || n.type === 'poe-switch' || n.type === 'core-switch') && n.id !== root.id);
      const infra = targetNodes.filter(n => (n.type === 'access_point' || n.type === 'server' || n.type === 'nvr' || n.type === 'nas') && n.id !== root.id && !switches.some(s => s.id === n.id));
      const endpoints = targetNodes.filter(n => n.id !== root.id && !switches.some(s => s.id === n.id) && !infra.some(inf => inf.id === n.id));

      // 1. Root position
      newPositions[root.id] = { x: 500, y: 70 };

      // 2. Switches position
      const swY = 220;
      const swCount = switches.length;
      switches.forEach((sw, i) => {
        const startX = Math.max(120, 500 - ((swCount - 1) * 220) / 2);
        newPositions[sw.id] = { x: Math.round(startX + i * 220), y: swY };
        newEdges.push({ source: root.id, target: sw.id, type: 'default', inferred: true });
      });

      // 3. Infrastructure (APs, Servers) position
      const infY = 370;
      const infCount = infra.length;
      infra.forEach((inf, i) => {
        const startX = Math.max(120, 500 - ((infCount - 1) * 200) / 2);
        newPositions[inf.id] = { x: Math.round(startX + i * 200), y: infY };
        const parent = swCount > 0 ? switches[i % swCount] : root;
        newEdges.push({ source: parent.id, target: inf.id, type: 'default', inferred: true });
      });

      // 4. Endpoints (Cameras, Workstations, Printers, IoT)
      const epY = 530;
      const maxPerRow = 8;
      endpoints.forEach((ep, i) => {
        const row = Math.floor(i / maxPerRow);
        const col = i % maxPerRow;
        const countInRow = Math.min(endpoints.length - row * maxPerRow, maxPerRow);
        const startX = Math.max(80, 500 - ((countInRow - 1) * 180) / 2);
        newPositions[ep.id] = { x: Math.round(startX + col * 180), y: Math.round(epY + row * 140) };

        let parent = null;
        if (ep.type === 'camera') {
          const poeSwitches = switches.filter(s => s.type === 'poe-switch');
          parent = poeSwitches.length > 0 ? poeSwitches[i % poeSwitches.length] : (swCount > 0 ? switches[i % swCount] : root);
        } else if (ep.type === 'workstation' || ep.type === 'printer') {
          const apList = infra.filter(inf => inf.type === 'access_point');
          parent = apList.length > 0 && i % 2 === 0 ? apList[i % apList.length] : (swCount > 0 ? switches[i % swCount] : root);
        } else {
          parent = swCount > 0 ? switches[i % swCount] : (infCount > 0 ? infra[i % infCount] : root);
        }
        if (parent) {
          newEdges.push({ source: parent.id, target: ep.id, type: 'default', inferred: true });
        }
      });
    } else if (templateType === 'star') {
      // ── STAR TOPOLOGY ──
      const hub = targetNodes.find(n => n.type === 'core-switch') ||
                  targetNodes.find(n => n.type === 'switch' || n.type === 'poe-switch') ||
                  targetNodes.find(n => n.type === 'router') ||
                  targetNodes.find(n => n.type === 'server') ||
                  targetNodes[0];

      const hubId = hub.id;
      const centerX = 550;
      const centerY = 450;
      newPositions[hubId] = { x: centerX, y: centerY };

      const spokes = targetNodes.filter(n => n.id !== hubId);
      const numSpokes = spokes.length;

      if (numSpokes <= 16) {
        const radius = Math.max(260, numSpokes * 22);
        spokes.forEach((spoke, idx) => {
          const angle = (idx * 2 * Math.PI) / numSpokes;
          newPositions[spoke.id] = {
            x: Math.round(centerX + radius * Math.cos(angle)),
            y: Math.round(centerY + radius * Math.sin(angle))
          };
          newEdges.push({ source: hubId, target: spoke.id, type: 'default', inferred: false });
        });
      } else {
        const innerCount = Math.min(10, Math.floor(numSpokes / 3));
        const outerCount = numSpokes - innerCount;
        const innerSpokes = spokes.slice(0, innerCount);
        const outerSpokes = spokes.slice(innerCount);

        const rInner = 220;
        const rOuter = Math.max(380, outerCount * 18);

        innerSpokes.forEach((spoke, idx) => {
          const angle = (idx * 2 * Math.PI) / innerCount;
          newPositions[spoke.id] = {
            x: Math.round(centerX + rInner * Math.cos(angle)),
            y: Math.round(centerY + rInner * Math.sin(angle))
          };
          newEdges.push({ source: hubId, target: spoke.id, type: 'default', inferred: false });
        });

        outerSpokes.forEach((spoke, idx) => {
          const angle = (idx * 2 * Math.PI) / outerCount;
          newPositions[spoke.id] = {
            x: Math.round(centerX + rOuter * Math.cos(angle)),
            y: Math.round(centerY + rOuter * Math.sin(angle))
          };
          newEdges.push({ source: hubId, target: spoke.id, type: 'default', inferred: false });
        });
      }
    } else if (templateType === 'ring') {
      // ── RING TOPOLOGY ──
      const radius = Math.max(260, N * 22);
      const centerX = 550;
      const centerY = 450;

      targetNodes.forEach((node, idx) => {
        const angle = (idx * 2 * Math.PI) / N;
        newPositions[node.id] = {
          x: Math.round(centerX + radius * Math.cos(angle)),
          y: Math.round(centerY + radius * Math.sin(angle))
        };
        const nextNode = targetNodes[(idx + 1) % N];
        newEdges.push({ source: node.id, target: nextNode.id, type: 'default', inferred: false });
      });
    } else if (templateType === 'bus') {
      // ── BUS TOPOLOGY ──
      const gap = 160;
      const startX = 120;
      targetNodes.forEach((node, idx) => {
        const offset = idx % 2 === 0 ? -90 : 90;
        newPositions[node.id] = {
          x: Math.round(startX + idx * gap),
          y: Math.round(350 + offset)
        };
        if (idx < N - 1) {
          const nextNode = targetNodes[idx + 1];
          newEdges.push({ source: node.id, target: nextNode.id, type: 'default', inferred: false });
        }
      });
    } else if (templateType === 'mesh') {
      // ── MESH TOPOLOGY ──
      const radius = Math.max(260, N * 22);
      const centerX = 550;
      const centerY = 450;

      targetNodes.forEach((node, idx) => {
        const angle = (idx * 2 * Math.PI) / N;
        newPositions[node.id] = {
          x: Math.round(centerX + radius * Math.cos(angle)),
          y: Math.round(centerY + radius * Math.sin(angle))
        };
      });

      if (N <= 10) {
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            newEdges.push({ source: targetNodes[i].id, target: targetNodes[j].id, type: 'default', inferred: false });
          }
        }
      } else {
        for (let i = 0; i < N; i++) {
          const next1 = (i + 1) % N;
          const next2 = (i + Math.floor(N / 3)) % N;
          newEdges.push({ source: targetNodes[i].id, target: targetNodes[next1].id, type: 'default', inferred: false });
          if (next2 !== next1 && next2 !== i) {
            newEdges.push({ source: targetNodes[i].id, target: targetNodes[next2].id, type: 'default', inferred: false });
          }
        }
      }
    }

    // ── Instant optimistic UI update (0ms delay) ──
    const reactNodes = targetNodes.map(n => ({
      id: n.id,
      type: 'custom',
      _hasPosition: true,
      position: newPositions[n.id] || { x: 100, y: 100 },
      data: {
        ...n,
        position: newPositions[n.id],
        onRemove: () => removeNodeFromCanvas(n.id)
      }
    }));

    const reactEdges = newEdges.map((e, idx) => {
      const targetNode = targetNodes.find(n => n.id === e.target);
      const targetType = targetNode?.type;
      let strokeColor = '#818cf8';
      let strokeWidth = 2;
      if (targetType === 'camera') {
        strokeColor = '#10b981';
      } else if (targetType === 'server' || targetType === 'nvr') {
        strokeColor = '#3b82f6';
        strokeWidth = 2.5;
      } else if (targetType === 'switch' || targetType === 'poe-switch' || targetType === 'core-switch') {
        strokeColor = '#f59e0b';
        strokeWidth = 2.5;
      }
      return {
        id: `e-temp-${Date.now()}-${idx}`,
        source: e.source,
        target: e.target,
        animated: true,
        type: 'smoothstep',
        style: {
          stroke: strokeColor,
          strokeWidth,
          filter: `drop-shadow(0px 0px 3px ${strokeColor}66)`
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor }
      };
    });

    setNodes(reactNodes);
    setEdges(reactEdges);
    setScannedNodes(targetNodes.map(n => ({ ...n, position: newPositions[n.id] })));

    // ── Fast Atomic Persistence in background ──
    try {
      fetch(`${API_BASE}/topology/layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions: newPositions, edges: newEdges })
      }).catch(err => {
        console.error("Topology template persistence note:", err);
      });
    } catch {}
  }, [scannedNodes, nodes, removeNodeFromCanvas]);

  const placeAllDevices = useCallback(async () => {
    if (scannedNodes.length === 0) return;
    applyTopologyTemplate('tree');
  }, [scannedNodes, applyTopologyTemplate]);


  const sentHistory   = bwHistory.map(b => b?.sent_kbps || 0);
  const recvHistory   = bwHistory.map(b => b?.recv_kbps || 0);
  const latestBw      = bwHistory[bwHistory.length - 1] || {};
  const onlineCount   = scannedNodes.filter(n => n.status === 'online').length;
  const offlineCount  = scannedNodes.filter(n => n.status === 'offline').length;
  const degradedCount = scannedNodes.filter(n => n.status === 'degraded').length;

  // Device type counts for filter buttons
  const DEVICE_TYPES = ['camera', 'router', 'switch', 'poe-switch', 'core-switch', 'access_point', 'server', 'workstation', 'printer', 'nas', 'nvr', 'iot', 'unknown', 'other'];
  const nodesByType = scannedNodes.reduce((acc, n) => {
    const t = n.type || 'other';
    if (!acc[t]) acc[t] = [];
    acc[t].push(n);
    return acc;
  }, {});

  const d = selectedNode
    ? (deviceLiveData ? { ...selectedNode.data, ...deviceLiveData } : selectedNode.data)
    : null;

  const selectedNodeAlerts = selectedNode
    ? alerts.filter(a =>
        a.node_id === selectedNode.id ||
        (d?.ip && a.ip === d.ip)
      )
    : [];

  // ─── Filter chip style helper ─────────────────────────────────────────────
  const chipStyle = (active, activeColor = '#6366f1') => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 20,
    border: `1px solid ${active ? activeColor : 'transparent'}`,
    background: active ? `${activeColor}22` : 'rgba(255,255,255,0.04)',
    color: active ? activeColor : '#9ca3af',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: active ? 700 : 500,
    transition: 'all 0.15s',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  });

  const filteredNodes = scannedNodes.filter(node => {
    if (statusFilter && node.status !== statusFilter) return false;
    if (typeFilter   && node.type   !== typeFilter)   return false;
    
    const q = searchQuery.toLowerCase();
    const ipMatch = (node.ip || '').toLowerCase().includes(q);
    const macMatch = (node.mac || '').toLowerCase().includes(q);
    const modelMatch = (node.model || '').toLowerCase().includes(q);
    const vendorMatch = (node.vendor || node.manufacturer || '').toLowerCase().includes(q);
    const typeLabelMatch = deviceTypeLabel(node.type).toLowerCase().includes(q);
    const makeMatch = makeModelLabel(node).toLowerCase().includes(q);
    return ipMatch || macMatch || modelMatch || vendorMatch || typeLabelMatch || makeMatch;
  });

  const onlineNodes = filteredNodes.filter(n => n.status === 'online');
  const degradedNodes = filteredNodes.filter(n => n.status === 'degraded');
  const offlineNodes = filteredNodes.filter(n => n.status === 'offline');

  const renderLibraryItem = (node) => {
    const isPlaced = nodes.some(n => n.id === node.id);
    return (
      <div key={`${node.id}-${node.ip}`}
        className={`library-item status--${node.status}`}
        draggable={!isPlaced}
        onDragStart={e => !isPlaced && onDragStart(e, node)}
        onClick={() => {
          const pseudoNode = nodes.find(n => n.id === node.id) || { id: node.id, data: node };
          handleNodeClick(null, pseudoNode);
        }}
        style={{
          opacity: isPlaced ? 0.65 : 1,
          cursor: isPlaced ? 'pointer' : 'grab',
          borderRight: isPlaced ? '3px solid #10b981' : 'none',
          background: isPlaced ? 'rgba(16, 185, 129, 0.03)' : 'transparent',
          marginBottom: 4,
          borderRadius: 6,
          transition: 'all 0.15s'
        }}
      >
        <div className="item-icon"><Icon type={node.type} model={node.model} subtype={node.camera_type} /></div>
        <div className="item-info">
          <span className="item-ip">{node.ip}</span>
          <span className="item-mdl" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {cleanModel(node) ? `${cleanModel(node)} • ${deviceTypeLabel(node.type)}` : deviceTypeLabel(node.type)}
            {isPlaced && (
              <span style={{
                color: '#10b981',
                fontSize: 12,
                fontWeight: 700,
                background: 'rgba(16,185,129,0.15)',
                padding: '1px 4px',
                borderRadius: 4
              }}>
                PLACED
              </span>
            )}
          </span>
        </div>
        <span className="item-dot" style={{ background: statusColor(node.status) }} />
      </div>
    );
  };

  return (
    <div className="topology-container">
      {/* ── LEFT SIDEBAR ── */}
      <div className="topology-library">
        <div className="sidebar-header">
          <h3>Devices</h3>
          <button className="topo-btn topo-btn--small" onClick={triggerScan} title="Scan">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        </div>

        {/* Search Input */}
        <div className="sidebar-search-box">
          <div className="search-input-wrapper">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search devices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
        </div>

        {/* ── STATUS FILTER BADGES ── */}
        <div className="status-summary" style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '6px 12px' }}>
          <span
            onClick={() => toggleStatusFilter('online')}
            style={chipStyle(statusFilter === 'online', '#10b981')}
            title="Show only Online"
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            {onlineCount} Online
          </span>
          <span
            onClick={() => toggleStatusFilter('offline')}
            style={chipStyle(statusFilter === 'offline', '#ef4444')}
            title="Show only Offline"
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            {offlineCount} Offline
          </span>
          {degradedCount > 0 && (
            <span
              onClick={() => toggleStatusFilter('degraded')}
              style={chipStyle(statusFilter === 'degraded', '#f59e0b')}
              title="Show only Degraded"
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
              {degradedCount} Degraded
            </span>
          )}
        </div>

        {/* ── DEVICE TYPE FILTER DROPDOWN ── */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px 0 12px', marginTop: 2 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Filter by Type
          </div>

          <div className="type-filter-dropdown-wrapper" ref={typeDropdownRef}>
            <button
              type="button"
              className={`type-filter-trigger ${typeFilter ? 'type-filter-trigger--active' : ''}`}
              onClick={() => setTypeDropdownOpen(prev => !prev)}
              aria-expanded={typeDropdownOpen}
              aria-haspopup="listbox"
            >
              <div className="type-filter-trigger__left">
                {typeFilter ? (
                  <Icon type={typeFilter} size={13} />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                )}
                <span className="type-filter-trigger__label">
                  {typeFilter ? deviceTypeLabel(typeFilter) : 'All Device Types'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span className="type-filter-trigger__badge">
                  {typeFilter ? (nodesByType[typeFilter]?.length || 0) : scannedNodes.length}
                </span>
                <span className={`type-filter-chevron ${typeDropdownOpen ? 'type-filter-chevron--open' : ''}`}>
                  ▼
                </span>
              </div>
            </button>

            {typeDropdownOpen && (
              <div className="type-filter-menu" role="listbox">
                {/* Reset / All Types option */}
                <button
                  type="button"
                  className={`type-filter-option ${!typeFilter ? 'type-filter-option--active' : ''}`}
                  onClick={() => {
                    setTypeFilter(null);
                    setTypeDropdownOpen(false);
                  }}
                  role="option"
                  aria-selected={!typeFilter}
                >
                  <div className="type-filter-option__left">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                    </svg>
                    <span>All Device Types</span>
                  </div>
                  <span className="type-filter-option__badge">
                    {scannedNodes.length}
                  </span>
                </button>

                <div className="type-filter-divider" />

                {DEVICE_TYPES.map(type => {
                  const count = nodesByType[type]?.length || 0;
                  if (count === 0) return null;
                  const active = typeFilter === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`type-filter-option ${active ? 'type-filter-option--active' : ''}`}
                      onClick={() => {
                        toggleTypeFilter(type);
                        setTypeDropdownOpen(false);
                      }}
                      role="option"
                      aria-selected={active}
                    >
                      <div className="type-filter-option__left">
                        <Icon type={type} size={13} />
                        <span>{deviceTypeLabel(type)}</span>
                      </div>
                      <span className="type-filter-option__badge">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Clear filter button */}
          {(statusFilter || typeFilter) && (
            <button
              onClick={() => { setStatusFilter(null); setTypeFilter(null); }}
              style={{
                marginTop: 8,
                width: '100%',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 7,
                color: '#f87171',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
                padding: '5px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <Icon type="x" size={10}/> Clear Filter
            </button>
          )}
        </div>

        <div className="library-content">
          {filteredNodes.length === 0 && <p className="empty-msg">No devices match filters.</p>}
          
          {onlineNodes.length > 0 && (
            <div className="accordion-group">
              <button className="accordion-header" onClick={() => toggleGroup('online')}>
                <span className="accordion-title-wrapper">
                  <span className="accordion-indicator online" />
                  Online ({onlineNodes.length})
                </span>
                <span className={`accordion-chevron ${expandedGroups.online ? 'expanded' : ''}`}>▼</span>
              </button>
              {expandedGroups.online && (
                <div className="accordion-content">
                  {onlineNodes.map(renderLibraryItem)}
                </div>
              )}
            </div>
          )}

          {degradedNodes.length > 0 && (
            <div className="accordion-group">
              <button className="accordion-header" onClick={() => toggleGroup('degraded')}>
                <span className="accordion-title-wrapper">
                  <span className="accordion-indicator degraded" />
                  Degraded ({degradedNodes.length})
                </span>
                <span className={`accordion-chevron ${expandedGroups.degraded ? 'expanded' : ''}`}>▼</span>
              </button>
              {expandedGroups.degraded && (
                <div className="accordion-content">
                  {degradedNodes.map(renderLibraryItem)}
                </div>
              )}
            </div>
          )}

          {offlineNodes.length > 0 && (
            <div className="accordion-group">
              <button className="accordion-header" onClick={() => toggleGroup('offline')}>
                <span className="accordion-title-wrapper">
                  <span className="accordion-indicator offline" />
                  Offline ({offlineNodes.length})
                </span>
                <span className={`accordion-chevron ${expandedGroups.offline ? 'expanded' : ''}`}>▼</span>
              </button>
              {expandedGroups.offline && (
                <div className="accordion-content">
                  {offlineNodes.map(renderLibraryItem)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── MAIN CANVAS ── */}
      <div className="topology-canvas" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={visibleNodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick} onEdgeClick={handleEdgeClick}
          onNodeDragStop={onNodeDragStop} nodeTypes={memoizedNodeTypes} edgeTypes={memoizedEdgeTypes} fitView>
          <Background color="#1f2937" gap={20} />
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable maskColor="rgba(0,0,0,0.1)" />

          {activeTemplate && (
            <Panel position="top-center">
              <div className="topo-current-layout">
                <Icon type="template" size={14} />
                Current Layout: {activeTemplate.charAt(0).toUpperCase() + activeTemplate.slice(1)}
              </div>
            </Panel>
          )}

          <Panel position="top-left" className="topo-toolbar-unified">
            <div className="unified-toolbar-row">
              <SpecularButton
                size="sm"
                radius={8}
                tint="#10b981"
                tintOpacity={0.10}
                blur={4}
                textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
                lineColor="#10b981"
                baseColor={theme === 'light' ? "#d1fae5" : "#0d3326"}
                intensity={1.2}
                shineSize={12}
                shineFade={38}
                thickness={1}
                speed={0.35}
                followMouse
                proximity={220}
                autoAnimate={false}
                className="topo-btn topo-btn--primary"
                onClick={triggerScan}
                disabled={scanning}
              >
                {scanning ? 'Scanning…' : 'Scan Network'}
              </SpecularButton>

              <button
                className="topo-btn"
                onClick={() => {
                  fetchTopology();
                  fetchMetrics();
                  fetchAlerts();
                  fetchBandwidth();
                }}
                title="Reload cached topology and live status"
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <Icon type="refresh" size={13} />
                <span>Refresh</span>
              </button>

              <button className="topo-btn" onClick={placeAllDevices} disabled={scanning || scannedNodes.length === 0}>
                Place All
              </button>
              <button className="topo-btn topo-btn-clear" onClick={resetWorkspace} disabled={scanning}>
                Clear Canvas
              </button>
              
              <div className="toolbar-divider" />
              
              <div ref={templatesDropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  className={`topo-btn ${templatesDropdownOpen ? 'topo-btn--active' : ''}`}
                  onClick={() => setTemplatesDropdownOpen(prev => !prev)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  title="Choose Topology Template"
                >
                  <Icon type="template" size={14} />
                  <span>Templates</span>
                  <span style={{ fontSize: '10px', opacity: 0.7 }}>▼</span>
                </button>
                {templatesDropdownOpen && (
                  <div className="topo-templates-dropdown" style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    background: '#111827',
                    border: '1px solid #1f2937',
                    borderRadius: 8,
                    padding: '4px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 150,
                  }}>
                    <button
                      className="topo-dropdown-item"
                      style={{ color: activeTemplate === 'star' ? '#10b981' : undefined }}
                      onClick={() => {
                        applyTopologyTemplate('star');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Star Topology
                    </button>
                    <button
                      className="topo-dropdown-item"
                      style={{ color: activeTemplate === 'ring' ? '#10b981' : undefined }}
                      onClick={() => {
                        applyTopologyTemplate('ring');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Ring Topology
                    </button>
                    <button
                      className="topo-dropdown-item"
                      style={{ color: activeTemplate === 'bus' ? '#10b981' : undefined }}
                      onClick={() => {
                        applyTopologyTemplate('bus');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Bus Topology
                    </button>
                    <button
                      className="topo-dropdown-item"
                      style={{ color: activeTemplate === 'mesh' ? '#10b981' : undefined }}
                      onClick={() => {
                        applyTopologyTemplate('mesh');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Mesh Topology
                    </button>
                    <button
                      className="topo-dropdown-item"
                      style={{ color: activeTemplate === 'tree' ? '#10b981' : undefined }}
                      onClick={() => {
                        applyTopologyTemplate('tree');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Hierarchical
                    </button>
                  </div>
                )}
              </div>
              
              {(statusFilter || typeFilter) && (
                <>
                  <div className="toolbar-divider" />
                  <div className="canvas-filter-badge">
                    <span>
                      {statusFilter
                        ? `Showing: ${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`
                        : `Type: ${deviceTypeLabel(typeFilter)}`}
                    </span>
                    <button
                      onClick={() => { setStatusFilter(null); setTypeFilter(null); }}
                      className="canvas-filter-clear-btn"
                      title="Clear filter"
                    >
                      <Icon type="x" size={11} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </Panel>

          <Panel position="top-right" className="topo-legend" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="legend-item"><span className="dot dot--online"/> Online</div>
            <div className="legend-item"><span className="dot dot--degraded"/> Degraded</div>
            <div className="legend-item"><span className="dot dot--offline"/> Offline</div>
            {/* ── BELL ALERT BUTTON ── */}
            <BellAlertButton alerts={alerts} onAck={ackAlert} />
          </Panel>
        </ReactFlow>
      </div>

      {/* ── RIGHT SIDEBAR ── */}
      {sidebarOpen && (selectedNode || selectedEdge) && (
        <div className="topology-sidebar">
          <div className="sidebar-header">
            <h3>
              {selectedEdge ? 'Physical Connection' : deviceTypeLabel(d?.type)}
              {deviceRefreshing && (
                <span style={{ fontSize: 13, color: '#6366f1', marginLeft: 8, fontWeight: 400 }}>
                  fetching…
                </span>
              )}
            </h3>
            <button className="close-btn" onClick={closeSidebar}>×</button>
          </div>
          <div className="sidebar-tabs">
            {selectedEdge ? (
              <button className="stab stab--active">Connection Details</button>
            ) : (
              <>
                <button className={`stab ${activeTab==='details' ?'stab--active':''}`} onClick={() => setActiveTab('details')}>Details</button>
                <button className={`stab ${activeTab==='metrics' ?'stab--active':''}`} onClick={() => setActiveTab('metrics')}>System</button>
                <button className={`stab ${activeTab==='alerts'  ?'stab--active':''}`} onClick={() => setActiveTab('alerts')}>
                  Alerts {selectedNodeAlerts.length > 0 && <span className="alert-badge">{selectedNodeAlerts.length}</span>}
                </button>
              </>
            )}
          </div>

          <div className="sidebar-content">
            {selectedEdge && (
              <>
                <div className="section-title">Connection Properties</div>
                <div className="detail-row"><label>Cable Type</label><span>{selectedEdge.data?.cableType || 'Unknown'}</span></div>
                <div className="detail-row"><label>Connector</label><span>{selectedEdge.data?.connectorType || 'Unknown'}</span></div>
                <div className="detail-row"><label>Speed</label><span>{selectedEdge.data?.linkSpeed || 'Unknown'}</span></div>
                <div className="detail-row"><label>Length</label><span>{selectedEdge.data?.length ? `${selectedEdge.data.length}m` : 'N/A'}</span></div>
                <div className="detail-row"><label>PoE</label><span>{selectedEdge.data?.poeEnabled ? 'Yes' : 'No'}</span></div>
                <div className="detail-row"><label>Remarks</label><span>{selectedEdge.data?.remarks || 'N/A'}</span></div>
                
                <div className="section-title" style={{ marginTop: 12 }}>Endpoints</div>
                <div className="detail-row"><label>Source Device</label><span>{scannedNodes.find(n => n.id === selectedEdge.source)?.ip || selectedEdge.source}</span></div>
                <div className="detail-row"><label>Source Port</label><span>{selectedEdge.data?.sourcePort || 'Unknown'}</span></div>
                <div className="detail-row"><label>Dest Device</label><span>{scannedNodes.find(n => n.id === selectedEdge.target)?.ip || selectedEdge.target}</span></div>
                <div className="detail-row"><label>Dest Port</label><span>{selectedEdge.data?.destinationPort || 'Unknown'}</span></div>
                
                <div style={{ marginTop: 20 }}>
                  <button className="topo-btn topo-btn-clear" style={{ width: '100%', justifyContent: 'center' }} onClick={async () => {
                    if (window.confirm('Delete this connection?')) {
                      await fetch(`${API_BASE}/connections/${selectedEdge.data?.id || selectedEdge.id}`, { method: 'DELETE' });
                      setSidebarOpen(false);
                      setSelectedEdge(null);
                      fetchTopology();
                    }
                  }}>
                    Delete Connection
                  </button>
                </div>
              </>
            )}

            {!selectedEdge && activeTab === 'details' && d && (
              <>
                {/* ── Dynamic Hero Card ── */}
                <div className="device-hero-card">
                  <div className="device-hero-top">
                    <div className="device-hero-icon">
                      <Icon type={d.type} size={28} model={d.model} subtype={d.camera_type} />
                    </div>
                    <div className="device-hero-meta">
                      <div className="device-hero-title" title={cleanModel(d) || d.model || d.ip}>
                        {cleanModel(d) || d.model || d.ip}
                      </div>
                      <div className="device-hero-sub">
                        <span>{cleanMake(d) || d.vendor || 'Network Device'}</span>
                        <span>•</span>
                        <span className={`badge badge--${d.type}`}>{deviceTypeLabel(d.type)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="device-hero-status-row">
                    <span className={`status-pill ${d.status || 'offline'}`}>
                      {(d.status || 'offline').toUpperCase()}
                    </span>
                    <span className="live-ping-badge">
                      {d.latency != null && d.latency >= 0 ? `${Math.round(d.latency)}ms latency` : 'unreachable'}
                    </span>
                  </div>
                </div>

                {/* ── Identity & Hardware Details ── */}
                <div className="section-title">Identity & Hardware</div>
                <div className="id-card-table">
                  <div className="id-card-row">
                    <span className="id-label">IP Address</span>
                    <span className="id-val mono">
                      {d.ip || '—'}
                      {d.ip && (
                        <button className="copy-btn" onClick={() => copyValue(d.ip, 'ip')} title="Copy IP">
                          {copiedField === 'ip' ? '✓' : <Icon type="copy" size={11} />}
                        </button>
                      )}
                    </span>
                  </div>

                  <div className="id-card-row">
                    <span className="id-label">MAC Address</span>
                    <span className="id-val mono">
                      {d.mac ? d.mac.toUpperCase() : '—'}
                      {d.mac && (
                        <button className="copy-btn" onClick={() => copyValue(d.mac, 'mac')} title="Copy MAC">
                          {copiedField === 'mac' ? '✓' : <Icon type="copy" size={11} />}
                        </button>
                      )}
                    </span>
                  </div>

                  {d.hostname && (
                    <div className="id-card-row">
                      <span className="id-label">Hostname</span>
                      <span className="id-val bold">{d.hostname}</span>
                    </div>
                  )}

                  <div className="id-card-row">
                    <span className="id-label">Manufacturer</span>
                    <span className="id-val bold">{cleanMake(d) || d.vendor || d.manufacturer || 'Unknown'}</span>
                  </div>

                  <div className="id-card-row">
                    <span className="id-label">Hardware Model</span>
                    <span className="id-val bold">{cleanModel(d) || d.model || 'Unknown'}</span>
                  </div>

                  <div className="id-card-row">
                    <span className="id-label">Device Category</span>
                    <span className="id-val">{deviceTypeLabel(d.type)}</span>
                  </div>

                  {d.confidence != null && (
                    <div className="id-card-row">
                      <span className="id-label">Confidence</span>
                      <span className="id-val">
                        <span style={{
                          background: d.confidence >= 70 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                          color: d.confidence >= 70 ? '#10b981' : '#f59e0b',
                          padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700
                        }}>
                          {d.confidence}% Verified
                        </span>
                      </span>
                    </div>
                  )}

                  {d.classification_reason && (
                    <div className="id-card-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
                      <span className="id-label">Classification Basis</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, textAlign: 'left' }}>
                        {d.classification_reason}
                      </span>
                    </div>
                  )}

                  {d.classification_evidence && d.classification_evidence.length > 0 && (
                    <div className="id-card-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                      <span className="id-label">Detection Evidence</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {d.classification_evidence.map((ev, i) => (
                          <span key={i} className="evidence-chip">
                            {ev}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Open Ports & Exposed Services ── */}
                <div className="section-title" style={{ marginTop: 14 }}>Open Ports & Services</div>
                {d.open_ports && d.open_ports.length > 0 ? (
                  <div className="ports-grid">
                    {d.open_ports.map((port) => {
                      const svcMap = {
                        21: 'FTP', 22: 'SSH', 23: 'Telnet', 53: 'DNS', 80: 'HTTP',
                        135: 'MSRPC', 139: 'NetBIOS', 443: 'HTTPS', 445: 'SMB', 554: 'RTSP',
                        1935: 'RTMP', 8000: 'HTTP-Dev', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt',
                        37777: 'Dahua'
                      };
                      return (
                        <div key={port} className="port-badge">
                          <span className="port-num">{port}</span>
                          <span className="port-svc">{svcMap[port] || 'TCP'}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-subtext">No open TCP ports discovered</div>
                )}

                {(() => {
                  const nodeConnections = edges.filter(e => e.type === 'connection' && (e.source === d.id || e.target === d.id));
                  if (nodeConnections.length === 0) return null;
                  return (
                    <>
                      <div className="section-title" style={{ marginTop: 24, marginBottom: 12 }}>Physical Connections</div>
                      {nodeConnections.map(c => {
                        const isSource = c.source === d.id;
                        const remoteId = isSource ? c.target : c.source;
                        const remoteNode = scannedNodes.find(n => n.id === remoteId);
                        const remoteName = remoteNode?.ip || remoteNode?.label || remoteId;
                        return (
                          <div key={c.id} style={{ background: '#111827', padding: '10px 12px', borderRadius: '8px', border: '1px solid #374151', marginBottom: '8px' }}>
                            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: 4 }}>
                              Connected to <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{remoteName}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#6b7280' }}>
                              Cable: <span style={{ color: '#9ca3af' }}>{c.data?.cableType || 'Unknown'}</span> ({c.data?.linkSpeed || 'Unknown'})
                            </div>
                            {c.data?.remarks && (
                              <div style={{ fontSize: '12px', color: '#6366f1', fontStyle: 'italic', marginTop: '6px' }}>
                                "{c.data.remarks}"
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}

                {/* Canvas Staging Controls */}
                <div style={{ marginTop: 12, marginBottom: 12 }}>
                  {nodes.some(n => n.id === d.id) ? (
                    <button
                      className="topo-btn"
                      style={{
                        width: '100%',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        justifyContent: 'center'
                      }}
                      onClick={() => removeNodeFromCanvas(d.id)}
                    >
                      <Icon type="x" size={12} /> Remove from Canvas
                    </button>
                  ) : (
                    <button
                      className="topo-btn topo-btn--primary"
                      style={{
                        width: '100%',
                        justifyContent: 'center'
                      }}
                      onClick={() => {
                        const defaultPos = { x: 300, y: 200 };
                        setNodes(nds => nds.concat({
                          id: d.id,
                          type: 'custom',
                          position: defaultPos,
                          data: { 
                            ...d, 
                            onRemove: () => removeNodeFromCanvas(d.id) 
                          }
                        }));
                        setScannedNodes(snd => snd.map(n => n.id === d.id ? { ...n, position: defaultPos } : n));
                        fetch(`${API_BASE}/nodes/${d.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ position: defaultPos })
                        });
                      }}
                    >
                      <Icon type="check" size={12} /> Place on Canvas
                    </button>
                  )}
                </div>

                {/* ── Real-Time Network Bandwidth widget ── */}
                <div className="section-title" style={{ marginTop: 12 }}>Network Bandwidth</div>
                {d.type === 'camera' ? (
                  <div className="stream-panel" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="stream-label" style={{ fontSize: 14 }}>RTSP Stream Bitrate</span>
                      <span className="stream-val" style={{ fontSize: 18, fontWeight: 800, color: '#10b981', fontFamily: 'monospace' }}>
                        {d.stream_bitrate_mbps != null ? `${d.stream_bitrate_mbps} Mbps` : '0 Mbps'}
                      </span>
                    </div>
                    <div className="metric-bar" style={{ height: 4, background: '#1f2937' }}>
                      <div className="metric-bar__fill" style={{
                        width: `${Math.min(((d.stream_bitrate_mbps || 0) / 10) * 100, 100)}%`,
                        background: '#10b981',
                        boxShadow: '0 0 6px #10b981'
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'rgba(255, 255, 255, 0.4)' }}>
                      <span>Latency: {d.latency != null ? `${Math.round(d.latency)}ms` : '—'}</span>
                      <span>Packet Loss: {d.packet_loss != null ? `${d.packet_loss}%` : '—'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="stream-panel" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="stream-label" style={{ fontSize: 14 }}>Global TX (Sent)</span>
                      <span className="stream-val" style={{ fontSize: 16, fontWeight: 800, color: '#10b981', fontFamily: 'monospace' }}>
                        {latestBw.sent_kbps != null ? (latestBw.sent_kbps / 1024).toFixed(2) + ' Mbps' : '0 Mbps'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="stream-label" style={{ fontSize: 14 }}>Global RX (Received)</span>
                      <span className="stream-val" style={{ fontSize: 16, fontWeight: 800, color: '#6366f1', fontFamily: 'monospace' }}>
                        {latestBw.recv_kbps != null ? (latestBw.recv_kbps / 1024).toFixed(2) + ' Mbps' : '0 Mbps'}
                      </span>
                    </div>
                    <div className="metric-bar" style={{ height: 4, background: '#1f2937' }}>
                      <div className="metric-bar__fill" style={{
                        width: `${Math.min(((latestBw.recv_kbps || 0) / 1024 / 100) * 100, 100)}%`,
                        background: '#6366f1',
                        boxShadow: '0 0 6px #6366f1'
                      }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.4)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Host Uptime: {metrics?.uptime || '—'}</span>
                        <span>Latency: {d.latency != null ? `${Math.round(d.latency)}ms` : '—'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4, background: 'rgba(0,0,0,0.25)', padding: '6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                        <Sparkline data={recvHistory} color="#6366f1" height={30} width={360} />
                      </div>
                    </div>
                  </div>
                )}



                {(d.type === 'poe-switch' || d.type === 'switch') && d.poe_power && <PoEPanel d={d} />}

                {(d.type === 'poe-switch' || d.type === 'core-switch' || d.type === 'switch') && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>Switch Ports</div>
                    <SwitchPortTable ports={d.switch_ports} />
                  </>
                )}

                {d.type === 'nvr' && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>NVR Connectivity</div>
                    <NVRPanel d={d} />
                  </>
                )}

                {d.type === 'camera' && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>Stream Health</div>
                    <CameraStreamPanel
                      d={selectedNode.data}
                      liveData={deviceLiveData}
                      isRefreshing={deviceRefreshing}
                      onRefresh={() => fetchDeviceLiveData(selectedNode)}
                    />
                  </>
                )}
              </>
            )}

            {activeTab === 'network' && (
              <div className="network-tab">
                <div className="bw-section">
                  <div className="bw-header">
                    <span>Network Bandwidth <span style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 14 }}>(network-wide)</span></span>
                    <span className="bw-live">LIVE</span>
                  </div>
                  <div className="bw-row">
                    <div className="bw-stat">
                      <span className="bw-label">↑ TX</span>
                      <span className="bw-val">{latestBw.sent_kbps != null ? (latestBw.sent_kbps / 1024).toFixed(2) + ' Mbps' : '0 Mbps'}</span>
                      <Sparkline data={sentHistory} color="#10b981" />
                    </div>
                    <div className="bw-stat">
                      <span className="bw-label">↓ RX</span>
                      <span className="bw-val">{latestBw.recv_kbps != null ? (latestBw.recv_kbps / 1024).toFixed(2) + ' Mbps' : '0 Mbps'}</span>
                      <Sparkline data={recvHistory} color="#6366f1" />
                    </div>
                  </div>
                  <div className="bw-threshold-note">
                    <Icon type="zap" size={10}/> Spike alert threshold: {BW_SPIKE_THRESHOLD_MBPS} Mbps
                  </div>
                </div>

                <div className="perf-section">
                  <div className="section-title">
                    Diagnostics for <span style={{ color: '#6366f1' }}>{d?.ip}</span>
                  </div>
                  <NetworkPerfTable diagnostics={diagnostics} filterIp={d?.ip} />
                  {!diagnostics && <p className="empty-msg">Waiting for diagnostics data…</p>}
                </div>
              </div>
            )}

            {activeTab === 'metrics' && (
              <div className="metrics-tab">
                {metrics ? (
                  <>
                    <MetricCard icon="cpu"      label="CPU Usage"  value={metrics.cpu?.toFixed(1)}  unit="%" percent={metrics.cpu}  color="#6366f1" />
                    <MetricCard icon="activity" label="RAM Usage"  value={metrics.ram?.toFixed(1)}  unit="%" percent={metrics.ram}  color="#10b981" />
                    <MetricCard icon="disk"     label="Disk Usage" value={metrics.disk?.toFixed(1)} unit="%" percent={metrics.disk} color="#f59e0b" />
                    {metrics.gpu > 0 && <MetricCard icon="cpu" label="GPU Usage" value={metrics.gpu?.toFixed(1)} unit="%" percent={metrics.gpu} color="#ec4899" />}
                    <div className="metrics-divider" />
                    <div className="detail-row"><label>System Uptime</label><span>{metrics.uptime || 'N/A'}</span></div>
                    <div className="detail-row"><label>Last Reboot</label><span>{metrics.last_reboot || 'N/A'}</span></div>
                    <div className="detail-row"><label>Reboot Reason</label><span>{metrics.reboot_reason || 'N/A'}</span></div>
                  </>
                ) : <p className="empty-msg">Loading system metrics…</p>}
              </div>
            )}

            {activeTab === 'alerts' && (
              <div className="alerts-tab">
                {selectedNodeAlerts.length === 0 ? (
                  <div className="no-alerts">
                    <Icon type="check" size={32} />
                    <p>No alerts for {d?.ip || 'this device'}</p>
                  </div>
                ) : selectedNodeAlerts.map((a, i) => {
                  const sev = a.severity || 'warning';
                  const sevColor = { critical: '#ef4444', warning: '#f59e0b', info: '#60a5fa' }[sev] || '#ef4444';
                  return (
                    <div key={i} className="alert-card" style={{ borderColor: `${sevColor}66`, borderLeftColor: sevColor }}>
                      <div className="alert-card__icon" style={{ color: sevColor }}><Icon type="alert" size={16} /></div>
                      <div className="alert-card__body">
                        <div className="alert-card__sev" style={{ color: sevColor, fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{sev.toUpperCase()}</div>
                        <div className="alert-card__msg">{a.message}</div>
                        <div className="alert-card__meta"><span>{a.ip}</span><span>{new Date(a.timestamp).toLocaleTimeString()}</span></div>
                      </div>
                      <button className="alert-ack" onClick={() => ackAlert(a.node_id)}>ACK</button>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── CUSTOM CONFIRM MODAL ── */}
      {confirmModal.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 12,
            width: 400,
            maxWidth: '90%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #374151',
              display: 'flex', alignItems: 'center', gap: 10
            }}>
              <Icon type="alert" size={18} />
              <h3 style={{ margin: 0, fontSize: 16, color: '#f3f4f6', fontWeight: 600 }}>
                {confirmModal.title || 'Confirm Action'}
              </h3>
            </div>
            <div style={{ padding: '20px', color: '#d1d5db', fontSize: 15, lineHeight: 1.5 }}>
              {confirmModal.message}
            </div>
            <div style={{
              padding: '16px 20px',
              background: '#111827',
              borderTop: '1px solid #374151',
              display: 'flex', justifyContent: 'flex-end', gap: 12
            }}>
              <button
                onClick={confirmModal.onCancel}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid #4b5563',
                  background: 'transparent',
                  color: '#d1d5db',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => e.target.style.background = 'rgba(255,255,255,0.05)'}
                onMouseOut={e => e.target.style.background = 'transparent'}
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#6366f1',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  boxShadow: '0 2px 4px rgba(99, 102, 241, 0.2)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => e.target.style.background = '#4f46e5'}
                onMouseOut={e => e.target.style.background = '#6366f1'}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}