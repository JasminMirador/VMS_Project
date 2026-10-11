$disks = @()

# 1. Check JBOD disks
$poolable = Get-PhysicalDisk | Where-Object { $_.CanPool -eq $true }
foreach ($d in $poolable) {
    $disks += @{
        name = $d.FriendlyName
        health = $d.HealthStatus
        type = "JBOD Physical Disk"
        capacity_tb = [math]::Round($d.Size / 1TB, 2)
        device_id = $d.DeviceId
    }
}

# 2. Check Unpartitioned HW RAID Volumes
$hw = Get-Disk | Where-Object { $_.NumberOfPartitions -eq 0 -and $_.OperationalStatus -eq 'Online' } | Where-Object {
    $_.Model -match 'PERC|MegaRAID|Smart Array|Virtual Disk|Logical Volume' -or $_.BusType -eq 'RAID'
}
foreach ($h in $hw) {
    $disks += @{
        name = $h.Model
        health = $h.HealthStatus
        type = "Hardware RAID Volume"
        capacity_tb = [math]::Round($h.Size / 1TB, 2)
        device_id = $h.Number
    }
}

# 3. Fallback: Report Active Disks (C:, D:, etc.) if no raw poolable/RAID arrays found
if ($disks.Count -eq 0) {
    $activeDisks = Get-Disk | Where-Object { $_.OperationalStatus -eq 'Online' }
    foreach ($ad in $activeDisks) {
        $partitions = Get-Partition -DiskNumber $ad.Number | Where-Object { $_.DriveLetter }
        $letters = ($partitions.DriveLetter -join ", ")
        $disks += @{
            name = if ($ad.Model) { $ad.Model } else { "Local Disk ($letters)" }
            health = if ($ad.HealthStatus) { $ad.HealthStatus } else { "Healthy" }
            type = "Active System Disk ($letters)"
            capacity_tb = [math]::Round($ad.Size / 1TB, 2)
            device_id = $ad.Number
        }
    }
}

$disks | ConvertTo-Json -Compress
