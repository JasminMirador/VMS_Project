<#
.SYNOPSIS
    Automates Storage Provisioning for VMS Servers (Hardware RAID & JBOD detection)
.DESCRIPTION
    This script detects raw physical disks vs hardware RAID volumes and automatically
    provisions a resilient, 64KB-allocation-unit volume mapped to E:\REC for video recording.
    It performs pre-health checks, idempotency validation, logging, read/write I/O tests,
    and generates a final summary report.
.PARAMETER PreferPerformance
    Prioritizes I/O over capacity during JBOD auto-selection.
.PARAMETER RaidLevel
    Overrides auto-selection. Valid values: Mirror, Parity, DualParity, Simple
.PARAMETER Force
    Bypass safety confirmations when initializing and formatting disks. Required for unattended fleet automation.
.PARAMETER MinCapacityGB
    Minimum expected capacity in GB before throwing a warning (Default: 1000).
.PARAMETER TestFileSizeMB
    Size of the temporary file used for the I/O sanity check in MB (Default: 1024).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$TargetDriveLetter,
    [Parameter(Mandatory=$true)]
    [string]$RecordingsFolder,
    [switch]$PreferPerformance,
    [ValidateSet('Mirror', 'Parity', 'DualParity', 'Simple')]
    [string]$RaidLevel,
    [switch]$Force,
    [int]$MinCapacityGB = 1000,
    [int]$TestFileSizeMB = 1024
)

$ErrorActionPreference = 'Stop'

# Setup Logging
$logDir = "C:\ProgramData\VMS\Logs"
$logFile = "$logDir\StorageProvision.log"
if (-not (Test-Path $logDir)) {
    New-Item -Path $logDir -ItemType Directory -Force | Out-Null
}

function Write-Log {
    param (
        [Parameter(Mandatory=$true)]
        [string]$Message,
        [string]$Level = "INFO"
    )
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logEntry = "[$timestamp] [$Level] $Message"
    Add-Content -Path $logFile -Value $logEntry
    
    $color = "White"
    if ($Level -eq "WARN") { $color = "Yellow" }
    elseif ($Level -eq "ERROR") { $color = "Red" }
    elseif ($Level -eq "SUCCESS") { $color = "Green" }
    elseif ($Level -eq "INFO") { $color = "Cyan" }
    
    Write-Host "[$Level] $Message" -ForegroundColor $color
}

Write-Log "VMS Storage Provisioning Manager Started" "INFO"

$poolName = "VMS_Pool"
$vdName = "VMS_VirtualDisk"
$targetPath = "${TargetDriveLetter}:\${RecordingsFolder}"

$reportData = @{
    StorageType = "Unknown"
    Controller = "Unknown"
    Resiliency = "Unknown"
    Volume = $TargetDriveLetter
    Filesystem = "NTFS"
    AllocationUnit = "Unknown"
    Capacity = "Unknown"
    FreeSpace = "Unknown"
    Health = "Unknown"
    WriteSpeed = "N/A"
    ReadSpeed = "N/A"
    Status = "FAIL"
}

# 0. Check if already provisioned
if (Test-Path $targetPath) {
    Write-Log "The path $targetPath already exists. Storage appears to be provisioned." "INFO"
    $isHealthy = $true
    
    $existingVol = Get-Volume -DriveLetter $TargetDriveLetter -ErrorAction SilentlyContinue
    if ($existingVol) {
        Write-Log "Drive $TargetDriveLetter is active. Health: $($existingVol.HealthStatus)" "INFO"
        $reportData.Health = $existingVol.HealthStatus
        if ($existingVol.HealthStatus -ne 'Healthy') { $isHealthy = $false }
    }
    
    $existingVd = Get-VirtualDisk -FriendlyName $vdName -ErrorAction SilentlyContinue
    if ($existingVd) {
        Write-Log "Storage Spaces Virtual Disk Status: $($existingVd.HealthStatus) / $($existingVd.OperationalStatus)" "WARN"
        if ($existingVd.HealthStatus -ne 'Healthy') { $isHealthy = $false }
    }
    
    if ($isHealthy) {
        Write-Log "Storage is healthy. Skipping provisioning." "SUCCESS"
        exit 0
    } else {
        Write-Log "Existing storage is provisioned but UNHEALTHY. Skipping provisioning, but returning failure." "ERROR"
        exit 1
    }
}

