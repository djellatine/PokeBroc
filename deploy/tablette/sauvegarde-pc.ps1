<#
Rapatrie sur le PC la dernière sauvegarde de la tablette.

Les archives `data-*.tar.gz` que `lancer.sh` fabrique vers 4 h du matin vivent
sur la tablette elle-même : si elle meurt ou est réinitialisée, la base part
avec — épinglages, historique des offres, comptes. Ce script, lancé par une
tâche planifiée Windows, va chercher la plus récente par SSH (Tailscale), la
vérifie, la range dans un dossier du PC et garde les trente dernières. Il ne
copie rien s'il l'a déjà : le relancer dix fois par jour est sans effet.

    powershell -File deploy\tablette\sauvegarde-pc.ps1            # une fois
    powershell -File deploy\tablette\sauvegarde-pc.ps1 -Installer # + tâche planifiée

La tâche « PokeBroc-Sauvegarde » tourne chaque jour à 9 h et à chaque ouverture
de session ; si le PC était éteint à 9 h, elle rattrape au réveil. Journal dans
le dossier de destination (`journal.log`).
#>
param(
    [switch]$Installer,
    [string]$Hote = "100.80.154.77",
    [int]$Port = 8022,
    [string]$Cle = "$env:USERPROFILE\.ssh\id_ed25519_tablette",
    [string]$Distant = "/data/data/com.termux/files/usr/var/lib/proot-distro/containers/debian/rootfs/root/sauvegardes",
    [string]$Destination = "$env:USERPROFILE\PokeBroc-sauvegardes",
    [int]$Garder = 30
)

# Pas de « Stop » : sous PowerShell 5.1, la moindre ligne qu'un programme natif
# écrit sur stderr deviendrait une exception, et le script mourrait avant de
# nettoyer. On lit les codes de retour, et rien d'autre.
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force $Destination | Out-Null
$journal = Join-Path $Destination "journal.log"

function Note($message) {
    $ligne = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Add-Content -Path $journal -Value $ligne -Encoding utf8
    Write-Output $ligne
}

# ssh/scp/tar : ceux de Windows d'abord (le `tar` de System32 lit le gzip
# tout seul, celui de Git cherche un `gzip` qu'il ne trouve pas), ceux de Git
# à défaut — la tâche planifiée n'a pas forcément le PATH de la session.
function Outil($nom) {
    foreach ($candidat in @("$env:SystemRoot\System32\OpenSSH\$nom.exe",
                            "$env:SystemRoot\System32\$nom.exe",
                            "C:\Program Files\Git\usr\bin\$nom.exe")) {
        if (Test-Path $candidat) { return $candidat }
    }
    $trouve = Get-Command $nom -ErrorAction SilentlyContinue
    if ($trouve) { return $trouve.Source }
    throw "$nom introuvable"
}

if ($Installer) {
    $script = $MyInvocation.MyCommand.Path
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
    $declencheurs = @(
        (New-ScheduledTaskTrigger -Daily -At 9:00),
        (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
    )
    $reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName "PokeBroc-Sauvegarde" -Action $action `
        -Trigger $declencheurs -Settings $reglages -Force | Out-Null
    Note "tâche planifiée « PokeBroc-Sauvegarde » installée (9 h + ouverture de session)"
}

$ssh = Outil "ssh"
$scp = Outil "scp"
$tar = Outil "tar"
$options = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-i", $Cle)

try {
    $liste = & $ssh @options -p $Port "u0_a165@$Hote" "ls -1 $Distant/data-*.tar.gz" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "tablette injoignable : $liste" }
} catch {
    Note "ÉCHEC $($_.Exception.Message)"
    exit 1
}

$derniere = ($liste | Where-Object { $_ -match "data-.*\.tar\.gz$" } | Sort-Object | Select-Object -Last 1)
if (-not $derniere) { Note "aucune archive sur la tablette"; exit 1 }
$nom = Split-Path $derniere -Leaf
$cible = Join-Path $Destination $nom

if (Test-Path $cible) {
    Note "déjà là : $nom"
    exit 0
}

# Copie sous un nom temporaire puis renommage, comme sur la tablette : un
# fichier à moitié écrit ne doit jamais passer pour une sauvegarde valide.
$partiel = "$cible.partiel"
& $scp @options -P $Port "u0_a165@${Hote}:$derniere" $partiel 2>$null | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $partiel)) {
    Remove-Item -Force $partiel -ErrorAction SilentlyContinue
    Note "ÉCHEC copie de $nom"
    exit 1
}
& $tar -tzf $partiel 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Remove-Item -Force $partiel
    Note "ÉCHEC archive illisible : $nom"
    exit 1
}
Move-Item -Force $partiel $cible
$taille = [math]::Round((Get-Item $cible).Length / 1KB)
Note "rapatriée : $nom ($taille Ko)"

Get-ChildItem $Destination -Filter "data-*.tar.gz" | Sort-Object Name -Descending |
    Select-Object -Skip $Garder | ForEach-Object {
        Remove-Item -Force $_.FullName
        Note "purgée : $($_.Name)"
    }
exit 0
