param(
    [Parameter(Mandatory=$true)]
    [string]$DriveLetter
)

$testFile = "${DriveLetter}:\io_test.tmp"
$fileSizeMB = 1024

$buffer = New-Object byte[] (64KB)
$random = New-Object Random
$random.NextBytes($buffer)

$writeTimer = [System.Diagnostics.Stopwatch]::StartNew()
$fs = [System.IO.File]::Create($testFile)
for ($i=0; $i -lt ($fileSizeMB * 1MB / 64KB); $i++) {
    $fs.Write($buffer, 0, $buffer.Length)
}
$fs.Close()
$writeTimer.Stop()

$readTimer = [System.Diagnostics.Stopwatch]::StartNew()
$fs = [System.IO.File]::OpenRead($testFile)
while ($fs.Read($buffer, 0, $buffer.Length) -gt 0) { }
$fs.Close()
$readTimer.Stop()

Remove-Item $testFile -Force -ErrorAction SilentlyContinue

$writeSpeed = [math]::Round($fileSizeMB / $writeTimer.Elapsed.TotalSeconds, 2)
$readSpeed = [math]::Round($fileSizeMB / $readTimer.Elapsed.TotalSeconds, 2)

@{"write_speed"="$writeSpeed MB/s"; "read_speed"="$readSpeed MB/s"} | ConvertTo-Json -Compress
