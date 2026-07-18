param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("configure", "read", "remove")]
  [string]$Operation,

  [Parameter(Mandatory = $true, Position = 1)]
  [string]$CredentialPath
)

$ErrorActionPreference = "Stop"
$expectedUserName = "api-key"

try {
  switch ($Operation) {
    "configure" {
      $directory = Split-Path -Parent $CredentialPath
      [System.IO.Directory]::CreateDirectory($directory) | Out-Null
      $secureKey = Read-Host "DeepSeek API Key" -AsSecureString
      $credential = [System.Management.Automation.PSCredential]::new($expectedUserName, $secureKey)
      $credential | Export-Clixml -LiteralPath $CredentialPath -Force
    }
    "read" {
      if (-not (Test-Path -LiteralPath $CredentialPath -PathType Leaf)) {
        exit 3
      }
      $credential = Import-Clixml -LiteralPath $CredentialPath
      if ($credential.UserName -ne $expectedUserName) {
        exit 4
      }
      $plainText = $credential.GetNetworkCredential().Password
      [Console]::Out.Write($plainText)
    }
    "remove" {
      if (Test-Path -LiteralPath $CredentialPath -PathType Leaf) {
        Remove-Item -LiteralPath $CredentialPath -Force
      }
    }
  }
} catch {
  exit 4
}
