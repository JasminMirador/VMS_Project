"""
Windows Storage Spaces — Full Software RAID Management Service
───────────────────────────────────────────────────────────────
Provides complete software RAID management on any Windows system
via PowerShell Storage Spaces cmdlets. No hardware RAID controller required.

Operations:
  - Storage Pool:    Create / Delete / List / Optimize / Add Disk / Remove Disk
  - Virtual Disk:    Create / Delete / Repair / List (Simple/Mirror/Parity)
  - Volume:          Create (Partition + Format + Mount)
  - Tiers:           SSD + HDD tiered storage
"""

import subprocess
import json
import os
import traceback

# ── PowerShell Helper ──────────────────────────────────────────────────────────

def _run_ps(script: str, timeout: int = 30) -> dict:
    """
    Run a PowerShell script and return parsed JSON result.
    Wraps commands in ConvertTo-Json for structured output.
    """
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, text=True, timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        if stdout:
            try:
                return {"success": True, "data": json.loads(stdout), "stderr": stderr}
            except json.JSONDecodeError:
                return {"success": True, "data": stdout, "stderr": stderr}

        if result.returncode != 0 and stderr:
            return {"success": False, "error": stderr, "data": None}

        return {"success": True, "data": None, "stderr": stderr}

    except subprocess.TimeoutExpired:
        return {"success": False, "error": "PowerShell command timed out.", "data": None}
    except FileNotFoundError:
        return {"success": False, "error": "PowerShell not found on this system.", "data": None}
    except Exception as e:
        return {"success": False, "error": str(e), "data": None}


def _ps_json(script: str, timeout: int = 30) -> list:
    """Run PS command and return data as list (always)."""
    res = _run_ps(script, timeout)
    data = res.get("data")
    if data is None:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


# ── Storage Pool Operations ──────────────────────────────────────────────────

def get_poolable_disks() -> list:
    """
    Get physical disks that can be added to a storage pool.
    These are raw disks not currently part of any pool or used by the OS.
    PowerShell: Get-PhysicalDisk -CanPool $true
    """
    script = """
    Update-HostStorageCache -ErrorAction SilentlyContinue

    $bootDisks = @(Get-Disk -ErrorAction SilentlyContinue | Where-Object { $_.IsBoot -or $_.IsSystem -or $_.Number -eq 0 } | Select-Object -ExpandProperty Number)
    $partDisks = @(Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter } | Select-Object -ExpandProperty DiskNumber)
    $protectedNumbers = @(0) + @($bootDisks) + @($partDisks) | Select-Object -Unique
    $protectedStrings = @($protectedNumbers | ForEach-Object { "$($_)".Trim() })

    # Attempt to reset any unallocated secondary disks so Storage Spaces updates CanPool
    $allDisks = Get-Disk -ErrorAction SilentlyContinue | Where-Object { 
        $protectedStrings -notcontains "$($_.Number)".Trim() -and 
        $_.OperationalStatus -eq 'Online' -and 
        ($_.AllocatedSize -eq 0 -or ($_.Size - $_.AllocatedSize) -gt 10GB)
    }
    foreach ($ad in $allDisks) {
        Set-Disk -Number $ad.Number -IsReadOnly $false -ErrorAction SilentlyContinue
        Set-Disk -Number $ad.Number -IsOffline $false -ErrorAction SilentlyContinue
        Get-PhysicalDisk | Where-Object { "$($_.DeviceId)".Trim() -eq "$($ad.Number)" } | Reset-PhysicalDisk -ErrorAction SilentlyContinue
    }

    $allPDisks = Get-PhysicalDisk -ErrorAction SilentlyContinue | Where-Object {
        $devId = "$($_.DeviceId)".Trim()
        $protectedStrings -notcontains $devId
    }

    # Eligible disks: CanPool is true OR healthy unallocated secondary disks
    $disks = @($allPDisks | Where-Object {
        $_.CanPool -eq $true -or
        ($_.CannotPoolReason -notin @('In a Pool', 'Spare', 'Removable Media') -and $_.OperationalStatus -eq 'OK')
    })

    if ($disks) {
        $disks | ForEach-Object {
            [PSCustomObject]@{
                device_id       = "$($_.DeviceId)".Trim()
                name            = $_.FriendlyName
                serial          = $_.SerialNumber
                media_type      = if ($_.MediaType) { $_.MediaType.ToString() } else { "Unspecified" }
                bus_type        = if ($_.BusType) { $_.BusType.ToString() } else { "RAID" }
                size_bytes      = $_.Size
                size_gb         = [math]::Round($_.Size / 1GB, 2)
                size_tb         = [math]::Round($_.Size / 1TB, 3)
                health          = if ($_.HealthStatus) { $_.HealthStatus.ToString() } else { "Healthy" }
                status          = if ($_.OperationalStatus) { $_.OperationalStatus.ToString() } else { "OK" }
                unique_id       = $_.UniqueId
                can_pool        = [bool]$_.CanPool
            }
        } | ConvertTo-Json -Depth 3
    } else {
        '[]'
    }
    """
    return _ps_json(script)


