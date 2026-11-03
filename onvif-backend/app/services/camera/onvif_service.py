import re
import ssl
import os
from datetime import datetime, timedelta, timezone
from app.services.camera.camera_api_detector import detect_camera_api

# ── Patch SSL BEFORE any other imports so zeep/requests never verify certs ──
os.environ['CURL_CA_BUNDLE'] = ''
os.environ['REQUESTS_CA_BUNDLE'] = ''
os.environ['SSL_CERT_FILE'] = ''

try:
    _orig_create_default_context = ssl.create_default_context
    def _patched_ssl_context(*args, **kwargs):
        ctx = _orig_create_default_context(*args, **kwargs)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    ssl.create_default_context = _patched_ssl_context
except Exception:
    pass

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

import requests
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager

class _NoSSLAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        kwargs['ssl_context'] = ssl.create_default_context()
        return super().init_poolmanager(*args, **kwargs)

# Patch the default requests session
_session = requests.Session()
_session.verify = False
_session.mount('https://', _NoSSLAdapter())

try:
    import zeep.transports as _zt
    _orig_transport_init = _zt.Transport.__init__
    def _patched_transport_init(self, *args, **kwargs):
        kwargs.setdefault('operation_timeout', 10)
        _orig_transport_init(self, *args, **kwargs)
        try:
            self.session.verify = False
            self.session.mount('https://', _NoSSLAdapter())
        except Exception:
            pass
    _zt.Transport.__init__ = _patched_transport_init
except Exception:
    pass

from onvif import ONVIFCamera
try:
    requests.packages.urllib3.disable_warnings()
except Exception:
    pass


def _make_cam(ip, port, username, password):
    """Create ONVIFCamera with SSL verification disabled."""
    cam = ONVIFCamera(ip, port, username, password)
    try:
        for attr in dir(cam):
            if attr.startswith('_'):
                continue
            svc = getattr(cam, attr, None)
            if svc and hasattr(svc, 'transport'):
                try:
                    svc.transport.session.verify = False
                except Exception:
                    pass
    except Exception:
        pass
    return cam


def _parse_onvif_time(date_obj, time_obj):
    if date_obj is None or time_obj is None:
        return None
    try:
        seconds = float(getattr(time_obj, 'Second', 0))
        sec_int = int(seconds)
        micro = int((seconds - sec_int) * 1_000_000)
        return datetime(
            date_obj.Year, date_obj.Month, date_obj.Day,
            time_obj.Hour, time_obj.Minute, sec_int, micro,
        )
    except Exception:
        return None


def _parse_onvif_timezone(tz_obj):
    if tz_obj is None:
        return None
    if isinstance(tz_obj, str):
        tz_str = tz_obj
    else:
        tz_str = getattr(tz_obj, 'TZ', None) or getattr(tz_obj, 'GMT', None)
    if not tz_str:
        return None
    tz_str = str(tz_str).strip()
    if not tz_str:
        return None
    if tz_str.upper() in ('UTC', 'Z'):
        return timezone.utc
    if '/' in tz_str:
        try:
            from zoneinfo import ZoneInfo
            return ZoneInfo(tz_str)
        except Exception:
            pass
        try:
            import pytz
            return pytz.timezone(tz_str)
        except Exception:
            pass
    posix_match = re.match(r'^[A-Za-z]+([+-]\d{1,2}(?::?\d{2})?)', tz_str)
    if posix_match:
        tz_str = posix_match.group(1)
    if tz_str.upper().startswith('GMT'):
        tz_str = tz_str[3:].strip()
    match = re.match(r'^([+-])\s*(\d{1,2})(?::?(\d{2}))?(?:\.(\d+))?$', tz_str)
    if match:
        sign, hours_text, minutes_text, decimal_text = match.groups()
        try:
            hours   = int(hours_text)
            minutes = int(minutes_text) if minutes_text else 0
            if decimal_text:
                minutes = int(round(float('0.' + decimal_text) * 60))
            delta = timedelta(hours=hours, minutes=minutes)
            if sign == '-':
                delta = -delta
            return timezone(delta)
        except Exception:
            return None
    return None


_NON_CAMERA_KEYWORDS = [
    "nas", "display", "decoder", "workstation", "desktop", "laptop"
]


# ─────────────────────────────────────────────────────────────────
# CAPABILITY FETCHING HELPERS
# ─────────────────────────────────────────────────────────────────

def _fetch_capabilities(device_service) -> dict:
    caps = {
        "ptz":       False,
        "imaging":   False,
        "events":    False,
        "analytics": False,
        "io":        False,
        "recording": False,
    }
    try:
        raw = device_service.GetCapabilities({"Category": "All"})

        if getattr(raw, 'PTZ', None):
            caps["ptz"] = True
        if getattr(raw, 'Imaging', None):
            caps["imaging"] = True
        if getattr(raw, 'Events', None):
            caps["events"] = True
        if getattr(raw, 'Analytics', None):
            caps["analytics"] = True

        device_cap = getattr(raw, 'Device', None)
        if device_cap:
            io_cap = getattr(device_cap, 'IO', None)
            if io_cap:
                inputs  = getattr(io_cap, 'InputConnectors',  0) or 0
                outputs = getattr(io_cap, 'RelayOutputs',     0) or 0
                caps["io"] = (inputs > 0 or outputs > 0)
                caps["io_inputs"]  = int(inputs)
                caps["io_outputs"] = int(outputs)

        rec_cap = getattr(raw, 'Recording', None) or getattr(raw, 'MediaCapabilities', None)
        if rec_cap:
            caps["recording"] = True

        print(f"[CAPS] GetCapabilities: {caps}")
    except Exception as e:
        print(f"[CAPS] GetCapabilities failed: {e}")

    return caps


def _fetch_imaging_settings(cam, media_service) -> dict:
    imaging_info = {
        "supported": False,
        "brightness":       None,
        "contrast":         None,
        "saturation":       None,
        "sharpness":        None,
        "backlight_compensation": None,
        "exposure_mode":    None,
        "exposure_min_gain": None,
        "exposure_max_gain": None,
        "exposure_min_shutter": None,
        "exposure_max_shutter": None,
        "white_balance_mode": None,
        "ir_cut_filter":    None,
        "wide_dynamic_range": None,
        "wdr_level":        None,
        "focus_mode":       None,
        "focus_near_limit": None,
        "focus_far_limit":  None,
        "options":          {},
    }

    try:
        imaging_service = cam.create_imaging_service()
        try:
            imaging_service.transport.session.verify = False
        except Exception:
            pass

        media_service2 = cam.create_media_service()
        try:
            media_service2.transport.session.verify = False
        except Exception:
            pass

        sources = media_service2.GetVideoSources()
        if not sources:
            return imaging_info

        source_token = sources[0].token
        settings = imaging_service.GetImagingSettings({"VideoSourceToken": source_token})
        imaging_info["supported"] = True

        imaging_info["brightness"]  = _safe_get(settings, 'Brightness')
        imaging_info["contrast"]    = _safe_get(settings, 'ColorSaturation')
        imaging_info["saturation"]  = _safe_get(settings, 'ColorSaturation')
        imaging_info["sharpness"]   = _safe_get(settings, 'Sharpness')

        blc = _safe_get(settings, 'BacklightCompensation')
        if blc:
            imaging_info["backlight_compensation"] = {
                "mode":  str(getattr(blc, 'Mode',  '') or ''),
                "level": _safe_get(blc, 'Level'),
            }

        exp = _safe_get(settings, 'Exposure')
        if exp:
            imaging_info["exposure_mode"]        = str(getattr(exp, 'Mode', '') or '')
            imaging_info["exposure_min_gain"]    = _safe_get(exp, 'MinGain')
            imaging_info["exposure_max_gain"]    = _safe_get(exp, 'MaxGain')
            imaging_info["exposure_min_shutter"] = _safe_get(exp, 'MinExposureTime')
            imaging_info["exposure_max_shutter"] = _safe_get(exp, 'MaxExposureTime')

        wb = _safe_get(settings, 'WhiteBalance')
        if wb:
            imaging_info["white_balance_mode"] = str(getattr(wb, 'Mode', '') or '')

        ir = _safe_get(settings, 'IrCutFilter')
        if ir is not None:
            imaging_info["ir_cut_filter"] = str(ir)

        wdr = _safe_get(settings, 'WideDynamicRange')
        if wdr:
            imaging_info["wide_dynamic_range"] = str(getattr(wdr, 'Mode', '') or '')
            imaging_info["wdr_level"]          = _safe_get(wdr, 'Level')

        focus = _safe_get(settings, 'Focus')
        if focus:
            imaging_info["focus_mode"]       = str(getattr(focus, 'AutoFocusMode', '') or '')
            imaging_info["focus_near_limit"] = _safe_get(focus, 'NearLimit')
            imaging_info["focus_far_limit"]  = _safe_get(focus, 'FarLimit')

        try:
            options = imaging_service.GetOptions({"VideoSourceToken": source_token})
            opts = {}

            brightness_opts = _safe_get(options, 'Brightness')
            if brightness_opts:
                opts["brightness_range"] = {
                    "min": _safe_get(brightness_opts, 'Min'),
                    "max": _safe_get(brightness_opts, 'Max'),
                }

            contrast_opts = _safe_get(options, 'ColorSaturation')
            if contrast_opts:
                opts["saturation_range"] = {
                    "min": _safe_get(contrast_opts, 'Min'),
                    "max": _safe_get(contrast_opts, 'Max'),
                }

            sharpness_opts = _safe_get(options, 'Sharpness')
            if sharpness_opts:
                opts["sharpness_range"] = {
                    "min": _safe_get(sharpness_opts, 'Min'),
                    "max": _safe_get(sharpness_opts, 'Max'),
                }

            exp_opts = _safe_get(options, 'Exposure')
            if exp_opts:
                modes = getattr(exp_opts, 'Mode', []) or []
                opts["exposure_modes"] = [str(m) for m in modes]

            wb_opts = _safe_get(options, 'WhiteBalance')
            if wb_opts:
                modes = getattr(wb_opts, 'Mode', []) or []
                opts["white_balance_modes"] = [str(m) for m in modes]

            ir_opts = _safe_get(options, 'IrCutFilterModes')
            if ir_opts:
                opts["ir_cut_modes"] = [str(m) for m in ir_opts]

            wdr_opts = _safe_get(options, 'WideDynamicRange')
            if wdr_opts:
                modes = getattr(wdr_opts, 'Mode', []) or []
                opts["wdr_modes"] = [str(m) for m in modes]

            focus_opts = _safe_get(options, 'Focus')
            if focus_opts:
                modes = getattr(focus_opts, 'AutoFocusMode', []) or []
                opts["focus_modes"] = [str(m) for m in modes]

            imaging_info["options"] = opts
        except Exception as e:
            print(f"[IMAGING] GetOptions failed: {e}")

        print(f"[IMAGING] Settings fetched for {source_token}: "
              f"brightness={imaging_info['brightness']}, "
              f"ir_cut={imaging_info['ir_cut_filter']}, "
              f"wdr={imaging_info['wide_dynamic_range']}")

    except Exception as e:
        print(f"[IMAGING] GetImagingSettings failed: {e}")

    return imaging_info


