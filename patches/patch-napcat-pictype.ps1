# Patch NapCat picType mappings after auto-update overwrites them
# Run: powershell -File C:\Users\Xixinglu\bin\patch-napcat-pictype.ps1

$napcat = "C:\Users\Xixinglu\AppData\Local\NapCat\napcat.mjs"

if (-not (Test-Path $napcat)) {
    Write-Output "ERROR: napcat.mjs not found at $napcat"
    exit 1
}

$content = Get-Content $napcat -Raw -Encoding UTF8

# Check if already fully patched (final desired state)
if ($content -match "'png': Wp\.NEWPIC_PNG") {
    Write-Output "OK: napcat.mjs already patched (NEWPIC_PNG)"
    exit 0
}

# Step 1: Upgrade from old APNG patch to PNG (for files patched before 2026-06-20)
$content = $content -replace "'png': Wp\.NEWPIC_APNG,", "'png': Wp.NEWPIC_PNG,"

# Step 2: Uncomment and fix variable names (PicType -> Wp) for unpatched files
$content = $content -replace "// 'webp': PicType\.NEWPIC_WEBP,", "'webp': Wp.NEWPIC_WEBP,"
$content = $content -replace "// 'png': PicType\.NEWPIC_APNG,", "'png': Wp.NEWPIC_PNG,"
$content = $content -replace "// 'jpg': PicType\.NEWPIC_JPEG,", "'jpg': Wp.NEWPIC_JPEG,"
$content = $content -replace "// 'jpeg': PicType\.NEWPIC_JPEG,", "'jpeg': Wp.NEWPIC_JPEG,"
$content = $content -replace "// 'bmp': PicType\.NEWPIC_BMP,", "'bmp': Wp.NEWPIC_BMP,"

[System.IO.File]::WriteAllText($napcat, $content, [System.Text.UTF8Encoding]::new($false))
Write-Output "PATCHED: napcat.mjs picType mappings restored"