def get_all_physical_disks() -> list:
    """
    Get ALL physical disks on the system (poolable + pooled + system).
    PowerShell: Get-PhysicalDisk
    """
    script = """
    Get-PhysicalDisk | Select-Object `
        DeviceId, FriendlyName, SerialNumber, MediaType, BusType, `
        Size, HealthStatus, OperationalStatus, CanPool, Usage, UniqueId |
    ForEach-Object {
        [PSCustomObject]@{
            device_id       = $_.DeviceId
            name            = $_.FriendlyName
            serial          = $_.SerialNumber
            media_type      = $_.MediaType.ToString()
            bus_type        = $_.BusType.ToString()
            size_bytes      = $_.Size
            size_gb         = [math]::Round($_.Size / 1GB, 2)
            size_tb         = [math]::Round($_.Size / 1TB, 3)
            health          = $_.HealthStatus.ToString()
            status          = $_.OperationalStatus.ToString()
            can_pool        = [bool]$_.CanPool
            usage           = $_.Usage.ToString()
            unique_id       = $_.UniqueId
        }
    } | ConvertTo-Json -Depth 3
    """
    return _ps_json(script)


def get_storage_pools() -> list:
    """
    List all non-primordial storage pools.
    PowerShell: Get-StoragePool -IsPrimordial $false
    """
    script = """
    $pools = Get-StoragePool -IsPrimordial $false -ErrorAction SilentlyContinue |
        Select-Object FriendlyName, OperationalStatus, HealthStatus, Size, AllocatedSize,
                      IsReadOnly, ProvisioningTypeDefault, ResiliencySettingNameDefault, UniqueId
    if ($pools) {
        $pools | ForEach-Object {
            $disks = Get-StoragePool -FriendlyName $_.FriendlyName | Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, Size, MediaType
            [PSCustomObject]@{
                name              = $_.FriendlyName
                status            = $_.OperationalStatus.ToString()
                health            = $_.HealthStatus.ToString()
                total_bytes       = $_.Size
                total_gb          = [math]::Round($_.Size / 1GB, 2)
                total_tb          = [math]::Round($_.Size / 1TB, 3)
                allocated_bytes   = $_.AllocatedSize
                allocated_gb      = [math]::Round($_.AllocatedSize / 1GB, 2)
                free_bytes        = ($_.Size - $_.AllocatedSize)
                free_gb           = [math]::Round(($_.Size - $_.AllocatedSize) / 1GB, 2)
                is_read_only      = [bool]$_.IsReadOnly
                provisioning      = $_.ProvisioningTypeDefault.ToString()
                resiliency        = $_.ResiliencySettingNameDefault.ToString()
                unique_id         = $_.UniqueId
                disk_count        = ($disks | Measure-Object).Count
                disks             = @($disks | ForEach-Object {
                    [PSCustomObject]@{
                        device_id  = $_.DeviceId
                        name       = $_.FriendlyName
                        size_gb    = [math]::Round($_.Size / 1GB, 2)
                        media_type = $_.MediaType.ToString()
                    }
                })
            }
        } | ConvertTo-Json -Depth 4
    } else {
        '[]'
    }
    """
    return _ps_json(script)