def _fetch_ptz_info(cam, media_service) -> dict:
    ptz_info = {
        "supported":       False,
        "presets":         [],
        "home_supported":  False,
        "continuous_move": False,
        "absolute_move":   True,
        "relative_move":   False,
        "spaces":          {},
    }

    try:
        ptz_service = cam.create_ptz_service()
        try:
            ptz_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return ptz_info

        token = profiles[0].token

        has_nodes = False
        try:
            nodes = ptz_service.GetNodes()
            if nodes:
                has_nodes = True
                node = nodes[0]
                sup_spaces = getattr(node, 'SupportedPTZSpaces', None)
                if sup_spaces:
                    cont = getattr(sup_spaces, 'ContinuousPanTiltVelocitySpace', None)
                    ptz_info["continuous_move"] = bool(cont)
                    rel = getattr(sup_spaces, 'RelativePanTiltTranslationSpace', None)
                    ptz_info["relative_move"] = bool(rel)
        except Exception as e:
            print(f"[PTZ] GetNodes failed: {e}")

        has_configs = False
        try:
            configs = ptz_service.GetConfigurations()
            if configs:
                has_configs = True
        except Exception:
            pass

        has_profile_ptz = any(getattr(p, 'PTZConfiguration', None) is not None for p in profiles)

        # Print debug info directly to console/logs
        try:
            print(f"[PTZ-DEBUG] Probing IP: {ip}")
            print(f"[PTZ-DEBUG] Profiles count: {len(profiles)}")
            print(f"[PTZ-DEBUG] has_nodes: {has_nodes}")
            try:
                print(f"[PTZ-DEBUG] GetNodes output: {ptz_service.GetNodes()}")
            except Exception as e:
                print(f"[PTZ-DEBUG] GetNodes error: {e}")
            print(f"[PTZ-DEBUG] has_configs: {has_configs}")
            try:
                print(f"[PTZ-DEBUG] GetConfigurations output: {ptz_service.GetConfigurations()}")
            except Exception as e:
                print(f"[PTZ-DEBUG] GetConfigurations error: {e}")
            print(f"[PTZ-DEBUG] has_profile_ptz: {has_profile_ptz}")
            for p in profiles:
                print(f"[PTZ-DEBUG] Profile '{p.Name}' PTZConfiguration: {getattr(p, 'PTZConfiguration', None)}")
        except Exception as log_err:
            print(f"[PTZ-DEBUG] FAILED TO PRINT DEBUG LOG: {log_err}")

        ptz_info["supported"] = bool(has_nodes or has_configs or has_profile_ptz)

        # Only fetch presets and configuration features if PTZ is supported
        if ptz_info["supported"]:
            try:
                presets = ptz_service.GetPresets({"ProfileToken": token})
                ptz_info["presets"] = [
                    {
                        "token": str(p.token),
                        "name":  str(getattr(p, 'Name', f"Preset {i+1}")),
                    }
                    for i, p in enumerate(presets or [])
                ]
                print(f"[PTZ] {len(ptz_info['presets'])} preset(s) found")
            except Exception as e:
                print(f"[PTZ] GetPresets failed: {e}")

            try:
                config = ptz_service.GetConfiguration({"PTZConfigurationToken": token})
                if config:
                    ptz_info["home_supported"] = True
            except Exception:
                pass

    except Exception as e:
        print(f"[PTZ] PTZ service failed: {e}")

    return ptz_info


def _fetch_event_capabilities(cam) -> dict:
    event_info = {
        "supported":         False,
        "motion_detection":  False,
        "tampering":         False,
        "line_crossing":     False,
        "intrusion":         False,
        "face_detection":    False,
        "audio_detection":   False,
        "topics":            [],
    }

    try:
        event_service = cam.create_events_service()
        try:
            event_service.transport.session.verify = False
        except Exception:
            pass

        props = event_service.GetEventProperties()
        event_info["supported"] = True

        topic_set    = getattr(props, 'TopicSet', None)
        topics_raw   = str(topic_set) if topic_set else ""
        topics_lower = topics_raw.lower()

        event_info["motion_detection"] = any(k in topics_lower for k in [
            "motion", "cellobjectdetection", "motionalarm", "rulealarm"
        ])
        event_info["tampering"] = any(k in topics_lower for k in [
            "tamper", "tampering", "sabotage"
        ])
        event_info["line_crossing"] = any(k in topics_lower for k in [
            "linecrossing", "linecross", "crossing"
        ])
        event_info["intrusion"] = any(k in topics_lower for k in [
            "intrusion", "fielddetection", "regionofinterest"
        ])
        event_info["face_detection"] = any(k in topics_lower for k in [
            "face", "facedetect", "facerecognition"
        ])
        event_info["audio_detection"] = any(k in topics_lower for k in [
            "audio", "audiodetect", "soundalarm"
        ])

        topic_names = re.findall(r'<[^/][^>]*:([A-Za-z]+)\s', topics_raw)
        event_info["topics"] = list(set(topic_names))[:20]

        print(f"[EVENTS] motion={event_info['motion_detection']}, "
              f"tamper={event_info['tampering']}, "
              f"linecross={event_info['line_crossing']}")

    except Exception as e:
        print(f"[EVENTS] GetEventProperties failed: {e}")

    return event_info


def _fetch_audio_info(cam, media_service) -> dict:
    audio_info = {
        "input_supported":  False,
        "output_supported": False,
        "encoding":         None,
        "sample_rate":      None,
        "bitrate":          None,
    }

    try:
        profiles = media_service.GetProfiles()
        if profiles:
            for p in profiles:
                aec = getattr(p, 'AudioEncoderConfiguration', None)
                if aec:
                    audio_info["input_supported"] = True
                    audio_info["encoding"]    = str(getattr(aec, 'Encoding',   '') or '')
                    audio_info["sample_rate"] = _safe_get(aec, 'SampleRate')
                    audio_info["bitrate"]     = _safe_get(aec, 'Bitrate')
                    break

        try:
            sources = media_service.GetAudioSources()
            if sources:
                audio_info["input_supported"] = True
        except Exception:
            pass

        try:
            outputs = media_service.GetAudioOutputs()
            if outputs:
                audio_info["output_supported"] = True
        except Exception:
            pass

        print(f"[AUDIO] input={audio_info['input_supported']}, "
              f"output={audio_info['output_supported']}, "
              f"enc={audio_info['encoding']}")

    except Exception as e:
        print(f"[AUDIO] Audio detection failed: {e}")

    return audio_info


