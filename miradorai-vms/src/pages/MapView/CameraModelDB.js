const API = import.meta.env.VITE_API_URL || "";

function getAuthHeaders() {
  const t =
    localStorage.getItem("miradorai_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    localStorage.getItem("access_token") ||
    sessionStorage.getItem("token") ||
    sessionStorage.getItem("authToken") ||
    "";
  return t
    ? { Authorization: "Bearer " + t, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

export const CAMERA_DB = [
  // ─── DAHUA ────────────────────────────────────────────────────────────────
  {
    id: "dahua-ipc-hdbw2831r-zas", brand: "Dahua", series: "Lite", model: "IPC-HDBW2831R-ZAS",
    type: "dome", sensor: '1/2.7"', sensorW: 5.37, sensorH: 4.04, megapixels: 8,
    focalLength: 2.7, focalLengthMax: 13.5, isVarifocal: true,
    hfov: 106, hfovMin: 28, vfov: 56, dfov: 110,
    rangeDay: 40, rangeNight: 40, ir: 40, poe: true, ip: "IP67",
    notes: "8MP motorised varifocal dome, 40 m IR",
    coverageArea: 2827, icon: "dome",
  },
  {
    id: "dahua-ipc-hfw2849s-s-il", brand: "Dahua", series: "Lite", model: "IPC-HFW2849S-S-IL",
    type: "bullet", sensor: '1/2.7"', sensorW: 5.37, sensorH: 4.04, megapixels: 8,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 102, hfovMin: null, vfov: 54, dfov: 107,
    rangeDay: 30, rangeNight: 60, ir: 60, poe: true, ip: "IP67",
    notes: "8MP dual-light Smart IR bullet, 60 m IR",
    coverageArea: 2827, icon: "bullet",
  },
  {
    id: "dahua-sd49425xb-hnr", brand: "Dahua", series: "WizSense PTZ", model: "SD49425XB-HNR",
    type: "ptz", sensor: '1/2.8"', sensorW: 5.37, sensorH: 4.04, megapixels: 4,
    focalLength: 4.8, focalLengthMax: 120, isVarifocal: true,
    hfov: 58, hfovMin: 2.5, vfov: 33, dfov: 65,
    rangeDay: 100, rangeNight: 100, ir: 100, poe: false, ip: "IP66",
    notes: "4MP 25× optical PTZ, AI auto-tracking",
    coverageArea: 31416, icon: "ptz",
  },
  {
    id: "dahua-ipc-eb5541-as", brand: "Dahua", series: "Pro Fisheye", model: "IPC-EB5541-AS",
    type: "fisheye", sensor: '1/1.8"', sensorW: 7.18, sensorH: 5.32, megapixels: 5,
    focalLength: 1.4, focalLengthMax: null, isVarifocal: false,
    hfov: 180, hfovMin: null, vfov: 180, dfov: 180,
    rangeDay: 10, rangeNight: 0, ir: 0, poe: true, ip: "IP67",
    notes: "5MP 180° fisheye ceiling mount, no IR",
    coverageArea: 314, icon: "fisheye",
  },
  {
    id: "dahua-ipc-hfw3849h-as-pv", brand: "Dahua", series: "Full-color", model: "IPC-HFW3849H-AS-PV",
    type: "bullet", sensor: '1/2.7"', sensorW: 5.37, sensorH: 4.04, megapixels: 8,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 102, hfovMin: null, vfov: 54, dfov: 107,
    rangeDay: 40, rangeNight: 40, ir: 0, poe: true, ip: "IP67",
    notes: "8MP full-color active deterrence bullet",
    coverageArea: 5027, icon: "bullet",
  },

  // ─── AXIS ─────────────────────────────────────────────────────────────────
  {
    id: "axis-p3245-v", brand: "Axis", series: "P32", model: "P3245-V",
    type: "dome", sensor: '1/2.8"', sensorW: 5.37, sensorH: 4.04, megapixels: 2,
    focalLength: 3.0, focalLengthMax: 10.9, isVarifocal: true,
    hfov: 100, hfovMin: 30, vfov: 52, dfov: 104,
    rangeDay: 30, rangeNight: 0, ir: 0, poe: true, ip: "IK10/IP42",
    notes: "2MP varifocal fixed dome, WDR, HDTV 1080p",
    coverageArea: 2827, icon: "dome",
  },
  {
    id: "axis-q6135-le", brand: "Axis", series: "Q61", model: "Q6135-LE",
    type: "ptz", sensor: '1/2.8"', sensorW: 5.37, sensorH: 4.04, megapixels: 2,
    focalLength: 4.44, focalLengthMax: 142.6, isVarifocal: true,
    hfov: 64, hfovMin: 2.1, vfov: 36, dfov: 69,
    rangeDay: 200, rangeNight: 200, ir: 200, poe: false, ip: "IP66",
    notes: "2MP 32× outdoor PTZ with IR 200 m, EIS",
    coverageArea: 125664, icon: "ptz",
  },
  {
    id: "axis-m3106-l-mk-ii", brand: "Axis", series: "M31", model: "M3106-L Mk II",
    type: "dome", sensor: '1/3"', sensorW: 4.8, sensorH: 3.6, megapixels: 4,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 95, hfovMin: null, vfov: 50, dfov: 100,
    rangeDay: 20, rangeNight: 10, ir: 10, poe: true, ip: "IK08/IP42",
    notes: "4MP fixed dome, built-in IR 10 m, corridor format",
    coverageArea: 1257, icon: "dome",
  },
  {
    id: "axis-p1448-le", brand: "Axis", series: "P14", model: "P1448-LE",
    type: "bullet", sensor: '1/1.7"', sensorW: 7.18, sensorH: 5.32, megapixels: 8,
    focalLength: 3.9, focalLengthMax: 10.0, isVarifocal: true,
    hfov: 103, hfovMin: 38, vfov: 54, dfov: 107,
    rangeDay: 50, rangeNight: 0, ir: 0, poe: true, ip: "IP66",
    notes: "8MP multi-view panoramic bullet with 4 sensors",
    coverageArea: 7854, icon: "bullet",
  },
  {
    id: "axis-fa54", brand: "Axis", series: "FA", model: "FA54",
    type: "fisheye", sensor: '1/2.3"', sensorW: 6.17, sensorH: 4.55, megapixels: 8,
    focalLength: 1.1, focalLengthMax: null, isVarifocal: false,
    hfov: 185, hfovMin: null, vfov: 185, dfov: 185,
    rangeDay: 8, rangeNight: 0, ir: 0, poe: true, ip: "IP42",
    notes: "8MP 185° fisheye sensor unit for F-series main unit",
    coverageArea: 201, icon: "fisheye",
  },

  // ─── BOSCH ────────────────────────────────────────────────────────────────
  {
    id: "bosch-fnd-8503-rv", brand: "Bosch", series: "FLEXIDOME", model: "FND-8503-RV",
    type: "dome", sensor: '1/1.8"', sensorW: 7.18, sensorH: 5.32, megapixels: 5,
    focalLength: 3.3, focalLengthMax: 10.5, isVarifocal: true,
    hfov: 103, hfovMin: 36, vfov: 58, dfov: 107,
    rangeDay: 30, rangeNight: 0, ir: 0, poe: true, ip: "IK10/IP66",
    notes: "5MP HDR varifocal indoor/outdoor dome, IVA built-in",
    coverageArea: 2827, icon: "dome",
  },
  {
    id: "bosch-nbn-80122-f2", brand: "Bosch", series: "DINION", model: "NBN-80122-F2",
    type: "bullet", sensor: '1/1.8"', sensorW: 7.18, sensorH: 5.32, megapixels: 12,
    focalLength: 2.0, focalLengthMax: null, isVarifocal: false,
    hfov: 120, hfovMin: null, vfov: 64, dfov: 124,
    rangeDay: 35, rangeNight: 0, ir: 0, poe: true, ip: "IP66",
    notes: "12MP ultra-wide 120° HFOV fixed bullet, Starlight HDR",
    coverageArea: 3848, icon: "bullet",
  },
  {
    id: "bosch-mic-7522-z30b", brand: "Bosch", series: "MIC", model: "MIC 7522-Z30B",
    type: "ptz", sensor: '1/2.8"', sensorW: 5.37, sensorH: 4.04, megapixels: 2,
    focalLength: 4.3, focalLengthMax: 129, isVarifocal: true,
    hfov: 62, hfovMin: 2.1, vfov: 35, dfov: 67,
    rangeDay: 200, rangeNight: 200, ir: 0, poe: false, ip: "IP68",
    notes: "2MP 30× ultra-robust outdoor PTZ, –55°C to +65°C",
    coverageArea: 125664, icon: "ptz",
  },

  // ─── HIKVISION ────────────────────────────────────────────────────────────
  {
    id: "hikvision-ds-2cd2385g1-i", brand: "Hikvision", series: "AcuSense", model: "DS-2CD2385G1-I",
    type: "dome", sensor: '1/2.5"', sensorW: 5.76, sensorH: 4.29, megapixels: 8,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 102, hfovMin: null, vfov: 54, dfov: 107,
    rangeDay: 30, rangeNight: 30, ir: 30, poe: true, ip: "IP67",
    notes: "8MP AcuSense fixed dome, 30 m IR, deep learning",
    coverageArea: 2827, icon: "dome",
  },
  {
    id: "hikvision-ds-2de4425iwde-t5", brand: "Hikvision", series: "Smart PTZ", model: "DS-2DE4425IWG-E/T5",
    type: "ptz", sensor: '1/2.8"', sensorW: 5.37, sensorH: 4.04, megapixels: 4,
    focalLength: 4.8, focalLengthMax: 120, isVarifocal: true,
    hfov: 58, hfovMin: 2.5, vfov: 33, dfov: 65,
    rangeDay: 100, rangeNight: 100, ir: 100, poe: false, ip: "IP66",
    notes: "4MP 25× optical PTZ, AcuSense AI auto-tracking",
    coverageArea: 31416, icon: "ptz",
  },
  {
    id: "hikvision-ds-2cd2347g2-lu", brand: "Hikvision", series: "ColorVu", model: "DS-2CD2347G2-LU",
    type: "dome", sensor: '1/2.7"', sensorW: 5.37, sensorH: 4.04, megapixels: 4,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 102, hfovMin: null, vfov: 54, dfov: 107,
    rangeDay: 40, rangeNight: 40, ir: 0, poe: true, ip: "IP67",
    notes: "4MP ColorVu full-color 24/7 dome, no IR",
    coverageArea: 5027, icon: "dome",
  },
  {
    id: "hikvision-ds-2cd2t87g2-l", brand: "Hikvision", series: "ColorVu", model: "DS-2CD2T87G2-L",
    type: "bullet", sensor: '1/1.8"', sensorW: 7.18, sensorH: 5.32, megapixels: 8,
    focalLength: 4.0, focalLengthMax: null, isVarifocal: false,
    hfov: 96, hfovMin: null, vfov: 54, dfov: 100,
    rangeDay: 60, rangeNight: 60, ir: 0, poe: true, ip: "IP67",
    notes: "8MP ColorVu full-color bullet, 60 m white light",
    coverageArea: 11310, icon: "bullet",
  },
  {
    id: "hikvision-ds-2cd2t85fwd-i8", brand: "Hikvision", series: "Pro", model: "DS-2CD2T85FWD-I8",
    type: "bullet", sensor: '1/2.5"', sensorW: 5.76, sensorH: 4.29, megapixels: 8,
    focalLength: 4.0, focalLengthMax: null, isVarifocal: false,
    hfov: 80, hfovMin: null, vfov: 43, dfov: 84,
    rangeDay: 50, rangeNight: 80, ir: 80, poe: true, ip: "IP67",
    notes: "8MP outdoor bullet, 80 m IR, WDR 120 dB",
    coverageArea: 7854, icon: "bullet",
  },

  // ─── SONY ─────────────────────────────────────────────────────────────────
  {
    id: "sony-snc-vm772r", brand: "Sony", series: "SNC-VM", model: "SNC-VM772R",
    type: "dome", sensor: '1/2.8"', sensorW: 5.37, sensorH: 4.04, megapixels: 4,
    focalLength: 2.8, focalLengthMax: 8.0, isVarifocal: true,
    hfov: 100, hfovMin: 38, vfov: 52, dfov: 104,
    rangeDay: 30, rangeNight: 30, ir: 30, poe: true, ip: "IP66",
    notes: "4MP full HD dome, Exmor CMOS, 30 m IR",
    coverageArea: 2827, icon: "dome",
  },
  {
    id: "sony-snc-em641", brand: "Sony", series: "SNC-EM", model: "SNC-EM641",
    type: "fisheye", sensor: '1/2.3"', sensorW: 6.17, sensorH: 4.55, megapixels: 8,
    focalLength: 1.4, focalLengthMax: null, isVarifocal: false,
    hfov: 180, hfovMin: null, vfov: 180, dfov: 180,
    rangeDay: 10, rangeNight: 0, ir: 0, poe: true, ip: "IP42",
    notes: "8MP 180° fisheye indoor ceiling mount",
    coverageArea: 314, icon: "fisheye",
  },

  // ─── HANWHA (Samsung) ─────────────────────────────────────────────────────
  {
    id: "hanwha-qno-8080r", brand: "Hanwha", series: "Q Series", model: "QNO-8080R",
    type: "bullet", sensor: '1/2.7"', sensorW: 5.37, sensorH: 4.04, megapixels: 5,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 104, hfovMin: null, vfov: 55, dfov: 109,
    rangeDay: 30, rangeNight: 50, ir: 50, poe: true, ip: "IP66",
    notes: "5MP outdoor bullet, 50 m IR, WDR 120 dB",
    coverageArea: 2827, icon: "bullet",
  },
  {
    id: "hanwha-xno-8120r", brand: "Hanwha", series: "X Series", model: "XNO-8120R",
    type: "bullet", sensor: '1/2.5"', sensorW: 5.76, sensorH: 4.29, megapixels: 5,
    focalLength: 4.0, focalLengthMax: null, isVarifocal: false,
    hfov: 83, hfovMin: null, vfov: 46, dfov: 88,
    rangeDay: 50, rangeNight: 50, ir: 50, poe: true, ip: "IP66",
    notes: "5MP long-range bullet, Wisenet5 SoC",
    coverageArea: 7854, icon: "bullet",
  },
  {
    id: "hanwha-qnd-8080r", brand: "Hanwha", series: "Q Series", model: "QND-8080R",
    type: "dome", sensor: '1/2.7"', sensorW: 5.37, sensorH: 4.04, megapixels: 5,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 104, hfovMin: null, vfov: 55, dfov: 109,
    rangeDay: 20, rangeNight: 30, ir: 30, poe: true, ip: "IK10/IP66",
    notes: "5MP vandal-resistant dome, 30 m IR",
    coverageArea: 1257, icon: "dome",
  },
  {
    id: "hanwha-xnp-9300rw", brand: "Hanwha", series: "X Series PTZ", model: "XNP-9300RW",
    type: "ptz", sensor: '1/2.8"', sensorW: 5.37, sensorH: 4.04, megapixels: 4,
    focalLength: 4.4, focalLengthMax: 132, isVarifocal: true,
    hfov: 63, hfovMin: 2.1, vfov: 36, dfov: 68,
    rangeDay: 200, rangeNight: 200, ir: 200, poe: false, ip: "IP66",
    notes: "4MP 30× PTZ, IR 200 m, wiper, Wisenet5",
    coverageArea: 125664, icon: "ptz",
  },

  // ─── CP PLUS ─────────────────────────────────────────────────────────────
  {
    id: "cpplus-cp-unc-ta41zl3-ms", brand: "CP Plus", series: "Coral", model: "CP-UNC-TA41ZL3-MS",
    type: "bullet", sensor: '1/3"', sensorW: 4.8, sensorH: 3.6, megapixels: 4,
    focalLength: 2.7, focalLengthMax: 12.0, isVarifocal: true,
    hfov: 98, hfovMin: 31, vfov: 53, dfov: 102,
    rangeDay: 35, rangeNight: 50, ir: 50, poe: true, ip: "IP67",
    notes: "4MP Motorized Varifocal Bullet Camera, 50m IR",
    coverageArea: 3848, icon: "bullet",
  },
  {
    id: "cpplus-cp-unc-da41l2c-v2", brand: "CP Plus", series: "Coral", model: "CP-UNC-DA41L2C-V2",
    type: "dome", sensor: '1/3"', sensorW: 4.8, sensorH: 3.6, megapixels: 4,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 100, hfovMin: null, vfov: 53, dfov: 104,
    rangeDay: 25, rangeNight: 30, ir: 30, poe: true, ip: "IP67",
    notes: "4MP Full-color Fixed Dome Camera, 30m White Light",
    coverageArea: 1963, icon: "dome",
  },

  // ─── HONEYWELL ───────────────────────────────────────────────────────────
  {
    id: "honeywell-hc30wb4r2", brand: "Honeywell", series: "30 Series", model: "HC30WB4R2",
    type: "bullet", sensor: '1/3"', sensorW: 4.8, sensorH: 3.6, megapixels: 4,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 100, hfovMin: null, vfov: 55, dfov: 105,
    rangeDay: 30, rangeNight: 50, ir: 50, poe: true, ip: "IP66",
    notes: "4MP IP Bullet Camera with WDR and Smart IR 50m",
    coverageArea: 2827, icon: "bullet",
  },
  {
    id: "honeywell-hc30wd4r2", brand: "Honeywell", series: "30 Series", model: "HC30WD4R2",
    type: "dome", sensor: '1/3"', sensorW: 4.8, sensorH: 3.6, megapixels: 4,
    focalLength: 2.8, focalLengthMax: null, isVarifocal: false,
    hfov: 100, hfovMin: null, vfov: 55, dfov: 105,
    rangeDay: 25, rangeNight: 30, ir: 30, poe: true, ip: "IK10/IP66",
    notes: "4MP IP Micro Dome Camera, 30m IR, NDAA compliant",
    coverageArea: 1963, icon: "dome",
  },

  // ─── UNIVIEW ─────────────────────────────────────────────────────────────
  {
    id: "uniview-ipc2128sb-adf40kmc-i0", brand: "Uniview", series: "Prime", model: "IPC2128SB-ADF40KMC-I0",
    type: "bullet", sensor: '1/2.8"', sensorW: 5.37, sensorH: 4.04, megapixels: 8,
    focalLength: 4.0, focalLengthMax: null, isVarifocal: false,
    hfov: 87, hfovMin: null, vfov: 47, dfov: 92,
    rangeDay: 45, rangeNight: 30, ir: 30, poe: true, ip: "IP67",
    notes: "8MP Tri-guard Active Deterrence Network Bullet Camera",
    coverageArea: 6361, icon: "bullet",
  },
  {
    id: "uniview-ipc3234sb-adzk-i0", brand: "Uniview", series: "Prime", model: "IPC3234SB-ADZK-I0",
    type: "dome", sensor: '1/3"', sensorW: 4.8, sensorH: 3.6, megapixels: 4,
    focalLength: 2.8, focalLengthMax: 12.0, isVarifocal: true,
    hfov: 102, hfovMin: 31, vfov: 54, dfov: 106,
    rangeDay: 35, rangeNight: 40, ir: 40, poe: true, ip: "IK10/IP67",
    notes: "4MP Motorized Varifocal Vandal-resistant Dome",
    coverageArea: 3848, icon: "dome",
  },
];

export const BRANDS = Array.from(new Set(CAMERA_DB.map(c => c.brand))).filter(Boolean).sort();
export const TYPES  = Array.from(new Set(CAMERA_DB.map(c => c.type))).filter(Boolean);

/** Return cameras filtered by brand and/or type */
export function filterCameras({ brand = null, type = null, search = "" } = {}) {
  return CAMERA_DB.filter(c => {
    if (brand && c.brand?.toLowerCase() !== brand.toLowerCase()) return false;
    if (type  && c.type?.toLowerCase()  !== type.toLowerCase())  return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.brand.toLowerCase().includes(q) ||
        c.model.toLowerCase().includes(q) ||
        (c.series || "").toLowerCase().includes(q) ||
        (c.notes || "").toLowerCase().includes(q)
      );
    }
    return true;
  });
}

export async function fetchCameraModels({ brand = null, type = null, search = "" } = {}) {
  try {
    const params = new URLSearchParams();
    if (brand)  params.append("brand",  brand);
    if (type)   params.append("type",   type);
    if (search) params.append("search", search);

    const r = await fetch(`${API}/api/designer/camera-models?${params}`, {
      headers: getAuthHeaders(),
    });
    if (r.ok) {
      const data = await r.json();
      if (data && (Array.isArray(data.cameras) && data.cameras.length > 0 || Array.isArray(data.brands) && data.brands.length > 0)) {
        const brandsList = (data.brands && data.brands.length > 0)
          ? data.brands
          : Array.from(new Set(data.cameras.map(c => c.brand))).filter(Boolean).sort();
        return {
          cameras: data.cameras || [],
          brands: brandsList
        };
      }
    }
  } catch (err) {
    console.warn("[CameraModelDB] API request failed, falling back to local database:", err);
  }

  // Graceful fallback to rich local CAMERA_DB
  const filtered = filterCameras({ brand, type, search });
  const allBrands = Array.from(new Set(CAMERA_DB.map(c => c.brand))).filter(Boolean).sort();
  return {
    cameras: filtered,
    brands: allBrands
  };
}

export function fovDrawParams(camera, direction = 0) {
  const hfov    = camera?.hfov || 60;
  const halfRad = (hfov / 2) * (Math.PI / 180);
  const angle   = direction  * (Math.PI / 180);
  return { angle, halfRad, hfov };
}

export function coverageRadiusPx(camera, pixelsPerMetre = 20) {
  return (camera?.rangeDay || 20) * pixelsPerMetre;
}