def create_storage_pool(pool_name: str, disk_ids: list, subsystem_name: str = None) -> dict:
    """
    Create a new Storage Pool from selected physical disks.
    PowerShell: New-StoragePool
    
    Args:
        pool_name: Friendly name for the pool (e.g., "VMS_Pool_01")
        disk_ids: List of PhysicalDisk DeviceIds or UniqueIds to include
        subsystem_name: Storage subsystem (auto-detected if not provided)
    """
    if not pool_name or not disk_ids:
        return {"success": False, "error": "Pool name and at least one disk are required."}

    disk_filter = " -or ".join([f'$_.DeviceId -eq "{did}"' for did in disk_ids])

    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        $bootDisks = @(Get-Disk -ErrorAction SilentlyContinue | Where-Object {{ $_.IsBoot -or $_.IsSystem -or $_.Number -eq 0 }} | Select-Object -ExpandProperty Number)
        $partDisks = @(Get-Partition -ErrorAction SilentlyContinue | Where-Object {{ $_.DriveLetter }} | Select-Object -ExpandProperty DiskNumber)
        $protectedNumbers = @(0) + @($bootDisks) + @($partDisks) | Select-Object -Unique
        $protectedStrings = @($protectedNumbers | ForEach-Object {{ "$($_)".Trim() }})

        $disks = Get-PhysicalDisk | Where-Object {{ {disk_filter} }}
        foreach ($d in $disks) {{
            $did = "$($d.DeviceId)".Trim()
            if ($protectedStrings -contains $did) {{
                throw ("Refusing to pool Disk " + $did + ": Contains operating system (C:) or active mounted drive partition.")
            }}
            # Clear readonly/offline and reset physical disk so CanPool is guaranteed true
            try {{
                $numVal = [int]$did
                Set-Disk -Number $numVal -IsReadOnly $false -ErrorAction SilentlyContinue
                Set-Disk -Number $numVal -IsOffline $false -ErrorAction SilentlyContinue
            }} catch {{}}
            $d | Reset-PhysicalDisk -ErrorAction SilentlyContinue
        }}
        Update-HostStorageCache -ErrorAction SilentlyContinue

        $subsystem = Get-StorageSubSystem | Where-Object {{ $_.FriendlyName -like '*Windows*' -or $_.FriendlyName -like '*Storage*' }} | Select-Object -First 1
        if (-not $subsystem) {{
            $subsystem = Get-StorageSubSystem | Select-Object -First 1
        }}
        $disks = Get-PhysicalDisk | Where-Object {{ {disk_filter} }}
        if (($disks | Measure-Object).Count -eq 0) {{
            throw 'No matching physical disks found. Ensure disks are available for pooling.'
        }}
        $pool = New-StoragePool `
            -FriendlyName '{pool_name}' `
            -StorageSubSystemFriendlyName $subsystem.FriendlyName `
            -PhysicalDisks $disks
        [PSCustomObject]@{{
            success = $true
            name = $pool.FriendlyName
            size_gb = [math]::Round($pool.Size / 1GB, 2)
            disk_count = ($disks | Measure-Object).Count
        }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{
            success = $false
            error = $_.Exception.Message
        }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script, timeout=60)
    data = res.get("data")
    if isinstance(data, dict):
        return data
    if res.get("success") and data:
        return {"success": True, "message": f"Storage Pool '{pool_name}' created with {len(disk_ids)} disk(s)."}
    return {"success": False, "error": res.get("error", "Failed to create storage pool.")}


def delete_storage_pool(pool_name: str) -> dict:
    """
    Delete a Storage Pool and release all its physical disks.
    WARNING: All Virtual Disks in the pool must be deleted first.
    PowerShell: Remove-StoragePool
    """
    if not pool_name:
        return {"success": False, "error": "Pool name is required."}

    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        # Check for existing VDs
        $vds = Get-StoragePool -FriendlyName '{pool_name}' | Get-VirtualDisk -ErrorAction SilentlyContinue
        if ($vds -and ($vds | Measure-Object).Count -gt 0) {{
            throw 'Storage Pool has existing virtual disks. Delete all virtual disks before removing the pool.'
        }}
        Remove-StoragePool -FriendlyName '{pool_name}' -Confirm:$false
        [PSCustomObject]@{{ success = $true }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        return {"success": True, "message": f"Storage Pool '{pool_name}' deleted. All disks released."}
    err = (data or {}).get("error", res.get("error", "Failed to delete pool."))
    return {"success": False, "error": err}


def add_disk_to_pool(pool_name: str, disk_id: str) -> dict:
    """
    Add a physical disk to an existing storage pool to expand capacity.
    PowerShell: Add-PhysicalDisk -StoragePoolFriendlyName ... -PhysicalDisks ...
    """
    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        $disk = Get-PhysicalDisk | Where-Object {{ "$($_.DeviceId)".Trim() -eq '{disk_id}' }}
        if (-not $disk) {{ throw 'Physical disk not found.' }}
        try {{
            $numVal = [int]'{disk_id}'
            Set-Disk -Number $numVal -IsReadOnly $false -ErrorAction SilentlyContinue
            Set-Disk -Number $numVal -IsOffline $false -ErrorAction SilentlyContinue
        }} catch {{}}
        $disk | Reset-PhysicalDisk -ErrorAction SilentlyContinue
        Add-PhysicalDisk -StoragePoolFriendlyName '{pool_name}' -PhysicalDisks $disk
        [PSCustomObject]@{{ success = $true; size_gb = [math]::Round($disk.Size / 1GB, 2) }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        return {"success": True, "message": f"Disk {disk_id} added to pool '{pool_name}'. Pool capacity expanded by {data.get('size_gb', '?')} GB."}
    err = (data or {}).get("error", res.get("error", "Failed to add disk to pool."))
    return {"success": False, "error": err}


def remove_disk_from_pool(pool_name: str, disk_id: str) -> dict:
    """
    Remove a physical disk from a storage pool.
    The pool must have enough remaining capacity for existing VDs.
    PowerShell: Remove-PhysicalDisk
    """
    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        $disk = Get-StoragePool -FriendlyName '{pool_name}' | Get-PhysicalDisk | Where-Object {{ $_.DeviceId -eq '{disk_id}' }}
        if (-not $disk) {{ throw 'Physical disk not found in this pool.' }}
        Remove-PhysicalDisk -StoragePoolFriendlyName '{pool_name}' -PhysicalDisks $disk -Confirm:$false
        [PSCustomObject]@{{ success = $true }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        return {"success": True, "message": f"Disk {disk_id} removed from pool '{pool_name}'."}
    err = (data or {}).get("error", res.get("error", "Failed to remove disk from pool."))
    return {"success": False, "error": err}


def optimize_storage_pool(pool_name: str) -> dict:
    """
    Optimize (rebalance) a Storage Pool — redistributes data evenly across drives.
    Useful after adding new drives.
    PowerShell: Optimize-StoragePool
    """
    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        Optimize-StoragePool -FriendlyName '{pool_name}'
        [PSCustomObject]@{{ success = $true }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script, timeout=120)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        return {"success": True, "message": f"Storage Pool '{pool_name}' optimization started. Data will be rebalanced across all drives."}
    err = (data or {}).get("error", res.get("error", "Failed to optimize pool."))
    return {"success": False, "error": err}


# ── Virtual Disk Operations ──────────────────────────────────────────────────

def get_virtual_disks_sw() -> list:
    """
    List all software Virtual Disks (Storage Spaces VDs).
    PowerShell: Get-VirtualDisk
    """
    script = """
    $vds = Get-VirtualDisk -ErrorAction SilentlyContinue |
        Select-Object FriendlyName, OperationalStatus, HealthStatus, Size, AllocatedSize,
                      ResiliencySettingName, NumberOfColumns, Interleave, ProvisioningType,
                      FootprintOnPool, UniqueId, IsDeduplicationEnabled
    if ($vds) {
        $vds | ForEach-Object {
            $poolName = ''
            try { $poolName = (Get-VirtualDisk -FriendlyName $_.FriendlyName | Get-StoragePool).FriendlyName } catch {}
            $volume = Get-VirtualDisk -FriendlyName $_.FriendlyName | Get-Disk | Get-Partition |
                      Get-Volume -ErrorAction SilentlyContinue | Select-Object -First 1
            [PSCustomObject]@{
                name              = $_.FriendlyName
                status            = $_.OperationalStatus.ToString()
                health            = $_.HealthStatus.ToString()
                size_bytes        = $_.Size
                size_gb           = [math]::Round($_.Size / 1GB, 2)
                size_tb           = [math]::Round($_.Size / 1TB, 3)
                allocated_bytes   = $_.AllocatedSize
                resiliency        = $_.ResiliencySettingName.ToString()
                columns           = $_.NumberOfColumns
                interleave_kb     = [math]::Round($_.Interleave / 1KB)
                provisioning      = $_.ProvisioningType.ToString()
                footprint_gb      = [math]::Round($_.FootprintOnPool / 1GB, 2)
                unique_id         = $_.UniqueId
                pool_name         = $poolName
                drive_letter      = if ($volume) { $volume.DriveLetter } else { '' }
                volume_label      = if ($volume) { $volume.FileSystemLabel } else { '' }
                fs_type           = if ($volume) { $volume.FileSystem } else { '' }
            }
        } | ConvertTo-Json -Depth 3
    } else {
        '[]'
    }
    """
    return _ps_json(script)


def create_virtual_disk_sw(pool_name: str, vd_name: str, resiliency: str = "Mirror",
                            size_gb: int = 0, provisioning: str = "Fixed",
                            columns: int = 0, interleave_kb: int = 64) -> dict:
    """
    Create a Virtual Disk on a Storage Pool.
    
    Args:
        pool_name: Name of the storage pool
        vd_name: Friendly name for the virtual disk
        resiliency: 'Simple' (RAID0), 'Mirror' (RAID1), 'Parity' (RAID5)
        size_gb: Size in GB (0 = use maximum available)
        provisioning: 'Fixed' (thick) or 'Thin'
        columns: Number of data columns (0 = auto)
        interleave_kb: Stripe/interleave size in KB
    """
    resiliency_map = {
        "raid0": "Simple", "simple": "Simple", "stripe": "Simple",
        "raid1": "Mirror", "mirror": "Mirror",
        "raid5": "Parity", "parity": "Parity",
        "raid6": "Parity", "dualparity": "Parity",
        "raid10": "Mirror"
    }
    res_name = resiliency_map.get(resiliency.lower(), resiliency)

    size_param = "-UseMaximumSize" if size_gb <= 0 else f"-Size {size_gb}GB"
    col_param = f"-NumberOfColumns {columns}" if columns > 0 else ""
    interleave_param = f"-Interleave {interleave_kb * 1024}" if interleave_kb > 0 else ""

    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        $vd = New-VirtualDisk `
            -StoragePoolFriendlyName '{pool_name}' `
            -FriendlyName '{vd_name}' `
            -ResiliencySettingName '{res_name}' `
            -ProvisioningType '{provisioning}' `
            {size_param} {col_param} {interleave_param}
        [PSCustomObject]@{{
            success    = $true
            name       = $vd.FriendlyName
            size_gb    = [math]::Round($vd.Size / 1GB, 2)
            resiliency = $vd.ResiliencySettingName.ToString()
        }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script, timeout=120)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        return {
            "success": True,
            "message": f"Virtual Disk '{vd_name}' ({res_name}, {data.get('size_gb', '?')} GB) created on pool '{pool_name}'.",
            "virtual_disk": data
        }
    err = (data or {}).get("error", res.get("error", "Failed to create virtual disk."))
    if "sufficient eligible resources" in err or "FaultDomainAwareness" in err or "PhysicalDiskRedundancy" in err:
        err = (
            f"The storage pool '{pool_name}' does not have enough physical disks for {res_name}. "
            f"Windows Storage Spaces requires at least 2 separate physical disks for RAID 1 (Mirror) and 3 disks for RAID 5 (Parity). "
            f"Since the pool currently has only 1 physical disk, please select 'RAID 0 / Simple'."
        )
    return {"success": False, "error": err}