# Ensure Drive Letter is not taken
$existingDrive = Get-Volume -DriveLetter $TargetDriveLetter -ErrorAction SilentlyContinue
if ($existingDrive) {
    Write-Log "Drive letter ${TargetDriveLetter}: is already in use by volume '$($existingDrive.FileSystemLabel)'." "ERROR"
    exit 1
}

# 1. Pre-Provisioning Health Check
Write-Log "Running pre-provisioning physical disk health checks..." "INFO"
$sickDisks = Get-PhysicalDisk | Where-Object { $_.HealthStatus -ne 'Healthy' }
if ($sickDisks) {
    Write-Log "WARNING: Found $($sickDisks.Count) physical disk(s) reporting unhealthy status!" "WARN"
    $sickDisks | ForEach-Object { Write-Log "  Disk: $($_.FriendlyName) | Health: $($_.HealthStatus) | Ops: $($_.OperationalStatus)" "WARN" }
    if (-not $Force) {
        $confirm = Read-Host "Proceed anyway? (Y/N)"
        if ($confirm -notmatch '^[Yy]$') { Write-Log "Aborted by user due to unhealthy disks." "ERROR"; exit 1 }
    }
} else {
    Write-Log "All physical disks report Healthy." "SUCCESS"
    Write-Log "NOTE: For Hardware RAID controllers, also verify drive health using vendor tools (Dell OpenManage, StorCLI, HPE SSA) for maximum reliability." "INFO"
}

# 2. Detect Poolable Disks & Raw HW RAID
$poolableDisks = Get-PhysicalDisk | Where-Object { $_.CanPool -eq $true }
$poolableCount = if ($poolableDisks) { $poolableDisks.Count } else { 0 }

$rawDisks = Get-Disk | Where-Object { $_.NumberOfPartitions -eq 0 -and $_.OperationalStatus -eq 'Online' }
$hwRaidDisk = $rawDisks | Where-Object {
    $_.Model -match 'PERC|MegaRAID|Smart Array|Virtual Disk|Logical Volume' -or
    $_.BusType -eq 'RAID'
} | Select-Object -First 1