def _fetch_network_info(device_service) -> dict:
    net_info = {
        "dhcp":         None,
        "ip_address":   None,
        "gateway":      None,
        "dns":          [],
        "ntp":          [],
        "hostname":     None,
        "http_port":    int(os.environ.get("CAMERA_DEFAULT_PORT")),
        "rtsp_port":    int(os.environ.get("RTSP_PORT")),
        "https_port":   None,
    }

    try:
        interfaces = device_service.GetNetworkInterfaces()
        if interfaces:
            iface = interfaces[0]
            ipv4  = getattr(iface, 'IPv4', None)
            if ipv4:
                config = getattr(ipv4, 'Config', None)
                if config:
                    net_info["dhcp"] = bool(getattr(config, 'DHCP', False))
                    manual = getattr(config, 'Manual', None)
                    if manual and len(manual) > 0:
                        net_info["ip_address"] = getattr(manual[0], 'Address', None)
    except Exception as e:
        print(f"[NET] GetNetworkInterfaces failed: {e}")

    try:
        gw = device_service.GetNetworkDefaultGateway()
        if gw:
            addrs = getattr(gw, 'IPv4Address', []) or []
            if addrs:
                net_info["gateway"] = str(addrs[0])
    except Exception:
        pass

    try:
        dns = device_service.GetDNS()
        if dns:
            servers = getattr(dns, 'DNSManual', []) or getattr(dns, 'DNSFromDHCP', []) or []
            net_info["dns"] = [str(getattr(s, 'IPv4Address', s)) for s in servers][:3]
    except Exception:
        pass

    try:
        ntp = device_service.GetNTP()
        if ntp:
            servers = getattr(ntp, 'NTPManual', []) or getattr(ntp, 'NTPFromDHCP', []) or []
            net_info["ntp"] = [str(getattr(s, 'IPv4Address', getattr(s, 'DNSname', s))) for s in servers][:3]
    except Exception:
        pass

    try:
        host = device_service.GetHostname()
        if host:
            net_info["hostname"] = str(getattr(host, 'Name', '') or '')
    except Exception:
        pass

    try:
        protocols = device_service.GetServiceCapabilities()
        if protocols:
            net_info["tls_support"] = bool(getattr(protocols, 'TLS1.2', False))
    except Exception:
        pass

    return net_info


def _fetch_io_info(device_service) -> dict:
    io_info = {
        "relay_outputs": [],
        "alarm_inputs":  [],
    }

    try:
        relays = device_service.GetRelayOutputs()
        io_info["relay_outputs"] = [
            {
                "token":      str(getattr(r, 'token', i)),
                "mode":       str(getattr(getattr(r, 'Properties', None), 'Mode', '') or ''),
                "idle_state": str(getattr(getattr(r, 'Properties', None), 'IdleState', '') or ''),
            }
            for i, r in enumerate(relays or [])
        ]
        print(f"[IO] {len(io_info['relay_outputs'])} relay output(s)")
    except Exception as e:
        print(f"[IO] GetRelayOutputs failed: {e}")

    try:
        inputs = device_service.GetDigitalInputs()
        io_info["alarm_inputs"] = [
            {
                "token":      str(getattr(inp, 'token', i)),
                "idle_state": str(getattr(inp, 'IdleState', '') or ''),
            }
            for i, inp in enumerate(inputs or [])
        ]
        print(f"[IO] {len(io_info['alarm_inputs'])} alarm input(s)")
    except Exception as e:
        print(f"[IO] GetDigitalInputs failed: {e}")

    return io_info


def _fetch_analytics_info(cam) -> dict:
    analytics_info = {
        "supported":    False,
        "rule_support": False,
        "modules":      [],
    }

    try:
        analytics_service = cam.create_analyticsdevice_service()
        try:
            analytics_service.transport.session.verify = False
        except Exception:
            pass

        analytics_info["supported"] = True

        try:
            configs = analytics_service.GetAnalyticsEngineConfigurations()
            if configs:
                analytics_info["rule_support"] = True
                analytics_info["modules"] = [
                    str(getattr(c, 'Name', f"Module {i}"))
                    for i, c in enumerate(configs or [])
                ]
        except Exception:
            pass

        print(f"[ANALYTICS] supported=True, modules={analytics_info['modules']}")
    except Exception as e:
        print(f"[ANALYTICS] Analytics service failed: {e}")

    return analytics_info


def _safe_get(obj, attr, default=None):
    try:
        val = getattr(obj, attr, default)
        if val is None:
            return default
        if hasattr(val, '__class__') and 'zeep' in str(type(val)):
            return str(val)
        return val
    except Exception:
        return default


def _classify_event(topic: str) -> str:
    """Classify an event topic string into a standard event type."""
    t = topic.lower()
    if any(k in t for k in ['motion', 'motionalarm', 'cellobject', 'alarm', 'loiter']):
        return 'motion'
    elif any(k in t for k in ['tamper', 'sabotage']):
        return 'tampering'
    elif any(k in t for k in ['linecross', 'crossing']):
        return 'line_crossing'
    elif any(k in t for k in ['intrusion', 'fielddetection', 'field']):
        return 'intrusion'
    elif any(k in t for k in ['face']):
        return 'face_detection'
    elif any(k in t for k in ['audio', 'sound']):
        return 'audio_detection'
    return 'other'


# ─────────────────────────────────────────────────────────────────
# NATIVE MANUFACTURER API — Per-stream encoding capabilities
# ONVIF returns the same encoder chip capabilities for all streams.
# Camera web UIs use their proprietary APIs for accurate per-stream data.
# ─────────────────────────────────────────────────────────────────

_ENC_SORT_ORDER = {"H264B": 1, "H264": 2, "H264H": 3, "H265": 4, "MPEG4": 5, "JPEG": 6}

def _map_native_codecs(codec_list):
    """Map native codec names (H.264, H.265, MJPEG) to our internal names."""
    supported = []
    for codec in codec_list:
        c = codec.strip().upper().replace(".", "")
        if c in ("H264", "H264B", "H264H"):
            if "H264B" not in supported: supported.append("H264B")
            if "H264" not in supported: supported.append("H264")
            if "H264H" not in supported: supported.append("H264H")
        elif c in ("H265", "H265+", "HEVC"):
            if "H265" not in supported: supported.append("H265")
        elif c in ("MJPEG", "MJPG", "JPEG"):
            if "JPEG" not in supported: supported.append("JPEG")
        elif c == "MPEG4":
            if "MPEG4" not in supported: supported.append("MPEG4")
    return sorted(supported, key=lambda x: _ENC_SORT_ORDER.get(x, 10))


def _fetch_hikvision_stream_caps(ip, username, password, profiles):
    """
    Use Hikvision ISAPI to get REAL per-stream encoding capabilities.
    /ISAPI/Streaming/channels/{channelId}/capabilities returns XML with
    <videoCodecType opt="H.264,H.265,MJPEG"> per channel.
    Channel IDs: 101=main, 102=sub, 103=third stream.
    """
    import xml.etree.ElementTree as ET
    from requests.auth import HTTPDigestAuth

    for profile in profiles:
        label = (profile.get("label") or "").upper()
        if label == "MAIN":
            channel_id = 101
        elif label == "SUB":
            channel_id = 102
        else:
            channel_id = 103

        try:
            url = f"http://{ip}/ISAPI/Streaming/channels/{channel_id}/capabilities"
            r = requests.get(url, auth=HTTPDigestAuth(username, password),
                             timeout=5, verify=False)
            if r.status_code != 200:
                continue

            # Strip XML namespace for easier parsing
            text = re.sub(r'\s+xmlns="[^"]*"', '', r.text)
            root = ET.fromstring(text)

            video = root.find('.//Video')
            if video is None:
                continue

            # Parse videoCodecType opt attribute
            codec_elem = video.find('videoCodecType')
            if codec_elem is not None:
                opt = codec_elem.get('opt', '')
                if opt:
                    native_codecs = [c.strip() for c in opt.split(',') if c.strip()]
                    mapped = _map_native_codecs(native_codecs)
                    if mapped:
                        profile["supported_encodings"] = mapped
                        print(f"[ISAPI] {ip} ch{channel_id} ({label}): {mapped}")

            # Also parse supported resolutions
            res_w_elem = video.find('videoResolutionWidth')
            res_h_elem = video.find('videoResolutionHeight')
            if res_w_elem is not None and res_h_elem is not None:
                w_opts = res_w_elem.get('opt', '').split(',')
                h_opts = res_h_elem.get('opt', '').split(',')
                if w_opts and h_opts and len(w_opts) == len(h_opts):
                    res_list = [f"{w.strip()}x{h.strip()}" for w, h in zip(w_opts, h_opts)]
                    if res_list:
                        profile["supported_resolutions"] = res_list

        except Exception as e:
            print(f"[ISAPI] Failed for {ip} ch{channel_id}: {e}")

    return profiles