def delete_virtual_disk_sw(vd_name: str) -> dict:
    """
    Delete a software Virtual Disk.
    PowerShell: Remove-VirtualDisk
    """
    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        $vd = Get-VirtualDisk -FriendlyName '{vd_name}' -ErrorAction SilentlyContinue
        if ($vd) {{
            $disk = $vd | Get-Disk -ErrorAction SilentlyContinue
            if ($disk -and -not $disk.IsBoot -and -not $disk.IsSystem) {{
                Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | Where-Object {{ -not $_.IsBoot -and -not $_.IsSystem }} | Remove-Partition -Confirm:$false -ErrorAction SilentlyContinue
            }}
        }}
        Remove-VirtualDisk -FriendlyName '{vd_name}' -Confirm:$false
        Update-HostStorageCache -ErrorAction SilentlyContinue
        [PSCustomObject]@{{ success = $true }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        return {"success": True, "message": f"Virtual Disk '{vd_name}' deleted."}
    err = (data or {}).get("error", res.get("error", "Failed to delete virtual disk."))
    return {"success": False, "error": err}


def repair_virtual_disk(vd_name: str) -> dict:
    """
    Repair a degraded software Virtual Disk.
    Rebuilds redundancy using available pool capacity.
    PowerShell: Repair-VirtualDisk
    """
    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        Repair-VirtualDisk -FriendlyName '{vd_name}'
        [PSCustomObject]@{{ success = $true }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script, timeout=300)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        return {"success": True, "message": f"Repair started for Virtual Disk '{vd_name}'. Redundancy will be rebuilt using available pool capacity."}
    err = (data or {}).get("error", res.get("error", "Failed to repair virtual disk."))
    return {"success": False, "error": err}


# ── Volume Operations ────────────────────────────────────────────────────────

def create_volume_on_vd(vd_name: str, drive_letter: str = "", fs_type: str = "NTFS",
                         label: str = "VMS_Data") -> dict:
    r"""
    Initialize the Virtual Disk, create a partition, format it, and mount it.
    This makes the VD usable as a drive letter (e.g., D:\).
    
    PowerShell: Initialize-Disk -> New-Partition -> Format-Volume
    """
    drive_clean = drive_letter.strip().rstrip(":").upper() if drive_letter else ""
    clean_label = label.strip() if label else "VMS_STORAGE"

    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        $vd = Get-VirtualDisk -FriendlyName '{vd_name}' -ErrorAction Stop
        $disk = $vd | Get-Disk -ErrorAction Stop
        if (-not $disk) {{
            throw "Could not retrieve Windows Disk object for Virtual Disk '{vd_name}'."
        }}

        Set-Disk -Number $disk.Number -IsOffline $false -ErrorAction SilentlyContinue
        Set-Disk -Number $disk.Number -IsReadOnly $false -ErrorAction SilentlyContinue

        if ($disk.PartitionStyle -eq 'RAW') {{
            Initialize-Disk -Number $disk.Number -PartitionStyle GPT -ErrorAction Stop
        }}

        # Dynamically discover all currently active drive letters in Windows
        $usedLetters = @((Get-Volume -ErrorAction SilentlyContinue).DriveLetter | Where-Object {{ $_ }} | ForEach-Object {{ "$_".ToUpper() }})
        $targetLetter = '{drive_clean}'
        if (-not $targetLetter -or ($usedLetters -contains $targetLetter)) {{
            $candidates = @('D', 'F', 'G', 'H', 'R', 'V', 'S', 'T', 'M', 'P', 'Q')
            $targetLetter = $candidates | Where-Object {{ $_ -notin $usedLetters }} | Select-Object -First 1
        }}

        # Check if a partition already exists on this virtual disk
        $part = Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue |
                Where-Object {{ $_.Type -ne 'Reserved' -and $_.Type -ne 'System' }} |
                Select-Object -First 1

        if (-not $part) {{
            if ($targetLetter) {{
                $part = New-Partition -DiskNumber $disk.Number -UseMaximumSize -DriveLetter $targetLetter -ErrorAction Stop
            }} else {{
                $part = New-Partition -DiskNumber $disk.Number -UseMaximumSize -AssignDriveLetter -ErrorAction Stop
            }}
        }} else {{
            if (-not $part.DriveLetter) {{
                if ($targetLetter) {{
                    Set-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -NewDriveLetter $targetLetter -ErrorAction SilentlyContinue
                }} else {{
                    $candidates = @('D', 'F', 'G', 'H', 'R', 'V', 'S', 'T')
                    $avail = $candidates | Where-Object {{ $_ -notin $usedLetters }} | Select-Object -First 1
                    if ($avail) {{
                        Set-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -NewDriveLetter $avail -ErrorAction SilentlyContinue
                    }}
                }}
                $part = Get-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber
            }}
        }}

        Start-Sleep -Seconds 1
        $finalLetter = if ($part.DriveLetter) {{ "$($part.DriveLetter)".ToUpper() }} else {{ $targetLetter }}

        # Format NTFS with 64KB surveillance video streaming clusters
        $vol = Format-Volume -DriveLetter $finalLetter -FileSystem '{fs_type}' -AllocationUnitSize 65536 -NewFileSystemLabel '{clean_label}' -Confirm:$false -Force -ErrorAction Stop

        Update-HostStorageCache -ErrorAction SilentlyContinue

        [PSCustomObject]@{{
            success      = $true
            drive_letter = $finalLetter
            label        = $vol.FileSystemLabel
            fs_type      = $vol.FileSystem
            size_gb      = [math]::Round($vol.Size / 1GB, 2)
        }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script, timeout=120)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        letter = data.get("drive_letter", "?")
        return {
            "success": True,
            "message": f"Volume created: {letter}:\\ ({data.get('fs_type', fs_type)}, {data.get('size_gb', '?')} GB, Label: '{data.get('label', label)}'). Ready for VMS recording.",
            "volume": data
        }
    err = (data or {}).get("error", res.get("error", "Failed to create volume."))
    return {"success": False, "error": err}


# ── Storage Tiers ────────────────────────────────────────────────────────────

def get_storage_tiers(pool_name: str) -> list:
    """
    List storage tiers in a pool (SSD/HDD tiering).
    PowerShell: Get-StorageTier
    """
    script = f"""
    $tiers = Get-StoragePool -FriendlyName '{pool_name}' -ErrorAction SilentlyContinue |
             Get-StorageTier -ErrorAction SilentlyContinue
    if ($tiers) {{
        $tiers | ForEach-Object {{
            [PSCustomObject]@{{
                name       = $_.FriendlyName
                media_type = $_.MediaType.ToString()
                size_gb    = [math]::Round($_.Size / 1GB, 2)
                alloc_gb   = [math]::Round($_.AllocatedSize / 1GB, 2)
            }}
        }} | ConvertTo-Json -Depth 3
    }} else {{
        '[]'
    }}
    """
    return _ps_json(script)


def create_tiered_virtual_disk(pool_name: str, vd_name: str,
                                 ssd_size_gb: int = 50, hdd_size_gb: int = 500) -> dict:
    """
    Create a tiered Virtual Disk with SSD (hot) + HDD (cold) tiers.
    Frequently accessed data auto-migrates to SSD tier for faster reads.
    
    PowerShell: New-StorageTier → New-VirtualDisk -StorageTiers
    """
    script = f"""
    $ErrorActionPreference = 'Stop'
    try {{
        $pool = Get-StoragePool -FriendlyName '{pool_name}'
        $ssd_tier = $pool | New-StorageTier -FriendlyName '{vd_name}_SSD' -MediaType SSD
        $hdd_tier = $pool | New-StorageTier -FriendlyName '{vd_name}_HDD' -MediaType HDD
        $vd = New-VirtualDisk `
            -StoragePoolFriendlyName '{pool_name}' `
            -FriendlyName '{vd_name}' `
            -StorageTiers @($ssd_tier, $hdd_tier) `
            -StorageTierSizes @({ssd_size_gb}GB, {hdd_size_gb}GB) `
            -ResiliencySettingName Mirror
        [PSCustomObject]@{{
            success  = $true
            name     = $vd.FriendlyName
            ssd_gb   = {ssd_size_gb}
            hdd_gb   = {hdd_size_gb}
            total_gb = {ssd_size_gb + hdd_size_gb}
        }} | ConvertTo-Json
    }} catch {{
        [PSCustomObject]@{{ success = $false; error = $_.Exception.Message }} | ConvertTo-Json
    }}
    """
    res = _run_ps(script, timeout=120)
    data = res.get("data")
    if isinstance(data, dict) and data.get("success"):
        return {
            "success": True,
            "message": f"Tiered Virtual Disk '{vd_name}' created: {ssd_size_gb} GB SSD (hot) + {hdd_size_gb} GB HDD (cold). Frequently accessed data auto-migrates to SSD."
        }
    err = (data or {}).get("error", res.get("error", "Failed to create tiered disk."))
    return {"success": False, "error": err}


# ── Summary / Overview ───────────────────────────────────────────────────────

def get_storage_spaces_overview() -> dict:
    """
    Full overview of Windows Storage Spaces state:
    pools, virtual disks, poolable disks, volumes.
    """
    pools = get_storage_pools()
    vds = get_virtual_disks_sw()
    poolable = get_poolable_disks()

    total_pool_tb = sum(p.get("total_tb", 0) for p in pools)
    total_allocated_tb = sum(p.get("allocated_gb", 0) / 1024 for p in pools)

    return {
        "pools": pools,
        "virtual_disks": vds,
        "poolable_disks": poolable,
        "pool_count": len(pools),
        "vd_count": len(vds),
        "poolable_count": len(poolable),
        "total_pool_tb": round(total_pool_tb, 3),
        "total_allocated_tb": round(total_allocated_tb, 3),
        "has_pools": len(pools) > 0,
        "has_poolable_disks": len(poolable) > 0
    }