if ($poolableCount -ge 2) {
    Write-Log "JBOD DETECTED: Found $poolableCount poolable physical disks." "INFO"
    $reportData.StorageType = "Storage Spaces (JBOD)"
    $reportData.Controller = "Windows Software RAID"
    
    if (-not $PSBoundParameters.ContainsKey('RaidLevel')) {
        if ($poolableCount -eq 2 -or $poolableCount -eq 3) { $RaidLevel = 'Mirror' }
        elseif ($poolableCount -ge 4 -and $poolableCount -le 6) { $RaidLevel = if ($PreferPerformance) { 'Mirror' } else { 'Parity' } }
        elseif ($poolableCount -ge 7) { $RaidLevel = if ($PreferPerformance) { 'Mirror' } else { 'DualParity' } }
    }
    
    $reportData.Resiliency = $RaidLevel
    $resiliencyDesc = if ($RaidLevel -eq 'Mirror') { "Mirror resiliency (similar redundancy to RAID 1; may provide RAID-10-like performance characteristics depending on layout)" } else { $RaidLevel }
    Write-Log "Selected Resiliency: $resiliencyDesc" "SUCCESS"
    
    if (-not $Force) {
        $confirm = Read-Host "Warning: This will initialize $poolableCount disks into a Storage Pool. Continue? (Y/N)"
        if ($confirm -notmatch '^[Yy]$') { Write-Log "Aborted by user." "WARN"; exit 0 }
    }
    
    $existingPool = Get-StoragePool -FriendlyName $poolName -ErrorAction SilentlyContinue
    if (-not $existingPool) {
        Write-Log "Creating Storage Pool '$poolName'..." "INFO"
        New-StoragePool -FriendlyName $poolName -StorageSubsystemFriendlyName (Get-StorageSubSystem -FriendlyName "Windows Storage*").FriendlyName -PhysicalDisks $poolableDisks -ErrorAction Stop | Out-Null
    }
    
    $existingVd = Get-VirtualDisk -FriendlyName $vdName -ErrorAction SilentlyContinue
    if (-not $existingVd) {
        Write-Log "Creating Virtual Disk '$vdName' ($RaidLevel)..." "INFO"
        if ($RaidLevel -eq 'DualParity') {
            New-VirtualDisk -StoragePoolFriendlyName $poolName -FriendlyName $vdName -ResiliencySettingName Parity -PhysicalDiskRedundancy 2 -UseMaximumSize -ProvisioningType Fixed -ErrorAction Stop | Out-Null
        } else {
            New-VirtualDisk -StoragePoolFriendlyName $poolName -FriendlyName $vdName -ResiliencySettingName $RaidLevel -UseMaximumSize -ProvisioningType Fixed -ErrorAction Stop | Out-Null
        }
    }
    
    $targetDisk = Get-VirtualDisk -FriendlyName $vdName | Get-Disk
}
elseif ($poolableCount -eq 1) {
    Write-Log "Found only 1 poolable disk. Aborting as no redundancy is possible in JBOD mode." "ERROR"
    exit 1
}
elseif ($hwRaidDisk) {
    Write-Log "HW RAID DETECTED: Found uninitialized RAID volume (Disk $($hwRaidDisk.Number), Model: $($hwRaidDisk.Model), Bus: $($hwRaidDisk.BusType))." "INFO"
    $reportData.StorageType = "Hardware RAID"
    $reportData.Controller = $hwRaidDisk.Model
    $reportData.Resiliency = "Managed by Hardware"
    $targetDisk = $hwRaidDisk
    
    if (-not $Force) {
        $confirm = Read-Host "Warning: This will format Disk $($targetDisk.Number). Continue? (Y/N)"
        if ($confirm -notmatch '^[Yy]$') { Write-Log "Aborted by user." "WARN"; exit 0 }
    }
}
else {
    Write-Log "0 poolable disks and 0 Hardware RAID disks found. Ensure disks are attached and controllers are configured." "ERROR"
    exit 1
}

# 3. Partition and Format
if ($targetDisk.PartitionStyle -eq 'RAW' -or $targetDisk.NumberOfPartitions -eq 0) {
    Write-Log "Initializing Disk $($targetDisk.Number)..." "INFO"
    Initialize-Disk -Number $targetDisk.Number -PartitionStyle GPT -ErrorAction SilentlyContinue
    
    Write-Log "Creating Partition and assigning drive letter $TargetDriveLetter..." "INFO"
    $partition = New-Partition -DiskNumber $targetDisk.Number -UseMaximumSize -DriveLetter $TargetDriveLetter -ErrorAction Stop
    
    Write-Log "Formatting Volume as NTFS with 64KB Allocation Unit Size..." "INFO"
    Format-Volume -Partition $partition -FileSystem NTFS -AllocationUnitSize 65536 -NewFileSystemLabel "VMS_REC" -Confirm:$false -ErrorAction Stop | Out-Null
}

if (-not (Test-Path $targetPath)) {
    Write-Log "Creating $targetPath directory..." "INFO"
    New-Item -Path $targetPath -ItemType Directory | Out-Null
}