def _fetch_dahua_stream_caps(ip, username, password, profiles):
    """
    Use Dahua CGI or JSON-RPC to get REAL per-stream encoding capabilities.
    Tries multiple endpoints and response formats for maximum compatibility.
    """
    from requests.auth import HTTPDigestAuth, HTTPBasicAuth
    import hashlib
    import json

    raw_text = None

    # Try multiple Dahua HTTP CGI endpoints first
    endpoints = [
        f"http://{ip}/cgi-bin/encode.cgi?action=getConfigCaps",
        f"http://{ip}/cgi-bin/configManager.cgi?action=getConfig&name=Encode",
        f"http://{ip}/cgi-bin/encode.cgi?action=getConfigCaps&channel=0",
    ]
    
    auth_methods = [
        HTTPDigestAuth(username, password),
        HTTPBasicAuth(username, password),
    ]

    for url in endpoints:
        for auth in auth_methods:
            try:
                r = requests.get(url, auth=auth, timeout=5, verify=False)
                # 404 means endpoint disabled
                if r.status_code == 200 and len(r.text) > 50:
                    raw_text = r.text
                    break
            except Exception as e:
                pass
        if raw_text:
            break

    main_codecs = set()
    sub_codecs = set()
    main_res = None
    sub_res = None

    # ── FALLBACK TO JSON-RPC IF CGI FAILS (Dahua Lite / Newer firmware) ──
    if not raw_text:
        try:
            login_url = f"http://{ip}/RPC2_Login"
            rpc_url = f"http://{ip}/RPC2"
            
            # Step 1: Get challenge
            r1 = requests.post(login_url, json={
                "method": "global.login", "params": {"userName": username, "password": "", "clientType": "Web3.0"}, "id": 1
            }, timeout=3, verify=False).json()
            
            realm = r1.get("params", {}).get("realm")
            random_str = r1.get("params", {}).get("random")
            session = r1.get("session") or (r1.get("params") or {}).get("session")
            
            if realm and random_str:
                # Step 2: Login with Hash
                h1 = hashlib.md5(f"{username}:{realm}:{password}".encode()).hexdigest().upper()
                h2 = hashlib.md5(f"{username}:{random_str}:{h1}".encode()).hexdigest().upper()
                
                r2 = requests.post(login_url, json={
                    "method": "global.login", "params": {"userName": username, "password": h2, "clientType": "Web3.0"}, "id": 2, "session": session
                }, timeout=3, verify=False).json()
                
                sess2 = r2.get("session", session)
                
                # Step 3: Fetch Encode Capabilities via devVideoEncode.getCaps
                r3 = requests.post(rpc_url, json={
                    "method": "devVideoEncode.getCaps", "params": {}, "id": 3, "session": sess2
                }, timeout=3, verify=False).json()
                
                caps = r3.get("params", {}).get("caps", {})
                encode_types = caps.get("EncodeTypes", [])
                
                # If we found EncodeTypes, we map them exactly like the Dahua Web UI Javascript does.
                if encode_types:
                    for enc in encode_types:
                        enc = enc.upper()
                        if "H.264" in enc or "H264" in enc:
                            # Dahua UI always provides B, Main, and H options if H.264 is supported
                            for c in ["H.264B", "H.264", "H.264H"]:
                                main_codecs.add(c)
                                sub_codecs.add(c)
                        elif "H.265" in enc or "H265" in enc:
                            main_codecs.add("H.265")
                            sub_codecs.add("H.265")
                        else:
                            main_codecs.add(enc)
                            sub_codecs.add(enc)
                            
                    # Dahua Sub streams almost universally support MJPEG
                    sub_codecs.add("MJPEG")
                    
                    # For cameras where Main stream also supports MJPEG, it would be in EncodeTypes,
                    # but we'll ensure MJPEG is added if it was explicitly there.
                    if "MJPEG" in encode_types or "JPEG" in encode_types:
                        main_codecs.add("MJPEG")

                # Logout
                requests.post(rpc_url, json={"method": "global.logout", "params": {}, "id": 4, "session": sess2}, timeout=1, verify=False)
                
        except Exception as e:
            print(f"[DAHUA RPC] Failed: {e}")

    # ── PARSE CGI TEXT RESPONSE (if we got one) ──
    if raw_text:
        for line in raw_text.splitlines():
            line = line.strip()
            if not line or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip()

            if re.search(r'(caps\[\d+\]\.)?MainFormat\[0\]\.Video\.(CompressionTypes|Compress)', key):
                for c in value.split(','):
                    if c.strip(): main_codecs.add(c.strip())
            elif re.search(r'(caps\[\d+\]\.)?ExtraFormat\[0\]\.Video\.(CompressionTypes|Compress)', key):
                for c in value.split(','):
                    if c.strip(): sub_codecs.add(c.strip())
            elif re.search(r'(caps\[\d+\]\.)?MainFormat\[0\]\.Video\.ResolutionTypes', key):
                main_res = [r.strip() for r in value.split(',') if r.strip()]
            elif re.search(r'(caps\[\d+\]\.)?ExtraFormat\[0\]\.Video\.ResolutionTypes', key):
                sub_res = [r.strip() for r in value.split(',') if r.strip()]

    # ── APPLY DISCOVERED CODECS TO PROFILES ──
    if not main_codecs and not sub_codecs:
        return profiles

    main_list = list(main_codecs)
    sub_list = list(sub_codecs)
    
    # Sort them to look pretty in the UI dropdown (H.264B, H.264, H.264H, MJPEG, H.265)
    sort_order = {"H.264B": 1, "H.264": 2, "H.264H": 3, "MJPEG": 4, "JPEG": 4, "H.265": 5}
    main_list.sort(key=lambda x: sort_order.get(x, 99))
    sub_list.sort(key=lambda x: sort_order.get(x, 99))
    
    for profile in profiles:
        label = (profile.get("label") or "").upper()
        if label == "MAIN" and main_list:
            mapped = _map_native_codecs(main_list)
            if mapped:
                profile["supported_encodings"] = mapped
            if main_res:
                profile["supported_resolutions"] = main_res
        elif label == "SUB" and sub_list:
            mapped = _map_native_codecs(sub_list)
            if mapped:
                profile["supported_encodings"] = mapped
            if sub_res:
                profile["supported_resolutions"] = sub_res

    return profiles


def _enrich_profiles_with_native_caps(ip, username, password, manufacturer, profiles):
    """
    Master function: detect camera brand and use its native API to get
    accurate per-stream encoding capabilities. Falls back to ONVIF data
    if native API is unavailable.
    
    Detection priority:
      1. RTSP URL pattern (most reliable — cannot be spoofed)
      2. Manufacturer string from ONVIF
    """
    mfr = (manufacturer or "").lower()

    # Check RTSP URLs for brand fingerprints (most reliable detection)
    rtsp_urls = " ".join(p.get("rtsp_url", "") for p in profiles).lower()
    
    is_hikvision = (
        any(k in mfr for k in ("hikvision", "hikvisio", "hik")) or
        "streaming/channels" in rtsp_urls or
        "/isapi/" in rtsp_urls
    )
    is_dahua = (
        any(k in mfr for k in ("dahua", "zhejiang", "private")) or
        "cam/realmonitor" in rtsp_urls
    )

    if is_hikvision:
        print(f"[NATIVE] {ip} — Hikvision detected (mfr={manufacturer}), using ISAPI")
        return _fetch_hikvision_stream_caps(ip, username, password, profiles)
    elif is_dahua:
        print(f"[NATIVE] {ip} — Dahua detected (mfr={manufacturer}), using CGI")
        return _fetch_dahua_stream_caps(ip, username, password, profiles)
    else:
        print(f"[NATIVE] {ip} — {manufacturer} not recognized, keeping ONVIF data")
        return profiles


# ─────────────────────────────────────────────────────────────────
# MAIN PROBE FUNCTION
# ─────────────────────────────────────────────────────────────────

