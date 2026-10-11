# ========================================================================
# VMS Health Check Script
# ========================================================================
# Calls the Primary API's /health endpoint and verifies that ALL
# required dependencies are healthy.
#
# Returns 0 if fully healthy, 1 if any dependency is unhealthy or unreachable.
# ========================================================================

param (
    [string]$PrimaryIP = "192.168.126.200",
    [string]$ApiPort = "8000"
)

try {
    $response = Invoke-RestMethod -Uri "http://${PrimaryIP}:${ApiPort}/api/health" -Method Get -TimeoutSec 5 -ErrorAction Stop

    # Expecting a JSON response where all fields must be $true
    # Example: { "mongodb": true, "minio": true, "mediamtx": true, "mosquitto": true, "stream_manager": true, "scheduler": true }
    
    $isHealthy = $true
    
    if (-not $response.mongodb) { $isHealthy = $false }
    if (-not $response.minio) { $isHealthy = $false }
    if (-not $response.mediamtx) { $isHealthy = $false }
    if (-not $response.mosquitto) { $isHealthy = $false }
    if (-not $response.stream_manager) { $isHealthy = $false }
    if (-not $response.scheduler) { $isHealthy = $false }
    if (-not $response.cluster_mode) { $isHealthy = $false }

    if ($isHealthy) {
        Write-Output "PASS"
        Exit 0
    } else {
        Write-Output "FAIL - One or more internal dependencies are unhealthy."
        Exit 1
    }

} catch {
    Write-Output "FAIL - API unreachable or returned an error."
    Exit 1
}