# 4. Post-Provisioning Validation
$vol = Get-Volume -DriveLetter $TargetDriveLetter -ErrorAction SilentlyContinue
if ($vol) {
    $reportData.Health = $vol.HealthStatus
    if ($vol.AllocationUnitSize -eq 65536) {
        $reportData.AllocationUnit = "64 KB ok"
    } else {
        $reportData.AllocationUnit = "$($vol.AllocationUnitSize) bytes (Warning)"
    }
    
    $totalGB = [math]::Round($vol.Size / 1GB, 2)
    $freeGB = [math]::Round($vol.SizeRemaining / 1GB, 2)
    
    $reportData.Capacity = "$totalGB GB"
    $reportData.FreeSpace = "$freeGB GB"
    
    if ($totalGB -lt $MinCapacityGB) {
        Write-Log "Total capacity ($totalGB GB) is below the configured threshold of $MinCapacityGB GB." "WARN"
    }
}

# 5. Performance / Write-Read Test (Sanity Check)
Write-Log "Performing sequential I/O sanity check ($TestFileSizeMB MB)..." "INFO"
try {
    $testFile = "$targetPath\perf_test.tmp"
    $bytes = New-Object byte[] 1MB
    
    # Write Test
    $stopwatchW = [System.Diagnostics.Stopwatch]::StartNew()
    $fsW = [System.IO.File]::Create($testFile)
    for ($i=0; $i -lt $TestFileSizeMB; $i++) { $fsW.Write($bytes, 0, $bytes.Length) }
    $fsW.Close()
    $stopwatchW.Stop()
    $writeMBps = [math]::Round(($TestFileSizeMB / $stopwatchW.Elapsed.TotalSeconds), 2)
    $reportData.WriteSpeed = "$writeMBps MB/s"
    Write-Log "Sequential Write: $writeMBps MB/s" "SUCCESS"
    
    # Read Test
    $stopwatchR = [System.Diagnostics.Stopwatch]::StartNew()
    $fsR = [System.IO.File]::OpenRead($testFile)
    $buffer = New-Object byte[] 1MB
    while ($fsR.Read($buffer, 0, $buffer.Length) -gt 0) {}
    $fsR.Close()
    $stopwatchR.Stop()
    $readMBps = [math]::Round(($TestFileSizeMB / $stopwatchR.Elapsed.TotalSeconds), 2)
    $reportData.ReadSpeed = "$readMBps MB/s"
    Write-Log "Sequential Read: $readMBps MB/s" "SUCCESS"
    
    Remove-Item $testFile -Force
    $reportData.Status = "PASS"
} catch {
    Write-Log "Performance test failed: $_" "ERROR"
    $reportData.Status = "FAIL"
}

# 6. Final Summary Report
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "      Storage Provisioning Report        " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Check           Result"
Write-Host "-----------------------------------------"
Write-Host "Storage Type  : $($reportData.StorageType)"
Write-Host "Controller    : $($reportData.Controller)"
Write-Host "Resiliency    : $($reportData.Resiliency)"
Write-Host "Volume        : $($reportData.Volume):"
Write-Host "Filesystem    : $($reportData.Filesystem)"
Write-Host "Allocation    : $($reportData.AllocationUnit)"
Write-Host "Capacity      : $($reportData.Capacity)"
Write-Host "Free Space    : $($reportData.FreeSpace)"
Write-Host "Health        : $($reportData.Health)"
Write-Host "Write Speed   : $($reportData.WriteSpeed)"
Write-Host "Read Speed    : $($reportData.ReadSpeed)"
Write-Host "Status        : $($reportData.Status)"
Write-Host "=========================================" -ForegroundColor Cyan

if ($reportData.Status -eq "PASS" -and $reportData.Health -eq "Healthy") {
    Write-Log "Provisioning Workflow Completed Successfully. Note: I/O test is a sanity check; real performance varies by workload." "SUCCESS"
    exit 0
} else {
    Write-Log "Provisioning Workflow Completed with Errors or Warnings. Please check the report." "ERROR"
    exit 1
}
