import ipaddress
import urllib.parse
from fastapi import HTTPException

# Dangerous IPs to block (e.g. localhost, cloud metadata)
BLOCKED_IPS = {
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254", # AWS / Cloud Metadata
}

def validate_ip_only(address: str) -> bool:
    """
    Validates that the given address is strictly a valid IPv4 address.
    Rejects domain names. Raises HTTPException if validation fails.
    """
    if not address:
        raise HTTPException(status_code=400, detail="IP address cannot be empty")
        
    try:
        ip = ipaddress.IPv4Address(address)
    except ipaddress.AddressValueError:
        raise HTTPException(status_code=400, detail=f"Invalid IP address format or domain names are not allowed: {address}")

    if str(ip) in BLOCKED_IPS:
        raise HTTPException(status_code=400, detail=f"The IP address {address} is restricted")
        
    if ip.is_loopback:
        raise HTTPException(status_code=400, detail="Loopback IP addresses are not allowed")

    return True

def validate_rtsp_url(url: str) -> bool:
    """
    Extracts the host from an RTSP URL and ensures it is a strictly valid IPv4 address.
    Rejects URLs containing domain names. Raises HTTPException if validation fails.
    """
    if not url:
        return True # Optional fields might be empty
        
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname
        if not host:
            raise HTTPException(status_code=400, detail="Invalid RTSP URL: No host found")
            
        return validate_ip_only(host)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=400, detail=f"Invalid RTSP URL format: {str(e)}")

import re

NAME_REGEX = re.compile(r"^[a-zA-Z0-9 _.-]+$")

def validate_name(name: str, field_name: str = "Name") -> str:
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail=f"{field_name} is required")
    name = name.strip()
    if not NAME_REGEX.match(name):
        raise HTTPException(status_code=400, detail=f"{field_name} contains invalid characters")
    return name