def probe_camera(ip: str, port: int, username: str, password: str, channel: int = None) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)

        device_service = cam.create_devicemgmt_service()
        try:
            device_service.transport.session.verify = False
        except Exception:
            pass

        info = device_service.GetDeviceInformation()

        model_str        = (getattr(info, 'Model',        '') or '').lower()
        manufacturer_str = (getattr(info, 'Manufacturer', '') or '').lower()
        # (Keywords check removed to allow NVRs/Encoders with valid streams)

        media_service = cam.create_media_service()
        try:
            media_service.transport.session.verify = False
        except Exception:
            pass

        try:
            video_sources = media_service.GetVideoSources()
            if not video_sources:
                return {"success": False, "error": "No video sources found"}
            print(f"[ONVIF] ✓ {ip} has {len(video_sources)} video source(s)")
            
            # Build set of ACTIVE source tokens (inactive slots have 0x0 or no resolution)
            active_source_tokens = set()
            
            # Optional: check imaging status for better detection of disconnected sensors (Axis/Bosch)
            imaging_service = None
            try: imaging_service = cam.create_imaging_service()
            except: pass

            for src in video_sources:
                is_active = False
                
                # Exclude composite/Quad views
                token_lower = str(src.token).lower()
                if "quad" in token_lower or "viewarea" in token_lower or "composite" in token_lower:
                    print(f"[ONVIF]   ⏭ Skipping source {src.token} (Quad/Composite view)")
                    continue
                    
                try:
                    w = getattr(src.Resolution, 'Width', 0) or 0
                    h = getattr(src.Resolution, 'Height', 0) or 0
                    if w > 0 and h > 0:
                        is_active = True
                        # Extra check: some modular units report resolution but imaging fails if sensor missing
                        if imaging_service:
                            try:
                                img_settings = imaging_service.GetImagingSettings({'VideoSourceToken': src.token})
                                # Check for dummy ports (Axis typically returns MaxExposureTime = -1.0 on disconnected sensors)
                                exposure = getattr(img_settings, 'Exposure', None)
                                
                                if "axis" in manufacturer_str and exposure is not None:
                                    max_exp = getattr(exposure, 'MaxExposureTime', 0)
                                    if max_exp == -1.0:
                                        is_active = False
                                        print(f"[ONVIF]   ⬜ Source {src.token}: exposure MaxExposureTime is -1.0, assuming dummy/empty slot")
                            except Exception as e:
                                err = str(e).lower()
                                if any(x in err for x in [
                                    "no such device", "device not found", "invalid token",
                                    "ter:actionnotsupported", "action not supported",
                                    "ter:invalidargval", "invalid argument",
                                    "ter:notfound", "not found",
                                    "does not support imaging settings"
                                ]):
                                    is_active = False
                                    print(f"[ONVIF]   ⬜ Source {src.token}: imaging failed ({err}), assuming empty slot")
                    
                    if is_active:
                        active_source_tokens.add(src.token)
                        print(f"[ONVIF]   ✅ Source {src.token}: {w}x{h} (active)")
                    else:
                        print(f"[ONVIF]   ⬜ Source {src.token}: no signal/imaging failed (empty slot)")
                except Exception:
                    print(f"[ONVIF]   ⚠ Could not read resolution for source {src.token}")
                    
            # ── VAPIX fallback for Axis Ghost Sensors ──
            if "axis" in manufacturer_str:
                try:
                    from requests.auth import HTTPDigestAuth
                    import requests
                    r = requests.get(
                        f"http://{ip}/axis-cgi/param.cgi?action=list&group=Properties.Image.Sensor",
                        auth=HTTPDigestAuth(username, password),
                        timeout=3,
                        verify=False
                    )
                    if r.status_code == 200:
                        # e.g., Properties.Image.Sensor.S0.Connected=yes
                        # Properties.Image.Sensor.S1.Connected=no
                        connected_sensors = []
                        for line in r.text.splitlines():
                            if ".Connected=yes" in line:
                                # Extracts '0' from S0, '1' from S1, etc.
                                match = re.search(r'\.S(\d+)\.Connected=yes', line)
                                if match:
                                    # ONVIF tokens are usually 1-indexed compared to Axis S0
                                    sensor_idx = int(match.group(1)) + 1
                                    connected_sensors.append(sensor_idx)
                        
                        if connected_sensors:
                            print(f"[VAPIX] Axis connected sensors detected: {connected_sensors}")
                            # Now filter active_source_tokens based on this strict VAPIX data
                            filtered_tokens = set()
                            for idx, t in enumerate(video_sources):
                                if (idx + 1) in connected_sensors and t.token in active_source_tokens:
                                    filtered_tokens.add(t.token)
                            active_source_tokens = filtered_tokens
                except Exception as e:
                    print(f"[VAPIX] Axis sensor verification failed: {e}")

        except Exception as vs_err:
            print(f"[ONVIF] ⚠ GetVideoSources failed ({vs_err}), continuing")
            active_source_tokens = None  # None means don't filter

        profiles     = media_service.GetProfiles()
        stream_uri   = "Unavailable"
        profile_list = []

        # -- Auto-shift logic for hard-coded UIs --
        # Check how many channels are already in the DB for this IP
        enrolled_count = 0
        try:
            from main import cameras_col
            if cameras_col is not None:
                enrolled_count = cameras_col.count_documents({"ip": ip})
                print(f"[ONVIF] 💡 {ip} has {enrolled_count} channels already enrolled. Shifting results...")
        except Exception as e:
            print(f"[ONVIF] ⚠ Could not check enrollment count: {e}")

        if profiles:
            encoder_map = {}

            for idx, p in enumerate(profiles):
                try:
                    stream_setup = media_service.create_type("GetStreamUri")
                    stream_setup.ProfileToken = p.token
                    stream_setup.StreamSetup  = {
                        "Stream":    "RTP-Unicast",
                        "Transport": {"Protocol": "RTSP"},
                    }
                    uri = media_service.GetStreamUri(stream_setup).Uri
                    if idx == 0:
                        stream_uri = uri

                    vec     = getattr(p, 'VideoEncoderConfiguration', None)
                    res = enc = fps = bitrate = None
                    width = 0
                    height = 0

                    supported_encs = []
                    supported_res = []
                    if vec:
                        try:
                            width = vec.Resolution.Width
                            height = vec.Resolution.Height
                            res = f"{width}x{height}"
                        except: pass
                        try:
                            enc = str(vec.Encoding)
                            if enc == "H264" and hasattr(vec, 'H264'):
                                prof = str(getattr(vec.H264, 'H264Profile', ''))
                                if prof == 'Baseline': enc = 'H264B'
                                elif prof == 'High': enc = 'H264H'
                        except: pass
                        try:    fps     = int(vec.RateControl.FrameRateLimit)
                        except: pass
                        try:    bitrate = int(vec.RateControl.BitrateLimit)
                        except: pass

                        # Fetch dynamic options for THIS profile so DB is fully accurate
                        try:
                            opt_res = media_service.GetVideoEncoderConfigurationOptions({
                                'ConfigurationToken': vec.token,
                                'ProfileToken': p.token
                            })
                            if opt_res:
                                h264_opts = getattr(opt_res, 'H264', None)
                                if h264_opts:
                                    profs = getattr(h264_opts, 'H264ProfilesSupported', [])
                                    if isinstance(profs, str): profs = [profs]
                                    has_prof = False
                                    for pr in profs:
                                        pr_str = str(pr).upper()
                                        if pr_str == 'BASELINE': supported_encs.append('H264B'); has_prof = True
                                        elif pr_str == 'MAIN': supported_encs.append('H264'); has_prof = True
                                        elif pr_str == 'HIGH': supported_encs.append('H264H'); has_prof = True
                                    if not has_prof: supported_encs.append('H264')
                                    for r in getattr(h264_opts, 'ResolutionsAvailable', []): supported_res.append(f"{r.Width}x{r.Height}")
                                
                                h265_opts = getattr(opt_res, 'H265', None) or getattr(getattr(opt_res, 'Extension', None), 'H265', None)
                                if h265_opts: 
                                    supported_encs.append('H265')
                                    for r in getattr(h265_opts, 'ResolutionsAvailable', []): supported_res.append(f"{r.Width}x{r.Height}")
                                    
                                jpeg_opts = getattr(opt_res, 'Jpeg', None)
                                if jpeg_opts: 
                                    supported_encs.append('JPEG')
                                    for r in getattr(jpeg_opts, 'ResolutionsAvailable', []): supported_res.append(f"{r.Width}x{r.Height}")
                                
                                mpeg4_opts = getattr(opt_res, 'Mpeg4', None)
                                if mpeg4_opts: supported_encs.append('MPEG4')
                        except Exception as opts_err:
                            pass

                    # Better labeling for multi-channel units (NVRs/Modular cams)
                    source_token = getattr(p.VideoSourceConfiguration, 'SourceToken', 'unknown') if getattr(p, 'VideoSourceConfiguration', None) else 'unknown'
                    source_idx = 0
                    try:
                        for s_idx, src in enumerate(video_sources):
                            if src.token == source_token:
                                source_idx = s_idx + 1
                                break
                    except: pass

                    # Skip profiles from inactive camera slots (empty slots on Axis modular units)
                    # Also skip if the encoder itself reports 0x0 resolution (common placeholder)
                    is_inactive = active_source_tokens is not None and source_token not in active_source_tokens
                    if is_inactive or res == "0x0":
                        reason = "source is inactive" if is_inactive else "0x0 resolution"
                        print(f"[ONVIF]   ⏭ Skipping {p.Name} — {reason}")
                        continue

                    # Group by VideoEncoderConfiguration token, fallback to resolution/fps combo if missing
                    enc_token = getattr(vec, 'token', None) if vec else None
                    if not enc_token:
                        enc_token = f"enc_fallback_{res}_{fps}_{bitrate}"

                    # Group key is composite to ensure NVR channels don't overwrite each other
                    group_key = f"{source_idx}_{enc_token}"
                    
                    if group_key not in encoder_map:
                        order = {"H264B": 1, "H264": 2, "H264H": 3, "H265": 4, "MPEG4": 5, "JPEG": 6}
                        final_encs = sorted(list(set(supported_encs)), key=lambda x: order.get(x, 10)) if supported_encs else ["H264", "H265", "JPEG"]
                        
                        encoder_map[group_key] = {
                            "name":         p.Name,
                            "token":        p.token,
                            "source":       source_idx,
                            "source_token": source_token,
                            "resolution":   res,
                            "width":        width,
                            "height":       height,
                            "encoding":     enc,
                            "fps":          fps,
                            "bitrate":      bitrate,
                            "rtsp_url":     uri,
                            "supported_encodings": final_encs,
                            "supported_resolutions": list(set(supported_res)),
                            "error":        None
                        }
                except Exception as e:
                    # Capture failed profiles temporarily to show errors or fallback
                    profile_list.append({
                        "name": p.Name, "token": p.token,
                        "label": f"STREAM {idx+1}", "error": str(e),
                    })

            # Process mapped encoders to assign intelligent roles (MAIN, SUB, EXTRA)
            # We must assign roles *per camera source/channel*
            from collections import defaultdict
            streams_by_source = defaultdict(list)
            for key, stream_data in encoder_map.items():
                streams_by_source[stream_data["source"]].append(stream_data)

            for src_idx, streams in streams_by_source.items():
                # Sort descending by Resolution area, then by Bitrate, then by FPS
                streams.sort(key=lambda x: (x["width"] * x["height"], x["bitrate"] or 0, x["fps"] or 0), reverse=True)
                
                for i, stream_data in enumerate(streams):
                    if i == 0:
                        role = "MAIN"
                    elif i == 1:
                        role = "SUB"
                    else:
                        role = "EXTRA"
                    
                    label_prefix = f"Cam {src_idx} - " if src_idx > 0 else ""
                    
                    profile_list.append({
                        "name":         f"{label_prefix}{stream_data['name']}",
                        "token":        stream_data["token"],
                        "label":        role,
                        "source":       stream_data["source"],
                        "source_token": stream_data["source_token"],
                        "resolution":   stream_data["resolution"],
                        "encoding":     stream_data["encoding"],
                        "fps":          stream_data["fps"],
                        "bitrate":      stream_data["bitrate"],
                        "rtsp_url":     stream_data["rtsp_url"],
                        "supported_encodings": stream_data.get("supported_encodings", []),
                        "supported_resolutions": stream_data.get("supported_resolutions", [])
                    })

        # Sort profiles: Move the "next" channel to the top
        # (e.g. if 1 cam is enrolled, Cam 2 profiles go to the top)
        # Priority source (for multi-channel devices)
        # If channel is provided from UI, use it. Otherwise find the next available.
        target_source = channel if channel is not None else (enrolled_count + 1)
        
        def profile_priority(p):
            src = p.get("source", 1)
            if src == target_source: return 0  # Highest priority
            if src > target_source:  return src
            return 100 + src # Put already enrolled ones at the bottom

        valid_profiles = sorted(profile_list, key=profile_priority)
        
        # Only keep valid ones for the final response
        valid_profiles = [
            p for p in valid_profiles
            if p.get("rtsp_url") and "rtsp://" in p.get("rtsp_url", "")
        ]

        if not valid_profiles:
            return {"success": False, "error": "No valid RTSP stream URLs found"}

        # ── Use manufacturer native API for ACCURATE per-stream encoding caps ──
        # ONVIF returns identical encoder capabilities for all streams.
        # Camera web UIs use ISAPI/CGI which know the real per-stream restrictions.
        try:
            valid_profiles = _enrich_profiles_with_native_caps(
                ip, username, password, info.Manufacturer, valid_profiles
            )
        except Exception as native_err:
            print(f"[NATIVE] {ip} — native API enrichment failed: {native_err}, keeping ONVIF data")

        mac = "—"
        try:
            net_info = device_service.GetNetworkInterfaces()
            if net_info:
                mac = net_info[0].Info.HwAddress
        except Exception:
            pass

        print(f"[ONVIF] Fetching full capabilities for {ip}...")

        top_caps  = _fetch_capabilities(device_service)
        imaging   = _fetch_imaging_settings(cam, media_service)
        ptz_info  = _fetch_ptz_info(cam, media_service)
        events    = _fetch_event_capabilities(cam)
        audio     = _fetch_audio_info(cam, media_service)
        network   = _fetch_network_info(device_service)
        io_info   = _fetch_io_info(device_service)
        analytics = _fetch_analytics_info(cam)

        capabilities = {
            "ptz":       ptz_info.get("supported", False),
            "imaging":   imaging.get("supported", False),
            "events":    events.get("supported", False),
            "analytics": analytics.get("supported", False),
            "io":        top_caps.get("io", False),
            "audio_in":  audio.get("input_supported", False),
            "audio_out": audio.get("output_supported", False),

            "imaging_settings": imaging,
            "ptz_info":         ptz_info,
            "event_info":       events,
            "audio_info":       audio,
            "network_info":     network,
            "io_info":          io_info,
            "analytics_info":   analytics,
        }

        print(f"[ONVIF] ✅ Full probe complete for {ip} "
              f"({info.Manufacturer} {info.Model}) — Cam {enrolled_count + 1}")

        return {
            "success":      True,
            "ip":           ip,
            "port":         port,
            "manufacturer": info.Manufacturer,
            "model":        f"{info.Model} (Cam {enrolled_count + 1})",
            "firmware":     info.FirmwareVersion,
            "serial":       info.SerialNumber,
            "hardware":     info.HardwareId,
            "mac":          mac,
            "stream_uri":   stream_uri,
            "ptz":          "Yes" if ptz_info.get("supported") else "No",
            "stream_count": len(valid_profiles),
            "profiles":     valid_profiles[:3],
            "all_profiles": valid_profiles,
            "capabilities": capabilities
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────
# LIVE CONTROL ENDPOINTS
# ─────────────────────────────────────────────────────────────────

def set_imaging_setting(ip: str, port: int, username: str, password: str,
                        setting: str, value) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        imaging_service = cam.create_imaging_service()
        try:
            imaging_service.transport.session.verify = False
        except Exception:
            pass

        media_service = cam.create_media_service()
        try:
            media_service.transport.session.verify = False
        except Exception:
            pass

        sources = media_service.GetVideoSources()
        if not sources:
            return {"success": False, "error": "No video sources"}

        source_token = sources[0].token
        current = imaging_service.GetImagingSettings({"VideoSourceToken": source_token})

        if setting == "brightness":
            current.Brightness = float(value)
        elif setting == "saturation":
            current.ColorSaturation = float(value)
        elif setting == "sharpness":
            current.Sharpness = float(value)
        elif setting == "ir_cut_filter":
            current.IrCutFilter = str(value)
        elif setting == "wdr":
            if current.WideDynamicRange:
                current.WideDynamicRange.Mode = str(value)
        elif setting == "wdr_level":
            if current.WideDynamicRange:
                current.WideDynamicRange.Level = float(value)
        elif setting == "exposure_mode":
            if current.Exposure:
                current.Exposure.Mode = str(value)
        elif setting == "white_balance":
            if current.WhiteBalance:
                current.WhiteBalance.Mode = str(value)
        elif setting == "backlight_compensation":
            if current.BacklightCompensation:
                current.BacklightCompensation.Mode = str(value)
        else:
            return {"success": False, "error": f"Unknown setting: {setting}"}

        imaging_service.SetImagingSettings({
            "VideoSourceToken": source_token,
            "ImagingSettings":  current,
            "ForcePersistence": True,
        })

        print(f"[IMAGING] ✅ Set {setting}={value} on {ip}")
        return {"success": True, "setting": setting, "value": value}

    except Exception as e:
        print(f"[IMAGING] ❌ Set {setting} failed on {ip}: {e}")
        return {"success": False, "error": str(e)}


def ptz_go_to_preset(ip: str, port: int, username: str, password: str,
                     preset_token: str) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        try:
            ptz_service.transport.session.verify   = False
            media_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return {"success": False, "error": "No profiles"}

        token = profiles[0].token
        ptz_service.GotoPreset({
            "ProfileToken": token,
            "PresetToken":  preset_token,
            "Speed":        {"PanTilt": {"x": 0.5, "y": 0.5}, "Zoom": {"x": 0.5}},
        })
        return {"success": True, "preset": preset_token}
    except Exception as e:
        return {"success": False, "error": str(e)}


def ptz_set_preset(ip: str, port: int, username: str, password: str,
                   preset_name: str, preset_token: str = None) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        try:
            ptz_service.transport.session.verify   = False
            media_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return {"success": False, "error": "No profiles"}

        token  = profiles[0].token
        req    = {"ProfileToken": token, "PresetName": preset_name}
        if preset_token:
            req["PresetToken"] = preset_token

        result = ptz_service.SetPreset(req)
        return {"success": True, "preset_token": str(result)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def ptz_go_home(ip: str, port: int, username: str, password: str) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        try:
            ptz_service.transport.session.verify   = False
            media_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return {"success": False, "error": "No profiles"}

        token = profiles[0].token
        ptz_service.GotoHomePosition({
            "ProfileToken": token,
            "Speed":        {"PanTilt": {"x": 0.5, "y": 0.5}, "Zoom": {"x": 0.5}},
        })
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def trigger_relay(ip: str, port: int, username: str, password: str,
                  relay_token: str, state: str = "Active") -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        device_service = cam.create_devicemgmt_service()
        try:
            device_service.transport.session.verify = False
        except Exception:
            pass

        device_service.SetRelayOutputState({
            "RelayOutputToken": relay_token,
            "LogicalState":     state,
        })
        return {"success": True, "relay": relay_token, "state": state}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_camera_system_time(ip, port=None, username="", password=""):
    if port is None:
        port = int(os.environ.get("CAMERA_DEFAULT_PORT"))
    try:
        cam = _make_cam(ip, port, username, password)
        device_service = cam.create_devicemgmt_service()
        try:
            device_service.transport.session.verify = False
        except Exception:
            pass

        sys_time = device_service.GetSystemDateAndTime()
        raw_tz   = getattr(sys_time, 'TimeZone', None)
        tz_info  = _parse_onvif_timezone(raw_tz)
        dt       = None

        if getattr(sys_time, "LocalDateTime", None):
            d  = sys_time.LocalDateTime.Date
            t  = sys_time.LocalDateTime.Time
            dt = _parse_onvif_time(d, t)
            if dt and tz_info:
                dt = dt.replace(tzinfo=tz_info)
        elif getattr(sys_time, "UTCDateTime", None):
            d  = sys_time.UTCDateTime.Date
            t  = sys_time.UTCDateTime.Time
            dt = _parse_onvif_time(d, t)
            if dt:
                dt = dt.replace(tzinfo=timezone.utc)
                dt = dt.astimezone(tz_info) if tz_info else dt.astimezone()

        if dt is None:
            return None
        return dt.replace(tzinfo=None)
    except Exception as e:
        print(f"[ONVIF TIME] Failed: {e}")
        return None


def move_camera_ptz(ip, port, username, password, pan, tilt, zoom):
    try:
        cam = _make_cam(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        try:
            ptz_service.transport.session.verify   = False
            media_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return {"success": False, "error": "No profiles found"}

        token   = profiles[0].token
        if float(pan) == 0.0 and float(tilt) == 0.0 and float(zoom) == 0.0:
            request = ptz_service.create_type("Stop")
            request.ProfileToken = token
            request.PanTilt = True
            request.Zoom = True
            ptz_service.Stop(request)
        else:
            request = ptz_service.create_type("ContinuousMove")
            request.ProfileToken = token
            request.Velocity = {
                "PanTilt": {"x": float(pan),  "y": float(tilt)},
                "Zoom":    {"x": float(zoom)},
            }
            ptz_service.ContinuousMove(request)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────
# BRAND-SPECIFIC EVENT FETCHERS
# ─────────────────────────────────────────────────────────────────

def _fetch_bosch_events(ip, username, password) -> list:
    """
    Bosch cameras expose events via their own REST API.
    Supports DINION, FLEXIDOME, AUTODOME series.
    """
    endpoints = [
        f"http://{ip}/api/event/notification/eventlog",
        f"http://{ip}/api/event/notification/alarms",
        f"http://{ip}/cgi-bin/eventrequest.cgi",
    ]
    for url in endpoints:
        try:
            resp = requests.get(
                url,
                auth=(username, password),
                verify=False,
                timeout=5,
            )
            if resp.status_code == 200:
                try:
                    data  = resp.json()
                    items = data if isinstance(data, list) else \
                            data.get("events", data.get("alarms", data.get("items", [])))
                    events = []
                    for item in (items or []):
                        raw_type    = str(item.get("eventType", item.get("type", "")) or "")
                        description = str(item.get("description", item.get("text", "")) or "")
                        combined    = (raw_type + " " + description).lower()
                        event_type  = _classify_event(combined)
                        events.append({
                            "topic":      raw_type or "bosch_event",
                            "event_type": event_type,
                            "utc_time":   str(item.get("timestamp", item.get("time", "")) or ""),
                            "raw":        str(item),
                        })
                    print(f"[BOSCH] {ip} → {len(events)} event(s) via REST ({url})")
                    return events
                except Exception:
                    pass
        except Exception:
            pass
    return []


def _fetch_hikvision_events(ip, username, password) -> list:
    """
    Hikvision cameras support ISAPI event search endpoint.
    Falls back to ONVIF if this fails.
    """
    try:
        url  = f"http://{ip}/ISAPI/Event/notification/alertStream"
        resp = requests.get(
            url,
            auth=(username, password),
            verify=False,
            timeout=5,
            stream=True,
        )
        if resp.status_code == 200:
            # Just check it's reachable — actual streaming handled by ONVIF PullPoint
            print(f"[HIK] {ip} ISAPI alert stream reachable")
        return []
    except Exception:
        return []


def _fetch_dahua_events(ip, username, password) -> list:
    """
    Dahua cameras support event search via their HTTP API.
    """
    try:
        url  = f"http://{ip}/cgi-bin/eventManager.cgi?action=getEventIndexes&code=All"
        resp = requests.get(
            url,
            auth=(username, password),
            verify=False,
            timeout=5,
        )
        if resp.status_code == 200:
            print(f"[DAHUA] {ip} event manager reachable")
        return []
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────────
# MAIN EVENT PULL FUNCTION — supports ALL brands
# ─────────────────────────────────────────────────────────────────

def pull_camera_events(ip, port, username, password, max_messages=50):
    """
    Universal event fetcher. Tries methods in this order:
    1. ONVIF PullPoint  → works for Hikvision, Dahua, Axis, Hanwha, Uniview
    2. Bosch REST API   → works for Bosch DINION, FLEXIDOME, AUTODOME
    3. Silent fallback  → keeps polling alive without crashing
    """
    try:
        cam = _make_cam(ip, port, username, password)

        # ── METHOD 1: ONVIF PullPoint (most cameras) ──────────────
        try:
            events_service = cam.create_events_service()
            events_service.transport.session.verify = False

            # Create pull-point subscription
            sub = events_service.CreatePullPointSubscription({
                'RequestedTerminationTime': 'PT1H',
            })

            pullpoint = cam.create_pullpoint_service()
            pullpoint.transport.session.verify = False

            msgs = pullpoint.PullMessages({
                'MessageLimit': max_messages,
                'Timeout':      'PT5S',
            })

            results = []
            for msg in (getattr(msgs, 'NotificationMessage', []) or []):
                topic    = str(getattr(msg, 'Topic', '') or '')
                message  = getattr(msg, 'Message', None)
                utc_time = str(getattr(message, 'UtcTime', '') or '') if message else ''
                data     = getattr(message, 'Data', None) if message else None

                results.append({
                    "topic":      topic,
                    "event_type": _classify_event(topic),
                    "utc_time":   utc_time,
                    "raw":        str(data or ''),
                })

            print(f"[EVENTS] PullPoint got {len(results)} message(s) from {ip}")
            return {"success": True, "events": results}

        except Exception as pull_err:
            print(f"[EVENTS] PullPoint failed for {ip}: {pull_err} — trying brand-specific APIs")

        # ── METHOD 2: Bosch REST API ──────────────────────────────
        try:
            bosch_events = _fetch_bosch_events(ip, username, password)
            if bosch_events:
                return {"success": True, "events": bosch_events}
            # If reachable but no events yet — still success, keep polling
            resp_check = requests.get(
                f"http://{ip}/api/event/notification/eventlog",
                auth=(username, password),
                verify=False,
                timeout=3,
            )
            if resp_check.status_code in (200, 204, 401, 403):
                # Camera is Bosch-type, just no events right now
                print(f"[BOSCH] {ip} reachable, no events currently")
                return {"success": True, "events": []}
        except Exception:
            pass

        # ── METHOD 3: Silent fallback — keep polling alive ────────
        # Camera uses push-mode or unsupported event method.
        # Return success with empty events so polling loop never crashes.
        print(f"[EVENTS] {ip} — no compatible event method found, polling silently")
        return {"success": True, "events": []}

    except Exception as e:
        print(f"[EVENTS] Fatal error for {ip}: {e}")
        # Still return success=True so polling doesn't give up
        return {"success": True, "events": []}


# ─────────────────────────────────────────────────────────────────
# VIDEO ENCODER CONFIGURATION & OPTIONS METHODS
# ─────────────────────────────────────────────────────────────────

def get_video_encoder_options(ip: str, port: int, username: str, password: str, profile_token: str) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        media_service = cam.create_media_service()
        try:
            media_service.transport.session.verify = False
        except Exception:
            pass
        
        profiles = media_service.GetProfiles()
        target_profile = None
        for p in profiles:
            if p.token == profile_token:
                target_profile = p
                break
        
        if not target_profile or not target_profile.VideoEncoderConfiguration:
            return {"success": False, "error": "Profile or VideoEncoderConfiguration not found"}
            
        config_token = target_profile.VideoEncoderConfiguration.token
        
        # Default fallback options
        resolutions = ["352x288", "640x480", "1280x720", "1920x1080", "3840x2160"]
        encodings = ["H264", "H265", "MPEG4", "JPEG"]
        fps_range = {"min": 5, "max": 30}
        
        try:
            raw_opts = media_service.GetVideoEncoderConfigurationOptions({
                'ConfigurationToken': config_token,
                'ProfileToken': profile_token
            })
            
            if raw_opts:
                discovered_res = []
                discovered_encs = []
                
                # Check H264
                h264_opts = getattr(raw_opts, 'H264', None)
                if h264_opts:
                    # Extract supported profiles like Baseline, Main, High
                    profiles_supp = getattr(h264_opts, 'H264ProfilesSupported', [])
                    if isinstance(profiles_supp, str):
                        profiles_supp = [profiles_supp]
                    
                    has_profiles = False
                    for p in profiles_supp:
                        p_str = str(p).upper()
                        if p_str == 'BASELINE':
                            discovered_encs.append("H264B")
                            has_profiles = True
                        elif p_str == 'MAIN':
                            discovered_encs.append("H264")
                            has_profiles = True
                        elif p_str == 'HIGH':
                            discovered_encs.append("H264H")
                            has_profiles = True
                    
                    if not has_profiles:
                        discovered_encs.append("H264")
                        
                    res_avail = getattr(h264_opts, 'ResolutionsAvailable', [])
                    for res in res_avail:
                        discovered_res.append(f"{res.Width}x{res.Height}")
                    fps_lim = getattr(h264_opts, 'FrameRateRange', None)
                    if fps_lim:
                        fps_range["min"] = min(fps_range["min"], getattr(fps_lim, 'Min', 5))
                        fps_range["max"] = max(fps_range["max"], getattr(fps_lim, 'Max', 30))
                
                # Check H265 / HEVC
                h265_opts = getattr(raw_opts, 'H265', None) or getattr(getattr(raw_opts, 'Extension', None), 'H265', None)
                if h265_opts:
                    discovered_encs.append("H265")
                    res_avail = getattr(h265_opts, 'ResolutionsAvailable', [])
                    for res in res_avail:
                        discovered_res.append(f"{res.Width}x{res.Height}")
                    fps_lim = getattr(h265_opts, 'FrameRateRange', None)
                    if fps_lim:
                        fps_range["min"] = min(fps_range["min"], getattr(fps_lim, 'Min', 5))
                        fps_range["max"] = max(fps_range["max"], getattr(fps_lim, 'Max', 30))
                        
                # Check MPEG4
                mpeg4_opts = getattr(raw_opts, 'Mpeg4', None)
                if mpeg4_opts:
                    discovered_encs.append("MPEG4")
                    res_avail = getattr(mpeg4_opts, 'ResolutionsAvailable', [])
                    for res in res_avail:
                        discovered_res.append(f"{res.Width}x{res.Height}")
                        
                # Check JPEG / MJPEG
                jpeg_opts = getattr(raw_opts, 'Jpeg', None)
                if jpeg_opts:
                    discovered_encs.append("JPEG")
                    res_avail = getattr(jpeg_opts, 'ResolutionsAvailable', [])
                    for res in res_avail:
                        discovered_res.append(f"{res.Width}x{res.Height}")
                
                if discovered_res:
                    def sort_key(r):
                        try:
                            w, h = map(int, r.split('x'))
                            return w * h
                        except: return 0
                    resolutions = sorted(list(set(discovered_res)), key=sort_key)
                if discovered_encs:
                    order = {"H264B": 1, "H264": 2, "H264H": 3, "H265": 4, "MPEG4": 5, "JPEG": 6}
                    encodings = sorted(list(set(discovered_encs)), key=lambda x: order.get(x, 10))
        except Exception as opt_err:
            print(f"[ONVIF OPTIONS] Could not query options: {opt_err}. Using generic fallbacks.")
            
        return {
            "success": True,
            "profile_token": profile_token,
            "config_token": config_token,
            "supported_resolutions": resolutions,
            "supported_encodings": encodings,
            "fps_range": fps_range
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def set_video_encoder_setting(ip: str, port: int, username: str, password: str,
                              profile_token: str, resolution: str = None,
                              encoding: str = None, fps: int = None, bitrate: int = None,
                              bitrate_type: str = None, iframe_interval: int = None) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        media_service = cam.create_media_service()
        try:
            media_service.transport.session.verify = False
        except Exception:
            pass
        
        profiles = media_service.GetProfiles()
        target_profile = None
        for p in profiles:
            if p.token == profile_token:
                target_profile = p
                break
                
        if not target_profile or not target_profile.VideoEncoderConfiguration:
            return {"success": False, "error": "Profile or VideoEncoderConfiguration not found"}
            
        config_token = target_profile.VideoEncoderConfiguration.token
        cfg = media_service.GetVideoEncoderConfiguration({'ConfigurationToken': config_token})
        
        if resolution:
            try:
                w, h = map(int, resolution.lower().split('x'))
                cfg.Resolution.Width = w
                cfg.Resolution.Height = h
            except Exception:
                return {"success": False, "error": f"Invalid resolution format: {resolution}. Expected 'WIDTHxHEIGHT'."}
                
        if encoding:
            enc_upper = encoding.upper()
            if enc_upper in ("MJPEG", "JPEG"):
                cfg.Encoding = "Jpeg"
            elif enc_upper in ("MPEG4", "MP4"):
                cfg.Encoding = "Mpeg4"
            elif enc_upper == "H264B":
                cfg.Encoding = "H264"
                if hasattr(cfg, 'H264'):
                    cfg.H264.H264Profile = "Baseline"
            elif enc_upper == "H264H":
                cfg.Encoding = "H264"
                if hasattr(cfg, 'H264'):
                    cfg.H264.H264Profile = "High"
            elif enc_upper == "H264":
                cfg.Encoding = "H264"
                if hasattr(cfg, 'H264'):
                    cfg.H264.H264Profile = "Main"
            else:
                cfg.Encoding = encoding
            
        if fps:
            cfg.RateControl.FrameRateLimit = int(fps)
            
        if bitrate:
            cfg.RateControl.BitrateLimit = int(bitrate)
            
        if iframe_interval is not None:
            if hasattr(cfg, 'H264'):
                cfg.H264.GovLength = int(iframe_interval)
            elif hasattr(cfg, 'H265'):
                cfg.H265.GovLength = int(iframe_interval)
                
        # Some older cameras might not have BitrateType in RateControl, or it might be read-only
        if bitrate_type:
            # We wrap in try-except because python-zeep might throw if schema doesn't match
            try:
                # usually Constant or Variable in ONVIF
                target_type = "Constant" if bitrate_type.upper() == "CBR" else "Variable"
                
                # Check if RateControl has an EncodingInterval or type
                # ONVIF 10 has no Type field in RateControl natively across all profiles
                pass # Only set GovLength for now to avoid schema errors unless tested with a specific device
            except Exception:
                pass
            
        media_service.SetVideoEncoderConfiguration({
            'Configuration': cfg,
            'ForcePersistence': True
        })
        
        print(f"[ONVIF ENCODER] ✅ Successfully updated video encoder settings for {ip} (profile: {profile_token})")
        return {"success": True}
        
    except Exception as e:
        print(f"[ONVIF ENCODER] ❌ Failed to update encoder configuration on {ip}: {e}")
        return {"success": False, "error": str(e)}
