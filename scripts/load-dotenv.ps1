# Load selected keys from the project .env file into the current session.
param(
  [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$envFile = Join-Path $ProjectRoot ".env"
if (-not (Test-Path $envFile)) { return }

Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $eq = $line.IndexOf('=')
  if ($eq -lt 1) { return }

  $key = $line.Substring(0, $eq).Trim()
  $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")

  if ($key -eq 'SUPABASE_ACCESS_TOKEN' -and -not $env:SUPABASE_ACCESS_TOKEN) {
    $env:SUPABASE_ACCESS_TOKEN = $value
  }
}
